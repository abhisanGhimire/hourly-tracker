/* Hourly Activity Log — network-first for app shell so deploys show up after refresh */
const CACHE = 'hourly-log-v10';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(['./icons/icon-192.png', './icons/icon-512.png']).catch(() => {})
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/** Prefer network so users get fresh HTML/JS/CSS after you deploy; cache is offline fallback. */
function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req));
}

/** Icons: fast display, still update in background */
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (
    url.href.includes('cdnjs.cloudflare.com/ajax/libs/jspdf') ||
    url.href.includes('cdnjs.cloudflare.com/ajax/libs/Chart.js')
  ) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (!isSameOrigin(url)) return;

  const path = url.pathname;
  const name = path.split('/').pop() || '';

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  if (/\.(html|js|css|json)$/i.test(name) || path.endsWith('/') || name === '') {
    event.respondWith(networkFirst(req));
    return;
  }

  if (/\.(png|ico|svg)$/i.test(name)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((c) => c || fetch(req))
  );
});
