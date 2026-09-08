const base = require('./playwright.homepage.config');
// Required native-video replacement platform: GitHub macOS, not Linux WebKit.
// Linux retains Chromium video and WebKit's non-decoder homepage functions.
module.exports = {
  ...base,
  testMatch: ['homepage-hero-playback.spec.js', 'homepage-native-control.spec.js'],
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  reporter: [['list'], ['json', { outputFile: 'test-results/homepage-webkit.json' }]],
  outputDir: 'test-results/homepage-webkit',
};
