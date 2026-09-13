const base = require('./playwright.config.js');
const scopes = [
  { name: 'workspace', testMatch: ['**/smoke.spec.js'], grep: /Creation Workspace model help|Generate Lab renders the desktop member workspace with supported models|German Generate Lab shows HappyHorse video controls|Generate Lab shows session-expired recovery|appears on Admin with English-only organization guidance/ },
  { name: 'guidance', testMatch: ['**/locale.spec.js'], grep: /global Help Menu exposes localized content|member workspace navigation keeps English and German routes equivalent/ },
];
module.exports = {
  ...base, retries: 0, workers: 1, outputDir: 'test-results/workspace-artifacts',
  webServer: { ...base.webServer, reuseExistingServer: false },
  projects: ['chromium', 'webkit'].flatMap(browserName => scopes.map(scope => ({
    ...scope, name: `${browserName}-${scope.name}`, use: { browserName },
  }))),
};
