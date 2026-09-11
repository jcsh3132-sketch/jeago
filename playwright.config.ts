import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  webServer: { command: 'node scripts/browser-server.mjs', url: 'http://127.0.0.1:3100/health', reuseExistingServer: false, timeout: 60000 },
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
});
