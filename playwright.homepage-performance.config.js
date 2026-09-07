const { defineConfig } = require('@playwright/test');

// Required timing diagnostics run on a separate, single-worker browser process.
// Functional/data-integrity failures remain hard failures; timing is evidence.
module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['homepage-carousel-focused.spec.js', 'homepage-performance-contract.spec.js'],
  grep: /@homepage-performance/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/homepage-performance.json' }],
    ['html', { outputFolder: 'playwright-report/homepage-performance', open: 'never' }],
  ],
  outputDir: 'test-results/homepage-performance',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    // Trace collection itself can create long tasks; JSON measurements and
    // failure screenshots remain available without tracing the timed page.
    trace: 'off',
    serviceWorkers: 'block',
  },
  projects: [{
    name: 'chromium-performance',
    use: { browserName: 'chromium' },
    metadata: { homepagePerformanceMeasurement: true },
  }],
  webServer: {
    command: 'npx serve -l 3000',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
