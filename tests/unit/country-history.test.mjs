import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCountryHistoryStore, deriveVisitedCountries, validateCountryCode } from '../../src/lib/country-history.js';

const itinerary = (countryCodes = ['jp', 'JP', 'DE']) => ({
  schemaVersion: '1.0.0', trip: { id: 'trip', revision: 1, countryCode: 'US', days: [
    { id: 'one', date: '2026-04-10', activities: countryCodes.map((countryCode, index) => ({ id: `${index}`, countryCode })) },
    { id: 'two', date: '2026-04-11', countryCode: 'JP', activities: [] },
  ] },
});

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('derives normalized countries deterministically and deduplicates same-day locations', () => {
  assert.deepEqual(deriveVisitedCountries(itinerary()), [
    { countryCode: 'DE', date: '2026-04-10' },
    { countryCode: 'JP', date: '2026-04-10' },
    { countryCode: 'JP', date: '2026-04-11' },
  ]);
});

test('preserves manual provenance, suppression and metadata across reloads and re-import', () => {
  const localStorage = storage(); const first = createCountryHistoryStore({ storage: localStorage });
  first.importItinerary(itinerary());
  first.correct('JP', { countryCode: 'FR', visits: 3, firstVisited: '2020-01-02', lastVisited: '2024-05-06' });
  first.remove('DE'); first.importItinerary(itinerary());
  const reopened = createCountryHistoryStore({ storage: localStorage });
  assert.deepEqual(reopened.getHistory(), [{ countryCode: 'FR', visits: 3, firstVisited: '2020-01-02', lastVisited: '2024-05-06', sources: ['manual'] }]);
});

test('rejects invalid manual values non-destructively and ignores invalid imported codes', () => {
  const localStorage = storage(); const history = createCountryHistoryStore({ storage: localStorage });
  history.addManual({ countryCode: 'DE' }); const before = history.getHistory();
  assert.throws(() => history.addManual({ countryCode: 'ZZ' }), /not a supported ISO/);
  assert.throws(() => validateCountryCode('../'), /not a supported ISO/);
  history.importItinerary({ trip: { id: 'invalid-trip', days: [{ date: '2026-04-10', activities: [{ countryCode: 'ZZ' }, { countryCode: '../' }] }] } });
  assert.deepEqual(history.getHistory(), before);
});
