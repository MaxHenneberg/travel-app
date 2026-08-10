import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGoogleMapsPlaceUrl,
  buildGoogleMapsRouteUrls,
  buildHashRoute,
  createTripStore,
  inspectItinerary,
  parseHashRoute,
  validateItinerary,
} from '../../src/lib/index.js';

const itinerary = () => ({
  schemaVersion: '1.0.0',
  trip: {
    id: 'berlin-weekend', title: 'Berlin weekend', startDate: '2026-09-18', endDate: '2026-09-19', timeZone: 'Europe/Berlin',
    days: [{ id: 'arrival', date: '2026-09-18', activities: [{ id: 'museum', title: 'Museum', startsAt: '2026-09-18T15:00:00+02:00' }] }],
  },
});

const flatItinerary = (revision = 1) => ({
  schemaVersion: 1, id: 'weekend-lisbon', revision, title: 'A long weekend in Lisbon', destination: 'Lisbon, Portugal', dateRange: '18–20 September 2026',
  days: [{ id: 'arrival', date: 'Friday · 18 September', title: 'Arrival', summary: 'Settle in.', activities: [{
    id: 'tram', time: '17:00', duration: '25 min', title: 'Ride tram 28', type: 'Transport', description: 'Board downtown.', notes: 'Validate ticket.', reservation: 'LIS-1', cost: '€4',
    transport: { mode: 'Tram', line: '28E', from: 'Sé', to: 'Graça', platform: 'Street stop' },
    location: { name: 'Graça', lat: 38.7174, lng: -9.1307 }, links: [{ label: 'Details', url: 'https://example.com/tram' }],
  }] }],
});

test('validates the versioned itinerary and reports actionable paths', () => {
  assert.equal(validateItinerary(itinerary()).trip.id, 'berlin-weekend');
  assert.equal(validateItinerary(flatItinerary()).id, 'weekend-lisbon');
  const broken = itinerary();
  broken.schemaVersion = '2.0.0';
  broken.trip.days[0].date = '2026-99-99';
  const result = inspectItinerary(broken);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ path }) => path), ['/schemaVersion', '/trip/days/0/date']);
  assert.ok(result.errors.every(({ hint }) => hint.length > 0));

  const unknown = itinerary();
  unknown.trip.secret = true;
  assert.equal(inspectItinerary(unknown).errors[0].code, 'unknown_property');
});

test('round trips safe revision routes and rejects traversal', () => {
  const hash = buildHashRoute({ tripId: 'berlin-2026', revision: 3, dayId: 'day_1' });
  assert.equal(hash, '#/trip/berlin-2026/v/3/day/day_1');
  assert.deepEqual(parseHashRoute(hash), { tripId: 'berlin-2026', revision: 3, dayId: 'day_1' });
  assert.throws(() => parseHashRoute('#/trip/%2e%2e/v/3'), /traversal/i);
  assert.throws(() => parseHashRoute('#/trip/good%2Fbad/v/3'), /URL-safe/i);
  assert.throws(() => parseHashRoute('#/trip/good/v/0'), /positive integer/i);
});

test('generates encoded place and chunked ordered Google Maps URLs', () => {
  const place = new URL(buildGoogleMapsPlaceUrl({ query: 'Museum Island, Berlin', placeId: 'ChIJ a+b' }));
  assert.equal(place.searchParams.get('query'), 'Museum Island, Berlin');
  assert.equal(place.searchParams.get('query_place_id'), 'ChIJ a+b');
  assert.equal(new URL(buildGoogleMapsPlaceUrl({ name: 'MAAT Lisbon', placeId: 'ChIJ123' })).searchParams.get('query'), 'MAAT Lisbon');

  const stops = ['A & one', 'B/two', 'C three', 'D?four', 'E#five', 'F six'];
  const routes = buildGoogleMapsRouteUrls(stops, { waypointLimit: 2, travelMode: 'walking' });
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((url) => {
    const query = new URL(url).searchParams;
    return [query.get('origin'), query.get('waypoints'), query.get('destination')];
  }), [['A & one', 'B/two|C three', 'D?four'], ['D?four', 'E#five', 'F six']]);
});

test('stores multiple trips with localStorage and isolates returned values', async () => {
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const store = createTripStore({ indexedDB: undefined, localStorage });
  const first = itinerary();
  const second = itinerary(); second.trip.id = 'second'; second.trip.title = 'Second';
  await store.saveTrip(second);
  await store.saveTrip(first);
  first.trip.title = 'mutated outside';
  assert.equal(await store.storageMode(), 'localstorage');
  assert.deepEqual((await store.listTrips()).map((value) => value.trip.id), ['berlin-weekend', 'second']);
  assert.equal((await store.getTrip('berlin-weekend')).trip.title, 'Berlin weekend');
  await store.deleteTrip('second');
  assert.equal((await store.listTrips()).length, 1);
});

test('stores immutable flat itinerary revisions independently', async () => {
  const store = createTripStore({ indexedDB: undefined, localStorage: undefined });
  await store.saveTrip(flatItinerary(1));
  const revision2 = flatItinerary(2); revision2.title = 'Updated Lisbon';
  await store.saveTrip(revision2);
  assert.equal((await store.getTrip('weekend-lisbon', 1)).title, 'A long weekend in Lisbon');
  assert.equal((await store.getTrip('weekend-lisbon', 2)).title, 'Updated Lisbon');
  assert.equal((await store.getTrip('weekend-lisbon')).revision, 2);
  await store.deleteTrip('weekend-lisbon', 1);
  assert.equal(await store.getTrip('weekend-lisbon', 1), null);
  assert.equal((await store.listTrips()).length, 1);
});

test('falls back to memory when browser persistence is unavailable', async () => {
  const store = createTripStore({ indexedDB: undefined, localStorage: undefined });
  await store.saveTrip(itinerary());
  assert.equal(await store.storageMode(), 'memory');
  assert.equal((await store.getTrip('berlin-weekend')).trip.id, 'berlin-weekend');
});

test('downgrades to memory when localStorage becomes unwritable', async () => {
  let writes = 0;
  const localStorage = {
    getItem: () => null,
    setItem: () => { if (++writes > 1) throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
  };
  const store = createTripStore({ indexedDB: undefined, localStorage });
  await store.saveTrip(itinerary());
  assert.equal(await store.storageMode(), 'memory');
  assert.equal((await store.listTrips()).length, 1);
});
