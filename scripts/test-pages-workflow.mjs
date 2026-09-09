import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual, deliberately simple workflow conditions with synthetic
// GitHub step states. This is orchestration acceptance, not a live Pages test.
const read = name => fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const standard = read('static');
const fast = read('ui-fast-deploy');
const job = (source, name) => {
  const block = source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert(block, `missing job ${name}`);
  return block[0];
};
const steps = source => [...source.matchAll(/^      - name: (.+)\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/gm)]
  .map(m => ({name: m[1], source: m[2], condition: m[2].match(/^        if: (.+)$/m)?.[1]}));
const permits = (step, context) => {
  const expression = step.condition || 'success()';
  assert(!/always\(|failure\(|cancelled\(/.test(expression), 'no post-failure deployment/reconciliation');
  // These production conditions explicitly use success(), or GitHub supplies it.
  return context.success() && Boolean(vm.runInNewContext(expression, context, {timeout: 100}));
};

const early = steps(job(standard, 'release-compatibility'));
const late = steps(job(standard, 'deploy'));
const preflight = early.find(s => s.name === 'Preflight complete static release plan');
const guard = late.find(s => s.name === 'Check static deploy release-plan safety');
assert(preflight && guard);
const guardInputs = s => s.source.slice(s.source.indexOf('        env:'));
assert.equal(guardInputs(preflight), guardInputs(guard), 'early and last guard use identical command and GitHub inputs');
assert(early.indexOf(preflight) < early.findIndex(s => s.name === 'Select tests from changed files'));
assert(guardInputs(preflight).includes('STATIC_DEPLOY_HEAD_REF: ${{ github.sha }}'));
assert(guardInputs(preflight).includes('github.event.inputs.release_plan_base_ref'));
assert(guardInputs(preflight).includes('github.event.inputs.release_plan_dependency_acknowledgement'));
for (const source of [standard, fast]) {
  for (const checkout of source.matchAll(/uses: actions\/checkout@v5\n([\s\S]*?)(?=^      - name:)/gm)) {
    assert(checkout[1].includes('ref: ${{ github.sha }}'), 'checkout stays on event SHA, never later main');
  }
  assert(!/pages\/deployments\/|Reconcile authoritative|DEPLOY_PAGES_OUTCOME|deadline=/.test(source), 'no independent SHA-based or ambient reconciliation');
}
for (const name of ['worker-validation', 'browser-validation', 'homepage-validation', 'homepage-webkit-media']) {
  assert(job(standard, name).includes('needs: release-compatibility'), `${name} waits for actual preflight`);
}

for (const [name, source] of [['standard', standard], ['fast', fast]]) {
  const deploySteps = steps(job(source, 'deploy'));
  const action = deploySteps.find(s => s.name === 'Deploy to GitHub Pages');
  assert(action?.source.includes('uses: actions/deploy-pages@v5'));
  assert(!action.source.includes('continue-on-error'), 'official action failure must remain fatal');
  assert(action.source.includes('timeout: 600000'));
  assert(action.source.includes('error_count: 1'), 'API errors are not silently treated as pending for 35 minutes');
  assert.equal(deploySteps.at(-1), action, 'official action is sole deployment completion authority');
  const context = (overrides = {}) => ({
    success: () => true,
    github: {event_name: 'workflow_dispatch'},
    needs: {guard: {result: 'success'}},
    steps: {
      static_safety: {outcome: 'success', outputs: {static_deploy_allowed: 'true', static_deploy_skipped: 'false', static_deploy_required: 'true'}},
      static_build: {outcome: 'success'}, pages_artifact: {outcome: 'success'},
    }, ...overrides,
  });
  assert.equal(permits(action, context()), true, `${name}: acknowledged successful prerequisites deploy`);
  for (const outcome of ['failure', 'cancelled', 'skipped', '']) {
    for (const predecessor of ['static_build', 'pages_artifact']) {
      const c = context(); c.steps[predecessor].outcome = outcome;
      assert.equal(permits(action, c), false, `${name}: ${predecessor}/${outcome} cannot start deployment`);
    }
  }
  assert.equal(permits(action, context({success: () => false})), false, `${name}: failure/cancellation stops new work`);
  if (name === 'standard') {
    for (const state of [
      {outcome: 'failure', outputs: {static_deploy_allowed: 'false', static_deploy_skipped: 'false'}},
      {outcome: 'skipped', outputs: {}}, {outcome: '', outputs: {}},
      {outcome: 'success', outputs: {}},
      {outcome: 'success', outputs: {static_deploy_allowed: 'false', static_deploy_skipped: 'true'}},
    ]) {
      const c = context(); c.steps.static_safety = state;
      for (const step of deploySteps.filter(s => ['Setup Pages', 'Prepare deployment', 'Upload artifact', 'Deploy to GitHub Pages'].includes(s.name))) {
        assert.equal(permits(step, c), false, `blocked/missing/skipped guard: ${step.name}`);
      }
    }
    const c = context(); c.github.event_name = 'push'; c.steps.static_safety.outputs.static_deploy_required = 'false';
    assert.equal(permits(action, c), false, 'validation-only push does not deploy');
    c.steps.static_safety.outputs.static_deploy_required = 'true';
    assert.equal(permits(action, c), true, 'allowed static-only push deploys');
  } else {
    const c = context(); c.needs.guard.result = 'failure';
    assert.equal(permits(action, c), false, 'failed fast guard cannot deploy');
  }
  // An action result is terminal in this workflow: no secondary lookup can
  // replace failure/skipped/cancelled with an older successful deployment.
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped']) {
    const states = new Map(deploySteps.map(step => [step, 'success']));
    states.set(action, outcome);
    assert.equal([...states.values()].includes('failure'), outcome === 'failure');
    assert.equal(deploySteps.slice(deploySteps.indexOf(action) + 1).length, 0);
  }
}
console.log('Pages workflow state, immutable checkout and identical early/final guard controls passed.');
