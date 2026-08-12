export const IMAGE_CACHE = 'trailbook-stop-images-v1';

export function safeImageUrl(value, baseUrl) {
  try {
    const bundled = typeof value === 'string' && /^images\/stops\/[a-z0-9][a-z0-9._/-]*$/i.test(value) && !value.includes('..');
    const url = bundled && baseUrl ? new URL(value, baseUrl) : new URL(value);
    return (url.protocol === 'https:' || bundled) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validStopImages(images, baseUrl) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    if (!image || typeof image !== 'object' || typeof image.alt !== 'string') return [];
    const url = safeImageUrl(image.url, baseUrl);
    if (!url) return [];
    return [{
      url,
      alt: image.alt,
      caption: typeof image.caption === 'string' ? image.caption : '',
      credit: typeof image.credit === 'string' ? image.credit : '',
      sourceUrl: safeImageUrl(image.sourceUrl),
    }];
  });
}

export async function imageIsCached(url, cacheStorage = globalThis.caches) {
  if (!cacheStorage) return false;
  return Boolean(await cacheStorage.open(IMAGE_CACHE).then((cache) => cache.match(url)).catch(() => null));
}
