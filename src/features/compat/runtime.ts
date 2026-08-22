// @ts-nocheck -- parity adapter around the pre-migration rendering contract.
import '../../style.css';
import { ITINERARY_SCHEMA_VERSION, parseItinerary, validateItinerary } from '../../lib/itinerary.js';
import { buildHashRoute, tryParseHashRoute } from '../../lib/hash-route.js';
import { buildGoogleMapsPlaceUrl, buildGoogleMapsRouteUrl } from '../../lib/google-maps.js';
import { createTripStore } from '../../lib/trip-store.js';
import { countryName, createCountryHistoryStore } from '../../lib/country-history.js';
import { createAttachmentStore } from '../../lib/attachment-store.js';
import { imageIsCached, resolveStopImage, validStopImages } from '../../lib/stop-images.js';
import { applyTheme, readStoredTheme, themes } from '../../lib/theme.js';
import { createTrailbookExport, shareOrDownloadTrailbook } from '../../lib/trailbook-export.js';
import { claimPendingImport, deletePendingImport, purgeExpiredImports, putPendingImport } from '../../lib/pending-import.js';
import { duplicateItinerary, validateImportTransport, validateTrailbookImport } from '../../lib/trailbook-import.js';
import { createKasumiParallax } from '../../lib/kasumi.js';

let app;
let disposeKasumi = () => {};
let timelineResizeObserver;
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const store = createTripStore();
const attachmentStore = createAttachmentStore();
const countryHistory = createCountryHistoryStore();
window.trailbookCountryHistory = countryHistory;
const SECTION_KEY = 'trailbook:primary-section';
const initialSection = (() => { try { const value = sessionStorage.getItem(SECTION_KEY); return ['trip', 'day-overview', 'route', 'history'].includes(value) ? (value === 'route' ? 'day-overview' : value) : 'trip'; } catch { return 'trip'; } })();
const initialTheme = applyTheme(readStoredTheme());
const shareParameters = new URL(window.location.href).searchParams;
const shareClaimant = (() => {
  try {
    const key = 'trailbook:share-import-claimant';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = crypto.randomUUID();
    sessionStorage.setItem(key, value);
    return value;
  } catch { return crypto.randomUUID(); }
})();
const androidOpenQueue: TrailbookAndroidOpen[] = [];
let androidOpenActive = false;
let androidOpenReady = false;
const state = {
  view: 'collection', trip: null, dayId: null, error: null, notice: '',
  importError: null, installPrompt: null, online: navigator.onLine, section: shareParameters.has('share-target') ? 'trip' : initialSection, theme: initialTheme.id, attachments: new Map(),
  attachmentUsage: { bytes: 0, count: 0, limitBytes: attachmentStore.limits.totalBytes }, attachmentError: '', focusAfterRender: '',
  pendingShareId: shareParameters.get('share-target') === 'confirm' ? shareParameters.get('id') : null,
  shareImport: shareParameters.get('share-target') === 'error'
    ? { status: 'error', error: shareParameters.get('reason') || 'unreadable_file' }
    : null,
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const tripId = (trip) => firstValue(trip?.id, trip?.trip?.id);
const revision = (trip) => Number(firstValue(trip?.revision, trip?.trip?.revision, 1));
const tripTitle = (trip) => firstValue(trip?.title, trip?.trip?.title, 'Untitled trip');
const tripDays = (trip) => firstValue(trip?.days, trip?.trip?.days, []);
// Published v1.1 keeps stop and transit entries in one deliberate timeline; old
// bundled flat fixtures remain readable while users' v1.0 files are migrated.
const dayItems = (day) => firstValue(day?.items, day?.activities, []);
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

function attachmentPanel(scope, heading, { accept = '' } = {}) {
  const key = attachmentScopeKey(scope);
  const records = state.attachments.get(key) ?? [];
  return `<section class="attachments" data-attachment-scope="${escapeHtml(key)}" aria-label="${escapeHtml(heading)}">
    <div class="attachment-heading"><div><span class="attachment-title">${escapeHtml(heading)}</span><span class="attachment-status">Local · offline</span></div>
      <div class="attachment-picker-wrap"><button class="attachment-picker" type="button" data-attachment-trigger aria-label="Upload files to ${escapeHtml(heading)}" title="Upload files">${attachmentIcon('upload')}</button><input class="sr-only" type="file" multiple accept="${escapeHtml(accept)}" data-attachment-input aria-label="Choose files for ${escapeHtml(heading)}" data-trip-id="${escapeHtml(scope.tripId)}" data-scope-type="${escapeHtml(scope.type)}" data-owner-id="${escapeHtml(scope.ownerId)}"></div>
    </div>
    <p class="attachment-privacy sr-only">Documents stay in this browser profile. They are not uploaded or app-encrypted.</p>
    ${records.length ? `<ul class="attachment-list">${records.map((item) => `<li class="attachment-item" data-attachment-id="${escapeHtml(item.id)}">
      <div class="attachment-copy"><strong class="attachment-name">${escapeHtml(item.name)}</strong><span class="attachment-label sr-only">${escapeHtml(item.label)}</span><span class="attachment-meta sr-only">${escapeHtml(item.kind === 'pdf' ? 'PDF' : item.kind === 'pass' ? 'Wallet pass' : item.type || 'File')} · ${formatBytes(item.size)} · ${escapeHtml(new Date(item.addedAt).toLocaleDateString())}</span></div>
      <div class="attachment-actions">
        <button class="attachment-action" type="button" data-attachment-open="${escapeHtml(item.id)}" aria-label="${item.kind === 'pdf' ? 'Open PDF' : item.kind === 'pass' ? 'Open pass' : 'Share or download'} ${escapeHtml(item.name)}" title="${item.kind === 'pdf' ? 'Open PDF' : item.kind === 'pass' ? 'Open pass' : 'Share or download'}">${attachmentIcon('open')}</button>
        <button class="attachment-action" type="button" data-attachment-rename="${escapeHtml(item.id)}" aria-label="Edit label for ${escapeHtml(item.name)}" title="Edit label">${attachmentIcon('edit')}</button>
        <button class="attachment-action danger" type="button" data-attachment-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}" title="Remove">${attachmentIcon('remove')}</button>
      </div>
    </li>`).join('')}</ul>` : '<p class="attachment-empty">No documents</p>'}
  </section>`;
}

async function refreshAttachmentState() {
  state.attachments = new Map();
  if (!state.trip) return;
  const scopes = [{ tripId: tripId(state.trip), type: 'trip', ownerId: tripId(state.trip) }];
  for (const day of tripDays(state.trip)) {
    scopes.push({ tripId: tripId(state.trip), type: 'day', ownerId: day.id });
    for (const activity of dayItems(day)) scopes.push({ tripId: tripId(state.trip), type: activity.type === 'transit' ? 'transit' : 'stop', ownerId: activity.id });
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
    <span class="timeline-node" aria-hidden="true"></span>
    <div class="activity-time">${time ? `<time${activity.startsAt ? ` datetime="${escapeHtml(activity.startsAt)}"` : ''}>${escapeHtml(time)}</time>` : '<span class="unscheduled">Any time</span>'}</div>
    <div class="activity-card">
      <p class="activity-type">${escapeHtml(firstValue(activity.type, activity.category, 'Activity'))}</p>
      <h3>${escapeHtml(activity.title)}</h3>
      ${imageMarkup}
      <div class="activity-summary">
        ${activity.duration ? `<span>${escapeHtml(activity.duration)}</span>` : ''}
        ${typeof activity.location === 'string' ? `<span>${escapeHtml(activity.location)}</span>` : activity.location?.name ? `<span>${escapeHtml(activity.location.name)}</span>` : ''}
      </div>
      ${details.length ? `<details><summary aria-label="Practical details">Details</summary><div class="details-body">${details.join('')}</div></details>` : ''}
      ${mapUrl ? `<a class="button map-action" data-map-link href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps">Map ↗</a>` : ''}
      ${attachmentPanel({ tripId: tripId(state.trip), type: 'stop', ownerId: activity.id }, 'Stop documents')}
    </div>
  </article>`;
}

function transitTime(transit) {
  return activityTime({ startsAt: transit.departure, time: transit.time });
}

function transitDetails(transit) {
  const rows = [];
  const details = [
    ['Operator', transit.operator], ['Service', transit.service], ['Platform', transit.platform], ['Terminal', transit.terminal],
    ['Reservation', transit.reservation], ['Notes', transit.notes],
  ].filter(([, value]) => value);
  if (details.length) rows.push(`<dl class="transit-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`);
  if (transit.segments?.length) rows.push(`<ol class="transit-segments" aria-label="Transit segments">${transit.segments.map((segment) => `<li><div class="transit-segment-copy"><strong>${escapeHtml(segment.mode)}</strong><span>${escapeHtml(segment.from.name)} → ${escapeHtml(segment.to.name)}</span><small>${escapeHtml([segment.departure && activityTime({ startsAt: segment.departure }), segment.arrival && activityTime({ startsAt: segment.arrival }), segment.operator, segment.service, segment.platform, segment.terminal].filter(Boolean).join(' · '))}</small>${segment.notes ? `<p>${escapeHtml(segment.notes)}</p>` : ''}</div>${segmentMapActions(segment)}</li>`).join('')}</ol>`);
  return rows;
}

function googleMapsMode(mode) {
  if (mode === 'walk') return 'walking';
  if (mode === 'bicycle') return 'bicycling';
  if (mode === 'car' || mode === 'taxi') return 'driving';
  return ['bus', 'tram', 'metro', 'subway', 'train', 'ferry'].includes(mode) ? 'transit' : undefined;
}

function endpointMapUrl(endpoint) {
  try { return buildGoogleMapsPlaceUrl(endpoint); } catch { return null; }
}

function directionsUrl(from, to, mode) {
  try { return buildGoogleMapsRouteUrl([from, to], { travelMode: googleMapsMode(mode) }); } catch { return null; }
}

function mapIcon(kind) {
  return kind === 'pin'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.2"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h7l2 3h7M20 18h-7l-2-3H4"/><path d="m8 3-4 3 4 3M16 15l4 3-4 3"/></svg>';
}

function iconMapLink(url, label, icon) {
  return url ? `<a class="icon-map-action" data-map-link href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${mapIcon(icon)}</a>` : '';
}

function segmentMapActions(segment) {
  const start = iconMapLink(endpointMapUrl(segment.from), `Open ${segment.from.name} in Google Maps`, 'pin');
  const directions = iconMapLink(directionsUrl(segment.from, segment.to, segment.mode), `Directions from ${segment.from.name} to ${segment.to.name}`, 'route');
  return start || directions ? `<div class="transit-segment-actions" aria-label="Map actions for ${escapeHtml(segment.from.name)} to ${escapeHtml(segment.to.name)}">${start}${directions}</div>` : '';
}

function renderTransit(transit) {
  const time = transitTime(transit); const details = transitDetails(transit);
  const timing = [transit.departure && activityTime({ startsAt: transit.departure }), transit.arrival && activityTime({ startsAt: transit.arrival }), transit.duration].filter(Boolean).join(' · ');
  return `<article class="activity transit" data-transit-id="${escapeHtml(transit.id)}" data-testid="transit-item">
    <span class="timeline-node transit-node" aria-hidden="true"></span>
    <div class="activity-time">${time ? `<time datetime="${escapeHtml(transit.departure || '')}">${escapeHtml(time)}</time>` : '<span class="unscheduled">Travel</span>'}</div>
    <div class="activity-card"><p class="activity-type">${escapeHtml(transit.mode)} transit</p><div class="transit-title-row"><h3>${escapeHtml(transit.title)}</h3>${iconMapLink(directionsUrl(transit.from, transit.to, transit.mode), `Open itinerary directions from ${transit.from.name} to ${transit.to.name}`, 'route')}</div>
      <p class="transit-route"><strong>${escapeHtml(transit.from.name)}</strong><span aria-hidden="true"> → </span><strong>${escapeHtml(transit.to.name)}</strong></p>
      ${timing ? `<div class="activity-summary"><span>${escapeHtml(timing)}</span></div>` : ''}
      ${details.length ? `<details open><summary aria-label="Transit details">Transit details</summary><div class="details-body">${details.join('')}</div></details>` : ''}
      ${attachmentPanel({ tripId: tripId(state.trip), type: 'transit', ownerId: transit.id }, 'Transit tickets', { accept: '.pdf,.pkpass,application/pdf,application/vnd.apple.pkpass' })}
    </div></article>`;
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
      <a class="button primary" href="${escapeHtml(tripHash(trip))}" aria-label="Open trip overview">Open</a>
      ${removable ? `<button class="button subtle" type="button" data-remove-trip="${escapeHtml(tripId(trip))}" data-remove-revision="${revision(trip)}" aria-label="Remove saved trip">Remove</button>` : ''}
    </div>
  </article>`;
}

function schemaExportLink(className = 'button ghost') {
  const url = new URL('data/schemas/itinerary.v1.1.schema.json', baseUrl).href;
  return `<a class="${className}" data-schema-export href="${escapeHtml(url)}" download="trailbook-itinerary-schema-v1.1.json">Export JSON schema</a>`;
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
      <div id="network-status" class="network ${state.online ? '' : 'offline'}" aria-label="${state.online ? 'Online' : 'Offline, saved copy available'}">${state.online ? 'Online' : 'Offline'}</div>
      <button class="menu-toggle" id="menu-toggle" type="button" aria-expanded="false" aria-controls="app-menu" aria-label="Open app menu"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button>
    </div>
    <div class="menu-backdrop" id="menu-backdrop" aria-hidden="true" hidden></div>
    <nav class="app-menu" id="app-menu" aria-label="App menu" aria-hidden="true" hidden>
      <div class="app-menu-heading"><strong>App menu</strong><button class="drawer-close" id="drawer-close" type="button" aria-label="Close app menu">&times;</button></div>
      <label class="theme-control" for="theme-selector"><span>Theme</span><select id="theme-selector" aria-describedby="active-theme-status">${themes.map((theme) => `<option value="${theme.id}" ${theme.id === state.theme ? 'selected' : ''}>${theme.name}</option>`).join('')}</select></label>
      <label class="menu-action import-label">Import itinerary JSON<input id="trip-import" type="file" accept="application/json,application/vnd.trailbook.itinerary+json,.json,.trailbook"></label>
      ${schemaExportLink('menu-action')}
      <button class="menu-action" id="install-app" type="button" ${state.installPrompt ? '' : 'hidden'}>Install app</button>
    </nav>
    <span id="active-theme-status" class="sr-only" aria-live="polite">Active theme: ${escapeHtml(themes.find(({ id }) => id === state.theme)?.name)}</span>
  </header>`;
}

function noticeMarkup() { return state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ''; }

function tripLinkShareActionMarkup() {
  return `<button class="hero-icon-action hero-link-share-button" id="share-trip" type="button" aria-label="Share this trip as a published link" title="Share this trip as a published link">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5m-7.6 6.9 7.6 4.5"/></svg>
  </button>`;
}

function trailbookExportActionMarkup() {
  return `<span class="hero-file-export">
    <button class="hero-icon-action hero-export-button" id="export-trailbook" type="button" aria-label="Export portable Trailbook file" aria-describedby="trailbook-export-status" title="Export portable Trailbook file">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/></svg>
    </button>
    <span class="hero-export-status" id="trailbook-export-status" role="status" data-state="idle">Portable file export ready.</span>
  </span>`;
}

function bottomNavigation() {
  const items = [
    ['trip', 'Trip', '<path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9 20v-6h6v6"/>'],
    ['day-overview', 'Day Overview', '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>'],
    ['history', 'History', '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'],
  ];
  return `<nav class="bottom-nav" aria-label="Primary">${items.map(([id, label, icon]) => `<button type="button" data-bottom-section="${id}" class="bottom-nav-item ${state.section === id ? 'active' : ''}" ${state.section === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('')}</nav>`;
}

function importErrorMarkup() {
  if (!state.importError) return '';
  return `<section class="import-error" role="status" data-testid="itinerary-error">
    <div><p class="eyebrow">Import</p><h2>File needs repair</h2><p>Copy this request with your original JSON.</p></div>
    <textarea id="import-error-message" readonly aria-label="Copyable itinerary repair message">${escapeHtml(state.importError.prompt)}</textarea>
    <div class="import-error-actions"><button class="button primary" id="copy-import-error" type="button">Copy error for an LLM</button>${schemaExportLink('button subtle')}</div>
  </section>`;
}

function countryHistoryMarkup() {
  const countries = countryHistory.getHistory();
  return `<section class="country-history" aria-labelledby="country-history-title">
    <header><h2 id="country-history-title">Visited countries</h2><span>${countries.length} ${countries.length === 1 ? 'country' : 'countries'}</span></header>
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
      <button class="button subtle" type="submit" aria-label="Save correction">Save</button><button class="button danger" type="button" data-remove-country="${country.countryCode}">Remove</button>
    </form>`).join('') : '<p class="country-empty">No countries yet. Import a trip or add one.</p>'}</div>
  </section>`;
}

function routeStopMarkup(activity, index) {
  const location = activityLocation(activity);
  if (!location) return '';
  const name = typeof location === 'string' ? location : firstValue(location.name, location.address, location.query, 'Location');
  const transport = typeof activity.transport === 'string' ? activity.transport : activity.transport?.mode;
  return `<li><span class="route-number" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(name)}</span>${transport ? `<small>${escapeHtml(transport)}</small>` : ''}</div></li>`;
}

function stopCoordinates(stop) {
  const lat = firstValue(stop?.lat, stop?.location?.lat); const lng = firstValue(stop?.lng, stop?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
function stopMapReason(stop) {
  if (stop.lat === undefined && stop.lng === undefined) return 'No coordinates supplied';
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return 'Coordinates are incomplete';
  return 'Coordinates are outside WGS84 bounds';
}
function dayOverviewMarkup() {
  if (!state.trip) return `<section class="route-view empty-card" aria-labelledby="route-title"><p class="eyebrow">Day Overview</p><h2 id="route-title">Choose a trip</h2><button class="button primary" type="button" data-bottom-section="trip">Trips</button></section>`;
  const days = tripDays(state.trip); const day = currentDay();
  if (!day) return `<section class="route-view" aria-labelledby="route-title"><header><p class="eyebrow">${escapeHtml(tripTitle(state.trip))}</p><h2 id="route-title">Day Overview</h2><p>Choose a day</p></header><div class="route-day-list">${days.map((item, index) => `<a href="${escapeHtml(tripHash(state.trip, item.id))}" data-route-day><span>Day ${index + 1}</span><strong>${escapeHtml(item.title || item.date)}</strong></a>`).join('')}</div></section>`;
  const stops = dayItems(day).filter((item) => item.type !== 'transit'); const mapped = stops.filter(stopCoordinates); const unmapped = stops.filter((stop) => !stopCoordinates(stop));
  return `<section class="route-view day-overview" aria-labelledby="route-title" data-testid="day-overview"><header><a class="overview-link" href="${escapeHtml(tripHash(state.trip))}">All days</a><p class="eyebrow">${escapeHtml(day.date)}</p><h2 id="route-title">${escapeHtml(day.title || day.date)} · Day Overview</h2><div class="day-overview-toggle" role="group" aria-label="Day Overview display"><button type="button" class="button subtle" data-day-overview-tab="timetable" aria-pressed="true">Timetable</button><button type="button" class="button subtle" data-day-overview-tab="map" aria-pressed="false">Map</button></div></header><div data-day-overview-panel="timetable"><ol class="route-stop-list" aria-label="Ordered day stops">${stops.map(routeStopMarkup).join('')}</ol></div><div data-day-overview-panel="map" hidden><div class="lazy-day-map" data-day-overview-map data-day-id="${escapeHtml(day.id)}" aria-busy="true"><p>Loading map…</p></div></div><section class="unmapped-stops" aria-labelledby="unmapped-title"><h3 id="unmapped-title">Unmapped stops</h3>${unmapped.length ? `<ul>${unmapped.map((stop) => `<li><strong>${escapeHtml(stop.title)}</strong><span>${escapeHtml(stopMapReason(stop))}</span></li>`).join('')}</ul>` : '<p>All stops have valid coordinates.</p>'}</section><ol class="sr-only" aria-label="Accessible ordered day stops">${stops.map((stop,index) => `<li><button type="button" data-day-stop-select="${escapeHtml(stop.id)}">${index + 1}. ${escapeHtml(stop.title)}, ${escapeHtml(stop.location || 'location unavailable')}, ${escapeHtml(activityTime(stop) || 'Any time')}</button></li>`).join('')}</ol></section>`;
}
function observeTimeline() {
  timelineResizeObserver?.disconnect();
  timelineResizeObserver = undefined;
  const timeline = document.querySelector('.timeline');
  const spine = timeline?.querySelector('.timeline-spine');
  const nodes = [...(timeline?.querySelectorAll('.timeline-node') ?? [])];
  if (!timeline || !spine || nodes.length < 2) {
    if (spine) spine.hidden = true;
    return;
  }
  const position = () => {
    const timelineBox = timeline.getBoundingClientRect();
    const firstBox = nodes[0].getBoundingClientRect();
    const lastBox = nodes.at(-1).getBoundingClientRect();
    const firstCenter = firstBox.top + (firstBox.height / 2) - timelineBox.top;
    const lastCenter = lastBox.top + (lastBox.height / 2) - timelineBox.top;
    timeline.style.setProperty('--timeline-spine-top', `${firstCenter}px`);
    timeline.style.setProperty('--timeline-spine-height', `${Math.max(0, lastCenter - firstCenter)}px`);
  };
  position();
  if ('ResizeObserver' in window) {
    timelineResizeObserver = new ResizeObserver(position);
    timelineResizeObserver.observe(timeline);
  }
}

async function renderUtilitySection() {
  const history = state.section === 'history';
  app.innerHTML = `<div class="app-shell utility-shell">${kasumiMarkup()}${topbar()}<header class="utility-hero"><div class="utility-hero-content"><p class="eyebrow">${history ? 'Your travel record' : state.trip ? escapeHtml(tripTitle(state.trip)) : 'Plan visually'}</p><h1>${history ? 'History' : 'Day Overview'}</h1></div></header><main class="utility-main" data-testid="primary-content">${history ? countryHistoryMarkup() : dayOverviewMarkup()}</main>${bottomNavigation()}${noticeMarkup()}</div>`;
  bindCommon();
  if (!history) hydrateDayOverview();
}

async function renderCollection(savedTrips) {
  const trips = uniqueTrips(savedTrips);
  app.innerHTML = `<div class="app-shell">
    ${kasumiMarkup()}
    ${topbar()}
    <header class="collection-hero">
      <div class="collection-hero-content"><h1 aria-label="Your trips">Trips</h1></div>
    </header>
    <main class="collection-main" data-testid="primary-content">
      ${shareTargetMarkup()}${importErrorMarkup()}
      <div class="collection-heading"><h2 aria-label="Trip collection">${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}</h2></div>
      ${trips.length ? `<div class="trip-grid">${trips.map((trip) => tripCard(trip)).join('')}</div>` : `<section class="empty-card"><h2>No trips on this device</h2><p>${state.online ? 'Import an itinerary to get started.' : 'Connect once to download a published trip, or import an itinerary file already on this device.'}</p></section>`}
    </main>
    ${bottomNavigation()}${noticeMarkup()}
  </div>`;
  bindCommon();
}

function dayPreview(day) {
  const activities = dayItems(day);
  return `<li><a class="overview-day-card" href="${escapeHtml(tripHash(state.trip, day.id))}">
    <div><time>${escapeHtml(day.date)}</time><h3>${escapeHtml(day.title || day.date)}</h3>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}</div>
    ${activities.length ? `<ol class="activity-preview" aria-label="Activities">${activities.slice(0, 3).map((activity) => `<li>${escapeHtml(activityTime(activity) || 'Any time')} · ${escapeHtml(activity.title)}</li>`).join('')}</ol>` : '<p class="day-empty" aria-label="No activities planned for this day">No plans</p>'}
    <span class="day-card-action" aria-hidden="true">→</span>
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
      <div class="hero-actions">${day ? '<button class="primary" id="share-trip" type="button">Share this day</button>' : `${tripLinkShareActionMarkup()}${trailbookExportActionMarkup()}`}</div>
    </div></header>
    <main class="layout ${day ? '' : 'overview-layout'}" data-testid="primary-content">
      ${day ? navigation(days, day) : ''}
      <section class="content" aria-live="polite">
        ${importErrorMarkup()}
        ${state.attachmentError ? `<div class="import-error attachment-error" role="alert">${escapeHtml(state.attachmentError)}</div>` : ''}
        <p class="attachment-usage" aria-label="Local attachment storage usage. ${formatBytes(state.attachmentUsage.bytes)} of ${formatBytes(state.attachmentUsage.limitBytes)} used. ${state.attachmentUsage.count} files. Per-file limit ${formatBytes(attachmentStore.limits.perFileBytes)}.">Documents · ${state.attachmentUsage.count} · ${formatBytes(state.attachmentUsage.bytes)} / ${formatBytes(state.attachmentUsage.limitBytes)}</p>
        ${day ? `<article class="day-panel">
          <header class="day-heading"><a class="overview-link" href="${escapeHtml(tripHash(state.trip))}">← Trip overview</a><p class="eyebrow">${escapeHtml(day.date)}</p><h2 data-testid="selected-day-title">${escapeHtml(day.title || day.date)}</h2>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}
          </header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'day', ownerId: day.id }, 'Day documents')}
          ${dayItems(day).length ? `<div class="timeline"><span class="timeline-spine" aria-hidden="true"></span>${dayItems(day).map((item) => item.type === 'transit' ? renderTransit(item) : renderActivity(item)).join('')}</div>` : '<div class="empty-day" data-testid="empty-day"><strong>No plans yet</strong></div>'}
        </article>` : `<article class="trip-overview" data-testid="trip-overview">
          <header><h2>Trip overview</h2>${tripSummary(state.trip) ? `<p>${escapeHtml(tripSummary(state.trip))}</p>` : '<p>Choose a day</p>'}</header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'trip', ownerId: tripId(state.trip) }, 'Trip documents')}
          <button class="button danger clear-trip-attachments" type="button" data-clear-trip-attachments aria-label="Clear all local documents for this trip">Clear documents</button>
          ${days.length ? `<ol class="overview-day-list">${days.map(dayPreview).join('')}</ol>` : '<section class="empty-card" data-testid="empty-itinerary"><h3>No days yet</h3></section>'}
        </article>`}
      </section>
    </main>
    ${bottomNavigation()}${noticeMarkup()}
  </div>`;
  bindCommon();
  hydrateStopPictures();
  observeTimeline();
}

async function render() {
  const savedTrips = await store.listTrips();
  if (state.trip) await refreshAttachmentState();
  if (state.error) {
    app.innerHTML = `<div class="app-shell">${kasumiMarkup()}${topbar()}<main class="single-column"><section class="error-card"><p class="eyebrow">Trip unavailable</p><h1>${escapeHtml(state.error.title)}</h1><p>${escapeHtml(state.error.message)}</p><a class="button primary" href="${escapeHtml(baseUrl.href)}" aria-label="Back to all trips">All trips</a>${savedTrips.length ? `<div class="error-library"><h2>Saved trips</h2>${savedTrips.map((trip) => tripCard(trip)).join('')}</div>` : ''}</section></main>${noticeMarkup()}</div>`;
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
  if (file.name?.toLowerCase().endsWith('.trailbook') || file.type === 'application/vnd.trailbook.itinerary+json') {
    await stageTrailbookFile(file);
    return;
  }
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

function clearShareLocation() {
  const url = new URL(window.location.href);
  for (const key of ['share-target', 'id', 'reason']) url.searchParams.delete(key);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function discardPendingImport({ keepError = false } = {}) {
  const id = state.pendingShareId;
  state.pendingShareId = null;
  if (!keepError) state.shareImport = null;
  clearShareLocation();
  if (id) {
    try { await deletePendingImport(id); } catch { /* The record is already unusable; do not block safe cancellation. */ }
  }
}

async function loadPendingShare() {
  if (!state.pendingShareId) { await render(); return; }
  state.shareImport = { status: 'loading' };
  state.section = 'trip'; state.view = 'collection'; state.trip = null; state.dayId = null; state.error = null;
  await render();
  try {
    const record = await claimPendingImport(state.pendingShareId, shareClaimant);
    if (!record) throw Object.assign(new Error('This pending import is unavailable.'), { code: 'unavailable' });
    const result = await validateTrailbookImport(record, { source: record.source });
    const savedTrips = await store.listTrips();
    state.shareImport = {
      status: 'review',
      source: record.source,
      candidate: result.candidate,
      preview: result.preview,
      conflict: savedTrips.some((trip) => tripId(trip) === tripId(result.candidate)),
    };
  } catch (error) {
    state.shareImport = { status: 'error', error: error?.code || 'unreadable_file', message: error?.message };
    await discardPendingImport({ keepError: true });
  }
  await render();
}

async function stageTrailbookFile(file, source = 'picker') {
  try {
    validateImportTransport(file, { source });
    const pending = await putPendingImport({ name: file.name, type: file.type, size: file.size, bytes: await file.arrayBuffer(), source });
    const supersededId = source === 'android-view' ? state.pendingShareId : null;
    if (supersededId && supersededId !== pending.id) {
      try { await deletePendingImport(supersededId); } catch { /* The newer bounded delivery remains safe to review. */ }
    }
    state.pendingShareId = pending.id;
    state.shareImport = { status: 'loading' };
    const url = new URL(window.location.href);
    url.searchParams.set('share-target', 'confirm');
    url.searchParams.set('id', pending.id);
    url.hash = '';
    history.replaceState(null, '', `${url.pathname}${url.search}`);
    await loadPendingShare();
  } catch (error) {
    state.pendingShareId = null;
    state.shareImport = { status: 'error', error: error?.code || 'unreadable_file', message: error?.message };
    state.section = 'trip'; state.view = 'collection'; state.trip = null; state.dayId = null;
    await render();
  }
}

function androidFile(payload: TrailbookAndroidOpenFile) {
  let binary;
  try { binary = atob(payload.base64); }
  catch { throw Object.assign(new Error('The Android file payload was not valid Base64.'), { code: 'unreadable_file' }); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], payload.name, { type: payload.type });
}

async function drainAndroidOpenQueue() {
  if (!androidOpenReady || androidOpenActive) return;
  androidOpenActive = true;
  try {
    while (androidOpenQueue.length) {
      const payload = androidOpenQueue.shift();
      if (!payload) continue;
      if (payload.kind === 'error') {
        state.pendingShareId = null;
        state.shareImport = { status: 'error', error: payload.code || 'unreadable_file' };
        state.section = 'trip'; state.view = 'collection'; state.trip = null; state.dayId = null;
        await render();
        continue;
      }
      try {
        await stageTrailbookFile(androidFile(payload), 'android-view');
      } catch (error) {
        state.pendingShareId = null;
        state.shareImport = { status: 'error', error: error?.code || 'unreadable_file', message: error?.message };
        await render();
      }
    }
  } finally {
    androidOpenActive = false;
  }
}

window.trailbookReceiveAndroidOpen = (payload) => {
  androidOpenQueue.push(payload);
  void drainAndroidOpenQueue();
};
if (Array.isArray(window.__trailbookAndroidOpenQueue)) androidOpenQueue.push(...window.__trailbookAndroidOpenQueue.splice(0));

async function finishSharedImport() {
  const current = state.shareImport;
  if (current?.status !== 'review') return;
  const selection = current.conflict
    ? document.querySelector('input[name="share-conflict"]:checked')?.value || 'cancel'
    : 'import';
  if (selection === 'cancel') {
    await discardPendingImport();
    state.notice = 'Import cancelled. Your saved trips were not changed.';
    await render();
    return;
  }
  const originalId = tripId(current.candidate);
  const candidate = selection === 'duplicate' ? duplicateItinerary(current.candidate) : current.candidate;
  try {
    if (selection === 'replace') await store.replaceTrip(originalId, candidate);
    else await store.saveTrip(candidate);
  } catch (error) {
    await discardPendingImport();
    state.shareImport = { status: 'error', error: 'storage_failure', message: 'The trip could not be saved. Temporary import data was removed; existing trips were preserved.' };
    await render();
    return;
  }
  try { countryHistory.importItinerary(candidate); } catch { /* The validated trip remains usable if derived history cannot update. */ }
  await discardPendingImport();
  state.notice = selection === 'duplicate' ? 'Trip imported as a separate local copy.' : 'Trip imported and saved on this device.';
  state.section = 'trip';
  try { sessionStorage.setItem(SECTION_KEY, state.section); } catch { /* Continue without persistence. */ }
  window.location.hash = tripHash(candidate);
  if (window.location.hash === tripHash(candidate)) await loadRoute();
}

async function shareCurrent() {
  const button = document.querySelector('#share-trip');
  const hash = tripHash(state.trip, state.dayId);
  const url = new URL(hash, window.location.href.split('#')[0]).href;
  const data = { title: tripTitle(state.trip), text: `Open ${tripTitle(state.trip)} in Trailbook`, url };
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(url);
    showNotice('Link copied to clipboard.');
  } catch (error) {
    if (error?.name !== 'AbortError') showNotice('Could not share automatically. Copy the address from your browser.');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

async function exportCurrentTrip() {
  const button = document.querySelector('#export-trailbook');
  const status = document.querySelector('#trailbook-export-status');
  if (!button || !status) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.setAttribute('role', 'status');
  status.dataset.state = 'busy';
  status.textContent = 'Preparing portable fileâ€¦';
  try {
    const { file } = createTrailbookExport(state.trip);
    const result = await shareOrDownloadTrailbook(file);
    status.textContent = result === 'shared'
      ? 'Trailbook file shared. Nothing was uploaded by Trailbook.'
      : 'Trailbook file downloaded. Nothing was uploaded.';
    status.dataset.state = 'success';
  } catch (error) {
    const path = error?.path ? ` at ${error.path}` : '';
    status.setAttribute('role', 'alert');
    status.dataset.state = 'error';
    status.textContent = `This trip cannot be exported because its itinerary is invalid${path}. ${error?.message || 'Fix the itinerary and try again.'}`;
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
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

async function hydrateDayOverview() {
  const root = document.querySelector('[data-testid="day-overview"]'); if (!root) return;
  const day = currentDay(); if (!day) return;
  const setTab = async (tab) => {
    root.querySelectorAll('[data-day-overview-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.dayOverviewTab === tab)));
    root.querySelectorAll('[data-day-overview-panel]').forEach((panel) => { panel.hidden = panel.dataset.dayOverviewPanel !== tab; });
    try { sessionStorage.setItem(`trailbook:day-overview:${tripId(state.trip)}:${day.id}:tab`, tab); } catch { /* Session persistence is optional. */ }
    if (tab !== 'map') return;
    const host = root.querySelector('[data-day-overview-map]'); if (!host || host.dataset.ready) return;
    try {
      const { mountDayOverviewMap } = await import('../map/DayOverviewMap');
      mountDayOverviewMap(host, dayItems(day), selectDayOverviewStop); host.dataset.ready = 'true'; host.setAttribute('aria-busy', 'false');
    } catch { host.innerHTML = '<p class="map-unavailable" role="status">Map is unavailable. The timetable and ordered list remain available.</p>'; host.setAttribute('aria-busy', 'false'); }
  };
  root.querySelectorAll('[data-day-overview-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.dayOverviewTab)));
  root.querySelectorAll('[data-day-stop-select]').forEach((button) => button.addEventListener('click', () => selectDayOverviewStop(button.dataset.dayStopSelect)));
  let tab = 'timetable'; try { tab = sessionStorage.getItem(`trailbook:day-overview:${tripId(state.trip)}:${day.id}:tab`) || tab; } catch { /* Default timetable. */ }
  await setTab(tab);
}
function selectDayOverviewStop(id) {
  const card = document.querySelector(`[data-activity-id="${CSS.escape(id)}"]`);
  if (card) { state.section = 'trip'; try { sessionStorage.setItem(SECTION_KEY, 'trip'); } catch {} render().then(() => document.querySelector(`[data-activity-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })); }
}
function bindCommon() {
  disposeKasumi();
  disposeKasumi = createKasumiParallax({ root: document, viewport: window, navigatorObject: navigator });
  document.querySelectorAll('[data-bottom-section]').forEach((button) => button.addEventListener('click', async () => {
    state.section = button.dataset.bottomSection === 'route' ? 'day-overview' : button.dataset.bottomSection;
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
  document.querySelector('#export-trailbook')?.addEventListener('click', exportCurrentTrip);
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
  document.querySelector('#cancel-shared-file')?.addEventListener('click', async () => {
    await discardPendingImport();
    state.notice = 'Import cancelled. Your saved trips were not changed.';
    await render();
  });
  document.querySelector('#dismiss-shared-file')?.addEventListener('click', async () => {
    await discardPendingImport();
    await render();
  });
  document.querySelector('#confirm-shared-file')?.addEventListener('click', finishSharedImport);
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
}

async function loadPublished(target) {
  const assetUrl = new URL(`data/itineraries/${target.id}/v${target.revision}.json`, baseUrl);
  const schemaUrl = new URL('data/schemas/itinerary.v1.1.schema.json', baseUrl);
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
      message: state.online
        ? (/Unexpected token|not valid JSON/i.test(networkError?.message ?? '') ? 'The itinerary response was invalid.' : networkError?.message || 'Check the link and try again.')
        : 'This itinerary is not saved on this device yet. Reopen this link after one successful online visit.',
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
  androidOpenReady = true;
  const onHashChange = () => loadRoute();
  const onOnline = () => { state.online = true; loadRoute(); };
  const onOffline = () => { state.online = false; render(); };
  const onInstallPrompt = (event) => { event.preventDefault(); state.installPrompt = event; render(); };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('beforeinstallprompt', onInstallPrompt);
  void purgeExpiredImports().catch(() => { /* Import remains available even if maintenance cannot run. */ });
  loadRoute().then(() => {
    if (state.pendingShareId) return loadPendingShare();
    return drainAndroidOpenQueue();
  });
  return () => {
    disposeKasumi();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('beforeinstallprompt', onInstallPrompt);
  };
}

function shareTargetMarkup() {
  const current = state.shareImport;
  if (!state.pendingShareId && !current) return '';
  if (!current || current.status === 'loading') {
    return `<section class="share-import" role="status" aria-live="polite" data-testid="share-import-loading"><p class="eyebrow">Secure local import</p><h2>Checking shared itinerary…</h2><p>The trip has not been added to your collection.</p></section>`;
  }
  if (current.status === 'error') {
    const messages = {
      invalid_request: 'The share request was not a supported multipart file request.',
      unexpected_files: 'Share exactly one .trailbook file. Extra files and fields are blocked.',
      unsafe_filename: 'The shared filename looked like a path and was blocked.',
      unsupported_extension: 'Only .trailbook itinerary files can be received from Android sharing.',
      mime_mismatch: 'The file type did not match the .trailbook extension.',
      file_too_large: 'The shared itinerary exceeded the configured file-size limit.',
      permission_denied: 'Android did not grant temporary read access to this file.',
      empty_file: 'The shared itinerary was empty.',
      invalid_utf8: 'The shared itinerary was not valid UTF-8 text.',
      non_json: 'The shared file was not a JSON itinerary.',
      invalid_json: 'The shared itinerary contained malformed JSON.',
      unsupported_schema: 'The shared itinerary uses an unsupported schema version.',
      invalid_schema: 'The shared itinerary does not match the supported v1.1 contract.',
      active_content: 'The shared itinerary contained active or unsafe content.',
      unavailable: 'This pending import is already being reviewed or has expired.',
    };
    return `<section class="share-import share-import-error" role="alert" data-testid="share-import-error"><p class="eyebrow">Import blocked</p><h2>This file was not imported</h2><p>${escapeHtml(current.message || messages[current.error] || 'The shared itinerary could not be read safely.')}</p><p>Your saved trips were not changed and no content from the file was executed.</p><button class="button subtle" id="dismiss-shared-file" type="button">Back to trips</button></section>`;
  }
  const { preview } = current;
  return `<section class="share-import" aria-labelledby="share-import-title" data-testid="share-import-preview">
    <header><div><p class="eyebrow">Secure local import · ${current.source === 'picker' ? 'File picker' : current.source === 'android-view' ? 'Android file open' : 'Android share target'}</p><h2 id="share-import-title">Review before importing</h2></div><span class="share-import-badge">Not imported</span></header>
    <p class="share-import-source">Received as <strong>${escapeHtml(preview.fileName)}</strong>. Only the itinerary JSON is supported; attachments are never imported.</p>
    <dl class="share-import-details">
      <div><dt>Title</dt><dd>${escapeHtml(preview.title)}</dd></div>
      <div><dt>Trip ID</dt><dd data-testid="share-import-trip-id">${escapeHtml(preview.tripId)}</dd></div>
      <div><dt>Date range</dt><dd>${escapeHtml(preview.dateRange)}</dd></div>
      <div><dt>Destinations</dt><dd>${escapeHtml(preview.destination)}</dd></div>
      <div><dt>Schema</dt><dd>v${escapeHtml(preview.schemaVersion)}</dd></div>
      <div><dt>Itinerary</dt><dd>${preview.dayCount} ${preview.dayCount === 1 ? 'day' : 'days'}</dd></div>
    </dl>
    ${preview.warnings.length ? `<div class="share-import-warnings" role="status"><strong>Warnings</strong><ul>${preview.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>` : ''}
    ${current.conflict ? `<fieldset class="share-import-conflict"><legend>A trip with ID ${escapeHtml(preview.tripId)} already exists</legend><p>Choose explicitly how Trailbook should handle it.</p>
      <label><input type="radio" name="share-conflict" value="cancel" checked> Cancel and keep the saved trip</label>
      <label><input type="radio" name="share-conflict" value="replace"> Replace all saved revisions with this itinerary</label>
      <label><input type="radio" name="share-conflict" value="duplicate"> Keep both with a new local trip ID</label>
    </fieldset>` : ''}
    <div class="share-import-actions"><button class="button primary" id="confirm-shared-file" type="button">${current.conflict ? 'Continue with selection' : 'Import and open trip'}</button><button class="button subtle" id="cancel-shared-file" type="button">Cancel import</button></div>
    <p class="share-import-trace" role="status">Validated locally against supported schema v1.1. Nothing is uploaded.</p>
  </section>`;
}
