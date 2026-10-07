import assert from 'node:assert/strict';
import path from 'node:path';

export const HOMEPAGE_CORE_FILES = Object.freeze([
  'audio-player.spec.js', 'canvas.spec.js', 'oma2-q1-canvas.spec.js',
  'locale.spec.js', 'smoke.spec.js', 'website-assistant.spec.js', 'admin-website-assistant.spec.js',
]);
// Project capability is wider than the homepage-core caller: the Canvas/model
// release also selects tagged Admin controls. Homepage-core keeps its own file
// arguments: tagged smoke plus the assistant control centre, not general Admin tests.
export const CANVAS_WEBKIT_FILES = Object.freeze([
  'canvas.spec.js', 'oma2-q1-canvas.spec.js', 'auth-admin.spec.js', 'smoke.spec.js', 'oma2-q1-member.spec.js',
]);
export const HOMEPAGE_CORE_WEBKIT_FILES = Object.freeze(HOMEPAGE_CORE_FILES.filter(file => CANVAS_WEBKIT_FILES.includes(file)));

// The release includes pricing acceptance in its own WebKit project. Keep the
// required file/engine matrix shared with candidate proof, while checking the
// workflow's actual discovery independently against standard Playwright discovery.
export const CANVAS_RELEASE_SCOPES = Object.freeze([
  Object.freeze(['canvas', CANVAS_WEBKIT_FILES]),
  Object.freeze(['pricing', Object.freeze(['oma2-q3-model-pricing.spec.js'])]),
]);
export const CANVAS_AUDIO_SCOPES = Object.freeze([Object.freeze(['canvas', Object.freeze(['canvas.spec.js','oma2-q1-canvas.spec.js'])])]);
export function verifyCanvasAudioDiscovery(actual, standard=actual) {
  const files=CANVAS_AUDIO_SCOPES[0][1],projects=['chromium','webkit-canvas'];
  const expected=standard.filter(row=>files.includes(row.file)&&projects.includes(row.project)&&/Canvas|P13|@canvas-model-ui/i.test(row.title+' '+row.tags.join(' ')));
  assert.deepEqual(actual.map(key).sort(),expected.map(key).sort(),'Canvas audio discovery lost or added cases');
  assert.equal(new Set(actual.map(key)).size,actual.length,'Duplicate Canvas audio case');
  for(const project of projects) {
    for(const file of files)assert(actual.some(row=>row.project===project&&row.file===file),'Missing retained Canvas suite');
    for(const locale of ['en','de'])assert.equal(actual.filter(row=>row.project===project&&row.file==='canvas.spec.js'&&row.title===`Canvas asset audio ${locale}: typed references, persistent controls and real export`).length,1,'Missing required typed-asset/audio integration');
    for(const locale of ['en','de'])assert.equal(actual.filter(row=>row.project===project&&row.file==='canvas.spec.js'&&row.title===`Canvas smooth joins ${locale}: persistent choice, real comparison and saved export`).length,1,'Missing required seam comparison/export integration');
  }
  for(const row of actual)assert.equal(row.expectedStatus,'passed','Selected Canvas audio case must execute');
}
export function verifyCanvasTransitionDiscovery(actual) {
  const expected=['chromium','webkit-canvas'].flatMap(project=>['en','de'].flatMap(locale=>['workspace','transitions'].map(feature=>`${project}:canvas.spec.js:Canvas workspace transitions ${locale}: ${feature}`)));
  assert.deepEqual(actual.map(row=>`${row.project}:${row.file}:${row.title}`).sort(),expected.sort(),'Workspace/transition discovery requires both features, languages and engines');
  for(const row of actual)assert.equal(row.expectedStatus,'passed','Required feature case must execute');
}
export function verifyCanvasInspectorDiscovery(actual) {
  const titles=['image successful-output disclosure lifecycle','video successful-output disclosure lifecycle','music successful-output disclosure lifecycle','merge disclosure retains choices and export access','typed vector icons preserve graph geometry'];
  const expected=['chromium','webkit-canvas'].flatMap(project=>['en','de'].flatMap(locale=>titles.map(title=>`${project}:canvas.spec.js:Canvas Inspector ${locale}: ${title}`)));
  assert.deepEqual(actual.map(row=>`${row.project}:${row.file}:${row.title}`).sort(),expected.sort(),'Inspector discovery requires all media, locales and engines');
  for(const row of actual)assert.equal(row.expectedStatus,'passed','Inspector case must execute');
}
export function verifyCanvasAudioFitDiscovery(actual) {
  const expected=['chromium','webkit-canvas'].flatMap(project=>['en','de'].map(locale=>
    `${project}:canvas.spec.js:Canvas audio fit ${locale}: original timing, comparison and saved export`));
  assert.deepEqual(actual.map(row=>`${row.project}:${row.file}:${row.title}`).sort(),expected.sort(),'Audio fit discovery requires every engine/locale exactly once');
  for(const row of actual)assert.equal(row.expectedStatus,'passed','Audio fit case must execute');
}
export function verifyCanvasCompletionDiscovery(actual) {
  const expected = ['chromium', 'webkit-canvas'].flatMap(project => ['en', 'de'].map(locale =>
    `${project}:canvas.spec.js:Canvas completion metadata ${locale}: queue, deficient Inspector, appended chain and admission`));
  assert.deepEqual(actual.map(test => `${test.project}:${test.file}:${test.title}`).sort(), expected.sort(), 'Canvas completion discovery must contain every EN/DE engine case exactly once');
  for (const test of actual) assert.equal(test.expectedStatus, 'passed', 'Canvas completion case must execute');
}
export const canvasReleaseProject = (engine, scope) => engine === 'chromium' ? 'chromium'
  : scope === 'pricing' ? 'webkit-pricing' : 'webkit-canvas';

export function verifyCanvasReleaseDiscovery(actual, standard) {
  assert(Array.isArray(actual) && actual.length > 0, 'Canvas release: no tests discovered');
  const required = CANVAS_RELEASE_SCOPES.flatMap(([scope, files]) => ['chromium', 'webkit']
    .flatMap(engine => files.map(file => ({ project: canvasReleaseProject(engine, scope), file }))));
  const expected = standard.filter(test => required.some(row => row.file === test.file && row.project === test.project)
    && /Canvas|P13|@canvas-model-ui/i.test(test.title + ' ' + test.tags.join(' ')));
  for (const row of required) {
    assert(expected.some(test => test.file === row.file && test.project === row.project), `Standard discovery lost ${row.project}/${row.file}`);
    assert(actual.some(test => test.file === row.file && test.project === row.project), `Canvas release missing ${row.project}/${row.file}`);
  }
  assert.equal(new Set(actual.map(key)).size, actual.length, 'Duplicate Canvas release discovery');
  assert.deepEqual(actual.map(key).sort(), expected.map(key).sort(), 'CI Canvas discovery lost or added cases');
  for (const test of actual) assert.equal(test.expectedStatus, 'passed', `Statically skipped Canvas case: ${key(test)}`);
}

// Read the real existing npm caller without evaluating a shell command.
export function homepageCoreArguments(scripts) {
  const args = String(scripts?.['test:homepage-core'] || '').trim().split(/\s+/);
  assert(args[0] === 'playwright' && args[1] === 'test'
    && args.every(arg => /^[\w./=-]+$/.test(arg)), 'Expected the direct homepage-core Playwright caller');
  return args.slice(1);
}

export function verifyHomepageCoreDiscovery(core, standard) {
  assert(Array.isArray(core) && core.length > 0, 'homepage-core: no tests discovered');
  const projects = {chromium: HOMEPAGE_CORE_FILES, 'webkit-canvas': HOMEPAGE_CORE_WEBKIT_FILES,
    'webkit-assistant': ['website-assistant.spec.js', 'admin-website-assistant.spec.js']};
  const expected = standard.filter(test => projects[test.project]?.includes(test.file));
  for (const [project, files] of Object.entries(projects)) {
    for (const file of files) {
      assert(expected.some(test => test.file === file && test.project === project), `Standard discovery lost ${project}/${file}`);
      assert(core.some(test => test.file === file && test.project === project), `homepage-core does not execute ${project}/${file}`);
    }
  }
  assert.deepEqual(core.map(key).sort(), expected.map(key).sort(), 'homepage-core lost or added cases compared with its standard specs');
  for (const test of core) assert.equal(test.expectedStatus, 'passed', `homepage-core statically skips ${key(test)}`);
  return Object.fromEntries(Object.entries(projects).flatMap(([project, files]) => files.map(file =>
    [`${project}/${file}`, core.filter(test => test.file === file && test.project === project).length])));
}

export const HOMEPAGE_FUNCTIONAL_MINIMUMS = Object.freeze({
  'homepage-carousel-focused.spec.js': 5,
  'homepage-creation-stream-anchor.spec.js': 4,
  'homepage-media-loading.spec.js': 8,
});
export const HOMEPAGE_PERFORMANCE_REQUIRED = Object.freeze({
  'homepage-carousel-focused.spec.js': [
    'settles exact transitions, keeps populated walls warm, and honors the latest rapid choice',
    'page-work measurement detects deliberately blocking work on a real carousel input',
  ],
  'homepage-performance-contract.spec.js': [
    'work-window arithmetic includes crossing tasks and excludes disjoint tasks',
    'native blocking countercontrol retains a task crossing input despite delayed observation',
    'native blocking countercontrol retains a task crossing completion despite delayed observation',
  ],
});
export function flattenHomepageDiscovery(report) {
  assert.ok(Array.isArray(report?.suites), 'Missing Playwright discovery suites');
  assert.equal((report.errors || []).length, 0, 'Playwright discovery reported errors');
  const found = [];
  function visit(suite, parents = [], fileSuite = false) {
    const titles = fileSuite ? parents : [...parents, suite.title].filter(Boolean);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) found.push({
        file: path.basename(spec.file),
        title: [...titles, spec.title].join(' > '),
        project: test.projectName,
        expectedStatus: test.expectedStatus,
        ...(test.results ? {resultStatus: test.results.at(-1)?.status} : {}),
        tags: spec.tags || [],
      });
    }
    for (const child of suite.suites || []) visit(child, titles);
  }
  for (const suite of report.suites) visit(suite, [], true);
  return found;
}

function key(test) {
  return [test.file, test.title, test.project].join('\0');
}

// These are the retained specs' existing engine branches, not permission to
// skip another functional scenario or the matching scenario on another engine.
const functionalRuntimeSkips = new Set([
  ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > settles exact transitions, keeps populated walls warm, and honors the latest rapid choice', 'webkit'],
  ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > page-work measurement detects deliberately blocking work on a real carousel input', 'webkit'],
  ['homepage-carousel-focused.spec.js', 'Populated homepage carousel > WebKit switches categories instantly with one precise scroll and no settling corrections', 'chromium'],
  ...['/', '/de/'].map(route => ['homepage-media-loading.spec.js', `${route} tablet resize during category preparation releases distant media loading`, 'webkit']),
].map(([file, title, project]) => key({ file, title, project })));

// Match the functional report to the exact existing discovery for this run.
export function verifyHomepageReport(report, discovery) {
  assert.equal(discovery.status, 'passed', 'Homepage discovery did not pass');
  const expected = discovery.collections.functional;
  const actual = flattenHomepageDiscovery(report);
  assert(expected.length > 0, 'No selected homepage cases');
  assert.deepEqual(actual.map(key).sort(), expected.map(key).sort(), 'Missing or foreign selected homepage cases');
  assert(report.stats && ['expected', 'unexpected', 'flaky', 'skipped'].every(name => Number.isInteger(report.stats[name]) && report.stats[name] >= 0)
    && report.stats.unexpected === 0 && report.stats.flaky === 0 && report.stats.expected > 0,
  'Missing, malformed or failed homepage functional statistics');
  assert.equal(actual.filter(test => test.resultStatus === 'passed').length, report.stats.expected,
    'Inconsistent passed homepage functional statistics');
  assert.equal(actual.filter(test => test.resultStatus === 'skipped').length, report.stats.skipped,
    'Inconsistent skipped homepage functional statistics');
  const inspectResults = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      assert.equal(test.results?.length, 1, 'Functional homepage case must have one executed attempt');
      const result = test.results[0];
      assert.equal(result.retry ?? 0, 0, 'Retried functional homepage result');
      assert(!result.error && (result.errors || []).length === 0, 'Functional homepage execution reported an error');
    }
    (suite.suites || []).forEach(inspectResults);
  };
  report.suites.forEach(inspectResults);
  const groups = new Map();
  for (const test of actual) {
    assert(['passed','skipped'].includes(test.resultStatus), 'Unexecuted/failed homepage case: '+key(test));
    if (test.resultStatus === 'skipped') assert(functionalRuntimeSkips.has(key(test)),
      'Unexpected skipped homepage functional case: ' + key(test));
    const group = test.file+'\0'+test.project;
    groups.set(group, (groups.get(group)||0) + Number(test.resultStatus==='passed'));
  }
  for (const [group, count] of groups) assert(count > 0, 'No executed homepage cases: '+group);
}

export function verifyHomepageDiscovery({ standard, carousel, functional, performance }) {
  for (const [name, tests] of Object.entries({ standard, carousel, functional, performance })) {
    assert.ok(Array.isArray(tests) && tests.length > 0, `${name}: no tests discovered`);
    for (const test of tests) {
      assert(!['homepage-hero-playback.spec.js', 'homepage-hero-state.spec.js', 'homepage-native-control.spec.js'].includes(path.basename(test.file))
        && !test.tags.some(tag => tag.replace(/^@/, '') === 'decorative-playback'),
      `${name}: retired decorative Hero video test discovered`);
    }
  }
  const counts = tests => Object.fromEntries([...new Set(tests.map(test => test.file))].sort()
    .map(file => [file, tests.filter(test => test.file === file).length]));
  for (const project of ['chromium', 'webkit']) {
    for (const [file, minimum] of Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)) {
      const matches = functional.filter(test => test.project === project && test.file === file);
      assert.ok(matches.length >= minimum, `${project}/${file}: ${matches.length} tests; require at least ${minimum}`);
      assert.ok(matches.every(test => test.expectedStatus !== 'skipped'), `${project}/${file}: statically skipped mandatory case`);
    }
  }
  assert.ok(performance.every(test => test.project === 'chromium-performance'), 'Performance must use its controlled Chromium project');
  assert.ok(performance.every(test => test.expectedStatus !== 'skipped'), 'Performance acceptance cannot be statically skipped');
  for (const [file, titles] of Object.entries(HOMEPAGE_PERFORMANCE_REQUIRED)) {
    for (const title of titles) assert.ok(performance.some(test => test.file === file
      && (test.title === title || test.title.endsWith(` > ${title}`))
      && test.tags.some(tag => tag.replace(/^@/, '') === 'homepage-performance')),
    `Controlled performance is missing a required marked scenario: ${file}: ${title}`);
  }
  const oldUnion = new Set([...standard, ...carousel].map(key));
  const combinedUnion = new Set([...standard, ...carousel, ...functional, ...performance].map(key));
  const earlyFunctional = new Set(functional.map(key));
  for (const [file, minimum] of Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)) {
    assert.ok(standard.filter(test => test.file === file).length >= minimum,
      `Full static regression no longer includes ${file}`);
    for (const test of standard.filter(entry => entry.file === file)) {
      assert.ok(earlyFunctional.has(key(test)), `Early functional selection omits ${file}: ${test.title}`);
    }
  }
  for (const project of ['chromium', 'firefox', 'webkit']) {
    assert.ok(carousel.filter(test => test.project === project).length >= HOMEPAGE_FUNCTIONAL_MINIMUMS['homepage-carousel-focused.spec.js'],
      `Existing ${project} carousel matrix has lost cases`);
  }
  return {
    standard: { total: standard.length, files: counts(standard) },
    carousel: { total: carousel.length, files: counts(carousel) },
    functional: { total: functional.length, files: counts(functional) },
    performance: { total: performance.length, files: counts(performance) },
    existingCommandUnion: oldUnion.size,
    combinedCommandUnion: combinedUnion.size,
    note: 'Discovery counts are not passed tests. Existing engine-specific runtime skips remain visible in execution reports.',
  };
}
