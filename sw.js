const CACHE = 'family-finance-v1';
const SHELL = [
  '/family-finance/',
  '/family-finance/index.html',
  '/family-finance/js/app.js',
  '/family-finance/js/api.js',
  '/family-finance/js/config.js',
  '/family-finance/icon.svg',
  '/family-finance/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 只快取同源請求（不攔截 GAS API）
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
