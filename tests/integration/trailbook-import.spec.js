import { expect, test } from '@playwright/test';

const MIME = 'application/vnd.trailbook.itinerary+json';
const fixture = (overrides = {}) => ({
  schemaVersion: '1.0.0',
  trip: {
    id: 'shared-sprint-four', title: 'Northern Japan rail journey', summary: 'A realistic shared itinerary with enough detail to review safely.',
    startDate: '2026-11-03', endDate: '2026-11-05', timeZone: 'Asia/Tokyo', countryCode: 'JP',
    days: [
      { id: 'arrival-day-stable', date: '2026-11-03', title: 'Arrival in Sendai', activities: [
        { id: 'train-stop-stable', title: 'Take the Hayabusa north', startsAt: '2026-11-03T09:00:00+09:00', notes: 'Car 6, window seat.' },
      ] },
      { id: 'open-day-stable', date: '2026-11-04', title: 'Matsushima coast', activities: [] },
    ],
    ...overrides,
  },
});

async function ensureControlled(page) {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function postShare(page, documents, { extra = false, manualRedirect = false } = {}) {
  const target = await page.evaluate(async ({ documents: files, extraField, keepRedirectManual }) => {
    const form = new FormData();
    for (const document of files) form.append('itinerary', new File([document.text], document.name, { type: document.type }));
    if (extraField) form.append('unexpected', 'blocked');
    const response = await fetch(new URL('share-target', document.baseURI), { method: 'POST', body: form, redirect: keepRedirectManual ? 'manual' : 'follow' });
    if (keepRedirectManual) {
      const request = indexedDB.open('trailbook-share-target', 2);
      const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const transaction = database.transaction('pending', 'readonly');
      const all = transaction.objectStore('pending').getAll();
      const records = await new Promise((resolve, reject) => { all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); });
      database.close();
      const pending = records.at(-1);
      return new URL(`?share-target=confirm&id=${encodeURIComponent(pending.id)}`, document.baseURI).href;
    }
    return response.url;
  }, { documents, extraField: extra, keepRedirectManual: manualRedirect });
  await page.goto(target);
}

async function pendingCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('trailbook-share-target', 2);
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('pending', 'readonly');
    const countRequest = transaction.objectStore('pending').count();
    const count = await new Promise((resolve, reject) => { countRequest.onsuccess = () => resolve(countRequest.result); countRequest.onerror = () => reject(countRequest.error); });
    database.close();
    return count;
  });
}

async function pickTrailbook(page, value) {
  await page.locator('#trip-import').setInputFiles({
    name: 'northern-japan.trailbook', mimeType: MIME, buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByTestId('share-import-preview')).toBeVisible();
}

test('TA-TRAVEL-95-01 @pr @post-deploy receives one Android .trailbook delivery and never auto-imports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Installed Android PWA share-target profile.');
  await ensureControlled(page);
  const manifest = await page.evaluate(async () => (await fetch(new URL('manifest.webmanifest', document.baseURI))).json());
  expect(manifest.share_target).toMatchObject({ action: './share-target', method: 'POST', enctype: 'multipart/form-data' });
  expect(manifest.share_target.params.files[0].accept).toContain(MIME);

  const shared = { name: 'northern-japan.trailbook', type: MIME, text: JSON.stringify(fixture()) };
  await postShare(page, [shared]);
  await expect(page.getByTestId('share-import-preview')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review before importing' })).toBeVisible();
  await expect(page.getByTestId('share-import-trip-id')).toHaveText('shared-sprint-four');
  await expect(page.locator('[data-trip-id="shared-sprint-four"]')).toHaveCount(0);
  expect(await pendingCount(page)).toBe(1);

  const retryUrl = await page.evaluate(async ({ text, type }) => {
    const form = new FormData();
    form.append('itinerary', new File([text], 'northern-japan.trailbook', { type }));
    return (await fetch(new URL('share-target', document.baseURI), { method: 'POST', body: form })).url;
  }, shared);
  expect(new URL(retryUrl).searchParams.get('id')).toBe(new URL(page.url()).searchParams.get('id'));
  expect(await pendingCount(page)).toBe(1);
});

test('TA-TRAVEL-95-02 @pr validates, confirms, and resolves cancel, replace, and safe duplicate conflicts', async ({ page }) => {
  await page.goto('./');
  await pickTrailbook(page, fixture());
  await expect(page.getByText('Not imported')).toBeVisible();
  await page.getByRole('button', { name: 'Import and open trip' }).click();
  await expect(page.getByRole('heading', { name: 'Northern Japan rail journey' })).toBeVisible();

  await page.goto('./');
  await pickTrailbook(page, fixture({ title: 'Cancelled replacement' }));
  await expect(page.getByRole('group', { name: /already exists/i })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with selection' }).click();
  await expect(page.locator('[data-trip-id="shared-sprint-four"]')).toContainText('Northern Japan rail journey');
  expect(await pendingCount(page)).toBe(0);

  await pickTrailbook(page, fixture({ title: 'Updated northern Japan journey' }));
  await page.getByLabel('Replace all saved revisions with this itinerary').check();
  await page.getByRole('button', { name: 'Continue with selection' }).click();
  await expect(page.getByRole('heading', { name: 'Updated northern Japan journey' })).toBeVisible();

  await page.goto('./');
  await pickTrailbook(page, fixture({ title: 'Separate northern Japan copy' }));
  await page.getByLabel('Keep both with a new local trip ID').check();
  await page.getByRole('button', { name: 'Continue with selection' }).click();
  await expect(page.getByRole('heading', { name: 'Separate northern Japan copy' })).toBeVisible();
  const duplicateState = await page.evaluate(async () => {
    const request = indexedDB.open('travel-app', 1);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('trips', 'readonly');
    const all = tx.objectStore('trips').getAll();
    const records = await new Promise((resolve, reject) => { all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); });
    db.close();
    const copy = records.map(({ value }) => value).find((value) => value.trip?.title === 'Separate northern Japan copy');
    return { id: copy.trip.id, dayId: copy.trip.days[0].id, activityId: copy.trip.days[0].items[0].id };
  });
  expect(duplicateState.id).toMatch(/^shared-sprint-four-copy-/);
  expect(duplicateState).toMatchObject({ dayId: 'arrival-day-stable', activityId: 'train-stop-stable' });
});

test('TA-TRAVEL-95-03 @pr @post-deploy receives and confirms offline under the repository base path', async ({ page, context }) => {
  await ensureControlled(page);
  const deploymentBasePath = await page.evaluate(() => new URL('.', document.baseURI).pathname);
  const manifest = await page.evaluate(async () => (await fetch(new URL('manifest.webmanifest', document.baseURI))).json());
  expect(manifest.share_target.action).toBe('./share-target');
  expect(new URL(manifest.share_target.action, page.url()).pathname).toBe(`${deploymentBasePath}share-target`);
  await context.setOffline(true);
  await postShare(page, [{ name: 'offline.trailbook', type: MIME, text: JSON.stringify(fixture({ id: 'offline-shared-trip', title: 'Offline shared trip' })) }], { manualRedirect: true });
  await expect(page.getByTestId('share-import-preview')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(deploymentBasePath);
  await page.getByRole('button', { name: 'Import and open trip' }).click();
  await expect(page.getByRole('heading', { name: 'Offline shared trip' })).toBeVisible();
  expect(new URL(page.url()).hash).toContain('/trip/offline-shared-trip/v/1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  expect(await pendingCount(page)).toBe(0);
  await context.setOffline(false);
});

test('TA-TRAVEL-95-04 @pr rejects unsafe, unsupported, spoofed, multiple, and malicious files without mutation', async ({ page }) => {
  await ensureControlled(page);
  const baseline = await page.locator('.trip-card').count();
  const unsupported = fixture(); unsupported.schemaVersion = '2.0.0';
  const unsafeDeliveries = [
    [{ name: '../escape.trailbook', type: MIME, text: JSON.stringify(fixture()) }],
    [{ name: 'spoofed.trailbook', type: 'text/html', text: '<script>alert(1)</script>' }],
    [{ name: 'not-itinerary.txt', type: 'application/octet-stream', text: JSON.stringify(fixture()) }],
    [{ name: 'malformed.trailbook', type: MIME, text: '{bad json' }],
    [{ name: 'unsupported.trailbook', type: MIME, text: JSON.stringify(unsupported) }],
    [{ name: 'oversized.trailbook', type: MIME, text: 'x'.repeat((2 * 1024 * 1024) + 1) }],
  ];
  for (const files of unsafeDeliveries) {
    await postShare(page, files);
    await expect(page.getByTestId('share-import-error')).toBeVisible();
    await page.getByRole('button', { name: 'Back to trips' }).click();
  }
  await postShare(page, [
    { name: 'one.trailbook', type: MIME, text: JSON.stringify(fixture()) },
    { name: 'two.trailbook', type: MIME, text: JSON.stringify(fixture({ id: 'two' })) },
  ]);
  await expect(page.getByTestId('share-import-error')).toContainText('exactly one');
  await page.getByRole('button', { name: 'Back to trips' }).click();
  await postShare(page, [{ name: 'one.trailbook', type: MIME, text: JSON.stringify(fixture()) }], { extra: true });
  await expect(page.getByTestId('share-import-error')).toContainText('Extra files and fields');
  await page.getByRole('button', { name: 'Back to trips' }).click();

  const malicious = fixture(); malicious.trip.summary = '<script>window.importExecuted = true</script>';
  await postShare(page, [{ name: 'active.trailbook', type: MIME, text: JSON.stringify(malicious) }]);
  await expect(page.getByTestId('share-import-error')).toContainText('active content');
  expect(await page.evaluate(() => window.importExecuted)).toBeUndefined();
  expect(await page.locator('.trip-card').count()).toBe(baseline);
  expect(await pendingCount(page)).toBe(0);
});
