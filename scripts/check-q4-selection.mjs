import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', '-c', 'playwright.workers.config.js', 'tests/q4-', '--list', '--reporter=json'], {
  cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
assert.equal(result.status, 0, `Q4 discovery failed: ${result.stderr}`);
const report = JSON.parse(result.stdout), counts = new Map();
function visit(suite) {
  for (const spec of suite.specs || []) {
    const file = path.basename(spec.file);
    for (const test of spec.tests) {
      assert.notEqual(test.expectedStatus, 'skipped', `Skipped mandatory Q4 case: ${spec.title}`);
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  }
  for (const child of suite.suites || []) visit(child);
}
for (const suite of report.suites) visit(suite);
for (const [file, minimum] of [
  ['q4-subscription.spec.js', 30], ['q4-subscription-legacy.spec.js', 20], ['q4-video-jobs.spec.js', 14],
  ['q4-memory.spec.js', 20], ['q4-stream-receipts.spec.js', 10], ['q4-stream-selection.spec.js', 3],
]) assert.ok((counts.get(file) || 0) >= minimum, `${file}: discovered ${counts.get(file) || 0}, require at least ${minimum}`);
console.log('Q4 normal Worker discovery:', JSON.stringify(Object.fromEntries(counts)));
