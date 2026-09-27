# QB議事録アシスタント

会議・面談の録音とメモ、議事録づくりのアプリです（QB HOUSE）。

## プライバシー

- 音声は端末の外に送りません。
- 文字起こしは端末の中で処理します。PC の Chrome で使えます（初回だけ準備が要ります）。
- iPhone などでは、録音とメモだけが使えます。

## 開発

初回だけ、必要なものを入れます。

```bash
npm install
```

手元で動かします。

```bash
npm run dev
```

テストを流します。

```bash
npm test
```

公開用に組み立てます（`dist/` にできます）。

```bash
npm run build
```

## 公開のしかた

公開先は https://demo-8bj.pages.dev/ （Cloudflare Pages）です。

GitHub の `qbryomurabayashi-sys/DEMO`（手元では `Downloads\アプリ開発・ツールプロジェクト\_demo_push`）に反映して push すると、Cloudflare Pages が公開します。

- 何を反映するか（組み立てた `dist/` の中身を置くのか、Cloudflare Pages が組み立てるのか）は未確認です。反映する前に確かめてください。
- 配ったアプリが端末の保存（Service Worker）のせいで開かなくなったときの止め方は、`tools/sw-killswitch.js` の先頭に書いてあります。普段は使いません。

### LINE で配るとき

次の URL を送ります。末尾の `?openExternalBrowser=1` で LINE 内のブラウザを避け、普段のブラウザで開きます。

```
https://demo-8bj.pages.dev/?openExternalBrowser=1
```

## 版を上げるとき

次の3か所を同じ番号にそろえます。

1. `public/version.json` の `version`（画面の版表示はここから読みます）
2. `public/sw.js` の `CACHE_NAME`（変えると、利用者の端末の古い保存が入れ替わります）
3. `package.json` の `version`

アイコンを変えたときは、`public/icon.svg` を直してから PNG を作り直します。

```bash
node scripts/generate-icons.js
```
