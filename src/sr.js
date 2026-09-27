// 端末内の文字起こし — 音声認識をこの端末の中だけで動かす（クラウドの音声認識は使わない）
// 使えるかどうかはブラウザの名前では決めず、毎回 available() に聞く。端末内で動かせない条件なら、認識オブジェクトを作らない。
// 画面（DOM）は触らない。知らせは onNotice('stopped') の1種類だけで app.js に渡し、文言は app.js が出す。

// available() と install() に渡す共通のオプション（日本語・端末内処理）。途中で書き換えられないよう凍らせる
const OPTS = Object.freeze({ langs: Object.freeze(['ja-JP']), processLocally: true });

// available() の答えのうち、そのまま返してよいもの（これ以外は 'unavailable' にする）
const AVAILABILITY_VALUES = ['available', 'downloadable', 'downloading', 'unavailable'];

// 失敗に数えないエラー（無音の会議や、作り直しの途中で出る）
const QUIET_ERRORS = ['no-speech', 'aborted'];
// 出たらすぐ止めるエラー（作り直しても直らない）
const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'];

// 1回の認識が終わってから作り直すまでの待ち。ふだんは 300ms。
// 開始から2秒未満・結果なしで終わる回が続くと、1秒 → 3秒 → 10秒 と延ばす（以後は10秒のまま）
const RESTART_DELAYS_MS = [300, 1000, 3000, 10000];
const QUICK_END_MS = 2000;      // これより早く、結果なしで終わった回は「短く終わった回」
const STOP_TIMEOUT_MS = 10000;  // stop() から、これだけ待っても end が来なければ打ち切る
const MAX_CONSECUTIVE = 5;      // 連続の失敗がこの数になったら止める
const WINDOW_MS = 60000;        // 直近60秒のあいだに
const MAX_IN_WINDOW = 10;       // この数の失敗があったら止める

// ブラウザの音声認識のクラス（標準の名前 → 接頭辞つきの名前の順）。無ければ undefined。
// win を省略したら window を見る（Node で import しても困らないよう、呼ばれたときに初めて見る）
export function getSR(win) {
    const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : undefined);
    if (!w) return undefined;
    return w.SpeechRecognition || w.webkitSpeechRecognition || undefined;
}

// 第0章 A の条件1と2：available() があり、端末内処理（processLocally）を持つクラスか
function hasLocalApi(SR) {
    if (!SR || typeof SR.available !== 'function') return false;
    const proto = SR.prototype;
    if (!proto || (typeof proto !== 'object' && typeof proto !== 'function')) return false;
    return 'processLocally' in proto;
}

// 端末内で文字起こしができるか → 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api'
// available() が無い・processLocally が無い（古いブラウザ）→ 'no-api'。
// あれば、日本語・端末内処理で available() に聞いた答えを返す。例外や想定外の答えは 'unavailable'（使わない側に倒す）
export async function checkAvailability(SR = getSR()) {
    try {
        if (!hasLocalApi(SR)) return 'no-api';
        const answer = await SR.available(OPTS);
        return AVAILABILITY_VALUES.indexOf(answer) !== -1 ? answer : 'unavailable';
    } catch (e) {
        return 'unavailable';
    }
}

// 端末内の音声認識に、日本語のデータを入れる（初回だけ。取ってくるのはブラウザ）→ 入ったら true
// ユーザーのタップの直後でないと断られるため、await を挟まずに、呼ばれたその場で install() を呼ぶ。
// true で終わったときだけ true。それ以外の答え・失敗・例外・install() が無い → false
export function installLanguagePack(SR = getSR()) {
    let pending;
    try {
        if (!SR || typeof SR.install !== 'function') return Promise.resolve(false);
        pending = SR.install(OPTS);
    } catch (e) {
        return Promise.resolve(false);
    }
    return Promise.resolve(pending).then(
        function (ok) { return ok === true; },
        function () { return false; }
    );
}

// 認識オブジェクトを作る、ただ1つの場所。端末内で動かせない条件なら、作らずに null（fail-closed）。
// 条件は checkAvailability と同じ3つ（available() が無い／processLocally が無い／答えが 'available' でない）。
// 作ったら processLocally=true を必ず入れ、読み返して true でなければ使わない（クラウドに流れるのを防ぐ）。
export async function createLocalRecognizer(SR = getSR()) {
    if ((await checkAvailability(SR)) !== 'available') return null;
    let rec;
    try {
        rec = new SR();
        rec.lang = 'ja-JP';
        rec.processLocally = true;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        if (rec.processLocally !== true) return null;
    } catch (e) {
        return null;
    }
    return rec;
}

// 文字起こしを始める → { stop(), isRunning() }
// opts：track（文字起こしに渡す音。録音している音の複製）、onFinal(確定した文字)、onInterim(途中の文字)、
//       onNotice('stopped')、SR（テスト用の差し替え。省略したら getSR()）
// deps（省略可・テスト用）：{ setTimeout, clearTimeout, now }。省略したら本物のタイマーと Date.now
//
// 認識は1回ずつ終わるので、終わるたびに作り直す。最初も作り直しも毎回 createLocalRecognizer を通す
// （＝毎回 available() を確かめ直し、端末内で動かせなくなっていたら止める）。
// 1回が終わるたびに、残った途中の文字を確定（onFinal）にしてから作り直す（作り直すと、途中の文字は確定にならずに消えるため）。
// 失敗が続いたら（連続5回、または直近60秒に10回）止めて onNotice('stopped')。録音は app.js が続ける。
export function startTranscriber(opts, deps) {
    const o = opts || {};
    const d = deps || {};
    let stopped = false;          // stop() されたか、自分で止まった（以後は作り直さない・知らせない）
    let session = null;           // いま動いている1回ぶんの認識（end が来るか、打ち切るまで）
    let restartTimer = null;      // 作り直しの予約
    let stopTimer = null;         // stop() から10秒の打ち切りの予約
    let consecutive = 0;          // 連続の失敗の数（文字が確定したら0に戻す）
    let failTimes = [];           // 失敗した時刻（直近60秒ぶんだけ残す）
    let shortStreak = 0;          // 開始から2秒未満・結果なしで終わった回が、いくつ続いているか
    let finished = false;         // 締め終わったか（onInterim('') と resolve が済んだ）
    let resolveDone = null;
    // stop() が返す Promise（1つだけ作る。必ず resolve し、reject しない）
    const done = new Promise(function (resolve) { resolveDone = resolve; });

    // 時計とタイマー（差し替えが無ければ本物）。本物は window のメソッドなので、そのまま関数として呼ぶ
    function now() {
        return d.now ? d.now() : Date.now();
    }
    function later(fn, ms) {
        return d.setTimeout ? d.setTimeout(fn, ms) : setTimeout(fn, ms);
    }
    function cancel(id) {
        if (id === null) return;
        if (d.clearTimeout) d.clearTimeout(id);
        else clearTimeout(id);
    }
    function clearRestart() {
        cancel(restartTimer);
        restartTimer = null;
    }

    // app.js から渡された関数を呼ぶ（無ければ何もしない。app 側の例外で文字起こしの状態を壊さない）
    function call(fn, arg) {
        if (typeof fn !== 'function') return;
        try {
            fn(arg);
        } catch (e) {
            console.error(e);
        }
    }

    // 失敗を1回数える
    function countFailure() {
        consecutive++;
        failTimes.push(now());
    }

    // 上限に達したか（連続5回、または直近60秒に10回）。60秒より前の記録は、ここで捨てる
    function overLimit() {
        const t = now();
        failTimes = failTimes.filter(function (x) { return t - x < WINDOW_MS; });
        return consecutive >= MAX_CONSECUTIVE || failTimes.length >= MAX_IN_WINDOW;
    }

    // 1回ぶんの認識を閉じる：以後その回のイベントは捨てる。残った途中の文字があれば、trim して確定（onFinal）にする。
    // 先に閉じた印を付けてから onFinal を呼ぶ（onFinal の中で stop() されても、この回を二重に締めないように）
    function closeSession(s) {
        if (s.closed) return;
        s.closed = true;
        if (session === s) session = null;
        const t = s.pending.trim();
        s.pending = '';
        if (t) {
            consecutive = 0;
            call(o.onFinal, t);
        }
    }

    // 締める：途中の表示を消し（onInterim('')）、stop() の Promise を resolve する（1回だけ）
    function finish() {
        if (finished) return;
        finished = true;
        cancel(stopTimer);
        stopTimer = null;
        call(o.onInterim, '');
        resolveDone();
    }

    // 自分で止まる（上限・すぐ止めるエラー・start の例外・端末内で動かせなくなった・track が無い）。
    // 動いている回は abort して、残った途中の文字を確定にしてから締め、最後に onNotice('stopped')。
    // 先に止めた印を付けてから知らせる（知らせを受けた app.js が stop() を呼んでも二重に動かないように）
    function halt() {
        if (stopped) return;
        stopped = true;
        clearRestart();
        const s = session;
        if (s) {
            try { s.r.abort(); } catch (e) { /* もう止まっていてもよい */ }
            closeSession(s);
        }
        finish();
        call(o.onNotice, 'stopped');
    }

    // 1回の認識が終わったあと（止めていないとき）：上限なら止める。まだなら待ってから作り直す。
    // 待ちは、短く終わった回が続いた数で決める（1回目まで 300ms、2回目 1秒、3回目 3秒、4回目から 10秒）。
    // 作り直しの予約は、end の処理の中のここで1本だけ置く（タイマーの中からタイマーを置く連鎖にしない。
    // 画面が隠れたときに Chrome が連鎖したタイマーを間引くのを避けるため）
    function afterEnd() {
        if (stopped) return;
        if (overLimit()) {
            halt();
            return;
        }
        const i = Math.min(Math.max(shortStreak - 1, 0), RESTART_DELAYS_MS.length - 1);
        restartTimer = later(function () {
            restartTimer = null;
            launch();
        }, RESTART_DELAYS_MS[i]);
    }

    // 認識オブジェクト1つぶんを動かす。受け付けるのは、閉じていない回のイベントだけ（古い回・打ち切った回のものは捨てる）。
    // stop() のあとも、end が来るまでは結果を受け取る（止めたときの最後の文が、あとから届くため）。
    // イベントの受け口を付けてから start する（start の直後に来るイベントを取りこぼさないように）
    function run(r) {
        const s = {
            r: r,
            pending: '',        // 最後の結果の、まだ確定していない部分（締めるときに確定にする）
            gotResult: false,   // 結果（途中のものも）が1回でも来たか
            anyError: false,    // エラー（数えないものも）が出たか
            counted: false,     // この回の失敗をもう数えたか（1回の認識につき最大1回）
            closed: false,      // この回はもう閉じたか
            startedAt: 0,
        };
        session = s;

        // 結果：resultIndex から後ろだけを見る。確定したものは trim して1つずつ onFinal（空なら呼ばない）。
        // 途中のものはつないで onInterim（無ければ '' で、画面の途中の文字を消してもらう）
        r.onresult = function (event) {
            if (s.closed) return;
            s.gotResult = true;
            const results = event && event.results;
            const from = event && typeof event.resultIndex === 'number' ? event.resultIndex : 0;
            let interim = '';
            for (let i = from; results && i < results.length; i++) {
                const res = results[i];
                const alt = res && res[0];
                const text = alt && typeof alt.transcript === 'string' ? alt.transcript : '';
                if (res && res.isFinal) {
                    const t = text.trim();
                    if (!t) continue;
                    consecutive = 0;
                    call(o.onFinal, t);
                } else {
                    interim += text;
                }
            }
            if (s.closed) return;
            s.pending = interim;
            call(o.onInterim, interim);
        };

        // エラー：stop() のあとは何もしない（end か10秒を待つ）。no-speech／aborted は数えない。
        // 4種はすぐ止める。それ以外は、この回の失敗として1回だけ数える
        r.onerror = function (event) {
            if (s.closed || stopped) return;
            s.anyError = true;
            const code = event && event.error;
            if (QUIET_ERRORS.indexOf(code) !== -1) return;
            if (FATAL_ERRORS.indexOf(code) !== -1) {
                halt();
                return;
            }
            if (!s.counted) {
                s.counted = true;
                countFailure();
            }
        };

        // 終わり：残った途中の文字を確定にする。stop() のあとなら、ここで締める。
        // 止めていなければ、この回を見てから作り直しへ：
        //   2秒未満・結果なし → 「短く終わった回」（待ちを延ばす。エラーの種類は問わない）
        //   そのうちエラーが1つも無かった回 → 失敗1回（エラーのあった回は onerror で数えてある）
        r.onend = function () {
            if (s.closed) return;
            const short = !s.gotResult && now() - s.startedAt < QUICK_END_MS;
            closeSession(s);
            if (stopped) {
                finish();
                return;
            }
            if (short && !s.anyError) countFailure();
            shortStreak = short ? shortStreak + 1 : 0;
            call(o.onInterim, '');
            afterEnd();
        };

        s.startedAt = now();
        try {
            r.start(o.track);
        } catch (e) {
            // track で始められない。引数なしの start() は実測で文字が0件だったので使わず、文字起こしを止める（録音は続く）
            halt();
        }
    }

    // 認識オブジェクトを作って始める（最初も作り直しも、ここを通る）。
    // 作るあいだ（available() の答え待ち）に stop() されたら、作れても始めない。
    // 渡す音（track）が無ければ作らずに止まる。そのときも必ず await を1回挟む（呼んだ側が戻り値を受け取ってから知らせるため）
    async function launch() {
        let r = null;
        try {
            r = await (o.track ? createLocalRecognizer(o.SR) : null);
        } catch (e) {
            r = null;
        }
        if (stopped) return;
        if (!r) {
            halt();
            return;
        }
        try {
            run(r);
        } catch (e) {
            halt();
        }
    }

    // 止める（録音を止めるとき app.js が呼ぶ）→ Promise（必ず resolve。2回呼んでも同じ Promise）。
    // 以後は作り直さず、知らせも出さない。rec.stop() のあとも end が来るまでは結果を受け取る（最後の文が届くため）。
    // end が来るか10秒たったら、残った途中の文字を確定にし、onInterim('') を呼んで resolve する。
    // 10秒で打ち切るときは rec.abort() を呼び、以後のイベントは捨てる。動いている回が無ければ、すぐ締める
    function stop() {
        if (stopped) return done;
        stopped = true;
        clearRestart();
        const s = session;
        if (!s) {
            finish();
            return done;
        }
        try { s.r.stop(); } catch (e) { /* もう止まっていてもよい。end か10秒を待つ */ }
        if (!s.closed) {
            stopTimer = later(function () {
                stopTimer = null;
                if (s.closed) return;
                try { s.r.abort(); } catch (e) { /* 捨てるだけ */ }
                closeSession(s);
                finish();
            }, STOP_TIMEOUT_MS);
        }
        return done;
    }

    launch();
    return {
        stop: stop,
        isRunning: function () { return !stopped; },
    };
}
