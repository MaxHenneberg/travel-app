import './style.css';
import { loadItinerary } from './itinerary/load.js';

const baseUrl = import.meta.env.BASE_URL;
const markUrl = `${baseUrl}favicon.svg`;

const icons = {
  journey: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19h14M7 16l3-9h4l3 9M8 13h8"/></svg>',
  explore: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9 3.9-1.7Z"/></svg>',
  saved: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 4.5h11v15L12 16l-5.5 3.5v-15Z"/></svg>',
};

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="${baseUrl}" aria-label="Return to the welcome page">
        <img src="${markUrl}" width="38" height="38" alt="" />
        <span>Travel</span>
      </a>
      <button class="avatar" type="button" aria-label="Open profile">TR</button>
    </header>

    <main class="main-content" id="main-content">
      <section class="hero welcome" aria-labelledby="welcome-title">
        <p class="eyebrow">Your journeys</p>
        <h1 id="welcome-title">Hello World</h1>
        <p class="lede">Keep the moments that matter close, wherever you are headed.</p>
        <button class="primary-action" type="button" data-nav-target="Explore">
          ${icons.explore}<span>Explore inspiration</span>
        </button>
      </section>

      <section class="content-section" aria-labelledby="up-next-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Ready when you are</p>
            <h2 id="up-next-title">Up next</h2>
          </div>
          <button class="text-button" type="button" id="show-states" aria-expanded="false" aria-controls="state-showcase">View app states</button>
        </div>

        <div id="itinerary-panel" data-testid="primary-content" aria-live="polite">
          <article class="state-card state-loading itinerary-state">
            <span class="spinner" aria-hidden="true"></span>
            <div><h3>Loading itinerary</h3><p role="status">Checking your trip data…</p></div>
          </article>
        </div>

        <div class="state-showcase" id="state-showcase" hidden>
          <article class="state-card state-loading" aria-labelledby="loading-title">
            <span class="spinner" aria-hidden="true"></span>
            <div><h3 id="loading-title">Loading journeys</h3><p role="status">Bringing your plans together…</p></div>
          </article>
          <article class="state-card state-empty" aria-labelledby="empty-title">
            <span class="state-symbol" aria-hidden="true">＋</span>
            <div><h3 id="empty-title">No journeys yet</h3><p>Your next adventure can start whenever you are ready.</p></div>
          </article>
          <article class="state-card state-error" aria-labelledby="error-title" id="error-state">
            <span class="state-symbol" aria-hidden="true">!</span>
            <div><h3 id="error-title">Could not load journeys</h3><p>Check your connection and try again.</p><button class="retry-button" type="button">Try again</button></div>
          </article>
        </div>
      </section>
    </main>

    <nav class="bottom-nav" aria-label="Primary navigation">
      ${Object.entries(icons).map(([name, icon], index) => `<button class="nav-item${index === 0 ? ' is-active' : ''}" type="button" data-label="${name[0].toUpperCase()}${name.slice(1)}" aria-current="${index === 0 ? 'page' : 'false'}">${icon}<span>${name[0].toUpperCase()}${name.slice(1)}</span></button>`).join('')}
    </nav>
  </div>
`;

const navItems = [...document.querySelectorAll('.nav-item')];

function selectNavigation(label) {
  for (const item of navItems) {
    const active = item.dataset.label === label;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  }
  document.querySelector('#welcome-title').textContent = label === 'Journey' ? 'Hello World' : label;
}

for (const item of navItems) item.addEventListener('click', () => selectNavigation(item.dataset.label));
document.querySelector('[data-nav-target]').addEventListener('click', (event) => selectNavigation(event.currentTarget.dataset.navTarget));

document.querySelector('#show-states').addEventListener('click', (event) => {
  const showcase = document.querySelector('#state-showcase');
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  showcase.hidden = expanded;
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  event.currentTarget.textContent = expanded ? 'View app states' : 'Hide app states';
});

document.querySelector('.retry-button').addEventListener('click', () => {
  const state = document.querySelector('#error-state');
  state.className = 'state-card state-recovered';
  state.innerHTML = '<span class="state-symbol" aria-hidden="true">✓</span><div><h3>Journeys restored</h3><p role="status">You are back on track.</p></div>';
});

const itineraryPanel = document.querySelector('#itinerary-panel');
const itinerarySectionTitle = document.querySelector('#up-next-title');
let currentItinerary;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function tripMetadataMarkup(itinerary) {
  const { trip } = itinerary;
  const [year, month, day] = trip.startDate.split('-').map(Number);
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .toUpperCase();
  return `
    <article class="journey-card">
      <div class="date-tile" aria-hidden="true"><strong>${escapeHtml(String(day).padStart(2, '0'))}</strong><span>${escapeHtml(monthLabel)}</span></div>
      <div class="journey-copy">
        <p class="journey-label">Validated itinerary · schema ${escapeHtml(itinerary.schemaVersion)}</p>
        <h3 data-testid="trip-title">${escapeHtml(trip.title)}</h3>
        ${trip.summary ? `<p class="trip-summary">${escapeHtml(trip.summary)}</p>` : ''}
        <dl class="trip-meta">
          <div><dt>Dates</dt><dd data-testid="trip-date-range">${escapeHtml(trip.startDate)} – ${escapeHtml(trip.endDate)}</dd></div>
          <div><dt>Time zone</dt><dd data-testid="trip-time-zone">${escapeHtml(trip.timeZone)}</dd></div>
        </dl>
      </div>
      <span class="card-arrow" aria-hidden="true">→</span>
    </article>`;
}

function routeDayId() {
  return new URL(globalThis.location.href).searchParams.get('day');
}

function routeUrl(dayId) {
  const url = new URL(baseUrl, globalThis.location.origin);
  if (dayId) url.searchParams.set('day', dayId);
  return `${url.pathname}${url.search}`;
}

function dayHeading(day) {
  return day.title || day.date;
}

function renderActivity(activity) {
  return `
    <li class="activity-card" data-testid="activity-item">
      <div class="activity-heading">
        <h4>${escapeHtml(activity.title)}</h4>
        ${activity.category ? `<span class="activity-category">${escapeHtml(activity.category)}</span>` : ''}
      </div>
      <dl class="activity-meta">
        <div><dt>Starts</dt><dd><time datetime="${escapeHtml(activity.startsAt)}">${escapeHtml(activity.startsAt)}</time></dd></div>
        ${activity.endsAt ? `<div><dt>Ends</dt><dd><time datetime="${escapeHtml(activity.endsAt)}">${escapeHtml(activity.endsAt)}</time></dd></div>` : ''}
        ${activity.location ? `<div><dt>Location</dt><dd>${escapeHtml(activity.location)}</dd></div>` : ''}
      </dl>
      ${activity.notes ? `<p class="activity-notes">${escapeHtml(activity.notes)}</p>` : ''}
    </li>`;
}

function renderDayNavigation(days, selectedId) {
  return `
    <nav class="day-navigation" aria-label="Itinerary days">
      <ol>
        ${days.map((day) => `
          <li>
            <a class="day-nav-link${day.id === selectedId ? ' is-selected' : ''}" href="${escapeHtml(routeUrl(day.id))}" data-route-day="${escapeHtml(day.id)}"${day.id === selectedId ? ' aria-current="page"' : ''}>
              <span>${escapeHtml(day.date)}</span>
              ${day.title ? `<strong>${escapeHtml(day.title)}</strong>` : ''}
            </a>
          </li>`).join('')}
      </ol>
    </nav>`;
}

function renderTripOverview(itinerary) {
  const { trip } = itinerary;
  itinerarySectionTitle.textContent = 'Trip overview';
  itineraryPanel.innerHTML = `
    ${tripMetadataMarkup(itinerary)}
    ${trip.days.length ? `
      <section class="itinerary-days" aria-labelledby="itinerary-days-title">
        <div class="days-heading"><p class="eyebrow">In source order</p><h3 id="itinerary-days-title">Itinerary days</h3></div>
        <ol class="day-list">
          ${trip.days.map((day) => `
            <li>
              <a class="day-card" href="${escapeHtml(routeUrl(day.id))}" data-route-day="${escapeHtml(day.id)}">
                <div class="day-card-heading">
                  <time datetime="${escapeHtml(day.date)}">${escapeHtml(day.date)}</time>
                  ${day.title ? `<h4>${escapeHtml(day.title)}</h4>` : ''}
                </div>
                ${day.activities.length ? `<ul class="activity-preview" aria-label="Activities">${day.activities.map((activity) => `<li>${escapeHtml(activity.title)}</li>`).join('')}</ul>` : '<p class="day-empty">No activities planned for this day.</p>'}
                <span class="day-card-action">View day <span aria-hidden="true">→</span></span>
              </a>
            </li>`).join('')}
        </ol>
      </section>` : `
      <article class="state-card state-empty itinerary-empty" data-testid="empty-itinerary">
        <span class="state-symbol" aria-hidden="true">＋</span>
        <div><h3>No itinerary days available</h3><p>This trip does not contain any day plans.</p></div>
      </article>`}`;
  bindRouteLinks();
}

function renderDayDetail(itinerary, day) {
  const { trip } = itinerary;
  const index = trip.days.indexOf(day);
  const previous = trip.days[index - 1];
  const next = trip.days[index + 1];
  itinerarySectionTitle.textContent = 'Day details';
  itineraryPanel.innerHTML = `
    <article class="day-detail" data-testid="day-detail">
      <a class="overview-link" href="${escapeHtml(routeUrl())}" data-route-overview>← Trip overview</a>
      ${renderDayNavigation(trip.days, day.id)}
      <header class="day-detail-heading">
        <p class="eyebrow">Day ${index + 1} of ${trip.days.length}</p>
        <h3 data-testid="selected-day-title">${escapeHtml(dayHeading(day))}</h3>
        <time data-testid="selected-day-date" datetime="${escapeHtml(day.date)}">${escapeHtml(day.date)}</time>
      </header>
      ${day.activities.length ? `<ol class="activity-list">${day.activities.map(renderActivity).join('')}</ol>` : `
        <article class="state-card state-empty day-detail-empty" data-testid="empty-day">
          <span class="state-symbol" aria-hidden="true">＋</span>
          <div><h4>No activities planned</h4><p>No activities planned for this day.</p></div>
        </article>`}
      <nav class="day-pager" aria-label="Adjacent itinerary days">
        ${previous ? `<a href="${escapeHtml(routeUrl(previous.id))}" data-route-day="${escapeHtml(previous.id)}">← ${escapeHtml(dayHeading(previous))}</a>` : '<span></span>'}
        ${next ? `<a href="${escapeHtml(routeUrl(next.id))}" data-route-day="${escapeHtml(next.id)}">${escapeHtml(dayHeading(next))} →</a>` : '<span></span>'}
      </nav>
    </article>`;
  bindRouteLinks();
}

function renderCurrentRoute() {
  if (!currentItinerary) return;
  const selectedDay = currentItinerary.trip.days.find((day) => day.id === routeDayId());
  if (selectedDay) renderDayDetail(currentItinerary, selectedDay);
  else renderTripOverview(currentItinerary);
}

function navigate(dayId) {
  globalThis.history.pushState({ dayId: dayId || null }, '', routeUrl(dayId));
  renderCurrentRoute();
  itinerarySectionTitle.setAttribute('tabindex', '-1');
  itinerarySectionTitle.focus({ preventScroll: true });
}

function bindRouteLinks() {
  for (const link of itineraryPanel.querySelectorAll('[data-route-day]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(event.currentTarget.dataset.routeDay);
    });
  }
  itineraryPanel.querySelector('[data-route-overview]')?.addEventListener('click', (event) => {
    event.preventDefault();
    navigate();
  });
}

function renderItineraryError(error) {
  itineraryPanel.innerHTML = `
    <article class="state-card state-error itinerary-state">
      <span class="state-symbol" aria-hidden="true">!</span>
      <div>
        <h3>Could not load itinerary</h3>
        <p role="alert" data-testid="itinerary-error">${escapeHtml(error.message)}</p>
        <button class="retry-button itinerary-retry" type="button">Try itinerary again</button>
      </div>
    </article>`;
  itineraryPanel.querySelector('.itinerary-retry').addEventListener('click', loadAndRenderItinerary);
}

async function loadAndRenderItinerary() {
  itineraryPanel.innerHTML = `
    <article class="state-card state-loading itinerary-state">
      <span class="spinner" aria-hidden="true"></span>
      <div><h3>Loading itinerary</h3><p role="status">Checking your trip data…</p></div>
    </article>`;
  try {
    currentItinerary = await loadItinerary();
    renderCurrentRoute();
  } catch (error) {
    currentItinerary = undefined;
    renderItineraryError(error);
  }
}

globalThis.addEventListener('popstate', renderCurrentRoute);
loadAndRenderItinerary();
