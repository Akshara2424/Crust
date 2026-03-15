import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:   './tests',
  fullyParallel: false,   // run serially — tests share mock server state
  forbidOnly: !!process.env.CI,
  retries:    process.env.CI ? 2 : 0,
  workers:    1,
  timeout:    30_000,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL:       'http://localhost:3000',
    trace:         'on-first-retry',
    screenshot:    'only-on-failure',
    video:         'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name:  'chromium',
      use:   { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the demo-app dev server before tests if not already running
  webServer: {
    command:            'npm run dev:server',
    cwd:                '../demo-app',
    url:                'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout:            30_000,
    env: {
      CRUST_PUBLIC_KEY_PEM:  process.env.CRUST_PUBLIC_KEY_PEM ?? '',
      CRUST_SERVICE_URL:     'http://localhost:8000',
      NODE_ENV:              'test',
      PORT:                  '3000',
    },
  },
});
