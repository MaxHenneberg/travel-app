const CACHE = 'trailbook-v1';
const scope = new URL(self.registration.scope);
const asset = (path) => new URL(path, scope).href;
const SHELL = [
  asset('./'),
  asset('manifest.webmanifest'),
  asset('favicon.svg'),
  asset('icons/travel-192.png'),
  asset('icons/travel-512.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== scope.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(asset('./'), response.clone());
        return response;
      } catch {
        return (await cache.match(asset('./'))) || Response.error();
      }
    }

    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return new Response(JSON.stringify({ error: 'This resource is not available offline yet.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  })());
});
