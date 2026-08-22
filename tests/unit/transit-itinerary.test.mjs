import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectItinerary, validateItinerary } from '../../src/lib/itinerary.js';
import { createTrailbookExport } from '../../src/lib/trailbook-export.js';

const v10 = () => ({ schemaVersion: '1.0.0', trip: { id: 'stable-trip', title: 'Stable trip', startDate: '2026-10-01', endDate: '2026-10-01', timeZone: 'Europe/Berlin', days: [{ id: 'day', date: '2026-10-01', activities: [{ id: 'start', title: 'Start', startsAt: '2026-10-01T08:00:00+02:00' }, { id: 'end', title: 'End', startsAt: '2026-10-01T10:00:00+02:00' }] }] } });

test('migrates v1.0 activities losslessly into ordered v1.1 stop items without inventing transit', () => {
  const source = v10(); const migrated = validateItinerary(source);
  assert.equal(migrated.schemaVersion, '1.1.0');
  assert.deepEqual(migrated.trip.days[0].items.map(({ id, type, title }) => ({ id, type, title })), [{ id: 'start', type: 'stop', title: 'Start' }, { id: 'end', type: 'stop', title: 'End' }]);
  assert.equal(source.schemaVersion, '1.0.0'); assert.ok(!('items' in source.trip.days[0]));
});

test('validates detailed ordered multi-segment transit and preserves it through export', () => {
  const itinerary = validateItinerary(v10());
  itinerary.trip.days[0].items.splice(1, 0, { id: 'transfer', type: 'transit', title: 'Rail transfer', fromStopId: 'start', toStopId: 'end', from: { name: 'Berlin Hbf' }, to: { name: 'Potsdam Hbf' }, mode: 'train', departure: '2026-10-01T08:15:00+02:00', arrival: '2026-10-01T09:00:00+02:00', operator: 'DB', service: 'RE1', platform: '7', segments: [{ id: 'walk', mode: 'walk', from: { name: 'Berlin Hbf' }, to: { name: 'Platform 7' }, duration: '5 min' }, { id: 'rail', mode: 'train', from: { name: 'Platform 7' }, to: { name: 'Potsdam Hbf' }, service: 'RE1' }] });
  const exported = createTrailbookExport(itinerary, { FileCtor: class { constructor(parts) { this.text = parts.join(''); } } });
  assert.equal(JSON.parse(exported.json).trip.days[0].items[1].segments[1].service, 'RE1');
});

test('rejects ticket-reference text so ticket documents remain local attachments', () => {
  const itinerary = validateItinerary(v10());
  itinerary.trip.days[0].items.splice(1, 0, { id: 'transfer', type: 'transit', title: 'Rail transfer', fromStopId: 'start', toStopId: 'end', from: { name: 'Berlin Hbf' }, to: { name: 'Potsdam Hbf' }, mode: 'train', ticketRef: 'do-not-export' });
  assert.ok(inspectItinerary(itinerary).errors.some((error) => error.path === '/trip/days/0/items/1/ticketRef'));
});

test('reports the exact discriminator and unknown neighbor-stop reference paths', () => {
  const itinerary = validateItinerary(v10());
  itinerary.trip.days[0].items[1] = { id: 'bad', type: 'plane', title: 'Bad', fromStopId: 'missing', toStopId: 'start', from: { name: 'A' }, to: { name: 'B' }, mode: 'flight' };
  const result = inspectItinerary(itinerary);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.path), ['/trip/days/0/items/1/type']);
  itinerary.trip.days[0].items[1].type = 'transit';
  assert.ok(inspectItinerary(itinerary).errors.some((error) => error.path === '/trip/days/0/items/1/fromStopId'));
});

test('validates optional WGS84 stop coordinates with exact paths', () => {
  const itinerary = validateItinerary(v10());
  itinerary.trip.days[0].items[0].lat = 38.7676; itinerary.trip.days[0].items[0].lng = -9.0992;
  assert.equal(inspectItinerary(itinerary).valid, true);
  itinerary.trip.days[0].items[0].lat = 91;
  assert.ok(inspectItinerary(itinerary).errors.some((error) => error.path === '/trip/days/0/items/0/lat'));
});
