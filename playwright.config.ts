import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4199',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4199',
      url: 'http://127.0.0.1:4199',
      reuseExistingServer: !process.env.CI,
    },
    {
      // A local PostgreSQL (PGlite) running the real migrations behind the same RPC names; used only by sharing tests.
      command: 'node scripts/test-gateway.mjs',
      url: 'http://127.0.0.1:4310/__health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
