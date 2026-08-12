import './style.css';
import { ITINERARY_SCHEMA_VERSION, parseItinerary, validateItinerary } from './lib/itinerary.js';
import { buildHashRoute, tryParseHashRoute } from './lib/hash-route.js';
import { buildGoogleMapsPlaceUrl, buildGoogleMapsRouteUrls } from './lib/google-maps.js';
import { createTripStore } from './lib/trip-store.js';
import { createAttachmentStore } from './lib/attachment-store.js';

const app = document.querySelector('#app');
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const store = createTripStore();
const attachmentStore = createAttachmentStore();
const state = {
  view: 'collection', trip: null, dayId: null, error: null, notice: '',
  importError: null, installPrompt: null, online: navigator.onLine, attachments: new Map(),
  attachmentUsage: { bytes: 0, count: 0, limitBytes: attachmentStore.limits.totalBytes }, attachmentError: '', focusAfterRender: '',
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

function attachmentPanel(scope, heading) {
  const key = attachmentScopeKey(scope);
  const records = state.attachments.get(key) ?? [];
  return `<section class="attachments" data-attachment-scope="${escapeHtml(key)}" aria-labelledby="attachments-${escapeHtml(key)}">
    <div class="attachment-heading"><div><p class="eyebrow">Local only · available offline</p><h3 id="attachments-${escapeHtml(key)}">${escapeHtml(heading)}</h3></div>
      <label class="button subtle attachment-picker">Add files<input type="file" multiple data-attachment-input data-trip-id="${escapeHtml(scope.tripId)}" data-scope-type="${escapeHtml(scope.type)}" data-owner-id="${escapeHtml(scope.ownerId)}"></label>
    </div>
    <p class="attachment-privacy">Documents stay in this browser profile and never sync or upload. They may contain personal information and are protected by your device—not by app-level encryption.</p>
    ${records.length ? `<ul class="attachment-list">${records.map((item) => `<li class="attachment-item" data-attachment-id="${escapeHtml(item.id)}">
      <div class="attachment-copy"><strong class="attachment-label">${escapeHtml(item.label)}</strong><span class="attachment-name">${escapeHtml(item.name)}</span><span>${escapeHtml(item.kind === 'pdf' ? 'PDF document' : item.kind === 'pass' ? 'Wallet pass' : item.type || 'Generic file')} · ${formatBytes(item.size)} · added ${escapeHtml(new Date(item.addedAt).toLocaleDateString())}</span></div>
      <div class="attachment-actions">
        <button class="button subtle" type="button" data-attachment-open="${escapeHtml(item.id)}">${item.kind === 'pdf' ? 'Open PDF' : item.kind === 'pass' ? 'Open pass' : 'Share or download'}</button>
        <button class="button ghost" type="button" data-attachment-rename="${escapeHtml(item.id)}">Edit label</button>
        <button class="button danger" type="button" data-attachment-remove="${escapeHtml(item.id)}">Remove</button>
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
  return `<article class="activity" data-activity-id="${escapeHtml(activity.id)}" data-testid="activity-item">
    <div class="activity-time">${time ? `<time${activity.startsAt ? ` datetime="${escapeHtml(activity.startsAt)}"` : ''}>${escapeHtml(time)}</time>` : '<span class="unscheduled">Any time</span>'}</div>
    <div class="activity-card">
      <p class="activity-type">${escapeHtml(firstValue(activity.type, activity.category, 'Activity'))}</p>
      <h3>${escapeHtml(activity.title)}</h3>
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

function routeUrls(day) {
  const stops = (day?.activities ?? []).map(activityLocation).filter(Boolean);
  try { return buildGoogleMapsRouteUrls(stops, { travelMode: 'walking' }); } catch { return []; }
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

function topbar() {
  return `<header class="topbar">
    <a class="brand" href="${escapeHtml(baseUrl.href)}" aria-label="All trips"><img src="${escapeHtml(new URL('icons/travel-192.png', baseUrl).href)}" alt=""><span>Trailbook</span></a>
    <div id="network-status" class="network ${state.online ? '' : 'offline'}">${state.online ? 'Online · synced' : 'Offline · saved copy'}</div>
  </header>`;
}

function noticeMarkup() { return state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ''; }

function importErrorMarkup() {
  if (!state.importError) return '';
  return `<section class="import-error" role="status" data-testid="itinerary-error">
    <div><p class="eyebrow">Import needs attention</p><h2>JSON could not be imported</h2><p>Copy this repair request and send it to an LLM together with your original JSON.</p></div>
    <textarea id="import-error-message" readonly aria-label="Copyable itinerary repair message">${escapeHtml(state.importError.prompt)}</textarea>
    <div class="import-error-actions"><button class="button primary" id="copy-import-error" type="button">Copy error for an LLM</button>${schemaExportLink('button subtle')}</div>
  </section>`;
}

async function renderCollection(savedTrips) {
  const trips = uniqueTrips(savedTrips);
  app.innerHTML = `<div class="app-shell">
    ${topbar()}
    <header class="collection-hero">
      <div><p class="eyebrow">Your pocket itineraries</p><h1>Your trips</h1><p>Open a trip overview, choose a day when you need it, or bring another itinerary onto this device.</p></div>
      <div class="hero-actions"><label class="button primary import-label">Import itinerary JSON<input id="trip-import" type="file" accept="application/json,.json"></label>${schemaExportLink()}<button class="button ghost" id="install-app" type="button" ${state.installPrompt ? '' : 'hidden'}>Install app</button></div>
    </header>
    <main class="collection-main" data-testid="primary-content">
      ${importErrorMarkup()}
      <div class="collection-heading"><div><p class="eyebrow">Saved and published</p><h2>Trip collection</h2></div><span>${trips.length} ${trips.length === 1 ? 'trip' : 'trips'}</span></div>
      ${trips.length ? `<div class="trip-grid">${trips.map((trip) => tripCard(trip)).join('')}</div>` : `<section class="empty-card"><h2>No trips on this device</h2><p>${state.online ? 'Import an itinerary to get started.' : 'Connect once to download a published trip, or import an itinerary file already on this device.'}</p></section>`}
    </main>
    ${noticeMarkup()}
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
    <label class="button subtle import-label">Import another trip<input id="trip-import" type="file" accept="application/json,.json"></label>
    ${schemaExportLink('button subtle')}
  </aside>`;
}

async function renderTrip(savedTrips) {
  const days = tripDays(state.trip);
  const day = currentDay();
  const routes = routeUrls(day);
  app.innerHTML = `<div class="app-shell">
    ${topbar()}
    <header class="hero"><div class="hero-content">
      <p class="eyebrow">${escapeHtml(tripDestination(state.trip))}</p>
      <h1 data-testid="trip-title">${escapeHtml(tripTitle(state.trip))}</h1>
      <div class="hero-meta"><span>${escapeHtml(dateRange(state.trip))}</span><span>${days.length} ${days.length === 1 ? 'day' : 'days'}</span><span>Revision ${revision(state.trip)}</span></div>
      <div class="hero-actions"><button class="primary" id="share-trip" type="button">${day ? 'Share this day' : 'Share this trip'}</button><button class="ghost" id="install-app" type="button" ${state.installPrompt ? '' : 'hidden'}>Install app</button></div>
    </div></header>
    <main class="layout" data-testid="primary-content">
      ${navigation(days, day)}
      <section class="content" aria-live="polite">
        ${importErrorMarkup()}
        ${state.attachmentError ? `<div class="import-error attachment-error" role="alert">${escapeHtml(state.attachmentError)}</div>` : ''}
        <p class="attachment-usage" aria-label="Local attachment storage usage">Local documents: ${formatBytes(state.attachmentUsage.bytes)} of ${formatBytes(state.attachmentUsage.limitBytes)} used (${state.attachmentUsage.count} files). Per-file limit: ${formatBytes(attachmentStore.limits.perFileBytes)}.</p>
        ${day ? `<article class="day-panel">
          <header class="day-heading"><a class="overview-link" href="${escapeHtml(tripHash(state.trip))}">← Trip overview</a><p class="eyebrow">${escapeHtml(day.date)}</p><h2 data-testid="selected-day-title">${escapeHtml(day.title || day.date)}</h2>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}
            ${routes.length ? `<div class="day-toolbar">${routes.map((url, index) => `<a class="button subtle" data-map-link href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${routes.length > 1 ? `Route part ${index + 1}` : 'Open day route'} ↗</a>`).join('')}</div>` : ''}
          </header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'day', ownerId: day.id }, 'Day documents')}
          ${(day.activities ?? []).length ? `<div class="timeline">${day.activities.map(renderActivity).join('')}</div>` : '<div class="empty-day" data-testid="empty-day"><strong>No fixed plans yet</strong>This day is open. Add an activity in the itinerary file when you are ready.</div>'}
        </article>` : `<article class="trip-overview" data-testid="trip-overview">
          <header><p class="eyebrow">At a glance</p><h2>Trip overview</h2>${tripSummary(state.trip) ? `<p>${escapeHtml(tripSummary(state.trip))}</p>` : '<p>Choose a day to see its complete itinerary.</p>'}</header>
          ${attachmentPanel({ tripId: tripId(state.trip), type: 'trip', ownerId: tripId(state.trip) }, 'Trip documents')}
          <button class="button danger clear-trip-attachments" type="button" data-clear-trip-attachments>Clear all local documents for this trip</button>
          ${days.length ? `<ol class="overview-day-list">${days.map(dayPreview).join('')}</ol>` : '<section class="empty-card" data-testid="empty-itinerary"><h3>No itinerary days available</h3><p>This trip does not contain any day plans.</p></section>'}
        </article>`}
      </section>
    </main>
    ${noticeMarkup()}
  </div>`;
  bindCommon();
}

async function render() {
  const savedTrips = await store.listTrips();
  if (state.trip) await refreshAttachmentState();
  if (state.error) {
    app.innerHTML = `<div class="app-shell">${topbar()}<main class="single-column"><section class="error-card"><p class="eyebrow">Unable to open trip</p><h1>${escapeHtml(state.error.title)}</h1><p>${escapeHtml(state.error.message)}</p><a class="button primary" href="${escapeHtml(baseUrl.href)}">Back to all trips</a>${savedTrips.length ? `<div class="error-library"><h2>Trips on this device</h2>${savedTrips.map((trip) => tripCard(trip)).join('')}</div>` : ''}</section></main>${noticeMarkup()}</div>`;
    bindCommon();
    return;
  }
  if (state.view === 'collection') await renderCollection(savedTrips);
  else await renderTrip(savedTrips);
  if (state.focusAfterRender) {
    const target = document.querySelector(`[data-attachment-scope="${CSS.escape(state.focusAfterRender)}"] [data-attachment-input]`);
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
    state.importError = null;
    state.notice = 'Trip imported and saved on this device.';
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
  document.querySelectorAll('#trip-import').forEach((input) => input.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) importFile(file);
  }));
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
    await state.installPrompt?.prompt(); state.installPrompt = null; render();
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
  const { route, error } = tryParseHashRoute(window.location.hash);
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('sw.js', baseUrl), { scope: import.meta.env.BASE_URL }).catch(() => {});
window.addEventListener('hashchange', loadRoute);
window.addEventListener('online', () => { state.online = true; loadRoute(); });
window.addEventListener('offline', () => { state.online = false; render(); });
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; render(); });
loadRoute();
