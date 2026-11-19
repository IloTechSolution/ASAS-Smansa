import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke CBT — stack Docker (8080) atau dev server (5173) via CBT_ORIGIN.
 * Uji hanya alur baca (tanpa menulis data) agar dev DB tetap bersih.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.CBT_ORIGIN ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
