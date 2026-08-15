/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { purgeExpiredImports, putPendingImport } from '../lib/pending-import.js';
import { validateImportTransport } from '../lib/trailbook-import.js';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

const CACHE_VERSION = 'vue-v1';
const IMAGE_CACHE = 'trailbook-stop-images-v1';
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('activate', (event) => event.waitUntil(purgeExpiredImports()));

function shareRedirect(parameters: Record<string, string>): Response {
  const destination = new URL('./', self.registration.scope);
  for (const [key, value] of Object.entries(parameters)) destination.searchParams.set(key, value);
  return new Response(null, {
    status: 303,
    headers: { Location: destination.href, 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const action = new URL('share-target', self.registration.scope);
  if (event.request.method !== 'POST' || url.origin !== action.origin || url.pathname !== action.pathname) return;
  event.respondWith((async () => {
    try {
      if (!event.request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
        return shareRedirect({ 'share-target': 'error', reason: 'invalid_request' });
      }
      const data = await event.request.formData();
      const entries = [...data.entries()];
      if (entries.length !== 1 || entries[0][0] !== 'itinerary' || !(entries[0][1] instanceof File)) {
        return shareRedirect({ 'share-target': 'error', reason: 'unexpected_files' });
      }
      const file = entries[0][1];
      validateImportTransport(file, { source: 'share-target' });
      const pending = await putPendingImport({
        name: file.name,
        type: file.type,
        size: file.size,
        bytes: await file.arrayBuffer(),
        source: 'share-target',
      });
      return shareRedirect({ 'share-target': 'confirm', id: pending.id });
    } catch (error) {
      const failure = error as { code?: unknown };
      const reason = typeof failure?.code === 'string' ? failure.code : 'unreadable_file';
      return shareRedirect({ 'share-target': 'error', reason });
    }
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
    void self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'PURGE_IMAGE' || typeof event.data.url !== 'string') return;
  event.waitUntil(caches.open(IMAGE_CACHE).then((cache) => cache.delete(event.data.url)));
});
