const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  grepInvert: process.env.HOMEPAGE_EXTENDED === 'true' ? undefined : /@homepage-extended/,
  // Native video is mandatory in the dedicated Linux/macOS homepage jobs.
  testIgnore: ['**/homepage-hero-playback.spec.js', '**/homepage-native-control.spec.js', '**/workers.spec.js', '**/fable-chat-workers.spec.js', '**/admin-ai-save-operations.spec.js', '**/q4-*.spec.js'],
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
  ],
  webServer: {
    command: 'node tests/helpers/homepage-media-server.mjs',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
