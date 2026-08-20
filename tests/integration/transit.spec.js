import { test, expect } from '@playwright/test';

const itinerary = {
  schemaVersion: '1.1.0', trip: { id: 'transit-timeline', title: 'Inter-city transit', startDate: '2026-10-01', endDate: '2026-10-01', timeZone: 'Europe/Berlin', days: [{ id: 'day', date: '2026-10-01', title: 'Transfer day', items: [
    { id: 'berlin', type: 'stop', title: 'Berlin Hbf', startsAt: '2026-10-01T08:00:00+02:00', location: 'Berlin Hbf' },
    { id: 'express', type: 'transit', title: 'ICE to Hamburg', fromStopId: 'berlin', toStopId: 'hamburg', from: { name: 'Berlin Hbf' }, to: { name: 'Hamburg Hbf' }, mode: 'train', departure: '2026-10-01T08:30:00+02:00', arrival: '2026-10-01T10:15:00+02:00', duration: '1 h 45 min', operator: 'DB', service: 'ICE 804', platform: '7', terminal: 'North hall', ticketRef: 'TICKET-77', segments: [{ id: 'platform-walk', mode: 'walk', from: { name: 'Main hall' }, to: { name: 'Platform 7' }, duration: '5 min' }, { id: 'ice', mode: 'train', from: { name: 'Berlin Hbf' }, to: { name: 'Hamburg Hbf' }, service: 'ICE 804' }] },
    { id: 'hamburg', type: 'stop', title: 'Hamburg Hbf', startsAt: '2026-10-01T10:20:00+02:00', location: 'Hamburg Hbf' }
  ] }] } };

test('TA-TRAVEL-116-01 @pr renders ordered stop destinations and detailed multi-segment transit', async ({ page }) => {
  await page.goto('./');
  await page.locator('#trip-import').setInputFiles({ name: 'transit.trailbook', mimeType: 'application/vnd.trailbook.itinerary+json', buffer: Buffer.from(JSON.stringify(itinerary)) });
  await page.getByRole('button', { name: 'Import and open trip' }).click();
  await page.getByRole('link', { name: /Transfer day/ }).click();
  await expect(page.getByTestId('activity-item').locator('h3')).toHaveText(['Berlin Hbf', 'Hamburg Hbf']);
  const transit = page.getByTestId('transit-item');
  await expect(transit).toContainText('Berlin Hbf → Hamburg Hbf');
  await expect(transit).toContainText('DB');
  await expect(transit).toContainText('ICE 804');
  await expect(transit.getByRole('list', { name: 'Transit segments' })).toContainText('walk');
  await expect(transit.getByRole('list', { name: 'Transit segments' })).toContainText('train');
});
