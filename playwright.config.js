import { defineConfig, devices } from '@playwright/test';

const basePath = process.env.BASE_PATH ?? '/travel-app/';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:4173${basePath}`;
const isRemote = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/junit.xml', embedAnnotationsAsProperties: true }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: isRemote
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
