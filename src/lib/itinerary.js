export const ITINERARY_SCHEMA_VERSION = '1.1.0';
export const LEGACY_ITINERARY_SCHEMA_VERSION = '1.0.0';
export const TRANSIT_MODES = new Set(['walk', 'bicycle', 'car', 'taxi', 'bus', 'tram', 'metro', 'subway', 'train', 'ferry', 'flight', 'other']);

export class ItineraryValidationError extends TypeError {
  constructor(errors) {
    const issues = Array.isArray(errors) ? errors : [errors];
    const first = issues[0] ?? { path: '$', message: 'is invalid' };
    super(`Invalid itinerary at ${first.path}: ${first.message}`);
    this.name = 'ItineraryValidationError';
    this.code = 'INVALID_ITINERARY';
    this.path = first.path;
    this.errors = issues;
  }
}

function issue(path, code, message, hint) {
  return { path, code, message, hint };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, path, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(issue(path, 'required_string', 'must be a non-empty string.', `Set ${path} to a non-empty string.`));
    return false;
  }
  return true;
}

function optionalString(value, path, errors) {
  if (value !== undefined) requiredString(value, path, errors);
}

function rejectUnknownProperties(value, allowed, path, errors) {
  for (const property of Object.keys(value)) {
    if (!allowed.has(property)) {
      const propertyPath = `${path}/${property}`;
      errors.push(issue(propertyPath, 'unknown_property', 'is not part of itinerary schema version 1.0.0.', `Remove ${propertyPath} or migrate it into a supported field.`));
    }
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function requiredDate(value, path, errors) {
  if (typeof value !== 'string' || !validDate(value)) {
    errors.push(issue(path, 'invalid_date', 'must be a real date in YYYY-MM-DD format.', `Use a date such as 2026-09-18 for ${path}.`));
  }
}

function requiredDateTime(value, path, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(issue(path, 'invalid_date_time', 'must be an ISO 8601 date-time.', `Use a date-time with an offset, such as 2026-09-18T15:00:00+02:00.`));
  }
}

function duplicateIds(items, path, errors) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    if (seen.has(item.id)) {
      errors.push(issue(`${path}/${index}/id`, 'duplicate_id', `duplicates the id "${item.id}".`, 'Give every item in this collection a unique id.'));
    }
    seen.add(item.id);
  }
}

function validateActivity(activity, path, errors) {
  if (!isRecord(activity)) {
    errors.push(issue(path, 'invalid_type', 'must be an object.', `Replace ${path} with an activity object.`));
    return;
  }
  rejectUnknownProperties(activity, new Set(['id', 'type', 'title', 'startsAt', 'endsAt', 'category', 'location', 'notes', 'description', 'duration', 'reservation', 'cost', 'links']), path, errors);
  requiredString(activity.id, `${path}/id`, errors);
  if (activity.type !== undefined && activity.type !== 'stop') errors.push(issue(`${path}/type`, 'invalid_discriminator', 'must be "stop" for a destination.', 'Set type to stop.'));
  requiredString(activity.title, `${path}/title`, errors);
  requiredDateTime(activity.startsAt, `${path}/startsAt`, errors);
  if (activity.endsAt !== undefined) requiredDateTime(activity.endsAt, `${path}/endsAt`, errors);
  for (const field of ['category', 'notes', 'description', 'duration', 'reservation']) optionalString(activity[field], `${path}/${field}`, errors);
  if (activity.location !== undefined) {
    if (typeof activity.location === 'string') optionalString(activity.location, `${path}/location`, errors);
    else validateFlatLocation(activity.location, `${path}/location`, errors);
  }

  if (typeof activity.startsAt === 'string' && typeof activity.endsAt === 'string'
      && !Number.isNaN(Date.parse(activity.startsAt)) && !Number.isNaN(Date.parse(activity.endsAt))
      && Date.parse(activity.endsAt) < Date.parse(activity.startsAt)) {
    errors.push(issue(`${path}/endsAt`, 'invalid_range', 'must not be before startsAt.', 'Move endsAt to the same time as or after startsAt.'));
  }
}

function validateDay(day, path, errors) {
  if (!isRecord(day)) {
    errors.push(issue(path, 'invalid_type', 'must be an object.', `Replace ${path} with a day object.`));
    return;
  }
  rejectUnknownProperties(day, new Set(['id', 'date', 'title', 'items', 'activities']), path, errors);
  requiredString(day.id, `${path}/id`, errors);
  requiredDate(day.date, `${path}/date`, errors);
  optionalString(day.title, `${path}/title`, errors);
  const items = day.items ?? day.activities;
  const itemKey = day.items ? 'items' : 'activities';
  if (!Array.isArray(items)) {
    errors.push(issue(`${path}/${itemKey}`, 'invalid_type', 'must be an array.', 'Use an empty array when the day has no itinerary items.'));
    return;
  }
  duplicateIds(items, `${path}/${itemKey}`, errors);
  items.forEach((item, index) => itemKey === 'activities'
    ? validateActivity(item, `${path}/${itemKey}/${index}`, errors)
    : validateTimelineItem(item, `${path}/${itemKey}/${index}`, errors, items));
}

function validateTransitEndpoint(value, path, errors, itemIds) {
  if (typeof value === 'string') {
    if (!itemIds.has(value)) errors.push(issue(path, 'invalid_reference', `references unknown stop id "${value}".`, 'Reference a stop in the same day or provide a location object.'));
    return;
  }
  validateFlatLocation(value, path, errors);
}

function validateTransitSegment(segment, path, errors) {
  if (!isRecord(segment)) { errors.push(issue(path, 'invalid_type', 'must be an object.', 'Use a segment object.')); return; }
  rejectUnknownProperties(segment, new Set(['id', 'mode', 'departure', 'arrival', 'duration', 'provider', 'operator', 'service', 'line', 'platform', 'gate', 'terminal', 'notes', 'instructions', 'reservation', 'ticket']), path, errors);
  requiredString(segment.mode, `${path}/mode`, errors);
  if (typeof segment.mode === 'string' && !TRANSIT_MODES.has(segment.mode)) errors.push(issue(`${path}/mode`, 'unsupported_mode', 'must be a supported transit mode.', `Use one of: ${[...TRANSIT_MODES].join(', ')}.`));
  for (const field of ['id', 'departure', 'arrival', 'duration', 'provider', 'operator', 'service', 'line', 'platform', 'gate', 'terminal', 'notes', 'instructions', 'reservation', 'ticket']) optionalString(segment[field], `${path}/${field}`, errors);
}

function validateTimelineItem(item, path, errors, items) {
  if (!isRecord(item)) { errors.push(issue(path, 'invalid_type', 'must be an object.', 'Use a stop or transit item object.')); return; }
  requiredString(item.id, `${path}/id`, errors);
  if (item.type === 'stop') { validateActivity(item, path, errors); return; }
  if (item.type !== 'transit') { errors.push(issue(`${path}/type`, 'invalid_discriminator', 'must be "stop" or "transit".', 'Set type to stop for a destination or transit for a journey.')); return; }
  rejectUnknownProperties(item, new Set(['id', 'type', 'from', 'to', 'mode', 'departure', 'arrival', 'duration', 'provider', 'operator', 'service', 'line', 'platform', 'gate', 'terminal', 'notes', 'instructions', 'reservation', 'ticket', 'segments']), path, errors);
  const itemIds = new Set(items.filter((candidate) => candidate?.type === 'stop').map((candidate) => candidate.id));
  validateTransitEndpoint(item.from, `${path}/from`, errors, itemIds);
  validateTransitEndpoint(item.to, `${path}/to`, errors, itemIds);
  requiredString(item.mode, `${path}/mode`, errors);
  if (typeof item.mode === 'string' && !TRANSIT_MODES.has(item.mode)) errors.push(issue(`${path}/mode`, 'unsupported_mode', 'must be a supported transit mode.', `Use one of: ${[...TRANSIT_MODES].join(', ')}.`));
  for (const field of ['departure', 'arrival', 'duration', 'provider', 'operator', 'service', 'line', 'platform', 'gate', 'terminal', 'notes', 'instructions', 'reservation', 'ticket']) optionalString(item[field], `${path}/${field}`, errors);
  if (item.segments !== undefined) {
    if (!Array.isArray(item.segments) || item.segments.length === 0) errors.push(issue(`${path}/segments`, 'invalid_segments', 'must be a non-empty array when provided.', 'Provide each ordered transfer segment.'));
    else item.segments.forEach((segment, index) => validateTransitSegment(segment, `${path}/segments/${index}`, errors));
  }
}

function validateFlatLocation(location, path, errors) {
  if (!isRecord(location)) {
    errors.push(issue(path, 'invalid_type', 'must be an object.', `Set ${path} to an object with a name and optional coordinates or placeId.`));
    return;
  }
  rejectUnknownProperties(location, new Set(['name', 'address', 'lat', 'lng', 'placeId']), path, errors);
  const hasLabel = [location.name, location.address, location.placeId].some((value) => typeof value === 'string' && value.trim() !== '');
  const hasCoordinates = Number.isFinite(location.lat) && Number.isFinite(location.lng);
  if (!hasLabel && !hasCoordinates) {
    errors.push(issue(path, 'missing_location', 'must contain a name, address, placeId, or latitude/longitude pair.', 'Add enough location data for Maps to identify this place.'));
  }
  optionalString(location.name, `${path}/name`, errors);
  if (location.lat !== undefined && (!Number.isFinite(location.lat) || location.lat < -90 || location.lat > 90)) {
    errors.push(issue(`${path}/lat`, 'invalid_coordinate', 'must be a number between -90 and 90.', 'Correct or remove this latitude.'));
  }
  if (location.lng !== undefined && (!Number.isFinite(location.lng) || location.lng < -180 || location.lng > 180)) {
    errors.push(issue(`${path}/lng`, 'invalid_coordinate', 'must be a number between -180 and 180.', 'Correct or remove this longitude.'));
  }
  optionalString(location.address, `${path}/address`, errors);
  optionalString(location.placeId, `${path}/placeId`, errors);
}

function validateFlatActivity(activity, path, errors) {
  if (!isRecord(activity)) {
    errors.push(issue(path, 'invalid_type', 'must be an object.', `Replace ${path} with an activity object.`));
    return;
  }
  rejectUnknownProperties(activity, new Set(['id', 'time', 'duration', 'title', 'type', 'description', 'notes', 'reservation', 'cost', 'transport', 'location', 'links']), path, errors);
  requiredString(activity.id, `${path}/id`, errors);
  requiredString(activity.title, `${path}/title`, errors);
  for (const field of ['time', 'duration', 'type', 'description', 'notes', 'reservation']) optionalString(activity[field], `${path}/${field}`, errors);
  if (activity.cost !== undefined && typeof activity.cost !== 'string' && typeof activity.cost !== 'number') {
    errors.push(issue(`${path}/cost`, 'invalid_type', 'must be a string or number.', 'Use a display value such as "€20" or a numeric amount.'));
  }
  if (activity.location !== undefined) validateFlatLocation(activity.location, `${path}/location`, errors);
  if (activity.transport !== undefined) {
    if (!isRecord(activity.transport)) {
      errors.push(issue(`${path}/transport`, 'invalid_type', 'must be an object.', 'Use an object describing the transport leg.'));
    } else {
      rejectUnknownProperties(activity.transport, new Set(['mode', 'line', 'from', 'to', 'platform', 'departure', 'arrival']), `${path}/transport`, errors);
      for (const [field, value] of Object.entries(activity.transport)) optionalString(value, `${path}/transport/${field}`, errors);
    }
  }
  if (activity.links !== undefined) {
    if (!Array.isArray(activity.links)) {
      errors.push(issue(`${path}/links`, 'invalid_type', 'must be an array.', 'Use an empty array when there are no links.'));
    } else {
      activity.links.forEach((link, index) => {
        const linkPath = `${path}/links/${index}`;
        if (!isRecord(link)) {
          errors.push(issue(linkPath, 'invalid_type', 'must be an object.', 'Use an object with label and url fields.'));
          return;
        }
        rejectUnknownProperties(link, new Set(['label', 'url']), linkPath, errors);
        requiredString(link.label, `${linkPath}/label`, errors);
        requiredString(link.url, `${linkPath}/url`, errors);
        if (typeof link.url === 'string' && !/^https?:\/\//i.test(link.url)) {
          errors.push(issue(`${linkPath}/url`, 'unsafe_url', 'must use an http or https URL.', 'Use an absolute https:// URL.'));
        }
      });
    }
  }
}

function inspectFlatItinerary(value) {
  const errors = [];
  rejectUnknownProperties(value, new Set(['schemaVersion', 'id', 'revision', 'title', 'destination', 'dateRange', 'summary', 'days']), '', errors);
  if (value.schemaVersion !== 1) {
    errors.push(issue('/schemaVersion', 'unsupported_version', `must be 1; received ${JSON.stringify(value.schemaVersion)}.`, 'Export or migrate this itinerary to schema version 1.'));
  }
  requiredString(value.id, '/id', errors);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    errors.push(issue('/revision', 'invalid_revision', 'must be a positive integer.', 'Set revision to 1 for the first immutable version and increment it for later versions.'));
  }
  requiredString(value.title, '/title', errors);
  optionalString(value.destination, '/destination', errors);
  optionalString(value.dateRange, '/dateRange', errors);
  optionalString(value.summary, '/summary', errors);
  if (!Array.isArray(value.days)) {
    errors.push(issue('/days', 'invalid_type', 'must be an array.', 'Use an empty array when the itinerary has no days.'));
  } else {
    duplicateIds(value.days, '/days', errors);
    value.days.forEach((day, index) => {
      const path = `/days/${index}`;
      if (!isRecord(day)) {
        errors.push(issue(path, 'invalid_type', 'must be an object.', `Replace ${path} with a day object.`));
        return;
      }
      rejectUnknownProperties(day, new Set(['id', 'date', 'title', 'summary', 'activities']), path, errors);
      requiredString(day.id, `${path}/id`, errors);
      requiredString(day.date, `${path}/date`, errors);
      optionalString(day.title, `${path}/title`, errors);
      optionalString(day.summary, `${path}/summary`, errors);
      if (!Array.isArray(day.activities)) {
        errors.push(issue(`${path}/activities`, 'invalid_type', 'must be an array.', 'Use an empty array when the day has no activities.'));
      } else {
        duplicateIds(day.activities, `${path}/activities`, errors);
        day.activities.forEach((activity, activityIndex) => validateFlatActivity(activity, `${path}/activities/${activityIndex}`, errors));
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates the stable v1 itinerary contract without mutating the input.
 * Returns every useful issue so a UI can show more than the first failure.
 */
export function inspectItinerary(value, { supportedVersion = ITINERARY_SCHEMA_VERSION } = {}) {
  const errors = [];
  if (!isRecord(value)) {
    errors.push(issue('$', 'invalid_type', 'must be an object.', 'Provide a parsed itinerary JSON object.'));
    return { valid: false, errors };
  }

  if (value.schemaVersion === 1 || ('revision' in value && 'days' in value && !('trip' in value))) {
    return inspectFlatItinerary(value);
  }

  rejectUnknownProperties(value, new Set(['schemaVersion', 'trip']), '', errors);

  if (value.schemaVersion !== supportedVersion && value.schemaVersion !== LEGACY_ITINERARY_SCHEMA_VERSION) {
    errors.push(issue('/schemaVersion', 'unsupported_version', `must be "${supportedVersion}"; received ${JSON.stringify(value.schemaVersion)}.`, `Export or migrate this itinerary to schema version ${supportedVersion}.`));
  }
  if (!isRecord(value.trip)) {
    errors.push(issue('/trip', 'invalid_type', 'must be an object.', 'Add a trip object containing id, title, dates, timeZone, and days.'));
    return { valid: false, errors };
  }

  const { trip } = value;
  rejectUnknownProperties(trip, new Set(['id', 'title', 'summary', 'startDate', 'endDate', 'timeZone', 'days']), '/trip', errors);
  requiredString(trip.id, '/trip/id', errors);
  requiredString(trip.title, '/trip/title', errors);
  optionalString(trip.summary, '/trip/summary', errors);
  requiredDate(trip.startDate, '/trip/startDate', errors);
  requiredDate(trip.endDate, '/trip/endDate', errors);
  requiredString(trip.timeZone, '/trip/timeZone', errors);

  if (validDate(trip.startDate ?? '') && validDate(trip.endDate ?? '') && trip.endDate < trip.startDate) {
    errors.push(issue('/trip/endDate', 'invalid_range', 'must not be before startDate.', 'Move endDate to the same day as or after startDate.'));
  }
  if (!Array.isArray(trip.days)) {
    errors.push(issue('/trip/days', 'invalid_type', 'must be an array.', 'Use an empty array when the trip has no itinerary days.'));
  } else {
    duplicateIds(trip.days, '/trip/days', errors);
    trip.days.forEach((day, index) => validateDay(day, `/trip/days/${index}`, errors));
    for (const [index, day] of trip.days.entries()) {
      if (isRecord(day) && validDate(day.date ?? '') && validDate(trip.startDate ?? '') && validDate(trip.endDate ?? '')
          && (day.date < trip.startDate || day.date > trip.endDate)) {
        errors.push(issue(`/trip/days/${index}/date`, 'outside_trip_range', 'must fall between the trip startDate and endDate.', 'Change the day date or expand the trip date range.'));
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Converts the published 1.0 activity list into the 1.1 ordered item model without losing fields or local date strings. */
export function migrateItinerary(value) {
  if (!isRecord(value) || value.schemaVersion !== LEGACY_ITINERARY_SCHEMA_VERSION || !isRecord(value.trip)) return value;
  const migrated = structuredClone(value);
  migrated.schemaVersion = ITINERARY_SCHEMA_VERSION;
  migrated.trip.days = migrated.trip.days.map((day) => {
    const { activities = [], ...rest } = day;
    return { ...rest, items: activities.map((activity) => ({ ...activity, type: 'stop' })) };
  });
  return migrated;
}

export function validateItinerary(value, options) {
  const result = inspectItinerary(value, options);
  if (!result.valid) throw new ItineraryValidationError(result.errors);
  return value;
}

export function parseItinerary(json, options) {
  let value;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new ItineraryValidationError(issue('$', 'invalid_json', `contains invalid JSON (${cause.message}).`, 'Fix the JSON syntax and try again.'));
  }
  validateItinerary(value, options);
  return migrateItinerary(value);
}
