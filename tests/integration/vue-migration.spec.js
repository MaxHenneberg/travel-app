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
  await page.goto('./#/trip/weekend-lisbon/v/1/day/arrival');
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
  await context.setOffline(false);
  const manifest = await (await page.request.get('./manifest.webmanifest')).json();
  expect(manifest.share_target.method).toBe('POST');
  expect(manifest.share_target.action).toContain('share-target=itinerary');
});

test('TA-TRAVEL-121-04 @pr @post-deploy preserves responsive themes and lazy heavy features', async ({ page }) => {
  const scripts = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./#/trip/weekend-lisbon/v/1/day/arrival');
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
  expect(scripts.some((url) => /MapFeature|GlobeFallback/.test(url))).toBeFalsy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await page.locator('#theme-selector').selectOption('neon-japan');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
});
