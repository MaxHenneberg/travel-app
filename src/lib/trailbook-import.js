import { inspectItinerary } from './itinerary.js';
import { TRAILBOOK_EXTENSION, TRAILBOOK_MIME_TYPE } from './trailbook-export.js';

export const TRAILBOOK_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxNestingDepth: 32,
  maxItemCount: 10_000,
  maxParseMilliseconds: 1_000,
});

export class TrailbookImportError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'TrailbookImportError';
    this.code = code;
  }
}

export function sanitizeImportMetadata(value, fallback = 'shared itinerary') {
  const clean = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return clean || fallback;
}

function validFilename(name, source) {
  const extension = name.toLowerCase().endsWith(TRAILBOOK_EXTENSION);
  if (source === 'picker' && name.toLowerCase().endsWith('.json')) return 'json';
  if (!extension) return null;
  return 'trailbook';
}

export function validateImportTransport(file, options = {}) {
  const { source = 'share-target', limits = TRAILBOOK_IMPORT_LIMITS } = options;
  const name = String(file?.name ?? '');
  const type = String(file?.type ?? '').toLowerCase();
  if (!name || /[\\/]/.test(name) || /(^|[.\s])\.\.([.\s]|$)/.test(name) || /^[a-z]:/i.test(name)) {
    throw new TrailbookImportError('unsafe_filename', 'The shared filename is unsafe. Choose a local .trailbook file with a plain filename.');
  }
  const kind = validFilename(name, source);
  if (!kind) throw new TrailbookImportError('unsupported_extension', 'Only .trailbook itinerary files are accepted here.');
  const accepted = kind === 'json'
    ? type === 'application/json'
    : type === TRAILBOOK_MIME_TYPE || type === 'application/octet-stream';
  if (!accepted) throw new TrailbookImportError('mime_mismatch', 'The file type does not match its itinerary extension.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new TrailbookImportError('empty_file', 'The itinerary file is empty.');
  if (file.size > limits.maxFileBytes) throw new TrailbookImportError('file_too_large', `The itinerary exceeds the ${limits.maxFileBytes} byte import limit.`);
  return { displayName: sanitizeImportMetadata(name), kind };
}

function inspectComplexity(value, limits) {
  let items = 0;
  const stack = [{ value, depth: 1 }];
  while (stack.length) {
    const current = stack.pop();
    items += 1;
    if (items > limits.maxItemCount) throw new TrailbookImportError('too_many_items', 'The itinerary contains too many items.');
    if (current.depth > limits.maxNestingDepth) throw new TrailbookImportError('too_deep', 'The itinerary is nested too deeply.');
    if (!current.value || typeof current.value !== 'object') continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new TrailbookImportError('active_content', 'The itinerary contains an unsafe object key.');
      }
      if (typeof child === 'string' && /<\s*(script|iframe|object|embed|svg)|javascript\s*:|data\s*:\s*text\/html|on(?:error|load|click)\s*=/i.test(child)) {
        throw new TrailbookImportError('active_content', 'The itinerary contains active content and was blocked.');
      }
      if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function previewFor(candidate, displayName) {
  const trip = candidate.trip ?? candidate;
  const days = Array.isArray(trip.days) ? trip.days : [];
  const destinations = new Set();
  for (const value of [candidate.destination, trip.countryCode, ...days.map((day) => day.countryCode)]) {
    if (typeof value === 'string' && value.trim()) destinations.add(value.trim());
  }
  const warnings = [];
  if (!days.length) warnings.push('This itinerary has no days.');
  if (!trip.summary && !candidate.summary) warnings.push('No trip summary is included.');
  if (!destinations.size) warnings.push('No destination label is included.');
  return {
    fileName: displayName,
    tripId: sanitizeImportMetadata(trip.id, 'Unknown trip ID'),
    title: sanitizeImportMetadata(trip.title, 'Untitled trip'),
    dateRange: candidate.dateRange || (trip.startDate && trip.endDate ? `${trip.startDate} – ${trip.endDate}` : 'Not provided'),
    destination: [...destinations].join(', ') || trip.timeZone || 'Not provided',
    schemaVersion: String(candidate.schemaVersion),
    dayCount: days.length,
    warnings,
  };
}

export async function validateTrailbookImport(file, options = {}) {
  const limits = { ...TRAILBOOK_IMPORT_LIMITS, ...(options.limits ?? {}) };
  const { displayName } = validateImportTransport(file, { source: options.source, limits });
  const bytes = file.bytes instanceof ArrayBuffer ? file.bytes : await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > limits.maxFileBytes) {
    throw new TrailbookImportError('file_size_changed', 'The itinerary file size changed while it was being read.');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new TrailbookImportError('invalid_utf8', 'The itinerary is not valid UTF-8 text.'); }
  if (!text.trimStart().startsWith('{')) throw new TrailbookImportError('non_json', 'The itinerary is not a JSON object.');
  const startedAt = performance.now();
  let candidate;
  try { candidate = JSON.parse(text); }
  catch { throw new TrailbookImportError('invalid_json', 'The itinerary contains malformed JSON.'); }
  if (performance.now() - startedAt > limits.maxParseMilliseconds) throw new TrailbookImportError('parse_timeout', 'The itinerary took too long to parse.');
  inspectComplexity(candidate, limits);
  const validation = inspectItinerary(candidate);
  if (!validation.valid) {
    const first = validation.errors[0];
    const code = first?.code === 'unsupported_version' ? 'unsupported_schema' : 'invalid_schema';
    throw new TrailbookImportError(code, `The itinerary does not match the supported v1 schema (${first?.path || '$'}: ${first?.message || 'invalid'}).`);
  }
  return { candidate, preview: previewFor(candidate, displayName) };
}

export function duplicateItinerary(candidate, newId = `${candidate.trip?.id ?? candidate.id}-copy-${crypto.randomUUID().slice(0, 8)}`) {
  const duplicate = structuredClone(candidate);
  if (duplicate.trip) duplicate.trip.id = newId;
  else duplicate.id = newId;
  return duplicate;
}
