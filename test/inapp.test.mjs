// public/inapp.js の単体テスト（アプリの中のブラウザで開いたときの案内）
// - 判定が src/lib/util.js の isInAppBrowser と同じになるか
// - 当たったときだけ、本体を止める印（window.__QB_INAPP と <html> の is-inapp）を付けて、案内の画面を出すか
// - index.html が inapp.js を、本体より先に defer なしで読むか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isInAppBrowser } from '../src/lib/util.js';

const SRC = readFileSync(new URL('../public/inapp.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

const UAS = {
    lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.0.0/IAB',
    worksIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LINEWORKS/4.2.0',
    worksAndroidWv: 'Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
    wkwebviewIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    wkwebviewIpad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
    instagramAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Instagram 350.0.0',
    safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
    edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/140.0 Mobile/15E148 Safari/605.1.15',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    empty: '',
};

function fakeEl(id) {
    return {
        id, hidden: true, value: '', textContent: '', attrs: {}, listeners: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(t, f) { this.listeners[t] = f; },
        focus() {}, select() {}, setSelectionRange() {},
    };
}

// inapp.js を、作り物の window・document の中で動かす
function run(ua, opts = {}) {
    const els = {};
    for (const id of ['inappScreen', 'inappUrl', 'inappCopyMsg', 'inappOpenBtn', 'inappCopyBtn', 'inappDiag']) els[id] = fakeEl(id);
    const doc = {
        readyState: opts.readyState || 'complete',
        documentElement: { className: '' },
        getElementById: (id) => els[id] || null,
        addEventListener: (t, f) => { if (t === 'DOMContentLoaded') doc.dcl = f; },
        execCommand: () => opts.execOk === true,
    };
    const nav = { userAgent: ua, standalone: opts.standalone === true, clipboard: opts.clipboard };
    const win = { navigator: nav, document: doc, matchMedia: () => ({ matches: false }) };
    const ctx = vm.createContext({
        window: win, navigator: nav, document: doc,
        location: { protocol: 'https:', host: 'demo-8bj.pages.dev', search: opts.search || '' },
    });
    vm.runInContext(SRC, ctx);
    return { win, doc, els };
}

test('inapp.js の判定は isInAppBrowser と同じ（ホーム画面から開いたときも）', () => {
    for (const [k, ua] of Object.entries(UAS)) {
        for (const standalone of [false, true]) {
            const r = run(ua, { standalone });
            assert.equal(!!r.win.__QB_INAPP, isInAppBrowser(ua, standalone), k + ' standalone=' + standalone);
        }
    }
});

test('当たったとき：本体を止める印を付けて、案内の画面を出し、コピーする URL を入れる', () => {
    for (const k of ['worksAndroidWv', 'worksIos', 'wkwebviewIos', 'lineIos', 'fbIos']) {
        const r = run(UAS[k]);
        assert.ok(r.win.__QB_INAPP, k);
        assert.match(r.doc.documentElement.className, /(^|\s)is-inapp(\s|$)/, k);
        assert.equal(r.els.inappScreen.hidden, false, k);
        assert.equal(r.els.inappUrl.value, 'https://demo-8bj.pages.dev/', k);
        assert.equal(typeof r.els.inappCopyBtn.listeners.click, 'function', k);
    }
});

test('ふつうのブラウザ：何も付けず、何も出さない', () => {
    for (const k of ['safariIos', 'chromeIos', 'edgeIos', 'chromeAndroid', 'samsungAndroid', 'chromeWin', 'edgeWin', 'safariMac', 'empty']) {
        const r = run(UAS[k]);
        assert.equal(r.win.__QB_INAPP, undefined, k);
        assert.equal(r.doc.documentElement.className, '', k);
        assert.equal(r.els.inappScreen.hidden, true, k);
        assert.equal(r.els.inappCopyBtn.listeners.click, undefined, k);
    }
});

test('LINE だけ［外のブラウザで開く］を出す（openExternalBrowser=1）。LINE WORKS などは出さない', () => {
    for (const k of ['lineIos', 'lineAndroid']) {
        const r = run(UAS[k]);
        assert.equal(r.win.__QB_INAPP, 'line', k);
        assert.equal(r.els.inappOpenBtn.hidden, false, k);
        assert.equal(r.els.inappOpenBtn.attrs.href, 'https://demo-8bj.pages.dev/?openExternalBrowser=1', k);
    }
    for (const k of ['worksAndroidWv', 'worksIos', 'wkwebviewIos', 'fbIos']) {
        const r = run(UAS[k]);
        assert.equal(r.win.__QB_INAPP, 'other', k);
        assert.equal(r.els.inappOpenBtn.hidden, true, k);
        assert.equal(r.els.inappOpenBtn.attrs.href, undefined, k);
    }
});

test('読み込みの途中なら、画面ができてから出す（DOMContentLoaded）', () => {
    const r = run(UAS.worksAndroidWv, { readyState: 'loading' });
    assert.ok(r.win.__QB_INAPP);
    assert.match(r.doc.documentElement.className, /is-inapp/); // 印は、すぐ付ける（本体より先）
    assert.equal(r.els.inappScreen.hidden, true);
    assert.equal(typeof r.doc.dcl, 'function');
    r.doc.dcl();
    assert.equal(r.els.inappScreen.hidden, false);
});

test('［URLをコピー］：クリップボード → だめなら選んでコピー → だめなら長押しの案内', async () => {
    const OK = /コピーしました/;
    const NG = /長押し/;
    // 1) クリップボードで書けた
    let written = '';
    let r = run(UAS.worksAndroidWv, { clipboard: { writeText: (t) => { written = t; return Promise.resolve(); } } });
    r.els.inappCopyBtn.listeners.click();
    await new Promise((res) => setTimeout(res, 0));
    assert.equal(written, 'https://demo-8bj.pages.dev/');
    assert.match(r.els.inappCopyMsg.textContent, OK);
    // 2) クリップボードが断られた → 選んでコピー（execCommand）で書けた
    r = run(UAS.worksAndroidWv, { clipboard: { writeText: () => Promise.reject(new Error('denied')) }, execOk: true });
    r.els.inappCopyBtn.listeners.click();
    await new Promise((res) => setTimeout(res, 0));
    assert.match(r.els.inappCopyMsg.textContent, OK);
    // 3) クリップボードが無く、execCommand もだめ → 長押しの案内
    r = run(UAS.wkwebviewIos, { execOk: false });
    r.els.inappCopyBtn.listeners.click();
    assert.match(r.els.inappCopyMsg.textContent, NG);
});

test('?diag=1 のときだけ UA を出す', () => {
    let r = run(UAS.worksIos, { search: '?diag=1' });
    assert.equal(r.els.inappDiag.hidden, false);
    assert.equal(r.els.inappDiag.textContent, UAS.worksIos);
    r = run(UAS.worksIos);
    assert.equal(r.els.inappDiag.hidden, true);
});

test('index.html：inapp.js を <head> の中で、本体と CSS より先に、defer・async なしで読む', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'));
    const tag = head.match(/<script\b[^>]*src="\/inapp\.js"[^>]*><\/script>/);
    assert.ok(tag, 'head に inapp.js が無い');
    assert.doesNotMatch(tag[0], /\b(defer|async|type=)/);
    assert.ok(head.indexOf(tag[0]) < head.indexOf('/src/index.css'), 'CSS より先に読む');
    assert.ok(HTML.indexOf(tag[0]) < HTML.indexOf('/src/app.js'), '本体より先に読む');
});

test('index.html：案内の画面は body の最初にあり、ふだんは隠れている／ボタンと URL 欄がある', () => {
    const body = HTML.slice(HTML.indexOf('<body>') + 6).replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '');
    assert.match(body, /^<main id="inappScreen"[^>]*\bhidden\b/);
    for (const id of ['inappCopyBtn', 'inappOpenBtn', 'inappUrl', 'inappCopyMsg', 'inappDiag']) {
        assert.ok(HTML.includes('id="' + id + '"'), id);
    }
    assert.ok(!HTML.includes('id="lineBanner"'), '前の帯は消した');
});

test('index.css：is-inapp のときは、案内の画面だけを出す（[hidden] と同じ base の層で、上書きできる強さ）', () => {
    const base = CSS.slice(CSS.indexOf('@layer base'), CSS.indexOf('@layer components'));
    assert.match(base, /html\.is-inapp body > \* \{ display: none !important; \}/);
    assert.match(base, /html\.is-inapp body > #inappScreen \{ display: block !important; \}/);
});
