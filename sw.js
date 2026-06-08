/**
 * Menu Scanner — Service Worker
 * Caches the app shell for offline access.
 * The menu analysis itself still requires network (API call).
 */
const CACHE_NAME = 'menu-scanner-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install: Cache app shell ─────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: Clean old caches ───────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-first strategy for app shell ────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Don't cache API calls
        if (event.request.url.includes('/api/')) return response;

        // Cache successful responses
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }

        return response;
      });
    })
  );
});
