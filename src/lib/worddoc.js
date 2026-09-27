// Word で開ける議事録ファイル（.doc）を作る
// 中身は Word が読める HTML。ライブラリなしで作れて、スマホでもそのまま保存できる。
// 先頭に BOM(\ufeff) を付けて、Word に UTF-8 だと伝える（無いと文字化けすることがある）。

const STYLE =
    '@page{size:A4 portrait;margin:20mm}' +
    'body{font-family:"游ゴシック","Yu Gothic",sans-serif}' +
    'h1,h2{color:#C00000}';

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

// Word 用の HTML を組み立てる。
// 本文は1行ずつ：「■」で始まる行は見出し(h2)、ほかの行は段落(p)、空行は出さない。すべてエスケープする。
export function buildWordHtml(title, bodyText) {
    const parts = ['<h1>議事録</h1>'];
    const lines = String(bodyText == null ? '' : bodyText).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const tag = line.charAt(0) === '■' ? 'h2' : 'p';
        parts.push('<' + tag + '>' + escapeHtml(line) + '</' + tag + '>');
    }
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n'
        + '<head>\n'
        + '<meta charset="utf-8">\n'
        + '<title>' + escapeHtml(title == null ? '' : title) + '</title>\n'
        + '<style>' + STYLE + '</style>\n'
        + '</head>\n'
        + '<body>\n' + parts.join('\n') + '\n</body>\n'
        + '</html>';
}

// 保存用の Blob（.doc）。先頭に BOM を付ける
export function makeWordBlob(title, bodyText) {
    return new Blob(['\ufeff' + buildWordHtml(title, bodyText)], { type: 'application/msword' });
}
