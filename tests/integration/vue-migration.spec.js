import { expect, test } from '@playwright/test';

test('TA-TRAVEL-121-01 @pr @post-deploy resolves the Vue PWA beneath its repository subpath', async ({ page }) => {
  const responses = [];
  page.on('response', (response) => responses.push(response));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  const result = await page.evaluate(async () => ({
    manifest: document.querySelector('link[rel="manifest"]').href,
    serviceWorker: (await navigator.serviceWorker.ready).active?.scriptURL,
    vue: Boolean(document.querySelector('#app')?.__vue_app__),
  }));
  expect(result.vue).toBeTruthy();
  expect(new URL(result.manifest).pathname).toContain('/travel-app/');
  expect(new URL(result.serviceWorker).pathname).toContain('/travel-app/');
  expect(responses.filter((response) => response.url().includes('/travel-app/')).every((response) => response.ok())).toBeTruthy();
});

test('TA-TRAVEL-121-02 @pr preserves schema-v1 import, persistence, export, and attachment privacy', async ({ page }) => {
  await page.goto('./');
  const fixture = { schemaVersion: '1.0.0', trip: { id: 'migration-check', title: 'Migration check', startDate: '2026-08-14', endDate: '2026-08-14', timeZone: 'Europe/Berlin', days: [] } };
  await page.locator('#trip-import').setInputFiles({ name: 'migration.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('heading', { name: 'Migration check' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Migration check' })).toBeVisible();
  await expect(page.getByText(/stay in this browser profile/i)).toBeAttached();
  const schema = await page.request.get('./data/schemas/itinerary.v1.schema.json');
  expect((await schema.json()).properties.schemaVersion.const).toBe('1.0.0');
});

test('TA-TRAVEL-121-03 @post-deploy supports upgrade-safe offline deep links and confirmed file sharing', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android PWA contract');
  let updateNavigationRequests = 0;
  const failedAssets = [];
  page.on('request', (request) => { if (request.isNavigationRequest() && request.url().includes('trailbook-update=')) updateNavigationRequests += 1; });
  page.on('response', (response) => { if (response.url().includes('/assets/') && !response.ok()) failedAssets.push(response.url()); });
  await context.route('**/upgrade-harness.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Upgrade harness</title><script>window.legacyReady=(async()=>{const registration=await navigator.serviceWorker.register("./legacy-sw.js",{scope:"./"});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));return registration.active.scriptURL})()</script>',
  }));
  await context.route('**/legacy-sw.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    headers: { 'Cache-Control': 'no-store' },
    body: 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));',
  }));
  const legacyTrip = {
    schemaVersion: 1, id: 'legacy-trip', revision: 1, title: 'Pre-migration trail',
    destination: 'Kyoto, Japan', dateRange: '14 August 2026',
    days: [{ id: 'legacy-day', date: 'Friday · 14 August', title: 'Preserved legacy day', activities: [] }],
  };
  await page.goto('./upgrade-harness.html');
  await expect.poll(() => page.evaluate(() => window.legacyReady)).toContain('legacy-sw.js');
  await page.evaluate(async (trip) => {
    localStorage.setItem('trailbook.theme', 'neon-japan');
    const open = (name, version, upgrade) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const save = (database, store, value) => new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    const trips = await open('travel-app', 1, (database) => database.createObjectStore('trips', { keyPath: 'id' }));
    await save(trips, 'trips', { id: 'legacy-trip@1', value: trip, updatedAt: new Date().toISOString() });
    trips.close();
    const attachments = await open('trailbook-local-attachments', 1, (database) => {
      const store = database.createObjectStore('attachments', { keyPath: 'id' });
      store.createIndex('contextKey', 'contextKey'); store.createIndex('tripId', 'tripId');
    });
    await save(attachments, 'attachments', {
      id: 'legacy-device-file', contextKey: 'legacy-trip:day:legacy-day', tripId: 'legacy-trip',
      scopeType: 'day', ownerId: 'legacy-day', name: 'legacy-ticket.txt', label: 'Legacy ticket',
      type: 'text/plain', kind: 'generic', size: 6, lastModified: 0,
      addedAt: '2026-08-14T00:00:00.000Z', blob: new Blob(['ticket'], { type: 'text/plain' }),
    });
    attachments.close();
    const cache = await caches.open('trailbook-runtime-legacy-v0');
    await cache.put(new URL('./legacy-cache-marker', location.href), new Response('legacy-cache-intact'));
  }, legacyTrip);
  await context.unroute('**/legacy-sw.js');
  await context.unroute('**/upgrade-harness.html');
  await page.goto('./#/trip/legacy-trip/v/1/day/legacy-day');
  await expect(page.getByRole('heading', { name: 'Preserved legacy day' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
  await expect(page.locator('.attachment-name')).toHaveText('legacy-ticket.txt');
  expect(failedAssets).toEqual([]);
  const prompt = page.getByRole('complementary', { name: 'Trailbook update ready' });
  await expect(prompt).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();
  const postponed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      controller: navigator.serviceWorker.controller?.scriptURL,
      waiting: registration?.waiting?.scriptURL,
      cache: await (await caches.match(new URL('./legacy-cache-marker', location.href)))?.text(),
    };
  });
  expect(postponed.controller).toContain('legacy-sw.js');
  expect(postponed.waiting).toContain('service-worker.js');
  expect(postponed.cache).toBe('legacy-cache-intact');
  await page.reload();
  await expect(prompt).toBeVisible();
  const resumed = await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); return { controller: navigator.serviceWorker.controller?.scriptURL, waiting: registration?.waiting?.scriptURL }; });
  expect(resumed.controller).toContain('legacy-sw.js');
  expect(resumed.waiting).toContain('service-worker.js');
  await page.getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('service-worker.js');
  await expect.poll(() => updateNavigationRequests).toBeGreaterThan(0);
  await page.goto('./#/trip/legacy-trip/v/1/day/legacy-day');
  await expect(page.getByRole('heading', { name: 'Preserved legacy day' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
  await expect(page.locator('.attachment-name')).toHaveText('legacy-ticket.txt');
  expect(failedAssets).toEqual([]);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active?.state === 'activated') return;
    await new Promise((resolve) => registration.active?.addEventListener('statechange', resolve, { once: true }));
  });
  await page.close();
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto('./#/trip/legacy-trip/v/1/day/legacy-day');
  await expect(page.getByRole('heading', { name: 'Preserved legacy day' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
  await expect(page.locator('.attachment-name')).toHaveText('legacy-ticket.txt');
  await context.setOffline(false);
  const manifest = await (await page.request.get('./manifest.webmanifest')).json();
  expect(manifest.share_target.method).toBe('POST');
  expect(manifest.share_target.action).toBe('./share-target');
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const confirmationUrl = await page.evaluate(async () => {
    const itinerary = { schemaVersion: '1.0.0', trip: { id: 'shared-migration-check', title: 'Shared migration check', startDate: '2026-08-14', endDate: '2026-08-14', timeZone: 'Europe/Berlin', days: [] } };
    const data = new FormData();
    data.set('itinerary', new File([JSON.stringify(itinerary)], 'shared.trailbook', { type: 'application/vnd.trailbook.itinerary+json' }));
    return (await fetch('./share-target', { method: 'POST', body: data })).url;
  });
  await page.goto(confirmationUrl);
  await expect(page.getByRole('heading', { name: 'Review before importing' })).toBeVisible();
  await expect(page.locator('[data-trip-id="shared-migration-check"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(page.getByRole('heading', { name: 'Pre-migration trail' })).toBeVisible();
  await expect(page.locator('[data-trip-id="shared-migration-check"]')).toHaveCount(0);
  await page.goto('./#/trip/legacy-trip/v/1/day/legacy-day');
  await expect(page.locator('.attachment-name')).toHaveText('legacy-ticket.txt');
});

test('TA-TRAVEL-121-04 @pr @post-deploy preserves responsive themes and lazy heavy features', async ({ page }) => {
  const scripts = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./#/trip/weekend-lisbon/v/1/day/arrival');
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
  expect(scripts.some((url) => /MapFeature|GlobeFallback/.test(url))).toBeFalsy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Map-Route' }).click();
  await expect(page.getByRole('heading', { name: 'Map-Route' })).toBeVisible();
  await expect.poll(() => scripts.some((url) => /MapFeature/.test(url))).toBeTruthy();
  expect(scripts.some((url) => /GlobeFallback/.test(url))).toBeFalsy();
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await page.locator('#theme-selector').selectOption('neon-japan');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
});
