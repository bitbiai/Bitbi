import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { requiresPrivateMediaImage } from './ci-test-selection.mjs';

export const LOCAL_POLICY = 'development-mac-v1';
export const PLAN_FILE = 'config/release-validation.yml';
const require=createRequire(import.meta.url);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// User-media suites need the codec-capable macOS Chromium/WebKit distribution.
// The carousel's complete three-engine matrix and Linux functional job retain
// the pinned Linux image. Split only the existing two-command full-browser step.
export function commandRuntimes(command) {
  if (command.job !== 'browser-validation' || !/\b(?:playwright|npm run test:)\b/.test(command.run))
    return [{runtime:'linux',run:command.run}];
  if (command.name === 'Run full static browser regression') {
    const lines=command.run.trim().split('\n');
    assert.equal(lines.length,2,'Full browser command changed; review runtime routing');
    assert.match(lines[0],/ npm run test:static /);
    assert.match(lines[1],/ npm run test:homepage-carousel /);
    return [{runtime:'native-browser-v1',run:lines[0]},{runtime:'linux',run:lines[1]}];
  }
  return [{runtime:command.name==='Run selected homepage carousel tests'?'linux':'native-browser-v1',run:command.run}];
}
export function nativeBrowserKey({node,playwright,platform,kernel,inputs,binaries}) {
  return sha256(JSON.stringify({policy:'native-browser-v1',node,playwright,platform,kernel,inputs,binaries}));
}
export function validationPlan(root = '.') {
  const bytes = fs.readFileSync(`${root}/${PLAN_FILE}`);
  const plan = require('../../node_modules/playwright-core/lib/utilsBundle.js').yaml.parse(bytes.toString());
  assert.equal(plan.version, 1, 'Unknown local validation plan');
  assert.deepEqual(Object.keys(plan.jobs),['release-compatibility','worker-validation','homepage-validation','browser-validation'],'Unknown/incomplete release command groups');
  for(const [job,required] of Object.entries({
    'release-compatibility':['Install dependencies','Install pinned frontend runtime tooling'],
    'worker-validation':['Install pinned Auth target-runtime test dependencies','Install Worker media test tools'],
    'homepage-validation':['Prepare unprivileged tool paths','Verify pinned browser image and unprivileged runtime'],
    'browser-validation':['Install Canvas browser media tools','Install carousel browser matrix','Restore exact candidate static site'],
  }))for(const name of required)assert.equal(plan.jobs[job].steps.filter(step=>step.name===name).length,1,`Missing/duplicate required preparation: ${name}`);
  return { ...plan, digest: sha256(bytes) };
}
export function expression(source, context) {
  const text = String(source).replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1')
    .replace(/needs\.([\w-]+)/g, (_, key) => `needs[${JSON.stringify(key)}]`);
  return vm.runInNewContext(text, context, { timeout: 100 });
}
export function interpolate(source, context) {
  return String(source).replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_, code) => String(expression(code, context) ?? ''));
}
export function selectionOutputs(selection) {
  // GitHub missing outputs evaluate to empty text, not JS undefined. In
  // particular an ordinary release must not select the historical repair tail.
  return { browser_repair:'false', repair_source_sha:'', repair_source_run:'', repair_source_attempt:'',
    ...Object.fromEntries(Object.entries(selection).map(([key, value]) => [key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), String(value)])) };
}
export function planContext(selection, env = {}) {
  const outputs = selectionOutputs(selection);
  return { env: { REPAIR_SOURCE_SHA: '', ...env }, github: { sha: env.GITHUB_SHA, event_name: 'push', token: '', event: { inputs: {} } },
    runner: { temp: '/tmp/bitbi-release' },
    needs: { 'release-compatibility': { result: 'success', outputs } },
    steps: { selection: { outputs }, media_image: { outputs: { required: String(requiresPrivateMediaImage(selection.files || [])) } }, homepage_discovery: { outcome: 'success' } },
    success: () => true, failure: () => false, cancelled: () => false, always: () => true };
}
// Only setup/transport operations are delegated to the local environment manager.
// Every test/check/build command remains in the versioned execution contract.
export const PREPARED_STEPS = new Set([
  'Read hosting target', 'Resolve verified published Pages baseline', 'Select tests from changed files',
  'Install dependencies', 'Install pinned frontend runtime tooling', 'Install pinned Auth target-runtime test dependencies',
  'Prepare unprivileged tool paths', 'Install Worker media test tools', 'Install Canvas browser media tools',
  'Install carousel browser matrix', 'Install browsers for selected frontend tests', 'Install Admin acceptance browsers',
]);
function preparedStep(step) {
  // A familiar label cannot hide a new test or mutation. These installer/read
  // capabilities are provided by the pinned image and outer baseline resolver.
  if(!PREPARED_STEPS.has(step.name))return false;
  const allowed={
    'Read hosting target': /^node scripts\/frontend-release\.mjs target$/,
    'Resolve verified published Pages baseline': /^node scripts\/pages-candidate\.mjs baseline$/,
    'Select tests from changed files': /^node scripts\/select-ci-tests\.mjs --base "\$CI_BASE_REF" --head "\$CI_HEAD_REF" --github-output$/,
    'Install dependencies': /^npm ci$/,
    'Install pinned frontend runtime tooling': /^npm --prefix workers\/contact ci$/,
    'Install pinned Auth target-runtime test dependencies': /^npm --prefix workers\/auth ci$/,
    'Install Worker media test tools': /^bash scripts\/setup-media-tools\.sh$/,
    'Install Canvas browser media tools': /^bash scripts\/setup-media-tools\.sh$/,
    'Install carousel browser matrix': /^npx playwright install --with-deps chromium firefox webkit$/,
    'Install Admin acceptance browsers': /^npx playwright install --with-deps chromium webkit$/,
  };
  if(allowed[step.name])assert.match(step.run.trim(),allowed[step.name],`Changed preparation capability: ${step.name}`);
  else if(step.name==='Install browsers for selected frontend tests') {
    const lines=step.run.trim().split('\n').map(line=>line.trim());
    assert.equal(lines.length,5);
    assert(lines[0].startsWith('if [ ') && lines[0].endsWith(' ]; then'));
    assert.equal(lines[1],'npx playwright install --with-deps chromium webkit');
    assert.equal(lines[2],'else');assert.equal(lines[3],lines[1]);assert.equal(lines[4],'fi');
  } else {
    assert.equal(step.name,'Prepare unprivileged tool paths');
    assert.equal(step.run.trim(), 'set -eu\ntest "$(id -u)" = 1001\ntest "$(id -g)" = 1001\nmkdir -p /tmp/bitbi-homepage-npm\ntest -n "${RUNNER_TOOL_CACHE:-}"\ntest -w "$RUNNER_TOOL_CACHE"\ntest -w "$HOME"');
  }
  return true;
}
export function selectedCommands(selection, env = {}, root = '.') {
  const plan = validationPlan(root), context = planContext(selection, env), commands = [];
  for (const [job, definition] of Object.entries(plan.jobs)) {
    if (job === 'worker-validation' && !selection.workers) continue;
    if (job === 'homepage-validation' && !selection.homepage && !selection.carousel) continue;
    if (job === 'browser-validation' && !['homepage', 'carousel', 'assets', 'auth'].some(key => selection[key])) continue;
    for (const step of definition.steps) {
      if (step.if && !expression(step.if, context)) continue;
      if (step.uses) {
        assert(/^(actions\/(checkout|setup-node|upload-artifact|download-artifact))@/.test(step.uses), 'Unknown release action');
        continue;
      }
      if (preparedStep(step)) continue;
      assert(step.run && !step['continue-on-error'], `Missing blocking command ${step.name}`);
      commands.push({ job, name: step.name, run: interpolate(step.run, context),
        env: Object.fromEntries(Object.entries(step.env || {}).map(([key, value]) => [key, interpolate(value, context)])) });
    }
  }
  return commands;
}
