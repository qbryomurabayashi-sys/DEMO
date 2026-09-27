// banner.js の単体テスト（node --test test/banner.test.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, srBannerFor, SR_ACTION_LABELS } from '../src/lib/banner.js';

const UA = {
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
    edgeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36 EdgA/154.0.0.0',
    edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/154.0 Mobile/15E148 Safari/605.1.15',
    firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0 Mobile/15E148 Safari/604.1',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 OPR/120.0.0.0',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.0.0/IAB',
};

test('detectBrowser: 主なブラウザを見分ける', () => {
    assert.equal(detectBrowser(UA.chromeWin), 'chrome');
    assert.equal(detectBrowser(UA.chromeIos), 'chrome');
    assert.equal(detectBrowser(UA.edgeWin), 'edge');
    assert.equal(detectBrowser(UA.edgeAndroid), 'edge');
    assert.equal(detectBrowser(UA.edgeIos), 'edge');
    assert.equal(detectBrowser(UA.firefoxWin), 'firefox');
    assert.equal(detectBrowser(UA.firefoxIos), 'firefox');
    assert.equal(detectBrowser(UA.safariMac), 'safari');
    assert.equal(detectBrowser(UA.safariIphone), 'safari');
});

test('detectBrowser: Chrome/ を含む別物（Opera・Samsung・LINE）は other', () => {
    assert.equal(detectBrowser(UA.opera), 'other');
    assert.equal(detectBrowser(UA.samsung), 'other');
    assert.equal(detectBrowser(UA.lineIos), 'other');
    assert.equal(detectBrowser(UA.lineAndroid), 'other');
});

test('detectBrowser: 空・null・数値でも落ちない', () => {
    assert.equal(detectBrowser(''), 'other');
    assert.equal(detectBrowser(null), 'other');
    assert.equal(detectBrowser(undefined), 'other');
    assert.equal(detectBrowser(123), 'other');
});

test('srBannerFor: 確認中と使えるときは出さない', () => {
    assert.equal(srBannerFor({ availability: 'checking' }), null);
    assert.equal(srBannerFor({ availability: 'available', browser: 'chrome' }), null);
    assert.equal(srBannerFor({ availability: 'available', isMobile: true }), null);
});

test('srBannerFor: 準備が要る・準備中・失敗', () => {
    assert.deepEqual(srBannerFor({ availability: 'downloadable', browser: 'chrome' }), { text: '文字起こしの準備（初回のみ）', action: 'install' });
    assert.deepEqual(srBannerFor({ availability: 'downloading', browser: 'chrome' }), { text: '準備中…', action: null });
    assert.deepEqual(srBannerFor({ availability: 'downloadable', installState: 'installing' }), { text: '準備中…', action: null });
    assert.deepEqual(srBannerFor({ availability: 'downloadable', installState: 'failed' }), { text: '準備できませんでした', action: 'retry' });
});

test('srBannerFor: スマホには「Chromeで開いて」を出さない', () => {
    for (const availability of ['no-api', 'unavailable']) {
        for (const browser of ['chrome', 'safari', 'edge', 'other']) {
            const b = srBannerFor({ availability, isMobile: true, browser });
            assert.deepEqual(b, { text: 'この端末は録音とメモのみ。文字起こしはパソコンの Chrome で', action: 'copyUrl' });
            assert.ok(!b.text.includes('Chrome で開いて'));
        }
    }
});

test('srBannerFor: PC の Chrome が自分で使えないとき', () => {
    assert.deepEqual(srBannerFor({ availability: 'no-api', browser: 'chrome' }), { text: 'Chrome を最新にすると文字起こしが使えます', action: null });
    assert.deepEqual(srBannerFor({ availability: 'unavailable', browser: 'chrome' }), { text: 'この Chrome では文字起こしが使えません（録音とメモは使えます）', action: null });
});

test('srBannerFor: PC の Chrome 以外は Chrome へ案内し、記録が残ることを添える', () => {
    for (const browser of ['edge', 'firefox', 'safari', 'other']) {
        for (const availability of ['no-api', 'unavailable', 'weird-value']) {
            assert.deepEqual(srBannerFor({ availability, browser }), {
                text: '文字起こしは Chrome で開いてください。今までの記録はこのブラウザに残ります',
                action: 'copyUrl',
            });
        }
    }
});

test('srBannerFor: 引数なしでも落ちない', () => {
    assert.deepEqual(srBannerFor(), { text: '文字起こしは Chrome で開いてください。今までの記録はこのブラウザに残ります', action: 'copyUrl' });
});

test('SR_ACTION_LABELS: ボタンの文言', () => {
    assert.deepEqual({ ...SR_ACTION_LABELS }, { copyUrl: 'URLをコピー', install: '準備する', retry: 'もう一度' });
    assert.ok(Object.isFrozen(SR_ACTION_LABELS));
});

test('画面に技術用語を出さない（どの帯の文にも available などが入らない）', () => {
    const words = ['available', 'downloadable', 'downloading', 'unavailable', 'processLocally', 'ネット経由'];
    const states = ['checking', 'available', 'downloadable', 'downloading', 'unavailable', 'no-api'];
    let seen = 0;
    for (const availability of states) {
        for (const installState of [null, 'installing', 'failed']) {
            for (const isMobile of [false, true]) {
                for (const browser of ['chrome', 'edge', 'other']) {
                    const b = srBannerFor({ availability, installState, isMobile, browser });
                    if (!b) continue;
                    seen++;
                    for (const w of words) assert.ok(!b.text.includes(w), `${b.text} に ${w}`);
                }
            }
        }
    }
    assert.ok(seen > 50, `見た帯の数 ${seen}`);
});
