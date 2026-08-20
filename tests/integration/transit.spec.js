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
});
