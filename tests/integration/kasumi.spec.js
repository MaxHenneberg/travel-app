import { expect, test } from '@playwright/test';

const tripUrl = './#/trip/weekend-lisbon/v/1/day/arrival';

async function openTrip(page) {
  await page.goto(tripUrl);
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
  await expect(page.getByTestId('kasumi-decoration')).toHaveCount(1);
}

async function switchTheme(page, theme) {
  await page.locator('#menu-toggle').click();
  await page.getByLabel('Theme').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test('TA-TRAVEL-112-01 @pr @post-deploy renders two theme-aware Kasumi depths with bounded scroll parallax', async ({ page }) => {
  await openTrip(page);
  const header = page.locator('[data-kasumi-header]');
  const title = page.getByTestId('trip-title');
  const initial = await header.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    far: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).stroke,
    near: getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).stroke,
  }));
  await expect(header).toHaveAttribute('data-kasumi-mode', 'parallax');
  await expect(header).toHaveAttribute('data-kasumi-active', 'true');
  await expect(header.locator('[data-kasumi-layer]')).toHaveCount(2);
  await expect(title).toBeVisible();

  await page.evaluate(async () => {
    window.scrollTo({ top: 160, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const shifted = await header.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    far: node.style.getPropertyValue('--kasumi-far-shift'),
    near: node.style.getPropertyValue('--kasumi-near-shift'),
  }));
  expect(shifted.height).toBe(initial.height);
  expect(Number.parseFloat(shifted.far)).toBeGreaterThan(0);
  expect(Number.parseFloat(shifted.near)).toBeGreaterThan(Number.parseFloat(shifted.far));

  const url = page.url();
  const scrollTop = await page.evaluate(() => window.scrollY);
  await switchTheme(page, 'neon-japan');
  const neon = await header.evaluate((node) => ({
    far: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).stroke,
    near: getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).stroke,
    glow: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).filter,
  }));
  expect(neon.far).not.toBe(initial.far);
  expect(neon.near).not.toBe(initial.near);
  expect(neon.glow).toContain('drop-shadow');
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop);
});

test('TA-TRAVEL-112-02 @pr @post-deploy keeps a screen-reader-hidden static header with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTrip(page);
  const header = page.locator('[data-kasumi-header]');
  const decoration = page.getByTestId('kasumi-decoration');
  await expect(header).toHaveAttribute('data-kasumi-mode', 'reduced-motion');
  await expect(decoration).toHaveAttribute('aria-hidden', 'true');
  await expect(decoration.locator('svg')).toHaveCount(2);
  await expect(decoration.locator('svg').first()).toHaveAttribute('focusable', 'false');
  await page.evaluate(() => window.scrollTo(0, 180));
  expect(await header.evaluate((node) => ({
    far: node.style.getPropertyValue('--kasumi-far-shift'),
    near: node.style.getPropertyValue('--kasumi-near-shift'),
  }))).toEqual({ far: '', near: '' });
  await expect(page.getByTestId('trip-title')).toBeVisible();
  await page.locator('#menu-toggle').focus();
  await expect(page.locator('#menu-toggle')).toBeFocused();
  expect(await page.locator('#menu-toggle').evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
});

test('TA-TRAVEL-112-03 @pr @post-deploy uses the cached static low-power fallback offline', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
  });
  await openTrip(page);
  const header = page.locator('[data-kasumi-header]');
  await expect(header).toHaveAttribute('data-kasumi-mode', 'static-fallback');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
  await expect(page.getByTestId('kasumi-decoration')).toBeVisible();
  await expect(header).toHaveAttribute('data-kasumi-mode', 'static-fallback');
  expect(await header.evaluate((node) => ({
    far: node.style.getPropertyValue('--kasumi-far-shift'),
    near: node.style.getPropertyValue('--kasumi-near-shift'),
  }))).toEqual({ far: '', near: '' });
});
