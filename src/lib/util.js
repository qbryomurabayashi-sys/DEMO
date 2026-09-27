// 小さな共通関数 — ファイル名・日付・端末の判定（iPhone/Mac/スマホ）・LINE 内ブラウザ判定・版の比較・録音形式

function pad2(n) {
    return String(n).padStart(2, '0');
}

// ミリ秒 → Date。無効（数値でない・0以下・範囲外）なら今
function dateOrNow(ms) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        const d = new Date(ms);
        if (!isNaN(d.getTime())) return d;
    }
    return new Date();
}

// 前の空白と、後ろの空白・ドットを落とす
function trimName(s) {
    return s.replace(/^\s+/, '').replace(/[\s.]+$/, '');
}

// ファイル名に使えない文字（\ / : * ? " < > | と制御文字）を _ にする。
// 前後の空白と末尾のドットを除いて、50文字まで（絵文字も1文字と数える）。空なら fallback
export function sanitizeFilename(name, fallback = '会議') {
    let s = trimName(name == null ? '' : String(name));
    s = s.replace(/[\\/:*?"<>|\x00-\x1F\x7F-\x9F]/g, '_');
    s = trimName(Array.from(s).slice(0, 50).join(''));
    return s || fallback;
}

// 'YYYYMMDD'（端末のローカル日付）。ms が無効なら今日
export function ymd(ms) {
    const d = dateOrNow(ms);
    return String(d.getFullYear()).padStart(4, '0') + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

// 議事録_{会議名}_{YYYYMMDD}.doc（ms が無効なら今日の日付）
export function minutesDocFilename(title, ms) {
    return '議事録_' + sanitizeFilename(title) + '_' + ymd(ms) + '.doc';
}

// 仮の会議名 → '会議 2026/09/27 14:05'
export function provisionalTitle(ms) {
    const d = dateOrNow(ms);
    return '会議 ' + d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
        + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// LINE アプリの中のブラウザか（UA に「Line/」があるか。大文字小文字は区別する）
export function isLineInApp(ua) {
    return /\bLine\//.test(ua || '');
}

// アプリの中のブラウザ（LINE・LINE WORKS・Facebook など）か。録音と文字起こしが不安定・落ちることがあるので、Chrome へ案内する。
// - 名前で分かるもの：LINE（Line/）、LINE WORKS（LINEWORKS・worksmobile・NAVER の inapp）、Facebook、Instagram、KakaoTalk
// - Android：アプリに組み込まれたブラウザ（WebView）は UA に「; wv)」が入る
// - iPhone：アプリに組み込まれたブラウザは UA に「Safari/」が無い（Chrome・Firefox・Edge の iPhone 版は除く）。
//   ただし「ホーム画面に追加」したアプリも Safari/ が無いので、standalone（ホーム画面から開いた）なら対象外
export function isInAppBrowser(ua, standalone) {
    const s = String(ua || '');
    if (/\bLine\//.test(s)) return true;
    if (/LINEWORKS|worksmobile|NAVER\(inapp/i.test(s)) return true;
    if (/FBAN|FBAV|FB_IAB|Instagram|KAKAOTALK/i.test(s)) return true;
    if (/Android/.test(s) && /; wv\)/.test(s)) return true;
    const ios = /iPhone|iPad|iPod/.test(s);
    if (ios && !standalone && !/Safari\//.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(s)) return true;
    return false;
}

// タッチ点の数。数値でなければ 0（タッチなし）とみなす
function touchPoints(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

// iPhone・iPad・iPod か。デスクトップ表示の iPad は UA が Mac と同じ「Macintosh」になるので、
// maxTouchPoints が 2 以上かで見分ける（Mac は 0）
export function isIOS(userAgent, maxTouchPoints) {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && touchPoints(maxTouchPoints) > 1;
}

// Mac か（UA が「Macintosh」で maxTouchPoints が 1 以下。デスクトップ表示の iPad は含めない）
export function isMac(userAgent, maxTouchPoints) {
    const ua = String(userAgent || '');
    return /Macintosh/.test(ua) && !isIOS(ua, maxTouchPoints);
}

// スマホ・タブレットか（iPhone・iPad・iPod・Android と、UA に「Mobile」を含むほかの携帯ブラウザ）
export function isMobileOrTablet(userAgent, maxTouchPoints) {
    const ua = String(userAgent || '');
    return isIOS(ua, maxTouchPoints) || /Android|Mobile/.test(ua);
}

// LINE の中で開いたページを、外部ブラウザで開き直させる URL にする（?openExternalBrowser=1 を足す）。
// 既存のクエリ・ハッシュはそのまま。すでに付いていれば何も変えない。URL として読めなければそのまま返す。
export function withOpenExternalBrowser(href) {
    let u;
    try {
        u = new URL(href);
    } catch (e) {
        return href;
    }
    if (u.searchParams.has('openExternalBrowser')) return href;
    // searchParams.set だと既存のクエリが書き直される（空白→+ 等）ので、文字列で後ろに足す
    u.search = u.search ? u.search + '&openExternalBrowser=1' : '?openExternalBrowser=1';
    return u.href;
}

// '3.10.2' → [3, 10, 2]。「数字.数字.数字」（1〜3個）以外・未定義は 0.0.0
function parseVersion(v) {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v == null ? '' : String(v).trim());
    return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : [0, 0, 0];
}

// 版の比較（数値で比べる。'3.10.0' > '3.9.9'）→ a が古ければ -1、同じなら 0、新しければ 1
export function compareSemver(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}

// 「新しくなりました」のお知らせを出すか。
// 履歴が1件以上ある人（前の版から使っている人）で、この版のお知らせをまだ見ていないときだけ true
export function shouldShowUpdateToast(opts) {
    const o = opts || {};
    if (!(Number(o.sessionCount) >= 1)) return false;
    if (!o.seenVersion) return true;
    return compareSemver(o.seenVersion, o.currentVersion) < 0;
}

// 録音の形式の候補。上から順に試す
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

// 最初に使える形式を返す（isSupported は MediaRecorder.isTypeSupported など）。無ければ ''（ブラウザ任せ）
export function pickMimeType(isSupported) {
    if (typeof isSupported !== 'function') return '';
    for (let i = 0; i < MIME_CANDIDATES.length; i++) {
        try {
            if (isSupported(MIME_CANDIDATES[i]) === true) return MIME_CANDIDATES[i];
        } catch (e) {
            // 判定そのものが例外を出す端末がある。その候補は飛ばして次を試す
        }
    }
    return '';
}

// 録音ファイルの拡張子。mp4 を含めば m4a（iPhone）、ogg なら ogg、それ以外は webm
export function extForMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.indexOf('mp4') !== -1) return 'm4a';
    if (m.indexOf('ogg') !== -1) return 'ogg';
    return 'webm';
}
