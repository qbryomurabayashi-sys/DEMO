// 流れる波形 — 入力レベル（0〜1）を縦棒で描く。新しい音が右から入り、左へ流れていく（棒は中心線から上下対称）
// startMeters の onLevels の値を push するだけで使える（100ms ごとに1本。seconds 秒ぶんを保つ。既定は10秒＝100本）。
// 棒の位置の計算（barRects）は純関数にして、Node でテストする。canvas を触るのは createWave だけ。
// 色は呼ぶ側が渡す（赤は使わない）。読み込んだだけでは window に触らない（Node で import しても困らないように）

const BAR_INTERVAL_MS = 100;       // 1本ぶんの時間（startMeters の間隔と同じ）
const DEFAULT_SECONDS = 10;        // 保つ長さ（10秒＝100本）
const DEFAULT_COLOR = '#00004B';   // 色が渡されなかったとき（QB の紺）
const GAP_RATIO = 0.3;             // 棒と棒のすき間（1本ぶんの幅に対する割合）
const CENTER_LINE_ALPHA = 0.25;    // 中心線のうすさ（無音でも、動いている場所が分かるように）

// 0〜1 に丸める（負・1超・数でない値 → 0〜1。NaN は 0）
function clamp01(v) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!(n > 0)) return 0;
    return n > 1 ? 1 : n;
}

// 棒の位置を計算する（純関数）→ [{ x, y, w, h }]（古い順。いちばん新しい棒が右端）
// levels：古い順のレベルの並び（count より多ければ、新しいほうの count 本だけ使う）
// width・height：描く広さ。count：横に並べる本数（1本ぶんの幅は width / count）
// 幅・高さ・本数が0以下なら何も描かない（[]）。棒の高さは level × height で、中心線から上下対称
export function barRects(levels, width, height, count) {
    const list = levels && typeof levels.length === 'number' ? levels : [];
    const n = Math.floor(count);
    if (!(width > 0) || !(height > 0) || !(n > 0) || list.length === 0) return [];
    const slot = width / n;
    const w = slot * (1 - GAP_RATIO);
    const kept = list.length > n ? Array.prototype.slice.call(list, list.length - n) : Array.prototype.slice.call(list);
    const first = n - kept.length; // 右に寄せる（空いている左側には何も描かない）
    const rects = [];
    for (let i = 0; i < kept.length; i++) {
        const h = clamp01(kept[i]) * height;
        rects.push({ x: (first + i) * slot + (slot - w) / 2, y: (height - h) / 2, w: w, h: h });
    }
    return rects;
}

// 画面の拡大率（無い環境では 1）
function pixelRatio() {
    const r = typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1;
    return r > 0 ? r : 1;
}

// canvas に流れる波形を作る → { push(level), clear(), destroy() }
// canvas の実寸は、表示の大きさ × devicePixelRatio に合わせる（にじまないように）。
// 表示の幅が変わったら ResizeObserver で追う（無いブラウザでは window の resize）。destroy() で監視を外す。
// canvas の表示の大きさ（幅・高さ）は CSS で決めておくこと（実寸を変えても表示の大きさが変わらないように）
export function createWave(canvas, options) {
    const opt = options || {};
    const color = typeof opt.color === 'string' && opt.color ? opt.color : DEFAULT_COLOR;
    const seconds = opt.seconds > 0 ? opt.seconds : DEFAULT_SECONDS;
    const count = Math.max(1, Math.round((seconds * 1000) / BAR_INTERVAL_MS));
    const g = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    let levels = [];
    let destroyed = false;
    let observer = null;
    let listening = false;

    // 実寸を表示の大きさに合わせる（変わったときだけ書き換える。書き換えると canvas の中身は消える）
    function fitSize() {
        if (!canvas) return;
        const dpr = pixelRatio();
        const w = Math.max(0, Math.round((canvas.clientWidth || 0) * dpr));
        const h = Math.max(0, Math.round((canvas.clientHeight || 0) * dpr));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }

    // 全部を描き直す：消す → うすい中心線 → 棒
    function draw() {
        if (destroyed || !g) return;
        const w = canvas.width;
        const h = canvas.height;
        g.clearRect(0, 0, w, h);
        if (!(w > 0) || !(h > 0)) return;
        g.fillStyle = color;
        const lineH = Math.max(1, Math.round(pixelRatio()));
        g.globalAlpha = CENTER_LINE_ALPHA;
        g.fillRect(0, Math.round((h - lineH) / 2), w, lineH);
        g.globalAlpha = 1;
        const rects = barRects(levels, w, h, count);
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.h > 0) g.fillRect(r.x, r.y, r.w, r.h);
        }
    }

    // 大きさが変わったら、合わせて描き直す
    function onResize() {
        if (destroyed) return;
        fitSize();
        draw();
    }

    if (canvas && typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(onResize);
        observer.observe(canvas);
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', onResize);
        listening = true;
    }
    fitSize();
    draw();

    return {
        // 1本足して描き直す（startMeters の onLevels の値をそのまま。null などは 0 として描く）
        push: function (level) {
            if (destroyed) return;
            levels.push(clamp01(level));
            if (levels.length > count) levels.splice(0, levels.length - count);
            draw();
        },
        // 全部消す（録音をやり直すとき）
        clear: function () {
            if (destroyed) return;
            levels = [];
            draw();
        },
        // 監視を外す（以後 push しても何もしない。2回呼んでもよい）
        destroy: function () {
            if (destroyed) return;
            destroyed = true;
            levels = [];
            if (observer) {
                try { observer.disconnect(); } catch (e) { /* 外せなくても、以後は描かない */ }
                observer = null;
            }
            if (listening) {
                window.removeEventListener('resize', onResize);
                listening = false;
            }
        },
    };
}
