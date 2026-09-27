// 言いよどみ（フィラー）の除去 — AI は使わないルール型
// 音声認識の確定結果1件ぶんから、明らかな言いよどみだけを消す。方針は「迷ったら消さない」。
// フィラーが1つも無い入力は、1文字も変えずにそのまま返す。

// 消す対象。上から順に照合するので、長いものを上に置く（「えーっと」を「えー」より先に見る）。
// 「ー+」は長音の揺れ（ーー 等）。
// あの／その／まあ／なんか／ええ／はい は、ふつうの言葉と見分けがつかないので入れない。
const FILLER_PATTERNS = [
    'えー+っと',
    'えー+と',
    'ええと',   // 関西弁「ええと思う」「ええとこ」を守るため、右の境界だけ厳しくしてある（isRightBoundary）
    'えっと',
    'えー+',
    'あのー+',
    'あのう',
    'そのー+',
    'うー+ん',
    'んー+',
    'あー+',
];
const FILLER_RE = new RegExp('^(?:' + FILLER_PATTERNS.join('|') + ')');

// 区切り＝半角スペース・全角スペース(\u3000)・、。，．,.！？!?…‥
const DELIM_RE = /[ \u3000、。，．,.！？!?…‥]/;
const ONLY_DELIMS_RE = /^[ \u3000、。，．,.！？!?…‥]*$/;
// 結果の末尾から落とすもの＝読点と空白（。！？ は残す）
const TRAILING_RE = /[、，, \u3000]+$/;
// ひらがな(\u3041-\u309F)。長音記号 ー(\u30FC)・波ダッシュ(\u301C, \uFF5E) もひらがなの続きとみなす
// （「えっとー」から「えっと」だけ消して「ー」が残る、を防ぐ）
const HIRAGANA_RE = /[\u3041-\u309F\u30FC\u301C\uFF5E]/;

// 右の境界＝文末・区切り・別のフィラーの始まり・ひらがな以外の文字。
// ひらがなが続くときは言葉の一部なので消さない（あのうち／あーいう／えっとね）。
// strict（「ええと」）のときは、文末・区切り・別のフィラーだけを境界にする。
function isRightBoundary(s, j, strict) {
    if (j >= s.length) return true;
    const c = s.charAt(j);
    if (DELIM_RE.test(c)) return true;
    if (FILLER_RE.test(s.slice(j))) return true;
    if (strict) return false;
    return !HIRAGANA_RE.test(c);
}

// 言いよどみを消した文字列を返す。区切りしか残らなければ ''（呼び出し側で捨てる）。
export function removeFillers(text) {
    const s = text == null ? '' : String(text);
    let out = '';
    let removed = false;
    let atLeft = true; // 左の境界にいるか（文頭・区切りの直後・消したフィラーの直後）
    let i = 0;
    while (i < s.length) {
        if (atLeft) {
            const m = FILLER_RE.exec(s.slice(i));
            if (m && isRightBoundary(s, i + m[0].length, m[0] === 'ええと')) {
                i += m[0].length;
                // 直後の区切りもまとめて消す（続けて並んでいれば全部。区切りの重複を残さない）
                while (i < s.length && DELIM_RE.test(s.charAt(i))) i++;
                removed = true;
                continue; // 消した直後も左の境界のまま（「えーえーと明日」を続けて消せる）
            }
        }
        const c = s.charAt(i);
        out += c;
        atLeft = DELIM_RE.test(c);
        i++;
    }
    if (!removed) return s;
    out = out.replace(TRAILING_RE, '');
    return ONLY_DELIMS_RE.test(out) ? '' : out;
}

// ---- 空白で区切られた認識結果の整形 ----
// Chrome の端末内の認識は、確定結果が単語ごとに半角空白で区切られて届く（句読点は付かない）。
// 空白があるときは1語ずつ見て、1語まるごとがフィラーのときだけ消す。空白は詰める（両側が英数字のときだけ残す）。

// 1語まるごとのときだけ消す言いよどみ＝上の FILLER_PATTERNS ＋「えと」。
// 「えと」は「まえと」「うえと」の中にも出てくるので、空白で区切られた1語のときしか消さない。
const WORD_FILLER = '(?:' + FILLER_PATTERNS.concat(['えと']).join('|') + ')';
// 1語が「フィラー（区切りをはさんで続いてもよい）＋後ろの区切り」だけでできているか
const WHOLE_FILLER_RE = new RegExp('^' + WORD_FILLER + '(?:' + DELIM_RE.source + '*' + WORD_FILLER + ')*' + DELIM_RE.source + '*$');
// 英数字（全角も）。両側がこれのときだけ空白を残す（「Google Meet」「iPhone 15」）
const ALNUM_RE = /[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]/;

// 単語をつなぐ。両側が英数字のときだけ半角空白を1つ入れる
function joinWords(words) {
    let out = '';
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (out && ALNUM_RE.test(out.charAt(out.length - 1)) && ALNUM_RE.test(w.charAt(0))) out += ' ';
        out += w;
    }
    return out;
}

// 認識結果1件を整える → 文字列。opts.removeFillers が true のときだけ言いよどみを消す（false でも空白は詰める）。
// 空白が無い入力は、これまでの removeFillers と同じ扱い（「えと」は1語まるごとのときだけ消す）。
// 何も残らなければ ''（呼び出し側で捨てる）。
export function tidyTranscript(raw, opts) {
    const drop = !!opts && opts.removeFillers === true;
    const words = String(raw == null ? '' : raw).split(/\s+/).filter((w) => w !== '');
    if (!words.length) return '';
    if (words.length === 1) {
        if (!drop) return words[0];
        return WHOLE_FILLER_RE.test(words[0]) ? '' : removeFillers(words[0]);
    }
    const kept = [];
    let removed = false;
    let afterFiller = false; // 直前の語がフィラーだった（続く区切りだけの語も一緒に消す）
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (drop && WHOLE_FILLER_RE.test(w)) {
            removed = true;
            afterFiller = true;
            continue;
        }
        if (afterFiller && ONLY_DELIMS_RE.test(w)) continue;
        afterFiller = false;
        kept.push(w);
    }
    const out = joinWords(kept);
    if (!removed) return out;
    const trimmed = out.replace(TRAILING_RE, '');
    return ONLY_DELIMS_RE.test(trimmed) ? '' : trimmed;
}
