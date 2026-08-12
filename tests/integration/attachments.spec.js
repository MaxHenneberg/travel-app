import { expect, test } from '@playwright/test';

async function openTrip(page, day = '') {
  await page.goto(`./#/trip/weekend-lisbon/v/1${day ? `/day/${day}` : ''}`);
  await expect(page.getByRole('heading', { name: 'A long weekend in Lisbon' })).toBeVisible();
}

const pdf = { name: 'ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 local ticket') };

test('TA-TRAVEL-89-01 @pr attaches and accesses files at trip, day, and stop scope', async ({ page }) => {
  await openTrip(page);
  await page.locator('[data-attachment-scope="weekend-lisbon:trip:weekend-lisbon"] input').setInputFiles(pdf);
  await expect(page.getByText('ticket.pdf', { exact: true }).first()).toBeVisible();
  await openTrip(page, 'arrival');
  await expect(page.getByText('ticket.pdf', { exact: true })).toHaveCount(0);
  const dayPanel = page.locator('[data-attachment-scope="weekend-lisbon:day:arrival"]');
  await dayPanel.locator('input').setInputFiles({ name: 'boarding.pkpass', mimeType: 'application/vnd.apple.pkpass', buffer: Buffer.from('PK pass') });
  await expect(dayPanel.locator('.attachment-name')).toHaveText('boarding.pkpass');
  const stopPanel = page.locator('[data-attachment-scope="weekend-lisbon:stop:tram"]');
  await stopPanel.locator('input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('offline notes') });
  await expect(stopPanel.locator('.attachment-name')).toHaveText('notes.txt');
  page.once('dialog', (dialog) => dialog.accept('Tram ticket')); await stopPanel.getByRole('button', { name: 'Edit label' }).click();
  await expect(stopPanel.getByText('Tram ticket')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test('TA-TRAVEL-89-02 @pr @post-deploy reopens local attachments offline without requests', async ({ page, context }) => {
  await openTrip(page);
  await page.locator('[data-attachment-scope="weekend-lisbon:trip:weekend-lisbon"] input').setInputFiles(pdf);
  await page.reload(); await expect(page.locator('.attachment-name')).toHaveText('ticket.pdf');
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.attachment-name')).toHaveText('ticket.pdf');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('ticket.pdf', { exact: true })).toHaveCount(0);
});

test('TA-TRAVEL-89-03 @pr enforces errors and deterministic confirmed cleanup', async ({ page }) => {
  await openTrip(page);
  const panel = page.locator('[data-attachment-scope="weekend-lisbon:trip:weekend-lisbon"]');
  await panel.locator('input').setInputFiles(pdf);
  await panel.locator('input').setInputFiles(pdf);
  await expect(page.getByRole('alert')).toContainText('already attached');
  await panel.locator('input').setInputFiles({ name: 'large.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('per-file limit');
  page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: /Clear all/ }).click();
  await expect(page.locator('.attachment-name')).toHaveText('ticket.pdf');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: /Clear all/ }).click();
  await expect(page.locator('.attachment-name')).toHaveCount(0);
});

test('TA-TRAVEL-89-04 @pr blocks unsafe execution and attachment leakage', async ({ page }) => {
  await openTrip(page);
  const panel = page.locator('[data-attachment-scope="weekend-lisbon:trip:weekend-lisbon"]');
  await panel.locator('input').setInputFiles({ name: '../evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><script>window.pwned=1</script></svg>') });
  await expect(page.getByRole('alert')).toContainText('not supported');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await panel.locator('input').setInputFiles({ name: '<b>private.txt</b>', mimeType: 'text/plain', buffer: Buffer.from('SECRET-BYTES') });
  await expect(panel.locator('b')).toHaveCount(0);
  const sharedUrl = await page.getByRole('button', { name: 'Share this trip' }).evaluate(async (button) => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.shared = data; } });
    button.click(); await new Promise((resolve) => setTimeout(resolve)); return window.shared.url;
  });
  expect(sharedUrl).not.toContain('private'); expect(sharedUrl).not.toContain('SECRET');
});
