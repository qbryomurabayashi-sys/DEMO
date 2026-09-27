// removeFillers の単体テスト（プロジェクト直下で node --test test/*.test.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeFillers, tidyTranscript } from '../src/lib/filler.js';

// 消えるもの [入力, 期待]
const REMOVE = [
    // 指定の例
    ['えーと明日の件です', '明日の件です'],
    ['あのー、それは', 'それは'],
    ['えー、えーと、はい', 'はい'],
    ['それは、えーと、明日です', 'それは、明日です'],
    ['明日です、えーと', '明日です'],
    ['えー。', ''],
    ['えーー', ''],
    ['うーん、そうですね', 'そうですね'],
    ['んー', ''],
    ['えー3時から', '3時から'],
    ['えーえーと明日', '明日'],
    ['えーっと、そのー、予算の件', '予算の件'],
    ['ええと、明日', '明日'],
    ['', ''],
    // 追加の境界ケース
    ['えーと 明日', '明日'],                  // 半角スペースの区切りも一緒に消す
    ['えー\u3000明日', '明日'],              // 全角スペース
    ['はい。えーと', 'はい。'],               // 末尾の。は残す
    ['明日、えー、、3時', '明日、3時'],        // 区切りの重複は1つに
    ['あのーーー、それは', 'それは'],          // 長音の揺れ
    ['えーええと思う', 'ええと思う'],          // フィラーの後ろの「ええと思う」は守る
    ['えーあのうちに行く', 'あのうちに行く'],  // 別のフィラーの始まり＝右の境界。「あのうち」は残る
    ['えー！', ''],                            // 区切りしか残らない
    ['…えーと', ''],                          // 前にあった区切りだけが残る → 空
];

// そのまま残るもの（1文字も変わらない）
const KEEP = [
    // 指定の例
    'あの店に行く',
    'へえーそうなんだ',
    'あのうちに行く',
    'あーいう人',
    'ええとこやね',
    'ええと思います',
    'えっとね',
    'うーんそうですね',
    'ねえー',
    'それはえーと明日です',
    'まあいいか',
    'なんか変だ',
    'ええ、そうです',
    'はい',
    'その件は',
    'エート明日',
    // 追加の境界ケース
    'えっとー、明日',  // 長音が続く形は対象外（「えっと」だけ消して「ー」を残したりしない）
    '明日です、',      // フィラーが無ければ末尾の読点も触らない
    'んーん',          // 「いいえ」の意味
    'あーん',
];

for (const [input, expected] of REMOVE) {
    test(`消す: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
        assert.equal(removeFillers(input), expected);
    });
}

for (const input of KEEP) {
    test(`そのまま: ${JSON.stringify(input)}`, () => {
        assert.equal(removeFillers(input), input);
    });
}

test('null / undefined は空文字', () => {
    assert.equal(removeFillers(null), '');
    assert.equal(removeFillers(undefined), '');
});

// ---- tidyTranscript：空白で区切られた認識結果（Chrome の端末内認識の実測の形） ----

const ON = { removeFillers: true };
const OFF = { removeFillers: false };

// これまでの「消える」例を、実測と同じく単語ごとに空白で区切った形 [入力, 期待]。期待はこれまでと同じ
const SPACED_REMOVE = [
    ['えーと 明日 の 件 です', '明日の件です'],
    ['あのー 、 それ は', 'それは'],
    ['えー 、 えーと 、 はい', 'はい'],
    ['それ は 、 えーと 、 明日 です', 'それは、明日です'],
    ['明日 です 、 えーと', '明日です'],
    ['えー 。', ''],
    ['えーー', ''],
    ['うーん 、 そう です ね', 'そうですね'],
    ['んー', ''],
    ['えー 3 時 から', '3時から'],
    ['えー えーと 明日', '明日'],
    ['えーっと 、 そのー 、 予算 の 件', '予算の件'],
    ['ええと 、 明日', '明日'],
    ['はい 。 えーと', 'はい。'],
    ['明日 、 えー 、 、 3 時', '明日、3時'],
    ['あのーーー 、 それ は', 'それは'],
    ['えー ええ と 思う', 'ええと思う'],
    ['えー あの うち に 行く', 'あのうちに行く'],
    ['えー ！', ''],
    ['… えーと', ''],
    // 句読点が前の語にくっついて届く形
    ['あのー、 それ は', 'それは'],
    ['明日 です、 えーと', '明日です'],
    ['えー、、 3 時', '3時'],
    // 1語の中でフィラーが続く形（区切りをはさんでも）
    ['えーえーと 明日', '明日'],
    ['えー、えーと、 はい', 'はい'],
];

// これまでの「そのまま」の例を空白で区切った形 [入力, 期待]。期待は空白を詰めただけ（＝これまでの入力）
const SPACED_KEEP = [
    ['あの 店 に 行く', 'あの店に行く'],
    ['へえー そう な ん だ', 'へえーそうなんだ'],
    ['あの うち に 行く', 'あのうちに行く'],
    ['あーいう 人', 'あーいう人'],
    ['ええ とこ や ね', 'ええとこやね'],
    ['ええ と 思い ます', 'ええと思います'],
    ['えっとね 明日 は', 'えっとね明日は'],   // 1語の「えっとね」はフィラーまるごとではない
    ['ねえー', 'ねえー'],
    ['まあ いい か', 'まあいいか'],
    ['なんか 変 だ', 'なんか変だ'],
    ['ええ 、 そう です', 'ええ、そうです'],
    ['はい', 'はい'],
    ['その 件 は', 'その件は'],
    ['エート 明日', 'エート明日'],
    ['えっとー 、 明日', 'えっとー、明日'],
    ['明日 です 、', '明日です、'],
    ['んーん', 'んーん'],
    ['あーん', 'あーん'],
];

// これまでは「ひらがなが続くので迷ったら残す」だったが、空白で1語だと分かるので消える側になる3例
const SPACED_NOW_REMOVED = [
    ['えっと ね', 'ね'],
    ['うーん そう です ね', 'そうですね'],
    ['それ は えーと 明日 です', 'それは明日です'],
];

for (const [input, expected] of SPACED_REMOVE) {
    test(`空白区切り・消す: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
        assert.equal(tidyTranscript(input, ON), expected);
    });
}

for (const [input, expected] of SPACED_KEEP) {
    test(`空白区切り・残す: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
        assert.equal(tidyTranscript(input, ON), expected);
    });
}

for (const [input, expected] of SPACED_NOW_REMOVED) {
    test(`空白区切り・1語なので消す: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
        assert.equal(tidyTranscript(input, ON), expected);
    });
}

const MEASURED = 'えと 本日 の 定例 会議 を 始め ます 来週 の 月曜日 まで に 店舗 の 資料 を 作成 し て ください';

test('tidyTranscript: 実測の文。オンなら「えと」を消して空白を詰める', () => {
    assert.equal(tidyTranscript(MEASURED, ON), '本日の定例会議を始めます来週の月曜日までに店舗の資料を作成してください');
});

test('tidyTranscript: 実測の文。オフでも空白は詰める（「えと」は残す）', () => {
    assert.equal(tidyTranscript(MEASURED, OFF), 'えと本日の定例会議を始めます来週の月曜日までに店舗の資料を作成してください');
});

test('tidyTranscript: 数字を含む実測の文（オンもオフも同じ）', () => {
    const raw = '予算 は 30万円 です 以上 で 終わり ます';
    assert.equal(tidyTranscript(raw, ON), '予算は30万円です以上で終わります');
    assert.equal(tidyTranscript(raw, OFF), '予算は30万円です以上で終わります');
});

test('tidyTranscript: 「えと」1語だけなら、オンで空文字・オフでそのまま', () => {
    assert.equal(tidyTranscript('えと', ON), '');
    assert.equal(tidyTranscript(' えと ', ON), '');
    assert.equal(tidyTranscript('えと', OFF), 'えと');
});

test('tidyTranscript: 空白が無いときは「えと」を消さない', () => {
    const raw = '予算は30万円です以上で終わりますえと本日の定例会議を';
    assert.equal(tidyTranscript(raw, ON), raw);
    assert.equal(tidyTranscript('えと、明日', ON), 'えと、明日');
});

test('tidyTranscript: 単語の一部の「えと」は消さない', () => {
    assert.equal(tidyTranscript('まえと 同じ です', ON), 'まえと同じです');
    assert.equal(tidyTranscript('うえと した', ON), 'うえとした');
});

test('tidyTranscript: 空白を残すのは両側が英数字のときだけ（全角の英数字も）', () => {
    assert.equal(tidyTranscript('Google Meet の 会議', ON), 'Google Meetの会議');
    assert.equal(tidyTranscript('iPhone 15 で 録音 する', ON), 'iPhone 15で録音する');
    assert.equal(tidyTranscript('10 月 の 会議', ON), '10月の会議');
    assert.equal(tidyTranscript('ＱＢ ＨＯＵＳＥ の 店舗', ON), 'ＱＢ ＨＯＵＳＥの店舗');
});

test('tidyTranscript: 空白の種類・数・前後によらず詰める（全角スペースも）', () => {
    const zs = String.fromCharCode(0x3000);
    assert.equal(tidyTranscript('  本日 ' + zs + ' の   会議  ', OFF), '本日の会議');
    assert.equal(tidyTranscript('えー' + zs + '本日 の 会議', ON), '本日の会議');
});

test('tidyTranscript: オフならフィラーも区切りも残して、空白だけ詰める', () => {
    assert.equal(tidyTranscript('えー 、 えーと 、 はい', OFF), 'えー、えーと、はい');
    assert.equal(tidyTranscript('えーと 明日 の 件 です', OFF), 'えーと明日の件です');
    assert.equal(tidyTranscript('明日 です 、 えーと', OFF), '明日です、えーと');
});

test('tidyTranscript: 何も残らなければ空文字', () => {
    assert.equal(tidyTranscript('えー えーと あのー', ON), '');
    assert.equal(tidyTranscript('えと 。', ON), '');
    assert.equal(tidyTranscript('   ', ON), '');
    assert.equal(tidyTranscript('   ', OFF), '');
    assert.equal(tidyTranscript('', ON), '');
    assert.equal(tidyTranscript(null, ON), '');
    assert.equal(tidyTranscript(undefined, OFF), '');
});

test('tidyTranscript: removeFillers が true でなければ消さない（省略・1・"true" も）', () => {
    assert.equal(tidyTranscript('えー 明日'), 'えー明日');
    assert.equal(tidyTranscript('えー 明日', {}), 'えー明日');
    assert.equal(tidyTranscript('えー 明日', { removeFillers: 1 }), 'えー明日');
    assert.equal(tidyTranscript('えー 明日', { removeFillers: 'true' }), 'えー明日');
    assert.equal(tidyTranscript('えーと', null), 'えーと');
});

test('tidyTranscript: 空白の無い入力は removeFillers と同じ結果（これまでの例すべて）', () => {
    for (const [input] of REMOVE) assert.equal(tidyTranscript(input, ON), removeFillers(input), input);
    for (const input of KEEP) assert.equal(tidyTranscript(input, ON), removeFillers(input), input);
});
