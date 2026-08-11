import { loadItinerary } from './itinerary/load.js';

const icons = {
  journey: '<span aria-hidden="true">⌂</span>',
  explore: '<span aria-hidden="true">◇</span>',
  saved: '<span aria-hidden="true">♡</span>',
};

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export function mountLegacyApp(app, { baseUrl }) {
  app.innerHTML = `
    <div class="app-shell legacy-shell">
      <header class="topbar"><a class="brand" href="${baseUrl}" aria-label="Return to the welcome page"><img src="${baseUrl}favicon.svg" width="34" height="34" alt=""><span>Trailbook</span></a></header>
      <main class="main-content" id="main-content">
        <section class="legacy-welcome welcome" aria-labelledby="welcome-title">
          <p class="eyebrow">Your journeys</p><h1 id="welcome-title">Hello World</h1>
          <button class="primary-action" type="button" data-nav-target="Explore">Explore inspiration</button>
        </section>
        <section class="content-section" aria-labelledby="up-next-title">
          <div class="section-heading"><h2 id="up-next-title">Up next</h2><button class="text-button" type="button" id="show-states" aria-expanded="false" aria-controls="state-showcase">View app states</button></div>
          <div id="itinerary-panel" data-testid="primary-content" aria-live="polite">${loadingMarkup()}</div>
          <div class="state-showcase" id="state-showcase" hidden>
            <article class="state-card"><h3>Loading journeys</h3><p role="status">Bringing your plans together…</p></article>
            <article class="state-card"><h3>No journeys yet</h3><p>Your next adventure can start whenever you are ready.</p></article>
            <article class="state-card state-error" id="error-state"><h3>Could not load journeys</h3><p>Check your connection and try again.</p><button class="retry-button" type="button">Try again</button></article>
          </div>
        </section>
      </main>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${Object.entries(icons).map(([name, icon], index) => `<button class="nav-item${index === 0 ? ' is-active' : ''}" type="button" data-label="${name[0].toUpperCase()}${name.slice(1)}" aria-current="${index === 0 ? 'page' : 'false'}">${icon}<span>${name[0].toUpperCase()}${name.slice(1)}</span></button>`).join('')}
      </nav>
    </div>`;

  const panel = app.querySelector('#itinerary-panel');
  const sectionTitle = app.querySelector('#up-next-title');
  let itinerary;

  function routeDayId() { return new URL(globalThis.location.href).searchParams.get('day'); }
  function routeUrl(dayId) {
    const url = new URL(baseUrl, globalThis.location.origin);
    if (dayId) url.searchParams.set('day', dayId);
    return `${url.pathname}${url.search}`;
  }
  function dayHeading(day) { return day.title || day.date; }

  function metadataMarkup() {
    const trip = itinerary.trip;
    return `<article class="journey-card">
      <p>Validated itinerary · schema ${escapeHtml(itinerary.schemaVersion)}</p>
      <h3 data-testid="trip-title">${escapeHtml(trip.title)}</h3>
      ${trip.summary ? `<p class="trip-summary">${escapeHtml(trip.summary)}</p>` : ''}
      <dl><div><dt>Dates</dt><dd data-testid="trip-date-range">${escapeHtml(trip.startDate)} – ${escapeHtml(trip.endDate)}</dd></div><div><dt>Time zone</dt><dd data-testid="trip-time-zone">${escapeHtml(trip.timeZone)}</dd></div></dl>
    </article>`;
  }

  function dayNavigation(days, selectedId) {
    return `<nav class="day-navigation" aria-label="Itinerary days"><ol>${days.map((day) => `<li><a href="${escapeHtml(routeUrl(day.id))}" data-route-day="${escapeHtml(day.id)}"${day.id === selectedId ? ' aria-current="page"' : ''}><span>${escapeHtml(day.date)}</span>${day.title ? `<strong>${escapeHtml(day.title)}</strong>` : ''}</a></li>`).join('')}</ol></nav>`;
  }

  function renderOverview() {
    const { trip } = itinerary;
    sectionTitle.textContent = 'Trip overview';
    panel.innerHTML = `${metadataMarkup()}${trip.days.length ? `<section class="itinerary-days"><h3>Itinerary days</h3><ol class="day-list">${trip.days.map((day) => `<li><a class="day-card" href="${escapeHtml(routeUrl(day.id))}" data-route-day="${escapeHtml(day.id)}"><div><time datetime="${escapeHtml(day.date)}">${escapeHtml(day.date)}</time>${day.title ? `<h4>${escapeHtml(day.title)}</h4>` : ''}</div>${day.activities.length ? `<ul class="activity-preview">${day.activities.map((activity) => `<li>${escapeHtml(activity.title)}</li>`).join('')}</ul>` : '<p>No activities planned for this day.</p>'}</a></li>`).join('')}</ol></section>` : '<article data-testid="empty-itinerary"><h3>No itinerary days available</h3><p>This trip does not contain any day plans.</p></article>'}`;
    bindRoutes();
  }

  function renderDay(day) {
    const { trip } = itinerary;
    panel.innerHTML = `<article class="day-detail"><a href="${escapeHtml(routeUrl())}" data-route-overview>← Trip overview</a>${dayNavigation(trip.days, day.id)}<header><h3 data-testid="selected-day-title">${escapeHtml(dayHeading(day))}</h3><time>${escapeHtml(day.date)}</time></header>${day.activities.length ? `<ol>${day.activities.map((activity) => `<li data-testid="activity-item"><h4>${escapeHtml(activity.title)}</h4><time>${escapeHtml(activity.startsAt)}</time></li>`).join('')}</ol>` : '<article data-testid="empty-day"><h4>No activities planned</h4><p>No activities planned for this day.</p></article>'}</article>`;
    bindRoutes();
  }

  function renderRoute() {
    if (!itinerary) return;
    const day = itinerary.trip.days.find((candidate) => candidate.id === routeDayId());
    if (day) renderDay(day); else renderOverview();
  }
  function navigate(dayId) {
    globalThis.history.pushState({}, '', routeUrl(dayId));
    renderRoute();
  }
  function bindRoutes() {
    panel.querySelectorAll('[data-route-day]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.dataset.routeDay); }));
    panel.querySelector('[data-route-overview]')?.addEventListener('click', (event) => { event.preventDefault(); navigate(); });
  }
  function renderError(error) {
    panel.innerHTML = `<article class="state-card state-error"><h3>Could not load itinerary</h3><p role="alert" data-testid="itinerary-error">${escapeHtml(error.message)}</p><button class="itinerary-retry" type="button">Try itinerary again</button></article>`;
    panel.querySelector('.itinerary-retry').addEventListener('click', load);
  }
  async function load() {
    panel.innerHTML = loadingMarkup();
    try { itinerary = await loadItinerary(); renderRoute(); }
    catch (error) { itinerary = undefined; renderError(error); }
  }

  const navItems = [...app.querySelectorAll('.nav-item')];
  function selectNavigation(label) {
    navItems.forEach((item) => { const active = item.dataset.label === label; item.setAttribute('aria-current', active ? 'page' : 'false'); });
    app.querySelector('#welcome-title').textContent = label === 'Journey' ? 'Hello World' : label;
  }
  navItems.forEach((item) => item.addEventListener('click', () => selectNavigation(item.dataset.label)));
  app.querySelector('[data-nav-target]').addEventListener('click', () => selectNavigation('Explore'));
  app.querySelector('#show-states').addEventListener('click', (event) => {
    const showcase = app.querySelector('#state-showcase'); const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
    showcase.hidden = expanded; event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  });
  app.querySelector('.retry-button').addEventListener('click', () => { app.querySelector('#error-state').outerHTML = '<article class="state-card"><h3>Journeys restored</h3><p>You are back on track.</p></article>'; });
  globalThis.addEventListener('popstate', renderRoute);
  load();
}

function loadingMarkup() { return '<article class="state-card"><h3>Loading itinerary</h3><p role="status">Checking your trip data…</p></article>'; }
