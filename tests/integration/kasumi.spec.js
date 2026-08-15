import { expect, test } from '@playwright/test';

const tripUrl = './#/trip/weekend-lisbon/v/1/day/arrival';

async function openTrip(page) {
  await page.goto(tripUrl);
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
  await expect(page.getByTestId('kasumi-decoration')).toHaveCount(1);
}

async function switchTheme(page, theme, expectedScrollTop) {
  await page.locator('#menu-toggle').click();
  if (expectedScrollTop !== undefined) expect(await page.evaluate(() => window.scrollY)).toBe(expectedScrollTop);
  await page.getByLabel('Theme').selectOption(theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test('TA-TRAVEL-112-01 @pr @post-deploy renders two theme-aware Kasumi depths with bounded scroll parallax', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
  });
  if (testInfo.project.name === 'chromium') await page.setViewportSize({ width: 1265, height: 900 });
  await openTrip(page);
  const stage = page.locator('[data-kasumi-stage]');
  const header = page.locator('.hero');
  const title = page.getByTestId('trip-title');
  const initial = await stage.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    bottom: node.getBoundingClientRect().bottom,
    height: node.getBoundingClientRect().height,
    width: node.getBoundingClientRect().width,
    position: getComputedStyle(node).position,
    layerWidth: node.querySelector('[data-kasumi-layer="far"]').getBoundingClientRect().width,
    far: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).stroke,
    near: getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).stroke,
    farStrokeWidth: Number.parseFloat(getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).strokeWidth),
    nearStrokeWidth: Number.parseFloat(getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).strokeWidth),
    scale: (() => {
      const matrix = node.querySelector('[data-kasumi-layer="far"]').getScreenCTM();
      return { x: Math.hypot(matrix.a, matrix.b), y: Math.hypot(matrix.c, matrix.d) };
    })(),
  }));
  const headerBounds = await header.boundingBox();
  await expect(stage).toHaveAttribute('data-kasumi-mode', 'parallax');
  await expect(stage).toHaveAttribute('data-kasumi-active', 'true');
  await expect(stage.locator('[data-kasumi-layer]')).toHaveCount(2);
  await expect(stage.locator('[data-kasumi-layer]').first()).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice');
  await expect(title).toBeVisible();
  expect(initial.position).toBe('fixed');
  expect(initial.top).toBe(0);
  expect(initial.bottom).toBeGreaterThan(headerBounds.y + headerBounds.height + 100);
  expect(initial.layerWidth).toBeGreaterThanOrEqual(initial.width * 1.05);
  expect(Math.abs(initial.scale.x - initial.scale.y)).toBeLessThan(.02);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));

  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1920, height: 900 });
    const wide = await stage.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      layerWidth: node.querySelector('[data-kasumi-layer="far"]').getBoundingClientRect().width,
      farStrokeWidth: Number.parseFloat(getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).strokeWidth),
      nearStrokeWidth: Number.parseFloat(getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).strokeWidth),
    }));
    expect(wide.width).toBeGreaterThan(initial.width * 1.45);
    expect(wide.layerWidth).toBeGreaterThan(initial.layerWidth * 1.45);
    expect(wide.farStrokeWidth).toBeGreaterThan(initial.farStrokeWidth);
    expect(wide.nearStrokeWidth).toBeGreaterThan(initial.nearStrokeWidth);
    await page.setViewportSize({ width: 1265, height: 900 });
  }

  await page.mouse.wheel(0, 160);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(140);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shifted = await stage.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    far: node.style.getPropertyValue('--kasumi-far-shift'),
    near: node.style.getPropertyValue('--kasumi-near-shift'),
    farTransform: new DOMMatrixReadOnly(getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).transform).m42,
    nearTransform: new DOMMatrixReadOnly(getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).transform).m42,
  }));
  expect(shifted.height).toBe(initial.height);
  expect(Number.parseFloat(shifted.far)).toBeGreaterThanOrEqual(8);
  expect(Number.parseFloat(shifted.near)).toBeGreaterThanOrEqual(22);
  expect(shifted.farTransform).toBeGreaterThanOrEqual(8);
  expect(shifted.nearTransform - shifted.farTransform).toBeGreaterThanOrEqual(14);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.wheel(0, 1081);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1000);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const deepScroll = await stage.evaluate((node) => ({
    active: node.dataset.kasumiActive,
    top: node.getBoundingClientRect().top,
    bottom: node.getBoundingClientRect().bottom,
    farTransform: new DOMMatrixReadOnly(getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).transform).m42,
    nearTransform: new DOMMatrixReadOnly(getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).transform).m42,
  }));
  expect(deepScroll.active).toBe('true');
  expect(deepScroll.top).toBe(0);
  expect(deepScroll.bottom).toBe(initial.height);
  expect(deepScroll.farTransform).toBeGreaterThanOrEqual(50);
  expect(deepScroll.nearTransform - deepScroll.farTransform).toBeGreaterThanOrEqual(80);
  const url = page.url();
  const scrollTop = await page.evaluate(() => window.scrollY);
  await switchTheme(page, 'neon-japan', scrollTop);
  const neon = await stage.evaluate((node) => ({
    far: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).stroke,
    near: getComputedStyle(node.querySelector('[data-kasumi-layer="near"]')).stroke,
    glow: getComputedStyle(node.querySelector('[data-kasumi-layer="far"]')).filter,
  }));
  expect(neon.far).not.toBe(initial.far);
  expect(neon.near).not.toBe(initial.near);
  expect(neon.glow).toContain('drop-shadow');
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop);

  await page.goto('./');
  await expect(page.locator('.collection-hero')).toBeVisible();
  await expect(page.locator('[data-kasumi-stage]')).toHaveCount(1);
  await page.locator('[data-bottom-section="history"]').click();
  await expect(page.locator('.utility-hero')).toBeVisible();
  await expect(page.locator('[data-kasumi-stage]')).toHaveCount(1);
});

test('TA-TRAVEL-112-02 @pr @post-deploy keeps a screen-reader-hidden static page stage with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTrip(page);
  const stage = page.locator('[data-kasumi-stage]');
  const decoration = page.getByTestId('kasumi-decoration');
  await expect(stage).toHaveAttribute('data-kasumi-mode', 'reduced-motion');
  await expect(decoration).toHaveAttribute('aria-hidden', 'true');
  await expect(decoration.locator('svg')).toHaveCount(2);
  await expect(decoration.locator('svg').first()).toHaveAttribute('focusable', 'false');
  await page.evaluate(() => window.scrollTo(0, 1081));
  expect(await stage.evaluate((node) => ({
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
  const stage = page.locator('[data-kasumi-stage]');
  await expect(stage).toHaveAttribute('data-kasumi-mode', 'static-fallback');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('selected-day-title')).toBeVisible();
  await expect(page.getByTestId('kasumi-decoration')).toBeVisible();
  await expect(stage).toHaveAttribute('data-kasumi-mode', 'static-fallback');
  expect(await stage.evaluate((node) => ({
    far: node.style.getPropertyValue('--kasumi-far-shift'),
    near: node.style.getPropertyValue('--kasumi-near-shift'),
  }))).toEqual({ far: '', near: '' });
});
