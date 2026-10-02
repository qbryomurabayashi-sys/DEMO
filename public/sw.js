// QB議事録アシスタントの Service Worker。
// 方針：いつもネット優先。ネットが落ちているとき（と遅すぎるとき）だけ、保存しておいた物で開く。
// ページの再読み込みを促す仕組みは置かない（録音中に読み込み直すと録音が消えるため）。
// 版を上げたら CACHE_NAME も変える（古い保存は activate で消える）。
const CACHE_NAME = 'qb-giji-v4.1.0';

// アプリ本体の HTML は '/' の1件だけ保存する。
// Cloudflare Pages は /index.html を / へ 308 転送する。転送された応答をページに返すと
// 開かなくなるので、転送なしで取れた '/' だけを保存して使う。
const APP_SHELL = '/';

// 保存があるとき、ページを開くのにネットを待つのはここまで（遅い回線で待たせない）。
const PAGE_TIMEOUT_MS = 4000;

// インストール：'/' と、その HTML が読み込む /assets/ のファイルを保存する。
// 保存の条件は、ネットで開いたときと同じ（canSave を通ったものだけ）。
// どれかが失敗してもインストールは成功させる（次にネットで開いたときに保存し直される）。
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const res = await fetch(APP_SHELL, {cache: 'no-store'});
        if (canSave(APP_SHELL, res) && isHtml(res)) {
          await cache.put(APP_SHELL, res.clone());
          const html = await res.text();
          const assets = new Set();
          for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
            assets.add(m[1]);
          }
          // 1つずつ保存する（1つ失敗しても残りは保存する）
          for (const url of assets) {
            try {
              const file = await fetch(url);
              if (canSave(url, file)) await cache.put(url, file);
            } catch (err) {
              // この1つは飛ばす
            }
          }
        }
      } catch (err) {
        // 保存できなくても先へ進む
      }
      await self.skipWaiting();
    })(),
  );
});

// 有効化：この版以外の保存を消し、開いているページをすぐ受け持つ（再読み込みはしない）。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        );
      } catch (err) {
        // 消せなくても先へ進む
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 次の3つは手を出さず、ブラウザにそのまま任せる（respondWith しない）。
  // GET 以外／別オリジン（Google Fonts など）／range 付き（音声・動画の部分読み込み）
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.headers.has('range')) return;

  const isPage = req.mode === 'navigate';
  const network = fetch(req);

  // 良い応答だけ保存する。保存は応答を返したあとも続く（4秒で打ち切ったあとも最後まで）。
  // 最後の catch で、打ち切ったあとにネットが失敗しても「未処理の Promise 拒否」を出さない。
  // ※ 保存用の複製を先に取るため、この waitUntil は respondWith より前に置く。
  event.waitUntil(
    network.then((res) => (isPage ? saveAppShell(req, res) : saveFile(req, res))).catch(() => {}),
  );

  event.respondWith(isPage ? respondPage(network) : respondFile(req, network));
});

// ページを開く：ネット優先。
// 保存した '/' があるときだけ、4秒で打ち切って保存で開く。保存が無ければネットを待つ。
async function respondPage(network) {
  const cached = await fromCache(APP_SHELL);

  if (!cached) {
    try {
      return await network;
    } catch (err) {
      return Response.error();
    }
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(cached), PAGE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    return cached; // ネットが落ちている
  } finally {
    clearTimeout(timer);
  }
}

// そのほかのファイル：ネット優先。ネットが落ちていれば保存した物。
async function respondFile(req, network) {
  let res;
  try {
    res = await network;
  } catch (err) {
    return (await fromCache(req)) || Response.error();
  }

  // script / style にエラーや HTML が返ってきたら、保存がある方を使う
  // （無いファイルには 404.html が返る。404.html が無い配置だと Pages は index.html を返す）
  if (isCode(req) && (!res.ok || isHtml(res))) {
    return (await fromCache(req)) || res;
  }
  return res;
}

// ページの HTML を '/' に上書き保存する（'/' を開いたときの、ちゃんとした HTML だけ）。
// '/' 以外（/404.html など）の HTML で上書きすると、ネットが無いときにその画面で開いてしまう。
function saveAppShell(req, res) {
  if (new URL(req.url).pathname !== APP_SHELL) return;
  if (!canSave(APP_SHELL, res) || !isHtml(res)) return;
  const copy = res.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL, copy));
}

// ファイルを保存する（条件は canSave）。
function saveFile(req, res) {
  if (!canSave(req.url, res)) return;
  if (isCode(req) && isHtml(res)) return; // script / style の名前で HTML を保存しない
  const copy = res.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
}

// 保存してよい応答か。保存するときは、インストールのときもネットで開いたときも必ずここを通す。
// - 200・転送なし・同じオリジン（type が basic）の応答だけ
// - /assets/ の .js は中身が JavaScript、.css は中身が CSS のときだけ
//   （無いファイルに別の画面の HTML が返ってきても、それを .js や .css として保存しない）
function canSave(url, res) {
  if (res.status !== 200 || res.redirected || res.type !== 'basic') return false;
  const path = new URL(url, self.location.origin).pathname;
  if (path.startsWith('/assets/')) {
    const type = contentType(res);
    if (path.endsWith('.js') && !type.includes('javascript')) return false;
    if (path.endsWith('.css') && !type.includes('text/css')) return false;
  }
  return true;
}

function isCode(req) {
  return req.destination === 'script' || req.destination === 'style';
}

function isHtml(res) {
  return contentType(res).includes('text/html');
}

function contentType(res) {
  return (res.headers.get('content-type') || '').toLowerCase();
}

// 保存を探す。Cache が使えない環境でも止めない（見つからない扱い）。
async function fromCache(key) {
  try {
    return await caches.match(key);
  } catch (err) {
    return undefined;
  }
}
