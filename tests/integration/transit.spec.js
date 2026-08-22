import { test, expect } from '@playwright/test';

test('TA-TRAVEL-116-01 @pr renders ordered stop destinations and detailed multi-segment transit', async ({ page }) => {
  await page.goto('./#/trip/transit-example/v/1/day/arrival');
  await expect(page.getByTestId('activity-item').locator('h3')).toHaveText(['Lisbon Oriente', 'Cacilhas waterfront']);
  const transit = page.getByTestId('transit-item');
  await expect(transit).toContainText('Lisbon Oriente → Cacilhas ferry terminal');
  await expect(transit).toContainText('CP');
  await expect(transit).toContainText('Urban line');
  await expect(transit.getByRole('list', { name: 'Transit segments' })).toContainText('train');
  await expect(transit.getByRole('list', { name: 'Transit segments' })).toContainText('ferry');
  await expect(transit.getByRole('link', { name: /Open itinerary directions/i })).toHaveAttribute('href', /travelmode=transit/);
  const segments = transit.getByRole('list', { name: 'Transit segments' }).getByRole('listitem');
  await expect(segments.nth(0).getByRole('link', { name: /Open Lisbon Oriente in Google Maps/i })).toBeVisible();
  await expect(segments.nth(0).getByRole('link', { name: /Directions from Lisbon Oriente to Cais do Sodré/i })).toBeVisible();
  await expect(segments.nth(1).getByRole('link', { name: /Open Cais do Sodré in Google Maps/i })).toBeVisible();

  const tickets = page.locator('[data-attachment-scope="transit-example:transit:rail-ferry"]');
  await tickets.locator('input').setInputFiles({ name: 'rail-ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 transit ticket') });
  await expect(tickets).toContainText('rail-ticket.pdf');
  await page.reload();
  await expect(page.locator('[data-attachment-scope="transit-example:transit:rail-ferry"]')).toContainText('rail-ticket.pdf');
});

test('TA-TRAVEL-126-01 @pr exposes the offline-safe Day Overview map and ordered stop controls', async ({ page }) => {
  await page.goto('./#/trip/transit-example/v/1/day/arrival');
  await page.getByRole('button', { name: 'Day Overview' }).click();
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.locator('[aria-label="Ordered day stops"] > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Map' }).click();
  const map = page.locator('.day-overview-map');
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: /Lisbon Oriente/ })).toBeVisible();
  await expect(map.getByRole('button', { name: /Cacilhas waterfront/ })).toBeVisible();
  await expect(page.locator('[data-day-map-pin]')).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Accessible ordered day stops' })).toContainText('Lisbon Oriente');
});
