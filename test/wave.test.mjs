// wave.js の単体テスト（プロジェクト直下で node --test test/wave.test.mjs）
// 棒の位置の計算（barRects）は純関数なのでそのまま、createWave は偽の canvas と ResizeObserver で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barRects, createWave } from '../src/wave.js';

// ---- 偽物 ----

// 偽の canvas。getContext('2d') の描いた内容を calls に順に残す
function makeCanvas(cssW, cssH) {
    const calls = [];
    const g = {
        fillStyle: '',
        globalAlpha: 1,
        clearRect: function (x, y, w, h) { calls.push({ op: 'clear', x: x, y: y, w: w, h: h }); },
        fillRect: function (x, y, w, h) {
            calls.push({ op: 'fill', x: x, y: y, w: w, h: h, color: this.fillStyle, alpha: this.globalAlpha });
        },
    };
    const canvas = {
        clientWidth: cssW,
        clientHeight: cssH,
        width: 300,
        height: 150,
        getContext: function (kind) { return kind === '2d' ? g : null; },
    };
    return { canvas: canvas, g: g, calls: calls };
}

// 最後に描き直した1回ぶん（最後の clear より後）
function lastFrame(calls) {
    let i = calls.length - 1;
    while (i >= 0 && calls[i].op !== 'clear') i--;
    return calls.slice(i + 1);
}
// そのうちの棒（中心線はうすく描くので、濃さ1のものだけ）
function barsOf(calls) {
    return lastFrame(calls).filter(function (c) { return c.op === 'fill' && c.alpha === 1; });
}

// 偽の ResizeObserver（fire() で「大きさが変わった」を起こす）
class FakeRO {
    constructor(cb) {
        this.cb = cb;
        this.targets = [];
        this.disconnected = false;
        FakeRO.instances.push(this);
    }
    observe(t) { this.targets.push(t); }
    disconnect() {
        this.disconnected = true;
        this.targets = [];
    }
    fire() { this.cb([]); }
}
FakeRO.instances = [];

// 偽の window（devicePixelRatio と resize の受け口）
function makeWindow(dpr) {
    const listeners = [];
    return {
        devicePixelRatio: dpr,
        listeners: listeners,
        addEventListener: function (type, fn) { listeners.push([type, fn]); },
        removeEventListener: function (type, fn) {
            const i = listeners.findIndex(function (x) { return x[0] === type && x[1] === fn; });
            if (i !== -1) listeners.splice(i, 1);
        },
        fire: function (type) { listeners.filter(function (x) { return x[0] === type; }).forEach(function (x) { x[1](); }); },
    };
}

// globalThis の window／ResizeObserver を差し替えて fn を実行し、終わったら元に戻す
function withGlobals(globals, fn) {
    const keys = Object.keys(globals);
    const saved = keys.map(function (k) { return [k, Object.prototype.hasOwnProperty.call(globalThis, k), globalThis[k]]; });
    keys.forEach(function (k) {
        if (globals[k] === undefined) delete globalThis[k];
        else globalThis[k] = globals[k];
    });
    try {
        return fn();
    } finally {
        saved.forEach(function (s) {
            if (s[1]) globalThis[s[0]] = s[2];
            else delete globalThis[s[0]];
        });
    }
}

// ---- barRects ----

test('barRects: 0本（空・null）→ 何も描かない', () => {
    assert.deepStrictEqual(barRects([], 400, 80, 100), []);
    assert.deepStrictEqual(barRects(null, 400, 80, 100), []);
    assert.deepStrictEqual(barRects(undefined, 400, 80, 100), []);
});

test('barRects: 幅0・高さ0・本数0（や数でない値）→ 何も描かない', () => {
    assert.deepStrictEqual(barRects([1, 1], 0, 80, 100), []);
    assert.deepStrictEqual(barRects([1, 1], -10, 80, 100), []);
    assert.deepStrictEqual(barRects([1, 1], 400, 0, 100), []);
    assert.deepStrictEqual(barRects([1, 1], 400, 80, 0), []);
    assert.deepStrictEqual(barRects([1, 1], NaN, 80, 100), []);
    assert.deepStrictEqual(barRects([1, 1], 400, 80, NaN), []);
});

test('barRects: 満杯（本数ぶん全部 1）→ 本数ぶんの棒が、高さいっぱい・左から右へすき間なく並ぶ', () => {
    const levels = new Array(100).fill(1);
    const rects = barRects(levels, 400, 80, 100);
    assert.equal(rects.length, 100);
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        assert.equal(r.h, 80);
        assert.equal(r.y, 0);
        assert.ok(r.w > 0 && r.w < 4, String(r.w));          // 1本ぶん（4）より少し細い
        assert.ok(r.x >= i * 4 && r.x + r.w <= (i + 1) * 4 + 1e-9, i + ': ' + r.x);
        if (i > 0) assert.ok(r.x > rects[i - 1].x);
    }
    assert.ok(rects[0].x >= 0);
    assert.ok(rects[99].x + rects[99].w <= 400 + 1e-9);
});

test('barRects: 少ないときは右に寄せる（いちばん新しい棒が右端。空いた左側には描かない）', () => {
    const rects = barRects([0.5, 1], 400, 80, 100);
    assert.equal(rects.length, 2);
    // 右端の枠（99番目）に、いちばん新しい（最後の）値
    assert.ok(rects[1].x >= 99 * 4 && rects[1].x + rects[1].w <= 400 + 1e-9);
    assert.equal(rects[1].h, 80);
    assert.ok(rects[0].x >= 98 * 4 && rects[0].x < 99 * 4);
    assert.equal(rects[0].h, 40);
});

test('barRects: 本数より多ければ、新しいほうの本数ぶんだけ（古いものは左から消えていく）', () => {
    const levels = [];
    for (let i = 0; i < 15; i++) levels.push(i < 5 ? 1 : 0.5);   // 古い5本だけ 1
    const rects = barRects(levels, 100, 10, 10);
    assert.equal(rects.length, 10);
    for (const r of rects) assert.equal(r.h, 5);
    const last = barRects([0, 0, 0, 0.2], 100, 10, 3);
    assert.equal(last.length, 3);
    assert.equal(last[2].h, 2);
});

test('barRects: 棒は中心線から上下対称（y + h/2 が高さの半分）', () => {
    const rects = barRects([0, 0.1, 0.25, 0.5, 0.9, 1], 60, 50, 6);
    for (const r of rects) assert.ok(Math.abs(r.y + r.h / 2 - 25) < 1e-9, JSON.stringify(r));
});

test('barRects: 範囲外（負・1超・NaN・無限大）は 0〜1 に丸めてから描く', () => {
    const rects = barRects([-0.5, 1.5, NaN, Infinity, -Infinity, 0.25], 60, 40, 6);
    assert.deepStrictEqual(rects.map(function (r) { return r.h; }), [0, 40, 0, 40, 0, 10]);
    for (const r of rects) {
        assert.ok(r.h >= 0 && r.h <= 40);
        assert.ok(r.y >= 0 && r.y + r.h <= 40);
    }
});

test('barRects: 渡した配列は書き換えない（純関数）', () => {
    const levels = [0.2, 2, -1];
    const copy = levels.slice();
    barRects(levels, 30, 10, 2);
    assert.deepStrictEqual(levels, copy);
});

// ---- createWave ----

test('createWave: canvas の実寸を、表示の大きさ × devicePixelRatio に合わせる。幅が変わったら追う', () => {
    FakeRO.instances = [];
    withGlobals({ window: makeWindow(2), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(200, 40);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        assert.equal(c.canvas.width, 400);
        assert.equal(c.canvas.height, 80);
        assert.equal(FakeRO.instances.length, 1);
        assert.deepStrictEqual(FakeRO.instances[0].targets, [c.canvas]);
        // 幅が変わった
        c.canvas.clientWidth = 150;
        FakeRO.instances[0].fire();
        assert.equal(c.canvas.width, 300);
        wave.destroy();
    });
});

test('createWave: push のたびに描き直す。棒は右端から増え、seconds 秒ぶん（100ms で1本）だけ保つ', () => {
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9', seconds: 1 });   // 1秒 = 10本
        const before = c.calls.filter(function (x) { return x.op === 'clear'; }).length;
        wave.push(1);
        assert.equal(c.calls.filter(function (x) { return x.op === 'clear'; }).length, before + 1);
        let bars = barsOf(c.calls);
        assert.equal(bars.length, 1);
        assert.ok(bars[0].x >= 90);                                       // 右端
        for (let i = 0; i < 14; i++) wave.push(0.5);
        bars = barsOf(c.calls);
        assert.equal(bars.length, 10);
        for (const b of bars) assert.equal(b.h, 10);                      // 古い「1」は左から消えた
        for (const b of bars) assert.equal(b.color, '#1E6FD9');
        wave.destroy();
    });
});

test('createWave: seconds を省略したら10秒（100本）', () => {
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(400, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        for (let i = 0; i < 130; i++) wave.push(1);
        assert.equal(barsOf(c.calls).length, 100);
        wave.destroy();
    });
});

test('createWave: 範囲外の値や null を push しても 0〜1 で描く。無音（0）の棒は描かず、うすい中心線だけ', () => {
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9', seconds: 1 });
        wave.push(0);
        const frame = lastFrame(c.calls);
        assert.equal(barsOf(c.calls).length, 0);
        const line = frame.filter(function (x) { return x.op === 'fill' && x.alpha < 1; });
        assert.equal(line.length, 1);
        assert.equal(line[0].w, 100);
        [5, -1, NaN, null, undefined].forEach(function (v) { wave.push(v); });
        const hs = barsOf(c.calls).map(function (b) { return b.h; });
        assert.deepStrictEqual(hs, [20]);                                 // 5 → 1 だけが描かれ、ほかは 0
        wave.destroy();
    });
});

test('createWave: clear() で全部消える', () => {
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9', seconds: 1 });
        wave.push(1);
        wave.push(1);
        wave.clear();
        assert.equal(barsOf(c.calls).length, 0);
        wave.push(1);
        assert.equal(barsOf(c.calls).length, 1);
        wave.destroy();
    });
});

test('createWave: destroy() で監視を外し、以後の push・大きさの変化では描かない（2回呼んでもよい）', () => {
    FakeRO.instances = [];
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        wave.destroy();
        assert.equal(FakeRO.instances[0].disconnected, true);
        const n = c.calls.length;
        wave.push(1);
        wave.clear();
        FakeRO.instances[0].fire();
        assert.equal(c.calls.length, n);
        assert.doesNotThrow(function () { wave.destroy(); });
    });
});

test('createWave: ResizeObserver が無ければ window の resize で追い、destroy() で外す', () => {
    const win = makeWindow(1);
    withGlobals({ window: win, ResizeObserver: undefined }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        assert.equal(win.listeners.length, 1);
        assert.equal(win.listeners[0][0], 'resize');
        c.canvas.clientWidth = 50;
        win.fire('resize');
        assert.equal(c.canvas.width, 50);
        wave.destroy();
        assert.equal(win.listeners.length, 0);
    });
});

test('createWave: 色は渡したものを使う。省略したら紺（赤ではない）', () => {
    withGlobals({ window: makeWindow(1), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas);
        wave.push(1);
        const color = barsOf(c.calls)[0].color;
        assert.equal(color, '#00004B');
        assert.ok(!/^(red|#f00|#ff0000)$/i.test(color));
        wave.destroy();
    });
});

test('createWave: 幅0の canvas（まだ画面に出ていない）でも例外にならず、何も描かない', () => {
    withGlobals({ window: makeWindow(2), ResizeObserver: FakeRO }, function () {
        const c = makeCanvas(0, 0);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        assert.equal(c.canvas.width, 0);
        assert.doesNotThrow(function () { wave.push(1); });
        assert.equal(lastFrame(c.calls).length, 0);
        wave.destroy();
    });
});

test('createWave: window も ResizeObserver も無い（Node）でも作れて、例外にならない', () => {
    withGlobals({ window: undefined, ResizeObserver: undefined }, function () {
        const c = makeCanvas(100, 20);
        const wave = createWave(c.canvas, { color: '#1E6FD9' });
        assert.equal(c.canvas.width, 100);                               // 拡大率は 1 として扱う
        assert.doesNotThrow(function () { wave.push(0.5); wave.clear(); wave.destroy(); });
    });
});
