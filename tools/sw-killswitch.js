// QB議事録アシスタント：Service Worker を止めて消すための版（キルスイッチ）。
// 緊急時だけ、public/sw.js をこの中身で置き換えて配置する。普段は配置しない。
//
// 使いどころ：配った Service Worker に不具合があり、端末に残った保存のせいで
// 古い画面や壊れた画面が開き続けるとき。
// 配置すると、利用者が次にアプリを開いたとき（ブラウザが sw.js の更新を見つけたとき）に：
//   1. 端末に保存したファイル（キャッシュ）をすべて消す
//   2. 開いている画面を受け持つ（この版は通信に手を出さないので、以後はネットから読む）
//   3. この Service Worker の登録を外す
// 画面の再読み込みや移動はしない（録音中に読み込み直すと録音が消えるため）。
// 録音・メモの記録（IndexedDB）には触らない。
// 配置しているあいだは、アプリを開くたびに同じことをくり返す（害はない）。
// 元に戻すときは、public/sw.js を通常の版に戻し、CACHE_NAME を新しい番号にして配置する。

// インストール：待たずにすぐ有効化へ進む。
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// 有効化：1つ失敗しても、残りは必ず行う。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (err) {
        // 消せなくても先へ進む
      }
      // 受け持つのは登録を外す前（外したあとでは受け持てないため）
      try {
        await self.clients.claim();
      } catch (err) {
        // 受け持てなくても先へ進む
      }
      try {
        await self.registration.unregister();
      } catch (err) {
        // 外せなくても終わる
      }
    })(),
  );
});
