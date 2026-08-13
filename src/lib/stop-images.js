export const IMAGE_CACHE = 'trailbook-stop-images-v1';
export const IMAGE_METADATA_CACHE = 'trailbook-image-metadata-v1';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function commonsApiUrl(image) {
  if (image?.provider !== 'wikimediaCommons') return null;
  const title = typeof image.commonsFile === 'string' && image.commonsFile.trim();
  const query = typeof image.commonsQuery === 'string' && image.commonsQuery.trim();
  if (!title && !query) return null;
  const url = new URL(COMMONS_API);
  const params = {
    action: 'query', format: 'json', formatversion: '2', origin: '*', prop: 'imageinfo',
    iiprop: 'url|extmetadata', iiurlwidth: '960', redirects: '1',
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (title) url.searchParams.set('titles', title.startsWith('File:') ? title : `File:${title}`);
  else {
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '1');
    url.searchParams.set('gsrsearch', query);
  }
  return url.href;
}

const plainText = (value = '') => String(value)
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replace(/<[^>]*>/g, '').replaceAll('&amp;', '&')
  .replace(/\s+/g, ' ').trim();

export function parseCommonsResponse(payload, fallbackAlt = '') {
  const page = payload?.query?.pages?.find((candidate) => candidate.imageinfo?.[0]);
  const info = page?.imageinfo?.[0];
  const metadata = info?.extmetadata ?? {};
  const url = safeImageUrl(info?.thumburl ?? info?.url);
  if (!url) return null;
  return {
    url,
    alt: fallbackAlt,
    caption: plainText(metadata.ImageDescription?.value),
    credit: plainText(metadata.Artist?.value || metadata.Credit?.value),
    sourceUrl: safeImageUrl(info.descriptionurl),
  };
}

export function validStopImages(images) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    if (!image || typeof image !== 'object' || typeof image.alt !== 'string') return [];
    const url = safeImageUrl(image.url);
    const apiUrl = commonsApiUrl(image);
    if (!url && !apiUrl) return [];
    return [{
      url, apiUrl, alt: image.alt,
      caption: typeof image.caption === 'string' ? image.caption : '',
      credit: typeof image.credit === 'string' ? image.credit : '',
      sourceUrl: safeImageUrl(image.sourceUrl),
    }];
  });
}

export async function resolveStopImage(image, { online = true, fetchImpl = globalThis.fetch, cacheStorage = globalThis.caches } = {}) {
  if (image.url) return image;
  if (!image.apiUrl || !cacheStorage) return null;
  const cache = await cacheStorage.open(IMAGE_METADATA_CACHE);
  const cached = await cache.match(image.apiUrl);
  if (cached) return cached.json();
  if (!online || !fetchImpl) return null;
  try {
    const response = await fetchImpl(image.apiUrl, { referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const resolved = parseCommonsResponse(await response.json(), image.alt);
    if (!resolved) return null;
    await cache.put(image.apiUrl, new Response(JSON.stringify(resolved), { headers: { 'Content-Type': 'application/json' } }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - 48)).map((key) => cache.delete(key)));
    return resolved;
  } catch { return null; }
}

export async function imageIsCached(url, cacheStorage = globalThis.caches) {
  if (!url || !cacheStorage) return false;
  return Boolean(await cacheStorage.open(IMAGE_CACHE).then((cache) => cache.match(url)).catch(() => null));
}
