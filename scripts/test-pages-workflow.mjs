import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

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
  return context.success() && Boolean(vm.runInNewContext(expression.replaceAll('needs.release-compatibility', "needs['release-compatibility']").replaceAll('needs.reuse-candidate', "needs['reuse-candidate']"), context, {timeout: 100}));
};

// The full Worker caller includes real FFmpeg/ffprobe integration. Narrow
// status/asset branches do not; neither should install unrelated tools.
const workerSteps=steps(job(standard,'worker-validation'));
const mediaTools=workerSteps.find(s=>s.name==='Install Worker media test tools');
assert(mediaTools,'Full Worker tests require explicit media tools');
assert(workerSteps.indexOf(mediaTools)<workerSteps.findIndex(s=>s.name==='Run worker route tests'));
for(const workers of ['true','false',undefined])for(const model_status of ['true','false',undefined])for(const member_assets of ['true','false',undefined])for(const success of [true,false]) {
  const context={success:()=>success,needs:{'release-compatibility':{outputs:{workers,model_status,member_assets}}}};
  assert.equal(permits(mediaTools,context),success&&workers==='true'&&model_status!=='true'&&member_assets!=='true');
}
// Execute the real narrow/full step conditions: unselected native evidence is
// absent, while missing/failed lifecycle execution still blocks its candidate.
for(const media_lifecycle of ['true','false',undefined]) for(const required of ['true','false',undefined]) {
 const context={success:()=>true,needs:{'release-compatibility':{outputs:{workers:'true',media_lifecycle}}},steps:{media_image:{outputs:{required}}}};
 for(const name of ['Verify native Linux isolation before Worker tests','Run worker route tests'])
   assert.equal(permits(workerSteps.find(s=>s.name===name),context),media_lifecycle!=='true');
 const step=workerSteps.find(s=>s.name==='Run private media lifecycle tests');
 assert.equal(permits(step,context),media_lifecycle==='true'||required==='true');
 assert.equal(permits(step,{...context,success:()=>false}),false);
}
const setupScript=mediaTools.source.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
assert.equal(spawnSync('/bin/bash',['-n'],{input:setupScript,encoding:'utf8'}).status,0);
// Execute the actual shell with harmless tool functions: order and fail-fast,
// not an Ubuntu install or a substitute for the required native Linux job.
for(const installFails of [false,true]) {
  const functions=`sudo() { printf '%s\\n' "$*"; if [ "$2" = install ]; then return ${installFails?9:0}; fi; }; ffmpeg() { printf 'ffmpeg %s\\n' "$*"; }; ffprobe() { printf 'ffprobe %s\\n' "$*"; };`;
  const result=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',functions+'\n'+setupScript],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
  assert.equal(result.status,installFails?9:0);
  assert.deepEqual(result.stdout.trim().split('\n'),installFails?['apt-get update','apt-get install -y ffmpeg']:['apt-get update','apt-get install -y ffmpeg','ffmpeg','ffprobe','ffmpeg -version','ffprobe -version']);
}

const early = steps(job(standard, 'release-compatibility'));
const late = steps(job(standard, 'deploy'));
const preflight = early.find(s => s.name === 'Preflight complete static release plan');
const guard = late.find(s => s.name === 'Check static deploy release-plan safety');
assert(preflight && guard);
const guardInputs = s => s.source.slice(s.source.indexOf('        env:')).split('\n').filter(line=>!/GH_TOKEN:|CLOUDFLARE_API_TOKEN:|CLOUDFLARE_ACCOUNT_ID:|CF_BACKEND_DEPLOY_TOKEN:/.test(line)).join('\n').replace(' --backend-preflight','');
assert(preflight.source.includes('--backend-preflight'));assert(!guard.source.includes('--backend-preflight'));
assert.equal(guardInputs(preflight), guardInputs(guard), 'early and last guard use identical command and GitHub inputs');
assert(early.indexOf(preflight) < early.findIndex(s => s.name === 'Select tests from changed files'));
assert(guardInputs(preflight).includes('STATIC_DEPLOY_HEAD_REF: ${{ github.sha }}'));
assert(guardInputs(preflight).includes('env.CANDIDATE_BASE'));
assert(early.find(s => s.name === 'Resolve verified published Pages baseline').source.includes('node scripts/pages-candidate.mjs baseline'));
assert(standard.includes('candidate_base: ${{ steps.baseline.outputs.base }}'));
assert(!standard.includes("|| '8292a492"), 'completed Q4 must not remain an implicit unpublished base');
assert(guardInputs(preflight).includes('github.event.inputs.release_plan_dependency_acknowledgement'));
for (const source of [standard, fast]) {
  for (const checkout of source.matchAll(/uses: actions\/checkout@v5\n([\s\S]*?)(?=^      - name:)/gm)) {
    assert(checkout[1].includes('ref: ${{ github.sha }}'), 'checkout stays on event SHA, never later main');
  }
  assert(!/pages\/deployments\/|Reconcile authoritative|DEPLOY_PAGES_OUTCOME|deadline=/.test(source), 'no independent SHA-based or ambient reconciliation');
}
for (const name of ['worker-validation', 'browser-validation', 'homepage-validation', 'homepage-webkit-media']) {
  assert(job(standard, name).includes(name==='browser-validation' ? 'needs: [release-compatibility, homepage-validation, homepage-webkit-media, worker-validation]' : 'needs: release-compatibility'), `${name} waits for actual preflight`);
}

for (const [name, source] of [['standard', standard], ['fast', fast]]) {
  const deploySteps = steps(job(source, 'deploy'));
  const action = deploySteps.find(s => s.name === 'Deploy to GitHub Pages');
  assert(action?.source.includes('uses: actions/deploy-pages@v5'));
  assert(!action.source.includes('continue-on-error'), 'official action failure must remain fatal');
  assert(action.source.includes('timeout: 600000'));
  assert(action.source.includes('error_count: 1'), 'API errors are not silently treated as pending for 35 minutes');
  if(name==='fast')assert.equal(deploySteps.at(-1),action);
  else assert(deploySteps.filter(s=>s.name==='Deploy and verify Cloudflare frontend').length===1);
  const context = (overrides = {}) => ({
    success: () => true,
    github: {event_name: 'workflow_dispatch'}, env:{HOSTING_PROVIDER:'github-pages'},
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
    for(const later of deploySteps.slice(deploySteps.indexOf(action)+1).filter(s=>s.name!=='Preserve failed frontend upload identity'))assert.equal(permits(later,context()),false,'Cloudflare steps must not follow a Pages publication');
  }
}

const cfSteps=steps(job(standard,'deploy'));
const cfDeploy=cfSteps.find(s=>s.name==='Deploy and verify Cloudflare frontend');
const cfContext={success:()=>true,env:{HOSTING_PROVIDER:'cloudflare'},steps:{static_build:{outcome:'success'}}};
assert(permits(cfDeploy,cfContext));
for(const outcome of ['failure','skipped','cancelled',undefined])assert(!permits(cfDeploy,{...cfContext,steps:{static_build:{outcome}}}));
assert(!permits(cfDeploy,{...cfContext,success:()=>false}));
assert(!permits(cfDeploy,{...cfContext,env:{HOSTING_PROVIDER:'github-pages'}}));
assert(!/\n  push:/.test(fast),'Legacy fast writer must not compete with normal build-once pushes');
assert(standard.includes('name: Check frontend hosting package') && standard.includes('npm run test:frontend-hosting'));
console.log('Pages workflow state, immutable checkout and identical early/final guard controls passed.');

await import('./test-pages-candidate.mjs');

const diagnostic=cfSteps.find(s=>s.name==='Preserve failed frontend upload identity');
assert(diagnostic.source.includes('path: test-results/frontend-upload.ndjson'));
for(const failed of [true,false])for(const cancelled of [true,false])for(const provider of ['github-pages','cloudflare']) {
 assert.equal(Boolean(vm.runInNewContext(diagnostic.condition,{failure:()=>failed,cancelled:()=>cancelled,env:{HOSTING_PROVIDER:provider}})),failed&&!cancelled&&provider==='cloudflare');
}

// Automatic backend continuation stays under the same protected lock and all
// selected job gates. No backend failure may begin frontend publication.
const backend=cfSteps.find(s=>s.name==='Apply verified candidate backend prerequisites');
assert(cfSteps.indexOf(backend)>cfSteps.findIndex(s=>s.name==="Download this run's tested candidate"));
assert(cfSteps.indexOf(backend)<cfSteps.findIndex(s=>s.name==='Check static deploy release-plan safety'));
for(const reused of ['true','false',undefined])for(const result of ['true','false',undefined])for(const success of [true,false]) {
 const context={success:()=>success,env:{HOSTING_PROVIDER:'cloudflare'},needs:{'release-compatibility':{outputs:{backend_continuation:result}},'reuse-candidate':{outputs:{backend_continuation:reused}}}};
 assert.equal(permits(backend,context),success&&(result==='true'||reused==='true'));
}
assert(!permits(cfDeploy,{...cfContext,success:()=>false}),'failed schema/backend blocks frontend');
assert(job(standard,'deploy').includes('group: "pages"'));

assert(!job(standard,'release-compatibility').includes('secrets.CF_BACKEND_DEPLOY_TOKEN'),'No backend credential in validation');
const diagnostics=cfSteps.find(s=>s.name==='Preserve redacted backend failure diagnostics');
assert(diagnostics&&cfSteps.indexOf(diagnostics)>cfSteps.indexOf(backend));
assert.equal(diagnostics.source.match(/path: (.+)/)[1],'test-results/backend-diagnostics.jsonl','Never upload raw Wrangler bindings or credential files');
for(const failed of [true,false])assert.equal(vm.runInNewContext(diagnostics.condition,{failure:()=>failed}),failed);
assert(!permits(cfDeploy,{...cfContext,success:()=>false}),'Retaining diagnostics must not allow failed publication');
