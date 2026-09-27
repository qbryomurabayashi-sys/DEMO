// export.js の単体テスト（node --test test/export.test.mjs）。日時はローカル時刻で作る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatClock, formatSessionDate, buildTranscriptTxt, makeTextBlob, transcriptTxtFilename, audioFilename,
} from '../src/lib/export.js';

const T = new Date(2026, 8, 27, 14, 5, 9).getTime(); // 2026/09/27(日) 14:05:09

test('formatClock: HH:MM:SS', () => {
    assert.equal(formatClock(T), '14:05:09');
    assert.equal(formatClock(new Date(2026, 0, 1, 0, 0, 0).getTime()), '00:00:00');
    assert.match(formatClock(undefined), /^\d{2}:\d{2}:\d{2}$/);
});

test('formatSessionDate: 開始と長さが分かるとき', () => {
    assert.equal(formatSessionDate({ startedAt: T, durationSec: 3900 }), '2026年9月27日(日) 14:05〜15:10（65分）');
    assert.equal(formatSessionDate({ startedAt: T, durationSec: 30 }), '2026年9月27日(日) 14:05〜14:05（1分未満）');
    assert.equal(formatSessionDate({ startedAt: new Date(2026, 8, 27, 23, 30).getTime(), durationSec: 3600 }), '2026年9月27日(日) 23:30〜翌00:30（60分）');
});

test('formatSessionDate: 長さが無い・旧レコード・空', () => {
    assert.equal(formatSessionDate({ startedAt: T }), '2026年9月27日(日) 14:05');
    assert.equal(formatSessionDate({ timestamp: T }), '2026年9月27日(日)');
    assert.equal(formatSessionDate({}), '');
    assert.equal(formatSessionDate(null), '');
});

test('buildTranscriptTxt: 形', () => {
    const text = '\n[00:00:05] 本日の定例会議を始めます\n\n[00:01:00] 【決定】 土日は2名体制\n  \n';
    assert.equal(buildTranscriptTxt({ title: '定例会', startedAt: T, durationSec: 600, text }), [
        '会議名：定例会',
        '日時：2026年9月27日(日) 14:05〜14:15（10分）',
        '（[00:00:00] は録音開始からの経過時間です）',
        '',
        '[00:00:05] 本日の定例会議を始めます',
        '[00:01:00] 【決定】 土日は2名体制',
    ].join('\n'));
});

test('buildTranscriptTxt: 本文が空・旧レコード', () => {
    const out = buildTranscriptTxt({ title: '面談', timestamp: T, text: '' });
    assert.ok(out.endsWith('\n\n（文字起こしはありません）'));
    assert.ok(out.startsWith('会議名：面談\n日時：2026年9月27日(日)\n'));
    assert.ok(buildTranscriptTxt(null).includes('（文字起こしはありません）'));
});

test('buildTranscriptTxt: 会議名の改行は1行につぶす', () => {
    assert.ok(buildTranscriptTxt({ title: '定例\r\n会議', text: 'x' }).startsWith('会議名：定例 会議\n'));
});

test('makeTextBlob: 先頭に BOM、改行は CRLF、UTF-8', async () => {
    const blob = makeTextBlob('a\nb\r\nc\rd');
    assert.equal(blob.type, 'text/plain;charset=utf-8');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
    assert.equal(new TextDecoder().decode(bytes.slice(3)), 'a\r\nb\r\nc\r\nd');
    const jp = new Uint8Array(await makeTextBlob('会議').arrayBuffer());
    assert.equal(new TextDecoder().decode(jp.slice(3)), '会議');
});

test('ファイル名：文字と音声が同じ土台で対になる', () => {
    assert.equal(transcriptTxtFilename('定例会', T), '文字起こし_定例会_20260927.txt');
    assert.equal(audioFilename('定例会', T, 'audio/webm;codecs=opus'), '録音_定例会_20260927.webm');
    assert.equal(audioFilename('定例会', T, 'audio/mp4'), '録音_定例会_20260927.m4a');
    assert.equal(audioFilename('定例会', T, ''), '録音_定例会_20260927.webm');
    assert.equal(transcriptTxtFilename('a/b:c*?', T), '文字起こし_a_b_c___20260927.txt'); // a_b_c__ ＋ 区切りの _
    assert.equal(transcriptTxtFilename('', T), '文字起こし_会議_20260927.txt');
});
