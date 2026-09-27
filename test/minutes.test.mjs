// minutes.js の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
// 日時はすべてローカル時刻で作る（タイムゾーンに依存させない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMO_LABELS,
    formatMemoLine,
    parseMemos,
    stampToSec,
    secToStamp,
    lastStampSec,
    buildMinutes,
} from '../src/lib/minutes.js';

const START = new Date(2026, 8, 27, 14, 5, 10).getTime(); // 2026-09-27(日) 14:05:10

// 新しいレコードの本文（アプリと同じく、発言とメモの行が空行をはさんで並ぶ。最後は v3.0.0 の【重要メモ】行）
const NEW_TEXT = [
    '[00:00:00] 本日は10月のシフトについてです',
    '',
    '[00:07:00] 【決定】 土日は2名体制にする',
    '',
    '[00:08:15] 次は備品の件です',
    '',
    '[00:09:00] 【ToDo】 シフト表を作って共有',
    '',
    '[00:10:00] 【重要メモ】 予算は据え置き',
].join('\n');

// 見出しの次の行
function after(lines, heading) {
    const i = lines.indexOf(heading);
    assert.notEqual(i, -1, heading + ' が無い');
    return lines[i + 1];
}

// ---- buildMinutes ----

test('buildMinutes: 新レコードの雛形全体が一致する', () => {
    const out = buildMinutes({
        title: '10月シフト会議',
        text: NEW_TEXT,
        startedAt: START,
        durationSec: 3900,
        timestamp: START + 3900 * 1000,
    });
    const expected = [
        '会議名：10月シフト会議',
        '日時：2026年9月27日(日) 14:05〜15:10（65分）',
        '参加者：',
        '場所：',
        '',
        '■概要',
        '（ここに一言で）',
        '',
        '■決定事項',
        '・土日は2名体制にする（14:12）',
        '',
        '■ToDo（担当／期限）',
        '・シフト表を作って共有（担当：\u3000／期限：\u3000）',
        '',
        '■重要メモ',
        '・予算は据え置き',
        '',
        '■まとめ',
        '（次回までに／次回日程など）',
        '',
        '■文字起こし（全文）',
        '[14:05:10] 本日は10月のシフトについてです',
        '[14:12:10] 【決定】 土日は2名体制にする',
        '[14:13:25] 次は備品の件です',
        '[14:14:10] 【ToDo】 シフト表を作って共有',
        '[14:15:10] 【重要メモ】 予算は据え置き',
    ].join('\n');
    assert.equal(out, expected);
});

test('buildMinutes: 日時の「〜」は波ダッシュ(U+301C)', () => {
    const line = buildMinutes({ startedAt: START, durationSec: 3900 }).split('\n')[1];
    assert.ok(line.includes('\u301C'), line);
});

test('buildMinutes: 旧レコード（title/text/timestamp だけ）は日付だけ・決定に時刻なし・全文そのまま', () => {
    const saved = new Date(2026, 7, 14, 18, 40, 0).getTime(); // 2026-08-14(金) 18:40 に保存
    const text = '[00:00:05] おはようございます\n\n[00:03:00] 【重要メモ】 来週は棚卸し\n\n[00:04:00] 【決定】 開店前に清掃';
    const lines = buildMinutes({ title: '朝礼', text: text, timestamp: saved }).split('\n');
    assert.equal(lines[0], '会議名：朝礼');
    assert.equal(lines[1], '日時：2026年8月14日(金)');
    assert.equal(after(lines, '■決定事項'), '・開店前に清掃');
    assert.equal(after(lines, '■ToDo（担当／期限）'), '（なし）');
    assert.equal(after(lines, '■重要メモ'), '・来週は棚卸し');
    const j = lines.indexOf('■文字起こし（全文）');
    assert.deepEqual(lines.slice(j + 1), [
        '[00:00:05] おはようございます',
        '[00:03:00] 【重要メモ】 来週は棚卸し',
        '[00:04:00] 【決定】 開店前に清掃',
    ]);
});

test('buildMinutes: 項目が0件の見出しは次の行が（なし）', () => {
    const lines = buildMinutes({ title: 'テスト', text: '[00:00:01] こんにちは', startedAt: START }).split('\n');
    assert.equal(after(lines, '■決定事項'), '（なし）');
    assert.equal(after(lines, '■ToDo（担当／期限）'), '（なし）');
    assert.equal(after(lines, '■重要メモ'), '（なし）');
    assert.equal(after(lines, '■文字起こし（全文）'), '[14:05:11] こんにちは');
    // durationSec が無ければ開始時刻まで
    assert.equal(lines[1], '日時：2026年9月27日(日) 14:05');
});

test('buildMinutes: durationSec が60秒未満なら「1分未満」', () => {
    const lines = buildMinutes({ title: '短い会議', text: '', startedAt: START, durationSec: 30 }).split('\n');
    assert.equal(lines[1], '日時：2026年9月27日(日) 14:05〜14:05（1分未満）');
});

test('buildMinutes: 日をまたいだら終了時刻の前に「翌」。全文の時刻も24時で折り返す', () => {
    const late = new Date(2026, 8, 27, 23, 30, 0).getTime();
    const text = '[00:10:00] 始めます\n\n[00:45:30] 延長します\n\n[00:50:00] 【決定】 続きは明日';
    const lines = buildMinutes({ title: '夜の会議', text: text, startedAt: late, durationSec: 3600 }).split('\n');
    assert.equal(lines[1], '日時：2026年9月27日(日) 23:30〜翌00:30（60分）');
    assert.equal(after(lines, '■決定事項'), '・続きは明日（00:20）');
    const j = lines.indexOf('■文字起こし（全文）');
    assert.deepEqual(lines.slice(j + 1), [
        '[23:40:00] 始めます',
        '[00:15:30] 延長します',
        '[00:20:00] 【決定】 続きは明日',
    ]);
});

test('buildMinutes: text が空なら全文は（なし）。title も日時も無ければ「会議名：」「日時：」のまま', () => {
    const lines = buildMinutes({ text: '' }).split('\n');
    assert.equal(lines[0], '会議名：');
    assert.equal(lines[1], '日時：');
    assert.deepEqual(lines.slice(-2), ['■文字起こし（全文）', '（なし）']);
    assert.equal(buildMinutes({}), buildMinutes({ text: '' }));
    assert.equal(buildMinutes(null), buildMinutes({ text: '' }));
});

test('buildMinutes: 決定の時刻が mm:ss（古い形式）なら時刻の括弧を付けない', () => {
    const lines = buildMinutes({ title: 'x', text: '[07:00] 【決定】 古い形式の決定', startedAt: START }).split('\n');
    assert.equal(after(lines, '■決定事項'), '・古い形式の決定');
    assert.equal(after(lines, '■文字起こし（全文）'), '[07:00] 【決定】 古い形式の決定');
});

test('buildMinutes: 末尾に改行を付けない・CRLF の本文も読める', () => {
    const out = buildMinutes({ title: 'x', text: NEW_TEXT.replace(/\n/g, '\r\n'), startedAt: START });
    assert.ok(!out.endsWith('\n'));
    assert.ok(!out.includes('\r'));
    assert.equal(after(out.split('\n'), '■決定事項'), '・土日は2名体制にする（14:12）');
});

// ---- formatMemoLine ----

test('MEMO_LABELS は 重要メモ／決定／ToDo', () => {
    assert.deepEqual(MEMO_LABELS, { memo: '重要メモ', decision: '決定', todo: 'ToDo' });
});

test('formatMemoLine: 前後に改行が付いた1行になる', () => {
    assert.equal(formatMemoLine('decision', '00:07:00', '土日は2名体制'), '\n[00:07:00] 【決定】 土日は2名体制\n');
    assert.equal(formatMemoLine('todo', '00:09:00', '発注する'), '\n[00:09:00] 【ToDo】 発注する\n');
    assert.equal(formatMemoLine('memo', '00:10:00', '予算'), '\n[00:10:00] 【重要メモ】 予算\n');
});

test('formatMemoLine: 本文の改行は半角空白につぶし、前後は trim', () => {
    assert.equal(
        formatMemoLine('todo', '00:09:00', '  シフト表を\n作って\r\n共有  '),
        '\n[00:09:00] 【ToDo】 シフト表を 作って 共有\n'
    );
});

test('formatMemoLine: 本文が空・空白だけ・改行だけなら空文字', () => {
    assert.equal(formatMemoLine('decision', '00:07:00', ''), '');
    assert.equal(formatMemoLine('decision', '00:07:00', '  \n\u3000 '), '');
    assert.equal(formatMemoLine('decision', '00:07:00', null), '');
    assert.equal(formatMemoLine('decision', '00:07:00', undefined), '');
});

test('formatMemoLine: 未知の type は重要メモ扱い', () => {
    assert.equal(formatMemoLine('other', '00:01:00', 'x'), '\n[00:01:00] 【重要メモ】 x\n');
    assert.equal(formatMemoLine('toString', '00:01:00', 'x'), '\n[00:01:00] 【重要メモ】 x\n');
    assert.equal(formatMemoLine(undefined, '00:01:00', 'x'), '\n[00:01:00] 【重要メモ】 x\n');
});

// ---- parseMemos ----

test('parseMemos: 3種類を出現順に読む（旧【重要メモ】行も）。発言の行は読まない', () => {
    assert.deepEqual(parseMemos(NEW_TEXT), [
        { type: 'decision', stamp: '00:07:00', body: '土日は2名体制にする' },
        { type: 'todo', stamp: '00:09:00', body: 'シフト表を作って共有' },
        { type: 'memo', stamp: '00:10:00', body: '予算は据え置き' },
    ]);
});

test('parseMemos: 2桁（mm:ss）の時刻は stamp が null', () => {
    assert.deepEqual(parseMemos('[07:00] 【重要メモ】 古い形式のメモ'), [
        { type: 'memo', stamp: null, body: '古い形式のメモ' },
    ]);
});

test('parseMemos: 本文が空の行は捨てる。空文字・null は []', () => {
    assert.deepEqual(parseMemos('[00:01:00] 【決定】 \n[00:02:00] 【ToDo】'), []);
    assert.deepEqual(parseMemos(''), []);
    assert.deepEqual(parseMemos(null), []);
});

test('parseMemos: formatMemoLine で書いたものを読み戻せる（CRLF でも）', () => {
    const text = ('[00:00:00] 発言' + formatMemoLine('todo', '00:03:00', '発注する') + formatMemoLine('decision', '01:02:03', '承認'))
        .replace(/\n/g, '\r\n');
    assert.deepEqual(parseMemos(text), [
        { type: 'todo', stamp: '00:03:00', body: '発注する' },
        { type: 'decision', stamp: '01:02:03', body: '承認' },
    ]);
});

// ---- 時刻の変換 ----

test('stampToSec: hh:mm:ss と [hh:mm:ss] を秒に。形式外は null', () => {
    assert.equal(stampToSec('00:07:00'), 420);
    assert.equal(stampToSec('[01:02:03]'), 3723);
    assert.equal(stampToSec('07:00'), null);
    assert.equal(stampToSec('00:60:00'), null);
    assert.equal(stampToSec('0:07:00'), null);
    assert.equal(stampToSec('[00:07:00'), null);
    assert.equal(stampToSec(''), null);
    assert.equal(stampToSec(null), null);
    assert.equal(stampToSec(420), null);
});

test('secToStamp: 秒を hh:mm:ss に。負は0、小数は切り捨て', () => {
    assert.equal(secToStamp(0), '00:00:00');
    assert.equal(secToStamp(3723), '01:02:03');
    assert.equal(secToStamp(59.9), '00:00:59');
    assert.equal(secToStamp(-5), '00:00:00');
    assert.equal(secToStamp(NaN), '00:00:00');
    assert.equal(secToStamp(undefined), '00:00:00');
    assert.equal(secToStamp(90000), '25:00:00');
});

test('stampToSec と secToStamp は往復で元に戻る', () => {
    for (const sec of [0, 1, 59, 60, 3599, 3600, 3723, 86399]) {
        assert.equal(stampToSec(secToStamp(sec)), sec);
    }
});

test('lastStampSec: 本文中の [hh:mm:ss] の最大値。無ければ null', () => {
    assert.equal(lastStampSec('[00:01:00] a\n[00:10:00] b\n[00:05:00] c'), 600);
    assert.equal(lastStampSec(NEW_TEXT), 600);
    assert.equal(lastStampSec('[07:00] 古い形式だけ'), null);
    assert.equal(lastStampSec('時刻なし'), null);
    assert.equal(lastStampSec(''), null);
    assert.equal(lastStampSec(null), null);
});
