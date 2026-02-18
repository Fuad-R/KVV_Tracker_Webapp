const CACHE_NAME = 'transit-live-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/static/style.css',
  '/static/script.js',
  '/static/theme.js',
  '/static/icons/bus.png',
  '/static/icons/db.png',
  '/static/icons/missing.png',
  '/static/icons/nl.png',
  '/static/icons/sbahn.png',
  '/static/icons/sncf.png',
  '/static/icons/tram.png',
  '/static/icons/ubahn.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If it's a valid response, clone it and put it in the cache
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // If network fails, try the cache
        return caches.match(event.request);
      })
  );
});
