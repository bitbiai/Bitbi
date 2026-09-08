import assert from 'node:assert/strict';
import path from 'node:path';

export const HOMEPAGE_FUNCTIONAL_MINIMUMS = Object.freeze({
  'homepage-carousel-focused.spec.js': 5,
  'homepage-creation-stream-anchor.spec.js': 4,
  'homepage-hero-playback.spec.js': 14,
  'homepage-native-control.spec.js': 2,
  'homepage-hero-state.spec.js': 3,
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
export const HOMEPAGE_EARLY_CHROMIUM_REQUIRED = Object.freeze(['native plain video: fulfill transport comparison', 'native plain video: HTTP response loops and seeks', 'native HTTP corrupt media is rejected, not mistaken for playback', 'native pause contract rejects ignored pause, transient source changes and stale resume proof']);
export const HOMEPAGE_WEBKIT_REQUIRED = Object.freeze([...HOMEPAGE_EARLY_CHROMIUM_REQUIRED, ...['en', 'de'].flatMap((locale) => [
  `${locale}: configured hero pauses offscreen and hidden, resumes existing media and respects an existing pause`,
  `${locale}: hidden initialization and bfcache restore preserve media; ordinary pagehide cleans up`,
  `${locale}: configured native media loops in every slot with the public range file contract`,
  `${locale}: fallback freezes media and its staggered cycle while suspended`,
  `${locale}: phone and tablet breakpoints retain existing policy with reduced motion`,
])]);

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

export function verifyHomepageDiscovery({ standard, carousel, functional, webkit, performance, diagnostic }) {
  for (const [name, tests] of Object.entries({ standard, carousel, functional, webkit, performance, diagnostic })) {
    assert.ok(Array.isArray(tests) && tests.length > 0, `${name}: no tests discovered`);
  }
  const counts = (tests) => Object.fromEntries([...new Set(tests.map((test) => test.file))].sort()
    .map((file) => [file, tests.filter((test) => test.file === file).length]));
  const nativeFiles = ['homepage-hero-playback.spec.js', 'homepage-native-control.spec.js'];
  assert.ok(webkit.every(test => test.project === 'webkit' && nativeFiles.includes(test.file)
    && test.expectedStatus !== 'skipped'), 'macOS replacement must execute only native WebKit media, without skips');
  for (const title of HOMEPAGE_WEBKIT_REQUIRED) assert.ok(webkit.some(test => test.file === nativeFiles[0] && test.title === title),
    `Required macOS WebKit scenario missing: ${title}`);
  for (const project of ['chromium', 'webkit']) {
    for (const [file, minimum] of Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)) {
      const matches = functional.filter(test => test.project === project && test.file === file);
      if (project === 'webkit' && nativeFiles.includes(file)) {
        assert.equal(matches.length, 0, 'Linux must not duplicate the moved native WebKit cases');
        continue;
      }
      assert.ok(matches.length >= minimum, `${project}/${file}: ${matches.length} tests; require at least ${minimum}`);
      assert.ok(matches.every(test => test.expectedStatus !== 'skipped'), `${project}/${file}: statically skipped mandatory case`);
    }
  }
  // Exact scenario union: every Chromium native scenario also executes on the
  // replacement WebKit platform. Missing/extra media cases fail discovery.
  const mediaKey = test => [test.file, test.title].join('\0');
  const chromiumMedia = functional.filter(test => test.project === 'chromium' && nativeFiles.includes(test.file));
  assert.deepEqual([...new Set(webkit.map(mediaKey))].sort(), [...new Set(chromiumMedia.map(mediaKey))].sort(),
    'macOS/Linux native media scenario union differs');
  assert.ok(diagnostic.every(test => test.project === 'webkit' && test.file === nativeFiles[1]
    && test.expectedStatus !== 'skipped'), 'Linux diagnosis must contain only the independent native controls');
  assert.deepEqual(diagnostic.map(mediaKey).sort(), webkit.filter(test => test.file === nativeFiles[1]).map(mediaKey).sort(),
    'Linux diagnosis has lost an independent source control');
  assert.ok(performance.every((test) => test.project === 'chromium-performance'), 'Performance must use its controlled Chromium project');
  assert.ok(performance.every((test) => test.expectedStatus !== 'skipped'), 'Performance acceptance cannot be statically skipped');
  for (const [file, titles] of Object.entries(HOMEPAGE_PERFORMANCE_REQUIRED)) {
    for (const title of titles) assert.ok(performance.some((test) => test.file === file
      && (test.title === title || test.title.endsWith(` > ${title}`))
      // The installed Playwright JSON reporter strips the leading @.
      && test.tags.some((tag) => tag.replace(/^@/, '') === 'homepage-performance')),
    `Controlled performance is missing a required marked scenario: ${file}: ${title}`);
  }

  // Record the complete union of the retained commands. The orchestration
  // regression separately verifies that neither old command is removed.
  const oldUnion = new Set([...standard, ...carousel].map(key));
  const combinedUnion = new Set([...standard, ...carousel, ...functional, ...webkit, ...performance].map(key));
  const earlyFunctional = new Set(functional.map(key));
  for (const [file, minimum] of Object.entries(HOMEPAGE_FUNCTIONAL_MINIMUMS)) {
    if (nativeFiles.includes(file)) {
      assert.equal(standard.filter(test => test.file === file).length, 0, 'Native media should not repeat in the broad job');
      continue;
    }
    assert.ok(standard.filter((test) => test.file === file).length >= minimum,
      `Full static regression no longer includes ${file}`);
    for (const test of standard.filter((entry) => entry.file === file)) {
      assert.ok(earlyFunctional.has(key(test)), `Early functional selection omits ${file}: ${test.title}`);
    }
  }
  for (const project of ['chromium', 'firefox', 'webkit']) {
    assert.ok(carousel.filter((test) => test.project === project).length >= HOMEPAGE_FUNCTIONAL_MINIMUMS['homepage-carousel-focused.spec.js'],
      `Existing ${project} carousel matrix has lost cases`);
  }
  return {
    standard: { total: standard.length, files: counts(standard) },
    carousel: { total: carousel.length, files: counts(carousel) },
    functional: { total: functional.length, files: counts(functional) },
    webkit: { total: webkit.length, files: counts(webkit) },
    performance: { total: performance.length, files: counts(performance) },
    diagnostic: { total: diagnostic.length, files: counts(diagnostic), acceptance: false },
    existingCommandUnion: oldUnion.size,
    combinedCommandUnion: combinedUnion.size,
    note: 'Discovery counts are not passed tests. Existing engine-specific runtime skips remain visible in execution reports.',
  };
}
