import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenHomepageDiscovery, HOMEPAGE_FUNCTIONAL_MINIMUMS, HOMEPAGE_PERFORMANCE_REQUIRED, HOMEPAGE_WEBKIT_REQUIRED, HOMEPAGE_EARLY_CHROMIUM_REQUIRED, verifyHomepageDiscovery } from './lib/homepage-test-selection.mjs';
import { validateHomepageRuntime } from './check-homepage-runtime.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const fixture = (file, project, index) => ({ file, project, title: `case ${index}`, expectedStatus: 'passed', tags: [] });
const functional = ['chromium', 'webkit'].flatMap((project) => Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)
  .flatMap(([file, count]) => Array.from({ length: count }, (_, index) => fixture(file, project, index))));
const standard = functional.filter((test) => test.project === 'chromium');
const carousel = ['chromium', 'firefox', 'webkit'].flatMap((project) => Array.from({ length: 5 }, (_, index) => fixture('homepage-carousel-focused.spec.js', project, index)));
const performance = Object.entries(HOMEPAGE_PERFORMANCE_REQUIRED).flatMap(([file, titles]) => titles.map((title) => ({
  ...fixture(file, 'chromium-performance', 0), title, tags: ['homepage-performance'],
})));
const webkit = [...HOMEPAGE_WEBKIT_REQUIRED.map((title) => ({ ...fixture('homepage-hero-playback.spec.js', 'webkit', 0), title })), ...HOMEPAGE_EARLY_CHROMIUM_REQUIRED.map(title=>({...fixture('homepage-hero-playback.spec.js','chromium',0),title}))];
const valid = { standard, carousel, functional, webkit, performance };
assert.equal(verifyHomepageDiscovery(valid).existingCommandUnion, standard.length + 10);
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: [] }), /no tests/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, webkit: [] }), /no tests/);
for (let missing = 0; missing < webkit.length; missing += 1) {
  assert.throws(() => verifyHomepageDiscovery({ ...valid, webkit: webkit.filter((_, index) => index !== missing) }), /Early (WebKit|Chromium) selection is missing/);
}
assert.throws(() => verifyHomepageDiscovery({ ...valid, webkit: webkit.map((test) => ({ ...test, project: 'chromium' })) }), /native WebKit|Early WebKit selection is missing/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, webkit: webkit.map((test) => ({ ...test, expectedStatus: 'skipped' })) }), /native WebKit|Early WebKit selection is missing/);
for (let missing = 0; missing < performance.length; missing += 1) {
  assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.filter((_, index) => index !== missing) }), /required marked scenario/);
}
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map((test) => ({ ...test, tags: [] })) }), /required marked scenario/);
assert.ok(verifyHomepageDiscovery({ ...valid, performance: performance.map((test) => ({ ...test, tags: ['@homepage-performance'] })) }));
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map((test) => ({ ...test, project: 'chromium' })) }), /controlled Chromium/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map((test) => ({ ...test, expectedStatus: 'skipped' })) }), /statically skipped/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, carousel: carousel.filter((test) => test.project !== 'firefox') }), /Firefox|firefox/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, functional: functional.slice(1) }), /require at least/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, standard: [...standard, fixture('homepage-hero-playback.spec.js', 'chromium', 'new uncovered case')] }), /Early functional selection omits/);
assert.throws(() => flattenHomepageDiscovery({ suites: [], errors: [{ message: 'import failed' }] }), /discovery reported errors/);
assert.deepEqual(flattenHomepageDiscovery({ suites: [{ title: 'file.spec.js', file: 'file.spec.js', suites: [{ title: 'group', specs: [{ file: 'file.spec.js', title: 'case', tags: ['@homepage-performance'], tests: [{ projectName: 'chromium', expectedStatus: 'passed' }] }] }] }] }), [
  { file: 'file.spec.js', title: 'group > case', project: 'chromium', expectedStatus: 'passed', tags: ['@homepage-performance'] },
]);

const scripts = JSON.parse(read('package.json')).scripts;
assert.equal(scripts['test:static'], 'playwright test -c playwright.config.js');
assert.equal(scripts['test:homepage-carousel'], 'playwright test -c playwright.carousel.config.js');
assert.equal(scripts['test:homepage-functional'], 'playwright test -c playwright.homepage.config.js');
assert.equal(scripts['test:homepage-webkit'], 'playwright test -c playwright.homepage-webkit.config.js');
assert.equal(scripts['check:homepage-runtime'], 'node scripts/check-homepage-runtime.mjs');
assert.equal(scripts['test:homepage-performance'], 'playwright test -c playwright.homepage-performance.config.js');
assert.equal(scripts['check:homepage-selection'], 'node scripts/check-homepage-selection.mjs');
for (const file of ['playwright.homepage.config.js', 'playwright.homepage-webkit.config.js', 'playwright.homepage-performance.config.js']) {
  const config = require(path.join(root, file));
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.fullyParallel, false);
  assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.use.trace, file.includes('-performance.') ? 'off' : 'retain-on-failure');
}
const performanceConfig = require(path.join(root, 'playwright.homepage-performance.config.js'));
assert.equal(performanceConfig.projects.length, 1);
assert.equal(performanceConfig.projects[0].name, 'chromium-performance');
assert.equal(performanceConfig.projects[0].use.browserName, 'chromium');
assert.equal(performanceConfig.projects[0].metadata.homepagePerformanceMeasurement, true);
assert.equal(performanceConfig.projects[0].metadata.homepagePerformanceGate, undefined);
assert.ok(performanceConfig.grep.test('@homepage-performance'));
const earlyWebKit = require(path.join(root, 'playwright.homepage-webkit.config.js'));
assert.deepEqual(earlyWebKit.projects.map(p=>[p.name,p.use.browserName]), [['chromium','chromium'],['webkit','webkit']]);
for(const title of HOMEPAGE_EARLY_CHROMIUM_REQUIRED) assert.ok(earlyWebKit.projects[0].grep.test(title));
for (const title of HOMEPAGE_WEBKIT_REQUIRED) assert.ok(earlyWebKit.grep.test(title));
assert.equal(earlyWebKit.grep.test('unrelated scenario'), false);

// Synthetic checks exercise fail-closed conditions. They do not constitute a
// Linux/container/browser execution; that evidence is produced in the CI job.
const lockVersion = JSON.parse(read('package-lock.json')).packages['node_modules/@playwright/test'].version;
const runtime = {
  platform: 'linux', node: 'v22.23.1', uid: 1001, gid: 1001,
  privileges: { CapInh: '0000', CapPrm: '0000', CapEff: '0000', CapBnd: '0000', CapAmb: '0000', NoNewPrivs: '1' },
  playwright: lockVersion, lockVersion,
  docker: { driverVersion: lockVersion, dockerImageName: `mcr.microsoft.com/playwright:v${lockVersion}-noble` },
  browsers: { chromium: '/ms-playwright/chromium/chrome', firefox: '/ms-playwright/firefox/firefox', webkit: '/ms-playwright/webkit/pw_run.sh' },
};
validateHomepageRuntime(runtime);
for (const invalid of [{ uid: 0 }, { gid: 0 }, { node: 'v24.0.0' }, { platform: 'darwin' },
  { playwright: '0.0.0' }, { docker: { ...runtime.docker, driverVersion: '0.0.0' } },
  { browsers: { ...runtime.browsers, webkit: '/home/other/browser' } }]) {
  assert.throws(() => validateHomepageRuntime({ ...runtime, ...invalid }));
}
for (const field of Object.keys(runtime.privileges)) {
  assert.throws(() => validateHomepageRuntime({ ...runtime, privileges: { ...runtime.privileges, [field]: field === 'NoNewPrivs' ? '0' : '0001' } }));
}

function job(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Missing job ${name}`);
  return match[1];
}
for (const workflow of ['static.yml', 'full-regression.yml', 'ui-fast-deploy.yml']) {
  const text = read(`.github/workflows/${workflow}`);
  const early = job(text, 'homepage-validation');
  assert.ok(early.includes('npm run check:homepage-selection'));
  assert.ok(early.includes('npm run test:homepage-functional'));
  assert.ok(early.includes('npm run test:homepage-webkit'));
  assert.ok(early.indexOf('npm run test:homepage-webkit') < early.indexOf('npm run test:homepage-functional'));
  assert.ok(early.includes('npm run check:homepage-runtime'));
  assert.match(early, new RegExp(`image: mcr\\.microsoft\\.com/playwright:v${lockVersion.replace(/\./g, '\\.')}\-noble@sha256:[a-f0-9]{64}`));
  assert.ok(early.includes('--user 1001:1001'));
  assert.ok(early.includes('--cap-drop=ALL'));
  assert.ok(early.includes('--security-opt=no-new-privileges'));
  assert.ok(!/^\s+RUNNER_TOOL_CACHE:/m.test(early));
  assert.ok(early.includes('test -w "$RUNNER_TOOL_CACHE"'));
  assert.ok(early.includes('npm_config_cache: /tmp/bitbi-homepage-npm'));
  assert.ok(early.includes('node-version: 22'));
  assert.ok(early.includes('permissions:\n      contents: read'));
  assert.ok(!early.includes('pages: write') && !early.includes('secrets.'));
  assert.ok(!early.includes('playwright install') && !early.includes('apt-get') && !early.includes('sudo'));
  assert.ok(early.includes('npm run test:homepage-performance'));
  assert.ok(early.includes("steps.homepage_discovery.outcome == 'success'"));
  assert.ok(early.includes('if: always()'));
  assert.ok(early.includes('actions/upload-artifact@v6'));
  assert.ok(early.includes('test-results/homepage-*.json'));
  assert.ok(early.includes('test-results/homepage-webkit/'));
  assert.ok(early.includes('persist-credentials: false'));
  assert.ok(!early.includes('continue-on-error'));
  assert.ok(!early.match(/needs:.*(?:browser-|worker-)/));
  assert.ok(text.includes('npm run test:homepage-carousel'));
  if (workflow !== 'ui-fast-deploy.yml') assert.ok(text.includes('npm run test:static'));
  else assert.ok(text.includes('npm run test:homepage-core'));
  if (workflow !== 'full-regression.yml') {
    assert.match(job(text, 'deploy'), /needs: \[[^\]]*homepage-validation/);
  } else assert.ok(!text.includes('actions/deploy-pages'));
}
console.log('Homepage selection, no-zero, preserved commands and mandatory early workflow gates passed.');
