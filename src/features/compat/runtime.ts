// @ts-nocheck -- parity adapter around the pre-migration rendering contract.
import '../../style.css';
import { ITINERARY_SCHEMA_VERSION, parseItinerary, validateItinerary } from '../../lib/itinerary.js';
import { buildHashRoute, tryParseHashRoute } from '../../lib/hash-route.js';
import { buildGoogleMapsPlaceUrl } from '../../lib/google-maps.js';
import { createTripStore } from '../../lib/trip-store.js';
import { countryName, createCountryHistoryStore } from '../../lib/country-history.js';
import { createAttachmentStore } from '../../lib/attachment-store.js';
import { imageIsCached, resolveStopImage, validStopImages } from '../../lib/stop-images.js';
import { applyTheme, readStoredTheme, themes } from '../../lib/theme.js';
import { createKasumiParallax } from '../../lib/kasumi.js';

let app;
let disposeKasumi = () => {};
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const store = createTripStore();
const attachmentStore = createAttachmentStore();
const countryHistory = createCountryHistoryStore();
window.trailbookCountryHistory = countryHistory;
const SECTION_KEY = 'trailbook:primary-section';
const initialSection = (() => { try { const value = sessionStorage.getItem(SECTION_KEY); return ['trip', 'route', 'history'].includes(value) ? value : 'trip'; } catch { return 'trip'; } })();
const initialTheme = applyTheme(readStoredTheme());
const state = {
  view: 'collection', trip: null, dayId: null, error: null, notice: '',
  importError: null, installPrompt: null, online: navigator.onLine, section: initialSection, theme: initialTheme.id, attachments: new Map(),
  attachmentUsage: { bytes: 0, count: 0, limitBytes: attachmentStore.limits.totalBytes }, attachmentError: '', focusAfterRender: '',
  pendingShareId: new URL(window.location.href).searchParams.get('share-target') === 'confirm'
    ? new URL(window.location.href).searchParams.get('id') : null,
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const tripId = (trip) => firstValue(trip?.id, trip?.trip?.id);
const revision = (trip) => Number(firstValue(trip?.revision, trip?.trip?.revision, 1));
const tripTitle = (trip) => firstValue(trip?.title, trip?.trip?.title, 'Untitled trip');
const tripDays = (trip) => firstValue(trip?.days, trip?.trip?.days, []);
const tripSummary = (trip) => firstValue(trip?.summary, trip?.trip?.summary, '');
const tripDestination = (trip) => firstValue(trip?.destination, 'Saved itinerary');

function dateRange(trip) {
  if (trip?.dateRange) return trip.dateRange;
  const start = trip?.trip?.startDate;
  const end = trip?.trip?.endDate;
  return start && end ? `${start} – ${end}` : '';
}

function currentDay() {
  return state.dayId ? tripDays(state.trip).find((day) => day.id === state.dayId) ?? null : null;
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function activityTime(activity) {
  if (activity.time) return activity.time;
  const localTime = typeof activity.startsAt === 'string' ? activity.startsAt.match(/T(\d{2}:\d{2})/)?.[1] : null;
  return localTime ?? null;
}

function activityLocation(activity) {
  const location = activity.location;
  if (!location) return null;
  if (typeof location === 'string') return location;
  return { query: firstValue(location.name, location.address), ...location };
}

function placeUrl(activity) {
  try {
    if (activity.mapUrl) return safeExternalUrl(activity.mapUrl);
    const place = activityLocation(activity);
    return place ? buildGoogleMapsPlaceUrl(place) : null;
  } catch { return null; }
}

function attachmentScopeKey(scope) { return `${scope.tripId}:${scope.type}:${scope.ownerId}`; }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const attachmentIcon = (name) => ({
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Zm9.5-13.5 4 4"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>',
}[name]);

function attachmentPanel(scope, heading) {
  const key = attachmentScopeKey(scope);
  const records = state.attachments.get(key) ?? [];
  return `<section class="attachments" data-attachment-scope="${escapeHtml(key)}" aria-label="${escapeHtml(heading)}">
    <div class="attachment-heading"><div><span class="attachment-title">${escapeHtml(heading)}</span><span class="attachment-status">Local · offline</span></div>
      <div class="attachment-picker-wrap"><button class="attachment-picker" type="button" data-attachment-trigger aria-label="Upload files to ${escapeHtml(heading)}" title="Upload files">${attachmentIcon('upload')}</button><input class="sr-only" type="file" multiple data-attachment-input aria-label="Choose files for ${escapeHtml(heading)}" data-trip-id="${escapeHtml(scope.tripId)}" data-scope-type="${escapeHtml(scope.type)}" data-owner-id="${escapeHtml(scope.ownerId)}"></div>
    </div>
    <p class="attachment-privacy sr-only">Documents stay in this browser profile and never sync or upload. They may contain personal information and are protected by your device—not by app-level encryption.</p>
    ${records.length ? `<ul class="attachment-list">${records.map((item) => `<li class="attachment-item" data-attachment-id="${escapeHtml(item.id)}">
      <div class="attachment-copy"><strong class="attachment-name">${escapeHtml(item.name)}</strong><span class="attachment-label sr-only">${escapeHtml(item.label)}</span><span class="attachment-meta sr-only">${escapeHtml(item.kind === 'pdf' ? 'PDF' : item.kind === 'pass' ? 'Wallet pass' : item.type || 'File')} · ${formatBytes(item.size)} · ${escapeHtml(new Date(item.addedAt).toLocaleDateString())}</span></div>
      <div class="attachment-actions">
        <button class="attachment-action" type="button" data-attachment-open="${escapeHtml(item.id)}" aria-label="${item.kind === 'pdf' ? 'Open PDF' : item.kind === 'pass' ? 'Open pass' : 'Share or download'} ${escapeHtml(item.name)}" title="${item.kind === 'pdf' ? 'Open PDF' : item.kind === 'pass' ? 'Open pass' : 'Share or download'}">${attachmentIcon('open')}</button>
        <button class="attachment-action" type="button" data-attachment-rename="${escapeHtml(item.id)}" aria-label="Edit label for ${escapeHtml(item.name)}" title="Edit label">${attachmentIcon('edit')}</button>
        <button class="attachment-action danger" type="button" data-attachment-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}" title="Remove">${attachmentIcon('remove')}</button>
      </div>
    </li>`).join('')}</ul>` : '<p class="attachment-empty">No local documents attached in this context.</p>'}
  </section>`;
}

async function refreshAttachmentState() {
  state.attachments = new Map();
  if (!state.trip) return;
  const scopes = [{ tripId: tripId(state.trip), type: 'trip', ownerId: tripId(state.trip) }];
  for (const day of tripDays(state.trip)) {
    scopes.push({ tripId: tripId(state.trip), type: 'day', ownerId: day.id });
    for (const activity of day.activities ?? []) scopes.push({ tripId: tripId(state.trip), type: 'stop', ownerId: activity.id });
  }
  try {
    const lists = await Promise.all(scopes.map((scope) => attachmentStore.list(scope)));
    scopes.forEach((scope, index) => state.attachments.set(attachmentScopeKey(scope), lists[index]));
    state.attachmentUsage = await attachmentStore.usage();
  } catch (error) { state.attachmentError = error.message; }
}

function renderDetails(activity) {
  const links = (activity.links ?? [])
    .map((link) => ({ label: link.label || 'Open link', url: safeExternalUrl(link.url) }))
    .filter((link) => link.url);
  const rows = [];
  if (activity.description) rows.push(`<p>${escapeHtml(activity.description)}</p>`);
  if (activity.notes) rows.push(`<p><span class="detail-label">Notes</span><br>${escapeHtml(activity.notes)}</p>`);
  if (activity.reservation) rows.push(`<p><span class="detail-label">Reservation</span><br>${escapeHtml(activity.reservation)}</p>`);
  if (activity.cost !== undefined) rows.push(`<p><span class="detail-label">Cost</span><br>${escapeHtml(activity.cost)}</p>`);
  if (activity.transport) {
    const transport = activity.transport;
    const text = typeof transport === 'string' ? transport
      : [transport.mode, transport.line, transport.from && transport.to ? `${transport.from} → ${transport.to}` : '', transport.platform].filter(Boolean).join(' · ');
    if (text) rows.push(`<p><span class="detail-label">Transport</span><br>${escapeHtml(text)}</p>`);
  }
  if (links.length) rows.push(`<div class="external-links">${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join('')}</div>`);
  return rows;
}

function renderActivity(activity) {
  const time = activityTime(activity);
  const details = renderDetails(activity);
  const mapUrl = placeUrl(activity);
  const [image] = validStopImages(activity.images);
  const imageMarkup = image ? `<figure class="stop-picture" data-stop-picture data-image-url="${escapeHtml(image.url || '')}" data-image-api-url="${escapeHtml(image.apiUrl || '')}" data-image-alt="${escapeHtml(image.alt)}">
    <div class="stop-picture-frame" aria-busy="true"><span class="stop-picture-placeholder">Picture unavailable</span></div>
    <figcaption ${image.caption || image.credit || image.sourceUrl ? '' : 'hidden'}>${image.caption ? `<span data-image-caption>${escapeHtml(image.caption)}</span>` : '<span data-image-caption></span>'}${image.credit ? `<span data-image-credit>Photo: ${escapeHtml(image.credit)}</span>` : '<span data-image-credit></span>'}${image.sourceUrl ? `<a data-image-source href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noopener noreferrer">Image source</a>` : '<a data-image-source target="_blank" rel="noopener noreferrer" hidden>Image source</a>'}</figcaption>
  </figure>` : '';
  return `<article class="activity" data-activity-id="${escapeHtml(activity.id)}" data-testid="activity-item">
    <div class="activity-time">${time ? `<time${activity.startsAt ? ` datetime="${escapeHtml(activity.startsAt)}"` : ''}>${escapeHtml(time)}</time>` : '<span class="unscheduled">Any time</span>'}</div>
    <div class="activity-card">
      <p class="activity-type">${escapeHtml(firstValue(activity.type, activity.category, 'Activity'))}</p>
      <h3>${escapeHtml(activity.title)}</h3>
      ${imageMarkup}
      <div class="activity-summary">
        ${activity.duration ? `<span>${escapeHtml(activity.duration)}</span>` : ''}
        ${typeof activity.location === 'string' ? `<span>${escapeHtml(activity.location)}</span>` : activity.location?.name ? `<span>${escapeHtml(activity.location.name)}</span>` : ''}
      </div>
      ${details.length ? `<details><summary>Practical details</summary><div class="details-body">${details.join('')}</div></details>` : ''}
      ${mapUrl ? `<a class="button map-action" data-map-link href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>` : ''}
      ${attachmentPanel({ tripId: tripId(state.trip), type: 'stop', ownerId: activity.id }, 'Stop documents')}
    </div>
  </article>`;
}

function renderDayRoute(day) {
  const stops = (day?.activities ?? []).flatMap((activity) => {
    const location = activityLocation(activity);
    if (!location) return [];
    const label = typeof location === 'string' ? location : firstValue(location.name, location.address, activity.title);
    const transport = activity.transport && (typeof activity.transport === 'string' ? activity.transport
      : [activity.transport.mode, activity.transport.line].filter(Boolean).join(' · '));
    return [{ title: activity.title, label, transport }];
  });
  if (!stops.length) return '';
  return `<section id="day-route" class="day-route" aria-labelledby="day-route-title">
    <div><p class="eyebrow">On this page</p><h3 id="day-route-title" tabindex="-1">Day route</h3><p>Stops are shown in itinerary order and remain available offline.</p></div>
    <ol aria-label="Ordered day route">${stops.map((stop, index) => `<li><span class="route-marker" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(stop.title)}</strong><span>${escapeHtml(stop.label)}</span>${stop.transport ? `<small>${escapeHtml(stop.transport)}</small>` : ''}</div></li>`).join('')}</ol>
  </section>`;
}

function tripHash(trip, dayId = null) {
  return buildHashRoute({ tripId: tripId(trip), revision: revision(trip), dayId });
}

function uniqueTrips(trips) {
  const byVersion = new Map();
  for (const trip of trips) byVersion.set(`${tripId(trip)}@${revision(trip)}`, trip);
  return [...byVersion.values()].sort((a, b) => tripTitle(a).localeCompare(tripTitle(b)));
}

function tripCard(trip, { removable = true } = {}) {
  const days = tripDays(trip);
  return `<article class="trip-card" data-trip-id="${escapeHtml(tripId(trip))}">
    <div class="trip-card-copy">
      <p class="eyebrow">${escapeHtml(tripDestination(trip))}</p>
      <h2>${escapeHtml(tripTitle(trip))}</h2>
      ${tripSummary(trip) ? `<p>${escapeHtml(tripSummary(trip))}</p>` : ''}
      <div class="trip-card-meta"><span>${escapeHtml(dateRange(trip))}</span><span>${days.length} ${days.length === 1 ? 'day' : 'days'}</span><span>Revision ${revision(trip)}</span></div>
    </div>
    <div class="trip-card-actions">
      <a class="button primary" href="${escapeHtml(tripHash(trip))}">Open trip overview</a>
      ${removable ? `<button class="button subtle" type="button" data-remove-trip="${escapeHtml(tripId(trip))}" data-remove-revision="${revision(trip)}">Remove saved trip</button>` : ''}
    </div>
  </article>`;
}

function schemaExportLink(className = 'button ghost') {
  const url = new URL('data/schemas/itinerary.v1.schema.json', baseUrl).href;
  return `<a class="${className}" data-schema-export href="${escapeHtml(url)}" download="trailbook-itinerary-schema-v1.json">Export JSON schema</a>`;
}

function kasumiMarkup() {
  return `<div class="kasumi" data-kasumi-stage data-testid="kasumi-decoration" aria-hidden="true">
    <svg class="kasumi-layer kasumi-layer-far" data-kasumi-layer="far" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" focusable="false">
      <path d="M-100 86h240V62h180v32h242V68h206v28h250V64h260"/>
      <path d="M-160 182h300v-22h228v30h268v-26h282v24h420"/>
      <path d="M-80 430h260v-28h210v34h286v-26h240v30h360"/>
      <path d="M-140 612h320v-20h250v28h274v-24h298v22h340"/>
    </svg>
    <svg class="kasumi-layer kasumi-layer-near" data-kasumi-layer="near" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" focusable="false">
      <path d="M-120 270h270v-34h198v42h286v-32h210v38h252v-30h300"/>
      <path d="M20 356h240v-24h268v32h204v-26h292v22h280"/>
      <path d="M-180 520h300v-36h220v44h310v-34h230v40h300"/>
      <path d="M40 666h250v-22h278v30h216v-24h300v20h260"/>
    </svg>
  </div>`;
}

function topbar() {
  return `<header class="topbar">
    <a class="brand" href="${escapeHtml(baseUrl.href)}" aria-label="All trips"><img src="${escapeHtml(new URL('icons/travel-192.png', baseUrl).href)}" alt=""><span>Trailbook</span></a>
    <div class="topbar-actions">
      <div id="network-status" class="network ${state.online ? '' : 'offline'}">${state.online ? 'Online · synced' : 'Offline · saved copy'}</div>
      <button class="menu-toggle" id="menu-toggle" type="button" aria-expanded="false" aria-controls="app-menu" aria-label="Open app menu"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button>
    </div>
    <div class="menu-backdrop" id="menu-backdrop" aria-hidden="true" hidden></div>
    <nav class="app-menu" id="app-menu" aria-label="App menu" aria-hidden="true" hidden>
      <div class="app-menu-heading"><strong>App menu</strong><button class="drawer-close" id="drawer-close" type="button" aria-label="Close app menu">&times;</button></div>
      <label class="theme-control" for="theme-selector"><span>Theme</span><select id="theme-selector" aria-describedby="active-theme-status">${themes.map((theme) => `<option value="${theme.id}" ${theme.id === state.theme ? 'selected' : ''}>${theme.name}</option>`).join('')}</select></label>
      <label class="menu-action import-label">Import itinerary JSON<input id="trip-import" type="file" accept="application/json,.json"></label>
      ${schemaExportLink('menu-action')}
      <button class="menu-action" id="install-app" type="button" ${state.installPrompt ? '' : 'hidden'}>Install app</button>
    </nav>
    <span id="active-theme-status" class="sr-only" aria-live="polite">Active theme: ${escapeHtml(themes.find(({ id }) => id === state.theme)?.name)}</span>
  </header>`;
}

function noticeMarkup() { return state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ''; }

function bottomNavigation() {
  const items = [
    ['trip', 'Trip', '<path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9 20v-6h6v6"/>'],
    ['route', 'Map-Route', '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>'],
    ['history', 'History', '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'],
  ];
  return `<nav class="bottom-nav" aria-label="Primary">${items.map(([id, label, icon]) => `<button type="button" data-bottom-section="${id}" class="bottom-nav-item ${state.section === id ? 'active' : ''}" ${state.section === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('')}</nav>`;
}

function importErrorMarkup() {
  if (!state.importError) return '';
  return `<section class="import-error" role="status" data-testid="itinerary-error">
    <div><p class="eyebrow">Import needs attention</p><h2>JSON could not be imported</h2><p>Copy this repair request and send it to an LLM together with your original JSON.</p></div>
    <textarea id="import-error-message" readonly aria-label="Copyable itinerary repair message">${escapeHtml(state.importError.prompt)}</textarea>
    <div class="import-error-actions"><button class="button primary" id="copy-import-error" type="button">Copy error for an LLM</button>${schemaExportLink('button subtle')}</div>
  </section>`;
}

function countryHistoryMarkup() {
  const countries = countryHistory.getHistory();
  return `<section class="country-history" aria-labelledby="country-history-title">
    <header><div><p class="eyebrow">Travel history</p><h2 id="country-history-title">Visited countries</h2></div><span>${countries.length} ${countries.length === 1 ? 'country' : 'countries'}</span></header>
    <form id="add-country" class="country-form">
      <label>Country code<input name="countryCode" required maxlength="2" autocapitalize="characters" placeholder="JP" aria-describedby="country-code-help"></label>
      <label>First visited<input name="firstVisited" type="date"></label>
      <label>Last visited<input name="lastVisited" type="date"></label>
      <button class="primary" type="submit">Add country</button>
      <small id="country-code-help">Use a two-letter ISO country code.</small>
    </form>
    <div class="country-list">${countries.length ? countries.map((country) => `<form class="country-record" data-country-record="${country.countryCode}">
      <label><span>Country</span><input name="countryCode" required maxlength="2" value="${country.countryCode}" aria-label="Country code for ${escapeHtml(countryName(country.countryCode))}"></label>
      <div class="country-copy"><strong>${escapeHtml(countryName(country.countryCode))}</strong><small>${country.visits} ${country.visits === 1 ? 'visit' : 'visits'} · ${country.sources.join(' + ')}${country.firstVisited ? ` · ${country.firstVisited}${country.lastVisited !== country.firstVisited ? `–${country.lastVisited}` : ''}` : ''}</small></div>
      <button class="button subtle" type="submit">Save correction</button><button class="button danger" type="button" data-remove-country="${country.countryCode}">Remove</button>
    </form>`).join('') : '<p class="country-empty">No visited countries yet. Import an itinerary with country codes or add one here.</p>'}</div>
  </section>`;
}

function routeStopMarkup(activity, index) {
  const location = activityLocation(activity);
  if (!location) return '';
  const name = typeof location === 'string' ? location : firstValue(location.name, location.address, location.query, 'Location');
  const transport = typeof activity.transport === 'string' ? activity.transport : activity.transport?.mode;
  return `<li><span class="route-number" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(name)}</span>${transport ? `<small>${escapeHtml(transport)}</small>` : ''}</div></li>`;
}

function mapRouteMarkup() {
  if (!state.trip) return `<section class="route-view empty-card" aria-labelledby="route-title"><p class="eyebrow">Map-Route</p><h2 id="route-title">Choose a trip first</h2><p>Open a trip from the Trip tab to see its ordered route here.</p><button class="button primary" type="button" data-bottom-section="trip">Go to trips</button></section>`;
  const days = tripDays(state.trip);
  const day = currentDay();
  if (!day) return `<section class="route-view" aria-labelledby="route-title"><header><p class="eyebrow">${escapeHtml(tripTitle(state.trip))}</p><h2 id="route-title">Map-Route</h2><p>Select a day. Routes stay inside Trailbook and preserve itinerary order.</p></header><div class="route-day-list">${days.map((item, index) => {
    const count = (item.activities ?? []).filter(activityLocation).length;
    return `<a href="${escapeHtml(tripHash(state.trip, item.id))}" data-route-day><span>Day ${index + 1}</span><strong>${escapeHtml(item.title || item.date)}</strong><small>${count} ${count === 1 ? 'stop' : 'stops'}</small></a>`;
  }).join('')}</div></section>`;
  const stops = (day.activities ?? []).filter(activityLocation);
  return `<section class="route-view" aria-labelledby="route-title"><header><a class="overview-link" href="${escapeHtml(tripHash(state.trip))}">All trip days</a><p class="eyebrow">${escapeHtml(day.date)}</p><h2 id="route-title">${escapeHtml(day.title || day.date)} route</h2><p>Stops are shown in itinerary order and remain available offline.</p></header>${stops.length ? `<ol class="route-stop-list">${stops.map(routeStopMarkup).join('')}</ol>` : '<div class="empty-route"><strong>No mapped stops</strong><p>This day has no locations yet.</p></div>'}</section>`;
}

async function renderUtilitySection() {
  const history = state.section === 'history';
  app.innerHTML = `<div class="app-shell utility-shell">${kasumiMarkup()}${topbar()}<header class="utility-hero"><div class="utility-hero-content"><p class="eyebrow">${history ? 'Your travel record' : state.trip ? escapeHtml(tripTitle(state.trip)) : 'Plan visually'}</p><h1>${history ? 'History' : 'Map-Route'}</h1></div></header><main class="utility-main" data-testid="primary-content">${history ? countryHistoryMarkup() : mapRouteMarkup()}</main>${bottomNavigation()}${noticeMarkup()}</div>`;
  bindCommon();
}

async function renderCollection(savedTrips) {
  const trips = uniqueTrips(savedTrips);
  app.innerHTML = `<div class="app-shell">
    ${kasumiMarkup()}
    ${topbar()}
    <header class="collection-hero">
      <div class="collection-hero-content"><p class="eyebrow">Your pocket itineraries</p><h1>Your trips</h1><p>Open a trip overview, choose a day when you need it, or bring another itinerary onto this device.</p></div>
    </header>
    <main class="collection-main" data-testid="primary-content">
      ${shareTargetMarkup()}${importErrorMarkup()}
      <div class="collection-heading"><div><p class="eyebrow">Saved and published</p><h2>Trip collection</h2></div><span>${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}</span></div>
      ${trips.length ? `<div class="trip-grid">${trips.map((trip) => tripCard(trip)).join('')}</div>` : `<section class="empty-card"><h2>No trips on this device</h2><p>${state.online ? 'Import an itinerary to get started.' : 'Connect once to download a published trip, or import an itinerary file already on this device.'}</p></section>`}
    </main>
    ${bottomNavigation()}${noticeMarkup()}
  </div>`;
  bindCommon();
}

function dayPreview(day) {
  const activities = day.activities ?? [];
  return `<li><a class="overview-day-card" href="${escapeHtml(tripHash(state.trip, day.id))}">
    <div><time>${escapeHtml(day.date)}</time><h3>${escapeHtml(day.title || day.date)}</h3>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}</div>
    ${activities.length ? `<ol class="activity-preview" aria-label="Activities">${activities.slice(0, 3).map((activity) => `<li>${escapeHtml(activityTime(activity) || 'Any time')} · ${escapeHtml(activity.title)}</li>`).join('')}</ol>` : '<p class="day-empty">No activities planned for this day.</p>'}
    <span class="day-card-action">View day →</span>
  </a></li>`;
}

function navigation(days, day) {
  return `<aside class="sidebar" aria-label="Itinerary navigation">
    <a class="overview-link" href="${escapeHtml(baseUrl.href)}">← All trips</a>
    <a class="trip-overview-link ${day ? '' : 'active'}" href="${escapeHtml(tripHash(state.trip))}" ${day ? '' : 'aria-current="page"'}>Trip overview</a>
    <h2>Days</h2>
    <nav class="day-nav" aria-label="Itinerary days">${days.map((item, index) => `<a class="day-button ${item.id === day?.id ? 'active' : ''}" href="${escapeHtml(tripHash(state.trip, item.id))}" ${item.id === day?.id ? 'aria-current="page"' : ''}><small>Day ${index + 1} · ${escapeHtml(item.date)}</small><span>${escapeHtml(item.title || item.date)}</span></a>`).join('')}</nav>
  </aside>`;
}

async function renderTrip(savedTrips) {
  const days = tripDays(state.trip);
  const day = currentDay();
  app.innerHTML = `<div class="app-shell">
    ${kasumiMarkup()}
    ${topbar()}
    <header class="hero"><div class="hero-content">
      <p class="eyebrow">${escapeHtml(tripDestination(state.trip))}</p>
      <h1 data-testid="trip-title">${escapeHtml(tripTitle(state.trip))}</h1>
      <div class="hero-meta"><span>${escapeHtml(dateRange(state.trip))}</span><span>${days.length} ${days.length === 1 ? 'day' : 'days'}</span><span>Revision ${revision(state.trip)}</span></div>
      <div class="hero-actions"><button class="primary" id="share-trip" type="button">${day ? 'Share this day' : 'Share this trip'}</button></div>
    </div></header>
    <main class="layout" data-testid="primary-content">
      ${navigation(days, day)}
      <section class="content" aria-live="polite">
        ${importErrorMarkup()}
        ${state.attachmentError ? `<div class="import-error attachment-error" role="alert">${escapeHtml(state.attachmentError)}</div>` : ''}
        <p class="attachment-usage" aria-label="Local attachment storage usage">Local documents: ${formatBytes(state.attachmentUsage.bytes)} of ${formatBytes(state.attachmentUsage.limitBytes)} used (${state.attachmentUsage.count} files). Per-file limit: ${formatBytes(attachmentStore.limits.perFileBytes)}.</p>
        ${day ? `<article class="day-panel">
          <header class="day-heading"><a class="overview-link" href="${escapeHtml(tripHash(state.trip))}">← Trip overview</a><p class="eyebrow">${escapeHtml(day.date)}</p><h2 data-testid="selected-day-title">${escapeHtml(day.title || day.date)}</h2>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}
            ${renderDayRoute(day) ? '<div class="day-toolbar"><button class="button subtle" data-view-day-route type="button">View day route ↓</button></div>' : ''}
          </header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'day', ownerId: day.id }, 'Day documents')}
          ${(day.activities ?? []).length ? `<div class="timeline">${day.activities.map(renderActivity).join('')}</div>` : '<div class="empty-day" data-testid="empty-day"><strong>No fixed plans yet</strong>This day is open. Add an activity in the itinerary file when you are ready.</div>'}
          ${renderDayRoute(day)}
        </article>` : `<article class="trip-overview" data-testid="trip-overview">
          <header><p class="eyebrow">At a glance</p><h2>Trip overview</h2>${tripSummary(state.trip) ? `<p>${escapeHtml(tripSummary(state.trip))}</p>` : '<p>Choose a day to see its complete itinerary.</p>'}</header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'trip', ownerId: tripId(state.trip) }, 'Trip documents')}
          <button class="button danger clear-trip-attachments" type="button" data-clear-trip-attachments>Clear all local documents for this trip</button>
          ${days.length ? `<ol class="overview-day-list">${days.map(dayPreview).join('')}</ol>` : '<section class="empty-card" data-testid="empty-itinerary"><h3>No itinerary days available</h3><p>This trip does not contain any day plans.</p></section>'}
        </article>`}
      </section>
    </main>
    ${bottomNavigation()}${noticeMarkup()}
  </div>`;
  bindCommon();
  hydrateStopPictures();
}

async function render() {
  const savedTrips = await store.listTrips();
  if (state.trip) await refreshAttachmentState();
  if (state.error) {
    app.innerHTML = `<div class="app-shell">${kasumiMarkup()}${topbar()}<main class="single-column"><section class="error-card"><p class="eyebrow">Unable to open trip</p><h1>${escapeHtml(state.error.title)}</h1><p>${escapeHtml(state.error.message)}</p><a class="button primary" href="${escapeHtml(baseUrl.href)}">Back to all trips</a>${savedTrips.length ? `<div class="error-library"><h2>Trips on this device</h2>${savedTrips.map((trip) => tripCard(trip)).join('')}</div>` : ''}</section></main>${noticeMarkup()}</div>`;
    bindCommon();
    return;
  }
  if (state.section !== 'trip') await renderUtilitySection();
  else if (state.view === 'collection') await renderCollection(savedTrips);
  else await renderTrip(savedTrips);
  if (state.focusAfterRender) {
    const target = document.querySelector(`[data-attachment-scope="${CSS.escape(state.focusAfterRender)}"] [data-attachment-trigger]`);
    state.focusAfterRender = ''; target?.closest('label')?.focus();
  }
}

function showNotice(message) {
  state.notice = message;
  render();
  window.setTimeout(() => { if (state.notice === message) { state.notice = ''; render(); } }, 3200);
}

function repairPrompt(error, fileName) {
  const issues = error?.errors?.length ? error.errors : [{ path: '$', code: error?.code || 'invalid_json', message: error?.message || 'The file is invalid.', hint: 'Correct the JSON and try again.' }];
  const details = issues.map(({ path, code, message, hint }) => `- ${path || '$'} [${code || 'invalid'}]: ${message}${hint ? ` Repair: ${hint}` : ''}`).join('\n');
  return `Fix my Trailbook itinerary JSON so it matches the currently supported schema.\n\nReturn only the complete corrected JSON. Do not wrap it in Markdown and do not omit unchanged content. Preserve IDs, ordering, and user-provided details unless a validation error requires a change. Do not invent bookings, prices, or personal data.\n\nSupported schema version: ${ITINERARY_SCHEMA_VERSION}\nFile: ${fileName || 'itinerary.json'}\n\nValidation errors:\n${details}\n\nI will provide the original JSON with this message.`;
}

async function importFile(file) {
  try {
    const candidate = parseItinerary(await file.text());
    await store.saveTrip(candidate);
    countryHistory.importItinerary(candidate);
    state.importError = null;
    state.notice = 'Trip imported and saved on this device.';
    state.section = 'trip';
    try { sessionStorage.setItem(SECTION_KEY, state.section); } catch { /* Continue without persistence. */ }
    window.location.hash = tripHash(candidate);
    if (window.location.hash === tripHash(candidate)) await loadRoute();
  } catch (error) {
    state.importError = { prompt: repairPrompt(error, file.name) };
    state.notice = '';
    await render();
  }
}

async function shareCurrent() {
  const hash = tripHash(state.trip, state.dayId);
  const url = new URL(hash, window.location.href.split('#')[0]).href;
  const data = { title: tripTitle(state.trip), text: `Open ${tripTitle(state.trip)} in Trailbook`, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(url);
    showNotice('Link copied to clipboard.');
  } catch (error) {
    if (error?.name !== 'AbortError') showNotice('Could not share automatically. Copy the address from your browser.');
  }
}

function downloadAttachment(record, message = '') {
  const blob = new Blob([record.blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = record.name; anchor.rel = 'noopener';
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  if (message) showNotice(message);
}

async function verifiedPdf(record) {
  const signature = new TextDecoder('ascii').decode((await record.blob.slice(0, 5).arrayBuffer()));
  return signature === '%PDF-';
}

async function openAttachment(id) {
  try {
    const record = await attachmentStore.get(id);
    if (!record) throw new Error('This attachment no longer exists.');
    if (record.kind === 'pdf') {
      if (!await verifiedPdf(record)) {
        downloadAttachment(record, 'This file does not contain a valid PDF signature, so it was downloaded without inline preview.');
        return;
      }
      const url = URL.createObjectURL(new Blob([record.blob], { type: 'application/pdf' }));
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!opened) downloadAttachment(record, 'The PDF viewer was unavailable, so the file was downloaded instead.');
      return;
    }
    const shareFile = new File([record.blob], record.name, { type: record.kind === 'pass' ? 'application/vnd.apple.pkpass' : 'application/octet-stream' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [shareFile] }))) {
      try { await navigator.share({ title: record.label, files: [shareFile] }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    downloadAttachment(record, record.kind === 'pass'
      ? 'No wallet handler is available. The pass was downloaded so you can open it from your device.'
      : 'Sharing is unavailable here. The attachment was downloaded instead.');
  } catch (error) { state.attachmentError = error.message; await render(); }
}

async function addAttachments(input) {
  const scope = { tripId: input.dataset.tripId, type: input.dataset.scopeType, ownerId: input.dataset.ownerId };
  state.focusAfterRender = attachmentScopeKey(scope);
  try {
    for (const file of input.files) await attachmentStore.add(scope, file);
    state.notice = `${input.files.length} local ${input.files.length === 1 ? 'document' : 'documents'} added.`;
    state.attachmentError = '';
  } catch (error) { state.attachmentError = error.message; }
  input.value = '';
  await render();
}

function bindCommon() {
  disposeKasumi();
  disposeKasumi = createKasumiParallax({ root: document, viewport: window, navigatorObject: navigator });
  document.querySelectorAll('[data-bottom-section]').forEach((button) => button.addEventListener('click', async () => {
    state.section = button.dataset.bottomSection;
    window.dispatchEvent(new CustomEvent('trailbook:feature-open', { detail: state.section }));
    try { sessionStorage.setItem(SECTION_KEY, state.section); } catch { /* Navigation still works without persistence. */ }
    await render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.querySelector('#add-country')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      countryHistory.addManual({ countryCode: data.get('countryCode'), firstVisited: data.get('firstVisited'), lastVisited: data.get('lastVisited') });
      state.notice = 'Country added to your travel history.'; await render();
    } catch (error) { showNotice(error.message); }
  });
  document.querySelectorAll('[data-country-record]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(form);
    try { countryHistory.correct(form.dataset.countryRecord, { countryCode: data.get('countryCode'), visits: 1 }); state.notice = 'Country correction saved.'; await render(); }
    catch (error) { showNotice(error.message); }
  }));
  document.querySelectorAll('[data-remove-country]').forEach((button) => button.addEventListener('click', async () => {
    countryHistory.remove(button.dataset.removeCountry); state.notice = 'Country removed from your travel history.'; await render();
  }));
  const menu = document.querySelector('#app-menu');
  const menuToggle = document.querySelector('#menu-toggle');
  const backdrop = document.querySelector('#menu-backdrop');
  let closeTimer;
  let menuPageScroll = { left: 0, top: 0 };
  const restoreMenuPageScroll = () => window.scrollTo({
    left: menuPageScroll.left,
    top: menuPageScroll.top,
    behavior: 'instant',
  });
  const closeMenu = ({ restoreFocus = false } = {}) => {
    if (!menu || !menuToggle || menu.hidden) return;
    window.clearTimeout(closeTimer);
    menu.classList.remove('open');
    backdrop?.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open app menu');
    if (restoreFocus) menuToggle.focus({ preventScroll: true });
    restoreMenuPageScroll();
    closeTimer = window.setTimeout(() => {
      if (!menu.classList.contains('open')) {
        menu.hidden = true;
        if (backdrop) backdrop.hidden = true;
      }
    }, 240);
  };
  menuToggle?.addEventListener('click', () => {
    const opening = menu.hidden;
    if (!opening) { closeMenu({ restoreFocus: true }); return; }
    menuPageScroll = { left: window.scrollX, top: window.scrollY };
    window.clearTimeout(closeTimer);
    menu.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add('menu-open');
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close app menu');
    restoreMenuPageScroll();
    requestAnimationFrame(() => {
      menu.classList.add('open');
      backdrop?.classList.add('open');
      menu.setAttribute('aria-hidden', 'false');
      menu.querySelector('select, a, button, label')?.focus({ preventScroll: true });
      restoreMenuPageScroll();
    });
  });
  document.onkeydown = (event) => {
    if (event.key === 'Escape') closeMenu({ restoreFocus: true });
    if (event.key === 'Tab' && menu && !menu.hidden) {
      const focusable = [...menu.querySelectorAll('select, a[href], button:not([hidden]), input:not([type="file"])')].filter((node) => !node.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  backdrop?.addEventListener('click', () => closeMenu({ restoreFocus: true }));
  document.querySelector('#drawer-close')?.addEventListener('click', () => closeMenu({ restoreFocus: true }));
  document.querySelector('#theme-selector')?.addEventListener('change', (event) => {
    const active = applyTheme(event.currentTarget.value);
    state.theme = active.id;
    const status = document.querySelector('#active-theme-status');
    if (status) status.textContent = `Active theme: ${active.name}`;
    closeMenu({ restoreFocus: true });
  });
  document.querySelectorAll('#trip-import').forEach((input) => input.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) { closeMenu(); importFile(file); }
  }));
  document.querySelector('[data-schema-export]')?.addEventListener('click', () => closeMenu());
  document.querySelectorAll('[data-remove-trip]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm(`Remove ${button.closest('.trip-card')?.querySelector('h2')?.textContent || 'this trip'} from this device?`)) return;
    try { await attachmentStore.removeTrip(button.dataset.removeTrip); }
    catch (error) { state.attachmentError = error.message; await render(); return; }
    await store.deleteTrip(button.dataset.removeTrip, Number(button.dataset.removeRevision));
    if (tripId(state.trip) === button.dataset.removeTrip) { state.trip = null; state.dayId = null; state.view = 'collection'; window.location.hash = ''; }
    showNotice('Trip removed.');
  }));
  document.querySelectorAll('[data-map-link]').forEach((link) => link.addEventListener('click', (event) => {
    if (!state.online) { event.preventDefault(); showNotice('Maps needs a connection. Your itinerary is still available offline.'); }
  }));
  document.querySelector('#share-trip')?.addEventListener('click', shareCurrent);
  document.querySelectorAll('[data-attachment-input]').forEach((input) => input.addEventListener('change', () => addAttachments(input)));
  document.querySelectorAll('[data-attachment-trigger]').forEach((button) => button.addEventListener('click', () => button.parentElement.querySelector('[data-attachment-input]').click()));
  document.querySelectorAll('[data-attachment-open]').forEach((button) => button.addEventListener('click', () => openAttachment(button.dataset.attachmentOpen)));
  document.querySelectorAll('[data-attachment-rename]').forEach((button) => button.addEventListener('click', async () => {
    const item = button.closest('[data-attachment-id]');
    const current = item?.querySelector('.attachment-label')?.textContent || '';
    const label = window.prompt('Display label for this local attachment', current);
    if (label === null) return;
    try { await attachmentStore.rename(button.dataset.attachmentRename, label); state.focusAfterRender = item.closest('[data-attachment-scope]').dataset.attachmentScope; await render(); }
    catch (error) { state.attachmentError = error.message; await render(); }
  }));
  document.querySelectorAll('[data-attachment-remove]').forEach((button) => button.addEventListener('click', async () => {
    const item = button.closest('[data-attachment-id]');
    const label = item?.querySelector('.attachment-label')?.textContent || 'this local attachment';
    if (!window.confirm(`Remove ${label}? The local file will be deleted from this browser.`)) return;
    try {
      state.focusAfterRender = item.closest('[data-attachment-scope]').dataset.attachmentScope;
      await attachmentStore.remove(button.dataset.attachmentRemove); state.notice = 'Local attachment removed.'; await render();
    } catch (error) { state.attachmentError = error.message; await render(); }
  }));
  document.querySelector('[data-clear-trip-attachments]')?.addEventListener('click', async () => {
    if (!window.confirm('Clear every local document for this trip? This cannot be undone.')) return;
    try { await attachmentStore.removeTrip(tripId(state.trip)); state.notice = 'All local documents for this trip were removed.'; await render(); }
    catch (error) { state.attachmentError = error.message; await render(); }
  });
  document.querySelector('#copy-import-error')?.addEventListener('click', async () => {
    const message = state.importError?.prompt;
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      showNotice('Repair message copied.');
    } catch {
      const textarea = document.querySelector('#import-error-message');
      textarea?.focus(); textarea?.select();
      const copied = document.execCommand?.('copy');
      if (copied) showNotice('Repair message copied.');
      else {
        const button = document.querySelector('#copy-import-error');
        if (button) button.textContent = 'Selected — copy manually';
      }
    }
  });
  document.querySelector('#install-app')?.addEventListener('click', async () => {
    closeMenu(); await state.installPrompt?.prompt(); state.installPrompt = null; render();
  });
  document.querySelector('#cancel-shared-file')?.addEventListener('click', () => {
    state.pendingShareId = null;
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    render();
  });
  document.querySelector('#confirm-shared-file')?.addEventListener('click', () => {
    const database = indexedDB.open('trailbook-share-target', 1);
    database.onsuccess = () => {
      const transaction = database.result.transaction('pending', 'readwrite');
      const record = transaction.objectStore('pending').get(state.pendingShareId);
      record.onsuccess = async () => {
        if (record.result?.file) await importFile(record.result.file);
        transaction.objectStore('pending').delete(state.pendingShareId);
        state.pendingShareId = null;
      };
    };
  });
}

async function hydrateStopPictures() {
  const saveData = navigator.connection?.saveData === true;
  await Promise.all([...document.querySelectorAll('[data-stop-picture]')].map(async (figure) => {
    let descriptor = {
      url: figure.dataset.imageUrl || null,
      apiUrl: figure.dataset.imageApiUrl || null,
      alt: figure.dataset.imageAlt || '',
    };
    descriptor = await resolveStopImage(descriptor, { online: state.online });
    const url = descriptor?.url;
    const cached = await imageIsCached(url);
    if (!descriptor || (!state.online && !cached) || (saveData && !cached)) {
      figure.querySelector('.stop-picture-frame')?.setAttribute('aria-busy', 'false');
      return;
    }
    const caption = figure.querySelector('[data-image-caption]');
    const credit = figure.querySelector('[data-image-credit]');
    const source = figure.querySelector('[data-image-source]');
    if (descriptor.caption && caption && !caption.textContent) caption.textContent = descriptor.caption;
    if (descriptor.credit && credit && !credit.textContent) credit.textContent = `Photo: ${descriptor.credit}`;
    if (descriptor.sourceUrl && source && !source.getAttribute('href')) { source.href = descriptor.sourceUrl; source.hidden = false; }
    const figcaption = figure.querySelector('figcaption');
    if (figcaption && (caption?.textContent || credit?.textContent || !source?.hidden)) figcaption.hidden = false;
    const frame = figure.querySelector('.stop-picture-frame');
    if (!frame || !figure.isConnected) return;
    const load = () => {
      if (frame.querySelector('img')) return;
      const image = document.createElement('img');
      image.src = url;
      image.alt = figure.dataset.imageAlt ?? '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer';
      image.width = 640;
      image.height = 360;
      image.addEventListener('load', () => { frame.classList.add('loaded'); frame.setAttribute('aria-busy', 'false'); });
      image.addEventListener('error', () => {
        image.remove();
        frame.setAttribute('aria-busy', 'false');
        navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE_IMAGE', url });
      });
      frame.append(image);
    };
    if (!('IntersectionObserver' in window)) { load(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '300px 0px' });
    observer.observe(figure);
  }));
  document.querySelector('[data-view-day-route]')?.addEventListener('click', () => {
    document.querySelector('#day-route')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    document.querySelector('#day-route-title')?.focus({ preventScroll: true });
  });
}

async function loadPublished(target) {
  const assetUrl = new URL(`data/itineraries/${target.id}/v${target.revision}.json`, baseUrl);
  const schemaUrl = new URL('data/schemas/itinerary.v1.schema.json', baseUrl);
  const [schemaResponse, response] = await Promise.all([fetch(schemaUrl), fetch(assetUrl)]);
  if (!schemaResponse.ok) throw new Error(`The itinerary schema could not be loaded (${schemaResponse.status}).`);
  if (!response.ok) throw new Error(response.status === 404 ? 'This itinerary revision has not been published.' : `The itinerary could not be loaded (${response.status}).`);
  const candidate = validateItinerary(await response.json());
  if (tripId(candidate) !== target.id || revision(candidate) !== target.revision) throw new Error('The published itinerary does not match the requested immutable revision.');
  await store.saveTrip(candidate);
  countryHistory.importItinerary(candidate);
  return candidate;
}

async function seedCollection() {
  // Remove the bundled pre-Sprint demo if an earlier build persisted it.
  await store.deleteTrip('sample-autumn-weekend');
  let catalog = [];
  try {
    const response = await fetch(new URL('data/itineraries/index.json', baseUrl));
    if (response.ok) catalog = (await response.json()).itineraries ?? [];
  } catch { /* Stored trips still render when the catalog is unavailable. */ }
  await Promise.all(catalog.map(async (target) => {
    try { await loadPublished(target); } catch { /* Existing local copies remain available offline. */ }
  }));
}

async function loadRoute() {
  const hash = window.location.hash === '#/' ? '' : window.location.hash;
  const { route, error } = tryParseHashRoute(hash);
  if (error) {
    state.view = 'trip'; state.trip = null; state.dayId = null;
    state.error = { title: 'This link is not safe to open', message: error.message };
    await render(); return;
  }
  if (!route) {
    state.view = 'collection'; state.trip = null; state.dayId = null; state.error = null;
    await seedCollection(); await render(); return;
  }

  let candidate = state.trip
    && tripId(state.trip) === route.tripId
    && revision(state.trip) === route.revision
    ? state.trip
    : null;
  let networkError = null;
  if (!candidate) {
    try { candidate = await loadPublished({ id: route.tripId, revision: route.revision }); }
    catch (error_) { networkError = error_; candidate = await store.getTrip(route.tripId, route.revision); }
  }
  if (!candidate) {
    state.view = 'trip'; state.trip = null; state.dayId = null;
    state.error = {
      title: state.online ? 'Itinerary unavailable' : 'Connect once to download this trip',
      message: state.online ? networkError?.message || 'Check the link and try again.' : 'This itinerary is not saved on this device yet. Reopen this link after one successful online visit.',
    };
    await render(); return;
  }
  const days = tripDays(candidate);
  if (route.dayId && !days.some((day) => day.id === route.dayId)) {
    state.view = 'trip'; state.trip = null; state.dayId = null;
    state.error = { title: 'Day not found', message: 'The trip loaded, but this day does not exist in the requested revision.' };
    await render(); return;
  }
  state.view = 'trip'; state.trip = candidate; state.dayId = route.dayId; state.error = null;
  await render();
}

export function initializeLegacyApp(root) {
  app = root;
  const onHashChange = () => loadRoute();
  const onOnline = () => { state.online = true; loadRoute(); };
  const onOffline = () => { state.online = false; render(); };
  const onInstallPrompt = (event) => { event.preventDefault(); state.installPrompt = event; render(); };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('beforeinstallprompt', onInstallPrompt);
  loadRoute();
  return () => {
    disposeKasumi();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('beforeinstallprompt', onInstallPrompt);
  };
}

function shareTargetMarkup() {
  if (!state.pendingShareId) return '';
  return `<section class="notice-card" role="status" aria-label="Shared itinerary confirmation"><h2>Shared itinerary ready to review</h2><p>Nothing has been imported yet. Confirm to validate and save the shared file, or cancel without changing your trips.</p><button class="button primary" id="confirm-shared-file" type="button">Review and import shared file</button><button class="button subtle" id="cancel-shared-file" type="button">Cancel shared import</button></section>`;
}
