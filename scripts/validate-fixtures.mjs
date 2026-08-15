import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { inspectItinerary } from '../src/lib/itinerary.js';

const publicRoot = new URL('../public/', import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, publicRoot), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const schema = await json('data/schemas/itinerary.v1.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateCanonical = ajv.compile(schema);
const canonical = await json('data/itineraries/example.v1.json');
assert(validateCanonical(canonical), `example.v1.json violates itinerary.v1.schema.json: ${ajv.errorsText(validateCanonical.errors)}`);

const index = await json('data/itineraries/index.json');
assert(index.schemaVersion === 1 && Array.isArray(index.itineraries), 'itinerary index must use schemaVersion 1 and contain an itineraries array');
const entries = new Set();
for (const entry of index.itineraries) {
  assert(typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry.id), 'indexed itinerary IDs must be URL-safe');
  assert(Number.isInteger(entry.revision) && entry.revision > 0, `invalid revision for ${entry.id}`);
  const identity = `${entry.id}@${entry.revision}`;
  assert(!entries.has(identity), `duplicate itinerary index entry ${identity}`);
  entries.add(identity);

  const itinerary = await json(`data/itineraries/${entry.id}/v${entry.revision}.json`);
  const result = inspectItinerary(itinerary);
  assert(result.valid, `${identity} is invalid: ${result.errors.map(({ path, message }) => `${path}: ${message}`).join('; ')}`);
  assert(itinerary.id === entry.id && itinerary.revision === entry.revision, `${identity} does not match its indexed identity`);
}

console.log(`Validated schema and ${entries.size + 1} itinerary fixture(s).`);
