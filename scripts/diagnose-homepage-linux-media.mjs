import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
if (process.platform !== 'linux') throw new Error('This diagnosis requires the existing Linux browser runner');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const reportFile = 'test-results/homepage-linux-diagnostic-tests.json';
fs.mkdirSync('test-results', { recursive: true });
fs.rmSync(reportFile, { force: true });
const log = fs.openSync('test-results/homepage-linux-diagnostic.log', 'w');
let timedOut = false, launchError = null;
// Direct file output cannot deadlock on inherited pipes. Only this diagnostic
// process group is stopped; mandatory test processes run in preceding steps.
const child = spawn(process.execPath, [cli, 'test', '-c', 'playwright.homepage-linux-diagnostic.config.js'], {
  detached: true, stdio: ['ignore', log, log],
});
const stopGroup = () => {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
const timer = setTimeout(() => { timedOut = true; stopGroup(); }, 60_000);
const run = await new Promise(resolve => {
  child.once('error', error => { launchError = error.code; });
  child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
});
clearTimeout(timer);
stopGroup(); // Also removes a server left behind by a failed diagnosis.
fs.closeSync(log);
const record = { kind: 'linux-webkit-diagnostic-only', commit: process.env.GITHUB_SHA || null,
  ...run, error: launchError,
  outcome: timedOut ? 'diagnosis-timeout' : run.exitCode === 0 ? 'observations-recorded-not-acceptance' : 'diagnosis-incomplete',
  report: fs.existsSync(reportFile) ? reportFile : null };
fs.writeFileSync('test-results/homepage-linux-diagnostic.json', JSON.stringify(record, null, 2) + '\n');
console.log('Linux media diagnosis (not a functional pass):', JSON.stringify(record));
// A launch failure is tooling failure; bounded media/browser divergence remains
// visible evidence, separate from the mandatory Linux and macOS jobs.
if (launchError) process.exitCode = 1;
