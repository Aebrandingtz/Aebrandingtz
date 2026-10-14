/* SHEREHE HUB service worker: lets the app open and run check-in with no internet. */
const VERSION = 'sherehe-v69';
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(['/', '/manifest.json', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app page: network first (always the newest version), cached copy when the network is slow or gone.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))
        ]);
        if (fresh && fresh.ok) cache.put('/', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await cache.match('/');
        if (cached) return cached;
        return fetch(req);
      }
    })());
    return;
  }

  // Own static files and public libraries/fonts: serve from cache, refresh in the background.
  if (url.origin === location.origin || CDN.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      const refresh = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await refresh) || Response.error();
    })());
  }
  // Everything else (the Supabase API, posters, storage) goes straight to the network.
});
