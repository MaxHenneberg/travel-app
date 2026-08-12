const MAPS_API_URL = 'https://www.google.com/maps/dir/';
const MAPS_SEARCH_URL = 'https://www.google.com/maps/search/';
const TRAVEL_MODES = new Set(['driving', 'walking', 'bicycling', 'transit', 'two-wheeler']);

function placeValue(place) {
  if (typeof place === 'string') return place.trim();
  if (place && typeof place === 'object') {
    if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) return `${place.lat},${place.lng}`;
    return String(place.query ?? place.name ?? place.address ?? place.location ?? '').trim();
  }
  return '';
}

function requiredPlace(place, label) {
  const value = placeValue(place);
  if (!value) throw new TypeError(`${label} must contain an address, place name, or latitude/longitude.`);
  return value;
}

function apiUrl(base, parameters) {
  const url = new URL(base);
  url.searchParams.set('api', '1');
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url.href;
}

export function buildGoogleMapsPlaceUrl(place) {
  const query = requiredPlace(place, 'Place');
  const placeId = typeof place === 'object' ? place.placeId : undefined;
  return apiUrl(MAPS_SEARCH_URL, { query, query_place_id: placeId });
}

function validateMode(mode) {
  if (mode !== undefined && !TRAVEL_MODES.has(mode)) {
    throw new TypeError(`Unsupported Google Maps travel mode: ${mode}.`);
  }
}

/** Builds a single ordered directions URL. Use buildGoogleMapsRouteUrls for arbitrary stop counts. */
export function buildGoogleMapsRouteUrl(stops, { travelMode, avoid, waypointLimit = 9 } = {}) {
  if (!Array.isArray(stops) || stops.length < 2) throw new TypeError('A route needs at least two ordered stops.');
  if (!Number.isInteger(waypointLimit) || waypointLimit < 0) throw new TypeError('waypointLimit must be a non-negative integer.');
  if (stops.length - 2 > waypointLimit) {
    throw new RangeError(`Route has ${stops.length - 2} waypoints; the configured limit is ${waypointLimit}. Use buildGoogleMapsRouteUrls() to chunk it.`);
  }
  validateMode(travelMode);
  const values = stops.map((stop, index) => requiredPlace(stop, `Stop ${index + 1}`));
  return apiUrl(MAPS_API_URL, {
    origin: values[0],
    destination: values.at(-1),
    waypoints: values.slice(1, -1).join('|'),
    travelmode: travelMode,
    avoid,
  });
}

/**
 * Returns one or more URLs while preserving stop order. Consecutive chunks overlap
 * at one stop so the destination of a chunk is the origin of the next chunk.
 */
export function buildGoogleMapsRouteUrls(stops, options = {}) {
  if (!Array.isArray(stops) || stops.length < 2) throw new TypeError('A route needs at least two ordered stops.');
  const waypointLimit = options.waypointLimit ?? 9;
  if (!Number.isInteger(waypointLimit) || waypointLimit < 0) throw new TypeError('waypointLimit must be a non-negative integer.');
  const pointsPerChunk = waypointLimit + 2;
  const urls = [];
  for (let start = 0; start < stops.length - 1; start += pointsPerChunk - 1) {
    const chunk = stops.slice(start, start + pointsPerChunk);
    if (chunk.length >= 2) urls.push(buildGoogleMapsRouteUrl(chunk, { ...options, waypointLimit }));
  }
  return urls;
}

export const googleMapsPlaceUrl = buildGoogleMapsPlaceUrl;
export const googleMapsRouteUrls = buildGoogleMapsRouteUrls;
