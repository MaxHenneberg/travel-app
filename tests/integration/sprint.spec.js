import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;
const richTrip = {
  schemaVersion: 1, id: 'city-break', revision: 1, title: 'City break', destination: 'Somewhere new', dateRange: '1–2 October 2026',
  days: [{ id: 'first-day', date: 'Thursday · 1 October', title: 'First day', activities: [{ id: 'coffee', title: 'Coffee by the station', type: 'Food', time: '09:00', location: { name: 'Central Station' } }] }],
};

function onlyProject(testInfo, ...profiles) {
  test.skip(!profiles.includes(testInfo.project.name), `Runs on ${profiles.join(', ')}`);
}

async function openSample(page, day = '') {
  await page.goto(`./#/trip/weekend-lisbon/v/1${day ? `/day/${day}` : ''}`);
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
}

async function prepareOffline(page, context, heading = 'A long weekend in Lisbon') {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

test('TA-TRAVEL-7-01 @pr renders activity, timing, transport, and practical details', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  const activity = page.locator('[data-activity-id="tram"]');
  await expect(activity).toContainText('17:00');
  await expect(activity).toContainText('25 min');
  await activity.getByText('Practical details').click();
  await expect(activity).toContainText('28E');
  await expect(activity).toContainText('Sé → Graça');
});

test('TA-TRAVEL-7-02 @pr omits absent optional activity details cleanly', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await openSample(page, 'river-day');
  const lunch = page.locator('[data-activity-id="lunch"]');
  await expect(lunch.getByRole('heading', { name: 'Picnic in Jardim de Belém' })).toBeVisible();
  await expect(lunch.locator('details')).toHaveCount(0);
  await expect(lunch).not.toContainText('undefined');
});

test('TA-TRAVEL-7-03 @pr expands and collapses dense activity details by touch', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  const details = page.locator('[data-activity-id="check-in"] details');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText('Door code is in the reservation app.');
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
});

test('TA-TRAVEL-8-01 @pr opens a place through an encoded Google Maps link', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page, 'river-day');
  const url = new URL(await page.locator('[data-activity-id="belem"] [data-map-link]').getAttribute('href'));
  expect(url.origin).toBe('https://www.google.com');
  expect(url.searchParams.get('query')).toBe('Jerónimos Monastery');
  expect(url.searchParams.get('query_place_id')).toBeTruthy();
});

test('TA-TRAVEL-8-02 @pr preserves ordered stops in a day route', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page, 'river-day');
  const url = new URL(await page.getByRole('link', { name: /Open day route/ }).getAttribute('href'));
  expect(url.searchParams.get('origin')).toContain('Jerónimos Monastery');
  expect(url.searchParams.get('waypoints')).toBe('38.6977,-9.2061');
  expect(url.searchParams.get('destination')).toBe('38.6959,-9.1947');
});

test('TA-TRAVEL-8-03 @pr explains that external maps are unavailable offline', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await context.setOffline(true);
  await page.locator('[data-map-link]').first().click();
  await expect(page.getByRole('status')).toContainText('Maps needs a connection');
});

test('TA-TRAVEL-9-01 @pr @post-deploy exposes a scoped installable manifest and service worker', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await openSample(page);
  const result = await page.evaluate(async () => {
    const manifestUrl = document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await fetch(manifestUrl)).json();
    const registration = await navigator.serviceWorker.ready;
    return { manifestUrl, manifest, scope: registration.scope };
  });
  expect(new URL(result.manifestUrl).pathname.startsWith(repositoryPath)).toBeTruthy();
  expect(result.manifest.display).toBe('standalone');
  expect(result.manifest.start_url).toBe('./');
  expect(result.manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' })]));
  expect(new URL(result.scope).pathname).toBe(repositoryPath);
});

test('TA-TRAVEL-9-03 @pr remains a complete website without install UI support', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await page.addInitScript(() => { Object.defineProperty(window, 'BeforeInstallPromptEvent', { value: undefined }); });
  await openSample(page);
  await expect(page.getByRole('button', { name: 'Install app' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
});

test('TA-TRAVEL-10-01 @pr reopens the app and active itinerary offline', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await prepareOffline(page, context);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('#network-status')).toContainText('Offline');
});

test('TA-TRAVEL-10-02 @pr navigates through cached itinerary content offline', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await prepareOffline(page, context);
  await page.getByRole('button', { name: /Belém & the river/ }).click();
  await expect(page.getByRole('heading', { name: 'Belém & the river' })).toBeVisible();
  await expect(page.locator('[data-activity-id="maat"]')).toBeVisible();
});

test('TA-TRAVEL-10-03 @pr shows a controlled error for uncached offline content', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await openSample(page);
  await prepareOffline(page, context);
  await page.goto('./#/trip/not-downloaded/v/1');
  await expect(page.getByRole('heading', { name: 'Connect once to download this trip' })).toBeVisible();
  await expect(page.locator('body')).not.toBeEmpty();
});

test('TA-TRAVEL-11-01 @pr imports and persists a valid local itinerary', async ({ page, context }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await page.locator('#trip-import').setInputFiles({ name: 'city-break.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(richTrip)) });
  await expect(page.getByRole('heading', { name: 'City break' })).toBeVisible();
  await prepareOffline(page, context, 'City break');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'City break' })).toBeVisible();
});

test('TA-TRAVEL-11-02 @pr rejects invalid imports without changing saved trips', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await openSample(page);
  await page.locator('#trip-import').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.getByRole('status')).toContainText('Invalid itinerary');
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'A long weekend in Lisbon', exact: true })).toBeVisible();
});

test('TA-TRAVEL-11-03 @pr switches between and explicitly removes stored trips', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await page.locator('#trip-import').setInputFiles({ name: 'city-break.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(richTrip)) });
  await expect(page.getByRole('button', { name: 'A long weekend in Lisbon', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'A long weekend in Lisbon', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove City break' }).click({ force: true });
  await expect(page.getByRole('status')).toContainText('Trip removed');
});

test('TA-TRAVEL-50-01 @pr @post-deploy opens an exact itinerary day deep link after refresh', async ({ page }) => {
  await openSample(page, 'river-day');
  await expect(page.getByRole('heading', { name: 'Belém & the river' })).toBeVisible();
  expect(page.url()).toContain('#/trip/weekend-lisbon/v/1/day/river-day');
  const response = await page.reload();
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Belém & the river' })).toBeVisible();
});

test('TA-TRAVEL-50-02 @pr reopens a previously loaded shared itinerary offline', async ({ page, context }) => {
  await openSample(page, 'river-day');
  await prepareOffline(page, context);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Belém & the river' })).toBeVisible();
});

test('TA-TRAVEL-50-03 @pr rejects unavailable and unsafe deep links before fetching', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('./#/trip/%2e%2e/v/1');
  await expect(page.getByRole('heading', { name: 'This link is not safe to open' })).toBeVisible();
  expect(requested.some((url) => url.includes('/data/itineraries/../'))).toBeFalsy();
  expect(requested.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBeTruthy();
});

test('TA-TRAVEL-50-04 @pr shares the canonical revision and day URL on Android', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => sessionStorage.setItem('shared', JSON.stringify(data)) });
  });
  await openSample(page, 'river-day');
  await page.getByRole('button', { name: 'Share this day' }).click();
  const shared = await page.evaluate(() => JSON.parse(sessionStorage.getItem('shared')));
  expect(shared.url).toContain('#/trip/weekend-lisbon/v/1/day/river-day');
});
