const VERSION = 'ritty-v13';
const STATIC = ['.', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((ca) => ca.addAll(STATIC).catch(() => {})).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 导航请求：网络优先，cache:'no-cache' 强制向服务器验证 ETag，绕过 HTTP 强缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, {cache:'no-cache'})
        .then((r) => { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(req, c)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(req, c)); }
      return r;
    }).catch(() => m))
  );
});
