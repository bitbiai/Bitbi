const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  grepInvert: process.env.HOMEPAGE_EXTENDED === 'true' ? undefined : /@homepage-extended/,
  // Native video is mandatory in the dedicated Linux/macOS homepage jobs.
  testIgnore: ['**/appearance.spec.js', '**/model-pricing.spec.js', '**/admin-model-status.spec.js', '**/homepage-hero-playback.spec.js', '**/homepage-native-control.spec.js', '**/workers.spec.js', '**/fable-chat-workers.spec.js', '**/admin-ai-save-operations.spec.js', '**/q4-*.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    { name: 'webkit-appearance', testMatch: ['**/oma2-q3-appearance.spec.js', '**/auth-admin.spec.js'], grep: /oma2-q3-appearance\.spec\.js|cold workspace exposes grouped tasks/, use: { browserName: 'webkit' } },
    { name: 'webkit-pricing', testMatch: ['**/oma2-q3-model-pricing.spec.js'], use: { browserName: 'webkit' } },
    {
      name: 'webkit-canvas',
      testMatch: ['**/canvas.spec.js', '**/oma2-q1-canvas.spec.js', '**/auth-admin.spec.js', '**/smoke.spec.js'],
      grep: /Canvas|P13|@canvas-model-ui/,
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command: `node tests/helpers/homepage-media-server.mjs ${process.env.STATIC_TEST_ROOT || '.'}`,
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
