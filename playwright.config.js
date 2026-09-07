import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 45000, fullyParallel: false, workers: 1,
  use: { headless: true, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
});
