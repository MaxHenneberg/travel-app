const CACHE = 'trailbook-v1';
const IMAGE_CACHE = 'trailbook-stop-images-v1';
const MAX_IMAGE_ENTRIES = 24;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const scope = new URL(self.registration.scope);
const asset = (path) => new URL(path, scope).href;
const SHELL = [
  asset('./'),
  asset('manifest.webmanifest'),
  asset('favicon.svg'),
  asset('icons/travel-192.png'),
  asset('icons/travel-512.png'),
  asset('data/itineraries/index.json'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE, IMAGE_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimImageCache(cache) {
  const keys = await cache.keys();
  const sizes = await Promise.all(keys.map(async (key) => (await cache.match(key)).clone().blob().then((blob) => blob.size).catch(() => MAX_IMAGE_BYTES)));
  let bytes = sizes.reduce((total, size) => total + size, 0);
  let entries = keys.length;
  for (let index = 0; (entries > MAX_IMAGE_ENTRIES || bytes > MAX_IMAGE_CACHE_BYTES) && index < keys.length; index += 1) {
    await cache.delete(keys[index]);
    entries -= 1;
    bytes -= sizes[index];
  }
}

async function stopPictureResponse(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || response.type === 'opaque' || !contentType.toLowerCase().startsWith('image/')) return response;
    const size = (await response.clone().blob()).size;
    if (size > MAX_IMAGE_BYTES) return response;
    await cache.delete(request);
    await cache.put(request, response.clone());
    await trimImageCache(cache);
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PURGE_IMAGE') return;
  try {
    const url = new URL(event.data.url);
    if (url.protocol === 'https:') event.waitUntil(caches.open(IMAGE_CACHE).then((cache) => cache.delete(url.href)));
  } catch { /* Ignore malformed messages. */ }
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (event.request.destination === 'image' && requestUrl.protocol === 'https:') {
    event.respondWith(stopPictureResponse(event.request));
    return;
  }
  if (requestUrl.origin !== scope.origin) return;

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
