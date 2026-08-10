import { ItineraryLoadError } from './errors.js';
import { validateItinerary } from './validate.js';

export const DEFAULT_SCHEMA_PATH = 'data/schemas/itinerary.v1.schema.json';
export const DEFAULT_ITINERARY_PATH = 'data/itineraries/example.v1.json';

export function assetUrl(relativePath, baseUrl = import.meta.env.BASE_URL, origin = globalThis.location?.origin ?? 'http://localhost') {
  const scope = new URL(baseUrl, `${origin}/`);
  const resolved = new URL(relativePath, scope);
  if (resolved.origin !== scope.origin || !resolved.pathname.startsWith(scope.pathname)) {
    throw new ItineraryLoadError('FETCH_ERROR', `Asset path must stay within ${scope.pathname}.`, { path: relativePath });
  }
  return resolved.href;
}

async function fetchJson(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new ItineraryLoadError('FETCH_ERROR', `Could not fetch ${label} at ${url}.`, { path: url, cause });
  }
  if (!response.ok) {
    throw new ItineraryLoadError('FETCH_ERROR', `Could not fetch ${label} at ${url} (HTTP ${response.status}).`, { path: url });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new ItineraryLoadError('PARSE_ERROR', `Could not parse ${label} JSON at ${url}.`, { path: url, cause });
  }
}

export async function loadItinerary({
  fetchImpl = fetch,
  baseUrl = import.meta.env.BASE_URL,
  origin,
  schemaPath = DEFAULT_SCHEMA_PATH,
  itineraryPath = DEFAULT_ITINERARY_PATH,
} = {}) {
  const schemaUrl = assetUrl(schemaPath, baseUrl, origin);
  const itineraryUrl = assetUrl(itineraryPath, baseUrl, origin);
  const [schema, itinerary] = await Promise.all([
    fetchJson(fetchImpl, schemaUrl, 'itinerary schema'),
    fetchJson(fetchImpl, itineraryUrl, 'itinerary'),
  ]);
  return validateItinerary(itinerary, schema);
}
