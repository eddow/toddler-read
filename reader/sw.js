const CACHE_NAME = 'toddler-reader-v10';
const CACHE_PREFIX = 'toddler-reader-';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app-icon.png',
  'assets/no.mp3',
  'assets/player-controls.png',
  'vendor/jsQR.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isHtmlRequest =
    event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html');

  if (isHtmlRequest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(event.request)) || (await caches.match('index.html')) || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        const url = new URL(event.request.url);
        if (url.origin !== self.location.origin || !response.ok) return response;

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copy);
        });
        return response;
      });
    })
  );
});
