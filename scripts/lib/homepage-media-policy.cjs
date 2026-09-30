const assert = require('node:assert/strict');
const path = require('node:path');

// Candidate manifests, browser observations and both CI callers share this
// policy. Old reports cannot silently acquire the owner's revised acceptance.
const MEDIA_POLICY = 'decorative-fallback-v2';
const DECORATIVE_OBSERVATION_ATTACHMENT = 'decorative-media-observation';
const DECORATIVE_PLAYBACK_TAG = '@decorative-playback';
const checks = new Set(['initial-play', 'resume-onscreen', 'resume-visible', 'resume-pageshow',
  'range-loop', 'paused-transition', 'turn-acquisition', 'next-preview-requests',
  'next-preview-adoption', 'cancelled-preparation-output', 'post-bfcache-loop',
  'post-visibility-loop', 'frozen-control']);
// A captured decorative face may retire during a lawful future cycle. These
// are diagnostic outcomes only in tagged positive Hero observations: the case
// separately asserts current fallback, navigation, pause and cleanup contracts.
// Unknown reasons and observer exceptions never enter the quality exception.
const progressReasons = new Set(['detached', 'media-error', 'paused', 'seek-in-progress',
  'not-ready', 'no-new-output', 'loops-incomplete', 'four-distinct-active-slots-required',
  'observation-deadline', 'captured-identity-source-or-epoch-changed', 'resume-identity-source-or-epoch-changed']);
const transitionReasons = new Set(['no-paused-transition', 'invalid-paused-target',
  'target-removed-or-replaced', 'unobserved-or-foreign-completion', 'target-epoch-changed',
  'wrong-settled-target', 'resumed-target-no-output', 'transition-deadline']);
const slots = ['left_bottom', 'left_top', 'right_bottom', 'right_top'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value) && value >= 0;

function frozenSamples(result) {
  if (result.phase !== 'play-or-resume' || result.ownOutputObserved !== false || !result.samples?.length) return false;
  const baseline = result.samples[0];
  if (baseline.length !== 4 || new Set(baseline.map(sample => sample.slot)).size !== 4
    || new Set(baseline.map(sample => sample.id)).size !== 4) return false;
  return result.samples.every(sample => sample.length === 4 && new Set(sample.map(video => video.slot)).size === 4 && sample.every(video => {
    const before = baseline.find(before => before.slot === video.slot);
    return before && video.paused === true && video.id === before.id && typeof video.src === 'string' && video.src.length > 0
      && video.src === before.src && Number.isInteger(video.epoch) && video.epoch >= 0 && video.epoch === before.epoch
      && finite(video.outputAdvances) && video.outputAdvances === before.outputAdvances;
  }));
}

function validateDecorativeObservation(envelope) {
  assert(object(envelope), 'Missing decorative observation envelope');
  assert.equal(envelope.schema, 1, 'Unknown decorative observation schema');
  assert.equal(envelope.policy, MEDIA_POLICY, 'Retired decorative observation policy');
  assert.equal(envelope.kind, 'decorative-playback', 'Foreign decorative observation kind');
  assert(checks.has(envelope.check), 'Unknown decorative observation check');
  assert(['observed', 'warning'].includes(envelope.status), 'Unknown decorative observation status');
  assert(envelope.control === undefined || envelope.control === true, 'Invalid decorative control marker');
  const result = envelope.result;
  assert(object(result) && typeof result.passed === 'boolean' && finite(result.elapsed), 'Malformed decorative observation result');
  assert.equal(envelope.status, result.passed ? 'observed' : 'warning', 'Observation status contradicts raw result');
  let reasons;
  if (result.phase === 'observation-budget') {
    assert(!result.passed && result.reason === 'quality-budget-exhausted' && result.timeout === 0,
      'Malformed exhausted decorative observation budget');
    reasons = [result.reason];
  } else if (envelope.check === 'paused-transition') {
    assert(Array.isArray(result.targets) && typeof result.scope === 'string' && result.scope.length > 0,
      'Malformed decorative transition observation');
    assert(result.targets.every(object) && finite(result.timeout) && result.timeout > 0 && result.timeout <= 2000,
      'Malformed bounded decorative transition observation');
    if (result.passed) assert(result.targets.length > 0, 'Successful transition has no captured target');
    assert(result.passed ? result.reason === 'captured-targets-settled' : transitionReasons.has(result.reason),
      'Unknown or internal decorative transition failure');
    reasons = result.passed ? [] : [result.reason];
  } else if (['turn-acquisition', 'next-preview-requests', 'next-preview-adoption'].includes(envelope.check)) {
    assert.equal(result.phase, envelope.check, 'Decorative check/result phase mismatch');
    const limit = envelope.check === 'turn-acquisition' ? 3000 : 5000;
    assert(finite(result.timeout) && result.timeout > 0 && result.timeout <= limit && object(result.observed), 'Malformed bounded decorative observation');
    reasons = result.passed ? [] : [result.phase];
  } else {
    assert(['play-or-resume', 'loop'].includes(result.phase) && Array.isArray(result.samples)
      && result.samples.length > 0 && result.samples.every(Array.isArray)
      && Array.isArray(result.issues) && finite(result.timeout) && result.timeout > 0 && result.timeout <= 5000,
    'Malformed decorative progress observation');
    assert.equal(result.phase, ['range-loop', 'post-bfcache-loop', 'post-visibility-loop'].includes(envelope.check)
      ? 'loop' : 'play-or-resume', 'Decorative check/result phase mismatch');
    const samples = result.samples.flat();
    assert(samples.length > 0 && samples.every(sample => object(sample)
      && Number.isInteger(sample.id) && sample.id > 0 && slots.includes(sample.slot)),
    'Decorative progress lacks valid sampled identities');
    assert(result.issues.every(issue => object(issue) && progressReasons.has(issue.condition)),
      'Unknown decorative progress failure');
    if (result.passed) assert.equal(result.issues.length, 0, 'Successful observation contains failures');
    else assert(result.issues.length > 0 || (result.ownOutputObserved === false && result.elapsed >= result.timeout),
      'Failed observation has no quality finding');
    reasons = [...new Set(result.issues.map(issue => issue.condition))];
    if (!result.passed && reasons.length === 0) reasons.push('own-output-deadline');
  }
  if (envelope.status === 'warning') {
    assert(object(envelope.fallback) && Array.isArray(envelope.fallback.slots), 'Warning lacks verified visible fallback');
    assert.deepEqual(envelope.fallback.slots.map(slot => slot.slot).sort(), slots, 'Warning lacks four distinct fallback slots');
    assert(envelope.fallback.slots.every(slot => slot.visible === true && slot.decoded === true),
      'Warning has an invisible or invalid fallback');
  }
  return reasons;
}

function verifyDecorativeObservations(report, { engine, requiredTitles }) {
  assert(['chromium', 'webkit'].includes(engine), 'Unknown decorative report engine');
  assert(Array.isArray(requiredTitles) && requiredTitles.length > 0, 'Missing decorative case allowlist');
  assert(Array.isArray(report?.suites), 'Missing decorative execution report');
  assert(Array.isArray(report.errors || []) && (report.errors || []).length === 0, 'Homepage execution reported errors');
  const summary = { schema: 1, policy: MEDIA_POLICY, engine, observations: 0, observed: 0, warnings: 0, controlWarnings: 0, checks: [] };
  const seen = new Set();
  const visit = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      const tagged = (spec.tags || []).some(tag => tag.replace(/^@/, '') === DECORATIVE_PLAYBACK_TAG.slice(1));
      const attachments = (test.results || []).flatMap(result => result.attachments || [])
        .filter(attachment => attachment.name === DECORATIVE_OBSERVATION_ATTACHMENT);
      if (!tagged && !attachments.length) continue;
      assert(tagged && path.basename(spec.file || '') === 'homepage-hero-playback.spec.js'
        && requiredTitles.includes(spec.title), 'Decorative policy used outside an allowed Hero case');
      assert.equal(test.projectName, engine, 'Decorative observation from the wrong engine');
      assert.equal(test.expectedStatus, 'passed', 'Decorative case must expect functional success');
      assert.equal(test.results?.length, 1, 'Decorative case missing or retried');
      assert.equal(test.results[0].status, 'passed', 'Decorative warning cannot accept a functional failure');
      assert.equal((test.results[0].errors || []).length, 0, 'Decorative case contains an execution error');
      assert(attachments.length > 0, 'Missing required decorative observation attachment');
      assert(!seen.has(spec.title), 'Duplicate decorative case execution');
      seen.add(spec.title);
      let frozenWarning = false;
      for (const attachment of attachments) {
        assert.equal(attachment.contentType, 'application/json', 'Wrong decorative attachment content type');
        assert(typeof attachment.body === 'string' && attachment.body.length > 0
          && Buffer.from(attachment.body, 'base64').toString('base64') === attachment.body,
        'Decorative observation must contain inline JSON evidence');
        const envelope = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
        const reasons = validateDecorativeObservation(envelope);
        const control = spec.title.endsWith(': decorative frozen media warns while fallback and Models remain required');
        assert.equal(envelope.control === true, control, 'Decorative control marker/title mismatch');
        if (envelope.check === 'frozen-control') assert(control, 'Frozen control used outside its dedicated case');
        frozenWarning ||= control && envelope.check === 'frozen-control' && envelope.status === 'warning'
          && frozenSamples(envelope.result);
        summary.observations++;
        if (envelope.status === 'observed') summary.observed++;
        else if (control) summary.controlWarnings++;
        else summary.warnings++;
        summary.checks.push({ title: spec.title, check: envelope.check, status: envelope.status, control, reasons });
      }
      if (spec.title.endsWith(': decorative frozen media warns while fallback and Models remain required'))
        assert(frozenWarning, 'Deliberately frozen control did not record its required warning');
    }
    for (const child of suite.suites || []) visit(child);
  };
  report.suites.forEach(visit);
  assert.deepEqual([...seen].sort(), [...requiredTitles].sort(), 'Missing required decorative case observations');
  assert(summary.observations > 0, 'No required decorative observations executed');
  return summary;
}

function printDecorativeSummary(summary) {
  console.log(JSON.stringify({ decorativeMedia: summary }));
  for (const check of summary.checks.filter(check => check.status === 'warning' && !check.control)) {
    const message = `${summary.policy}: ${check.title} / ${check.check}: ${check.reasons.join(', ')}; functional fallback and navigation passed`;
    // Only validated fixed titles/check/reason enums reach the workflow command.
    console.log(`::warning title=Accepted decorative playback limitation::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  }
}

module.exports = { MEDIA_POLICY, DECORATIVE_OBSERVATION_ATTACHMENT, DECORATIVE_PLAYBACK_TAG,
  validateDecorativeObservation, verifyDecorativeObservations, printDecorativeSummary };
