// Bump this only if you change the ASSETS list or want to force-clear old caches.
// Edits to index.html etc. are picked up automatically (network-first, below).
const CACHE_NAME = 'shift-logger-v3';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './shift-logger-favicon-48.png',
  './shift-logger-icon-192.png',
  './shift-logger-icon-512.png'
];

// If the network is slower than this, serve the cached copy instead
// (poor signal on a job site shouldn't hang the app).
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' skips the browser's HTTP cache so we never
      // precache a stale copy of a file.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  network.catch(() => {}); // avoid an unhandled rejection if it fails after a timeout

  const timeout = new Promise((resolve) =>
    setTimeout(
      async () => resolve(await cache.match(request, { ignoreSearch: true })),
      NETWORK_TIMEOUT_MS
    )
  );

  try {
    // Network wins if it answers in time; otherwise use the cached copy
    // (and the network response still refreshes the cache in the background).
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return await network; // timed out with nothing cached yet: keep waiting
  } catch (err) {
    // Offline or network error: fall back to the cache.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});
