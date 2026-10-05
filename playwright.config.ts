import { defineConfig, devices } from '@playwright/test';

// Real-browser tests of the built demo site (the same files that are published), in Chromium, Firefox and WebKit.
// Run:  pnpm e2e   (builds the demo, serves it, runs every test in every browser)
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure', ignoreHTTPSErrors: true },
  webServer: {
    command: 'pnpm build:demo && pnpm exec vite preview --config vite.demo.config.ts --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
