import { expect, test } from '@playwright/test';

const repositoryPath = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/travel-app/').pathname;

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`network: ${request.url()} (${request.failure()?.errorText})`));
  return errors;
}

test('TA-TRAVEL-3-01 @pr renders Hello World from the production build under a repository subpath', async ({ page }) => {
  const localAssets = [];
  page.on('response', (response) => {
    if (['script', 'stylesheet', 'image'].includes(response.request().resourceType())) {
      localAssets.push(response);
    }
  });

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to the welcome page' })).toHaveAttribute('href', repositoryPath);
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
  await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible();

  const refreshed = await page.reload({ waitUntil: 'networkidle' });
  expect(refreshed?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible();
});

test('TA-TRAVEL-3-03 @post-deploy smoke-tests the deployed page on an Android viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome', 'Android profile coverage');
  const errors = captureErrors(page);

  const response = await page.goto('./', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible();
  await expect(page.locator('.welcome')).toBeInViewport();
  expect(errors).toEqual([]);
});
