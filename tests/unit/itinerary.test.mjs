import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assetUrl, loadItinerary } from '../../src/itinerary/load.js';
import { validateItinerary } from '../../src/itinerary/validate.js';

const schema = JSON.parse(await readFile(new URL('../../public/data/schemas/itinerary.v1.schema.json', import.meta.url)));
const fixture = JSON.parse(await readFile(new URL('../../public/data/itineraries/example.v1.json', import.meta.url)));

test('accepts the bundled v1 fixture and omitted optional fields', () => {
  const minimal = structuredClone(fixture);
  delete minimal.trip.summary;
  delete minimal.trip.days[0].title;
  delete minimal.trip.days[0].activities[0].category;
  assert.equal(validateItinerary(minimal, schema), minimal);
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
