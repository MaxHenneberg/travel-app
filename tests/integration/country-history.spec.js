import { expect, test } from '@playwright/test';

const trip = (countryCodes = ['JP', 'JP', 'DE']) => ({
  schemaVersion: '1.0.0', trip: {
    id: 'country-trip', title: 'Country trip', startDate: '2026-04-10', endDate: '2026-04-11', timeZone: 'Asia/Tokyo',
    days: [{ id: 'one', date: '2026-04-10', activities: countryCodes.map((countryCode, index) => ({ id: `${index}`, title: `Stop ${index}`, startsAt: `2026-04-10T1${index}:00:00+09:00`, countryCode })) }],
  },
});

async function collection(page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Visited countries' })).toBeVisible();
}

test('TA-TRAVEL-63-01 @pr @post-deploy derives and deduplicates itinerary visits idempotently', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium'); await collection(page);
  await page.locator('#trip-import').setInputFiles({ name: 'countries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(trip())) });
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.locator('[data-country-record]')).toHaveCount(2);
  await expect(page.locator('[data-country-record="JP"]')).toContainText('1 visit');
  await page.locator('#trip-import').setInputFiles({ name: 'countries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(trip())) });
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.locator('[data-country-record]')).toHaveCount(2);
});

test('TA-TRAVEL-63-02 @pr @post-deploy keeps manual corrections through re-import, reload and offline relaunch', async ({ page, context }) => {
  await collection(page);
  await page.getByLabel('Country code', { exact: true }).fill('JP'); await page.getByRole('button', { name: 'Add country' }).click();
  const record = page.locator('[data-country-record="JP"]'); await record.getByLabel(/Country code for/).fill('FR'); await record.getByRole('button', { name: 'Save correction' }).click();
  await page.locator('#trip-import').setInputFiles({ name: 'countries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(trip(['JP']))) });
  await page.getByRole('link', { name: 'All trips' }).first().click(); await page.reload();
  await expect(page.locator('[data-country-record="FR"]')).toBeVisible(); await expect(page.locator('[data-country-record="JP"]')).toHaveCount(0);
  await context.setOffline(true); await page.reload(); await expect(page.locator('[data-country-record="FR"]')).toBeVisible();
  await page.locator('[data-country-record="FR"]').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('[data-country-record]')).toHaveCount(0);
});

test('TA-TRAVEL-63-03 @pr rejects unsupported codes with a clear message and no data loss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium'); await collection(page);
  await page.getByLabel('Country code', { exact: true }).fill('DE'); await page.getByRole('button', { name: 'Add country' }).click();
  await expect(page.locator('[data-country-record="DE"]')).toBeVisible();
  await page.getByLabel('Country code', { exact: true }).fill('ZZ'); await page.getByRole('button', { name: 'Add country' }).click();
  await expect(page.getByRole('status')).toContainText('not a supported ISO');
  await expect(page.locator('[data-country-record="DE"]')).toBeVisible(); await expect(page.locator('[data-country-record="ZZ"]')).toHaveCount(0);
});
