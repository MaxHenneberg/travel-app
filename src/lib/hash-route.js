const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export class HashRouteError extends TypeError {
  constructor(code, message, hash) {
    super(message);
    this.name = 'HashRouteError';
    this.code = code;
    this.hash = hash;
  }
}

export function isSafeRouteId(value) {
  return typeof value === 'string'
    && SAFE_ID.test(value)
    && value !== '.'
    && value !== '..'
    && !value.includes('..');
}

function safeId(value, label, hash) {
  if (!isSafeRouteId(value)) {
    throw new HashRouteError('UNSAFE_ROUTE_ID', `${label} must be 1-128 URL-safe characters and may not contain traversal sequences.`, hash);
  }
  return value;
}

function decode(segment, hash) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HashRouteError('MALFORMED_ENCODING', 'Route contains malformed percent encoding.', hash);
  }
}

/** Parses #/trip/{id}/v/{revision}[/day/{dayId}]. Empty hashes return null. */
export function parseHashRoute(input = globalThis.location?.hash ?? '') {
  const hash = String(input);
  if (hash === '' || hash === '#') return null;
  if (!hash.startsWith('#/')) throw new HashRouteError('INVALID_ROUTE', 'Route must start with "#/".', hash);

  const raw = hash.slice(2).split('/');
  if ((raw.length !== 4 && raw.length !== 6) || raw[0] !== 'trip' || raw[2] !== 'v' || (raw.length === 6 && raw[4] !== 'day')) {
    throw new HashRouteError('INVALID_ROUTE', 'Expected #/trip/{id}/v/{revision} or #/trip/{id}/v/{revision}/day/{dayId}.', hash);
  }
  const tripId = safeId(decode(raw[1], hash), 'Trip id', hash);
  const revisionText = decode(raw[3], hash);
  if (!/^[1-9]\d{0,8}$/.test(revisionText)) {
    throw new HashRouteError('INVALID_REVISION', 'Revision must be a positive integer with at most 9 digits.', hash);
  }
  const dayId = raw.length === 6 ? safeId(decode(raw[5], hash), 'Day id', hash) : null;
  return { tripId, revision: Number(revisionText), dayId };
}

export function tryParseHashRoute(input) {
  try {
    return { route: parseHashRoute(input), error: null };
  } catch (error) {
    if (!(error instanceof HashRouteError)) throw error;
    return { route: null, error };
  }
}

export function buildHashRoute({ tripId, revision, dayId = null }) {
  const safeTripId = safeId(tripId, 'Trip id', '');
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999_999_999) {
    throw new HashRouteError('INVALID_REVISION', 'Revision must be a positive integer with at most 9 digits.', '');
  }
  const day = dayId === null || dayId === undefined ? '' : `/day/${encodeURIComponent(safeId(dayId, 'Day id', ''))}`;
  return `#/trip/${encodeURIComponent(safeTripId)}/v/${revision}${day}`;
}
