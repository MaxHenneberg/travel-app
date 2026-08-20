import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;
const validItinerary = {
  schemaVersion: 1, id: 'weekend-lisbon', revision: 1, title: 'Test weekend', destination: 'Lisbon', dateRange: '2–4 October 2026', days: [],
};

test('TA-TRAVEL-5-01 @pr loads the meaningful published itinerary into collection and overview', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await page.getByRole('link', { name: 'Open trip overview' }).click();
  await expect(page.getByTestId('trip-title')).toHaveText('A long weekend in Lisbon');
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await expect(page.locator('.overview-day-card')).toHaveCount(3);
});

test('TA-TRAVEL-5-02 @pr rejects invalid and unsupported published data without partial content', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium validation coverage');
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  let payload = structuredClone(validItinerary);
  await page.route('**/data/itineraries/weekend-lisbon/v1.json', (route) => route.fulfill({ json: payload }));

  delete payload.title;
  await page.goto('./#/trip/weekend-lisbon/v/1');
  await expect(page.getByText('/title')).toBeVisible();
  await expect(page.getByTestId('trip-title')).toHaveCount(0);

  payload = structuredClone(validItinerary);
  payload.days = [{ id: 'day-one', date: 'Friday', activities: [{ id: 'broken', title: 42 }] }];
  await page.reload();
  await expect(page.getByText('/days/0/activities/0/title')).toBeVisible();

  await page.unroute('**/data/itineraries/weekend-lisbon/v1.json');
  await page.route('**/data/itineraries/unsupported-trip/v1.json', (route) => route.fulfill({
    json: { ...structuredClone(validItinerary), id: 'unsupported-trip', schemaVersion: 99 },
  }));
  await page.goto('./#/trip/unsupported-trip/v/1');
  await expect(page.getByText(/schema version 1|must be 1/)).toBeVisible();
  await context.close();
});

test('TA-TRAVEL-5-03 @pr @post-deploy fetches catalog, schema, and fixture beneath the Pages subpath', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium asset-path coverage');
  const responses = [];
  page.on('response', (response) => { if (response.url().includes('/data/')) responses.push(response); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  const paths = responses.map((response) => new URL(response.url()).pathname);
  expect(paths).toEqual(expect.arrayContaining([
    `${repositoryPath}data/itineraries/index.json`,
    `${repositoryPath}data/itineraries/weekend-lisbon/v1.json`,
    `${repositoryPath}data/schemas/itinerary.v1.1.schema.json`,
  ]));
  for (const response of responses) expect(response.ok(), response.url()).toBeTruthy();
});
