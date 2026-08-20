const STORAGE_KEY = 'trailbook:country-history:v1';
const ISO_CODES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeCode = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';

export function validateCountryCode(value) {
  const code = normalizeCode(value);
  if (!ISO_CODES.has(code)) throw new RangeError(`“${value || ''}” is not a supported ISO 3166-1 alpha-2 country code.`);
  return code;
}

export function countryName(code, locale = globalThis.navigator?.language ?? 'en') {
  const normalized = validateCountryCode(code);
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(normalized) ?? normalized; }
  catch { return normalized; }
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function itineraryId(itinerary) {
  const id = itinerary?.trip?.id ?? itinerary?.id;
  const revision = itinerary?.trip?.revision ?? itinerary?.revision ?? 1;
  if (!id) throw new TypeError('An itinerary needs an id before its visits can be imported.');
  return `${id}@${revision}`;
}

function visitDate(day, activity) {
  const candidate = activity?.startsAt?.slice(0, 10) ?? day?.date;
  return validDate(candidate) ? candidate : null;
}

function countryCandidate(trip, day, activity) {
  const location = activity?.location;
  return location && typeof location === 'object' && location.countryCode
    ? location.countryCode : activity?.countryCode ?? day?.countryCode ?? trip?.countryCode;
}

export function deriveVisitedCountries(itinerary) {
  const trip = itinerary?.trip ?? itinerary;
  const periods = new Map();
  for (const day of trip?.days ?? []) {
    const activities = (day.items ?? day.activities)?.length ? (day.items ?? day.activities).filter((item) => item.type !== 'transit') : [null];
    for (const activity of activities) {
      const candidate = countryCandidate(trip, day, activity);
      if (!candidate) continue;
      let code;
      try { code = validateCountryCode(candidate); } catch { continue; }
      const date = visitDate(day, activity);
      const key = `${code}:${date ?? 'unknown'}`;
      periods.set(key, { countryCode: code, date });
    }
  }
  return [...periods.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || (a.date ?? '').localeCompare(b.date ?? ''));
}

function emptyState() { return { version: 1, itineraries: {}, manual: {}, suppressed: [] }; }

function read(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? 'null');
    return value?.version === 1 && value.itineraries && value.manual && Array.isArray(value.suppressed) ? value : emptyState();
  } catch { return emptyState(); }
}

function records(state) {
  const grouped = new Map();
  for (const periods of Object.values(state.itineraries)) for (const period of periods) {
    if (state.suppressed.includes(period.countryCode)) continue;
    const item = grouped.get(period.countryCode) ?? { countryCode: period.countryCode, dates: new Set(), sources: new Set() };
    if (period.date) item.dates.add(period.date);
    item.sources.add('itinerary'); grouped.set(period.countryCode, item);
  }
  for (const manual of Object.values(state.manual)) {
    const item = grouped.get(manual.countryCode) ?? { countryCode: manual.countryCode, dates: new Set(), sources: new Set() };
    for (const date of [manual.firstVisited, manual.lastVisited]) if (date) item.dates.add(date);
    item.sources.add('manual'); grouped.set(manual.countryCode, item);
  }
  return [...grouped.values()].map((item) => {
    const dates = [...item.dates].sort();
    const itineraryVisits = new Set(Object.values(state.itineraries).flat().filter((visit) => visit.countryCode === item.countryCode && visit.date).map((visit) => visit.date));
    const manual = state.manual[item.countryCode];
    return {
      countryCode: item.countryCode,
      visits: Math.max(itineraryVisits.size, manual?.visits ?? 0, 1),
      firstVisited: dates[0] ?? null,
      lastVisited: dates.at(-1) ?? null,
      sources: [...item.sources].sort(),
    };
  }).sort((a, b) => a.countryCode.localeCompare(b.countryCode));
}

/** Stable local application interface consumed by the history UI, globe and statistics. */
export function createCountryHistoryStore({ storage = globalThis.localStorage, key = STORAGE_KEY } = {}) {
  let state = read(storage, key);
  const persist = () => storage?.setItem(key, JSON.stringify(state));
  return {
    getHistory() { return clone(records(state)); },
    importItinerary(itinerary) {
      state.itineraries[itineraryId(itinerary)] = deriveVisitedCountries(itinerary);
      persist(); return this.getHistory();
    },
    addManual({ countryCode, visits = 1, firstVisited = null, lastVisited = null }) {
      const code = validateCountryCode(countryCode);
      if (!Number.isSafeInteger(Number(visits)) || Number(visits) < 1) throw new RangeError('Visit count must be a positive whole number.');
      for (const date of [firstVisited, lastVisited]) if (date && !validDate(date)) throw new RangeError('Visit dates must be valid ISO dates.');
      if (firstVisited && lastVisited && firstVisited > lastVisited) throw new RangeError('First visited cannot be after last visited.');
      state.manual[code] = { countryCode: code, visits: Number(visits), firstVisited: firstVisited || null, lastVisited: lastVisited || null };
      state.suppressed = state.suppressed.filter((item) => item !== code);
      persist(); return this.getHistory();
    },
    correct(code, correction) {
      const previous = validateCountryCode(code); const next = validateCountryCode(correction.countryCode);
      delete state.manual[previous];
      if (previous !== next && !state.suppressed.includes(previous)) state.suppressed.push(previous);
      return this.addManual({ ...correction, countryCode: next });
    },
    remove(code) {
      const normalized = validateCountryCode(code); delete state.manual[normalized];
      if (!state.suppressed.includes(normalized)) state.suppressed.push(normalized);
      persist(); return this.getHistory();
    },
  };
}
