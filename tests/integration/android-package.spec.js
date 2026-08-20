import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const MIME = 'application/vnd.trailbook.itinerary+json';
const fixture = (overrides = {}) => ({
  schemaVersion: '1.0.0',
  trip: {
    id: 'android-open-trip', title: 'Android direct-open journey', summary: 'Opened from an Android content provider and reviewed locally.',
    startDate: '2026-12-01', endDate: '2026-12-02', timeZone: 'Asia/Tokyo', countryCode: 'JP',
    days: [{ id: 'android-day', date: '2026-12-01', title: 'Tokyo arrival', activities: [] }],
    ...overrides,
  },
});

const payload = (value = fixture(), type = MIME, name = 'android-journey.trailbook') => ({
  kind: 'file', name, type, base64: Buffer.from(JSON.stringify(value)).toString('base64'),
});

async function receive(page, delivery) {
  await page.waitForFunction(() => typeof window.trailbookReceiveAndroidOpen === 'function');
  await page.evaluate((value) => window.trailbookReceiveAndroidOpen(value), delivery);
}

async function pendingCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('trailbook-share-target', 2);
    const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction('pending', 'readonly');
    const count = transaction.objectStore('pending').count();
    const result = await new Promise((resolve, reject) => { count.onsuccess = () => resolve(count.result); count.onerror = () => reject(count.error); });
    database.close();
    return result;
  });
}

test('TA-TRAVEL-96-01 @pr queues cold and warm ACTION_VIEW deliveries in the shared confirmation flow', async ({ page }) => {
  const first = payload();
  await page.addInitScript((delivery) => { window.__trailbookAndroidOpenQueue = [delivery]; }, first);
  await page.goto('./');
  await expect(page.getByTestId('share-import-preview')).toBeVisible();
  await expect(page.getByText('Secure local import · Android file open')).toBeVisible();
  await expect(page.getByTestId('share-import-trip-id')).toHaveText('android-open-trip');
  await expect(page.locator('[data-trip-id="android-open-trip"]')).toHaveCount(0);
  await receive(page, first);
  await expect.poll(() => pendingCount(page)).toBe(1);
  await receive(page, payload(fixture({ id: 'newest-android-open', title: 'Newest queued Android journey' })));
  await expect(page.getByTestId('share-import-trip-id')).toHaveText('newest-android-open');
  await expect.poll(() => pendingCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Import and open trip' }).click();
  await expect(page.getByRole('heading', { name: 'Newest queued Android journey' })).toBeVisible();

  await receive(page, payload(fixture({ id: 'newest-android-open', title: 'Warm delivery asks before replacement' })));
  await expect(page.getByRole('group', { name: /already exists/i })).toBeVisible();
  await expect(page.getByLabel('Cancel and keep the saved trip')).toBeChecked();
  await page.getByRole('button', { name: 'Continue with selection' }).click();
  await expect(page.getByRole('heading', { name: 'Newest queued Android journey' })).toBeVisible();
});

test('TA-TRAVEL-96-02 @pr rejects native errors, spoofed types, and active content without mutation', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Trip collection' })).toBeVisible();
  const baseline = await page.locator('.trip-card').count();
  await receive(page, { kind: 'error', code: 'file_too_large' });
  await expect(page.getByTestId('share-import-error')).toContainText('file-size limit');
  await page.getByRole('button', { name: 'Back to trips' }).click();

  await receive(page, payload(fixture(), 'text/html'));
  await expect(page.getByTestId('share-import-error')).toContainText(/file type does not match/i);
  await page.getByRole('button', { name: 'Back to trips' }).click();

  const active = fixture();
  active.trip.summary = '<script>window.androidIntentExecuted = true</script>';
  await receive(page, payload(active));
  await expect(page.getByTestId('share-import-error')).toContainText('active content');
  expect(await page.evaluate(() => window.androidIntentExecuted)).toBeUndefined();
  expect(await page.locator('.trip-card').count()).toBe(baseline);
});

test('TA-TRAVEL-96-03 @pr keeps Android association targeted and Pages deployment independent', async () => {
  const manifest = await readFile(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../.github/workflows/android-package.yml', import.meta.url), 'utf8');
  const pages = await readFile(new URL('../../.github/workflows/pr-preview.yml', import.meta.url), 'utf8');
  const documentation = await readFile(new URL('../../docs/android-package.md', import.meta.url), 'utf8');
  expect(manifest).toContain('application/vnd.trailbook.itinerary+json');
  expect(manifest).toContain('application/octet-stream');
  expect(manifest).toContain('android:scheme="content"');
  expect(manifest).not.toContain('android:mimeType="*/*"');
  expect(manifest).not.toContain('android.intent.category.BROWSABLE');
  expect(manifest).not.toMatch(/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
  expect(workflow).toContain('assembleDebug');
  expect(pages).not.toMatch(/gradle|android-sdk|keystore/i);
  expect(documentation).toContain('must not be described as a verified TWA');
  expect(documentation).toContain('https://maxhenneberg.github.io/.well-known/assetlinks.json');
});
