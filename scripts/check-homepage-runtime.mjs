import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// This verifies the existing official CI image; it neither installs browsers
// nor launches them. Native functional tests follow as a separate hard gate.
export function validateHomepageRuntime(state) {
  assert.equal(state.platform, 'linux', 'Homepage image check requires Linux');
  assert.match(state.node, /^v22\./, 'Repository test code requires Node 22');
  assert.ok(Number.isInteger(state.uid) && state.uid > 0 && Number.isInteger(state.gid) && state.gid > 0,
    'Homepage tests must run as an unprivileged user and group');
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.match(state.privileges[field] || '', /^0+$/, `${field} must be empty`);
  }
  assert.equal(state.privileges.NoNewPrivs, '1', 'Privilege reacquisition must be disabled');
  assert.equal(state.playwright, state.lockVersion, 'Installed Playwright must match package-lock');
  assert.equal(state.docker.driverVersion, state.lockVersion, 'Image browsers must match package-lock');
  assert.equal(state.docker.dockerImageName, `mcr.microsoft.com/playwright:v${state.lockVersion}-noble`,
    'Expected the versioned official Noble image');
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.ok(state.browsers[browser]?.startsWith('/ms-playwright/'), `${browser} must use the image browser`);
  }
}

export function validateHomepageMacRuntime(state) {
  assert.equal(state.platform, 'darwin', 'Native WebKit replacement requires macOS');
  assert.match(state.node, /^v22\./, 'Repository test code requires Node 22');
  assert.ok(state.uid > 0 && state.gid > 0, 'Native media must run without root');
  assert.equal(state.playwright, state.lockVersion, 'Installed Playwright must match package-lock');
  assert.ok(state.browsers.webkit && state.browsers.webkit.startsWith(state.browserRoot + path.sep), 'Use the installed private WebKit bundle');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const report = { status: 'failed', sourceCommit: process.env.GITHUB_SHA || null };
  const output = path.join(root, 'test-results/homepage-runtime.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    assert.ok(!Object.keys(process.env).some((name) => /^(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CF_API_TOKEN|STRIPE_.*(?:KEY|SECRET)|OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(name)
      && process.env[name]), 'Production provider credentials must not be passed into this job');
    const { chromium, firefox, webkit } = require('playwright');
    const mac = process.argv.includes('--macos');
    const proc = mac ? '' : fs.readFileSync('/proc/self/status', 'utf8');
    const privileges = Object.fromEntries(['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs']
      .map((name) => [name, proc.match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'))?.[1]]));
    Object.assign(report, {
      platform: process.platform, kernel: os.release(), node: process.version,
      uid: process.getuid(), gid: process.getgid(), privileges,
      playwright: require('playwright/package.json').version,
      lockVersion: JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
        .packages['node_modules/@playwright/test'].version,
      docker: mac ? null : JSON.parse(fs.readFileSync('/ms-playwright/.docker-info', 'utf8')),
      browserRoot: process.env.PLAYWRIGHT_BROWSERS_PATH,
      // Public executable paths only: Chromium's default headless-shell child
      // is verified by the required native launch, not by this file preflight.
      browsers: Object.fromEntries(Object.entries(mac ? { webkit } : { chromium, firefox, webkit })
        .map(([name, type]) => [name, type.executablePath()])),
    });
    if (mac) validateHomepageMacRuntime(report); else validateHomepageRuntime(report);
    for (const executable of Object.values(report.browsers)) fs.accessSync(executable, fs.constants.X_OK);
    for (const directory of (mac ? [root, process.env.HOME, process.env.TMPDIR] : [root, process.env.HOME, process.env.RUNNER_TOOL_CACHE, process.env.npm_config_cache])) {
      assert.ok(directory, 'Workspace, HOME and caches must be explicitly available');
      fs.accessSync(directory, fs.constants.W_OK);
    }
    report.status = 'passed';
    console.log(`${mac ? 'macOS WebKit' : 'Linux image'}: non-root Node 22, lock-matched browser and writable paths verified. Native tests follow.`);
  } catch (error) {
    report.error = error.message;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
}
