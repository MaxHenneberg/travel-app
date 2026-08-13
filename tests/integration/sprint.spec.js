import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;
const richTrip = {
  schemaVersion: 1, id: 'city-break', revision: 1, title: 'City break', destination: 'Somewhere new', dateRange: '1–2 October 2026',
  days: [{ id: 'first-day', date: 'Thursday · 1 October', title: 'First day', activities: [{ id: 'coffee', title: 'Coffee by the station', type: 'Food', time: '09:00', location: { name: 'Central Station' } }] }],
};
const canonicalTrip = {
  schemaVersion: '1.0.0',
  trip: {
    id: 'canonical-break', title: 'Canonical break', startDate: '2026-10-03', endDate: '2026-10-04', timeZone: 'Europe/Paris',
    days: [{ id: 'canonical-day', date: '2026-10-03', activities: [{ id: 'gallery', title: 'Evening gallery', startsAt: '2026-10-03T18:30:00+02:00' }] }],
  },
};

function onlyProject(testInfo, ...profiles) {
  test.skip(!profiles.includes(testInfo.project.name), `Runs on ${profiles.join(', ')}`);
}

async function openSample(page, day = 'arrival') {
  await page.goto(`./#/trip/weekend-lisbon/v/1${day ? `/day/${day}` : ''}`);
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
}

async function openAppMenu(page) {
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await expect(page.getByRole('navigation', { name: 'App menu' })).toBeVisible();
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
  const timelineSpacing = await activity.evaluate((node) => {
    const time = node.querySelector('.activity-time').getBoundingClientRect();
    const card = node.querySelector('.activity-card');
    const cardBox = card.getBoundingClientRect();
    const marker = getComputedStyle(card, '::before');
    const markerLeft = cardBox.left + Number.parseFloat(marker.left);
    return { timeRight: time.right, markerLeft };
  });
  expect(timelineSpacing.markerLeft).toBeGreaterThan(timelineSpacing.timeRight);
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
  await page.getByRole('button', { name: 'View day route' }).click();
  const route = page.getByRole('list', { name: 'Ordered day route' });
  await expect(route.getByRole('listitem')).toHaveCount(3);
  await expect(route.getByRole('listitem').nth(0)).toContainText('Jerónimos Monastery');
  await expect(route.getByRole('listitem').nth(1)).toContainText('Jardim de Belém');
  await expect(route.getByRole('listitem').nth(2)).toContainText('MAAT Lisbon');
  await expect(page.getByRole('link', { name: /Open day route/ })).toHaveCount(0);
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
  await page.goto(new URL(result.manifest.start_url, result.manifestUrl).href);
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
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
  await page.getByRole('link', { name: 'Trip overview', exact: true }).first().click();
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await page.getByRole('link', { name: 'Open trip overview' }).click();
  await page.getByTestId('trip-overview').getByRole('link', { name: /Belém & the river/ }).click();
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
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.locator('[data-trip-id="city-break"]')).toBeVisible();
  await page.locator('#trip-import').setInputFiles({ name: 'canonical-break.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(canonicalTrip)) });
  await expect(page.getByRole('heading', { name: 'Canonical break' })).toBeVisible();
  await expect(page).toHaveURL(/#\/trip\/canonical-break\/v\/1$/);
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.locator('[data-trip-id="city-break"]')).toBeVisible();
  await expect(page.locator('[data-trip-id="canonical-break"]')).toBeVisible();
  await page.locator('[data-trip-id="canonical-break"]').getByRole('link', { name: 'Open trip overview' }).click();
  await prepareOffline(page, context, 'Canonical break');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Canonical break' })).toBeVisible();
});

test('TA-TRAVEL-11-02 @pr rejects invalid imports without changing saved trips', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await openSample(page);
  await page.locator('#trip-import').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.getByRole('status')).toContainText(/schema version|Invalid itinerary/i);
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival & Alfama');
});

test('TA-TRAVEL-11-03 @pr switches between and explicitly removes stored trips', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  await openSample(page);
  await page.locator('#trip-import').setInputFiles({ name: 'city-break.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(richTrip)) });
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await page.locator('[data-trip-id="weekend-lisbon"]').getByRole('link', { name: 'Open trip overview' }).click();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await page.getByRole('link', { name: 'All trips' }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-trip-id="city-break"]').getByRole('button', { name: 'Remove saved trip' }).click();
  await expect(page.getByRole('status')).toContainText('Trip removed');
  await expect(page.locator('[data-trip-id="city-break"]')).toHaveCount(0);
});

test('TA-TRAVEL-50-01 @pr @post-deploy opens an exact itinerary day deep link after refresh', async ({ page }) => {
  await openSample(page, '');
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('trip-overview')).toBeVisible();
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

test('TA-TRAVEL-60-01 @pr exports the supported schema from every import surface at Android width', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await openAppMenu(page);

  const collectionExport = page.getByRole('link', { name: 'Export JSON schema' });
  const collectionHref = await collectionExport.getAttribute('href');
  expect(new URL(collectionHref).pathname).toBe(`${repositoryPath}data/schemas/itinerary.v1.schema.json`);
  await expect(collectionExport).toHaveAttribute('download', 'trailbook-itinerary-schema-v1.json');

  const downloadPromise = page.waitForEvent('download');
  await collectionExport.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trailbook-itinerary-schema-v1.json');

  const schemaResponse = await page.request.get(collectionHref);
  expect(schemaResponse.ok()).toBeTruthy();
  const schema = await schemaResponse.json();
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.properties.schemaVersion.const).toBe('1.0.0');

  await openSample(page, '');
  await openAppMenu(page);
  const itineraryExport = page.getByRole('link', { name: 'Export JSON schema' });
  await expect(itineraryExport).toHaveAttribute('href', collectionHref);
  await expect(itineraryExport).toHaveAttribute('download', 'trailbook-itinerary-schema-v1.json');

  const viewportFits = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    main: document.querySelector('[data-testid="primary-content"]').scrollWidth
      <= document.querySelector('[data-testid="primary-content"]').clientWidth,
  }));
  expect(viewportFits).toEqual({ document: true, main: true });
});

test('TA-TRAVEL-60-02 @pr keeps invalid-import feedback complete, private, copyable, and repairable', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { sessionStorage.setItem('copied-repair', value); } },
    });
  });
  await openSample(page, '');

  await page.locator('#trip-import').setInputFiles({
    name: 'syntax-broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":'),
  });
  const error = page.getByTestId('itinerary-error');
  await expect(error).toBeVisible();
  await expect(page.getByLabel('Copyable itinerary repair message')).toContainText('$ [invalid_json]');
  await page.waitForTimeout(3300);
  await expect(error).toBeVisible();

  const privateValue = 'PRIVATE-ITINERARY-CONTENT-MUST-NOT-BE-COPIED';
  const invalidTrip = {
    schemaVersion: '1.0.0',
    privatePayload: privateValue,
    trip: { id: '', title: '', startDate: 'not-a-date', endDate: '2026-01-01', timeZone: '', days: 'not-an-array' },
  };
  await page.locator('#trip-import').setInputFiles({
    name: 'schema-broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalidTrip)),
  });

  const repairMessage = page.getByLabel('Copyable itinerary repair message');
  await expect(repairMessage).toContainText('Supported schema version: 1.0.0');
  await expect(repairMessage).toContainText('Return only the complete corrected JSON');
  for (const issue of ['/privatePayload [unknown_property]', '/trip/id [required_string]', '/trip/title [required_string]', '/trip/startDate [invalid_date]', '/trip/timeZone [required_string]', '/trip/days [invalid_type]']) {
    await expect(repairMessage).toContainText(issue);
  }
  await expect(repairMessage).toContainText('Repair:');
  await expect(repairMessage).not.toContainText(privateValue);

  const expectedCopy = await repairMessage.inputValue();
  await page.getByRole('button', { name: 'Copy error for an LLM' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('copied-repair'))).toBe(expectedCopy);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: 'Copy error for an LLM' }).click();
  await expect(page.getByRole('button', { name: /Selected.*copy manually/ })).toBeVisible();

  await page.locator('#trip-import').setInputFiles({
    name: 'city-break.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(richTrip)),
  });
  await expect(page.getByRole('heading', { name: 'City break' })).toBeVisible();
  await expect(page.getByTestId('itinerary-error')).toHaveCount(0);
  await page.getByRole('link', { name: 'All trips' }).first().click();
  await expect(page.locator('[data-trip-id="weekend-lisbon"]')).toBeVisible();
  await expect(page.locator('[data-trip-id="city-break"]')).toBeVisible();
  await expect(page.locator('.trip-card')).toHaveCount(2);
});
