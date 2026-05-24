const CACHE_NAME = 'ai-meeting-v2';

self.addEventListener('install', (event) => {
  // 自動でskipWaitingしないように変更（ユーザーの更新ボタン押下を待つ）
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
