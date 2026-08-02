const CACHE_NAME = 'freev-v5.0.0';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './rapport-mensuel.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/css/app.css',
  './assets/css/mobile.css',
  './assets/css/v4.css',
  './assets/css/v5.css',
  './assets/css/report.css',
  './assets/js/vendor-loader.js',
  './assets/js/config.js',
  './assets/js/state.js',
  './assets/js/core.js',
  './assets/js/dashboard.js',
  './assets/js/transactions.js',
  './assets/js/recurring.js',
  './assets/js/finance.js',
  './assets/js/health.js',
  './assets/js/data-io.js',
  './assets/js/customization.js',
  './assets/js/bootstrap.js',
  './assets/js/transfers.js',
  './assets/js/ui.js',
  './assets/js/auth-bridge.js',
  './assets/js/pwa-install.js',
  './assets/js/firebase-auth.js',
  './assets/js/v4-engine.js',
  './assets/js/v4.js',
  './assets/js/v5-engine.js',
  './assets/js/v5.js',
  './assets/js/report.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  const refresh = fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    });
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith(caches.match(request).then(hit => hit || refresh));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './index.html?source=notification&view=smart';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client);
      if (existing) {
        existing.navigate?.(target);
        return existing.focus();
      }
      return self.clients.openWindow?.(target);
    })
  );
});
