import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRAILBOOK_MIME_TYPE,
  createTrailbookExport,
  sanitizeTrailbookFilename,
  shareOrDownloadTrailbook,
} from '../../src/lib/trailbook-export.js';

const itinerary = () => ({
  schemaVersion: '1.0.0',
  trip: {
    id: 'trip-stable', title: 'Kyoto / Autumn: 2026', startDate: '2026-10-01', endDate: '2026-10-01', timeZone: 'Asia/Tokyo',
    days: [{ id: 'day-stable', date: '2026-10-01', activities: [{ id: 'stop-stable', title: 'Temple visit', startsAt: '2026-10-01T09:00:00+09:00', notes: 'Keep this user note.' }] }],
  },
});

test('TA-TRAVEL-94-01 creates schema-valid UTF-8 .trailbook data with stable IDs', async () => {
  const source = itinerary();
  const { file, fileName, json } = createTrailbookExport(source);
  assert.equal(fileName, 'Kyoto-Autumn-2026.trailbook');
  assert.equal(file.type, TRAILBOOK_MIME_TYPE);
  assert.deepEqual(JSON.parse(json), source);
  assert.equal(JSON.parse(await file.text()).trip.days[0].activities[0].id, 'stop-stable');
  assert.match(await file.text(), /Keep this user note/);
});

test('TA-TRAVEL-94-02 shares a file when supported and downloads after cancel or rejection', async () => {
  const { file } = createTrailbookExport(itinerary());
  let shared;
  let downloads = 0;
  assert.equal(await shareOrDownloadTrailbook(file, {
    navigatorRef: { canShare: ({ files }) => files[0] === file, share: async (data) => { shared = data; } },
    download: () => { downloads += 1; },
  }), 'shared');
  assert.equal(shared.files[0], file);
  assert.equal(downloads, 0);
  assert.equal(await shareOrDownloadTrailbook(file, {
    navigatorRef: { canShare: () => true, share: async () => { throw new DOMException('cancelled', 'AbortError'); } },
    download: () => { downloads += 1; },
  }), 'downloaded');
  assert.equal(downloads, 1);
});

test('TA-TRAVEL-94-03 rejects metadata outside the itinerary contract', () => {
  const unsafe = itinerary();
  unsafe.trip.localPath = 'C:\\private\\ticket.pdf';
  unsafe.trip.credentials = { token: 'SECRET' };
  assert.throws(() => createTrailbookExport(unsafe), /Invalid itinerary at \/trip\/localPath/);
  assert.equal(sanitizeTrailbookFilename('../Secret <Trip>'), 'Secret-Trip.trailbook');
});
