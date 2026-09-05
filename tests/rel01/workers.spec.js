const { test: pwTest } = require('@playwright/test');
const { mock } = require('node:test');
const { register } = require('../helpers/rel01-sqlite-contract.cjs');

register((name, optionsOrRun, maybeRun) => {
  const options = typeof optionsOrRun === 'function' ? {} : optionsOrRun;
  const run = typeof optionsOrRun === 'function' ? optionsOrRun : maybeRun;
  pwTest(name, async () => {
    if (options.timeout) pwTest.setTimeout(options.timeout);
    const cleanup = [];
    const context = { after: (fn) => cleanup.push(fn), mock };
    try {
      await run(context);
    } finally {
      mock.reset();
      for (const fn of cleanup.reverse()) await fn();
    }
  });
});
