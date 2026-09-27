// worddoc.js の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWordHtml, makeWordBlob } from '../src/lib/worddoc.js';
import { buildMinutes } from '../src/lib/minutes.js';

const BODY = [
    '会議名：10月シフト会議',
    '',
    '■決定事項',
    '・土日は2名体制にする（14:12）',
    '   ',
    '■まとめ',
].join('\n');

// <body> の中身を行ごとに取り出す
function bodyLines(html) {
    return html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>')).trim().split('\n');
}

test('makeWordBlob: 先頭3バイトが BOM（EF BB BF）', async () => {
    // text() は BOM を落とすので arrayBuffer で見る
    const bytes = new Uint8Array(await makeWordBlob('会議', BODY).arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xEF, 0xBB, 0xBF]);
});

test('makeWordBlob: type は application/msword。中身は BOM + buildWordHtml', async () => {
    const blob = makeWordBlob('会議', BODY);
    assert.equal(blob.type, 'application/msword');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    assert.equal(text, '\ufeff' + buildWordHtml('会議', BODY));
});

test('buildWordHtml: Word 用の名前空間・UTF-8・A4縦・游ゴシック・見出しの赤', () => {
    const html = buildWordHtml('会議', BODY);
    assert.ok(html.startsWith('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'));
    assert.ok(html.includes('<meta charset="utf-8">'));
    assert.ok(html.includes('A4 portrait'));
    assert.ok(html.includes('@page{size:A4 portrait;margin:20mm}'));
    assert.ok(html.includes('游ゴシック'));
    assert.ok(html.includes('body{font-family:"游ゴシック","Yu Gothic",sans-serif}'));
    assert.ok(html.includes('#C00000'));
    assert.ok(html.includes('h1,h2{color:#C00000}'));
    assert.ok(html.endsWith('</html>'));
});

test('buildWordHtml: <h1>議事録</h1> のあと、■行は h2・ほかは p・空行（空白だけの行も）は出さない', () => {
    assert.deepEqual(bodyLines(buildWordHtml('会議', BODY)), [
        '<h1>議事録</h1>',
        '<p>会議名：10月シフト会議</p>',
        '<h2>■決定事項</h2>',
        '<p>・土日は2名体制にする（14:12）</p>',
        '<h2>■まとめ</h2>',
    ]);
});

test('buildWordHtml: タイトルと本文の <script> はエスケープされる', () => {
    const html = buildWordHtml('<script>alert(1)</script>', '<script>alert(2)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>'));
    assert.ok(html.includes('<p>&lt;script&gt;alert(2)&lt;/script&gt;</p>'));
});

test('buildWordHtml: & < > " \' をすべてエスケープする（■見出しの中も）', () => {
    const html = buildWordHtml('A&B "q" \'s\'', 'A&B <b> "q" \'s\'\n■見出し<i>&');
    assert.ok(html.includes('<title>A&amp;B &quot;q&quot; &#39;s&#39;</title>'));
    assert.ok(html.includes('<p>A&amp;B &lt;b&gt; &quot;q&quot; &#39;s&#39;</p>'));
    assert.ok(html.includes('<h2>■見出し&lt;i&gt;&amp;</h2>'));
});

test('buildWordHtml: 本文もタイトルも空でも壊れない', () => {
    const html = buildWordHtml('', '');
    assert.deepEqual(bodyLines(html), ['<h1>議事録</h1>']);
    assert.ok(html.includes('<title></title>'));
    assert.deepEqual(bodyLines(buildWordHtml(null, null)), ['<h1>議事録</h1>']);
});

test('buildWordHtml: buildMinutes の出力をそのまま渡すと、■の見出し6つが h2 になる', () => {
    const minutes = buildMinutes({ title: 'x', text: '[00:00:01] こんにちは', startedAt: new Date(2026, 8, 27, 14, 5, 10).getTime() });
    const lines = bodyLines(buildWordHtml('x', minutes));
    assert.deepEqual(lines.filter((l) => l.startsWith('<h2>')), [
        '<h2>■概要</h2>',
        '<h2>■決定事項</h2>',
        '<h2>■ToDo（担当／期限）</h2>',
        '<h2>■重要メモ</h2>',
        '<h2>■まとめ</h2>',
        '<h2>■文字起こし（全文）</h2>',
    ]);
    assert.ok(lines.includes('<p>[14:05:11] こんにちは</p>'));
});
