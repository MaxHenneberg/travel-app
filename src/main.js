import './style.css';
import { validateItinerary } from './lib/itinerary.js';
import { buildHashRoute, tryParseHashRoute } from './lib/hash-route.js';
import { buildGoogleMapsPlaceUrl, buildGoogleMapsRouteUrls } from './lib/google-maps.js';
import { createTripStore } from './lib/trip-store.js';
import { mountLegacyApp } from './legacy-app.js';

const app = document.querySelector('#app');
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const store = createTripStore();
const state = { trip: null, dayId: null, error: null, notice: '', installPrompt: null, online: navigator.onLine };

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const tripId = (trip) => firstValue(trip?.id, trip?.trip?.id);
const revision = (trip) => Number(firstValue(trip?.revision, trip?.trip?.revision, 1));
const tripTitle = (trip) => firstValue(trip?.title, trip?.trip?.title, 'Untitled trip');
const tripDays = (trip) => firstValue(trip?.days, trip?.trip?.days, []);

function dateRange(trip) {
  if (trip.dateRange) return trip.dateRange;
  const start = trip.trip?.startDate;
  const end = trip.trip?.endDate;
  return start && end ? `${start} — ${end}` : '';
}

function currentDay() {
  const days = tripDays(state.trip);
  return days.find((day) => day.id === state.dayId) ?? days[0] ?? null;
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function activityTime(activity) {
  if (activity.time) return activity.time;
  if (activity.startsAt) return new Date(activity.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return null;
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

function renderDetails(activity) {
  const transport = activity.transport;
  const links = (activity.links ?? [])
    .map((link) => ({ label: link.label || 'Open link', url: safeExternalUrl(link.url) }))
    .filter((link) => link.url);
  const rows = [];
  if (activity.description) rows.push(`<p>${escapeHtml(activity.description)}</p>`);
  if (activity.notes) rows.push(`<p><span class="detail-label">Notes</span><br>${escapeHtml(activity.notes)}</p>`);
  if (activity.reservation) rows.push(`<p><span class="detail-label">Reservation</span><br>${escapeHtml(activity.reservation)}</p>`);
  if (activity.cost) rows.push(`<p><span class="detail-label">Cost</span><br>${escapeHtml(activity.cost)}</p>`);
  if (transport) {
    const parts = typeof transport === 'string'
      ? transport
      : [transport.mode, transport.line, transport.from && transport.to ? `${transport.from} → ${transport.to}` : '', transport.platform].filter(Boolean).join(' · ');
    if (parts) rows.push(`<p><span class="detail-label">Transport</span><br>${escapeHtml(parts)}</p>`);
  }
  if (links.length) rows.push(`<div class="external-links">${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join('')}</div>`);
  return rows;
}

function renderActivity(activity) {
  const time = activityTime(activity);
  const details = renderDetails(activity);
  const mapUrl = placeUrl(activity);
  return `
    <article class="activity" data-activity-id="${escapeHtml(activity.id)}">
      <div class="activity-time">${time ? escapeHtml(time) : '<span class="unscheduled">Any time</span>'}</div>
      <div class="activity-card">
        <p class="activity-type">${escapeHtml(firstValue(activity.type, activity.category, 'Activity'))}</p>
        <h3>${escapeHtml(activity.title)}</h3>
        <div class="activity-summary">
          ${activity.duration ? `<span>${escapeHtml(activity.duration)}</span>` : ''}
          ${typeof activity.location === 'string' ? `<span>${escapeHtml(activity.location)}</span>` : activity.location?.name ? `<span>${escapeHtml(activity.location.name)}</span>` : ''}
        </div>
        ${details.length ? `<details><summary>Practical details</summary><div class="details-body">${details.join('')}</div></details>` : ''}
        ${mapUrl ? `<a class="button map-action" data-map-link href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>` : ''}
      </div>
    </article>`;
}

function routeUrls(day) {
  const stops = (day?.activities ?? []).map(activityLocation).filter(Boolean);
  try { return buildGoogleMapsRouteUrls(stops, { travelMode: 'walking' }); } catch { return []; }
}

function canonicalHash(dayId = state.dayId) {
  return buildHashRoute({ tripId: tripId(state.trip), revision: revision(state.trip), dayId });
}

function libraryMarkup(trips) {
  if (!trips.length) return '<p class="sidebar-note">Imported trips stay on this device.</p>';
  return `<div class="library-list">${trips.map((trip) => `
    <div class="library-item">
      <button type="button" data-open-trip="${escapeHtml(tripId(trip))}" data-open-revision="${revision(trip)}">${escapeHtml(tripTitle(trip))}</button>
      <button class="icon-button" type="button" aria-label="Remove ${escapeHtml(tripTitle(trip))}" data-remove-trip="${escapeHtml(tripId(trip))}" data-remove-revision="${revision(trip)}">×</button>
    </div>`).join('')}</div>`;
}

async function render() {
  const savedTrips = await store.listTrips();
  const online = state.online;
  if (state.error || !state.trip) {
    app.innerHTML = `
      <div class="app-shell">
        ${topbar(online)}
        <main class="layout" style="margin-top: 2rem; grid-template-columns: 1fr">
          <section class="${state.error ? 'error-card' : 'empty-card'}">
            <p class="eyebrow">${state.error ? 'Unable to open trip' : 'Your pocket itinerary'}</p>
            <h2>${state.error ? escapeHtml(state.error.title) : 'Bring a trip with you'}</h2>
            <p>${state.error ? escapeHtml(state.error.message) : 'Import a versioned itinerary JSON file. It stays on this device and remains available when the signal disappears.'}</p>
            <label class="button primary import-label">Import itinerary JSON<input id="trip-import" type="file" accept="application/json,.json"></label>
            ${savedTrips.length ? `<div class="library"><h3>Saved trips</h3>${libraryMarkup(savedTrips)}</div>` : ''}
          </section>
        </main>
        ${noticeMarkup()}
      </div>`;
    bindCommon();
    return;
  }

  const day = currentDay();
  const days = tripDays(state.trip);
  const routes = routeUrls(day);
  app.innerHTML = `
    <div class="app-shell">
      ${topbar(online)}
      <header class="hero">
        <div class="hero-content">
          <p class="eyebrow">${escapeHtml(firstValue(state.trip.destination, state.trip.trip?.summary, 'Saved itinerary'))}</p>
          <h1>${escapeHtml(tripTitle(state.trip))}</h1>
          <div class="hero-meta"><span>${escapeHtml(dateRange(state.trip))}</span><span>${days.length} ${days.length === 1 ? 'day' : 'days'}</span><span>Revision ${revision(state.trip)}</span></div>
          <div class="hero-actions">
            <button class="primary" id="share-trip" type="button">Share this day</button>
            <button class="ghost" id="install-app" type="button" ${state.installPrompt ? '' : 'hidden'}>Install app</button>
          </div>
        </div>
      </header>
      <main class="layout">
        <aside class="sidebar" aria-label="Itinerary navigation">
          <h2>Your days</h2><p class="sidebar-note">Everything here is saved for offline use.</p>
          <nav class="day-nav">${days.map((item, index) => `<button class="day-button ${item.id === day?.id ? 'active' : ''}" type="button" data-day-id="${escapeHtml(item.id)}"><small>Day ${index + 1} · ${escapeHtml(item.date)}</small><span>${escapeHtml(item.title || `Day ${index + 1}`)}</span></button>`).join('')}</nav>
          <div class="library"><h2>Trip library</h2>${libraryMarkup(savedTrips)}<label class="button subtle import-label">Import another trip<input id="trip-import" type="file" accept="application/json,.json"></label></div>
        </aside>
        <section class="content" aria-live="polite">
          ${day ? `<article class="day-panel">
            <header class="day-heading"><p class="eyebrow">${escapeHtml(day.date)}</p><h2>${escapeHtml(day.title || 'Today')}</h2>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}
              ${routes.length ? `<div class="day-toolbar">${routes.map((url, index) => `<a class="button subtle" data-map-link href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${routes.length > 1 ? `Route part ${index + 1}` : 'Open day route'} ↗</a>`).join('')}</div>` : ''}
            </header>
            ${(day.activities ?? []).length ? `<div class="timeline">${day.activities.map(renderActivity).join('')}</div>` : '<div class="empty-day"><strong>No fixed plans yet</strong>This day is open. Add an activity in the itinerary file when you are ready.</div>'}
          </article>` : '<section class="empty-card"><h2>No itinerary days</h2><p>This trip is valid, but it does not contain any days yet.</p></section>'}
        </section>
      </main>
      ${noticeMarkup()}
    </div>`;
  bindCommon();
}

function topbar(online) {
  return `<div class="topbar"><div class="brand"><img src="${escapeHtml(new URL('icons/travel-192.png', baseUrl).href)}" alt=""><span>Trailbook</span></div><div id="network-status" class="network ${online ? '' : 'offline'}">${online ? 'Online · synced' : 'Offline · saved copy'}</div></div>`;
}

function noticeMarkup() { return state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ''; }

function showNotice(message) {
  state.notice = message;
  render();
  window.setTimeout(() => { if (state.notice === message) { state.notice = ''; render(); } }, 3200);
}

async function importFile(file) {
  try {
    const candidate = validateItinerary(JSON.parse(await file.text()));
    await store.saveTrip(candidate);
    state.trip = candidate;
    state.dayId = tripDays(candidate)[0]?.id ?? null;
    state.error = null;
    window.location.hash = canonicalHash();
    showNotice('Trip imported and saved on this device.');
  } catch (error) {
    showNotice(error?.message || 'That file is not a supported itinerary.');
  }
}

async function shareCurrent() {
  const url = new URL(canonicalHash(), window.location.href.split('#')[0]).href;
  const data = { title: tripTitle(state.trip), text: `Open ${tripTitle(state.trip)} in Trailbook`, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(url);
    showNotice('Link copied to clipboard.');
  } catch (error) {
    if (error?.name !== 'AbortError') showNotice('Could not share automatically. Copy the address from your browser.');
  }
}

function bindCommon() {
  document.querySelector('#trip-import')?.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) importFile(file);
  });
  document.querySelectorAll('[data-day-id]').forEach((button) => button.addEventListener('click', () => {
    state.dayId = button.dataset.dayId;
    window.location.hash = canonicalHash(state.dayId);
    render();
  }));
  document.querySelectorAll('[data-open-trip]').forEach((button) => button.addEventListener('click', () => {
    window.location.hash = buildHashRoute({ tripId: button.dataset.openTrip, revision: Number(button.dataset.openRevision) });
  }));
  document.querySelectorAll('[data-remove-trip]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm(`Remove this saved trip from this device?`)) return;
    await store.deleteTrip(button.dataset.removeTrip, Number(button.dataset.removeRevision));
    if (tripId(state.trip) === button.dataset.removeTrip) { state.trip = null; state.dayId = null; window.location.hash = ''; }
    showNotice('Trip removed.');
  }));
  document.querySelectorAll('[data-map-link]').forEach((link) => link.addEventListener('click', (event) => {
    if (!state.online) { event.preventDefault(); showNotice('Maps needs a connection. Your itinerary is still available offline.'); }
  }));
  document.querySelector('#share-trip')?.addEventListener('click', shareCurrent);
  document.querySelector('#install-app')?.addEventListener('click', async () => {
    await state.installPrompt?.prompt();
    state.installPrompt = null;
    render();
  });
}

async function loadRoute() {
  const { route, error } = tryParseHashRoute(window.location.hash);
  if (error) {
    state.trip = null;
    state.error = { title: 'This link is not safe to open', message: error.message };
    await render();
    return;
  }
  const target = route ?? { tripId: 'weekend-lisbon', revision: 1, dayId: null };
  let candidate = null;
  let networkError = null;
  try {
    const assetUrl = new URL(`data/itineraries/${target.tripId}/v${target.revision}.json`, baseUrl);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(response.status === 404 ? 'This itinerary revision has not been published.' : `The itinerary could not be loaded (${response.status}).`);
    candidate = validateItinerary(await response.json());
    if (tripId(candidate) !== target.tripId || revision(candidate) !== target.revision) throw new Error('The published itinerary does not match the requested immutable revision.');
    await store.saveTrip(candidate);
  } catch (error) {
    networkError = error;
    candidate = await store.getTrip(target.tripId, target.revision);
  }
  if (!candidate) {
    state.trip = null;
    state.error = {
      title: state.online ? 'Itinerary unavailable' : 'Connect once to download this trip',
      message: state.online ? networkError?.message || 'Check the link and try again.' : 'This itinerary is not saved on this device yet. Reopen this link after one successful online visit.',
    };
    await render();
    return;
  }
  const days = tripDays(candidate);
  if (target.dayId && !days.some((day) => day.id === target.dayId)) {
    state.trip = null;
    state.error = { title: 'Day not found', message: 'The trip loaded, but this day does not exist in the requested revision.' };
    await render();
    return;
  }
  state.trip = candidate;
  state.dayId = target.dayId ?? days[0]?.id ?? null;
  state.error = null;
  await render();
}

if (window.location.hash) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('sw.js', baseUrl), { scope: import.meta.env.BASE_URL }).catch(() => {});
  }
  window.addEventListener('hashchange', loadRoute);
  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; render(); });
  loadRoute();
} else {
  mountLegacyApp(app, { baseUrl: import.meta.env.BASE_URL });
}
