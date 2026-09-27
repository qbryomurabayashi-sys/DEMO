// 文字起こしの帯 — ブラウザの見分けと、帯に出す文とボタンを決める（純関数）
// 文字起こしが使えるかどうかは available() の結果だけで決める。ブラウザの見分けは、使えないときの文を選ぶためだけに使う。

export const SR_ACTION_LABELS = Object.freeze({ copyUrl: 'URLをコピー', install: '準備する', retry: 'もう一度' });

// UA → 'chrome' | 'edge' | 'firefox' | 'safari' | 'other'
// Edge・Opera・Samsung・LINE も UA に「Chrome/」を含むので、先に見分ける
export function detectBrowser(ua) {
    const s = String(ua || '');
    if (/Edg\/|EdgA\/|EdgiOS\//.test(s)) return 'edge';
    if (/Firefox\/|FxiOS\//.test(s)) return 'firefox';
    if (/OPR\/|SamsungBrowser\/|Line\//.test(s)) return 'other';
    if (/CriOS\//.test(s)) return 'chrome';
    if (/Chrome\//.test(s)) return 'chrome';
    if (/Version\/.*Safari\//.test(s)) return 'safari';
    return 'other';
}

// 帯の中身 → null（出さない）| { text, action }（action は null | 'copyUrl' | 'install' | 'retry'）
// availability：'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api'
// installState：null | 'installing' | 'failed'
export function srBannerFor({ availability, installState = null, isMobile = false, browser = 'other' } = {}) {
    if (installState === 'installing' || availability === 'downloading') return { text: '準備中…', action: null };
    if (installState === 'failed') return { text: '準備できませんでした', action: 'retry' };
    if (availability === 'checking' || availability === 'available') return null;
    if (availability === 'downloadable') return { text: '文字起こしの準備（初回のみ）', action: 'install' };
    // 'no-api' / 'unavailable' / 想定外の値
    if (isMobile) return { text: 'この端末は録音とメモのみ。文字起こしはパソコンの Chrome で', action: 'copyUrl' };
    if (browser === 'chrome') {
        if (availability === 'no-api') return { text: 'Chrome を最新にすると文字起こしが使えます', action: null };
        return { text: 'この Chrome では文字起こしが使えません（録音とメモは使えます）', action: null };
    }
    return { text: '文字起こしは Chrome で開いてください。今までの記録はこのブラウザに残ります', action: 'copyUrl' };
}
