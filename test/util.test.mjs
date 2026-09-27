// util.js の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
// 日時はすべてローカル時刻で作る（タイムゾーンに依存させない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    sanitizeFilename,
    ymd,
    minutesDocFilename,
    provisionalTitle,
    isLineInApp,
    isInAppBrowser,
    chromeOpenUrl,
    withOpenExternalBrowser,
    compareSemver,
    shouldShowUpdateToast,
    pickMimeType,
    extForMime,
    isIOS,
    isMac,
    isMobileOrTablet,
} from '../src/lib/util.js';

const MS = new Date(2026, 8, 27, 14, 5, 10).getTime(); // 2026-09-27 14:05:10

// ---- ファイル名 ----

test('sanitizeFilename: \\ / : * ? " < > | と制御文字は _ に', () => {
    assert.equal(sanitizeFilename('a\\b/c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(sanitizeFilename('会議\t名\x00前\x7F'), '会議_名_前_');
});

test('sanitizeFilename: 前後の空白と末尾のドットを除く', () => {
    assert.equal(sanitizeFilename('  定例会議 . . '), '定例会議');
    assert.equal(sanitizeFilename('\u3000定例会議...'), '定例会議');
    assert.equal(sanitizeFilename('\n定例会議\n'), '定例会議');
    assert.equal(sanitizeFilename('v3.1 の説明'), 'v3.1 の説明');
});

test('sanitizeFilename: 50文字まで（絵文字も1文字と数える）', () => {
    assert.equal(sanitizeFilename('あ'.repeat(60)), 'あ'.repeat(50));
    const emoji = String.fromCodePoint(0x1F600);
    assert.equal(sanitizeFilename(emoji.repeat(60)), emoji.repeat(50));
    // 切ったあとの末尾がドットなら、それも落とす
    assert.equal(sanitizeFilename('あ'.repeat(49) + '.い'), 'あ'.repeat(49));
});

test('sanitizeFilename: 空なら fallback（既定は「会議」）', () => {
    assert.equal(sanitizeFilename(''), '会議');
    assert.equal(sanitizeFilename('   '), '会議');
    assert.equal(sanitizeFilename('...'), '会議');
    assert.equal(sanitizeFilename(null), '会議');
    assert.equal(sanitizeFilename(undefined), '会議');
    assert.equal(sanitizeFilename('', '無題'), '無題');
});

// ---- 日付 ----

test('ymd: YYYYMMDD（ゼロ埋め）', () => {
    assert.equal(ymd(MS), '20260927');
    assert.equal(ymd(new Date(2026, 0, 5, 0, 0, 0).getTime()), '20260105');
    assert.equal(ymd(new Date(2026, 11, 31, 23, 59, 59).getTime()), '20261231');
});

test('minutesDocFilename: 議事録_{会議名}_{YYYYMMDD}.doc', () => {
    assert.equal(minutesDocFilename('10月シフト会議', MS), '議事録_10月シフト会議_20260927.doc');
    assert.equal(minutesDocFilename('', MS), '議事録_会議_20260927.doc');
    assert.equal(minutesDocFilename('A/B:C?', MS), '議事録_A_B_C__20260927.doc');
});

test('minutesDocFilename: ms が無効なら今日の日付', () => {
    for (const bad of [undefined, null, NaN, Infinity, 'abc', 0, -1]) {
        const before = ymd(Date.now());
        const got = minutesDocFilename('x', bad);
        const after = ymd(Date.now());
        assert.ok(got === '議事録_x_' + before + '.doc' || got === '議事録_x_' + after + '.doc', String(bad) + ' → ' + got);
    }
});

test('provisionalTitle: 会議 YYYY/MM/DD HH:MM（ゼロ埋め）', () => {
    assert.equal(provisionalTitle(MS), '会議 2026/09/27 14:05');
    assert.equal(provisionalTitle(new Date(2026, 0, 5, 9, 3, 0).getTime()), '会議 2026/01/05 09:03');
});

// ---- LINE 内ブラウザ ----

const UA = {
    iosLine: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.18.0',
    androidLine: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Line/13.18.1/IAB',
    iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
};

test('isLineInApp: iOS と Android の LINE は true', () => {
    assert.equal(isLineInApp(UA.iosLine), true);
    assert.equal(isLineInApp(UA.androidLine), true);
});

test('isLineInApp: iOS Safari・Android Chrome・Edge・空・undefined は false', () => {
    assert.equal(isLineInApp(UA.iosSafari), false);
    assert.equal(isLineInApp(UA.androidChrome), false);
    assert.equal(isLineInApp(UA.edge), false);
    assert.equal(isLineInApp(''), false);
    assert.equal(isLineInApp(undefined), false);
});

test('isLineInApp: 大文字小文字を区別する（line/ や OnLine/ は LINE ではない）', () => {
    assert.equal(isLineInApp('Mozilla/5.0 line/13.18.0'), false);
    assert.equal(isLineInApp('Mozilla/5.0 OnLine/1.0'), false);
});

test('withOpenExternalBrowser: クエリが無ければ ?openExternalBrowser=1', () => {
    assert.equal(withOpenExternalBrowser('https://example.com/giji/'), 'https://example.com/giji/?openExternalBrowser=1');
});

test('withOpenExternalBrowser: 既存のクエリ（書き方も）とハッシュを保つ', () => {
    assert.equal(
        withOpenExternalBrowser('https://example.com/giji/?a=1&b=x%20y&debug#top'),
        'https://example.com/giji/?a=1&b=x%20y&debug&openExternalBrowser=1#top'
    );
    assert.equal(withOpenExternalBrowser('https://example.com/giji/#top'), 'https://example.com/giji/?openExternalBrowser=1#top');
});

test('withOpenExternalBrowser: すでに付いていれば変えない', () => {
    const href = 'https://example.com/giji/?openExternalBrowser=1#top';
    assert.equal(withOpenExternalBrowser(href), href);
    const href2 = 'https://example.com/giji/?a=1&openExternalBrowser=0';
    assert.equal(withOpenExternalBrowser(href2), href2);
});

test('withOpenExternalBrowser: URL として読めなければそのまま返す', () => {
    assert.equal(withOpenExternalBrowser('not a url'), 'not a url');
    assert.equal(withOpenExternalBrowser(''), '');
});

// ---- 版の比較・お知らせ ----

test('compareSemver: 数値で比べる（3.10.0 > 3.9.9）', () => {
    assert.equal(compareSemver('3.10.0', '3.9.9'), 1);
    assert.equal(compareSemver('3.9.9', '3.10.0'), -1);
    assert.equal(compareSemver('3.1.0', '3.1.0'), 0);
    assert.equal(compareSemver('3.0.0', '3.1.0'), -1);
    assert.equal(compareSemver('4.0.0', '3.99.99'), 1);
    assert.equal(compareSemver('3.1', '3.1.0'), 0);
});

test('compareSemver: 不正・未定義は 0.0.0 扱い', () => {
    assert.equal(compareSemver(undefined, '0.0.0'), 0);
    assert.equal(compareSemver(null, '0.0.1'), -1);
    assert.equal(compareSemver('abc', '0.0.0'), 0);
    assert.equal(compareSemver('3.1.0', undefined), 1);
    assert.equal(compareSemver('', ''), 0);
});

test('shouldShowUpdateToast: 履歴0件は常に false', () => {
    for (const seen of [undefined, null, '', '3.0.0', '3.1.0', '9.9.9']) {
        assert.equal(shouldShowUpdateToast({ sessionCount: 0, seenVersion: seen, currentVersion: '3.1.0' }), false, String(seen));
    }
});

test('shouldShowUpdateToast: 1件＋未既読は true', () => {
    for (const seen of [undefined, null, '']) {
        assert.equal(shouldShowUpdateToast({ sessionCount: 1, seenVersion: seen, currentVersion: '3.1.0' }), true, String(seen));
    }
});

test('shouldShowUpdateToast: 1件＋3.0.0 は true、1件＋3.1.0 は false', () => {
    assert.equal(shouldShowUpdateToast({ sessionCount: 1, seenVersion: '3.0.0', currentVersion: '3.1.0' }), true);
    assert.equal(shouldShowUpdateToast({ sessionCount: 1, seenVersion: '3.1.0', currentVersion: '3.1.0' }), false);
});

test('shouldShowUpdateToast: 見た版の方が新しいと false', () => {
    assert.equal(shouldShowUpdateToast({ sessionCount: 5, seenVersion: '3.2.0', currentVersion: '3.1.0' }), false);
});

test('shouldShowUpdateToast: 引数が無くても落ちずに false', () => {
    assert.equal(shouldShowUpdateToast(), false);
    assert.equal(shouldShowUpdateToast({}), false);
});

// ---- 録音形式 ----

test('pickMimeType: 候補の順に、最初に true のものを返す', () => {
    assert.equal(pickMimeType(() => true), 'audio/webm;codecs=opus');
    assert.equal(pickMimeType((t) => t === 'audio/webm'), 'audio/webm');
    assert.equal(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4'); // iPhone の Safari
});

test('pickMimeType: どれも使えなければ空文字', () => {
    assert.equal(pickMimeType(() => false), '');
    assert.equal(pickMimeType(undefined), '');
    // isTypeSupported は true/false を返す。true 以外（'probably' のような文字列・1）は「使える」とみなさない
    assert.equal(pickMimeType(() => 'probably'), '');
    assert.equal(pickMimeType(() => 1), '');
});

test('pickMimeType: 例外を投げる候補は飛ばす（全部投げたら空文字）', () => {
    const tried = [];
    const got = pickMimeType((t) => {
        tried.push(t);
        if (t !== 'audio/mp4') throw new Error('not supported');
        return true;
    });
    assert.equal(got, 'audio/mp4');
    assert.deepEqual(tried, ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);
    assert.equal(pickMimeType(() => { throw new Error('x'); }), '');
});

test('extForMime: mp4 → m4a、ogg → ogg、それ以外・空・未定義 → webm', () => {
    assert.equal(extForMime('audio/mp4'), 'm4a');
    assert.equal(extForMime('audio/mp4;codecs=mp4a.40.2'), 'm4a');
    assert.equal(extForMime('AUDIO/MP4'), 'm4a');
    assert.equal(extForMime('audio/ogg;codecs=opus'), 'ogg');
    assert.equal(extForMime('audio/webm;codecs=opus'), 'webm');
    assert.equal(extForMime('audio/webm'), 'webm');
    assert.equal(extForMime(''), 'webm');
    assert.equal(extForMime(undefined), 'webm');
});

// ---- src/lib 全体：古い iPhone で起動しなくなる書き方をしていないか（静的検査） ----
// ブラウザは読み込んだ時点で構文エラーになると、アプリ全体が動かなくなる。node では通ってしまうので字面で見る。

const LIB_FILES = ['filler.js', 'minutes.js', 'worddoc.js', 'util.js'];
const FORBIDDEN = [
    [/\(\?<[=!]/, '正規表現の後読み（古い Safari で構文エラー）'],
    [/\bObject\.hasOwn\b/, 'Object.hasOwn'],
    [/\bstructuredClone\b/, 'structuredClone'],
    [/\.at\(/, 'Array.prototype.at'],
    [/\.findLast(Index)?\(/, 'findLast'],
    [/^await\b/m, 'トップレベル await'],
    [/\bfrom\s+['"](?!\.{1,2}\/)/, '相対パス以外の import（node 専用・外部依存）'],
    [/\brequire\s*\(/, 'require'],
];

test('src/lib の4ファイルは iOS 15 で落ちる書き方・node 専用の import を使っていない', () => {
    for (const f of LIB_FILES) {
        const src = readFileSync(new URL('../src/lib/' + f, import.meta.url), 'utf8');
        for (const [re, what] of FORBIDDEN) {
            assert.doesNotMatch(src, re, f + ': ' + what);
        }
    }
});

// ---- 端末の判定（isIOS / isMac / isMobileOrTablet） ----

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

// 実在する形の UA。[名前, UA, maxTouchPoints, isIOS, isMac, isMobileOrTablet]
const DEVICES = [
    ['Windows の Chrome', WIN_CHROME, 0, false, false, false],
    ['Windows の Edge', UA.edge, 0, false, false, false],
    ['Windows の Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0', 0, false, false, false],
    ['タッチ対応の Windows PC の Chrome', WIN_CHROME, 10, false, false, false],
    ['Mac の Safari', MAC_SAFARI, 0, false, true, false],
    ['Mac の Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36', 0, false, true, false],
    ['Mac（maxTouchPoints 1）', MAC_SAFARI, 1, false, true, false],
    ['iPad のデスクトップ表示（Macintosh・maxTouchPoints 5）', MAC_SAFARI, 5, true, false, true],
    ['iPad のモバイル表示', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 5, true, false, true],
    ['iPhone の Safari', UA.iosSafari, 5, true, false, true],
    ['iPhone の Chrome（CriOS）', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/127.0.6533.107 Mobile/15E148 Safari/604.1', 5, true, false, true],
    ['iPhone の Edge（EdgiOS）', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/127.2651.86 Mobile/15E148 Safari/605.1.15', 5, true, false, true],
    ['iPod touch', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1', 5, true, false, true],
    ['iPhone の LINE', UA.iosLine, 5, true, false, true],
    ['Android の Chrome', UA.androidChrome, 5, false, false, true],
    ['Android の LINE', UA.androidLine, 5, false, false, true],
    ['Android の Firefox', 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0', 5, false, false, true],
    ['Android タブレットの Chrome（Mobile なし）', 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36', 5, false, false, true],
    ['「Mobile」だけを含む携帯ブラウザ（KaiOS）', 'Mozilla/5.0 (Mobile; Nokia_8110_4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5', 1, false, false, true],
];

for (const [name, ua, tp, ios, mac, mobile] of DEVICES) {
    test(`端末の判定: ${name} → isIOS ${ios}・isMac ${mac}・isMobileOrTablet ${mobile}`, () => {
        assert.equal(isIOS(ua, tp), ios, 'isIOS');
        assert.equal(isMac(ua, tp), mac, 'isMac');
        assert.equal(isMobileOrTablet(ua, tp), mobile, 'isMobileOrTablet');
    });
}

test('端末の判定: maxTouchPoints が数でない（未定義・null・空・文字）ときはタッチなし（0）とみなす', () => {
    for (const tp of [undefined, null, '', 'abc', NaN]) {
        assert.equal(isIOS(MAC_SAFARI, tp), false, String(tp));
        assert.equal(isMac(MAC_SAFARI, tp), true, String(tp));
        assert.equal(isMobileOrTablet(MAC_SAFARI, tp), false, String(tp));
    }
    assert.equal(isIOS(MAC_SAFARI, '5'), true); // 数字の文字列は数として読む
});

test('端末の判定: UA が空・未定義でも落ちずに false', () => {
    for (const ua of ['', undefined, null]) {
        assert.equal(isIOS(ua, 5), false, String(ua));
        assert.equal(isMac(ua, 0), false, String(ua));
        assert.equal(isMobileOrTablet(ua, 5), false, String(ua));
    }
});

test('端末の判定: Macintosh の UA は isIOS と isMac のどちらか一方だけが true', () => {
    for (const tp of [0, 1, 2, 5, 10]) {
        assert.notEqual(isIOS(MAC_SAFARI, tp), isMac(MAC_SAFARI, tp), String(tp));
    }
});


// ---- アプリの中のブラウザ ----
const IA = {
    lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.0.0/IAB',
    worksIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LINEWORKS/4.2.0',
    worksAndroidWv: 'Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
    wkwebviewIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
    safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
};

test('isInAppBrowser: LINE・LINE WORKS・Facebook・Android の WebView・iPhone のアプリ内は true', () => {
    for (const k of ['lineIos', 'lineAndroid', 'worksIos', 'worksAndroidWv', 'wkwebviewIos', 'fbIos']) {
        assert.equal(isInAppBrowser(IA[k], false), true, k);
    }
});

test('isInAppBrowser: ふつうのブラウザは false（Safari・Chrome・Edge、PC とスマホ）', () => {
    for (const k of ['safariIos', 'chromeIos', 'chromeAndroid', 'chromeWin', 'edgeWin']) {
        assert.equal(isInAppBrowser(IA[k], false), false, k);
    }
});

test('isInAppBrowser: iPhone の「ホーム画面に追加」から開いたときは false（UA に Safari が無くても）', () => {
    assert.equal(isInAppBrowser(IA.wkwebviewIos, true), false);
    assert.equal(isInAppBrowser(IA.worksIos, true), true); // 名前で分かるアプリは、standalone でも案内する
});

test('isInAppBrowser: 空・null でも落ちない', () => {
    assert.equal(isInAppBrowser('', false), false);
    assert.equal(isInAppBrowser(null, false), false);
    assert.equal(isInAppBrowser(undefined), false);
});

test('chromeOpenUrl: Android は intent、iPhone は googlechromes、それ以外は空', () => {
    const href = 'https://demo-8bj.pages.dev/?diag=1';
    const a = chromeOpenUrl(IA.worksAndroidWv, href);
    assert.ok(a.startsWith('intent://demo-8bj.pages.dev/?diag=1#Intent;scheme=https;package=com.android.chrome;'));
    assert.ok(a.includes('S.browser_fallback_url=' + encodeURIComponent(href)));
    assert.ok(a.endsWith(';end'));
    assert.equal(chromeOpenUrl(IA.worksIos, href), 'googlechromes://demo-8bj.pages.dev/?diag=1');
    assert.equal(chromeOpenUrl(IA.chromeWin, href), '');
    assert.equal(chromeOpenUrl(IA.worksIos, 'not a url'), '');
});
