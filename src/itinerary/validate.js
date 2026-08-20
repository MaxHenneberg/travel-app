import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ItineraryLoadError } from './errors.js';

export const SUPPORTED_SCHEMA_VERSION = '1.1.0';

const validators = new WeakMap();

function validatorFor(schema) {
  if (!validators.has(schema)) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
    addFormats(ajv);
    validators.set(schema, ajv.compile(schema));
  }
  return validators.get(schema);
}

function errorPath(error) {
  if (error.keyword === 'required') {
    const parent = error.instancePath || '';
    return `${parent}/${error.params.missingProperty}`;
  }
  return error.instancePath || '$';
}

export function validateItinerary(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ItineraryLoadError('VALIDATION_ERROR', 'Invalid itinerary at $: must be an object.', { path: '$' });
  }

  if (value.schemaVersion === '1.0.0') {
    const migrated = structuredClone(value);
    migrated.schemaVersion = SUPPORTED_SCHEMA_VERSION;
    migrated.trip.days = migrated.trip.days.map(({ activities = [], ...day }) => ({ ...day, items: activities.map((activity) => ({ ...activity, type: 'stop' })) }));
    return validateItinerary(migrated, schema);
  }
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    const actual = typeof value.schemaVersion === 'string' ? value.schemaVersion : 'missing';
    throw new ItineraryLoadError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported itinerary schema version at /schemaVersion: expected ${SUPPORTED_SCHEMA_VERSION}, received ${actual}.`,
      { path: '/schemaVersion' },
    );
  }

  const validate = validatorFor(schema);
  if (!validate(value)) {
    const issues = validate.errors.map((error) => ({ path: errorPath(error), message: error.message, keyword: error.keyword, schemaPath: error.schemaPath }));
    // `oneOf` reports failures for both branches. Prefer the concrete field error
    // over the stop branch's missing title/type noise for a transit item.
    const first = issues.find((error) => error.schemaPath?.includes('/transit/') && !['required', 'const', 'oneOf'].includes(error.keyword))
      ?? issues.find((error) => !['required', 'const', 'oneOf'].includes(error.keyword)) ?? issues[0];
    throw new ItineraryLoadError(
      'VALIDATION_ERROR',
      `Invalid itinerary at ${first.path}: ${first.message}.`,
      { path: first.path, issues },
    );
  }

  return value;
}
