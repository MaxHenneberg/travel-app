import { validateItinerary } from './itinerary.js';

export const TRAILBOOK_EXTENSION = '.trailbook';
export const TRAILBOOK_MIME_TYPE = 'application/vnd.trailbook.itinerary+json';

const DEFAULT_FILE_STEM = 'trailbook-trip';

export function sanitizeTrailbookFilename(title) {
  const stem = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/[^\p{L}\p{N}._ -]+/gu, ' ')
    .replace(/[\s._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
  return `${stem || DEFAULT_FILE_STEM}${TRAILBOOK_EXTENSION}`;
}

function itineraryTitle(itinerary) {
  return itinerary?.trip?.title ?? itinerary?.title;
}

/**
 * Validate and serialize only the supported itinerary contract. Storage records,
 * attachment blobs, cached images, browser paths, and app metadata are never read.
 */
export function createTrailbookExport(itinerary, { FileCtor = globalThis.File } = {}) {
  validateItinerary(itinerary);
  const json = `${JSON.stringify(itinerary, null, 2)}\n`;
  const fileName = sanitizeTrailbookFilename(itineraryTitle(itinerary));
  if (typeof FileCtor !== 'function') throw new TypeError('File export is not supported in this browser.');
  const file = new FileCtor([json], fileName, { type: TRAILBOOK_MIME_TYPE, lastModified: Date.now() });
  return { file, fileName, json };
}

export function downloadTrailbookFile(file, {
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
} = {}) {
  const url = urlApi.createObjectURL(file);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => urlApi.revokeObjectURL(url), 0);
}

/**
 * Native file sharing is preferred on capable Android browsers. Every unsupported,
 * rejected, or cancelled share attempt falls back to a local download.
 */
export async function shareOrDownloadTrailbook(file, {
  navigatorRef = globalThis.navigator,
  download = downloadTrailbookFile,
} = {}) {
  const shareData = {
    title: file.name.replace(/\.trailbook$/i, ''),
    text: 'Portable Trailbook itinerary file',
    files: [file],
  };
  const supportsFileShare = typeof navigatorRef?.share === 'function'
    && (typeof navigatorRef.canShare !== 'function' || navigatorRef.canShare(shareData));
  if (supportsFileShare) {
    try {
      await navigatorRef.share(shareData);
      return 'shared';
    } catch {
      // Cancellation and platform rejection both retain the data via download.
    }
  }
  download(file);
  return 'downloaded';
}
