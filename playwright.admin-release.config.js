const base = require('./playwright.config.js');

// Existing scenarios, scoped by product risk. All reader cases run in both
// engines; unchanged decorative decoder/race suites remain in Full regression.
const scopes = [
  { name: 'reader', testMatch: ['**/oma2-q3-newsfeed.spec.js', '**/oma2-q3-shell.spec.js', '**/oma2-q3-auth-lifecycle.spec.js'] },
  { name: 'mfa', testMatch: ['**/auth-admin.spec.js'], grep: /admin page (bootstraps MFA enrollment|blocks on MFA verification)/ },
  { name: 'smoke', testMatch: ['**/smoke.spec.js'], grep: /logged-out desktop homepages hide Live Pulse|MODELS opens the homepage models overlay from the mobile navigation/ },
];
module.exports = {
  ...base,
  retries: 0,
  workers: 1,
  projects: ['chromium', 'webkit'].flatMap(browserName => scopes.map(scope => ({
    ...scope, name: `${browserName}-${scope.name}`, use: { browserName },
  }))),
};
