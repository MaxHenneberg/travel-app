import './style.css';

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

        <article class="journey-card" data-testid="primary-content">
          <div class="date-tile" aria-hidden="true"><strong>18</strong><span>SEP</span></div>
          <div class="journey-copy">
            <p class="journey-label">Sample journey</p>
            <h3>City break</h3>
            <p>3 days · Your plans, available at a glance</p>
          </div>
          <span class="card-arrow" aria-hidden="true">→</span>
        </article>

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
