const base = require('./playwright.config.js');
module.exports = {
  ...base, webServer: {...base.webServer, reuseExistingServer: false}, retries: 0, workers: 1, outputDir: 'test-results/public-media-artifacts',
  projects: [...['chromium','webkit'].flatMap(browserName => [
    { name: `${browserName}-dialog`, testMatch: ['**/public-media-dialog.spec.js'], use: { browserName } },
    { name: `${browserName}-neighbors`, testMatch: ['**/smoke.spec.js','**/auth-admin.spec.js'],
      grep: /public media details overlays fit|public media comments submit|Mempic modal shows details|Sound Lab cover opens media details/, use: { browserName } },
  ]), { name:'file-contract', testMatch:['**/workers.spec.js'], testIgnore:[], grep:/public Memvid file and poster routes/ }],
};
