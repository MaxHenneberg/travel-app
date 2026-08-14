/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

const CACHE_VERSION = 'vue-v1';
const IMAGE_CACHE = 'trailbook-stop-images-v1';
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

async function storeSharedFile(file: File): Promise<string> {
  const id = crypto.randomUUID();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('trailbook-share-target', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('pending', 'readwrite');
    transaction.objectStore('pending').put({ id, file, createdAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return id;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.searchParams.get('share-target') !== 'itinerary') return;
  event.respondWith((async () => {
    const data = await event.request.formData();
    const file = data.get('itinerary');
    if (!(file instanceof File)) return Response.redirect(new URL('./?share-target=missing', self.registration.scope), 303);
    const id = await storeSharedFile(file);
    return Response.redirect(new URL(`./?share-target=confirm&id=${encodeURIComponent(id)}`, self.registration.scope), 303);
  })());
});

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
registerRoute(
  ({ url }) => url.origin === self.location.origin && /\/data\/(schemas|itineraries)\//.test(url.pathname),
  new StaleWhileRevalidate({ cacheName: `trailbook-data-${CACHE_VERSION}` }),
);

async function boundedImage(request: Request): Promise<Response> {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!response.ok || response.type === 'opaque' || !type.startsWith('image/')) return response;
    if ((await response.clone().blob()).size > 5 * 1024 * 1024) return response;
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    const sizes = await Promise.all(keys.map(async (key) => (await cache.match(key))?.clone().blob().then((blob) => blob.size) ?? 0));
    let bytes = sizes.reduce((total, size) => total + size, 0);
    let entries = keys.length;
    for (let index = 0; index < keys.length && (entries > 24 || bytes > 32 * 1024 * 1024); index += 1) {
      await cache.delete(keys[index]);
      entries -= 1;
      bytes -= sizes[index];
    }
    return response;
  } catch {
    return Response.error();
  }
}

registerRoute(
  ({ request, url }) => request.destination === 'image' && (url.protocol === 'https:' || url.origin === self.location.origin),
  ({ request }) => boundedImage(request),
);
registerRoute(
  ({ url }) => url.origin === self.location.origin,
  new NetworkFirst({ cacheName: `trailbook-runtime-${CACHE_VERSION}`, networkTimeoutSeconds: 4 }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'PURGE_IMAGE' || typeof event.data.url !== 'string') return;
  event.waitUntil(caches.open(IMAGE_CACHE).then((cache) => cache.delete(event.data.url)));
});
