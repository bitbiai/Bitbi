const { test: pwTest } = require('@playwright/test');
const { register } = require('../helpers/rel01-admin-sqlite-contract.cjs');

register((name, run) => {
  pwTest(name, async () => {
    const cleanup = [];
    try {
      await run({ after: (fn) => cleanup.push(fn) });
    } finally {
      for (const fn of cleanup.reverse()) await fn();
    }
  });
});
