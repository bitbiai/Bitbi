const { defineConfig } = require('@playwright/test');

// Short, mandatory functional feedback. The existing full suites remain intact.
module.exports = defineConfig({
  testDir: './tests',
  testMatch: [
    'homepage-carousel-focused.spec.js',
    'homepage-creation-stream-anchor.spec.js',
    'homepage-hero-playback.spec.js',
    'homepage-hero-state.spec.js',
    'homepage-media-loading.spec.js',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/homepage-functional.json' }],
    ['html', { outputFolder: 'playwright-report/homepage-functional', open: 'never' }],
  ],
  outputDir: 'test-results/homepage-functional',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx serve -l 3000',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
