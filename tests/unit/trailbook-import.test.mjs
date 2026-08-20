import assert from 'node:assert/strict';
import test from 'node:test';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import {
  claimPendingImport,
  countPendingImports,
  deletePendingImport,
  purgeExpiredImports,
  putPendingImport,
} from '../../src/lib/pending-import.js';
import {
  TRAILBOOK_IMPORT_LIMITS,
  duplicateItinerary,
  validateImportTransport,
  validateTrailbookImport,
} from '../../src/lib/trailbook-import.js';
import { TRAILBOOK_MIME_TYPE } from '../../src/lib/trailbook-export.js';
import { createTripStore } from '../../src/lib/trip-store.js';

const itinerary = () => ({
  schemaVersion: '1.0.0',
  trip: {
    id: 'shared-kyoto', title: 'Kyoto <Autumn>', summary: 'A local trip.',
    startDate: '2026-10-01', endDate: '2026-10-02', timeZone: 'Asia/Tokyo', countryCode: 'JP',
    days: [{ id: 'stable-day', date: '2026-10-01', activities: [{ id: 'stable-stop', title: 'Temple visit', startsAt: '2026-10-01T09:00:00+09:00' }] }],
  },
});

function localFile(value, options = {}) {
  const bytes = options.bytes ?? new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer;
  return {
    name: options.name ?? 'kyoto.trailbook',
    type: options.type ?? TRAILBOOK_MIME_TYPE,
    size: options.size ?? bytes.byteLength,
    bytes,
    async arrayBuffer() { return bytes; },
  };
}

test('TA-TRAVEL-95-01 deduplicates delivery and permits only one reviewer claim', async () => {
  const indexedDB = new FDBFactory();
  const file = { ...localFile(itinerary()), source: 'share-target' };
  const first = await putPendingImport(file, { indexedDB, id: 'first' });
  const retry = await putPendingImport(file, { indexedDB, id: 'retry' });
  assert.deepEqual(first, { id: 'first', duplicate: false });
  assert.deepEqual(retry, { id: 'first', duplicate: true });
  assert.equal(await countPendingImports({ indexedDB }), 1);
  assert.equal((await claimPendingImport('first', 'window-a', { indexedDB })).state, 'reviewing');
  assert.equal(await claimPendingImport('first', 'window-b', { indexedDB }), null);
  await deletePendingImport('first', { indexedDB });
  assert.equal(await countPendingImports({ indexedDB }), 0);
});

test('TA-TRAVEL-95-02 validates supported UTF-8 v1 and preserves internal IDs for a safe duplicate', async () => {
  const result = await validateTrailbookImport(localFile(itinerary()), { source: 'share-target' });
  assert.equal(result.preview.tripId, 'shared-kyoto');
  assert.equal(result.preview.title, 'Kyoto <Autumn>');
  assert.equal(result.preview.destination, 'JP');
  assert.equal(result.preview.schemaVersion, '1.1.0');
  const duplicate = duplicateItinerary(result.candidate, 'shared-kyoto-copy-safe');
  assert.equal(duplicate.trip.id, 'shared-kyoto-copy-safe');
  assert.equal(duplicate.trip.days[0].id, 'stable-day');
  assert.equal(duplicate.trip.days[0].items[0].id, 'stable-stop');
});

test('TA-TRAVEL-95-04 rejects MIME spoofing, unsafe paths, active content, limits, and unsupported schemas', async () => {
  assert.throws(() => validateImportTransport(localFile(itinerary(), { type: 'text/html' })), /type does not match/i);
  assert.throws(() => validateImportTransport(localFile(itinerary(), { name: '../kyoto.trailbook' })), /filename is unsafe/i);
  assert.throws(() => validateImportTransport(localFile(itinerary(), { size: TRAILBOOK_IMPORT_LIMITS.maxFileBytes + 1 })), /exceeds/i);

  const malicious = itinerary();
  malicious.trip.summary = '<script>globalThis.pwned = true</script>';
  await assert.rejects(validateTrailbookImport(localFile(malicious)), (error) => error.code === 'active_content');
  assert.equal(globalThis.pwned, undefined);

  const unsupported = itinerary();
  unsupported.schemaVersion = '2.0.0';
  await assert.rejects(validateTrailbookImport(localFile(unsupported)), (error) => error.code === 'unsupported_schema');
  await assert.rejects(validateTrailbookImport(localFile('<html>not json</html>')), (error) => error.code === 'non_json');
  await assert.rejects(validateTrailbookImport(localFile('{bad json')), (error) => error.code === 'invalid_json');
  await assert.rejects(validateTrailbookImport(localFile(itinerary()), { limits: { maxItemCount: 2 } }), (error) => error.code === 'too_many_items');
  await assert.rejects(validateTrailbookImport(localFile(itinerary()), { limits: { maxNestingDepth: 2 } }), (error) => error.code === 'too_deep');
  await assert.rejects(validateTrailbookImport(localFile(itinerary()), { limits: { maxParseMilliseconds: -1 } }), (error) => error.code === 'parse_timeout');
});

test('expired temporary imports are removed before the next delivery', async () => {
  const indexedDB = new FDBFactory();
  await putPendingImport({ ...localFile(itinerary()), source: 'share-target' }, { indexedDB, id: 'old', now: 1, ttlMs: 10 });
  await purgeExpiredImports({ indexedDB, now: 20, ttlMs: 10 });
  assert.equal(await countPendingImports({ indexedDB }), 0);
  const changed = itinerary(); changed.trip.id = 'new-trip';
  await putPendingImport({ ...localFile(changed), source: 'share-target' }, { indexedDB, id: 'new', now: 20, ttlMs: 10 });
  assert.equal(await countPendingImports({ indexedDB }), 1);
  assert.equal((await claimPendingImport('new', 'window', { indexedDB, now: 20, ttlMs: 10 })).id, 'new');
});

test('conflict replacement removes every old revision atomically and retains the candidate', async () => {
  const indexedDB = new FDBFactory();
  const tripStore = createTripStore({ indexedDB, localStorage: undefined });
  const first = itinerary();
  await tripStore.saveTrip(first);
  await tripStore.saveTrip({ ...first, revision: 2 });
  const replacement = itinerary(); replacement.trip.title = 'Replacement';
  await tripStore.replaceTrip('shared-kyoto', replacement);
  const saved = await tripStore.listTrips();
  assert.equal(saved.filter((trip) => trip.trip?.id === 'shared-kyoto').length, 1);
  assert.equal(saved.find((trip) => trip.trip?.id === 'shared-kyoto').trip.title, 'Replacement');
});
