import { expect, test } from '@playwright/test';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const imageUrl = (name) => `https://images.example.test/${name}.png`;

function onlyProject(testInfo, name) {
  test.skip(testInfo.project.name !== name, `Covered by the ${name} Jira profile.`);
}

function itinerary(activities, id = 'picture-trip') {
  return {
    schemaVersion: '1.0.0',
    trip: {
      id,
      title: 'Picture trip',
      startDate: '2026-09-18',
      endDate: '2026-09-18',
      timeZone: 'Europe/Berlin',
      days: [{ id: 'picture-day', date: '2026-09-18', title: 'Picture day', activities }],
    },
  };
}

function activity(id, images) {
  return { id, title: `Stop ${id}`, startsAt: '2026-09-18T10:00:00+02:00', ...(images ? { images } : {}) };
}

async function ensureControlled(page) {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBeTruthy();
}

async function importAndOpenDay(page, value) {
  await page.locator('#trip-import').setInputFiles({
    name: 'pictures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('heading', { name: 'Picture trip' })).toBeVisible();
  await page.goto(`./#/trip/${value.trip.id}/v/1/day/picture-day`);
  await expect(page.getByRole('heading', { name: 'Picture day' })).toBeVisible();
}

test('TA-TRAVEL-80-01 @pr validates optional image schema compatibility', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await page.goto('./');
  const schema = await page.request.get('./data/schemas/itinerary.v1.schema.json').then((response) => response.json());
  expect(schema.$defs.activity.properties.images.items.$ref).toBe('#/$defs/image');
  expect(schema.$defs.image.required).toEqual(['alt']);
  expect(schema.$defs.image.properties.url.pattern).toBe('^https://');
  expect(schema.$defs.image.properties.provider.const).toBe('wikimediaCommons');

  const valid = itinerary([activity('one', [{
    url: imageUrl('valid'), alt: 'A recognizable stop', caption: 'Morning', credit: 'Photographer', sourceUrl: 'https://images.example.test/source',
  }])], 'schema-picture-trip');
  await page.locator('#trip-import').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(valid)) });
  await expect(page.getByRole('heading', { name: 'Picture trip' })).toBeVisible();

  valid.trip.days[0].activities[0].images[0].url = 'http://images.example.test/insecure.png';
  await page.locator('#trip-import').setInputFiles({ name: 'insecure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(valid)) });
  await expect(page.getByLabel('Copyable itinerary repair message')).toContainText('/images/0/url [unsafe_url]');
});

if (false) test('obsolete bundled preview artwork', async ({ page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  await page.goto('./#/trip/weekend-lisbon/v/1/day/river-day');
  const picture = page.locator('[data-activity-id="belem"] .stop-picture');
  await expect(picture.locator('img')).toHaveAttribute('src', /\/travel-app\/images\/stops\/lisbon-monastery\.svg$/);
  await expect(picture.locator('img')).toHaveAttribute('alt', 'Sunlit arches at Jerónimos Monastery');
  await expect(picture.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  const riverfront = page.locator('[data-activity-id="maat"] .stop-picture');
  await riverfront.scrollIntoViewIfNeeded();
  await expect(riverfront.locator('img')).toHaveAttribute('src', /\/travel-app\/images\/stops\/lisbon-riverfront\.png$/);
  await expect(riverfront.locator('img')).toHaveAttribute('alt', 'MAAT beside the Tagus river at golden hour');
  await expect(riverfront.locator('.stop-picture-frame')).toHaveClass(/loaded/);
});

if (false) test('duplicate Commons preview coverage', async ({ context, page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  let apiRequests = 0;
  await context.route('https://commons.wikimedia.org/w/api.php**', async (route) => {
    apiRequests += 1;
    const query = new URL(route.request().url()).searchParams.get('gsrsearch');
    const name = query.includes('MAAT') ? 'maat' : 'monastery';
    await route.fulfill({ status: 200, json: { query: { pages: [{ imageinfo: [{
      thumburl: imageUrl(name), descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
      extmetadata: { ImageDescription: { value: `${name} description` }, Artist: { value: 'Commons photographer' } },
    }] }] } }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.route('https://images.example.test/**', (route) => route.fulfill({ status: 200, body: pixel, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('./#/trip/weekend-lisbon/v/1/day/river-day');
  const picture = page.locator('[data-activity-id="belem"] .stop-picture');
  await expect(picture.locator('img')).toHaveAttribute('src', imageUrl('monastery'));
  await expect(picture.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  await expect(picture.getByText('Photo: Commons photographer')).toBeVisible();
  await expect(picture.getByRole('link', { name: 'Image source' })).toHaveAttribute('href', /commons\.wikimedia\.org/);
  const riverfront = page.locator('[data-activity-id="maat"] .stop-picture');
  await riverfront.scrollIntoViewIfNeeded();
  await expect(riverfront.locator('img')).toHaveAttribute('src', imageUrl('maat'));
  await expect(riverfront.locator('img')).toHaveAttribute('alt', 'MAAT beside the Tagus river');
  await expect(riverfront.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  expect(apiRequests).toBe(2);
});

test('published preview lazily resolves Wikimedia Commons metadata and attribution', async ({ context, page }, testInfo) => {
  onlyProject(testInfo, 'chromium');
  let apiRequests = 0;
  await context.route('https://commons.wikimedia.org/w/api.php**', async (route) => {
    apiRequests += 1;
    const requestUrl = new URL(route.request().url());
    const reference = requestUrl.searchParams.get('titles') || requestUrl.searchParams.get('gsrsearch') || '';
    const name = reference.includes('Santa Luzia') ? 'viewpoint' : reference.includes('Tram') ? 'tram' : 'alfama';
    await route.fulfill({ status: 200, json: { query: { pages: [{ imageinfo: [{
      thumburl: imageUrl(name), descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
      extmetadata: { ImageDescription: { value: `${name} description` }, Artist: { value: 'Commons photographer' } },
    }] }] } }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.route('https://images.example.test/**', (route) => route.fulfill({ status: 200, body: pixel, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('./#/trip/weekend-lisbon/v/1/day/arrival');
  const picture = page.locator('[data-activity-id="check-in"] .stop-picture');
  await picture.scrollIntoViewIfNeeded();
  await expect(picture.locator('img')).toHaveAttribute('src', imageUrl('viewpoint'));
  await expect(picture.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  await expect(picture.getByText('Photo: Commons photographer')).toBeVisible();
  await expect(picture.locator('[data-image-caption]')).toBeEmpty();
  await expect(picture.getByText('viewpoint description')).toHaveCount(0);
  await expect(picture.getByRole('link', { name: 'Image source' })).toHaveAttribute('href', /commons\.wikimedia\.org/);
  const tram = page.locator('[data-activity-id="tram"] .stop-picture');
  await tram.scrollIntoViewIfNeeded();
  await expect(tram.locator('img')).toHaveAttribute('src', imageUrl('tram'));
  await expect(tram.locator('img')).toHaveAttribute('alt', 'Yellow tram 28 travelling through Lisbon');
  await expect(tram.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  const alfama = page.locator('[data-activity-id="dinner"] .stop-picture');
  await alfama.scrollIntoViewIfNeeded();
  await expect(alfama.locator('img')).toHaveAttribute('src', imageUrl('alfama'));
  await expect(alfama.locator('.stop-picture-frame')).toHaveClass(/loaded/);
  expect(apiRequests).toBe(3);
});

test('TA-TRAVEL-80-02 @pr lazy-loads responsive, accessible online thumbnails', async ({ context, page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  const requested = [];
  await context.route('https://images.example.test/**', async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ status: 200, body: pixel, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
  });
  await ensureControlled(page);
  const activities = [activity('near', [{ url: imageUrl('near'), alt: 'Sunny plaza', caption: 'Arrival view', credit: 'Alex', sourceUrl: 'https://images.example.test/source' }])];
  for (let index = 0; index < 14; index += 1) activities.push(activity(`filler-${index}`));
  activities.push(activity('far', [{ url: imageUrl('far'), alt: 'Far viewpoint' }]));
  await importAndOpenDay(page, itinerary(activities, 'lazy-picture-trip'));

  const nearFrame = page.locator('[data-activity-id="near"] .stop-picture-frame');
  const reserved = await nearFrame.boundingBox();
  await expect(nearFrame.locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(nearFrame.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(nearFrame.locator('img')).toHaveAttribute('alt', 'Sunny plaza');
  await expect(page.getByText('Arrival view')).toBeVisible();
  await expect(page.getByText('Photo: Alex')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Image source' })).toHaveAttribute('href', 'https://images.example.test/source');
  expect(requested).toContain(imageUrl('near'));
  expect(requested).not.toContain(imageUrl('far'));
  await page.locator('[data-activity-id="far"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-activity-id="far"] img')).toHaveAttribute('alt', 'Far viewpoint');
  await expect.poll(() => requested).toContain(imageUrl('far'));
  const after = await nearFrame.boundingBox();
  expect(Math.abs(after.height - reserved.height)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test('TA-TRAVEL-80-03 @pr reuses cached images offline without remote attempts', async ({ context, page }, testInfo) => {
  onlyProject(testInfo, 'android-chrome');
  let networkRequests = 0;
  await context.route('https://images.example.test/**', async (route) => {
    networkRequests += 1;
    await route.fulfill({ status: 200, body: pixel, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
  });
  await ensureControlled(page);
  const activities = [activity('cached', [{ url: imageUrl('cached'), alt: 'Cached place' }])];
  for (let index = 0; index < 14; index += 1) activities.push(activity(`space-${index}`));
  activities.push(activity('uncached', [{ url: imageUrl('uncached'), alt: 'Uncached place' }]));
  await importAndOpenDay(page, itinerary(activities, 'offline-picture-trip'));
  await expect(page.locator('[data-activity-id="cached"] .stop-picture-frame')).toHaveClass(/loaded/);
  await expect.poll(() => page.evaluate(async (url) => Boolean(await (await caches.open('trailbook-stop-images-v1')).match(url)), imageUrl('cached'))).toBeTruthy();
  const beforeOffline = networkRequests;

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('#network-status')).toContainText(/Offline.*saved copy/);
  await expect(page.locator('[data-activity-id="cached"] .stop-picture-frame')).toHaveClass(/loaded/);
  await page.locator('[data-activity-id="uncached"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-activity-id="uncached"] .stop-picture-placeholder')).toBeVisible();
  await expect(page.locator('[data-activity-id="uncached"] img')).toHaveCount(0);
  expect(networkRequests).toBe(beforeOffline);
  await page.getByRole('link', { name: 'Trip overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trip overview' })).toBeVisible();
  await page.getByTestId('trip-overview').getByRole('link', { name: /Picture day/ }).click();
  await expect(page.locator('[data-activity-id="cached"] .stop-picture-frame')).toHaveClass(/loaded/);
});

test('TA-TRAVEL-80-04 @pr handles failures and enforces deterministic cache bounds', async ({ context, page }) => {
  await context.route('https://images.example.test/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/failed.png')) return route.fulfill({ status: 404, body: 'missing', headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    if (url.endsWith('/not-image.png')) return route.fulfill({ status: 200, body: 'not an image', headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    if (url.endsWith('/oversized.png')) return route.fulfill({ status: 200, body: Buffer.alloc((5 * 1024 * 1024) + 1), headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
    return route.fulfill({ status: 200, body: pixel, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
  });
  await ensureControlled(page);
  const urls = Array.from({ length: 26 }, (_, index) => imageUrl(`bounded-${index}`));
  await page.evaluate(async (sources) => Promise.all(sources.map((src) => new Promise((resolve) => {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous'; image.onload = resolve; image.onerror = resolve; image.src = src; document.body.append(image);
  }))), urls);
  const cacheState = await page.evaluate(async (sources) => {
    const cache = await caches.open('trailbook-stop-images-v1');
    const keys = await cache.keys();
    return { count: keys.length, first: Boolean(await cache.match(sources[0])), last: Boolean(await cache.match(sources.at(-1))) };
  }, urls);
  expect(cacheState).toEqual({ count: 24, first: false, last: true });

  await page.evaluate(async (sources) => Promise.all(sources.map((src) => new Promise((resolve) => {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous'; image.onload = resolve; image.onerror = resolve; image.src = src; document.body.append(image);
  }))), [imageUrl('failed'), imageUrl('not-image'), imageUrl('oversized')]);
  const rejected = await page.evaluate(async (sources) => {
    const cache = await caches.open('trailbook-stop-images-v1');
    return Promise.all(sources.map(async (source) => Boolean(await cache.match(source))));
  }, [imageUrl('failed'), imageUrl('not-image'), imageUrl('oversized')]);
  expect(rejected).toEqual([false, false, false]);

  await page.goto('./');
  await importAndOpenDay(page, itinerary([activity('broken', [{ url: imageUrl('failed'), alt: 'Broken place' }])], 'failed-picture-trip'));
  await expect(page.locator('[data-activity-id="broken"] .stop-picture-placeholder')).toBeVisible();
  await expect(page.locator('[data-activity-id="broken"] img')).toHaveCount(0);
  await expect(page.locator('[data-activity-id="broken"] h3')).toHaveText('Stop broken');
});
