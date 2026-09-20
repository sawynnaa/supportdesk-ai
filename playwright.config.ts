import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: 'pnpm dev',
    // Vite can listen before the API finishes seeding. Hitting health through the
    // proxy waits for both processes, otherwise the first login gets an empty 502.
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: { DATA_DIR: '.data/e2e', AI_MODE: 'mock', REAL_AI_ENABLED: 'false', AI_DAILY_LIMIT: '1000' },
  },
});
