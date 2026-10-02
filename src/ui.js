// 画面の小道具 — 要素の取得・表示の切り替え・localStorage・アイコン・トースト・確認と入力・ファイル保存
// 画面（DOM）のことだけを扱う。録音や保存（DB）の都合は知らない（組み合わせるのは app.js）。
//
// 表示の切り替えは hidden 属性だけ（el.hidden = true / false）。hidden クラスは使わない。
// native の alert / confirm / prompt は使わない（確認と入力は showConfirm / showPrompt）。

import {
    createIcons,
    Mic, Square, Menu, X, Plus, Pencil, Trash, FileText, Download, Copy, TriangleAlert, Info, Check, History,
} from 'lucide';

// ---- 要素の取得と、表示・押せる/押せない ----
export const $ = (id) => document.getElementById(id);

// イベントを付ける（要素が無くても落とさない。無いときはコンソールに出すだけ）
export function on(id, type, handler) {
    const el = $(id);
    if (!el) {
        console.warn(`#${id} が見つかりません`);
        return null;
    }
    el.addEventListener(type, handler);
    return el;
}

// 見せる / 隠す（hidden 属性で切り替える）。id の代わりに要素を渡してもよい
export function setShown(target, shown) {
    const el = typeof target === 'string' ? $(target) : target;
    if (el) el.hidden = !shown;
}

export function setDisabled(target, disabled) {
    const el = typeof target === 'string' ? $(target) : target;
    if (el) el.disabled = !!disabled;
}

// 日本語入力の変換中の Enter（確定のための Enter）か
export function isImeEnter(e) {
    return e.isComposing || e.keyCode === 229;
}

// 改行を含む文を、行ごとに <br> で区切って入れる（CSS に頼らずに改行を見せる。innerHTML は使わない）
export function setMultilineText(el, text) {
    if (!el) return;
    el.textContent = '';
    String(text == null ? '' : text).split('\n').forEach((line, i) => {
        if (i > 0) el.appendChild(document.createElement('br'));
        el.appendChild(document.createTextNode(line));
    });
}

// ---- localStorage ----
// localStorage は必ずここを通す（Cookie をブロックした iPhone などでは、触っただけで例外になるため）。
// 保存できない環境では、この画面を開いている間だけメモリに持つ。キーは qb_giji_ で始める。
const LS_PREFIX = 'qb_giji_';
const lsMemory = {};

export const ls = {
    usable: (() => {
        try {
            const probe = LS_PREFIX + 'probe';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    })(),
    get(key) {
        if (this.usable) {
            try {
                const v = window.localStorage.getItem(LS_PREFIX + key);
                if (v !== null) return v;
            } catch (e) { /* 下のメモリを見る */ }
        }
        return Object.prototype.hasOwnProperty.call(lsMemory, key) ? lsMemory[key] : null;
    },
    set(key, value) {
        lsMemory[key] = String(value);
        if (!this.usable) return false;
        try {
            window.localStorage.setItem(LS_PREFIX + key, String(value));
            return true;
        } catch (e) {
            return false;
        }
    },
};

// ---- アイコン ----
// lucide を npm から同梱する（外部から読み込まない）。名前は lucide 1.48.0 の本名だけ（別名 trash-2 等は使わない）。
// 使うアイコンはここに全部並べる（後から JS で入れるアイコンも、ここに無いと出ない）。
const ICONS = { Mic, Square, Menu, X, Plus, Pencil, Trash, FileText, Download, Copy, TriangleAlert, Info, Check, History };

// root を渡すとその中だけ描く（毎回ページ全体を描き直さない）
export function renderIcons(root) {
    try {
        createIcons({ icons: ICONS, root: root || document });
    } catch (e) {
        console.warn('アイコンを描けませんでした', e);
    }
}

// ---- トースト ----
// 種類は 'info' と 'error' の2つ。色ではなく、アイコン（info / triangle-alert）と文で分ける
const TOAST_MAX = 3;          // 同時に出すのはここまで（古いものから消す）
const TOAST_FADE_MS = 300;

export function showToast(message, type = 'info', duration) {
    const container = $('toastContainer');
    if (!container) {
        console.log(`[toast:${type}] ${message}`);
        return;
    }
    const kind = type === 'error' ? 'error' : 'info';
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', kind === 'error' ? 'triangle-alert' : 'info');
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(icon);
    el.appendChild(text);
    container.appendChild(el);
    renderIcons(el);
    while (container.children.length > TOAST_MAX) container.firstElementChild.remove();

    const ms = duration || (kind === 'error' ? 6000 : 3500);
    setTimeout(() => {
        el.style.transition = `opacity ${TOAST_FADE_MS}ms`;
        el.style.opacity = '0';
        setTimeout(() => el.remove(), TOAST_FADE_MS);
    }, ms);
}

// ---- 確認 / 入力（<dialog> は使わず、div のモーダルを hidden で出し入れする） ----
// 背景のタップで閉じるのは、開いてから 250ms 後から（開いたタップがそのまま背景に当たって閉じるのを防ぐ）
const BACKDROP_GUARD_MS = 250;
// いま開いている確認・入力を「閉じた（dismiss）」扱いで閉じる関数（新しく開くときに前のを閉じる）
let closeActiveDialog = null;

// 確認か入力が開いているか（Esc で履歴を閉じる処理などが、先に譲るため）
export function isDialogOpen() {
    return closeActiveDialog !== null;
}

// Tab で背面（履歴など）へ抜けないように、開いているモーダルの中だけを回る
function trapTab(e, modal) {
    if (e.key !== 'Tab') return;
    const items = Array.prototype.filter.call(
        modal.querySelectorAll('button, input, select, textarea'),
        (el) => !el.disabled && !el.hidden && el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = modal.contains(document.activeElement);
    if (e.shiftKey) {
        if (!inside || document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else if (!inside || document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

// 閉じたあと、開く前に押していたボタンへ戻す（入力欄には戻さない＝スマホでキーボードが勝手に出るため）
function restoreFocus(el) {
    if (el && el.tagName === 'BUTTON' && !el.disabled && document.contains(el)) {
        try { el.focus(); } catch (e) { /* 戻せなくても困らない */ }
    }
}

// 確認 → 'ok'（OK のボタン）/ 'cancel'（もう一方のボタン）/ 'dismiss'（背景のタップ・Esc・別の確認に置き換わった）
// onOkTap：OK のタップの中で、閉じる前に同期で呼ぶ処理
//          （画面共有・AudioContext など、タップの中で呼ばないと断られるものをここで呼ぶ）
// focusCancel：取り消せない操作（削除など）では、最初のフォーカスを OK でない側に置く。赤は使わない
export function showConfirm({
    title = '確認', message = '', okLabel = 'OK', cancelLabel = 'やめる', onOkTap = null, focusCancel = false,
} = {}) {
    return new Promise((resolve) => {
        const modal = $('confirmModal');
        const okBtn = $('confirmOkBtn');
        const cancelBtn = $('confirmCancelBtn');
        if (!modal || !okBtn || !cancelBtn) {
            console.warn('確認の画面が見つかりません');
            resolve('dismiss');
            return;
        }
        if (closeActiveDialog) closeActiveDialog();

        const titleEl = $('confirmTitle');
        const messageEl = $('confirmMessage');
        if (titleEl) titleEl.textContent = title;
        if (messageEl) {
            setMultilineText(messageEl, message);
            messageEl.hidden = !message;
        }
        okBtn.textContent = okLabel;
        cancelBtn.textContent = cancelLabel;
        const opener = document.activeElement;
        const openedAt = Date.now();
        modal.hidden = false;
        setTimeout(() => {
            if (!modal.hidden) (focusCancel ? cancelBtn : okBtn).focus();
        }, 50);

        let closed = false;
        const cleanup = (result) => {
            if (closed) return;
            closed = true;
            modal.hidden = true;
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            if (closeActiveDialog === dismiss) closeActiveDialog = null;
            restoreFocus(opener);
            resolve(result);
        };
        const onOk = () => {
            if (typeof onOkTap === 'function') {
                try { onOkTap(); } catch (e) { console.error(e); }
            }
            cleanup('ok');
        };
        const onCancel = () => cleanup('cancel');
        const dismiss = () => cleanup('dismiss');
        const onBackdrop = (e) => {
            if (e.target === modal && Date.now() - openedAt >= BACKDROP_GUARD_MS) dismiss();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
            else trapTab(e, modal);
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        closeActiveDialog = dismiss;
    });
}

// 1行の入力 → OK なら入力した文字（空文字もありうる）、やめた・閉じたら null
// cancelLabel に null を渡すと、もう一方のボタンを出さない（見せるだけの入力欄など）
// readOnly：書き換えさせない（URL を見せて長押しでコピーしてもらうとき）
export function showPrompt({
    title = '入力', message = '', defaultValue = '', okLabel = '保存', cancelLabel = 'やめる', readOnly = false,
} = {}) {
    return new Promise((resolve) => {
        const modal = $('promptModal');
        const input = $('promptInput');
        const okBtn = $('promptOkBtn');
        const cancelBtn = $('promptCancelBtn');
        if (!modal || !input || !okBtn || !cancelBtn) {
            console.warn('入力の画面が見つかりません');
            resolve(null);
            return;
        }
        if (closeActiveDialog) closeActiveDialog();

        const titleEl = $('promptTitle');
        const messageEl = $('promptMessage');
        if (titleEl) titleEl.textContent = title;
        if (messageEl) {
            setMultilineText(messageEl, message);
            messageEl.hidden = !message;
        }
        okBtn.textContent = okLabel;
        cancelBtn.textContent = cancelLabel == null ? '' : cancelLabel;
        cancelBtn.hidden = cancelLabel == null;
        input.value = defaultValue == null ? '' : String(defaultValue);
        input.readOnly = !!readOnly;
        const opener = document.activeElement;
        const openedAt = Date.now();
        modal.hidden = false;
        setTimeout(() => {
            if (modal.hidden) return;
            input.focus();
            try { input.select(); } catch (e) { /* 選べなくても入力はできる */ }
        }, 50);

        let closed = false;
        const cleanup = (result) => {
            if (closed) return;
            closed = true;
            modal.hidden = true;
            cancelBtn.hidden = false;
            input.readOnly = false;
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onEnter);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            if (closeActiveDialog === dismiss) closeActiveDialog = null;
            restoreFocus(opener);
            resolve(result);
        };
        const onOk = () => cleanup(input.value);
        const onCancel = () => cleanup(null);
        const dismiss = () => cleanup(null);
        // 日本語入力の変換を確定する Enter では閉じない
        const onEnter = (e) => {
            if (e.key === 'Enter' && !isImeEnter(e)) { e.preventDefault(); onOk(); }
        };
        const onBackdrop = (e) => {
            if (e.target === modal && Date.now() - openedAt >= BACKDROP_GUARD_MS) dismiss();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
            else trapTab(e, modal);
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onEnter);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        closeActiveDialog = dismiss;
    });
}

// ---- ファイルとして保存 ----
// 必ずタップの中で、await を挟まずに呼ぶ（iPhone は await の後だと何も起きない）。
// Blob は先に作っておく（会議を開いたとき・停止した後・メモや名前を変えた後）。URL は約60秒後に片付ける
const REVOKE_AFTER_MS = 60000;

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

// 保存先を選んでもらって保存する（パソコンの Chrome・Edge）。保存先が見えるので、端末の中に置いたと分かる。
// 選ぶ画面が無い端末（iPhone・Android など）や、選ぶ画面を出せないときは、今までどおりダウンロードにする。
// 必ずタップの中で、await を挟まずに呼ぶ。onSaved(true) は保存できたとき（やめたときは呼ばない）
export function saveFile(blob, filename, onSaved, isMobile) {
    const done = () => { if (typeof onSaved === 'function') onSaved(true); };
    if (!isMobile && typeof window.showSaveFilePicker === 'function') {
        const ext = String(filename).split('.').pop();
        const mime = String(blob.type || '').split(';')[0] || 'application/octet-stream';
        let picking;
        try {
            picking = window.showSaveFilePicker({
                suggestedName: filename,
                startIn: 'downloads',
                types: [{ description: ext === 'txt' ? '文字（テキスト）' : '音声', accept: { [mime]: ['.' + ext] } }],
            });
        } catch (e) {
            picking = null; // 選ぶ画面を出せない → ダウンロードへ
        }
        if (picking) {
            picking.then(async (handle) => {
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                done();
            }).catch((e) => {
                if (e && e.name === 'AbortError') return; // 利用者がやめた
                console.warn('保存先を選ぶ画面で保存できませんでした。ダウンロードにします', e);
                downloadBlob(blob, filename); // ここはタップの外だが、パソコンのブラウザならダウンロードできる
                done();
            });
            return;
        }
    }
    downloadBlob(blob, filename);
    done();
}
