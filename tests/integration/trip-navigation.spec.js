import { expect, test } from '@playwright/test';

const orderedItinerary = {
  schemaVersion: 1, id: 'weekend-lisbon', revision: 1, title: 'Ordered escape', destination: 'St. John’s', dateRange: '3–5 November 2026',
  days: [
    { id: 'source-first', date: '2026-11-03', title: 'Source first', activities: [
      { id: 'late', title: 'Listed first', time: '18:45' }, { id: 'early', title: 'Listed second', time: '08:15' },
    ] },
    { id: 'source-second', date: '2026-11-04', activities: [] },
    { id: 'source-third', date: '2026-11-05', title: 'Source third', activities: [] },
  ],
};

test('TA-TRAVEL-6-01 @pr browses overview days and activities in source-defined order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android itinerary coverage');
  await page.route('**/data/itineraries/weekend-lisbon/v1.json', (route) => route.fulfill({ json: orderedItinerary }));
  await page.goto('./#/trip/weekend-lisbon/v/1');
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await expect(page.locator('.overview-day-card time')).toHaveText(['2026-11-03', '2026-11-04', '2026-11-05']);
  await expect(page.locator('.activity-preview li')).toHaveText(['18:45 · Listed first', '08:15 · Listed second']);
  await page.getByTestId('trip-overview').getByRole('link', { name: /2026-11-03 Source first/ }).tap();
  await expect(page.getByRole('navigation', { name: 'Itinerary days' }).getByRole('link', { name: /Source first/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('activity-item').locator('h3')).toHaveText(['Listed first', 'Listed second']);
});

test('TA-TRAVEL-6-02 @pr preserves collection, overview, and day state across history and refresh', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android navigation coverage');
  await page.goto('./');
  await page.getByRole('link', { name: 'Open trip overview' }).tap();
  await expect(page).toHaveURL(/#\/trip\/weekend-lisbon\/v\/1$/);
  await page.getByTestId('trip-overview').getByRole('link', { name: /Friday · 18 September Arrival & Alfama/ }).tap();
  await expect(page).toHaveURL(/\/day\/arrival$/);
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival & Alfama');
  await page.reload();
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival & Alfama');
  await page.goBack();
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await page.getByRole('link', { name: 'All trips' }).first().tap();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
});

test('TA-TRAVEL-6-03 @pr renders optional and empty day content without inventing trip data', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium empty-state coverage');
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  let payload = { schemaVersion: 1, id: 'weekend-lisbon', revision: 1, title: 'Minimal trip', days: [{ id: 'minimal-day', date: '2026-12-01', activities: [] }] };
  await page.route('**/data/itineraries/weekend-lisbon/v1.json', (route) => route.fulfill({ json: payload }));
  await page.goto('./#/trip/weekend-lisbon/v/1');
  await expect(page.getByText('No activities planned for this day.')).toBeVisible();
  await expect(page.getByText(/destination|location/i)).toHaveCount(0);
  await page.getByTestId('trip-overview').getByRole('link', { name: /2026-12-01/ }).click();
  await expect(page.getByTestId('empty-day')).toBeVisible();
  await page.getByRole('link', { name: 'Trip overview', exact: true }).first().click();
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  payload = { ...payload, days: [] };
  await page.reload();
  await expect(page.getByTestId('empty-itinerary')).toBeVisible();
  await context.close();
});
