(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`/travel-app/pr-preview/pr-2/`,t=`${e}favicon.svg`,n={journey:`<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19h14M7 16l3-9h4l3 9M8 13h8"/></svg>`,explore:`<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9 3.9-1.7Z"/></svg>`,saved:`<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 4.5h11v15L12 16l-5.5 3.5v-15Z"/></svg>`};document.querySelector(`#app`).innerHTML=`
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="${e}" aria-label="Return to the welcome page">
        <img src="${t}" width="38" height="38" alt="" />
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
          ${n.explore}<span>Explore inspiration</span>
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
      ${Object.entries(n).map(([e,t],n)=>`<button class="nav-item${n===0?` is-active`:``}" type="button" data-label="${e[0].toUpperCase()}${e.slice(1)}" aria-current="${n===0?`page`:`false`}">${t}<span>${e[0].toUpperCase()}${e.slice(1)}</span></button>`).join(``)}
    </nav>
  </div>
`;var r=[...document.querySelectorAll(`.nav-item`)];function i(e){for(let t of r){let n=t.dataset.label===e;t.classList.toggle(`is-active`,n),t.setAttribute(`aria-current`,n?`page`:`false`)}document.querySelector(`#welcome-title`).textContent=e===`Journey`?`Hello World`:e}for(let e of r)e.addEventListener(`click`,()=>i(e.dataset.label));document.querySelector(`[data-nav-target]`).addEventListener(`click`,e=>i(e.currentTarget.dataset.navTarget)),document.querySelector(`#show-states`).addEventListener(`click`,e=>{let t=document.querySelector(`#state-showcase`),n=e.currentTarget.getAttribute(`aria-expanded`)===`true`;t.hidden=n,e.currentTarget.setAttribute(`aria-expanded`,String(!n)),e.currentTarget.textContent=n?`View app states`:`Hide app states`}),document.querySelector(`.retry-button`).addEventListener(`click`,()=>{let e=document.querySelector(`#error-state`);e.className=`state-card state-recovered`,e.innerHTML=`<span class="state-symbol" aria-hidden="true">✓</span><div><h3>Journeys restored</h3><p role="status">You are back on track.</p></div>`});