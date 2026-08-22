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

async function chooseTheme(page, theme) {
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await page.getByLabel('Theme').selectOption(theme);
}

async function attachmentProfile(panel) {
  return panel.evaluate((element) => {
    const parse = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color) => {
      const channels = parse(color).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrast = (foreground, background) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (lighter + .05) / (darker + .05);
    };
    const root = getComputedStyle(document.documentElement);
    const canvas = root.backgroundColor;
    const primaryProbe = document.createElement('span');
    primaryProbe.style.color = root.getPropertyValue('--color-primary').trim();
    document.body.append(primaryProbe);
    const primary = getComputedStyle(primaryProbe).color;
    primaryProbe.remove();
    const heading = element.querySelector('.attachment-heading');
    const empty = element.querySelector('.attachment-empty');
    const item = element.querySelector('.attachment-item');
    const title = element.querySelector('.attachment-title');
    const status = element.querySelector('.attachment-status');
    const picker = element.querySelector('.attachment-picker');
    return {
      backgrounds: [element, heading, empty, item].filter(Boolean).map((node) => getComputedStyle(node).backgroundColor),
      titleContrast: contrast(getComputedStyle(title).color, canvas),
      statusContrast: contrast(getComputedStyle(status).color, canvas),
      pickerColor: getComputedStyle(picker).color,
      primary,
    };
  });
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
  await expect(page.locator('[data-trip-id="weekend-lisbon"]').getByRole('link', { name: 'Open trip overview' })).toHaveText('Open');
  await expect(page.locator('[data-trip-id="weekend-lisbon"]').getByRole('button', { name: 'Remove saved trip' })).toHaveText('Remove');
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

test('attachments remain transparent, readable, and theme-token based in empty, populated, and error states', async ({ page }) => {
  for (const theme of ['sakura', 'neon-japan']) {
    await page.goto(dayUrl);
    await chooseTheme(page, theme);
    const dayPanel = page.locator('[data-attachment-scope="weekend-lisbon:day:arrival"]');
    const stopPanel = page.locator('[data-attachment-scope="weekend-lisbon:stop:tram"]');

    for (const panel of [dayPanel, stopPanel]) {
      const profile = await attachmentProfile(panel);
      expect(profile.backgrounds.every((value) => value === 'rgba(0, 0, 0, 0)')).toBeTruthy();
      expect(profile.titleContrast).toBeGreaterThanOrEqual(4.5);
      expect(profile.statusContrast).toBeGreaterThanOrEqual(4.5);
      expect(profile.pickerColor).toBe(profile.primary);
    }

    const file = { name: `${theme}.txt`, mimeType: 'text/plain', buffer: Buffer.from('local document') };
    await dayPanel.locator('input').setInputFiles(file);
    await expect(dayPanel.locator('.attachment-item').first()).toBeVisible();
    expect((await attachmentProfile(dayPanel)).backgrounds.every((value) => value === 'rgba(0, 0, 0, 0)')).toBeTruthy();
    await dayPanel.locator('input').setInputFiles(file);
    const error = page.locator('.attachment-error');
    await expect(error).toBeVisible();
    const errorStyle = await error.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, radius: style.borderRadius, shadow: style.boxShadow };
    });
    expect(errorStyle.radius).toBe('0px');
    expect(errorStyle.shadow).toBe('none');
    if (theme === 'neon-japan') {
      const channels = (errorStyle.background.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      expect(Math.max(...channels)).toBeLessThan(80);
    }
  }
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'pixel-7', width: 412, height: 915 },
]) {
  test(`${viewport.name} renders one continuous timeline spine through three activities`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(dayUrl);
    const timeline = page.locator('.timeline');
    await expect(timeline.locator('.activity')).toHaveCount(3);
    await expect(timeline.locator(':scope > .timeline-spine')).toHaveCount(1);
    await expect(timeline.locator('.timeline-node')).toHaveCount(3);
    await expect.poll(() => timeline.evaluate((element) => {
      const spine = element.querySelector('.timeline-spine').getBoundingClientRect();
      return spine.height;
    })).toBeGreaterThan(100);

    const geometry = await timeline.evaluate((element) => {
      const spine = element.querySelector('.timeline-spine').getBoundingClientRect();
      const nodes = [...element.querySelectorAll('.timeline-node')].map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      const itemSegments = [...element.querySelectorAll('.activity')].map((item) => getComputedStyle(item, '::before').content);
      return { spine: { left: spine.left, right: spine.right, top: spine.top, bottom: spine.bottom }, nodes, itemSegments };
    });
    const axis = (geometry.spine.left + geometry.spine.right) / 2;
    expect(Math.abs(geometry.spine.top - geometry.nodes[0].y)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.spine.bottom - geometry.nodes.at(-1).y)).toBeLessThanOrEqual(1);
    expect(geometry.nodes.every((node) => Math.abs(node.x - axis) <= 1)).toBeTruthy();
    expect(geometry.itemSegments.every((content) => content === 'none')).toBeTruthy();
    for (let index = 1; index < geometry.nodes.length; index += 1) {
      expect(geometry.spine.top).toBeLessThan(geometry.nodes[index - 1].y);
      expect(geometry.spine.bottom).toBeGreaterThanOrEqual(geometry.nodes[index].y - 1);
    }
    await expectNoPageOverflow(page);
  });
}

test('day route UI is absent while Day Overview remains ordered and offline navigable', async ({ page, context }) => {
  await page.goto('./#/trip/weekend-lisbon/v/1/day/river-day');
  await expect(page.getByTestId('selected-day-title')).toHaveText('Belém & the river');
  await expect(page.locator('.timeline .activity')).toHaveCount(3);
  const mapRoute = page.getByRole('button', { name: 'Day Overview' });
  await expect(mapRoute).toBeVisible();
  await expect(page.locator('[data-view-day-route], #day-route')).toHaveCount(0);
  await expect(page.getByText('Day route', { exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await mapRoute.click();
  const route = page.locator('ol.route-stop-list[aria-label="Ordered day stops"]');
  await expect(route.locator(':scope > li')).toHaveCount(3);
  await expect(route.locator(':scope > li')).toHaveText([
    /Jerónimos Monastery/,
    /Jardim de Belém/,
    /MAAT Lisbon/,
  ]);
  await expect(page.getByRole('button', { name: 'Map' })).toBeVisible();
  await expect(page.locator('#network-status')).toContainText('Offline');
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
    await page.getByRole('button', { name: 'Day Overview' }).click();
    await expect(page.getByTestId('primary-content').getByRole('heading', { name: 'Day Overview' })).toBeVisible();
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
