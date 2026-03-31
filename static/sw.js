const CACHE_NAME = 'transit-static-v4';
const STATIC_ASSETS = [
  '/static/style.css',
  '/static/script.js',
  '/static/theme.js',
  '/static/icons/bus.png',
  '/static/icons/busstop.png',
  '/static/icons/db.png',
  '/static/icons/farbus.png',
  '/static/icons/ferry.png',
  '/static/icons/missing.png',
  '/static/icons/nl.png',
  '/static/icons/sbahn.png',
  '/static/icons/sncf.png',
  '/static/icons/stadtbahn.png',
  '/static/icons/tram.png',
  '/static/icons/ubahn.png'
];
const STATIC_PATH_PREFIXES = ['/static/'];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAssetRequest(request, url) {
  return STATIC_ASSETS.includes(url.pathname) || STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('transit-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  // Never cache live HTML documents or API endpoints.
  // Those must always come fresh from the app/reverse proxy to avoid stale boot state.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    return;
  }
  if (
    url.pathname === '/search' ||
    url.pathname === '/search_by_id' ||
    url.pathname === '/lookup_stop_by_coords' ||
    url.pathname.startsWith('/debug/')
  ) {
    return;
  }

  if (isStaticAssetRequest(event.request, url)) {
    event.respondWith(cacheFirst(event.request));
  }
});
