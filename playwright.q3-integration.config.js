const base = require('./playwright.config.js');

// Keep the real Node import and browser/MFA checks together via test:q3-integration.
// The normal Worker/static suites still collect these specs independently.
const scopes = [
  {
    name: 'mfa',
    testMatch: ['**/auth-admin.spec.js'],
    grep: /admin page (bootstraps MFA enrollment|blocks on MFA verification)/,
  },
  {
    name: 'admin',
    testMatch: [
      '**/oma2-q3-auth-lifecycle.spec.js',
      '**/oma2-q3-ai.spec.js',
      '**/oma2-q3-ai-compare-view.spec.js',
    ],
  },
];

module.exports = {
  ...base,
  retries: 0,
  projects: ['chromium', 'webkit'].flatMap((browserName) => scopes.map((scope) => ({
    ...scope,
    name: `${browserName}-${scope.name}`,
    use: { browserName },
  }))),
};
