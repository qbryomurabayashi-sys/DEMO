// sr.js の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
// ブラウザの音声認識は Node に無いので、偽物のクラス（FakeSR）と、手で進める時計（makeClock）で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getSR,
    checkAvailability,
    installLanguagePack,
    createLocalRecognizer,
    startTranscriber,
} from '../src/sr.js';

const OPTS = { langs: ['ja-JP'], processLocally: true };
const FATAL = ['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'];

// ---- 偽物 ----

// 偽の音声認識クラスを作る。
// answer：available() の答え（関数なら呼ぶたびにその戻り値。Promise を返してもよい）
// onStart(inst, args)：start が呼ばれたときの動き（例外を投げると start の例外になる）
function makeFakeSR(options) {
    const opt = options || {};
    const log = { made: 0, ctorArgs: [], instances: [], availableArgs: [], installArgs: [] };
    class FakeSR {
        constructor(...args) {
            log.made++;
            log.ctorArgs.push(args);
            this.startArgs = [];
            this.stopCount = 0;
            this.onresult = null;
            this.onerror = null;
            this.onend = null;
            log.instances.push(this);
        }
        get processLocally() {
            return this._local;
        }
        set processLocally(v) {
            this._local = opt.ignoreLocal ? undefined : v;
        }
        start(...args) {
            this.startArgs.push(args);
            if (opt.onStart) opt.onStart(this, args);
        }
        stop() {
            this.stopCount++;
        }
        abort() {
            this.abortCount = (this.abortCount || 0) + 1;
        }
        static available(arg) {
            log.availableArgs.push(arg);
            const a = typeof opt.answer === 'function' ? opt.answer() : (opt.answer === undefined ? 'available' : opt.answer);
            return Promise.resolve(a);
        }
    }
    return { SR: FakeSR, log: log, last: function () { return log.instances[log.instances.length - 1]; } };
}

// 待ちの Promise をすべて進める（偽の available() は Promise.resolve なので、これで答えが届く）
function flush() {
    return new Promise(function (resolve) { setImmediate(resolve); });
}

// 手で進める時計。setTimeout／clearTimeout／now を差し替えて渡す
function makeClock() {
    let t = 1000000;
    let seq = 0;
    const timers = new Map();
    return {
        now: function () { return t; },
        setTimeout: function (fn, ms) {
            seq++;
            timers.set(seq, { at: t + ms, fn: fn, ms: ms });
            return seq;
        },
        clearTimeout: function (id) { timers.delete(id); },
        pending: function () { return timers.size; },
        delays: function () { return Array.from(timers.values()).map(function (x) { return x.ms; }); },
        // ms だけ進める。途中で時刻が来たタイマーは、時刻の順に動かす
        advance: async function (ms) {
            const end = t + ms;
            for (;;) {
                let nextId = null;
                let next = null;
                for (const [id, tm] of timers) {
                    if (tm.at <= end && (next === null || tm.at < next.at)) {
                        next = tm;
                        nextId = id;
                    }
                }
                if (next === null) break;
                timers.delete(nextId);
                t = next.at;
                next.fn();
                await flush();
            }
            t = end;
            await flush();
        },
    };
}

// 認識の結果のイベント。items：[{ text, final }]
function resultEvent(resultIndex, items) {
    const results = items.map(function (it) {
        const r = [{ transcript: it.text }];
        r.isFinal = !!it.final;
        return r;
    });
    return { resultIndex: resultIndex, results: results };
}

// 外から操作できる Promise
function deferred() {
    let resolve;
    const promise = new Promise(function (r) { resolve = r; });
    return { promise: promise, resolve: resolve };
}

// p がもう resolve したか（待ちの処理を進めてから見る）。
// await p と書くと、壊れていて resolve しないときにテストが止まったままになるので、こちらで確かめる
async function settled(p) {
    let done = false;
    p.then(function () { done = true; }, function () { done = 'rejected'; });
    await flush();
    return done;
}

// 文字起こしを始めて、最初の認識が start するところまで進める
async function begin(fake, extra) {
    const clock = makeClock();
    // log：3種の呼ばれ方を、呼ばれた順に1列で（'F:文字'＝確定、'I:文字'＝途中、'N:種類'＝知らせ）
    const got = { finals: [], interims: [], notices: [], log: [] };
    const track = { kind: 'audio', id: 'mix-track' };
    const opts = Object.assign({
        track: track,
        onFinal: function (s) { got.finals.push(s); got.log.push('F:' + s); },
        onInterim: function (s) { got.interims.push(s); got.log.push('I:' + s); },
        onNotice: function (s) { got.notices.push(s); got.log.push('N:' + s); },
        SR: fake.SR,
    }, extra || {});
    const tr = startTranscriber(opts, clock);
    await flush();
    return { tr: tr, clock: clock, got: got, track: track };
}

// 作り直しの予約（待ち）が来るところまで時計を進める（予約が無ければ進めない）。
// 短く終わる回が続くと待ちが延びる（300ms → 1秒 → 3秒 → 10秒）ので、決め打ちの 300ms では進めない
async function toRestart(h) {
    const ds = h.clock.delays();
    await h.clock.advance(ds.length ? Math.max.apply(null, ds) : 0);
}

// 失敗1回ぶん：network エラー → 終わり → 作り直しまで
async function failByError(fake, h) {
    const r = fake.last();
    r.onerror({ error: 'network' });
    r.onend();
    await toRestart(h);
}

// 失敗1回ぶん：すぐ（2秒未満）結果なしで終わる → 作り直しまで
async function failByQuickEnd(fake, h) {
    fake.last().onend();
    await toRestart(h);
}

// 成功1回ぶん：確定の結果が来てから終わる → 作り直しまで
async function succeed(fake, h, text) {
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: text || 'はい', final: true }]));
    r.onend();
    await toRestart(h);
}

// ---- getSR ----

test('getSR: 標準の名前を先に、無ければ接頭辞つき、どちらも無ければ undefined', () => {
    const A = function A() {};
    const B = function B() {};
    assert.equal(getSR({ SpeechRecognition: A, webkitSpeechRecognition: B }), A);
    assert.equal(getSR({ webkitSpeechRecognition: B }), B);
    assert.equal(getSR({}), undefined);
    assert.equal(getSR(null), undefined);
});

test('getSR: 引数なし（Node には window が無い）でも例外にならず undefined', () => {
    assert.equal(getSR(), undefined);
});

// ---- checkAvailability ----

test('checkAvailability: available が無い → no-api', async () => {
    assert.equal(await checkAvailability(undefined), 'no-api');
    assert.equal(await checkAvailability(null), 'no-api');
    assert.equal(await checkAvailability({}), 'no-api');
    const fake = makeFakeSR();
    delete fake.SR.available;
    assert.equal(await checkAvailability(fake.SR), 'no-api');
    const notFn = makeFakeSR();
    Object.defineProperty(notFn.SR, 'available', { value: 'available' });
    assert.equal(await checkAvailability(notFn.SR), 'no-api');
});

test('checkAvailability: processLocally が prototype に無い → no-api（available は呼ばない）', async () => {
    const fake = makeFakeSR();
    delete fake.SR.prototype.processLocally;
    assert.equal('processLocally' in fake.SR.prototype, false);
    assert.equal(await checkAvailability(fake.SR), 'no-api');
    assert.equal(fake.log.availableArgs.length, 0);
});

test('checkAvailability: 4つの答えはそのまま返る', async () => {
    for (const v of ['available', 'downloadable', 'downloading', 'unavailable']) {
        assert.equal(await checkAvailability(makeFakeSR({ answer: v }).SR), v);
    }
});

test('checkAvailability: 想定外の答えは unavailable', async () => {
    for (const v of ['yes', 'AVAILABLE', '', true, 1, null, {}, ['available']]) {
        assert.equal(await checkAvailability(makeFakeSR({ answer: v }).SR), 'unavailable', String(v));
    }
    // undefined の答え（answer を関数にして undefined を返す）
    assert.equal(await checkAvailability(makeFakeSR({ answer: function () { return undefined; } }).SR), 'unavailable');
});

test('checkAvailability: available が例外・reject なら unavailable', async () => {
    const throws = makeFakeSR();
    throws.SR.available = function () { throw new Error('boom'); };
    assert.equal(await checkAvailability(throws.SR), 'unavailable');
    const rejects = makeFakeSR();
    rejects.SR.available = function () { return Promise.reject(new Error('boom')); };
    assert.equal(await checkAvailability(rejects.SR), 'unavailable');
});

test('checkAvailability: available には { langs:[ja-JP], processLocally:true } を渡す', async () => {
    const fake = makeFakeSR();
    await checkAvailability(fake.SR);
    assert.equal(fake.log.availableArgs.length, 1);
    assert.deepStrictEqual(fake.log.availableArgs[0], OPTS);
});

test('checkAvailability: 引数なし（Node）でも例外にならず no-api', async () => {
    assert.equal(await checkAvailability(), 'no-api');
});

// ---- installLanguagePack ----

// install の偽物を付けた SR を作る。impl：install の中身
function withInstall(impl) {
    const fake = makeFakeSR();
    fake.SR.install = function (arg) {
        fake.log.installArgs.push(arg);
        return impl();
    };
    return fake;
}

test('installLanguagePack: 呼んだ直後（await の前）に install が呼ばれ、引数は共通のオプション', async () => {
    const fake = withInstall(function () { return Promise.resolve(true); });
    const p = installLanguagePack(fake.SR);
    assert.equal(fake.log.installArgs.length, 1);
    assert.deepStrictEqual(fake.log.installArgs[0], OPTS);
    assert.ok(p instanceof Promise);
    assert.equal(await p, true);
});

test('installLanguagePack: true で解決したときだけ true', async () => {
    assert.equal(await installLanguagePack(withInstall(function () { return Promise.resolve(true); }).SR), true);
    assert.equal(await installLanguagePack(withInstall(function () { return Promise.resolve(false); }).SR), false);
    for (const v of ['true', 1, undefined, null, {}]) {
        assert.equal(await installLanguagePack(withInstall(function () { return Promise.resolve(v); }).SR), false, String(v));
    }
});

test('installLanguagePack: reject・同期の例外・install が無い → false（例外は外に出さない）', async () => {
    assert.equal(await installLanguagePack(withInstall(function () { return Promise.reject(new Error('x')); }).SR), false);
    let p;
    assert.doesNotThrow(function () {
        p = installLanguagePack(withInstall(function () { throw new Error('sync'); }).SR);
    });
    assert.ok(p instanceof Promise);
    assert.equal(await p, false);
    const noInstall = makeFakeSR();
    assert.equal(await installLanguagePack(noInstall.SR), false);
    assert.equal(await installLanguagePack(null), false);
    assert.equal(await installLanguagePack(), false);
});

// ---- createLocalRecognizer ----

test('createLocalRecognizer: 3条件のどれかに当たれば null で、コンストラクタは1回も呼ばない', async () => {
    // 1. available が無い
    const noAvail = makeFakeSR();
    delete noAvail.SR.available;
    assert.equal(await createLocalRecognizer(noAvail.SR), null);
    assert.equal(noAvail.log.made, 0);
    // 2. processLocally が prototype に無い
    const noLocal = makeFakeSR();
    delete noLocal.SR.prototype.processLocally;
    assert.equal(await createLocalRecognizer(noLocal.SR), null);
    assert.equal(noLocal.log.made, 0);
    // 3. 答えが 'available' でない（想定外の答え・reject も）
    for (const v of ['downloadable', 'downloading', 'unavailable', 'yes', undefined]) {
        const f = makeFakeSR({ answer: function () { return v; } });
        assert.equal(await createLocalRecognizer(f.SR), null, String(v));
        assert.equal(f.log.made, 0, String(v));
    }
    const rejects = makeFakeSR();
    rejects.SR.available = function () { return Promise.reject(new Error('x')); };
    assert.equal(await createLocalRecognizer(rejects.SR), null);
    assert.equal(rejects.log.made, 0);
    // SR そのものが無い
    assert.equal(await createLocalRecognizer(null), null);
    assert.equal(await createLocalRecognizer(), null);
});

test('createLocalRecognizer: 作ったときの設定値（引数なしで1回だけ作る）', async () => {
    const fake = makeFakeSR();
    const rec = await createLocalRecognizer(fake.SR);
    assert.ok(rec);
    assert.equal(fake.log.made, 1);
    assert.equal(fake.log.ctorArgs[0].length, 0);
    assert.equal(rec.lang, 'ja-JP');
    assert.equal(rec.processLocally, true);
    assert.equal(rec.continuous, true);
    assert.equal(rec.interimResults, true);
    assert.equal(rec.maxAlternatives, 1);
    assert.deepStrictEqual(fake.log.availableArgs, [OPTS]);
});

test('createLocalRecognizer: processLocally を読み返して true でなければ使わない', async () => {
    const fake = makeFakeSR({ ignoreLocal: true });
    assert.equal(await createLocalRecognizer(fake.SR), null);
});

test('createLocalRecognizer: コンストラクタが例外なら null', async () => {
    const fake = makeFakeSR();
    const Broken = function () { throw new Error('no'); };
    Broken.available = fake.SR.available;
    Broken.prototype = fake.SR.prototype;
    assert.equal(await createLocalRecognizer(Broken), null);
});

// ---- startTranscriber：始め方 ----

test('startTranscriber: start(track) に track が渡り、知らせは出ない', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    assert.equal(fake.log.made, 1);
    assert.deepStrictEqual(fake.last().startArgs, [[h.track]]);
    assert.equal(h.tr.isRunning(), true);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: start は毎回 track を1つだけ渡して呼ぶ（引数なしの start() は使わない）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 3; i++) await succeed(fake, h);
    await failByError(fake, h);
    await failByQuickEnd(fake, h);
    assert.equal(fake.log.made, 6);
    for (const inst of fake.log.instances) assert.deepStrictEqual(inst.startArgs, [[h.track]]);
});

test('startTranscriber: start(track) が例外なら、start() には切り替えずに止まって stopped（作り直さない）', async () => {
    const fake = makeFakeSR({ onStart: function () { throw new TypeError('track は使えない'); } });
    const h = await begin(fake);
    assert.deepStrictEqual(fake.last().startArgs, [[h.track]]);
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.log, ['I:', 'N:stopped']);
    await h.clock.advance(60000);
    assert.equal(fake.log.made, 1);
    assert.deepStrictEqual(fake.last().startArgs, [[h.track]]);
    // stop() は締め済みの Promise を返す（知らせは増えない）
    assert.equal(await settled(h.tr.stop()), true);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
});

test('startTranscriber: track が無ければ認識を作らずに止まり、stopped（戻り値を受け取ってから知らせる）', async () => {
    for (const track of [null, undefined]) {
        const fake = makeFakeSR();
        const notices = [];
        const tr = startTranscriber({ track: track, onNotice: function (s) { notices.push(s); }, SR: fake.SR }, makeClock());
        assert.deepStrictEqual(notices, []);   // その場では知らせない
        await flush();
        assert.deepStrictEqual(notices, ['stopped']);
        assert.equal(fake.log.made, 0);
        assert.equal(fake.log.availableArgs.length, 0);
        assert.equal(tr.isRunning(), false);
    }
});

test('startTranscriber: 最初から端末内で動かせない（unavailable）なら作らずに止まって stopped', async () => {
    const fake = makeFakeSR({ answer: 'unavailable' });
    const h = await begin(fake);
    assert.equal(fake.log.made, 0);
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
});

// ---- startTranscriber：結果の読み方 ----

test('startTranscriber: resultIndex から読み、確定は trim して1つずつ、空は渡さない。途中はつなぐ', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: 'えー', final: false }, { text: 'と明日', final: false }]));
    assert.deepStrictEqual(h.got.interims, ['えーと明日']);
    // resultIndex=1 → 0番目（前に確定済み）は見ない
    r.onresult(resultEvent(1, [
        { text: '読まない', final: true },
        { text: '  明日の件です  ', final: true },
        { text: '   ', final: true },
        { text: '次は', final: false },
        { text: 'です', final: false },
    ]));
    assert.deepStrictEqual(h.got.finals, ['明日の件です']);
    assert.deepStrictEqual(h.got.interims, ['えーと明日', '次はです']);
    // 確定だけのときは onInterim('')（画面の途中の文字を消してもらう）
    r.onresult(resultEvent(0, [{ text: 'はい', final: true }]));
    assert.deepStrictEqual(h.got.finals, ['明日の件です', 'はい']);
    assert.equal(h.got.interims[h.got.interims.length - 1], '');
});

test('startTranscriber: onFinal が例外を投げても、そのあとの結果は受け取れる', async () => {
    const fake = makeFakeSR();
    const finals = [];
    const origError = console.error;
    console.error = function () {};
    try {
        const h = await begin(fake, {
            onFinal: function (s) { finals.push(s); if (s === '1') throw new Error('app のバグ'); },
        });
        fake.last().onresult(resultEvent(0, [{ text: '1', final: true }, { text: '2', final: true }]));
        assert.deepStrictEqual(finals, ['1', '2']);
        assert.equal(h.tr.isRunning(), true);
    } finally {
        console.error = origError;
    }
});

// ---- startTranscriber：失敗の数え方と上限 ----

test('startTranscriber: no-speech と aborted は数えない（すぐ終わっても、20回続いても止めない）', async () => {
    for (const code of ['no-speech', 'aborted']) {
        const fake = makeFakeSR();
        const h = await begin(fake);
        for (let i = 0; i < 20; i++) {
            const r = fake.last();
            r.onerror({ error: code });
            r.onend();
            await toRestart(h);
        }
        assert.equal(h.tr.isRunning(), true, code);
        assert.equal(fake.log.made, 21, code);
        assert.deepStrictEqual(h.got.notices, [], code);
    }
});

test('startTranscriber: not-allowed など4種は即停止（作り直さない）。残った途中の文字を確定にしてから stopped', async () => {
    for (const code of FATAL) {
        const fake = makeFakeSR();
        const h = await begin(fake);
        const r = fake.last();
        r.onresult(resultEvent(0, [{ text: '言いかけ', final: false }]));
        r.onerror({ error: code });
        assert.equal(h.tr.isRunning(), false, code);
        assert.equal(r.abortCount, 1, code);
        assert.deepStrictEqual(h.got.log, ['I:言いかけ', 'F:言いかけ', 'I:', 'N:stopped'], code);
        // そのあとに届いたものは捨てる
        r.onresult(resultEvent(0, [{ text: '遅い', final: true }]));
        r.onend();
        await h.clock.advance(60000);
        assert.equal(fake.log.made, 1, code);
        assert.deepStrictEqual(h.got.log, ['I:言いかけ', 'F:言いかけ', 'I:', 'N:stopped'], code);
    }
});

test('startTranscriber: それ以外のエラーは失敗。error のあと end が来ても1回だけ数え、連続5回で止まる', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    // 二重に数えていたら、ここ（4回目）までに止まっている
    assert.equal(h.tr.isRunning(), true);
    assert.equal(fake.log.made, 5);
    await failByError(fake, h);
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
    assert.equal(fake.log.made, 5);
});

test('startTranscriber: エラーの名前が無い・知らない名前も失敗に数える', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const events = [{}, { error: 'network' }, { error: 'bad-grammar' }, null, { error: 'phrases-not-supported' }];
    for (const ev of events) {
        const r = fake.last();
        r.onerror(ev);
        r.onend();
        await toRestart(h);
    }
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
});

test('startTranscriber: 2秒未満に結果なしで終わると失敗1回（連続5回で止まる）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 4; i++) await failByQuickEnd(fake, h);
    assert.equal(h.tr.isRunning(), true);
    await failByQuickEnd(fake, h);
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
});

test('startTranscriber: 2秒以上たってから終わる・途中の結果があれば、結果なしの終わりでも数えない', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 12; i++) {
        await h.clock.advance(2000);
        fake.last().onend();
        await h.clock.advance(300);
    }
    for (let i = 0; i < 12; i++) {
        const r = fake.last();
        r.onresult(resultEvent(0, [{ text: 'え', final: false }]));
        r.onend();
        await h.clock.advance(300);
    }
    assert.equal(h.tr.isRunning(), true);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: 確定の結果で「連続」が0に戻る（4回失敗→成功→4回失敗でも止まらない）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    await succeed(fake, h);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    assert.equal(h.tr.isRunning(), true);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: 連続でなくても、直近60秒に10回失敗したら止まる', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    await succeed(fake, h);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    await succeed(fake, h);
    await failByError(fake, h);                     // 9回目
    assert.equal(h.tr.isRunning(), true);
    await failByError(fake, h);                     // 10回目（連続は2）
    assert.equal(h.tr.isRunning(), false);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
});

test('startTranscriber: 60秒より前の失敗は数えない（あいだが空けば止まらない）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    // 長い成功の回（61秒続いてから終わる）
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '長い発言', final: true }]));
    await h.clock.advance(61000);
    r.onend();
    await h.clock.advance(300);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    await succeed(fake, h);
    for (let i = 0; i < 4; i++) await failByError(fake, h);
    // 全部で12回失敗しているが、直近60秒の中では8回
    assert.equal(h.tr.isRunning(), true);
    assert.deepStrictEqual(h.got.notices, []);
});

// ---- startTranscriber：作り直しまでの待ち（バックオフ） ----

test('startTranscriber: 短く終わる回が続くと、待ちが 300ms → 1秒 → 3秒 → 10秒 と延び、以後は10秒（エラーの種類は問わない）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const seen = [];
    const codes = ['no-speech', 'aborted', 'network', null, 'no-speech', 'aborted', null];
    for (const code of codes) {
        const r = fake.last();
        if (code) r.onerror({ error: code });
        r.onend();
        seen.push(h.clock.delays());
        await toRestart(h);
    }
    assert.deepStrictEqual(seen, [[300], [1000], [3000], [10000], [10000], [10000], [10000]]);
    assert.equal(fake.log.made, codes.length + 1);
    assert.equal(h.tr.isRunning(), true); // 数える失敗は3回（network と、エラー無しの2回）
});

test('startTranscriber: 待ちの途中では作らない（1秒の待ちなら 999ms ではまだ、1000ms で作る）', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    fake.last().onend();
    await h.clock.advance(300);
    assert.equal(fake.log.made, 2);
    fake.last().onend();
    assert.deepStrictEqual(h.clock.delays(), [1000]);
    await h.clock.advance(999);
    assert.equal(fake.log.made, 2);
    await h.clock.advance(1);
    assert.equal(fake.log.made, 3);
});

test('startTranscriber: 結果が1つでも来た回・2秒以上続いた回のあとは、待ちが 300ms に戻る', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    for (let i = 0; i < 3; i++) await failByQuickEnd(fake, h);   // 待ちは 3秒まで延びた
    // 途中の結果だけでも来れば戻る
    fake.last().onresult(resultEvent(0, [{ text: 'え', final: false }]));
    fake.last().onend();
    assert.deepStrictEqual(h.clock.delays(), [300]);
    await toRestart(h);
    // また延ばしてから、結果なしでも2秒以上続けば戻る
    fake.last().onerror({ error: 'no-speech' });
    fake.last().onend();
    await toRestart(h);
    fake.last().onerror({ error: 'no-speech' });
    fake.last().onend();
    assert.deepStrictEqual(h.clock.delays(), [1000]);
    await toRestart(h);
    await h.clock.advance(2000);
    fake.last().onerror({ error: 'no-speech' });
    fake.last().onend();
    assert.deepStrictEqual(h.clock.delays(), [300]);
});

// ---- startTranscriber：作り直し ----

test('startTranscriber: 終わったら300ms後に作り直し、そのたびに available を確かめ直す', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    assert.equal(fake.log.availableArgs.length, 1);
    fake.last().onresult(resultEvent(0, [{ text: 'はい', final: true }]));
    fake.last().onend();
    assert.deepStrictEqual(h.clock.delays(), [300]);
    await h.clock.advance(299);
    assert.equal(fake.log.made, 1);
    await h.clock.advance(1);
    assert.equal(fake.log.made, 2);
    assert.equal(fake.log.availableArgs.length, 2);
    assert.deepStrictEqual(fake.log.availableArgs[1], OPTS);
    assert.deepStrictEqual(fake.last().startArgs, [[h.track]]);
});

test('startTranscriber: 作り直しのときに available が available 以外になっていたら、作らずに止まる', async () => {
    for (const next of ['downloadable', 'downloading', 'unavailable', 'no']) {
        const answers = ['available', next];
        const fake = makeFakeSR({ answer: function () { return answers.length > 1 ? answers.shift() : answers[0]; } });
        const h = await begin(fake);
        await succeed(fake, h);
        assert.equal(fake.log.made, 1, next);
        assert.equal(fake.log.availableArgs.length, 2, next);
        assert.equal(h.tr.isRunning(), false, next);
        assert.deepStrictEqual(h.got.notices, ['stopped'], next);
    }
});

// ---- startTranscriber：stop() ----

test('startTranscriber: stop() は Promise（2回でも同じ）。end までは結果を受け取り、end で残りの途中を確定にして締める', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '一つ目', final: false }]));
    const p = h.tr.stop();
    assert.ok(p instanceof Promise);
    assert.equal(h.tr.stop(), p);
    assert.equal(r.stopCount, 1);
    assert.equal(h.tr.isRunning(), false);
    let resolved = false;
    p.then(function () { resolved = true; });
    await flush();
    assert.equal(resolved, false);                 // end が来るまでは締めない
    assert.deepStrictEqual(h.got.log, ['I:一つ目']); // 途中の表示もまだ消さない
    // stop のあとに届いた確定と途中は、ふつうどおり渡す。エラーは知らせない
    r.onresult(resultEvent(0, [{ text: '一つ目です', final: true }, { text: '最後の', final: false }]));
    r.onresult(resultEvent(1, [{ text: '一つ目です', final: true }, { text: '最後の文', final: false }]));
    r.onerror({ error: 'audio-capture' });
    r.onerror({ error: 'network' });
    r.onend();
    await flush();
    assert.equal(resolved, true);
    assert.deepStrictEqual(h.got.log, ['I:一つ目', 'F:一つ目です', 'I:最後の', 'I:最後の文', 'F:最後の文', 'I:']);
    assert.equal(r.abortCount, undefined);
    assert.equal(fake.log.made, 1);
    assert.equal(h.clock.pending(), 0);            // 10秒の打ち切りの予約も消えている
    // 締めたあとに届いたものは捨てる。作り直さない
    r.onresult(resultEvent(0, [{ text: '遅すぎ', final: true }]));
    r.onend();
    await h.clock.advance(60000);
    assert.equal(h.got.log.length, 6);
    assert.equal(fake.log.made, 1);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: stop() から10秒たっても end が来なければ、abort して残りの途中を確定にし、締める', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '言いかけ', final: false }]));
    let resolved = false;
    h.tr.stop().then(function () { resolved = true; });
    assert.deepStrictEqual(h.clock.delays(), [10000]);
    await h.clock.advance(9999);
    assert.equal(resolved, false);
    assert.equal(r.abortCount, undefined);
    await h.clock.advance(1);
    assert.equal(resolved, true);
    assert.equal(r.abortCount, 1);
    assert.deepStrictEqual(h.got.log, ['I:言いかけ', 'F:言いかけ', 'I:']);
    // 打ち切ったあとのイベントは捨てる
    r.onresult(resultEvent(0, [{ text: '遅い', final: true }, { text: '遅い途中', final: false }]));
    r.onerror({ error: 'network' });
    r.onend();
    await h.clock.advance(60000);
    assert.deepStrictEqual(h.got.log, ['I:言いかけ', 'F:言いかけ', 'I:']);
    assert.equal(fake.log.made, 1);
});

test('startTranscriber: 途中の文字が空白だけなら、締めるときに確定にしない', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '   ', final: false }]));
    const p = h.tr.stop();
    r.onend();
    assert.equal(await settled(p), true);
    assert.deepStrictEqual(h.got.finals, []);
    assert.deepStrictEqual(h.got.log, ['I:   ', 'I:']);
});

test('startTranscriber: stop() は onFinal・onInterim が例外でも resolve する（reject しない）', async () => {
    const fake = makeFakeSR();
    const clock = makeClock();
    const origError = console.error;
    console.error = function () {};
    try {
        const tr = startTranscriber({
            track: { kind: 'audio' },
            onFinal: function () { throw new Error('app のバグ'); },
            onInterim: function () { throw new Error('app のバグ'); },
            SR: fake.SR,
        }, clock);
        await flush();
        fake.last().onresult(resultEvent(0, [{ text: '途中', final: false }]));
        const p = tr.stop();
        await clock.advance(10000);
        assert.equal(await settled(p), true);
    } finally {
        console.error = origError;
    }
});

test('startTranscriber: 止めていないのに end が来たら、残った途中の文字を確定にしてから作り直す', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '確定', final: true }, { text: 'まだ途中', final: false }]));
    r.onend();
    // 作り直しの前に確定になり、途中の表示は消える
    assert.deepStrictEqual(h.got.log, ['F:確定', 'I:まだ途中', 'F:まだ途中', 'I:']);
    assert.equal(fake.log.made, 1);
    await toRestart(h);
    assert.equal(fake.log.made, 2);
    // 次の回は、前の回の途中の文字を持ち越さない（次の end で二重に確定にしない）
    const r2 = fake.last();
    r2.onresult(resultEvent(0, [{ text: '次', final: true }]));
    r2.onend();
    assert.deepStrictEqual(h.got.finals, ['確定', 'まだ途中', '次']);
    assert.equal(h.tr.isRunning(), true);
});

test('startTranscriber: 作り直しを待つあいだに stop() → タイマーを消して作らず、すぐ締める', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    fake.last().onend();
    assert.equal(h.clock.pending(), 1);
    const p = h.tr.stop();
    assert.equal(h.clock.pending(), 0);
    assert.equal(await settled(p), true);
    assert.equal(h.got.log[h.got.log.length - 1], 'I:');
    await h.clock.advance(60000);
    assert.equal(fake.log.made, 1);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: 最初の作成の待ち（available の答え待ち）のあいだに stop() → 始めない', async () => {
    const gate = deferred();
    const fake = makeFakeSR({ answer: function () { return gate.promise; } });
    const clock = makeClock();
    const notices = [];
    const tr = startTranscriber({ track: { kind: 'audio' }, onNotice: function (s) { notices.push(s); }, SR: fake.SR }, clock);
    await flush();
    assert.equal(fake.log.availableArgs.length, 1);
    const p = tr.stop();
    assert.equal(await settled(p), true);      // 動いている回が無いので、すぐ締まる
    gate.resolve('available');
    await flush();
    await clock.advance(5000);
    for (const inst of fake.log.instances) assert.deepStrictEqual(inst.startArgs, []);
    assert.equal(tr.isRunning(), false);
    assert.deepStrictEqual(notices, []);
});

test('startTranscriber: 作り直しの作成の待ちのあいだに stop() → 始めない', async () => {
    const gate = deferred();
    let calls = 0;
    const fake = makeFakeSR({ answer: function () { calls++; return calls === 1 ? 'available' : gate.promise; } });
    const h = await begin(fake);
    await succeed(fake, h);            // 作り直しが始まり、2回目の available の答え待ちで止まる
    assert.equal(calls, 2);
    h.tr.stop();
    gate.resolve('available');
    await flush();
    await h.clock.advance(5000);
    for (let i = 1; i < fake.log.instances.length; i++) assert.deepStrictEqual(fake.log.instances[i].startArgs, []);
    assert.deepStrictEqual(h.got.notices, []);
});

test('startTranscriber: onFinal の中で stop() されても、同じイベントの残りと end までの結果は受け取る', async () => {
    const fake = makeFakeSR();
    let tr = null;
    const log = [];
    const clock = makeClock();
    tr = startTranscriber({
        track: { kind: 'audio' },
        onFinal: function (s) { log.push('F:' + s); if (s === '一') tr.stop(); },
        onInterim: function (s) { log.push('I:' + s); },
        SR: fake.SR,
    }, clock);
    await flush();
    const r = fake.last();
    r.onresult(resultEvent(0, [{ text: '一', final: true }, { text: '二', final: true }, { text: '途中', final: false }]));
    assert.deepStrictEqual(log, ['F:一', 'F:二', 'I:途中']);
    assert.equal(r.stopCount, 1);
    r.onend();
    assert.deepStrictEqual(log, ['F:一', 'F:二', 'I:途中', 'F:途中', 'I:']);
});

test('startTranscriber: 作り直しの前の確定（onFinal）の中で stop() されても、二重に締めず作り直さない', async () => {
    const fake = makeFakeSR();
    let tr = null;
    const log = [];
    const clock = makeClock();
    tr = startTranscriber({
        track: { kind: 'audio' },
        onFinal: function (s) { log.push('F:' + s); tr.stop(); },
        onInterim: function (s) { log.push('I:' + s); },
        SR: fake.SR,
    }, clock);
    await flush();
    fake.last().onresult(resultEvent(0, [{ text: '途中', final: false }]));
    fake.last().onend();
    assert.equal(await settled(tr.stop()), true);
    await clock.advance(60000);
    assert.deepStrictEqual(log, ['I:途中', 'F:途中', 'I:']);
    assert.equal(fake.log.made, 1);
    assert.equal(clock.pending(), 0);
});

test('startTranscriber: 自分で止まったあとに stop() を呼んでも安全で、stopped は1回だけ', async () => {
    const fake = makeFakeSR();
    const h = await begin(fake);
    fake.last().onerror({ error: 'not-allowed' });
    const p = h.tr.stop();
    assert.equal(h.tr.stop(), p);
    assert.equal(await settled(p), true);      // 自分で止まったときに、もう締めてある
    fake.last().onerror({ error: 'audio-capture' });
    fake.last().onend();
    await h.clock.advance(60000);
    assert.deepStrictEqual(h.got.notices, ['stopped']);
    assert.equal(fake.last().stopCount, 0);   // 自分で止まったときは abort 済み。stop() はもう呼ばない
});

test('startTranscriber: onNotice に渡す種類は stopped の1つだけ', async () => {
    const seen = [];
    const scenarios = [
        { fake: { onStart: function () { throw new Error('x'); } } },
        { fake: { answer: 'unavailable' } },
        { fake: {}, extra: { track: null } },
        { fake: {} },
    ];
    for (const sc of scenarios) {
        const fake = makeFakeSR(sc.fake);
        const h = await begin(fake, sc.extra);
        for (let i = 0; i < 6 && fake.last(); i++) {
            fake.last().onerror({ error: 'network' });
            fake.last().onend();
            await toRestart(h);
        }
        assert.equal(await settled(h.tr.stop()), true);
        for (const n of h.got.notices) seen.push(n);
    }
    assert.ok(seen.length >= 4);
    for (const n of seen) assert.equal(n, 'stopped');
});
