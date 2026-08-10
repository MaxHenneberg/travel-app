import { expect, test } from '@playwright/test';

const orderedItinerary = {
  schemaVersion: '1.0.0',
  trip: {
    id: 'ordered-trip',
    title: 'Ordered escape',
    summary: 'A deterministic test itinerary.',
    startDate: '2026-11-03',
    endDate: '2026-11-05',
    timeZone: 'America/St_Johns',
    days: [
      {
        id: 'source-first',
        date: '2026-11-03',
        title: 'Source first',
        activities: [
          { id: 'late', title: 'Listed first', startsAt: '2026-11-03T18:45:00-02:30' },
          { id: 'early', title: 'Listed second', startsAt: '2026-11-03T08:15:00-02:30' },
        ],
      },
      { id: 'source-second', date: '2026-11-04', activities: [] },
      { id: 'source-third', date: '2026-11-05', title: 'Source third', activities: [] },
    ],
  },
};

test('TA-TRAVEL-6-01 @pr browses trip days and activities in source-defined order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android itinerary coverage');
  await page.setViewportSize({ width: 360, height: 740 });
  await page.route('**/data/itineraries/example.v1.json', (route) => route.fulfill({ json: orderedItinerary }));
  await page.goto('./');

  await expect(page.getByTestId('trip-time-zone')).toHaveText('America/St_Johns');
  await expect(page.locator('.day-card time')).toHaveText(['2026-11-03', '2026-11-04', '2026-11-05']);
  await expect(page.locator('.activity-preview li')).toHaveText(['Listed first', 'Listed second']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: /2026-11-03 Source first/ }).tap();
  await expect(page.getByRole('navigation', { name: 'Itinerary days' }).getByRole('link', { name: /Source first/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('activity-item').locator('h4')).toHaveText(['Listed first', 'Listed second']);
  await expect(page.getByTestId('activity-item').locator('time')).toHaveText([
    '2026-11-03T18:45:00-02:30',
    '2026-11-03T08:15:00-02:30',
  ]);
});

test('TA-TRAVEL-6-02 @pr preserves overview and selected-day state across refresh and browser history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android navigation coverage');
  await page.goto('./');

  await page.getByRole('link', { name: /2026-09-18 Arrival/ }).tap();
  await expect(page).toHaveURL(/\?day=arrival-day$/);
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival');
  await page.reload();
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival');

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Itinerary days' })).toBeVisible();
  await expect(page).not.toHaveURL(/\?day=/);
  await page.goForward();
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival');
  await expect(page.getByRole('navigation', { name: 'Itinerary days' }).getByRole('link', { name: /Arrival/ })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: 'Trip overview' }).tap();
  await expect(page.getByRole('heading', { name: 'Itinerary days' })).toBeVisible();
});

test('TA-TRAVEL-6-03 @pr renders optional and empty day content without inventing trip data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium empty-state coverage');
  let payload = {
    schemaVersion: '1.0.0',
    trip: {
      id: 'minimal-trip',
      title: 'Minimal trip',
      startDate: '2026-12-01',
      endDate: '2026-12-01',
      timeZone: 'UTC',
      days: [{ id: 'minimal-day', date: '2026-12-01', activities: [] }],
    },
  };
  await page.route('**/data/itineraries/example.v1.json', (route) => route.fulfill({ json: payload }));
  await page.goto('./');

  await expect(page.locator('.trip-summary')).toHaveCount(0);
  await expect(page.getByText('No activities planned for this day.')).toBeVisible();
  await expect(page.getByText(/destination|location/i)).toHaveCount(0);
  await page.getByRole('link', { name: /2026-12-01/ }).click();
  await expect(page.getByTestId('selected-day-title')).toHaveText('2026-12-01');
  await expect(page.getByTestId('empty-day')).toBeVisible();

  payload = { ...payload, trip: { ...payload.trip, days: [] } };
  await page.reload();
  await expect(page.getByTestId('empty-itinerary')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No itinerary days available' })).toBeVisible();
  await expect(page.getByTestId('itinerary-error')).toHaveCount(0);
});
