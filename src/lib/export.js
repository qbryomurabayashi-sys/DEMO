// 書き出し — .txt の中身・ファイル名・時刻の表記（純関数。Blob を作る makeTextBlob だけはブラウザと node の両方で動く）

import { sanitizeFilename, ymd, extForMime } from './util.js';

const WEEKDAYS = '日月火水木金土';

function pad2(n) {
    return String(n).padStart(2, '0');
}

// ミリ秒 → Date。数値でない・0以下・範囲外は null
function toDate(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
}

function formatHM(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 'HH:MM:SS'（端末のローカル時刻）。ms が無効なら今
export function formatClock(ms) {
    const d = toDate(ms) || new Date();
    return formatHM(d) + ':' + pad2(d.getSeconds());
}

// 「日時：」の後ろの値。startedAt があれば「2026年9月27日(日) 14:05〜15:10（65分）」。
// 無ければ timestamp の日付だけ（旧レコードの timestamp は保存した時刻で、開始時刻ではないため）
export function formatSessionDate(session) {
    const ses = session || {};
    const start = toDate(ses.startedAt);
    const dateJa = (d) => d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WEEKDAYS.charAt(d.getDay()) + ')';
    if (!start) {
        const saved = toDate(ses.timestamp);
        return saved ? dateJa(saved) : '';
    }
    let s = dateJa(start) + ' ' + formatHM(start);
    const dur = ses.durationSec;
    if (typeof dur === 'number' && Number.isFinite(dur) && dur >= 0) {
        const end = new Date(start.getTime() + dur * 1000);
        const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
        s += '〜' + (sameDay ? '' : '翌') + formatHM(end) + '（' + (dur < 60 ? '1分未満' : Math.round(dur / 60) + '分') + '）';
    }
    return s;
}

// .txt の中身（'\n' 区切り。CRLF にするのは makeTextBlob）
export function buildTranscriptTxt(session) {
    const ses = session || {};
    const title = ses.title == null ? '' : String(ses.title).replace(/\s*[\r\n]+\s*/g, ' ').trim();
    const body = String(ses.text == null ? '' : ses.text)
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l);
    return [
        '会議名：' + title,
        '日時：' + formatSessionDate(ses),
        '（[00:00:00] は録音開始からの経過時間です）',
        '',
        ...(body.length ? body : ['（文字起こしはありません）']),
    ].join('\n');
}

// Windows のメモ帳で化けないよう、先頭に BOM を付け、改行を CRLF にする
export function makeTextBlob(str) {
    const crlf = String(str == null ? '' : str).replace(/\r\n|\r|\n/g, '\r\n');
    return new Blob(['\ufeff' + crlf], { type: 'text/plain;charset=utf-8' });
}

export function transcriptTxtFilename(title, ms) {
    return '文字起こし_' + sanitizeFilename(title) + '_' + ymd(ms) + '.txt';
}

export function audioFilename(title, ms, mime) {
    return '録音_' + sanitizeFilename(title) + '_' + ymd(ms) + '.' + extForMime(mime);
}
