import { expect, test } from '@playwright/test';

const fixture = {
  schemaVersion: '1.0.0',
  trip: {
    id: 'portable-kyoto', title: 'Kyoto / Autumn: 2026', summary: 'A realistic portable trip.',
    startDate: '2026-10-01', endDate: '2026-10-02', timeZone: 'Asia/Tokyo',
    days: [
      { id: 'arrival-stable', date: '2026-10-01', title: 'Arrival', activities: [
        { id: 'temple-stable', title: 'Temple visit', startsAt: '2026-10-01T09:00:00+09:00', notes: 'Preserve this user-authored note.' },
      ] },
      { id: 'open-day-stable', date: '2026-10-02', activities: [] },
    ],
  },
};

async function importFixture(page) {
  await page.goto('./');
  await page.locator('#trip-import').setInputFiles({
    name: 'kyoto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('heading', { name: fixture.trip.title })).toBeVisible();
}

async function captureNativeShare(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files?.length === 1 });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
      const [file] = files;
      window.trailbookShared = { name: file.name, type: file.type, text: await file.text() };
    } });
  });
  await page.getByRole('button', { name: 'Export portable Trailbook file' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.trailbookShared))).toBeTruthy();
  return page.evaluate(() => window.trailbookShared);
}

test('TA-TRAVEL-94-01 @pr @post-deploy exports one schema-valid portable itinerary with stable IDs', async ({ page }) => {
  await importFixture(page);
  const exportButton = page.getByRole('button', { name: 'Export portable Trailbook file' });
  await expect(exportButton).toHaveCount(1);
  await expect(exportButton).toHaveAttribute('title', 'Export portable Trailbook file');
  await expect(page.locator('.hero').getByRole('button', { name: 'Export portable Trailbook file' })).toBeVisible();
  await expect(page.locator('.trailbook-export')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Itinerary days' })).toHaveCount(0);
  const compactTarget = await exportButton.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(compactTarget.width).toBeGreaterThanOrEqual(44);
  expect(compactTarget.width).toBeLessThanOrEqual(52);
  expect(compactTarget.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Share this trip' }).press('Tab');
  await expect(exportButton).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise((resolve) => { window.finishTrailbookShare = resolve; }) });
  });
  await exportButton.click();
  await expect(exportButton).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#trailbook-export-status')).toHaveAttribute('data-state', 'busy');
  await page.evaluate(() => window.finishTrailbookShare());
  await expect(exportButton).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#trailbook-export-status')).toHaveAttribute('data-state', 'success');
  const shared = await captureNativeShare(page);
  expect(shared.name).toBe('Kyoto-Autumn-2026.trailbook');
  expect(shared.type).toBe('application/vnd.trailbook.itinerary+json');
  expect(JSON.parse(shared.text)).toEqual(fixture);
  expect(JSON.parse(shared.text).trip.days.map(({ id }) => id)).toEqual(['arrival-stable', 'open-day-stable']);
  expect(JSON.parse(shared.text).trip.days[0].activities[0].id).toBe('temple-stable');

  await page.goto('./');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-trip-id="portable-kyoto"]').getByRole('button', { name: 'Remove saved trip' }).click();
  await expect(page.locator('[data-trip-id="portable-kyoto"]')).toHaveCount(0);
  await page.locator('#trip-import').setInputFiles({
    name: shared.name, mimeType: shared.type, buffer: Buffer.from(shared.text),
  });
  await expect(page.getByRole('heading', { name: fixture.trip.title })).toBeVisible();
  await page.locator('.overview-day-card').filter({ hasText: 'Arrival' }).click();
  await expect(page.getByRole('navigation', { name: 'Itinerary days' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export portable Trailbook file' })).toHaveCount(0);
  await expect(page.getByText('Preserve this user-authored note.')).toBeAttached();
});

test('TA-TRAVEL-94-02 @pr @post-deploy uses Android file sharing and always retains a download fallback offline', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android file-sharing and installed-PWA profile.');
  await importFixture(page);
  const shared = await captureNativeShare(page);
  expect(JSON.parse(shared.text).trip.id).toBe('portable-kyoto');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('cancelled', 'AbortError'); } });
  });
  const cancelledDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portable Trailbook file' }).click();
  expect((await cancelledDownload).suggestedFilename()).toBe('Kyoto-Autumn-2026.trailbook');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  const unsupportedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portable Trailbook file' }).click();
  expect((await unsupportedDownload).suggestedFilename()).toBe('Kyoto-Autumn-2026.trailbook');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: fixture.trip.title })).toBeVisible();
  const offlineDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portable Trailbook file' }).click();
  expect((await offlineDownload).suggestedFilename()).toBe('Kyoto-Autumn-2026.trailbook');
  await context.setOffline(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test('TA-TRAVEL-94-03 @pr excludes private local state, makes no request, and blocks invalid documents', async ({ page, context }) => {
  await importFixture(page);
  const panel = page.locator('[data-attachment-scope="portable-kyoto:trip:portable-kyoto"]');
  await panel.locator('input').setInputFiles({ name: 'private-ticket.txt', mimeType: 'text/plain', buffer: Buffer.from('SECRET-ATTACHMENT-BYTES') });
  await page.evaluate(async () => {
    localStorage.setItem('trailbook:credentials', 'SECRET-BROWSER-TOKEN');
    const cache = await caches.open('trailbook-stop-images-v1');
    await cache.put(new Request('https://images.example.test/private-cached-stop.jpg'), new Response('SECRET-CACHED-IMAGE'));
  });
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const before = requests.length;
  const shared = await captureNativeShare(page);
  const exportRequests = requests.slice(before);
  expect(exportRequests).toEqual([]);
  expect(shared.text).not.toContain('private-ticket');
  expect(shared.text).not.toContain('SECRET-ATTACHMENT-BYTES');
  expect(shared.text).not.toContain('private-cached-stop');
  expect(shared.text).not.toContain('SECRET-BROWSER-TOKEN');
  expect(shared.text).not.toMatch(/[A-Z]:\\|file:\/\//);

  const invalid = structuredClone(fixture);
  invalid.trip.days[0].activities[0].id = '';
  invalid.trip.localPath = 'C:\\private\\trip.json';
  await page.evaluate(async (trip) => {
    const request = indexedDB.open('travel-app', 1);
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('trips', 'readwrite');
    transaction.objectStore('trips').put({ id: 'invalid-export@1', value: { ...trip, trip: { ...trip.trip, id: 'invalid-export' } }, updatedAt: new Date().toISOString() });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
  }, invalid);
  await context.route('**/data/itineraries/invalid-export/v1.json', (route) => route.abort());
  await page.goto('./#/trip/invalid-export/v/1');
  await page.getByRole('button', { name: 'Export portable Trailbook file' }).click();
  const exportError = page.getByRole('alert');
  await expect(exportError).toContainText(/cannot be exported.*invalid.*\/trip\/localPath/i);
  await expect(exportError).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Export portable Trailbook file' })).toBeEnabled();
});
