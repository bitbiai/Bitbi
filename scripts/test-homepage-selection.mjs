import { releaseValidationSource } from './lib/release-validation-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenHomepageDiscovery, HOMEPAGE_CORE_FILES, CANVAS_WEBKIT_FILES, CANVAS_RELEASE_SCOPES, canvasReleaseProject, verifyCanvasReleaseDiscovery, verifyCanvasCompletionDiscovery, verifyCanvasAudioDiscovery, verifyCanvasAudioFitDiscovery, HOMEPAGE_CORE_WEBKIT_FILES, homepageCoreArguments, verifyHomepageCoreDiscovery, HOMEPAGE_FUNCTIONAL_MINIMUMS, HOMEPAGE_PERFORMANCE_REQUIRED, verifyHomepageDiscovery, verifyHomepageReport } from './lib/homepage-test-selection.mjs';
import { verifyCanvasCandidateReports } from './pages-candidate.mjs';
import {verifyCanvasInspectorDiscovery} from './lib/homepage-test-selection.mjs';
import { validateHomepageRuntime } from './check-homepage-runtime.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => name === '.github/workflows/static.yml' ? releaseValidationSource(root) : fs.readFileSync(path.join(root, name), 'utf8');
const fixture = (file, project, index) => ({ file, project, title: `case ${index}`, expectedStatus: 'passed', tags: [] });
const coreFixtures = [...HOMEPAGE_CORE_FILES.map(file => fixture(file, 'chromium', 0)),
  ...HOMEPAGE_CORE_WEBKIT_FILES.map(file => fixture(file, 'webkit-canvas', 0)),
  ...['website-assistant.spec.js', 'admin-website-assistant.spec.js'].map(file => fixture(file, 'webkit-assistant', 0))];
assert.deepEqual(HOMEPAGE_CORE_WEBKIT_FILES, ['canvas.spec.js', 'oma2-q1-canvas.spec.js', 'smoke.spec.js']);
const adminFixture = fixture('auth-admin.spec.js', 'webkit-canvas', 0);
assert.throws(() => verifyHomepageCoreDiscovery([...coreFixtures, adminFixture], [...coreFixtures, adminFixture]), /lost or added/);
assert.equal(verifyHomepageCoreDiscovery(coreFixtures, coreFixtures)['chromium/oma2-q1-canvas.spec.js'], 1);
for (const removed of coreFixtures) {
  assert.throws(() => verifyHomepageCoreDiscovery(coreFixtures.filter(test => test !== removed), coreFixtures), /does not execute/);
}
assert.throws(() => verifyHomepageCoreDiscovery([], coreFixtures), /no tests/);
assert.throws(() => verifyHomepageCoreDiscovery([...coreFixtures, coreFixtures[0]], coreFixtures), /lost or added/);
assert.throws(() => verifyHomepageCoreDiscovery(coreFixtures.map(test => ({...test, project: 'webkit'})), coreFixtures), /does not execute/);
assert.throws(() => verifyHomepageCoreDiscovery(coreFixtures.map(test => ({...test, expectedStatus: 'skipped'})), coreFixtures), /statically skips/);
assert.throws(() => verifyHomepageCoreDiscovery(coreFixtures.map(test => ({...test, title: 'replacement'})), coreFixtures), /lost or added/);
const coreScript = JSON.parse(read('package.json')).scripts['test:homepage-core'];
assert.deepEqual(homepageCoreArguments({'test:homepage-core': coreScript}), coreScript.split(/\s+/).slice(1));
for (const script of ['', 'npm run test:static', coreScript + ' && echo hidden', coreScript + ' $(echo hidden)']) {
  assert.throws(() => homepageCoreArguments({'test:homepage-core': script}), /direct homepage-core/);
}
const standardConfig = require(path.join(root, 'playwright.config.js'));
const assistantProject = standardConfig.projects.find(project => project.name === 'webkit-assistant');
assert.equal(assistantProject?.use.browserName, 'webkit');
assert.deepEqual(assistantProject.testMatch, ['**/website-assistant.spec.js', '**/admin-website-assistant.spec.js']);
const canvasProject = standardConfig.projects.find(project => project.name === 'webkit-canvas');
assert.equal(canvasProject?.use.browserName, 'webkit');
assert.deepEqual(canvasProject.testMatch, CANVAS_WEBKIT_FILES.map(file => '**/' + file));
assert.deepEqual(canvasProject.grep, /Canvas|P13|@canvas-model-ui/);

// Exercise the actual npm caller and the exact discovery line used by CI. The
// wider project file set must not silently expand homepage-core to Admin, nor
// omit the tagged model cases from either engine in the Canvas release.
const discoveryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-canvas-selection-'));
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
try {
  const discover = (name, args) => {
    const output = path.join(discoveryDirectory, name + '.json');
    const result = spawnSync(process.execPath, [cli, ...args, '--list', '--reporter=json'], {
      cwd: root, env: {...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: output}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.error?.message || result.stdout}`);
    return flattenHomepageDiscovery(JSON.parse(fs.readFileSync(output, 'utf8')));
  };
  const standard = discover('standard', ['test', '-c', 'playwright.config.js']);
  const core = discover('core', homepageCoreArguments({'test:homepage-core': coreScript}));
  const counts = verifyHomepageCoreDiscovery(core, standard);
  assert(counts['webkit-canvas/smoke.spec.js'] > 0);
  assert(!core.some(test => test.file === 'auth-admin.spec.js'));
  const workflow = read('.github/workflows/static.yml');
  const lines = workflow.split('\n').map(line => line.trim());
  const allDiscovery = lines.filter(line => line.includes('PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/canvas-discovery.json npm run test:static'));
  const allExecution = lines.filter(line => line.includes('PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/candidate-auth.json npm run test:static') && line.includes('tests/canvas.spec.js'));
  assert.equal(allDiscovery.length, 5); assert.equal(allExecution.length, 5);
  const focused = allDiscovery.find(line => line.includes("--grep 'Canvas completion metadata'"));
  assert(focused);
  assert.equal(focused.split(' npm ')[1].replace(' --list --reporter=json', ''),
    allExecution.find(line => line.includes("--grep 'Canvas completion metadata'")).split(' npm ')[1].replace(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json', ''));
  const focusedOutput = path.join(discoveryDirectory, 'canvas-completion-ci.json');
  const focusedRun = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', focused], {
    cwd: root, env: {...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: focusedOutput}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(focusedRun.status, 0, focusedRun.stderr);
  const focusedReport = JSON.parse(fs.readFileSync(focusedOutput)), focusedCases = flattenHomepageDiscovery(focusedReport);
  verifyCanvasCompletionDiscovery(focusedCases);
  assert.throws(() => verifyCanvasCompletionDiscovery(focusedCases.slice(1)));
  assert.throws(() => verifyCanvasCompletionDiscovery([...focusedCases, focusedCases[0]]));
  assert.throws(() => verifyCanvasCompletionDiscovery(focusedCases.map((row,i) => i ? row : {...row,expectedStatus:'skipped'})));
  const proofReport = structuredClone(focusedReport);
  const setResults = (suite, status) => {for (const spec of suite.specs || []) for (const item of spec.tests || []) item.results=[{status}]; for(const child of suite.suites || []) setResults(child,status);};
  setResults(proofReport, 'passed');
  const verify = report => verifyCanvasCandidateReports(['test-results/candidate-auth.json'], [report], focusedReport, {canvasCompletion:true});
  verify(proofReport); setResults(proofReport, 'failed'); assert.throws(() => verify(proofReport));
  assert.throws(() => verifyCanvasCandidateReports([], [], focusedReport, {canvasCompletion:true}));
  const fitLine=allDiscovery.find(line=>line.includes("--grep 'Canvas audio fit'"));assert(fitLine);
  assert.equal(fitLine.split(' npm ')[1].replace(' --list --reporter=json',''),allExecution.find(line=>line.includes("--grep 'Canvas audio fit'")).split(' npm ')[1].replace(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json',''));
  const fitOutput=path.join(discoveryDirectory,'canvas-fit-ci.json');
  const fitRun=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',fitLine],{cwd:root,env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_FILE:fitOutput},encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(fitRun.status,0,fitRun.stderr);
  const fitReport=JSON.parse(fs.readFileSync(fitOutput)),fitCases=flattenHomepageDiscovery(fitReport);verifyCanvasAudioFitDiscovery(fitCases);
  for(const altered of [fitCases.slice(1),[...fitCases,fitCases[0]],fitCases.map((row,i)=>i?row:{...row,expectedStatus:'skipped'})])assert.throws(()=>verifyCanvasAudioFitDiscovery(altered));
  const fitProof=structuredClone(fitReport);setResults(fitProof,'passed');
  const verifyFit=report=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[report],fitReport,{canvasAudioFit:true});
  verifyFit(fitProof);setResults(fitProof,'failed');assert.throws(()=>verifyFit(fitProof));
  assert.throws(()=>verifyCanvasCandidateReports([],[],fitReport,{canvasAudioFit:true}));
  const inspectorLine=allDiscovery.find(line=>line.includes("--grep 'Canvas Inspector'"));assert(inspectorLine);
  assert.equal(inspectorLine.split(' npm ')[1].replace(' --list --reporter=json',''),allExecution.find(line=>line.includes("--grep 'Canvas Inspector'")).split(' npm ')[1].replace(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json',''));
  const inspectorOutput=path.join(discoveryDirectory,'canvas-inspector-ci.json');
  const inspectorRun=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',inspectorLine],{cwd:root,env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_FILE:inspectorOutput},encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(inspectorRun.status,0,inspectorRun.stderr);
  const inspectorReport=JSON.parse(fs.readFileSync(inspectorOutput)),inspectorCases=flattenHomepageDiscovery(inspectorReport);verifyCanvasInspectorDiscovery(inspectorCases);
  for(const altered of [inspectorCases.slice(1),[...inspectorCases,inspectorCases[0]],inspectorCases.map((row,i)=>i?row:{...row,expectedStatus:'skipped'})])assert.throws(()=>verifyCanvasInspectorDiscovery(altered));
  const inspectorProof=structuredClone(inspectorReport);setResults(inspectorProof,'passed');
  const verifyInspector=report=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[report],inspectorReport,{canvasInspector:true});
  verifyInspector(inspectorProof);
  for(const status of ['failed','skipped','timedOut']){setResults(inspectorProof,status);assert.throws(()=>verifyInspector(inspectorProof));}
  assert.throws(()=>verifyCanvasCandidateReports([],[],inspectorReport,{canvasInspector:true}));
  const audioLine=allDiscovery.find(line=>line.includes('tests/oma2-q1-canvas.spec.js')&&!line.includes('tests/auth-admin.spec.js'));
  assert(audioLine);
  assert.equal(audioLine.split(' npm ')[1].replace(' --list --reporter=json',''),allExecution.find(line=>line.includes('tests/oma2-q1-canvas.spec.js')&&!line.includes('tests/auth-admin.spec.js')).split(' npm ')[1].replace(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json',''));
  const audioOutput=path.join(discoveryDirectory,'canvas-audio-ci.json');
  const audioRun=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',audioLine],{cwd:root,env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_FILE:audioOutput},encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(audioRun.status,0,audioRun.stderr);
  const audioReport=JSON.parse(fs.readFileSync(audioOutput)),audioCases=flattenHomepageDiscovery(audioReport);
  verifyCanvasAudioDiscovery(audioCases,standard);
  const missingSmooth=audioCases.filter(row=>!row.title.startsWith('Canvas smooth joins de:'));
  assert.throws(()=>verifyCanvasAudioDiscovery(missingSmooth,missingSmooth),/Missing required seam comparison/, 'Deleting the case itself must not erase required acceptance');
  assert.throws(()=>verifyCanvasAudioDiscovery(audioCases.slice(1),standard));
  assert.throws(()=>verifyCanvasAudioDiscovery([...audioCases,audioCases[0]],standard));
  assert.throws(()=>verifyCanvasAudioDiscovery(audioCases.map((row,i)=>i?row:{...row,expectedStatus:'skipped'}),standard));
  const audioProof=structuredClone(audioReport);setResults(audioProof,'passed');
  const verifyAudio=report=>verifyCanvasCandidateReports(['test-results/candidate-auth.json'],[report],audioReport,{canvasAudio:true});
  verifyAudio(audioProof);setResults(audioProof,'failed');assert.throws(()=>verifyAudio(audioProof));
  assert.throws(()=>verifyCanvasCandidateReports([],[],audioReport,{canvasAudio:true}));
  const discoveryLines = allDiscovery.filter(line => line.includes('tests/auth-admin.spec.js'));
  const executionLines = allExecution.filter(line => line.includes('tests/auth-admin.spec.js'));
  assert.equal(discoveryLines.length, 1); assert.equal(executionLines.length, 1);
  assert(discoveryLines[0].endsWith(' --list --reporter=json'));
  assert(executionLines[0].endsWith(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json'));
  assert.equal(discoveryLines[0].split(' npm ')[1].replace(' --list --reporter=json', ''),
    executionLines[0].split(' npm ')[1].replace(' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json', ''), 'CI discovery/execution scopes differ');
  const output = path.join(discoveryDirectory, 'canvas-ci.json');
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', discoveryLines[0]], {
    cwd: root, env: {...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: output}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  const canvas = flattenHomepageDiscovery(JSON.parse(fs.readFileSync(output, 'utf8')));
  // Imported bodies must retain their owning spec declaration. Check all four
  // cases independently in each real caller, not just equal (possibly empty) sets.
  for (const [name, collection] of Object.entries({standard, core, canvas})) {
    const audition = collection.filter(test => test.title.startsWith('Canvas music audition '));
    assert.deepEqual(audition.map(test => [test.file, test.project, test.title]).sort(),
      ['chromium','webkit-canvas'].flatMap(project => ['en','de'].map(locale => [
        'canvas.spec.js', project, `Canvas music audition ${locale}: decoded gain, timeline, selection and no render`,
      ])).sort(), `${name}: imported preview bodies lost their owning spec or required cases`);
  }
  // Playwright's plain-string CLI --grep is case-insensitive; the project's
  // RegExp above is not. Standard discovery already applied that project filter.
  verifyCanvasReleaseDiscovery(canvas, standard);
  // These are the four legitimate cases omitted by the old release matrix in
  // 37105294832/1. A shared matrix must not silently remove their requirement.
  for (const project of ['chromium','webkit-pricing']) {
    for (const title of [
      '@canvas-model-ui Omni Model Status persists explicit Admin test settings without inference',
      '@canvas-model-ui Omni final retail tariff has unknown provider cost and no duration or second margin',
    ]) assert(canvas.some(test => test.project === project && test.file === 'oma2-q3-model-pricing.spec.js' && test.title === title), `Missing required pricing case ${project}/${title}`);
  }
  // Mutate real discovered cases: omissions, duplicates, foreign files/engines,
  // skips and the former pricing-less scope must remain blocking.
  for (const [scope, files] of CANVAS_RELEASE_SCOPES) for (const engine of ['chromium','webkit']) for (const file of files) {
    const project = canvasReleaseProject(engine, scope);
    const missing = canvas.filter(test => test.project !== project || test.file !== file);
    assert.throws(() => verifyCanvasReleaseDiscovery(missing, standard), /Canvas release missing/);
    assert.throws(() => verifyCanvasReleaseDiscovery(missing, standard.filter(test => test.project !== project || test.file !== file)), /Standard discovery lost/);
  }
  assert.throws(() => verifyCanvasReleaseDiscovery(canvas.filter(test => test.file !== 'oma2-q3-model-pricing.spec.js'), standard), /Canvas release missing/);
  assert.throws(() => verifyCanvasReleaseDiscovery(canvas.slice(1), standard), /lost or added/);
  assert.throws(() => verifyCanvasReleaseDiscovery([...canvas, canvas[0]], standard), /Duplicate/);
  for (const change of [{file:'unrelated.spec.js'}, {project:'firefox'}, {title:'unreviewed replacement'}, {expectedStatus:'skipped'}]) {
    assert.throws(() => verifyCanvasReleaseDiscovery(canvas.map((test,index) => index === 0 ? {...test,...change} : test), standard), /lost or added|Statically skipped/);
  }
  console.log(`Actual caller discovery: homepage-core ${core.length}; Canvas/model ${canvas.length} (Chromium + WebKit). No browser execution claimed.`);
} finally {
  fs.rmSync(discoveryDirectory, {recursive: true, force: true});
}
const functional = ['chromium', 'webkit'].flatMap(project => Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)
  .flatMap(([file, count]) => Array.from({ length: count }, (_, index) => fixture(file, project, index))));
const standard = functional.filter(test => test.project === 'chromium');
const carousel = ['chromium', 'firefox', 'webkit'].flatMap(project => Array.from({ length: 5 }, (_, index) => fixture('homepage-carousel-focused.spec.js', project, index)));
const performance = Object.entries(HOMEPAGE_PERFORMANCE_REQUIRED).flatMap(([file, titles]) => titles.map(title => ({
  ...fixture(file, 'chromium-performance', 0), title, tags: ['homepage-performance'],
})));
const valid = { standard, carousel, functional, performance };
assert.equal(verifyHomepageDiscovery(valid).existingCommandUnion, standard.length + 10);
for (const name of Object.keys(valid)) {
  for (const file of ['homepage-hero-playback.spec.js', 'homepage-hero-state.spec.js', 'homepage-native-control.spec.js']) {
    assert.throws(() => verifyHomepageDiscovery({ ...valid, [name]: [...valid[name], fixture(file, 'chromium', 0)] }), /retired decorative Hero/);
  }
  for (const tag of ['decorative-playback', '@decorative-playback']) {
    const tagged = valid[name].map((test, index) => index === 0 ? { ...test, tags: [...test.tags, tag] } : test);
    assert.throws(() => verifyHomepageDiscovery({ ...valid, [name]: tagged }), /retired decorative Hero/);
  }
}
for (const name of Object.keys(valid)) assert.throws(() => verifyHomepageDiscovery({ ...valid, [name]: [] }), /no tests/);
for (const file of Object.keys(HOMEPAGE_FUNCTIONAL_MINIMUMS)) {
  assert.throws(() => verifyHomepageDiscovery({ ...valid, functional: functional.filter(test => !(test.project === 'webkit' && test.file === file)) }), /require at least/);
}
for (let missing = 0; missing < performance.length; missing += 1) {
  assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.filter((_, index) => index !== missing) }), /required marked scenario/);
}
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map(test => ({ ...test, tags: [] })) }), /required marked scenario/);
assert.ok(verifyHomepageDiscovery({ ...valid, performance: performance.map(test => ({ ...test, tags: ['@homepage-performance'] })) }));
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map(test => ({ ...test, project: 'chromium' })) }), /controlled Chromium/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, performance: performance.map(test => ({ ...test, expectedStatus: 'skipped' })) }), /statically skipped/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, carousel: carousel.filter(test => test.project !== 'firefox') }), /firefox/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, functional: functional.slice(1) }), /require at least/);
assert.throws(() => verifyHomepageDiscovery({ ...valid, standard: [...standard, fixture('homepage-media-loading.spec.js', 'chromium', 'new uncovered case')] }), /Early functional selection omits/);
assert.throws(() => flattenHomepageDiscovery({ suites: [], errors: [{ message: 'import failed' }] }), /discovery reported errors/);
assert.deepEqual(flattenHomepageDiscovery({ suites: [{ title: 'file.spec.js', file: 'file.spec.js', suites: [{ title: 'group', specs: [{ file: 'file.spec.js', title: 'case', tags: ['@homepage-performance'], tests: [{ projectName: 'chromium', expectedStatus: 'passed' }] }] }] }] }), [
  { file: 'file.spec.js', title: 'group > case', project: 'chromium', expectedStatus: 'passed', tags: ['@homepage-performance'] },
]);

const scripts = JSON.parse(read('package.json')).scripts;
for (const script of ['test:homepage-webkit', 'test:homepage-webkit:extended', 'test:homepage-functional:extended', 'diagnose:homepage-linux-media']) {
  assert.equal(scripts[script], undefined, `Retired command remains: ${script}`);
}
for (const file of ['tests/homepage-hero-playback.spec.js', 'tests/homepage-hero-state.spec.js', 'tests/homepage-native-control.spec.js',
  'tests/helpers/homepage-hero-native-probe.js', 'tests/helpers/homepage-decorative-media.cjs', 'tests/helpers/homepage-macos.sb',
  'tests/fixtures/media/hero-stalled-slot.json', 'tests/fixtures/media/hero-fallback-phase-targets.json', 'tests/fixtures/media/hero-bfcache-seek-window.json',
  'tests/fixtures/media/test-video-loading.mp4', 'playwright.homepage-webkit.config.js', 'playwright.homepage-linux-diagnostic.config.js',
  'scripts/diagnose-homepage-linux-media.mjs', 'scripts/lib/homepage-media-policy.cjs']) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `Retired video automation remains: ${file}`);
}
assert.equal(scripts['test:static'], 'playwright test -c playwright.config.js');
assert.equal(scripts['test:homepage-carousel'], 'playwright test -c playwright.carousel.config.js');
assert.equal(scripts['test:homepage-functional'], 'playwright test -c playwright.homepage.config.js');
assert.equal(scripts['check:homepage-runtime'], 'node scripts/check-homepage-runtime.mjs');
assert.equal(scripts['test:homepage-performance'], 'playwright test -c playwright.homepage-performance.config.js');
assert.equal(scripts['check:homepage-selection'], 'node scripts/check-homepage-selection.mjs');
for (const file of ['playwright.homepage.config.js', 'playwright.homepage-performance.config.js']) {
  const config = require(path.join(root, file));
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.fullyParallel, false);
  assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.use.trace, file.includes('-performance.') ? 'off' : 'retain-on-failure');
}
for (const file of ['playwright.homepage.config.js', 'playwright.homepage-performance.config.js']) {
  const server = require(path.join(root, file)).webServer;
  assert.equal(server.command, 'node tests/helpers/homepage-media-server.mjs _site');
  assert.equal(server.reuseExistingServer, false, 'Acceptance cannot reuse a stale source/build server');
}
const performanceConfig = require(path.join(root, 'playwright.homepage-performance.config.js'));
assert.equal(performanceConfig.projects.length, 1);
assert.equal(performanceConfig.projects[0].name, 'chromium-performance');
assert.equal(performanceConfig.projects[0].use.browserName, 'chromium');
assert.equal(performanceConfig.projects[0].metadata.homepagePerformanceMeasurement, true);
assert.equal(performanceConfig.projects[0].metadata.homepagePerformanceGate, undefined);
assert.ok(performanceConfig.grep.test('@homepage-performance'));
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
function verifyBrowserInstall(install, owner, authBrowsers) {
  const script = install.split('        run: |\n')[1];
  assert(script, 'Missing executable browser installation');
  for (const homepage of ['true', 'false']) for (const fails of [false, true]) {
    const command = script.replaceAll(`\${{ needs.${owner}.outputs.homepage }}`, homepage);
    assert(!command.includes('${{'), 'Unresolved workflow input');
    // Execute the workflow shell, but record installation instead of downloading.
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c',
      `npx() { printf '%s\\n' "$*"; return ${fails ? 19 : 0}; };\n${command}\nprintf 'finished\\n'`],
    { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, fails ? 19 : 0, 'Browser installation must fail closed');
    const browsers = homepage === 'true' ? 'chromium webkit' : authBrowsers;
    assert.deepEqual(result.stdout.trim().split('\n'), [
      `playwright install --with-deps ${browsers}`, ...(!fails ? ['finished'] : []),
    ]);
  }
}
for (const workflow of ['static.yml', 'full-regression.yml']) {
  const text = read(`.github/workflows/${workflow}`);
  if (workflow !== 'full-regression.yml') {
    const caller = job(text, workflow === 'static.yml' ? 'browser-validation' : 'deploy');
    const install = caller.split('      - name: Install browsers for selected ')[1]?.split('      - name:')[0];
    assert(install, 'Missing selected frontend browser setup');
    const owner = workflow === 'static.yml' ? 'release-compatibility' : 'guard';
    assert(install.includes(`if [ "\${{ needs.${owner}.outputs.homepage }}" = 'true' ]; then`));
    // test:auth selects the Chromium project, but its private-media cases
    // explicitly launch both engines. Fast UI excludes these Admin tests.
    const browsers = workflow === 'static.yml' ? 'chromium webkit' : 'chromium';
    verifyBrowserInstall(install, owner, browsers);
    const wrong = install.replace(/(else\s+npx playwright install --with-deps )chromium(?: webkit)?/,
      `$1${workflow === 'static.yml' ? 'chromium' : 'chromium webkit'}`);
    assert.notEqual(wrong, install);
    assert.throws(() => verifyBrowserInstall(wrong, owner, browsers), /deep-equal/);
  }
  const early = job(text, 'homepage-validation');
  assert.ok(early.includes('npm run check:homepage-selection'));
  assert.ok(early.includes('run: npm run test:homepage-functional\n'));
  assert.ok(!early.includes('--max-failures'), 'Complete homepage acceptance must not leave the remaining scenarios unexecuted');
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
  assert.ok(early.includes("success() && steps.homepage_discovery.outcome == 'success'"));
  assert.ok(!early.includes('!cancelled()'), 'Earlier setup/function failure must stop subsequent test steps');
  assert.ok(early.includes('if: always()'));
  assert.ok(early.includes('actions/upload-artifact@v6'));
  assert.ok(early.includes('test-results/homepage-*.json'));
  assert.ok(early.includes('persist-credentials: false'));
  assert.ok(!early.includes('continue-on-error'));
  assert.ok(!early.match(/needs:.*(?:browser-|worker-)/));
  assert.ok(text.includes('npm run test:homepage-carousel'));
  if (workflow !== 'ui-fast-deploy.yml') assert.ok(text.includes('npm run test:static'));
  else assert.ok(text.includes('npm run test:homepage-core'));
  if (workflow === 'ui-fast-deploy.yml') {
    assert.match(job(text, 'deploy'), /needs: \[[^\]]*homepage-validation/);
  } else if(workflow==='static.yml') {
    assert.match(job(text,'deploy'),/needs: \[release-compatibility, reuse-candidate\]/);
    assert(fs.readFileSync(path.join(root,'.github/workflows/static.yml'),'utf8').includes('node scripts/local-release.mjs import'));
  } else assert.ok(!text.includes('actions/deploy-pages'));
}
console.log('Homepage selection, no-zero, preserved commands and mandatory early workflow gates passed.');

// Missing, failed or skipped mandatory functional execution cannot be
// replaced by discovery alone. Exercise the real report CLI as well.
const report = { stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 }, suites: [{ specs: [{ file: 'homepage-carousel-focused.spec.js', title: 'homepage news geometry',
  tests: [{ projectName: 'webkit', expectedStatus: 'passed', results: [{ status: 'passed', retry: 0, errors: [] }] }] }] }] };
const discovery = { status: 'passed', collections: { functional: flattenHomepageDiscovery(report) } };
verifyHomepageReport(report, discovery);
const executionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-homepage-execution-'));
try {
  const filename = path.join(executionDirectory, 'execution.json');
  const discoveryFile = path.join(executionDirectory, 'discovery.json');
  fs.writeFileSync(discoveryFile, JSON.stringify(discovery));
  const execute = (data, discovered = discovery) => {
    fs.writeFileSync(filename, JSON.stringify(data));
    fs.writeFileSync(discoveryFile, JSON.stringify(discovered));
    return spawnSync(process.execPath, ['scripts/check-homepage-selection.mjs', '--verify-execution-report', filename,
      '--discovery', discoveryFile], { cwd: root, encoding: 'utf8' });
  };
  assert.equal(execute(report).status, 0);
  const allowedSkips = [
    ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > settles exact transitions, keeps populated walls warm, and honors the latest rapid choice', 'webkit'],
    ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > page-work measurement detects deliberately blocking work on a real carousel input', 'webkit'],
    ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > WebKit switches categories instantly with one precise scroll and no settling corrections', 'chromium'],
    ...['/', '/de/'].map(route => ['homepage-media-loading.spec.js', `${route} tablet resize during category preparation releases distant media loading`, 'webkit']),
  ];
  for (const [file, title, projectName] of allowedSkips) {
    const skipReport = { stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 1 }, suites: [{ specs: [
      { file, title, tests: [{ projectName, results: [{ status: 'skipped' }] }] },
      { file, title: 'Required peer still executes', tests: [{ projectName, results: [{ status: 'passed' }] }] },
    ] }] };
    const discover = data => ({ status: 'passed', collections: { functional: flattenHomepageDiscovery(data) } });
    verifyHomepageReport(skipReport, discover(skipReport));
    assert.equal(execute(skipReport, discover(skipReport)).status, 0);
    for (const fault of ['wrong-engine', 'wrong-title', 'wrong-file', 'peer-skipped']) {
      const broken = structuredClone(skipReport), specs = broken.suites[0].specs;
      if (fault === 'wrong-engine') for (const spec of specs) spec.tests[0].projectName = projectName === 'webkit' ? 'chromium' : 'webkit';
      if (fault === 'wrong-title') specs[0].title = 'Other functional case';
      if (fault === 'wrong-file') for (const spec of specs) spec.file = 'homepage-creation-stream-anchor.spec.js';
      if (fault === 'peer-skipped') specs[1].tests[0].results[0].status = 'skipped';
      assert.throws(() => verifyHomepageReport(broken, discover(broken)));
      assert.notEqual(execute(broken, discover(broken)).status, 0);
    }
  }
  for (const fault of ['missing', 'wrong-type', 'negative', 'fractional', 'failed', 'flaky', 'passed-count', 'skipped-count']) {
    const broken = structuredClone(report);
    if (fault === 'missing') delete broken.stats;
    if (fault === 'wrong-type') broken.stats.expected = '1';
    if (fault === 'negative') broken.stats.skipped = -1;
    if (fault === 'fractional') broken.stats.expected = 1.5;
    if (fault === 'failed') broken.stats.unexpected = 1;
    if (fault === 'flaky') broken.stats.flaky = 1;
    if (fault === 'passed-count') broken.stats.expected = 2;
    if (fault === 'skipped-count') broken.stats.skipped = 1;
    assert.throws(() => verifyHomepageReport(broken, discovery), /statistics/);
    assert.notEqual(execute(broken).status, 0);
  }
  for (const fault of ['retry', 'result-error', 'global-error']) {
    const broken = structuredClone(report), test = broken.suites[0].specs[0].tests[0];
    if (fault === 'retry') test.results.unshift({ status: 'failed' });
    if (fault === 'result-error') test.results[0].errors = [{ message: 'Navigation failed' }];
    if (fault === 'global-error') broken.errors = [{ message: 'Browser failed' }];
    assert.throws(() => verifyHomepageReport(broken, discovery));
    assert.notEqual(execute(broken).status, 0);
  }
  for (const status of ['skipped', 'failed', undefined]) {
    const broken = structuredClone(report); broken.suites[0].specs[0].tests[0].results = [{ status }];
    assert.throws(() => verifyHomepageReport(broken, discovery));
    assert.notEqual(execute(broken).status, 0);
  }
  const missing = { suites: [] };
  assert.throws(() => verifyHomepageReport(missing, discovery), /Missing/);
  assert.notEqual(execute(missing).status, 0);
  const foreign = structuredClone(report); foreign.suites[0].specs[0].title = 'foreign';
  assert.throws(() => verifyHomepageReport(foreign, discovery), /foreign/);
  assert.notEqual(execute(foreign).status, 0);
} finally { fs.rmSync(executionDirectory, { recursive: true, force: true }); }
