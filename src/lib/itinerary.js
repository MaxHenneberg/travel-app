export const ITINERARY_SCHEMA_VERSION = '1.0.0';

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

function validateImages(images, path, errors) {
  if (!Array.isArray(images)) {
    errors.push(issue(path, 'invalid_type', 'must be an array.', 'Use an array of image metadata objects.'));
    return;
  }
  images.forEach((image, index) => {
    const imagePath = `${path}/${index}`;
    if (!isRecord(image)) {
      errors.push(issue(imagePath, 'invalid_type', 'must be an object.', 'Use an object with url and alt fields.'));
      return;
    }
    rejectUnknownProperties(image, new Set(['url', 'alt', 'caption', 'credit', 'sourceUrl']), imagePath, errors);
    requiredString(image.url, `${imagePath}/url`, errors);
    if (typeof image.url === 'string' && !/^https:\/\//i.test(image.url) && !/^images\/stops\/[a-z0-9][a-z0-9._/-]*$/i.test(image.url)) {
      errors.push(issue(`${imagePath}/url`, 'unsafe_url', 'must use an https URL or a bundled stop image path.', 'Use an absolute https:// URL or images/stops/<file>.'));
    }
    if (typeof image.alt !== 'string') {
      errors.push(issue(`${imagePath}/alt`, 'required_string', 'must be a string.', 'Describe the image, or use an empty string only when it is decorative.'));
    }
    for (const field of ['caption', 'credit']) optionalString(image[field], `${imagePath}/${field}`, errors);
    if (image.sourceUrl !== undefined) {
      requiredString(image.sourceUrl, `${imagePath}/sourceUrl`, errors);
      if (typeof image.sourceUrl === 'string' && !/^https:\/\//i.test(image.sourceUrl)) {
        errors.push(issue(`${imagePath}/sourceUrl`, 'unsafe_url', 'must use an https URL.', 'Use an absolute https:// source URL.'));
      }
    }
  });
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
  rejectUnknownProperties(activity, new Set(['id', 'title', 'startsAt', 'endsAt', 'category', 'location', 'notes', 'images']), path, errors);
  requiredString(activity.id, `${path}/id`, errors);
  requiredString(activity.title, `${path}/title`, errors);
  requiredDateTime(activity.startsAt, `${path}/startsAt`, errors);
  if (activity.endsAt !== undefined) requiredDateTime(activity.endsAt, `${path}/endsAt`, errors);
  optionalString(activity.category, `${path}/category`, errors);
  optionalString(activity.location, `${path}/location`, errors);
  optionalString(activity.notes, `${path}/notes`, errors);
  if (activity.images !== undefined) validateImages(activity.images, `${path}/images`, errors);

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
  rejectUnknownProperties(day, new Set(['id', 'date', 'title', 'activities']), path, errors);
  requiredString(day.id, `${path}/id`, errors);
  requiredDate(day.date, `${path}/date`, errors);
  optionalString(day.title, `${path}/title`, errors);
  if (!Array.isArray(day.activities)) {
    errors.push(issue(`${path}/activities`, 'invalid_type', 'must be an array.', 'Use an empty array when the day has no activities.'));
    return;
  }
  duplicateIds(day.activities, `${path}/activities`, errors);
  day.activities.forEach((activity, index) => validateActivity(activity, `${path}/activities/${index}`, errors));
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
  rejectUnknownProperties(activity, new Set(['id', 'time', 'duration', 'title', 'type', 'description', 'notes', 'reservation', 'cost', 'transport', 'location', 'links', 'images']), path, errors);
  requiredString(activity.id, `${path}/id`, errors);
  requiredString(activity.title, `${path}/title`, errors);
  for (const field of ['time', 'duration', 'type', 'description', 'notes', 'reservation']) optionalString(activity[field], `${path}/${field}`, errors);
  if (activity.cost !== undefined && typeof activity.cost !== 'string' && typeof activity.cost !== 'number') {
    errors.push(issue(`${path}/cost`, 'invalid_type', 'must be a string or number.', 'Use a display value such as "€20" or a numeric amount.'));
  }
  if (activity.location !== undefined) validateFlatLocation(activity.location, `${path}/location`, errors);
  if (activity.images !== undefined) validateImages(activity.images, `${path}/images`, errors);
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

  if (value.schemaVersion !== supportedVersion) {
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
  return validateItinerary(value, options);
}
