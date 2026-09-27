// capture.js の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
// マイク・画面共有・AudioContext は Node に無いので、偽物（FakeTrack／FakeMediaStream／makeCtx など）で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DISPLAY_MEDIA_OPTIONS,
    canCapturePcAudio,
    requestPcAudio,
    hasAudio,
    stopStream,
    requestMic,
    createAudioContext,
    buildGraph,
    levelFromSamples,
    startMeters,
    stopCapture,
} from '../src/capture.js';

// ---- 偽物 ----

let trackSeq = 0;

// 偽のトラック。stop() の回数を数える。throwOnStop なら stop() で例外（止まりはする）。onStop があれば止めた順を記録できる
class FakeTrack {
    constructor(kind, opts) {
        trackSeq++;
        this.kind = kind;
        this.id = kind + '-' + trackSeq;
        this.readyState = 'live';
        this.stopCount = 0;
        this.throwOnStop = !!(opts && opts.throwOnStop);
        this.onStop = opts && opts.onStop ? opts.onStop : null;
    }
    stop() {
        this.stopCount++;
        this.readyState = 'ended';
        if (this.onStop) this.onStop(this);
        if (this.throwOnStop) throw new Error('stop に失敗');
    }
    // 複製（同じ種類の新しいトラック。元は clonedFrom で分かる）
    clone() {
        const c = new FakeTrack(this.kind);
        c.clonedFrom = this;
        return c;
    }
}

// 偽の MediaStream。capture.js の既定（new MediaStream）もこれを使うよう、globalThis に置く
class FakeMediaStream {
    constructor(tracks) {
        this._tracks = Array.from(tracks || []);
    }
    getTracks() { return this._tracks.slice(); }
    getAudioTracks() { return this._tracks.filter(function (t) { return t.kind === 'audio'; }); }
    getVideoTracks() { return this._tracks.filter(function (t) { return t.kind === 'video'; }); }
}
globalThis.MediaStream = FakeMediaStream;

function micStreamOf() {
    return new FakeMediaStream([new FakeTrack('audio')]);
}
// 画面共有の stream（映像＋音声。withAudio=false なら映像だけ＝システムの音声をオンにし忘れた）
function pcStreamOf(withAudio) {
    const tracks = [new FakeTrack('video')];
    if (withAudio !== false) tracks.push(new FakeTrack('audio'));
    return new FakeMediaStream(tracks);
}

// 偽の AudioContext。作ったノードと、つないだ先を全部覚える
function makeCtx() {
    const log = { sources: [], gains: [], analysers: [], comps: [], dests: [], connections: [] };
    function node(kind, extra) {
        const n = Object.assign({
            kind: kind,
            outputs: [],
            connect: function (target) {
                this.outputs.push(target);
                log.connections.push([this, target]);
                return target;
            },
        }, extra || {});
        return n;
    }
    const ctx = {
        state: 'running',
        closeCount: 0,
        destination: node('speaker'),
        createMediaStreamSource: function (stream) {
            const n = node('source', { stream: stream });
            log.sources.push(n);
            return n;
        },
        createGain: function () {
            const n = node('gain', { gain: { value: 1 } });
            log.gains.push(n);
            return n;
        },
        createAnalyser: function () {
            const n = node('analyser', { fftSize: 2048, getFloatTimeDomainData: function () {} });
            log.analysers.push(n);
            return n;
        },
        createDynamicsCompressor: function () {
            // 既定値のまま使われたかを見るため、既定値の印を持たせる
            const n = node('comp', { threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 } });
            log.comps.push(n);
            return n;
        },
        createMediaStreamDestination: function () {
            const n = node('dest', { stream: new FakeMediaStream([new FakeTrack('audio')]) });
            log.dests.push(n);
            return n;
        },
        close: function () {
            this.closeCount++;
            this.state = 'closed';
            return Promise.resolve();
        },
    };
    return { ctx: ctx, log: log };
}

// 偽の mediaDevices。getDisplayMedia／getUserMedia に渡された引数を覚える。impl で中身を決める
function makeDevices(impl) {
    const calls = { display: [], user: [] };
    const md = {
        getDisplayMedia: function (opts) {
            calls.display.push(opts);
            return impl && impl.display ? impl.display(opts, calls.display.length) : Promise.resolve(pcStreamOf());
        },
        getUserMedia: function (c) {
            calls.user.push(c);
            return impl && impl.user ? impl.user(c, calls.user.length) : Promise.resolve(micStreamOf());
        },
    };
    return { md: md, calls: calls };
}

function domError(name) {
    const e = new Error(name);
    e.name = name;
    return e;
}

// Promise の後始末（reject を握れているか）を見るため、待ちの処理を全部進める
function flush() {
    return new Promise(function (resolve) { setImmediate(resolve); });
}

// 手で進める setInterval／clearInterval（ms ぶん進めると、そのあいだに来た回数だけ呼ぶ）
function makeIntervals() {
    let t = 0;
    let seq = 0;
    const list = new Map();
    return {
        setInterval: function (fn, ms) {
            seq++;
            list.set(seq, { fn: fn, ms: ms, next: t + ms });
            return seq;
        },
        clearInterval: function (id) { list.delete(id); },
        count: function () { return list.size; },
        delays: function () { return Array.from(list.values()).map(function (x) { return x.ms; }); },
        advance: function (ms) {
            const end = t + ms;
            for (;;) {
                let next = null;
                for (const x of list.values()) {
                    if (x.next <= end && (next === null || x.next < next.next)) next = x;
                }
                if (next === null) break;
                t = next.next;
                next.next += next.ms;
                next.fn();
            }
            t = end;
        },
    };
}

// 正弦波の波形（振幅 amp、1024 サンプル）
function sine(amp) {
    const a = new Float32Array(1024);
    for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * i) / 64);
    return a;
}

// 偽の analyser（Float の読み方を持つ）。いつも value が並んだ波形を返し、読んだ回数を数える
function floatAnalyser(value) {
    return {
        fftSize: 1024,
        reads: 0,
        getFloatTimeDomainData: function (buf) {
            this.reads++;
            buf.fill(value);
        },
    };
}

// 偽の analyser（Byte の読み方だけを持つ古い端末）。いつも byte（0〜255、128が無音）が並んだ波形を返す
function byteAnalyser(byte) {
    return {
        fftSize: 1024,
        reads: 0,
        getByteTimeDomainData: function (buf) {
            this.reads++;
            buf.fill(byte);
        },
    };
}

// console.error を黙らせて fn を実行し、呼ばれた回数を返す（わざと例外を出すテスト用）
function quietErrors(fn) {
    const orig = console.error;
    let n = 0;
    console.error = function () { n++; };
    try {
        fn();
    } finally {
        console.error = orig;
    }
    return n;
}

// ---- DISPLAY_MEDIA_OPTIONS ----

test('DISPLAY_MEDIA_OPTIONS: 第0章の値と完全に一致する', () => {
    assert.deepStrictEqual(DISPLAY_MEDIA_OPTIONS, {
        video: { frameRate: { max: 1 }, width: { max: 640 }, height: { max: 360 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
    });
});

test('DISPLAY_MEDIA_OPTIONS: どの深さにも suppress で始まるキーが無い（PC側の再生を止める指定を入れない）', () => {
    const keys = [];
    (function walk(o) {
        for (const k of Object.keys(o)) {
            keys.push(k);
            if (o[k] && typeof o[k] === 'object') walk(o[k]);
        }
    })(DISPLAY_MEDIA_OPTIONS);
    assert.ok(keys.length >= 10);
    for (const k of keys) assert.ok(!/^suppress/i.test(k), k);
});

test('DISPLAY_MEDIA_OPTIONS: 凍らせてあり、あとから書き足せない', () => {
    assert.throws(function () { DISPLAY_MEDIA_OPTIONS.audio.extra = true; }, TypeError);
    assert.throws(function () { DISPLAY_MEDIA_OPTIONS.extra = true; }, TypeError);
    assert.throws(function () { DISPLAY_MEDIA_OPTIONS.video.frameRate.max = 30; }, TypeError);
});

// ---- canCapturePcAudio ----

const UA = {
    winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
const withGDM = { getDisplayMedia: function () {} };
const withoutGDM = { getUserMedia: function () {} };

test('canCapturePcAudio: Windows の PC（Chrome・Edge）で getDisplayMedia があれば true', () => {
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.winChrome, maxTouchPoints: 0 }), true);
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.winEdge, maxTouchPoints: 0 }), true);
    // タッチ画面の Windows ノートも PC
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.winChrome, maxTouchPoints: 10 }), true);
});

test('canCapturePcAudio: Mac（Macintosh・タッチ点1以下）は、getDisplayMedia があっても false（会議アプリの音を録れない）', () => {
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.macSafari, maxTouchPoints: 0 }), false);
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.macSafari, maxTouchPoints: 1 }), false);
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.macChrome, maxTouchPoints: 0 }), false);
});

test('canCapturePcAudio: getDisplayMedia が無い・mediaDevices が無いなら false', () => {
    assert.equal(canCapturePcAudio({ mediaDevices: withoutGDM, userAgent: UA.winChrome, maxTouchPoints: 0 }), false);
    assert.equal(canCapturePcAudio({ mediaDevices: undefined, userAgent: UA.winChrome, maxTouchPoints: 0 }), false);
    assert.equal(canCapturePcAudio({ mediaDevices: { getDisplayMedia: 'x' }, userAgent: UA.winChrome, maxTouchPoints: 0 }), false);
});

test('canCapturePcAudio: スマホ・タブレット・iPad のデスクトップ表示は、getDisplayMedia があっても false', () => {
    for (const ua of [UA.iphone, UA.ipadOld, UA.androidPhone, UA.androidTablet]) {
        assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: ua, maxTouchPoints: 5 }), false, ua);
    }
    // iPad のデスクトップ表示：UA は Mac と同じで、タッチ点が複数
    assert.equal(canCapturePcAudio({ mediaDevices: withGDM, userAgent: UA.macSafari, maxTouchPoints: 5 }), false);
});

test('canCapturePcAudio: 引数なし（Node の navigator には mediaDevices が無い）でも例外にならず false', () => {
    assert.equal(canCapturePcAudio(), false);
});

// ---- requestPcAudio ----

test('requestPcAudio: 呼んだその場で getDisplayMedia(DISPLAY_MEDIA_OPTIONS) を呼び、Promise を返す', async () => {
    const pc = pcStreamOf();
    const dev = makeDevices({ display: function () { return Promise.resolve(pc); } });
    const p = requestPcAudio(dev.md);
    assert.equal(dev.calls.display.length, 1);
    assert.equal(dev.calls.display[0], DISPLAY_MEDIA_OPTIONS);
    assert.ok(p instanceof Promise);
    assert.equal(await p, pc);
});

test('requestPcAudio: その場で投げられた例外は reject になる（呼び出しは例外を投げない）', async () => {
    const err = domError('InvalidStateError');
    const dev = makeDevices({ display: function () { throw err; } });
    let p;
    assert.doesNotThrow(function () { p = requestPcAudio(dev.md); });
    assert.ok(p instanceof Promise);
    await assert.rejects(p, function (e) { return e === err; });
});

test('requestPcAudio: 断られた（NotAllowedError）はそのまま reject。mediaDevices が無くても reject', async () => {
    const err = domError('NotAllowedError');
    const dev = makeDevices({ display: function () { return Promise.reject(err); } });
    await assert.rejects(requestPcAudio(dev.md), function (e) { return e === err; });
    let p;
    assert.doesNotThrow(function () { p = requestPcAudio(null); });
    await assert.rejects(p);
    assert.doesNotThrow(function () { p = requestPcAudio({}); });
    await assert.rejects(p);
    assert.doesNotThrow(function () { p = requestPcAudio(); });
    await assert.rejects(p);
});

// ---- hasAudio・stopStream ----

test('hasAudio: 終わっていない音声トラックがあるときだけ true', () => {
    assert.equal(hasAudio(pcStreamOf(true)), true);
    assert.equal(hasAudio(pcStreamOf(false)), false);
    assert.equal(hasAudio(new FakeMediaStream([])), false);
    assert.equal(hasAudio(null), false);
    assert.equal(hasAudio(undefined), false);
    assert.equal(hasAudio({}), false);
    const ended = micStreamOf();
    ended.getAudioTracks()[0].readyState = 'ended';
    assert.equal(hasAudio(ended), false);
    const broken = { getAudioTracks: function () { throw new Error('x'); } };
    assert.equal(hasAudio(broken), false);
});

test('stopStream: 全トラックを止める。null でもよく、1本が例外でも残りを止める', () => {
    const a = new FakeTrack('video', { throwOnStop: true });
    const b = new FakeTrack('audio');
    assert.doesNotThrow(function () { stopStream(new FakeMediaStream([a, b])); });
    assert.equal(a.stopCount, 1);
    assert.equal(b.stopCount, 1);
    assert.doesNotThrow(function () { stopStream(null); });
    assert.doesNotThrow(function () { stopStream({ getTracks: function () { throw new Error('x'); } }); });
});

// ---- requestMic ----

test('requestMic: deviceId があれば exact で、無ければ audio:true で取る（その場で呼ぶ）', async () => {
    const dev = makeDevices();
    const p = requestMic('mic-123', dev.md);
    assert.equal(dev.calls.user.length, 1);
    assert.deepStrictEqual(dev.calls.user[0], { audio: { deviceId: { exact: 'mic-123' } } });
    await p;
    const dev2 = makeDevices();
    await requestMic('', dev2.md);
    await requestMic(undefined, dev2.md);
    assert.deepStrictEqual(dev2.calls.user, [{ audio: true }, { audio: true }]);
});

test('requestMic: OverconstrainedError／NotFoundError のときだけ audio:true で1回取り直す', async () => {
    for (const name of ['OverconstrainedError', 'NotFoundError']) {
        const second = micStreamOf();
        const dev = makeDevices({
            user: function (c, n) { return n === 1 ? Promise.reject(domError(name)) : Promise.resolve(second); },
        });
        assert.equal(await requestMic('gone', dev.md), second, name);
        assert.deepStrictEqual(dev.calls.user, [{ audio: { deviceId: { exact: 'gone' } } }, { audio: true }], name);
    }
});

test('requestMic: NotAllowedError などでは取り直さず、そのまま reject', async () => {
    for (const name of ['NotAllowedError', 'NotReadableError', 'AbortError', 'SecurityError']) {
        const err = domError(name);
        const dev = makeDevices({ user: function () { return Promise.reject(err); } });
        await assert.rejects(requestMic('mic-1', dev.md), function (e) { return e === err; }, name);
        assert.equal(dev.calls.user.length, 1, name);
    }
});

test('requestMic: 取り直しも失敗したら、その失敗で reject（3回目は無い）', async () => {
    const second = domError('NotAllowedError');
    const dev = makeDevices({
        user: function (c, n) { return Promise.reject(n === 1 ? domError('OverconstrainedError') : second); },
    });
    await assert.rejects(requestMic('gone', dev.md), function (e) { return e === second; });
    assert.equal(dev.calls.user.length, 2);
});

test('requestMic: deviceId が無いときは、同じ頼み方になるので取り直さない', async () => {
    const dev = makeDevices({ user: function () { return Promise.reject(domError('NotFoundError')); } });
    await assert.rejects(requestMic(undefined, dev.md), { name: 'NotFoundError' });
    assert.equal(dev.calls.user.length, 1);
});

test('requestMic: その場で投げられた例外も reject になる', async () => {
    const dev = makeDevices({ user: function () { throw domError('TypeError'); } });
    let p;
    assert.doesNotThrow(function () { p = requestMic(undefined, dev.md); });
    await assert.rejects(p, { name: 'TypeError' });
    assert.doesNotThrow(function () { p = requestMic('x', null); });
    await assert.rejects(p);
});

// ---- createAudioContext ----

test('createAudioContext: その場で new して resume() を呼ぶ（await しない）', () => {
    const log = [];
    class Ctx {
        constructor() {
            log.push(new.target === Ctx ? 'new' : 'call');
        }
        resume() {
            log.push('resume');
            return Promise.resolve();
        }
    }
    const ctx = createAudioContext(Ctx);
    assert.ok(ctx instanceof Ctx);
    assert.deepStrictEqual(log, ['new', 'resume']);
});

test('createAudioContext: Ctor が無い・関数でない・作れないなら null', () => {
    assert.equal(createAudioContext(null), null);
    assert.equal(createAudioContext('AudioContext'), null);
    assert.equal(createAudioContext(), null); // Node には window が無い
    class Broken { constructor() { throw new Error('作れない'); } }
    assert.equal(createAudioContext(Broken), null);
});

test('createAudioContext: resume が reject・例外・無い でも ctx を返し、reject を外に出さない', async () => {
    const unhandled = [];
    const onUnhandled = function (e) { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
        class Rejects { resume() { return Promise.reject(new Error('resume できない')); } }
        class Throws { resume() { throw new Error('resume できない'); } }
        class NoResume {}
        assert.ok(createAudioContext(Rejects) instanceof Rejects);
        assert.ok(createAudioContext(Throws) instanceof Throws);
        assert.ok(createAudioContext(NoResume) instanceof NoResume);
        await flush();
        await flush();
        assert.deepStrictEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

// ---- buildGraph ----

// つないだ先に、スピーカー（ctx.destination）が1つも無いこと（自分の声がスピーカーから出ないように）
function assertNothingToSpeaker(ctx, log) {
    for (const pair of log.connections) assert.notEqual(pair[1], ctx.destination);
}

test('buildGraph: マイクだけ → 録音はマイクの stream そのもの。Gain・Compressor・出口は作らない', () => {
    const { ctx, log } = makeCtx();
    const mic = micStreamOf();
    const g = buildGraph(ctx, { micStream: mic, pcStream: null });
    assert.equal(g.recordStream, mic);
    assert.equal(log.gains.length, 0);
    assert.equal(log.comps.length, 0);
    assert.equal(log.dests.length, 0);
    assert.equal(g.pcAnalyser, null);
    // メーター用の analyser は脇に付けるだけ（source → analyser。analyser の先は無い）
    assert.equal(log.sources.length, 1);
    assert.equal(log.sources[0].stream, mic);
    assert.equal(g.micAnalyser, log.analysers[0]);
    assert.equal(g.micAnalyser.fftSize, 1024);
    assert.deepStrictEqual(log.sources[0].outputs, [g.micAnalyser]);
    assert.deepStrictEqual(g.micAnalyser.outputs, []);
    assertNothingToSpeaker(ctx, log);
});

test('buildGraph: マイクだけでも、srTrack は録音しているマイクのトラックの複製（そのものは渡さない）', () => {
    const mic = micStreamOf();
    const g = buildGraph(makeCtx().ctx, { micStream: mic });
    assert.ok(g.srTrack instanceof FakeTrack);
    assert.notEqual(g.srTrack, mic.getAudioTracks()[0]);
    assert.equal(g.srTrack.clonedFrom, mic.getAudioTracks()[0]);
    assert.equal(g.srTrack.kind, 'audio');
});

test('buildGraph: マイクだけで ctx が null でも録音はできる（メーターが無いだけ）', () => {
    const mic = micStreamOf();
    const g = buildGraph(null, { micStream: mic });
    assert.equal(g.recordStream, mic);
    assert.equal(g.srTrack.clonedFrom, mic.getAudioTracks()[0]);
    assert.equal(g.micAnalyser, null);
    assert.equal(g.pcAnalyser, null);
});

test('buildGraph: マイクだけで analyser が付けられなくても、録音はマイクの stream のまま', () => {
    const { ctx, log } = makeCtx();
    ctx.createAnalyser = function () { throw new Error('作れない'); };
    const mic = micStreamOf();
    const g = buildGraph(ctx, { micStream: mic });
    assert.equal(g.recordStream, mic);
    assert.equal(g.micAnalyser, null);
    assert.equal(log.gains.length, 0);
    assert.equal(log.dests.length, 0);
});

test('buildGraph: トラックが複製できなければ srTrack は null（録音しているトラックを代わりに渡さない）', () => {
    const mic = micStreamOf();
    mic.getAudioTracks()[0].clone = function () { throw new Error('複製できない'); };
    assert.equal(buildGraph(null, { micStream: mic }).srTrack, null);
    const mic2 = micStreamOf();
    mic2.getAudioTracks()[0].clone = undefined;
    assert.equal(buildGraph(null, { micStream: mic2 }).srTrack, null);
});

test('buildGraph: 画面共有に音が無い（システムの音声をオンにし忘れた）→ マイクだけと同じ経路', () => {
    const { ctx, log } = makeCtx();
    const mic = micStreamOf();
    const g = buildGraph(ctx, { micStream: mic, pcStream: pcStreamOf(false) });
    assert.equal(g.recordStream, mic);
    assert.equal(g.pcAnalyser, null);
    assert.equal(log.gains.length, 0);
    assert.equal(log.comps.length, 0);
    assert.equal(log.dests.length, 0);
});

test('buildGraph: マイク＋PC → 各音源 → Gain 0.8 → Compressor（1つ・既定値）→ 出口（1つ）。録音は混ぜた音', () => {
    const { ctx, log } = makeCtx();
    const mic = micStreamOf();
    const pc = pcStreamOf(true);
    const g = buildGraph(ctx, { micStream: mic, pcStream: pc });
    assert.equal(log.dests.length, 1);
    assert.equal(log.comps.length, 1);
    const dest = log.dests[0];
    const comp = log.comps[0];
    assert.equal(g.recordStream, dest.stream);
    assert.deepStrictEqual(comp.outputs, [dest]);
    // 既定値のまま（書き換えていない）
    assert.equal(comp.threshold.value, -24);
    assert.equal(comp.ratio.value, 12);
    assert.equal(log.gains.length, 2);
    for (const gn of log.gains) {
        assert.equal(gn.gain.value, 0.8);
        assert.deepStrictEqual(gn.outputs, [comp]);
    }
    assert.equal(log.sources.length, 2);
    const micSrc = log.sources.find(function (s) { return s.stream === mic; });
    const pcSrc = log.sources.find(function (s) { return s.stream !== mic; });
    assert.ok(micSrc && pcSrc);
    // 各音源 → Gain 1つと analyser 1つ（analyser の先は無い）
    for (const [src, an] of [[micSrc, g.micAnalyser], [pcSrc, g.pcAnalyser]]) {
        assert.equal(src.outputs.length, 2);
        assert.equal(src.outputs.filter(function (x) { return x.kind === 'gain'; }).length, 1);
        assert.ok(src.outputs.includes(an));
        assert.deepStrictEqual(an.outputs, []);
        assert.equal(an.fftSize, 1024);
    }
    assert.notEqual(g.micAnalyser, g.pcAnalyser);
    assertNothingToSpeaker(ctx, log);
});

test('buildGraph: 混ぜる経路の srTrack は、出口の音声トラックの複製', () => {
    const { ctx, log } = makeCtx();
    const g = buildGraph(ctx, { micStream: micStreamOf(), pcStream: pcStreamOf(true) });
    const out = log.dests[0].stream.getAudioTracks()[0];
    assert.notEqual(g.srTrack, out);
    assert.equal(g.srTrack.clonedFrom, out);
});

test('buildGraph: PCの音源は、画面共有の音声トラックだけで作った stream から作る（映像は入れない）', () => {
    const { ctx, log } = makeCtx();
    const pc = pcStreamOf(true);
    buildGraph(ctx, { micStream: micStreamOf(), pcStream: pc });
    const pcSrc = log.sources[log.sources.length - 1];
    assert.ok(pcSrc.stream instanceof FakeMediaStream);
    assert.notEqual(pcSrc.stream, pc);
    assert.deepStrictEqual(pcSrc.stream.getTracks(), pc.getAudioTracks());
    assert.equal(pcSrc.stream.getVideoTracks().length, 0);
});

test('buildGraph: makeStream を渡したら、それに音声トラックの配列を渡して stream を作る', () => {
    const { ctx, log } = makeCtx();
    const pc = pcStreamOf(true);
    const got = [];
    const made = new FakeMediaStream([]);
    buildGraph(ctx, { pcStream: pc }, function (tracks) { got.push(tracks); return made; });
    assert.equal(got.length, 1);
    assert.equal(got[0].length, 1);
    assert.equal(got[0][0], pc.getAudioTracks()[0]);
    assert.equal(log.sources[0].stream, made);
});

test('buildGraph: PCの音だけ（マイク無し）→ Gain 0.8 を1つ、Compressor と出口を1つずつ。マイクのメーターは null', () => {
    const { ctx, log } = makeCtx();
    const g = buildGraph(ctx, { micStream: null, pcStream: pcStreamOf(true) });
    assert.equal(log.gains.length, 1);
    assert.equal(log.gains[0].gain.value, 0.8);
    assert.equal(log.comps.length, 1);
    assert.equal(log.dests.length, 1);
    assert.equal(g.recordStream, log.dests[0].stream);
    assert.equal(g.micAnalyser, null);
    assert.ok(g.pcAnalyser);
    assertNothingToSpeaker(ctx, log);
});

test('buildGraph: PCの音があるのに ctx が null → Error（混ぜられない）', () => {
    assert.throws(function () { buildGraph(null, { micStream: micStreamOf(), pcStream: pcStreamOf(true) }); }, Error);
    assert.throws(function () { buildGraph(null, { pcStream: pcStreamOf(true) }); }, Error);
});

test('buildGraph: 使える音源が1つも無い → Error', () => {
    const { ctx } = makeCtx();
    assert.throws(function () { buildGraph(ctx, { micStream: null, pcStream: null }); }, Error);
    assert.throws(function () { buildGraph(ctx, {}); }, Error);
    assert.throws(function () { buildGraph(ctx, { pcStream: pcStreamOf(false) }); }, Error);
    assert.throws(function () { buildGraph(ctx); }, Error);
    const ended = micStreamOf();
    ended.getAudioTracks()[0].readyState = 'ended';
    assert.throws(function () { buildGraph(ctx, { micStream: ended }); }, Error);
});

// ---- levelFromSamples ----

test('levelFromSamples: 無音・空・null・数でない値だけ → 0', () => {
    assert.equal(levelFromSamples(new Float32Array(1024)), 0);
    assert.equal(levelFromSamples(new Float32Array(0)), 0);
    assert.equal(levelFromSamples([]), 0);
    assert.equal(levelFromSamples(null), 0);
    assert.equal(levelFromSamples(undefined), 0);
    assert.equal(levelFromSamples([NaN, Infinity, -Infinity]), 0);
});

test('levelFromSamples: -60dB〜0dB を 0〜1 に。-60dB 以下は 0、0dB 以上は 1（はみ出さない）', () => {
    assert.equal(levelFromSamples(new Float32Array(1024).fill(1)), 1);
    assert.equal(levelFromSamples(new Float32Array(1024).fill(-1)), 1);
    assert.equal(levelFromSamples([4, -4, 4, -4]), 1);                         // 1 を超える波形でも 1 まで
    assert.equal(levelFromSamples(new Float32Array(1024).fill(0.1)), 0.67);    // -20dB
    assert.equal(levelFromSamples(new Float32Array(1024).fill(-0.1)), 0.67);   // 向きは関係ない
    assert.equal(levelFromSamples(new Float32Array(1024).fill(0.01)), 0.33);   // -40dB
    assert.equal(levelFromSamples(new Float32Array(1024).fill(0.001)), 0);     // -60dB
    assert.equal(levelFromSamples(new Float32Array(1024).fill(0.0001)), 0);    // -80dB（マイナスにしない）
    assert.equal(levelFromSamples(sine(1)), 0.95);                             // 正弦波の最大（-3dB）
});

test('levelFromSamples: 音が大きいほどメーターも長い（小さくならない）。いつも 0〜1・小数2けた', () => {
    let prev = -1;
    let rises = 0;
    for (let k = 0; k <= 200; k++) {
        const amp = Math.pow(10, -4 + (k * 5) / 200); // 0.0001 〜 10
        const lv = levelFromSamples(sine(amp));
        assert.ok(lv >= 0 && lv <= 1, amp + ' → ' + lv);
        assert.equal(Math.round(lv * 100) / 100, lv);
        assert.ok(lv >= prev, amp + ' → ' + lv + ' < ' + prev);
        if (lv > prev) rises++;
        prev = lv;
    }
    assert.ok(rises >= 80, String(rises)); // 実際に上がっていく（ずっと同じ値ではない）
    assert.equal(levelFromSamples(sine(0.0001)), 0);
    assert.equal(levelFromSamples(sine(10)), 1);
});

// ---- startMeters ----

test('startMeters: 100ms ごとに onLevels({ mic, pc }) を呼ぶ（1秒に10回）', () => {
    const iv = makeIntervals();
    const got = [];
    const mic = floatAnalyser(0.1);
    const pc = floatAnalyser(1);
    const stop = startMeters({ micAnalyser: mic, pcAnalyser: pc }, function (lv) { got.push(lv); }, { hidden: false }, iv);
    assert.deepStrictEqual(iv.delays(), [100]);
    iv.advance(99);
    assert.equal(got.length, 0);
    iv.advance(1);
    assert.equal(got.length, 1);
    iv.advance(900);
    assert.equal(got.length, 10);
    for (const lv of got) assert.deepStrictEqual(lv, { mic: 0.67, pc: 1 });
    assert.equal(mic.reads, 10);
    assert.equal(pc.reads, 10);
    stop();
});

test('startMeters: 画面が隠れているあいだは読まない・呼ばない。戻ったらまた動く', () => {
    const iv = makeIntervals();
    const got = [];
    const doc = { hidden: true };
    const mic = floatAnalyser(0.1);
    const stop = startMeters({ micAnalyser: mic }, function (lv) { got.push(lv); }, doc, iv);
    iv.advance(1000);
    assert.equal(got.length, 0);
    assert.equal(mic.reads, 0);
    doc.hidden = false;
    iv.advance(100);
    assert.deepStrictEqual(got, [{ mic: 0.67, pc: null }]);
    stop();
});

test('startMeters: 止めたあとは呼ばない。止める関数は2回呼んでもよい', () => {
    const iv = makeIntervals();
    const got = [];
    const stop = startMeters({ micAnalyser: floatAnalyser(0.1) }, function (lv) { got.push(lv); }, { hidden: false }, iv);
    iv.advance(300);
    assert.equal(got.length, 3);
    stop();
    assert.equal(iv.count(), 0);
    iv.advance(1000);
    assert.equal(got.length, 3);
    assert.doesNotThrow(stop);
});

test('startMeters: 止めたあとにタイマーが1回来てしまっても（消すのが間に合わない）、読まない・呼ばない', () => {
    const iv = makeIntervals();
    const leaky = { setInterval: iv.setInterval, clearInterval: function () {} };
    const got = [];
    const mic = floatAnalyser(0.1);
    const stop = startMeters({ micAnalyser: mic }, function (lv) { got.push(lv); }, { hidden: false }, leaky);
    iv.advance(100);
    stop();
    iv.advance(500);
    assert.equal(got.length, 1);
    assert.equal(mic.reads, 1);
});

test('startMeters: analyser が1つも無ければタイマーを作らない（止める関数は呼んでもよい）', () => {
    const iv = makeIntervals();
    let calls = 0;
    const stop = startMeters({ micAnalyser: null, pcAnalyser: null }, function () { calls++; }, { hidden: false }, iv);
    const stop2 = startMeters(null, function () { calls++; }, { hidden: false }, iv);
    assert.equal(iv.count(), 0);
    assert.equal(typeof stop, 'function');
    assert.doesNotThrow(stop);
    assert.doesNotThrow(stop2);
    iv.advance(1000);
    assert.equal(calls, 0);
});

test('startMeters: getFloatTimeDomainData が無い端末では、Byte の波形（128が無音）を -1〜1 に直して測る', () => {
    const iv = makeIntervals();
    const got = [];
    const stop = startMeters({ micAnalyser: byteAnalyser(128), pcAnalyser: byteAnalyser(0) }, function (lv) { got.push(lv); }, { hidden: false }, iv);
    iv.advance(100);
    stop();
    assert.deepStrictEqual(got, [{ mic: 0, pc: 1 }]);
    const got2 = [];
    const stop2 = startMeters({ micAnalyser: byteAnalyser(141) }, function (lv) { got2.push(lv); }, { hidden: false }, iv);
    iv.advance(100);
    stop2();
    assert.deepStrictEqual(got2, [{ mic: 0.67, pc: null }]); // (141-128)/128 ≒ 0.1 → -20dB
});

test('startMeters: Float と Byte の両方があれば Float を使う', () => {
    const iv = makeIntervals();
    const both = floatAnalyser(0.1);
    both.byteReads = 0;
    both.getByteTimeDomainData = function (buf) { both.byteReads++; buf.fill(0); };
    const got = [];
    const stop = startMeters({ micAnalyser: both }, function (lv) { got.push(lv); }, { hidden: false }, iv);
    iv.advance(100);
    stop();
    assert.deepStrictEqual(got, [{ mic: 0.67, pc: null }]);
    assert.equal(both.byteReads, 0);
});

test('startMeters: 波形が読めなかったら 0。onLevels が例外でも次の回は動く', () => {
    const iv = makeIntervals();
    const broken = { fftSize: 1024, getFloatTimeDomainData: function () { throw new Error('読めない'); } };
    const got = [];
    let n = 0;
    const errors = quietErrors(function () {
        const stop = startMeters({ micAnalyser: broken }, function (lv) {
            n++;
            got.push(lv);
            if (n === 1) throw new Error('app のバグ');
        }, { hidden: false }, iv);
        iv.advance(300);
        stop();
    });
    assert.equal(n, 3);
    assert.deepStrictEqual(got[2], { mic: 0, pc: null });
    assert.equal(errors, 1);
});

test('startMeters: doc を省略しても動く（Node には document が無い）', () => {
    const iv = makeIntervals();
    const got = [];
    const stop = startMeters({ micAnalyser: floatAnalyser(0.1) }, function (lv) { got.push(lv); }, undefined, iv);
    iv.advance(200);
    stop();
    assert.equal(got.length, 2);
});

test('startMeters: timers を省略したら本物の setInterval で動き、止めたら止まる', async () => {
    const got = [];
    const stop = startMeters({ micAnalyser: floatAnalyser(0.1) }, function (lv) { got.push(lv); }, { hidden: false });
    await new Promise(function (r) { setTimeout(r, 350); });
    stop();
    const n = got.length;
    assert.ok(n >= 1 && n <= 4, String(n));
    await new Promise(function (r) { setTimeout(r, 250); });
    assert.equal(got.length, n);
});

// ---- stopCapture ----

test('stopCapture: 全トラック（srTrack も）→ メーター → AudioContext の順に片付ける', () => {
    const order = [];
    const onStop = function (t) { order.push(t.kind); };
    const mic = new FakeMediaStream([new FakeTrack('audio', { onStop: onStop })]);
    const pc = new FakeMediaStream([new FakeTrack('video', { onStop: onStop }), new FakeTrack('audio', { onStop: onStop })]);
    const rec = new FakeMediaStream([new FakeTrack('audio', { onStop: onStop })]);
    const sr = new FakeTrack('sr', { onStop: onStop });
    const { ctx } = makeCtx();
    const origClose = ctx.close;
    ctx.close = function () { order.push('close'); return origClose.call(this); };
    stopCapture({ streams: [mic, pc, rec], srTrack: sr, stopMeters: function () { order.push('meters'); }, ctx: ctx });
    assert.deepStrictEqual(order, ['audio', 'video', 'audio', 'audio', 'sr', 'meters', 'close']);
    assert.equal(ctx.state, 'closed');
});

test('stopCapture: 同じトラックが複数の stream（や srTrack）に入っていても、止めるのは1回', () => {
    const shared = new FakeTrack('audio');
    const video = new FakeTrack('video');
    const s1 = new FakeMediaStream([shared]);
    const s2 = new FakeMediaStream([video, shared]);
    stopCapture({ streams: [s1, s2, s1], srTrack: shared });
    assert.equal(shared.stopCount, 1);
    assert.equal(video.stopCount, 1);
});

test('stopCapture: トラックの stop が例外でも、残りのトラック・srTrack・メーター・ctx.close までやり切る', () => {
    const a = new FakeTrack('audio', { throwOnStop: true });
    const b = new FakeTrack('video', { throwOnStop: true });
    const c = new FakeTrack('audio');
    const sr = new FakeTrack('audio', { throwOnStop: true });
    const broken = { getTracks: function () { throw new Error('x'); } };
    let metersStopped = 0;
    const { ctx } = makeCtx();
    assert.doesNotThrow(function () {
        stopCapture({
            streams: [new FakeMediaStream([a, b]), broken, null, new FakeMediaStream([c])],
            srTrack: sr,
            stopMeters: function () { metersStopped++; },
            ctx: ctx,
        });
    });
    assert.equal(a.stopCount, 1);
    assert.equal(b.stopCount, 1);
    assert.equal(c.stopCount, 1);
    assert.equal(sr.stopCount, 1);
    assert.equal(metersStopped, 1);
    assert.equal(ctx.closeCount, 1);
});

test('stopCapture: メーターを止めるのが例外でも ctx は閉じる', () => {
    const { ctx } = makeCtx();
    assert.doesNotThrow(function () {
        stopCapture({ streams: [], stopMeters: function () { throw new Error('x'); }, ctx: ctx });
    });
    assert.equal(ctx.closeCount, 1);
});

test('stopCapture: ctx.close() が reject しても・例外でも外に出さない', async () => {
    const unhandled = [];
    const onUnhandled = function (e) { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
        const rejects = { state: 'running', close: function () { return Promise.reject(new Error('閉じられない')); } };
        const throws = { state: 'running', close: function () { throw new Error('閉じられない'); } };
        assert.doesNotThrow(function () { stopCapture({ streams: [], ctx: rejects }); });
        assert.doesNotThrow(function () { stopCapture({ streams: [], ctx: throws }); });
        await flush();
        await flush();
        assert.deepStrictEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('stopCapture: 2回呼んでも安全（閉じ済みの ctx は閉じ直さない）。引数なし・空でもよい', () => {
    const t = new FakeTrack('audio');
    const { ctx } = makeCtx();
    const parts = { streams: [new FakeMediaStream([t])], srTrack: new FakeTrack('audio'), stopMeters: function () {}, ctx: ctx };
    stopCapture(parts);
    assert.doesNotThrow(function () { stopCapture(parts); });
    assert.equal(ctx.closeCount, 1);
    assert.equal(t.readyState, 'ended');
    assert.doesNotThrow(function () { stopCapture(); });
    assert.doesNotThrow(function () { stopCapture({}); });
    assert.doesNotThrow(function () { stopCapture({ streams: null, srTrack: null, stopMeters: null, ctx: null }); });
});

test('通しで：マイク＋PC を組んでメーターを動かし、stopCapture で全トラック（映像・srTrack も）が止まる', () => {
    const { ctx, log } = makeCtx();
    const mic = micStreamOf();
    const pc = pcStreamOf(true);
    const g = buildGraph(ctx, { micStream: mic, pcStream: pc });
    const iv = makeIntervals();
    const stopMeters = startMeters(g, function () {}, { hidden: false }, iv);
    stopCapture({ streams: [mic, pc, g.recordStream], srTrack: g.srTrack, stopMeters: stopMeters, ctx: ctx });
    const all = [].concat(mic.getTracks(), pc.getTracks(), g.recordStream.getTracks(), [g.srTrack]);
    assert.equal(all.length, 5);
    for (const tr of all) assert.equal(tr.readyState, 'ended', tr.id);
    assert.equal(iv.count(), 0);
    assert.equal(ctx.state, 'closed');
    assert.equal(log.dests.length, 1);
});
