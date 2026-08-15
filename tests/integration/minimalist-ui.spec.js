import { expect, test } from '@playwright/test';

const tripOverviewUrl = './#/trip/weekend-lisbon/v/1';
const dayUrl = './#/trip/weekend-lisbon/v/1/day/arrival';

async function surfaceProfile(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      radius: style.borderRadius,
      shadow: style.boxShadow,
    };
  });
}

async function expectNoPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
}

test('collection uses one flat list instead of nested cards', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Trip collection' })).toBeVisible();

  const heading = await surfaceProfile(page.locator('.collection-heading'));
  expect(heading).toMatchObject({ radius: '0px', shadow: 'none' });
  expect(heading.borders).toEqual(['0px', '0px', '1px', '0px']);

  const trip = await surfaceProfile(page.locator('.trip-card').first());
  expect(trip).toMatchObject({ radius: '0px', shadow: 'none' });
  expect(trip.borders).toEqual(['0px', '0px', '1px', '0px']);
  await expect(page.getByRole('link', { name: 'Open trip overview' })).toHaveText('Open');
  await expect(page.getByRole('button', { name: 'Remove saved trip' })).toHaveText('Remove');
});

test('overview, timeline and attachments avoid card-in-card elevation', async ({ page }) => {
  await page.goto(tripOverviewUrl);
  await expect(page.getByTestId('trip-overview')).toBeVisible();

  for (const selector of ['.trip-overview', '.overview-day-card', '.attachments']) {
    const profile = await surfaceProfile(page.locator(selector).first());
    expect(profile.radius).toBe('0px');
    expect(profile.shadow).toBe('none');
  }
  expect((await surfaceProfile(page.locator('.overview-day-card').first())).borders)
    .toEqual(['0px', '0px', '1px', '0px']);
  expect((await surfaceProfile(page.locator('.attachments').first())).borders)
    .toEqual(['1px', '0px', '0px', '0px']);

  await page.goto(dayUrl);
  await expect(page.getByTestId('activity-item').first()).toBeVisible();
  const activity = await surfaceProfile(page.locator('.activity-card').first());
  expect(activity).toMatchObject({
    borders: ['0px', '0px', '0px', '0px'],
    radius: '0px',
    shadow: 'none',
  });
  expect(await page.locator('.activity-card').first().evaluate((element) => {
    let elevatedAncestors = 0;
    for (let current = element.parentElement; current; current = current.parentElement) {
      if (getComputedStyle(current).boxShadow !== 'none') elevatedAncestors += 1;
    }
    return elevatedAncestors;
  })).toBe(0);
});

for (const viewport of [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'intermediate', width: 900, height: 900 },
  { name: 'pixel-7', width: 412, height: 915 },
]) {
  test(`${viewport.name} keeps compact controls usable without page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(dayUrl);
    await expect(page.getByTestId('selected-day-title')).toBeVisible();
    await expectNoPageOverflow(page);

    const targets = await page.locator('button, .button, summary, .external-links a, .stop-picture figcaption a, .brand')
      .evaluateAll((nodes) => nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      }).map((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height, name: node.getAttribute('aria-label') || node.textContent?.trim() };
      }));
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
  });
}

test('route and history reuse the flat reading surface in both themes', async ({ page }) => {
  await page.goto(tripOverviewUrl);
  for (const theme of ['sakura', 'neon-japan']) {
    await page.getByRole('button', { name: 'Open app menu' }).click();
    await page.getByLabel('Theme').selectOption(theme);
    await page.getByRole('button', { name: 'Map-Route' }).click();
    await expect(page.getByTestId('primary-content').getByRole('heading', { name: 'Map-Route' })).toBeVisible();
    expect(await surfaceProfile(page.locator('.route-view'))).toMatchObject({
      borders: ['0px', '0px', '0px', '0px'],
      radius: '0px',
      shadow: 'none',
    });
    expect(Number(await page.locator('.utility-main').evaluate((element) => getComputedStyle(element).zIndex)))
      .toBeGreaterThan(0);
    await expectNoPageOverflow(page);

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByRole('heading', { name: 'Visited countries' })).toBeVisible();
    expect(await surfaceProfile(page.locator('.country-history'))).toMatchObject({
      borders: ['0px', '0px', '0px', '0px'],
      radius: '0px',
      shadow: 'none',
    });
    await expectNoPageOverflow(page);
  }
});

test('error and empty states stay concise above the Kasumi stage', async ({ page }) => {
  await page.goto('./#/trip/not-published/v/1');
  await expect(page.getByRole('heading', { name: 'Itinerary unavailable' })).toBeVisible();
  const errorMessage = await page.locator('.error-card > p:not(.eyebrow)').innerText();
  expect(errorMessage.length).toBeLessThan(80);
  expect(errorMessage).not.toContain('<!doctype');
  expect(Number(await page.locator('.single-column').evaluate((element) => getComputedStyle(element).zIndex)))
    .toBeGreaterThan(0);
  expect((await surfaceProfile(page.locator('.error-card'))).shadow).toBe('none');
  await expectNoPageOverflow(page);

  await page.goto('./#/trip/weekend-lisbon/v/1/day/departure');
  await expect(page.getByTestId('empty-day')).toHaveText('No plans yet');
  expect((await surfaceProfile(page.locator('.day-panel'))).shadow).toBe('none');
  await expectNoPageOverflow(page);
});
