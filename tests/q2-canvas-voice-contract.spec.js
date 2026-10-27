const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

for (const part of ['settings', 'audio', 'provider', 'relay']) test(`Canvas Voice ${part} contract and failing counterexamples`, () => {
  const output = execFileSync(process.execPath, ['--test', path.join(__dirname, `canvas-voice-${part}.test.mjs`)], {
    encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 20000,
  });
  expect(output).toMatch(/# fail 0\b/);
  expect(output).toMatch(/# tests [1-9]\d*/);
  expect(output).toMatch(/# skipped 0\b/);
});
