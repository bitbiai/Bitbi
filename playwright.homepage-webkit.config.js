const { defineConfig } = require('@playwright/test');
const functional = require('./playwright.homepage.config');

// Plain-element transport controls and the four previously failing native
// Linux/WebKit paths run before the wider matrix. They remain in that matrix;
// replacing the required functional coverage.
module.exports = defineConfig({
  ...functional,
  testMatch: ['homepage-hero-playback.spec.js'],
  grep: /native plain video|fallback freezes media|phone and tablet breakpoints/,
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/homepage-webkit.json' }],
    ['html', { outputFolder: 'playwright-report/homepage-webkit', open: 'never' }],
  ],
  outputDir: 'test-results/homepage-webkit',
});
