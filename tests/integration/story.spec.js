import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;

test('TA-TRAVEL-3-01 @pr renders Trailbook from the production build under a repository subpath', async ({ page }) => {
  const localAssets = [];
  page.on('response', (response) => {
    if (['script', 'stylesheet', 'image'].includes(response.request().resourceType())) {
      localAssets.push(response);
    }
  });

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arrival & Alfama' })).toBeVisible();
  expect(localAssets.length).toBeGreaterThanOrEqual(3);

  for (const response of localAssets) {
    const assetUrl = new URL(response.url());
    expect(
      assetUrl.pathname.startsWith(repositoryPath),
      `${assetUrl.pathname} must stay beneath ${repositoryPath}`,
    ).toBeTruthy();
    expect(response.ok(), `${assetUrl.pathname} should load successfully`).toBeTruthy();
  }
});

test('TA-TRAVEL-3-02 @post-deploy opens and refreshes the deployed GitHub Pages entry URL', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium post-deploy coverage');
  const first = await page.goto('./');
  expect(first?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();

  const refreshed = await page.reload({ waitUntil: 'networkidle' });
  expect(refreshed?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
});

test('TA-TRAVEL-3-03 @post-deploy smoke-tests the deployed page on an Android viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  const response = await page.goto('./', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
  await expect(page.locator('.day-panel')).toBeInViewport();
  await expect(page.locator('aside[aria-label="Itinerary navigation"]')).toBeVisible();
});

test('TA-TRAVEL-4-01 @pr uses the application shell at the minimum supported width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./');

  await expect(page.getByTestId('primary-content')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('TA-TRAVEL-4-02 @pr supports touch navigation in portrait and landscape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  await page.goto('./');

  const explore = page.getByRole('button', { name: 'Explore', exact: true });
  const size = await explore.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(48);
  expect(size?.height).toBeGreaterThanOrEqual(48);
  await explore.tap();
  await expect(explore).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore');

  await page.setViewportSize({ width: 915, height: 412 });
  const saved = page.getByRole('button', { name: 'Saved', exact: true });
  await saved.tap();
  await expect(saved).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('primary-content')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('TA-TRAVEL-4-03 @pr renders distinct accessible states and recovers from an error', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium coverage');
  await page.goto('./');
  await page.getByRole('button', { name: 'View app states' }).click();

  await expect(page.getByRole('heading', { name: 'Loading journeys' })).toBeVisible();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Bringing your plans together' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No journeys yet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Could not load journeys' })).toBeVisible();

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Journeys restored' })).toBeVisible();
  await expect(page.getByText('You are back on track.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Could not load journeys' })).toHaveCount(0);
});
