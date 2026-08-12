import { expect, test } from '@playwright/test';

const tripUrl = './#/trip/weekend-lisbon/v/1/day/arrival';

async function openTrip(page) {
  await page.goto(tripUrl);
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
}

async function tokenSnapshot(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const tokens = ['background', 'surface', 'text', 'text-muted', 'primary', 'accent', 'border', 'focus', 'success', 'warning', 'error'];
    return Object.fromEntries(tokens.map((token) => [token, style.getPropertyValue(`--color-${token}`).trim()]));
  });
}

function luminance(hex) {
  const values = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

test('TA-TRAVEL-55-01 @pr @post-deploy switches in place and restores the theme offline', async ({ page, context }) => {
  await openTrip(page);
  const details = page.locator('[data-activity-id="check-in"] details');
  await details.locator('summary').click();
  const url = page.url();
  await page.getByLabel('Theme').selectOption('neon-japan');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
  await expect(page.locator('#active-theme-status')).toContainText('Active theme: Neon Japan');
  expect(page.url()).toBe(url);
  await expect(details).toHaveAttribute('open', '');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon-japan');
});

test('TA-TRAVEL-55-02 @pr @post-deploy renders Sakura with complete accessible semantic tokens', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('trailbook.theme', 'sakura'));
  await openTrip(page);
  const tokens = await tokenSnapshot(page);
  expect(Object.values(tokens).every(Boolean)).toBeTruthy();
  expect(contrast(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tokens['text-muted'], tokens.surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tokens['primary'], tokens.surface)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('.activity-card').first()).toHaveCSS('background-color', 'rgb(255, 253, 251)');
  await page.getByLabel('Theme').focus();
  expect(await page.getByLabel('Theme').evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
});

test('TA-TRAVEL-55-03 @pr @post-deploy renders Neon Japan with complete accessible semantic tokens', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('trailbook.theme', 'neon-japan'));
  await openTrip(page);
  const tokens = await tokenSnapshot(page);
  expect(Object.values(tokens).every(Boolean)).toBeTruthy();
  expect(contrast(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tokens['text-muted'], tokens.surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tokens.primary, tokens.surface)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('.activity-card').first()).toHaveCSS('background-color', 'rgb(17, 24, 42)');
  await expect(page.locator('.network')).toHaveCSS('color', 'rgb(189, 200, 220)');
});

test('TA-TRAVEL-55-04 @pr @post-deploy falls back before rendering for unsupported stored themes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('trailbook.theme', '{unsupported-theme}');
    localStorage.setItem('unrelated-itinerary-marker', 'unchanged');
  });
  await openTrip(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sakura');
  await expect(page.getByLabel('Theme')).toHaveValue('sakura');
  expect(await page.evaluate(() => localStorage.getItem('trailbook.theme'))).toBe('sakura');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-itinerary-marker'))).toBe('unchanged');
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
});
