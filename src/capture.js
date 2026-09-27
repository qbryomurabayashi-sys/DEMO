// 音の取り込み — マイクとPCの音（画面共有の音声）を取り、録音用に混ぜ、入力レベルを測り、最後に全部片付ける
// 画面（DOM）は触らない。文言も持たない（確認やトーストは app.js が出す）。
// 録音開始のタップの中で呼ぶもの（requestPcAudio・createAudioContext）は、await を挟まずにその場で呼ぶ。
import { isMobileOrTablet, isMac } from './lib/util.js';

// 画面共有（getDisplayMedia）に渡す値（第0章のとおり）。
// 映像は使わないが、映像を止めると音まで止まる実装があるため、軽い映像（1秒に1枚・小さめ）を録音の終わりまで持っておく。
// 音は加工しない（エコー除去・雑音除去・自動音量をオフ）。
// PC側の再生を止める指定は入れない（入れると、社長の側で Zoom の相手の声が聞こえなくなる）。
export const DISPLAY_MEDIA_OPTIONS = deepFreeze({
    video: { frameRate: { max: 1 }, width: { max: 640 }, height: { max: 360 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    monitorTypeSurfaces: 'include',
});

const MIX_GAIN = 0.8;            // 混ぜるときの音量（2つ足しても音が割れにくいよう、少し下げる）
const ANALYSER_FFT_SIZE = 1024;  // メーターが1回に見る波形の長さ（48kHz で約21ms）
const METER_INTERVAL_MS = 100;   // メーターの更新（1秒に10回）
const METER_FLOOR_DB = -60;      // これより小さい音はメーター0（無音あつかい）

// 中の入れ物まで含めて凍らせる（途中で書き換えられないように）
function deepFreeze(obj) {
    Object.keys(obj).forEach(function (k) {
        if (obj[k] && typeof obj[k] === 'object') deepFreeze(obj[k]);
    });
    return Object.freeze(obj);
}

// navigator.mediaDevices（無い環境では undefined）。Node で import しても困らないよう、呼ばれたときに見る
function navigatorMediaDevices() {
    return typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
}

// ［マイク＋PCの音］を出してよい環境か：画面共有（getDisplayMedia）があり、スマホ・タブレットでも Mac でもない。
// Mac を外すのは、Mac では画面共有で会議アプリ（Zoom など）の音を録れないため。
// env を省略したら navigator を見る。判定で例外が出たら false（出さない側に倒す）
export function canCapturePcAudio(env) {
    try {
        const nav = typeof navigator !== 'undefined' ? navigator : {};
        const e = env || { mediaDevices: nav.mediaDevices, userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints };
        const md = e.mediaDevices;
        if (!md || typeof md.getDisplayMedia !== 'function') return false;
        if (isMobileOrTablet(e.userAgent, e.maxTouchPoints)) return false;
        return !isMac(e.userAgent, e.maxTouchPoints);
    } catch (err) {
        return false;
    }
}

// PCの音を取る（画面共有の選択画面が出る）→ Promise<MediaStream>
// ユーザーのタップの直後でないと失敗するので、await を挟まずに、呼ばれたその場で getDisplayMedia を呼ぶ。
// その場で投げられた例外も reject にして返す（app.js は await した1か所で受ければよい）
export function requestPcAudio(mediaDevices) {
    try {
        const md = mediaDevices !== undefined ? mediaDevices : navigatorMediaDevices();
        return Promise.resolve(md.getDisplayMedia(DISPLAY_MEDIA_OPTIONS));
    } catch (e) {
        return Promise.reject(e);
    }
}

// stream の全トラック（取れなければ空の配列）
function tracksOf(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return [];
    try {
        const t = stream.getTracks();
        return t && typeof t.length === 'number' ? t : [];
    } catch (e) {
        return [];
    }
}

// stream の音声トラックのうち、終わっていないもの
function liveAudioTracks(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return [];
    try {
        const all = stream.getAudioTracks() || [];
        const live = [];
        for (let i = 0; i < all.length; i++) {
            if (all[i] && all[i].readyState !== 'ended') live.push(all[i]);
        }
        return live;
    } catch (e) {
        return [];
    }
}

// トラックの複製（文字起こし用）。録音しているトラックそのものは認識に渡さない（認識の都合で録音が止まらないように）。
// 複製できなければ null（元のトラックを代わりに渡すことはしない）
function cloneTrack(track) {
    if (!track || typeof track.clone !== 'function') return null;
    try {
        return track.clone() || null;
    } catch (e) {
        return null;
    }
}

// 使える音声トラックがあるか（画面共有で「システム オーディオ」をオンにし忘れると false）
export function hasAudio(stream) {
    return liveAudioTracks(stream).length > 0;
}

// トラックを1本ずつ止める。done（Set）に入っているものは飛ばす（同じトラックを二度止めない）。1本が例外でも次へ
function stopEach(tracks, done) {
    for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (!tr || done.has(tr)) continue;
        done.add(tr);
        try {
            tr.stop();
        } catch (e) {
            // 次のトラックへ
        }
    }
}

// その stream の全トラックを止める（null でもよい。例外は外に出さない）
export function stopStream(stream) {
    stopEach(tracksOf(stream), new Set());
}

// getUserMedia を呼ぶ（その場で投げられた例外も reject にする）
function getUserMediaSafe(md, constraints) {
    try {
        return Promise.resolve(md.getUserMedia(constraints));
    } catch (e) {
        return Promise.reject(e);
    }
}

// マイクを取る → Promise<MediaStream>
// deviceId があれば、そのマイクだけ（exact）。そのマイクが見つからない（抜いた・入れ替えた）ときだけ、既定のマイクで1回取り直す。
// 許可が無い（NotAllowedError）などは取り直さない（聞き直しても同じなので、そのまま app.js へ返す）
export function requestMic(deviceId, mediaDevices) {
    const md = mediaDevices !== undefined ? mediaDevices : navigatorMediaDevices();
    const first = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
    return getUserMediaSafe(md, first).catch(function (err) {
        const name = err && err.name;
        if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
            return getUserMediaSafe(md, { audio: true });
        }
        throw err;
    });
}

// window の AudioContext（古い Safari は接頭辞つき）。無い環境では undefined
function defaultAudioContextClass() {
    if (typeof window === 'undefined') return undefined;
    return window.AudioContext || window.webkitAudioContext;
}

// 音を混ぜる・測るための AudioContext を作る（録音開始のタップの中で呼ぶ）→ AudioContext | null
// タップの直後でないと音が流れない（止まった状態で作られる）ブラウザがあるので、その場で作って resume() する（await しない）。
// 作れなければ null（マイクだけの録音はそれでもできる。メーターが出ないだけ）
export function createAudioContext(Ctor) {
    const C = Ctor !== undefined ? Ctor : defaultAudioContextClass();
    if (typeof C !== 'function') return null;
    let ctx;
    try {
        ctx = new C();
    } catch (e) {
        return null;
    }
    try {
        const p = typeof ctx.resume === 'function' ? ctx.resume() : null;
        if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {
        // resume できなくても、作った ctx は返す
    }
    return ctx;
}

// トラックの配列から MediaStream を作る（本物。呼ばれたときに初めて MediaStream を見る）
function newMediaStream(tracks) {
    return new MediaStream(tracks);
}

// 音源に analyser を脇から付ける（source → analyser だけ。録音の経路にもスピーカーにも繋がない）
function attachAnalyser(ctx, source) {
    const an = ctx.createAnalyser();
    an.fftSize = ANALYSER_FFT_SIZE;
    source.connect(an);
    return an;
}

// 音源 → Gain(0.8) → 混ぜる先（Compressor）
function connectThroughGain(ctx, source, dest) {
    const g = ctx.createGain();
    g.gain.value = MIX_GAIN;
    source.connect(g);
    g.connect(dest);
}

// 録音の経路を組む → { recordStream, srTrack, micAnalyser, pcAnalyser }
// PCの音なし：録音するのはマイクの stream そのもの（iPhone との相性のため、録音の経路に AudioContext を挟まない）。
//             メーター用の analyser は ctx があれば脇に付けるだけ。付けられなくても録音には関係ないので null にする。
// PCの音あり：各音源 → Gain(0.8) → DynamicsCompressor（1つ・既定値。足して大きくなった音の割れを抑える）
//             → 1つの出口（MediaStreamAudioDestinationNode）に集め、その stream を録音する。
//             ctx が無ければ混ぜられないので Error（app.js が開始の失敗として片付ける）。
// srTrack は、どちらの経路でも録音しているトラックの複製（止めるときは stopCapture に渡す）。
// makeStream（省略可・テスト用）：トラックの配列から MediaStream を作る関数
export function buildGraph(ctx, sources, makeStream) {
    const micStream = sources && sources.micStream ? sources.micStream : null;
    const pcStream = sources && sources.pcStream ? sources.pcStream : null;
    const useMic = hasAudio(micStream);
    const usePc = hasAudio(pcStream);
    if (!useMic && !usePc) throw new Error('buildGraph: no audio source');

    if (!usePc) {
        let micAnalyser = null;
        if (ctx) {
            try {
                micAnalyser = attachAnalyser(ctx, ctx.createMediaStreamSource(micStream));
            } catch (e) {
                micAnalyser = null;
            }
        }
        return {
            recordStream: micStream,
            srTrack: cloneTrack(liveAudioTracks(micStream)[0]),
            micAnalyser: micAnalyser,
            pcAnalyser: null,
        };
    }

    if (!ctx) throw new Error('buildGraph: AudioContext is required to mix PC audio');
    const dest = ctx.createMediaStreamDestination();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(dest);
    let micAnalyser = null;
    if (useMic) {
        const micSource = ctx.createMediaStreamSource(micStream);
        connectThroughGain(ctx, micSource, comp);
        micAnalyser = attachAnalyser(ctx, micSource);
    }
    // PCの音は、音声トラックだけの stream にしてから使う（映像は使わない）
    const toStream = typeof makeStream === 'function' ? makeStream : newMediaStream;
    const pcSource = ctx.createMediaStreamSource(toStream(pcStream.getAudioTracks()));
    connectThroughGain(ctx, pcSource, comp);
    const pcAnalyser = attachAnalyser(ctx, pcSource);
    return {
        recordStream: dest.stream,
        srTrack: cloneTrack(liveAudioTracks(dest.stream)[0]),
        micAnalyser: micAnalyser,
        pcAnalyser: pcAnalyser,
    };
}

// 波形（-1〜1 の数の並び）→ 入力レベル 0〜1（メーターの長さ）。純粋関数。
// 音の大きさ（RMS）をデシベルにして、-60dB〜0dB を 0〜1 に直す（耳の感じ方に近く、小さな声でもバーが動いて見える）。
// 小数2けたに丸め、0〜1 からはみ出さないようにする。数でない値（NaN など）は無音として数える
export function levelFromSamples(samples) {
    const n = samples && samples.length > 0 ? samples.length : 0;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const v = samples[i];
        if (typeof v === 'number' && Number.isFinite(v)) sum += v * v;
    }
    const rms = Math.sqrt(sum / n);
    if (!(rms > 0)) return 0;
    const level = (20 * Math.log10(rms) - METER_FLOOR_DB) / -METER_FLOOR_DB;
    const clamped = level < 0 ? 0 : (level > 1 ? 1 : level);
    return Math.round(clamped * 100) / 100;
}

// analyser から波形を読んでレベルにする関数を作る（入れ物は作り直さず使い回す）。
// getFloatTimeDomainData を優先し、無い端末では getByteTimeDomainData（0〜255、128が無音）を -1〜1 に直して使う。
// 読めなかったら 0
function makeLevelReader(an) {
    const size = an.fftSize > 0 ? an.fftSize : ANALYSER_FFT_SIZE;
    const floats = new Float32Array(size);
    if (typeof an.getFloatTimeDomainData === 'function') {
        return function () {
            try {
                an.getFloatTimeDomainData(floats);
                return levelFromSamples(floats);
            } catch (e) {
                return 0;
            }
        };
    }
    const bytes = new Uint8Array(size);
    return function () {
        try {
            an.getByteTimeDomainData(bytes);
            for (let i = 0; i < size; i++) floats[i] = (bytes[i] - 128) / 128;
            return levelFromSamples(floats);
        } catch (e) {
            return 0;
        }
    };
}

// メーターを動かす → 止める関数（2回呼んでもよい）
// 100ms ごとに（1秒に10回）analyser から読み、onLevels({ mic, pc }) に 0〜1 を渡す。analyser が無い側は null。
// 画面が隠れているあいだ（doc.hidden）は読まない・呼ばない（電池のため）。analyser が1つも無ければ何もしない。
// doc（省略可）：document の代わり。timers（省略可・テスト用）：{ setInterval, clearInterval }
export function startMeters(analysers, onLevels, doc, timers) {
    const micAn = analysers && analysers.micAnalyser ? analysers.micAnalyser : null;
    const pcAn = analysers && analysers.pcAnalyser ? analysers.pcAnalyser : null;
    if (!micAn && !pcAn) return function () {};
    const d = doc !== undefined ? doc : (typeof document !== 'undefined' ? document : null);
    const t = timers || {};
    const readMic = micAn ? makeLevelReader(micAn) : null;
    const readPc = pcAn ? makeLevelReader(pcAn) : null;
    let stopped = false;

    function tick() {
        if (stopped || (d && d.hidden)) return;
        const levels = { mic: readMic ? readMic() : null, pc: readPc ? readPc() : null };
        if (typeof onLevels !== 'function') return;
        try {
            onLevels(levels);
        } catch (e) {
            console.error(e);
        }
    }

    const id = t.setInterval ? t.setInterval(tick, METER_INTERVAL_MS) : setInterval(tick, METER_INTERVAL_MS);
    return function stop() {
        if (stopped) return;
        stopped = true;
        if (t.clearInterval) t.clearInterval(id);
        else clearInterval(id);
    };
}

// AudioContext を閉じる（閉じ済みなら何もしない。close の例外も reject も外に出さない）
function closeContext(ctx) {
    if (!ctx || ctx.state === 'closed' || typeof ctx.close !== 'function') return;
    try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {
        // 閉じられなくても、ほかの片付けは済んでいる
    }
}

// 録音の後片付け（停止のときも、開始に失敗したときも、必ず呼ぶ）→ なし
// parts：{ streams, srTrack, ctx, stopMeters }（srTrack は buildGraph が作った文字起こし用の複製）
// 1) 全トラックを止める（マイク・PCの映像・PCの音・混ぜた音・文字起こし用の複製。マイクと画面共有の表示を消すため最初に）。
//    同じトラックは1回だけ。 2) メーターを止める。 3) AudioContext を閉じる。
// どれかで例外が出ても、残りを全部やり切る。2回呼んでも安全
export function stopCapture(parts) {
    const p = parts || {};
    const streams = Array.isArray(p.streams) ? p.streams : [];
    const done = new Set();
    for (let i = 0; i < streams.length; i++) {
        stopEach(tracksOf(streams[i]), done);
    }
    stopEach(p.srTrack ? [p.srTrack] : [], done);
    if (typeof p.stopMeters === 'function') {
        try {
            p.stopMeters();
        } catch (e) {
            // ctx は閉じる
        }
    }
    closeContext(p.ctx);
}
