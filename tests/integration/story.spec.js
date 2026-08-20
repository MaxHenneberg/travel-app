import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;

test('TA-TRAVEL-3-01 @pr renders the unified trip collection beneath its repository subpath', async ({ page }) => {
  const localAssets = [];
  page.on('response', (response) => {
    if (['script', 'stylesheet', 'image'].includes(response.request().resourceType())) localAssets.push(response);
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Autumn weekend' })).toHaveCount(0);
  expect(localAssets.length).toBeGreaterThanOrEqual(3);
  for (const response of localAssets) {
    const path = new URL(response.url()).pathname;
    expect(path.startsWith(repositoryPath), `${path} must stay beneath ${repositoryPath}`).toBeTruthy();
    expect(response.ok(), `${path} should load successfully`).toBeTruthy();
  }
});

test('TA-TRAVEL-3-02 @post-deploy refreshes the deployed trip collection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium post-deploy coverage');
  expect((await page.goto('./'))?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  expect((await page.reload({ waitUntil: 'networkidle' }))?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
});

test('TA-TRAVEL-3-03 @post-deploy keeps the collection readable on Android', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  expect((await page.goto('./', { waitUntil: 'networkidle' }))?.ok()).toBeTruthy();
  await expect(page.getByTestId('primary-content')).toBeInViewport();
  await expect(page.locator('[data-trip-id="weekend-lisbon"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('TA-TRAVEL-4-01 @pr uses the unified application shell at the minimum supported width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./');
  await expect(page.getByTestId('primary-content')).toBeVisible();
  await expect(page.getByRole('link', { name: 'All trips' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('TA-TRAVEL-4-02 @pr supports touch navigation from collection to overview and day', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  await page.goto('./');
  const open = page.locator('[data-trip-id="weekend-lisbon"]').getByRole('link', { name: 'Open trip overview' });
  const size = await open.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(48);
  await open.tap();
  await expect(page.getByTestId('trip-overview')).toBeVisible();
  await page.locator('.overview-day-card').first().tap();
  await expect(page.getByTestId('selected-day-title')).toHaveText('Arrival & Alfama');
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByRole('link', { name: 'Trip overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('TA-TRAVEL-4-03 @pr renders an actionable route error and recovers to the collection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium coverage');
  await page.goto('./#/trip/%2e%2e/v/1');
  await expect(page.getByRole('heading', { name: 'This link is not safe to open' })).toBeVisible();
  await expect(page.getByText(/may not contain traversal sequences/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to all trips' }).click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
});
