import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assetUrl, loadItinerary } from '../../src/itinerary/load.js';
import { validateItinerary } from '../../src/itinerary/validate.js';

const schema = JSON.parse(await readFile(new URL('../../public/data/schemas/itinerary.v1.schema.json', import.meta.url)));
const fixture = JSON.parse(await readFile(new URL('../../public/data/itineraries/example.v1.json', import.meta.url)));
const japanFixture = JSON.parse(await readFile(new URL('../../public/data/itineraries/Japan_2026.itinerary.json', import.meta.url)));

test('accepts the bundled v1 fixture and omitted optional fields', () => {
  const minimal = structuredClone(fixture);
  delete minimal.trip.summary;
  delete minimal.trip.days[0].title;
  delete minimal.trip.days[0].activities[0].category;
  assert.equal(validateItinerary(minimal, schema), minimal);
});

test('accepts optional secure image metadata and rejects unsafe entries', () => {
  const withImages = structuredClone(fixture);
  withImages.trip.days[0].activities[0].images = [{
    url: 'https://images.example/place.jpg',
    alt: 'A city square',
    caption: 'At sunrise',
    credit: 'Example photographer',
    sourceUrl: 'https://images.example/source',
  }];
  assert.equal(validateItinerary(withImages, schema), withImages);

  const bundled = structuredClone(withImages);
  bundled.trip.days[0].activities[0].images[0].url = 'images/stops/kyoto-temple.png';
  assert.equal(validateItinerary(bundled, schema), bundled);

  const insecure = structuredClone(withImages);
  insecure.trip.days[0].activities[0].images[0].url = 'http://images.example/place.jpg';
  assert.throws(() => validateItinerary(insecure, schema), (error) => error.path.endsWith('/images/0/url'));

  const incomplete = structuredClone(withImages);
  delete incomplete.trip.days[0].activities[0].images[0].alt;
  assert.throws(() => validateItinerary(incomplete, schema), (error) => error.path.endsWith('/images/0/alt'));
});

test('bundled Japan source references app-scoped generated stop artwork', async () => {
  const sensoji = japanFixture.stops[0].days[1].items.find((item) => item.id === 'tokyo-2026-09-07-sensoji');
  assert.deepEqual(sensoji.images, [{
    url: 'images/stops/kyoto-temple.png',
    alt: 'Traditional Japanese temple framed by autumn foliage',
    caption: 'Temple atmosphere for the Japan itinerary',
    credit: 'Trailbook generated artwork',
  }]);
  assert.ok((await readFile(new URL(`../../public/${sensoji.images[0].url}`, import.meta.url))).byteLength > 0);
});

test('reports a missing required field using its JSON path', () => {
  const invalid = structuredClone(fixture);
  delete invalid.trip.title;
  assert.throws(
    () => validateItinerary(invalid, schema),
    (error) => error.code === 'VALIDATION_ERROR' && error.path === '/trip/title' && error.message.includes('/trip/title'),
  );
});

test('reports an invalid type using its JSON path', () => {
  const invalid = structuredClone(fixture);
  invalid.trip.days[0].date = 42;
  assert.throws(
    () => validateItinerary(invalid, schema),
    (error) => error.code === 'VALIDATION_ERROR' && error.path === '/trip/days/0/date',
  );
});

test('rejects unsupported versions before schema validation', () => {
  const incompatible = structuredClone(fixture);
  incompatible.schemaVersion = '2.0.0';
  assert.throws(
    () => validateItinerary(incompatible, schema),
    (error) => error.code === 'UNSUPPORTED_SCHEMA_VERSION'
      && error.path === '/schemaVersion'
      && error.message.includes('expected 1.0.0, received 2.0.0'),
  );
});

test('loads schema and itinerary from URLs scoped to the repository base path', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const body = url.endsWith('itinerary.v1.schema.json') ? schema : fixture;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await loadItinerary({ fetchImpl, baseUrl: '/travel-app/', origin: 'https://example.test' });
  assert.equal(result.trip.title, fixture.trip.title);
  assert.deepEqual(requested, [
    'https://example.test/travel-app/data/schemas/itinerary.v1.schema.json',
    'https://example.test/travel-app/data/itineraries/example.v1.json',
  ]);
  assert.throws(() => assetUrl('../outside.json', '/travel-app/', 'https://example.test'), /must stay within/);
});
