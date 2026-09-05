const { test: pwTest } = require('@playwright/test');
const { register } = require('../helpers/release-transition-legacy-contract.cjs');

register((name, options, run) => {
  pwTest(name, async () => {
    if (options.timeout) pwTest.setTimeout(options.timeout);
    const cleanup = [];
    try {
      await run({ after: (fn) => cleanup.push(fn) });
    } finally {
      for (const fn of cleanup.reverse()) await fn();
    }
  });
});
