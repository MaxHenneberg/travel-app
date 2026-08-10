import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;

const validItinerary = {
  schemaVersion: '1.0.0',
  trip: {
    id: 'test-trip',
    title: 'Test weekend',
    startDate: '2026-10-02',
    endDate: '2026-10-04',
    timeZone: 'Europe/Berlin',
    days: [],
  },
};

test('TA-TRAVEL-5-01 @pr loads a valid versioned itinerary fixture', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByTestId('trip-title')).toHaveText('Autumn weekend');
  await expect(page.getByTestId('trip-date-range')).toHaveText('2026-09-18 – 2026-09-20');
  await expect(page.getByTestId('trip-time-zone')).toHaveText('Europe/Berlin');
  await expect(page.getByText('Validated itinerary · schema 1.0.0')).toBeVisible();
});

test('TA-TRAVEL-5-02 @pr rejects invalid, incomplete, and unsupported itinerary data without partial content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium validation coverage');
  let payload = structuredClone(validItinerary);
  await page.route('**/data/itineraries/example.v1.json', (route) => route.fulfill({ json: payload }));

  await test.step('missing required data', async () => {
    delete payload.trip.title;
    await page.goto('./');
    await expect(page.getByTestId('itinerary-error')).toContainText('/trip/title');
    await expect(page.getByTestId('trip-title')).toHaveCount(0);
  });

  await test.step('invalid field type', async () => {
    payload = structuredClone(validItinerary);
    payload.trip.days = [{ id: 'day-one', date: 42, activities: [] }];
    await page.reload();
    await expect(page.getByTestId('itinerary-error')).toContainText('/trip/days/0/date');
    await expect(page.getByTestId('trip-title')).toHaveCount(0);
  });

  await test.step('unsupported schema version and recovery', async () => {
    payload = structuredClone(validItinerary);
    payload.schemaVersion = '2.0.0';
    await page.reload();
    await expect(page.getByTestId('itinerary-error')).toContainText('expected 1.0.0, received 2.0.0');
    await expect(page.getByTestId('trip-title')).toHaveCount(0);

    payload = structuredClone(validItinerary);
    await page.getByRole('button', { name: 'Try itinerary again' }).click();
    await expect(page.getByTestId('trip-title')).toHaveText('Test weekend');
  });
});

test('TA-TRAVEL-5-03 @pr @post-deploy fetches schema and fixture assets beneath the Pages subpath', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium asset-path coverage');
  const jsonResponses = [];
  page.on('response', (response) => {
    if (response.url().includes('/data/')) jsonResponses.push(response);
  });

  await page.goto('./');
  await expect(page.getByTestId('trip-title')).toBeVisible();

  const paths = jsonResponses.map((response) => new URL(response.url()).pathname).sort();
  expect(paths).toEqual([
    `${repositoryPath}data/itineraries/example.v1.json`,
    `${repositoryPath}data/schemas/itinerary.v1.schema.json`,
  ].sort());
  for (const response of jsonResponses) {
    expect(response.ok(), `${response.url()} should load successfully`).toBeTruthy();
    expect(new URL(response.url()).pathname.startsWith(repositoryPath)).toBeTruthy();
  }
});
