const STATIC_CACHE = 'samweb-static-v1';
const RUNTIME_CACHE = 'samweb-runtime-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './robots.txt',
  './sitemap.xml',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

const EXTERNAL_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js'
];

function isBypassRequest(url) {
  return url.hostname.includes('firebasedatabase.app') || url.hostname.includes('api.ipify.org');
}

async function revalidate(request) {
  try {
    const url = new URL(request.url);
    if (isBypassRequest(url)) return;
    const response = await fetch(request);
    if (!response || (!response.ok && response.type !== 'opaque')) return;
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  } catch {}
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_ASSETS);

    await Promise.allSettled(EXTERNAL_ASSETS.map(async (url) => {
      const response = await fetch(url);
      if (response.ok || response.type === 'opaque') {
        await cache.put(url, response.clone());
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => ![STATIC_CACHE, RUNTIME_CACHE].includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  if (isBypassRequest(url)) return;

  event.respondWith((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    const runtimeCache = await caches.open(RUNTIME_CACHE);

    if (request.mode === 'navigate') {
      const cachedPage = (await runtimeCache.match(request)) || (await staticCache.match('./index.html')) || (await caches.match(request));
      if (cachedPage) {
        event.waitUntil(revalidate(request));
        return cachedPage;
      }

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          await runtimeCache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        return staticCache.match('./index.html');
      }
    }

    const cached =
      (await caches.match(request, { ignoreSearch: true })) ||
      (await staticCache.match(request, { ignoreSearch: true })) ||
      (await runtimeCache.match(request, { ignoreSearch: true }));

    if (cached) {
      event.waitUntil(revalidate(request));
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
        await runtimeCache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      if (request.destination === 'image') {
        return staticCache.match('./icons/icon-192.png');
      }
      return staticCache.match('./index.html');
    }
  })());
});
