import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

function onlyProject(testInfo, project) {
  test.skip(testInfo.project.name !== project, `${project} release-quality coverage`);
}

const importedTrip = {
  schemaVersion: '1.0.0',
  trip: {
    id: 'android-release-check', title: 'Android release check', startDate: '2026-08-14', endDate: '2026-08-14', timeZone: 'Europe/Berlin',
    days: [{ id: 'walk', date: '2026-08-14', title: 'Accessible city walk', activities: [{ id: 'museum', title: 'Museum Island', startsAt: '2026-08-14T10:00:00+02:00' }] }],
  },
};

test('TA-TRAVEL-12-01 @pr applies a new service-worker version as one consistent release', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  let updateNavigationRequests = 0;
  const brokenAssets = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.url().includes('trailbook-update=')) updateNavigationRequests += 1;
  });
  page.on('response', (response) => {
    if (response.url().includes('/assets/') && !response.ok()) brokenAssets.push(response.url());
  });
  await context.route('**/release-upgrade.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Release upgrade</title><script>window.legacyReady=(async()=>{const registration=await navigator.serviceWorker.register("./release-legacy-sw.js",{scope:"./"});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));return registration.active.scriptURL})()</script>',
  }));
  await context.route('**/release-legacy-sw.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    headers: { 'Cache-Control': 'no-store' },
    body: 'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));',
  }));
  await page.goto('./release-upgrade.html');
  await expect.poll(() => page.evaluate(() => window.legacyReady)).toContain('release-legacy-sw.js');
  await page.evaluate(async () => {
    const runtime = await caches.open('trailbook-runtime-obsolete-v0');
    await runtime.put('./obsolete-app.js', new Response('obsolete application asset'));
    const data = await caches.open('trailbook-data-obsolete-v0');
    await data.put('./data/itineraries/obsolete.json', new Response('{"schemaVersion":0}'));
  });
  await context.unroute('**/release-legacy-sw.js');
  await context.unroute('**/release-upgrade.html');

  await page.goto('./#/trip/weekend-lisbon/v/1/day/river-day');
  const activeDay = page.getByRole('heading', { name: /river$/i });
  await expect(activeDay).toBeVisible();
  const mapsButton = page.getByRole('button', { name: 'Day Overview' });
  await mapsButton.focus();
  const prompt = page.getByRole('complementary', { name: 'Trailbook update ready' });
  await expect(prompt).toBeVisible();
  await expect(activeDay).toBeVisible();
  await expect(mapsButton).toBeFocused();
  expect(await page.evaluate(() => caches.has('trailbook-runtime-obsolete-v0'))).toBeTruthy();

  await page.getByRole('button', { name: 'Update now' }).click({ noWaitAfter: true });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('service-worker.js');
  await expect.poll(() => updateNavigationRequests).toBeGreaterThan(0);
  await page.goto('./#/trip/weekend-lisbon/v/1/day/river-day');
  await expect(activeDay).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((name) => name.includes('obsolete-v0')))).toBeFalsy();
  const release = await page.evaluate(async () => ({
    caches: await caches.keys(),
    scripts: [...document.scripts].map(({ src }) => src).filter(Boolean),
    marker: new URL(location.href).searchParams.has('trailbook-update'),
  }));
  expect(release.caches.some((name) => name.includes('obsolete-v0'))).toBeFalsy();
  expect(release.scripts.length).toBeGreaterThan(0);
  expect(release.scripts.every((url) => new URL(url).pathname.includes('/assets/'))).toBeTruthy();
  expect(release.marker).toBeFalsy();
  expect(brokenAssets).toEqual([]);
});

test('TA-TRAVEL-12-02 @pr @post-deploy completes the critical Android regression journey offline', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await page.locator('[data-trip-id="weekend-lisbon"]').getByRole('link', { name: 'Open trip overview' }).click();
  await page.locator('.overview-day-card').filter({ has: page.getByRole('heading', { name: /river$/i }) }).click();
  await expect(page.getByRole('heading', { name: /river$/i })).toBeVisible();
  const mapLink = page.getByRole('link', { name: /Google Maps/i }).first();
  await expect(mapLink).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\//);
  await page.getByRole('button', { name: 'Day Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Day Overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Trip' }).click();
  await expect(page.getByRole('heading', { name: /river$/i })).toBeVisible();

  await page.locator('#trip-import').setInputFiles({
    name: 'android-release-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importedTrip)),
  });
  await expect(page.getByRole('heading', { name: 'Android release check' })).toBeVisible();
  await page.getByTestId('trip-overview').getByRole('link', { name: /Accessible city walk/ }).click();
  await expect(page.getByRole('heading', { name: 'Accessible city walk' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Accessible city walk' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await context.setOffline(false);
  expect(pageErrors).toEqual([]);
});

test('TA-TRAVEL-12-03 @pr has no critical accessibility or PWA audit violations', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/trip/weekend-lisbon/v/1/day/arrival');
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();

  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = audit.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  expect(blocking, blocking.map(({ id, help }) => `${id}: ${help}`).join('\n')).toEqual([]);

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
    return { tag: element?.tagName, outline: style?.outlineStyle, width: style?.outlineWidth };
  });
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
  expect(focus.width).not.toBe('0px');
  const reducedMotion = await page.locator('.menu-backdrop').evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(reducedMotion)).toBeLessThanOrEqual(0.00001);

  const pwa = await page.evaluate(async () => {
    const manifestUrl = document.querySelector('link[rel="manifest"]')?.href;
    const manifest = manifestUrl ? await fetch(manifestUrl).then((response) => response.json()) : null;
    const registration = await navigator.serviceWorker.ready;
    return { manifest, worker: registration.active?.scriptURL };
  });
  expect(pwa.manifest?.name).toBeTruthy();
  expect(pwa.manifest?.start_url).toBe('./');
  expect(pwa.manifest?.icons?.some(({ sizes }) => sizes === '192x192')).toBeTruthy();
  expect(pwa.manifest?.icons?.some(({ sizes }) => sizes === '512x512')).toBeTruthy();
  expect(pwa.worker).toContain('service-worker.js');
  expect(pageErrors).toEqual([]);
});
