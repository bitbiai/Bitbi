const { defineConfig } = require('@playwright/test');
const base = require('./playwright.homepage.config');

// Not part of functional acceptance. macOS runs the same sources strictly.
module.exports = defineConfig({
  ...base,
  grepInvert: undefined,
  testMatch: ['homepage-native-control.spec.js'],
  projects: [{ name: 'webkit', use: { browserName: 'webkit' }, metadata: { nativeMediaDiagnostic: true } }],
  reporter: [['json', { outputFile: 'test-results/homepage-linux-diagnostic-tests.json' }]],
  outputDir: 'test-results/homepage-linux-diagnostic',
});
