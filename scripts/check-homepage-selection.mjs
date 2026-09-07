import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flattenHomepageDiscovery, verifyHomepageDiscovery } from './lib/homepage-test-selection.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const output = path.join(root, 'test-results/homepage-discovery.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
const rawDirectory = fs.mkdtempSync(path.join(path.dirname(output), 'homepage-discovery-'));
const report = {
  status: 'failed',
  node: process.version,
  playwright: require('playwright/package.json').version,
  sourceCommit: process.env.GITHUB_SHA || null,
  collections: {},
  summary: null,
};
try {
  for (const [name, config] of Object.entries({
    standard: 'playwright.config.js',
    carousel: 'playwright.carousel.config.js',
    functional: 'playwright.homepage.config.js',
    webkit: 'playwright.homepage-webkit.config.js',
    performance: 'playwright.homepage-performance.config.js',
  })) {
    // Discovery does not start browsers, the web server or Playwright bodies.
    // The existing node:test mock import also writes TAP diagnostics to stdout;
    // keep that output separate from the actual JSON reporter artifact.
    const rawOutput = path.join(rawDirectory, `${name}.json`);
    const result = spawnSync(process.execPath, [cli, 'test', '-c', config, '--list', '--reporter=json'], {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: rawOutput },
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(rawDirectory, `${name}.log`), `${result.stdout || ''}${result.stderr || ''}`);
    assert.equal(result.status, 0, `${name} discovery failed: ${result.stderr || result.error?.message || result.stdout}`);
    report.collections[name] = flattenHomepageDiscovery(JSON.parse(fs.readFileSync(rawOutput, 'utf8')));
  }
  report.summary = verifyHomepageDiscovery(report.collections);
  report.status = 'passed';
  console.log('Homepage collection and preserved regression union:', JSON.stringify(report.summary));
} catch (error) {
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
