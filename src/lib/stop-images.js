export const IMAGE_CACHE = 'trailbook-stop-images-v1';

export function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validStopImages(images) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    if (!image || typeof image !== 'object' || typeof image.alt !== 'string') return [];
    const url = safeImageUrl(image.url);
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
