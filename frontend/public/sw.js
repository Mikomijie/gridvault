// App-shell service worker (P7/P8, AT-623). Cold boot with the network
// disabled still needs to serve index.html and the JS/CSS bundle before
// React can even mount and read the encrypted roster cache (lib/cache.js).
// Scope is deliberately narrow: same-origin GETs only, opportunistically
// cached as they are fetched (stale-while-revalidate) and served from
// cache when the network fails; navigations fall back to the cached shell
// so client-side routing can take over. The API origin is never touched —
// it is cross-origin in every deployment (PRD 14.2 CSP connect-src) and
// caching PHI-bearing responses here (outside the AES-GCM roster cache)
// would defeat AT-512/AT-627.

const CACHE_NAME = 'gridvault-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(['/', '/index.html']))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((shell) => shell ?? Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })
  );
});
