// 議事録の組み立て — 重要メモ・決定・ToDo の行の読み書きと、議事録の雛形
// 文字起こしの本文は「[経過 hh:mm:ss] 発言」の行の並び。メモも同じ本文に
// 「[hh:mm:ss] 【決定】 本文」の形で1行ずつ入る（v3.0.0 の【重要メモ】行もそのまま読める）。

export const MEMO_LABELS = { memo: '重要メモ', decision: '決定', todo: 'ToDo' };

const LABEL_TO_TYPE = { '重要メモ': 'memo', '決定': 'decision', 'ToDo': 'todo' };
// メモの行。時刻は hh:mm:ss（それより前の版の mm:ss も読む）
const MEMO_LINE_RE = /^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*【(重要メモ|決定|ToDo)】\s*(.*)$/;
const STAMP_RE = /^(\d{2}):(\d{2}):(\d{2})$/;
const LEADING_STAMP_RE = /^\[(\d{2}:\d{2}:\d{2})\]/;
const WEEKDAYS = '日月火水木金土';
const NONE = '（なし）';

function pad2(n) {
    return String(n).padStart(2, '0');
}

// ミリ秒 → Date。数値でない・0以下・範囲外は null
function toDate(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
}

function addSec(d, sec) {
    return new Date(d.getTime() + sec * 1000);
}

// 2026年9月27日(日)
function formatDateJa(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WEEKDAYS.charAt(d.getDay()) + ')';
}

function formatHM(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatHMS(d) {
    return formatHM(d) + ':' + pad2(d.getSeconds());
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 改行を半角空白にして1行にし、前後の空白を落とす
function oneLine(v) {
    return v == null ? '' : String(v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

// メモ1件を本文に足す形にする → '\n[00:07:00] 【決定】 本文\n'
// 本文が空なら ''。未知の type は重要メモ扱い。
export function formatMemoLine(type, stamp, body) {
    const text = oneLine(body);
    if (!text) return '';
    const label = Object.prototype.hasOwnProperty.call(MEMO_LABELS, type) ? MEMO_LABELS[type] : MEMO_LABELS.memo;
    return '\n[' + (stamp == null ? '' : stamp) + '] 【' + label + '】 ' + text + '\n';
}

// 本文からメモの行を読み出す → [{ type, stamp, body }]（出現順）
// stamp は hh:mm:ss のときだけ文字列。mm:ss（古い形式）は null。本文が空の行は捨てる。
export function parseMemos(text) {
    const result = [];
    if (text == null) return result;
    const lines = String(text).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = MEMO_LINE_RE.exec(lines[i].trim());
        if (!m) continue;
        const body = m[3].trim();
        if (!body) continue;
        result.push({
            type: LABEL_TO_TYPE[m[2]],
            stamp: m[1].length === 8 ? m[1] : null,
            body: body,
        });
    }
    return result;
}

// 'hh:mm:ss' または '[hh:mm:ss]' → 秒。形式外（分・秒が60以上も含む）は null
export function stampToSec(s) {
    if (typeof s !== 'string') return null;
    let t = s;
    if (t.charAt(0) === '[' && t.charAt(t.length - 1) === ']') t = t.slice(1, -1);
    const m = STAMP_RE.exec(t);
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3]);
    if (mi > 59 || se > 59) return null;
    return h * 3600 + mi * 60 + se;
}

// 秒 → 'hh:mm:ss'。負は0、小数は切り捨て
export function secToStamp(sec) {
    let n = Math.floor(Number(sec));
    if (!Number.isFinite(n) || n < 0) n = 0;
    return pad2(Math.floor(n / 3600)) + ':' + pad2(Math.floor((n % 3600) / 60)) + ':' + pad2(n % 60);
}

// 本文中の [hh:mm:ss] の最大値（秒）。1つも無ければ null
export function lastStampSec(text) {
    if (text == null) return null;
    const s = String(text);
    const re = /\[(\d{2}:\d{2}:\d{2})\]/g;
    let max = null;
    let m;
    while ((m = re.exec(s)) !== null) {
        const sec = stampToSec(m[1]);
        if (sec !== null && (max === null || sec > max)) max = sec;
    }
    return max;
}

// 「日時：」の中身。startedAt があれば「日付 開始〜終了（N分）」。
// 無ければ timestamp から日付だけ（旧レコードの timestamp は保存した時刻で、開始時刻ではないため）。
function whenText(ses) {
    const start = toDate(ses.startedAt);
    if (!start) {
        const saved = toDate(ses.timestamp);
        return saved ? formatDateJa(saved) : '';
    }
    let s = formatDateJa(start) + ' ' + formatHM(start);
    const dur = ses.durationSec;
    if (typeof dur === 'number' && Number.isFinite(dur) && dur >= 0) {
        const end = addSec(start, dur);
        const mins = dur < 60 ? '1分未満' : Math.round(dur / 60) + '分';
        s += '〜' + (isSameDay(start, end) ? '' : '翌') + formatHM(end) + '（' + mins + '）';
    }
    return s;
}

// 決定1件。開始時刻と hh:mm:ss が両方分かるときだけ（HH:MM）を付ける
function decisionLine(memo, start) {
    const sec = stampToSec(memo.stamp);
    const time = (start && sec !== null) ? '（' + formatHM(addSec(start, sec)) + '）' : '';
    return '・' + memo.body + time;
}

// 全文。空行を除いて1行ずつ。開始時刻が分かれば、行頭の経過 [hh:mm:ss] を実時刻 [HH:MM:SS] に置き換える
// （24時を超えたら日付をまたいだ時刻＝24で割った余りになる）
function transcriptLines(text, start) {
    const out = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!start) {
            out.push(line);
            continue;
        }
        out.push(line.replace(LEADING_STAMP_RE, (whole, hms) => {
            const sec = stampToSec(hms);
            return sec === null ? whole : '[' + formatHMS(addSec(start, sec)) + ']';
        }));
    }
    return out;
}

// 0件の見出しには「（なし）」を1行入れる
function orNone(items) {
    return items.length ? items : [NONE];
}

// 議事録の雛形を組み立てる（末尾に改行は付けない）
// session = { title?, text?, timestamp?, startedAt?, durationSec? }（旧レコードは title/text/timestamp だけ）
export function buildMinutes(session) {
    const ses = session || {};
    const start = toDate(ses.startedAt);
    const text = ses.text == null ? '' : String(ses.text);
    const decisions = [];
    const todos = [];
    const notes = [];
    parseMemos(text).forEach((m) => {
        if (m.type === 'decision') decisions.push(decisionLine(m, start));
        else if (m.type === 'todo') todos.push('・' + m.body + '（担当：\u3000／期限：\u3000）'); // \u3000＝全角スペース
        else notes.push('・' + m.body);
    });
    const lines = [
        '会議名：' + oneLine(ses.title),
        '日時：' + whenText(ses),
        '参加者：',
        '場所：',
        '',
        '■概要',
        '（ここに一言で）',
        '',
        '■決定事項',
        ...orNone(decisions),
        '',
        '■ToDo（担当／期限）',
        ...orNone(todos),
        '',
        '■重要メモ',
        ...orNone(notes),
        '',
        '■まとめ',
        '（次回までに／次回日程など）',
        '',
        '■文字起こし（全文）',
        ...orNone(transcriptLines(text, start)),
    ];
    return lines.join('\n');
}
