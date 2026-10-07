import { releaseValidationSource } from './lib/release-validation-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyPublishedAppearance,appearanceHtmlBytes,publishFrontend} from './frontend-release.mjs';
import {hasRetiredDecorativeHeroAutomation} from './lib/release-compat.mjs';

// Execute the actual, deliberately simple workflow conditions with synthetic
// GitHub step states. This is orchestration acceptance, not a live Pages test.
const read = name => fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const standard = releaseValidationSource();
const fast = read('ui-fast-deploy');
const job = (source, name) => {
  const block = source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert(block, `missing job ${name}`);
  return block[0];
};
const steps = source => [...source.matchAll(/^      - name: (.+)\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/gm)]
  .map(m => ({name: m[1], source: m[2], condition: m[2].match(/^        if: (.+)$/m)?.[1]}));
const permits = (step, context) => {
  const expression = (step.condition || 'success()').replace(/^\$\{\{ (.*) \}\}$/, '$1');
  assert(!/always\(|failure\(|cancelled\(/.test(expression), 'no post-failure deployment/reconciliation');
  // These production conditions explicitly use success(), or GitHub supplies it.
  return context.success() && Boolean(vm.runInNewContext(expression.replaceAll('needs.release-compatibility', "needs['release-compatibility']").replaceAll('needs.reuse-candidate', "needs['reuse-candidate']"), context, {timeout: 100}));
};

// The full Worker caller includes real FFmpeg/ffprobe integration. Narrow
// status/asset branches do not; neither should install unrelated tools.
const releaseSteps=steps(job(standard,'release-compatibility'));
assert(releaseSteps.findIndex(s=>s.name==='Install pinned frontend runtime tooling')<releaseSteps.findIndex(s=>s.name==='Run release planner tests'),'Pinned original-image decoder must be installed before acceptance regressions');
assert(steps(job(standard,'deploy')).find(s=>s.name==='Apply verified candidate backend prerequisites').source.includes('npm --prefix workers/contact ci'),'Protected recovery verifier needs its pinned decoder');
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
const setupCommand='bash scripts/setup-media-tools.sh';
function requiresMediaSetup(source,jobName,setupName,callerNames) {
  const list=steps(job(source,jobName)),setup=list.find(s=>s.name===setupName);
  assert(setup?.source.includes(`run: ${setupCommand}`),`${jobName}: shared media setup is required`);
  for(const name of callerNames) {
    const caller=list.find(s=>s.name===name);
    assert(caller && list.indexOf(setup)<list.indexOf(caller),`${jobName}: setup precedes ${name}`);
  }
  return setup;
}
const full=read('full-regression'),processor=read('memvid-stream-preview-processor');
// Every retained functional caller validates the executed report against its
// discovery. Missing reports or functional failures cannot become candidate proof.
function requiresHomepageReportVerification(source, { candidate }) {
  const body=job(source,'homepage-validation'),list=steps(body);
  const caller=list.find(step=>step.name==='Run Linux homepage functional acceptance');
  const check=list.find(step=>step.name===(candidate?'Confirm tested candidate bytes':'Verify executed homepage functional coverage'));
  assert(caller && check && list.indexOf(check)>list.indexOf(caller),'Homepage execution requires subsequent report verification');
  const filename='test-results/homepage-functional.json';
  const command=candidate?'node scripts/pages-candidate.mjs proof'
    : `node scripts/check-homepage-selection.mjs --verify-execution-report ${filename} --discovery test-results/homepage-discovery.json`;
  assert(check.source.includes(`run: ${command}\n`),'Homepage report verifier is missing or uses a different scope');
  if(candidate)assert(check.source.includes(`CANDIDATE_REPORT: ${filename}`));
  assert(!body.includes('continue-on-error') && !check.source.includes('|| true'),'Homepage functional and report errors must remain blocking');
  const context={success:()=>true,needs:{guard:{outputs:{homepage:'true',carousel:'true'}},'release-compatibility':{outputs:{homepage:'true',carousel:'true'}}},steps:{homepage_discovery:{outcome:'success'}}};
  assert(permits(check,context),'Selected homepage report verification would be skipped');
  assert(!permits(check,{...context,success:()=>false}),'Failed functional execution cannot acquire a passing report');
  return check;
}
for(const [source,candidate] of [[standard,true],[full,false]]) {
  const options={candidate};
  const check=requiresHomepageReportVerification(source,options);
  assert.throws(()=>requiresHomepageReportVerification(source.replace(check.source,check.source.replace(/run: .+/, 'run: echo missing report verifier')),options),/verifier is missing/);
  assert.throws(()=>requiresHomepageReportVerification(source.replace(check.source,check.source.replace(/^        if: .+\n/m,'').replace(/        run:/,"        if: needs.guard.outputs.homepage == 'false'\n        run:")),options),/would be skipped/);
  assert.equal(hasRetiredDecorativeHeroAutomation(source),false,'Decorative jobs, scripts and reports are retired in every frontend workflow');
  for(const retired of [
    '  homepage-webkit-media:\n    runs-on: macos-15',
    'npm run test:homepage-webkit', 'npm run test:homepage-functional:extended',
    'node scripts/diagnose-homepage-linux-media.mjs',
    'npx playwright test tests/homepage-hero-playback.spec.js',
    'npx playwright test tests/homepage-hero-state.spec.js',
    'npx playwright test tests/homepage-native-control.spec.js',
    'npx playwright test -c playwright.homepage-webkit.config.js',
    'npx playwright test -c playwright.homepage-linux-diagnostic.config.js',
  ]) assert.equal(hasRetiredDecorativeHeroAutomation(`${source}\n${retired}\n`),true,retired);
}
for(const [source,jobName,setupName,callers] of [
  [standard,'worker-validation','Install Worker media test tools',['Verify native Linux isolation before Worker tests','Run worker route tests']],
  [full,'worker-tests','Install Worker media test tools',['Verify native Linux isolation before Worker tests','Run full Worker regression']],
  [processor,'process','Install ffmpeg',['Verify processor configuration','Run Memvid Stream preview processor']],
  [standard,'browser-validation','Install Canvas browser media tools',['Run selected auth and admin tests']],
  [full,'browser-tests','Install Canvas browser media tools',['Run full static regression']],
]) {
  const setup=requiresMediaSetup(source,jobName,setupName,callers);
  assert.throws(()=>requiresMediaSetup(source.replace(job(source,jobName),job(source,jobName).replace(setup.source,setup.source.replace(setupCommand,''))),jobName,setupName,callers),/shared media setup is required/);
  if(!['worker-validation','browser-validation'].includes(jobName))for(const success of [true,false])assert.equal(permits(setup,{success:()=>success}),success);
}
function requiresBackendMediaSetup(source) {
  const step=steps(job(source,'deploy')).find(s=>s.name==='Apply verified candidate backend prerequisites');
  const setup=step.source.indexOf(setupCommand),apply=step.source.indexOf('node scripts/release-apply.mjs --ci-verified-candidate');
  assert(setup>=0 && setup<apply,'Backend continuation requires media setup before execution');
}
requiresBackendMediaSetup(standard);
const backendStep=steps(job(standard,'deploy')).find(s=>s.name==='Apply verified candidate backend prerequisites');
assert.throws(()=>requiresBackendMediaSetup(standard.replace(backendStep.source,backendStep.source.replace(setupCommand,''))),/requires media setup/);
for(const source of [standard,full,processor])assert(!source.includes('apt-get install -y ffmpeg'),'Ubuntu media setup has one shared definition');

const setupScript=fs.readFileSync(new URL('./setup-media-tools.sh',import.meta.url),'utf8');
assert.equal(spawnSync('/bin/bash',['-n'],{input:setupScript,encoding:'utf8'}).status,0);
// Execute the shared install shell with harmless tool functions. The same script
// is called by release, Full, the processor and guarded backend continuation.
for(const present of [true,false])for(const failing of ['none','update','install','preflight','timeout']) {
  const functions=`command() { if [ "$1" = -v ]; then ${present?'return 0':'return 1'}; fi; builtin command "$@"; }; sudo() { printf '%s\\n' "$*"; case "$*" in *" ${failing}"|*" ${failing} -y ffmpeg") return 9;; esac; [ "${failing}" != timeout ] || return 124; }; node() { printf 'node %s\\n' "$*"; [ "${failing}" != preflight ] || return 8; };`;
  const result=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',functions+'\n'+setupScript],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
  const calls=result.stdout.trim().split('\n');
  if(present){assert.deepEqual(calls,['node scripts/check-media-tools.mjs'],'Installed tools must never contact apt');assert.equal(result.status,failing==='preflight'?8:0);continue;}
  assert.equal(result.status,failing==='none'?0:failing==='preflight'?8:failing==='timeout'?124:9);
  assert.match(calls[0],/^timeout --kill-after=5s 120s apt-get /);
  assert.match(calls[0],/Acquire::Retries=0/);assert.match(calls[0],/Acquire::http::Timeout=15/);assert.match(calls[0],/Acquire::https::Timeout=15/);assert.match(calls[0],/APT::Update::Error-Mode=any update$/);
  if(['update','timeout'].includes(failing)){assert.equal(calls.length,1,'Failed package indexes must stop before install/preflight');continue;}
  assert.match(calls[1],/^timeout --kill-after=5s 300s apt-get .* install -y ffmpeg$/);
  assert.deepEqual(calls.slice(2),failing==='install'?[]:['node scripts/check-media-tools.mjs']);
}

// Exercise the real preflight with a private PATH. A missing executable's OS
// code is retained, and an expensive sibling command must never be reached.
const mediaBin=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-preflight-'));
try {
  const preflightFile=fileURLToPath(new URL('./check-media-tools.mjs',import.meta.url));
  const run=()=>spawnSync(process.execPath,[preflightFile],{env:{PATH:mediaBin},encoding:'utf8',timeout:15000});
  const writeTool=(name,body)=>fs.writeFileSync(path.join(mediaBin,name),'#!/bin/sh\n'+body+'\n',{mode:0o700});
  const absentFfmpeg=run();assert.equal(absentFfmpeg.status,1);
  assert.deepEqual(JSON.parse(absentFfmpeg.stderr),{code:'canvas_media_tool_failed',diagnostic:{tool:'ffmpeg',osCode:'ENOENT'}});
  writeTool('ffmpeg',"printf 'ffmpeg version fixture-1\\n'");
  const absentFfprobe=run();assert.equal(absentFfprobe.status,1);
  assert.deepEqual(JSON.parse(absentFfprobe.stderr),{code:'canvas_media_tool_failed',diagnostic:{tool:'ffprobe',osCode:'ENOENT'}});
  writeTool('ffprobe',"printf 'private-token https://private.invalid/secret Invalid data found' >&2; exit 7");
  const failedProbe=run();assert.equal(failedProbe.status,1);
  assert.deepEqual(JSON.parse(failedProbe.stderr),{code:'canvas_media_tool_failed',diagnostic:{exit:7,signal:null,stderr:['Invalid data found']}});
  writeTool('ffprobe',"printf 'ffprobe version fixture-2\\n'");
  const healthy=run();assert.equal(healthy.status,0,healthy.stderr);
  assert.deepEqual(JSON.parse(healthy.stdout),{mediaTools:{ffmpeg:'fixture-1',ffprobe:'fixture-2'}});
  fs.unlinkSync(path.join(mediaBin,'ffmpeg'));
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const trace=path.join(mediaBin,'unexpected-caller');
  writeTool('node',`if [ "$1" = scripts/check-media-tools.mjs ]; then exec ${quote(process.execPath)} "$@"; fi\nprintf '%s\\n' "$*" > ${quote(trace)}\nexit 97`);
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  for(const name of ['test:workers','test:q4-integration']) {
    const command=pkg.scripts[name];
    assert(command.startsWith('node scripts/check-media-tools.mjs && '),`${name}: media preflight must lead the actual chain`);
    const failed=spawnSync('/bin/sh',['-c',command],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{PATH:mediaBin},encoding:'utf8',timeout:15000});
    assert.equal(failed.status,1,failed.stderr);assert(!fs.existsSync(trace),`${name}: no downstream selection/test starts after missing media tools`);
    assert.equal(JSON.parse(failed.stderr).diagnostic.osCode,'ENOENT');
  }
  const standalone=spawnSync(process.execPath,[fileURLToPath(new URL('./test-homepage-ffmpeg-processor.mjs',import.meta.url))],{env:{PATH:mediaBin},encoding:'utf8',timeout:15000});
  assert.equal(standalone.status,1);assert.match(standalone.stderr,/ENOENT/);
  assert.equal(standalone.stdout,'','Standalone caller rejects missing media tools before its fixture suites');
} finally {fs.rmSync(mediaBin,{recursive:true,force:true});}

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
for (const name of ['worker-validation', 'browser-validation', 'homepage-validation']) {
  assert(job(standard, name).includes(name==='browser-validation' ? 'needs: [release-compatibility, homepage-validation, worker-validation]' : 'needs: release-compatibility'), `${name} waits for actual preflight`);
}

// A closed browser-fixture continuation reuses authenticated unchanged evidence;
// the actual caller still executes repaired cases and the unexecuted chain tail.
function requiresBrowserRepairContinuation(source) {
  const list=steps(job(source,'browser-validation'));
  const outputs={homepage:'false',carousel:'false',assets:'false',workers:'false',auth:'true',full:'false',browser_repair:'true',backend_continuation:'true'};
  const context={success:()=>true,needs:{'release-compatibility':{outputs}}};
  const step=name=>{const found=list.find(item=>item.name===name);assert(found,`Missing repair caller ${name}`);return found;};
  const repair=step('Run repaired browser acceptance');
  assert(repair.source.includes('run: node scripts/pages-candidate.mjs repair-browser'), 'Repair must execute its verified report/discovery continuation');
  assert(permits(repair,context),'Repaired browser cases must execute');
  for(const name of ['Run full static browser regression','Run selected auth and admin tests','Download candidate build'])
    assert(!permits(step(name),context),`Repair must not repeat unchanged acceptance: ${name}`);
  for(const name of ['Install carousel browser matrix','Restore unchanged browser repair candidate','Restore exact candidate static site','Confirm tested browser candidate bytes','Upload tested browser candidate identity']) {
    assert(permits(step(name),context),`Missing repair preparation/proof ${name}`);
    assert(!permits(step(name),{...context,success:()=>false}),`Failed repair cannot advance ${name}`);
  }
  assert(step('Install carousel browser matrix').source.includes('chromium firefox webkit'),'Unexecuted carousel tail requires all existing engines');
  assert(list.indexOf(step('Restore unchanged browser repair candidate'))<list.indexOf(repair));
  assert(list.indexOf(step('Confirm tested browser candidate bytes'))>list.indexOf(repair));
  const body=job(source,'browser-validation');
  for(const key of ['SHA','RUN','ATTEMPT'])assert(body.includes('REPAIR_SOURCE_'+key+': ${{ needs.release-compatibility.outputs.repair_source_'+key.toLowerCase()+' }}'),'Repair source identity must reach the real browser caller');
  const ordinary={success:()=>true,needs:{'release-compatibility':{outputs:{...outputs,browser_repair:'false'}}}};
  assert(!permits(repair,ordinary));assert(permits(step('Run selected auth and admin tests'),ordinary),'Ordinary auth selection stays binding');
  const condition=job(source,'deploy').match(/^    if: \$\{\{ (.+) \}\}$/m)[1].replace(/needs\.([a-z][\w-]*)/g,(_,name)=>`needs['${name}']`);
  for(const result of ['success','failure','skipped','cancelled','']) {
    const ctx={cancelled:()=>false,github:{ref:'refs/heads/main',event_name:'push',event:{inputs:{}}},needs:{'release-compatibility':{result:result==='success'?'success':'failure',outputs},'worker-validation':{result:'skipped'},'homepage-validation':{result:'skipped'},'browser-validation':{result},'reuse-candidate':{result:'skipped'}}};
    assert.equal(Boolean(vm.runInNewContext(condition,ctx,{timeout:100})),result==='success','Fresh repaired browser failure/missing execution must block publication');
  }
  return repair;
}
const repairCaller=requiresBrowserRepairContinuation(standard);
// A publication-only correction has complete original + repaired browser proof.
// The existing job conditions must not execute any completed product suite.
{
  const outputs={homepage:'false',carousel:'false',assets:'false',workers:'false',auth:'false',full:'false',browser_repair:'false',backend_continuation:'true'};
  const condition=name=>job(standard,name).match(/^    if: \$\{\{ (.+) \}\}$/m)[1].replace(/needs\.([a-z][\w-]*)/g,(_,name)=>`needs['${name}']`);
  const context={cancelled:()=>false,github:{ref:'refs/heads/main',event_name:'push',event:{inputs:{}}},needs:{'release-compatibility':{result:'success',outputs},'worker-validation':{result:'skipped'},'homepage-validation':{result:'skipped'},'browser-validation':{result:'skipped'},'reuse-candidate':{result:'skipped'}}};
  for(const name of ['worker-validation','homepage-validation','browser-validation'])assert.equal(Boolean(vm.runInNewContext(condition(name),context,{timeout:100})),false,`Completed ${name} must not repeat`);
  assert.equal(Boolean(vm.runInNewContext(condition('deploy'),context,{timeout:100})),true,'Verified complete evidence must reach protected publication');
  context.needs['release-compatibility'].result='failure';assert.equal(Boolean(vm.runInNewContext(condition('deploy'),context,{timeout:100})),false,'Changed release guard failure still blocks publication');
}
assert.throws(()=>requiresBrowserRepairContinuation(standard.replace(repairCaller.source,repairCaller.source.replace('node scripts/pages-candidate.mjs repair-browser','echo missing repair'))),/must execute/);
const browserAuthStep=steps(job(standard,'browser-validation')).find(step=>step.name==='Run selected auth and admin tests');
assert.throws(()=>requiresBrowserRepairContinuation(standard.replace(browserAuthStep.source,browserAuthStep.source.replace("needs.release-compatibility.outputs.browser_repair != 'true' && ",''))),/must not repeat/);

for (const [name, source] of [['standard', standard]]) {
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

// Candidate/workflow checks must include actual selected discovery; independent
// synthetic proof fixtures alone missed the pricing-project mismatch in 33e86425.
await import('./test-homepage-selection.mjs');
const workerChain=spawnSync(process.execPath,['--test','--test-name-pattern=^actual selected Worker shell stops before downstream work on every failure$','scripts/test-q2-runtime-launcher.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:30000});
assert.equal(workerChain.status,0,workerChain.error?.message||workerChain.stdout+workerChain.stderr);
console.log('Actual Worker chain requirements and failure propagation passed without running product suites.');
await import('./test-pages-candidate.mjs');

const diagnostic=cfSteps.find(s=>s.name==='Preserve failed frontend upload identity');
assert(diagnostic.source.includes('path: test-results/frontend-upload.ndjson'));
for(const failed of [true,false])for(const cancelled of [true,false])for(const provider of ['github-pages','cloudflare']) {
 assert.equal(Boolean(vm.runInNewContext(diagnostic.condition,{failure:()=>failed,cancelled:()=>cancelled,env:{HOSTING_PROVIDER:provider}})),failed&&!cancelled&&provider==='cloudflare');
}

// Automatic backend continuation stays under the same protected lock and all
// selected job gates. No backend failure may begin frontend publication.
const backend=cfSteps.find(s=>s.name==='Apply verified candidate backend prerequisites');
const references=cfSteps.find(s=>s.name==='Validate candidate references before backend publication');
const lateReferences=cfSteps.find(s=>s.name==='Validate local CSS/JS references');
const earlyReferences=early.find(s=>s.name==='Validate static website references');
const referenceCommand='node scripts/validate-site-references.mjs --root candidate/site';
assert.equal(references.source.trim(),`run: ${referenceCommand}`);
assert(lateReferences.source.includes(`run: ${referenceCommand}`));
assert(cfSteps.indexOf(references)>cfSteps.findIndex(s=>s.name==='Restore unchanged verified frontend package'));
assert(cfSteps.indexOf(references)<cfSteps.indexOf(backend),'Missing candidate assets must stop before any backend write');
assert(earlyReferences.source.includes('node scripts/validate-site-references.mjs --root . --source'));
assert(earlyReferences.source.includes(referenceCommand));
assert(earlyReferences.source.includes('node scripts/frontend-release.mjs production-source'),'Repair checks original authenticated candidate bytes');
assert(earlyReferences.source.includes('CANDIDATE_RUN="$REPAIR_SOURCE_RUN" CANDIDATE_ATTEMPT="$REPAIR_SOURCE_ATTEMPT"'));
assert(!permits(references,{success:()=>false}));
const referenceShell=earlyReferences.source.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
for(const repair of [false,true])for(const failure of [false,true]) {
  const mock=`node() { printf '%s\\n' "$*"; if [ "$2" = production-source ]; then test "$CANDIDATE_RUN" = 123 && test "$CANDIDATE_ATTEMPT" = 1 || return 9; return ${failure?17:0}; fi; };`;
  const run=spawnSync('/bin/bash',['--noprofile','--norc','-e','-c',mock+'\n'+referenceShell],{encoding:'utf8',env:{PATH:process.env.PATH,...(repair?{REPAIR_SOURCE_SHA:'a'.repeat(40),REPAIR_SOURCE_RUN:'123',REPAIR_SOURCE_ATTEMPT:'1'}:{})},timeout:5000});
  assert.equal(run.status,repair&&failure?17:0,run.stderr);
  const calls=run.stdout.trim().split('\n');
  assert.deepEqual(calls,repair&&failure?['scripts/frontend-release.mjs production-source']:[...(repair?['scripts/frontend-release.mjs production-source']:[]),'scripts/validate-site-references.mjs --root . --source','scripts/validate-site-references.mjs --root candidate/site']);
}

// Exercise the real workflow CLI, with source and candidate beside each other.
// A source-present file must never rescue a broken publication package.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-site-references-'));
try {
  const write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),value);};
  const html='<link href="/css/theme.css?v=source#theme"><script src="js/theme.js?v=1"></script>';
  write('index.html',html);write('css/theme.css','body{}');write('js/theme.js','void 0;');
  write('de/nested/index.html',"<link href='../../css/theme.css?v=2'><script src='/js/theme.js?v=2'></script><script src='https://cdn.invalid/remote.js'></script>");
  for(const dir of ['css','js','de'])fs.cpSync(path.join(root,dir),path.join(root,'candidate/site',dir),{recursive:true});
  write('candidate/site/index.html',html.replaceAll('source','built'));
  const cli=fileURLToPath(new URL('./validate-site-references.mjs',import.meta.url));
  const check=(args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:5000});
  const candidateArgs=referenceCommand.split(' ').slice(2);
  assert.equal(check(['--root','.','--source']).status,0);
  assert.equal(check(candidateArgs).status,0,'Root, nested relative and versioned references resolve within candidate');
  write('candidate/broken.html','<script src="/not-a-site-input.js"></script>');
  assert.equal(check(['--root','.','--source']).status,0,'Checkout scanner must not traverse candidate or unrelated HTML');
  fs.unlinkSync(path.join(root,'candidate/site/js/theme.js'));
  const missingCandidate=check(candidateArgs);
  assert.equal(missingCandidate.status,1);assert.match(missingCandidate.stderr,/missing\/unsafe.*theme\.js/);
  assert.equal(check(['--root','.','--source']).status,0,'Source remains valid while candidate independently fails');
  write('candidate/site/js/theme.js','void 0;');
  fs.unlinkSync(path.join(root,'css/theme.css'));
  assert.equal(check(['--root','.','--source']).status,1,'Candidate must not conceal a missing source asset either');
  assert.equal(check(candidateArgs).status,0);
  write('candidate/site/de/nested/index.html','<script src="../../js/missing.js?v=1"></script>');
  assert.equal(check(candidateArgs).status,1,'Real nested missing files remain fatal');
  write('candidate/site/de/nested/index.html','<script src="/js/linked.js"></script>');
  fs.symlinkSync(path.join(root,'js/theme.js'),path.join(root,'candidate/site/js/linked.js'));
  assert.equal(check(candidateArgs).status,1,'A source symlink cannot escape candidate isolation');
  assert.equal(check([]).status,1,'Root must be explicit');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('Website-root reference CLI: isolated source/candidate, URL variants and missing-file countercontrols passed.');
const appearanceFiles=['index.html','de/index.html','js/shared/appearance-contract.js','js/shared/appearance.js','css/base/appearance.css','css/base/tokens.css'];
const appearanceContent=Object.fromEntries(appearanceFiles.map(f=>[f,f.endsWith('.html')?`<!doctype html>\n<body>\n<main>${f}</main>\n</body>\n`:f]));
const digest=value=>createHash('sha256').update(value).digest('hex');
const appearanceManifest={sha:'a'.repeat(40),run:'123',attempt:'1',selection:{},hosting:{worker:'bitbi-frontend'},files:Object.fromEntries(appearanceFiles.map(f=>[f,digest(appearanceContent[f])]))};
const publicSettings={version:1,revision:0,segments:{public:'dark',admin:'dark',generateLab:'dark',canvas:'dark',account:'dark'},personalEnabled:false};
const labyrinth='<a href="https://bitbi.ai/cdn-cgi/content?id='+('synthetic.'.repeat(12))+'" aria-hidden="true" rel="nofollow noopener" style="display: none !important; visibility: hidden !important"></a>';
// Exact public script observed on 2026-09-22; this is a public beacon ID, not an API credential.
const publicBeaconId='d070c325246e4047abe56431281e0588';
const beacon=`<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6df95cf4e85bb4c19e7a9bdbcba1788362987495" integrity="sha512-iIg7k2xntmwu6/uSb5tpc/hySgZc4eoL31yB29W6tJFo2akwjPWcEqnCEdJvGexCL0KEQwVYv5BlowfhVz26hg==" data-cf-beacon='{"version":"2024.11.0","token":"${publicBeaconId}","r":1,"spa":2}' crossorigin="anonymous"></script>\n`;
const augmented=html=>html.replace('<body>','<body>'+labyrinth).replace('</body>',beacon+'</body>');
const liveFixture=(fault)=>async(url,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
  const parsed=new URL(url),pathname=parsed.pathname;
  if(pathname==='/api/appearance')return fault==='api-redirect'?Response.redirect('https://bitbi.ai/login',302):Response.json({ok:true,appearance:{...publicSettings,...(fault==='personal'?{personalEnabled:true}:{})}},{headers:{'Cache-Control':'no-store'}});
  if(pathname==='/'&&['dach','dach-query','foreign-redirect','unexpected-path','unexpected-query','redirect-loop'].includes(fault)) {
    const location=fault==='foreign-redirect'?'https://foreign.invalid/de/':fault==='unexpected-path'?'https://bitbi.ai/login':`https://bitbi.ai/de/${fault==='dach-query'?parsed.search:fault==='unexpected-query'?'?token=unexpected':''}`;
    return Response.redirect(location,302);
  }
  if(fault==='redirect-loop'&&pathname==='/de/')return Response.redirect('https://bitbi.ai/',302);
  if(pathname!=='/de/'||!['dach','redirect-loop'].includes(fault))assert(parsed.searchParams.get('v').includes('-123-1'));
  const file=pathname==='/'?'index.html':pathname==='/de/'?'de/index.html':pathname.slice(1);
  let content=appearanceContent[file];
  if(file.endsWith('.html')&&fault!=='plain')content=augmented(content);
  if(fault==='stale')content='old-build';
  if(fault==='changed-tokens'&&file==='css/base/tokens.css')content+='changed';
  if(fault==='changed-theme'&&file==='css/base/appearance.css')content+='changed';
  if(fault==='visible-anchor')content=content.replace('display: none','display: block');
  if(fault==='wrong-origin')content=content.replace('https://bitbi.ai/cdn-cgi','https://foreign.invalid/cdn-cgi');
  if(fault==='extra-script')content=content.replace('</body>','<script>bad()</script></body>');
  if(fault==='changed-beacon')content=content.replace('r":1','r":2');
  if(fault==='changed-html')content=content.replace('<main>','<main onclick="bad()">');
  if(fault==='duplicate-anchor')content=content.replace(labyrinth,labyrinth+labyrinth);
  if(fault==='asset-redirect'&&file.endsWith('.js'))return Response.redirect('https://bitbi.ai/',302);
  return new Response(content,{status:fault==='missing'?404:200,headers:{server:'cloudflare'}});
};
for(const mode of ['plain',undefined,'dach','dach-query']) {
  const accepted=await verifyPublishedAppearance(appearanceManifest,liveFixture(mode));
  assert.equal(accepted.personalEnabled,false);
  assert.equal(accepted.documents[0].file,mode?.startsWith('dach')?'de/index.html':'index.html');
  assert.equal(accepted.documents[0].augmentations.length,mode==='plain'?0:2);
  if(mode?.startsWith('dach'))assert(!accepted.verified.includes('index.html'),'A DE redirect is not EN delivery evidence');
}
for(const fault of ['stale','missing','personal','changed-theme','changed-tokens','visible-anchor','wrong-origin','extra-script','changed-beacon','changed-html','duplicate-anchor','foreign-redirect','unexpected-path','unexpected-query','redirect-loop','asset-redirect','api-redirect'])await assert.rejects(()=>verifyPublishedAppearance(appearanceManifest,liveFixture(fault)),fault);
assert.equal(appearanceHtmlBytes(Buffer.from(augmented(appearanceContent['index.html']))).bytes.toString(),appearanceContent['index.html']);

// The normal publication adapter must verify in place, with zero upload calls.
const account='c'.repeat(32),packageDigest=digest(JSON.stringify(appearanceManifest));
const activated={sha:appearanceManifest.sha,run:'123',attempt:'1',packageDigest,worker:'bitbi-frontend',account,versionId:'active-version',deploymentId:'active-deployment'};
const reconcile=async()=>({receipt:activated,reconciliation:{run:'failed-upload-run'}});
let uploads=0,identityChecks=0;
const publishOptions={manifest:appearanceManifest,proofs:[{job:'frontend-runtime',status:'passed',manifestHash:packageDigest,tests:1,reportHash:'synthetic'}],account,reconcile,readPublic:liveFixture(),
  current:async()=>{identityChecks++;},upload:async()=>{uploads++;throw Error('unexpected upload');},
  read:async endpoint=>endpoint==='workers/domains'?['bitbi.ai','www.bitbi.ai'].map(hostname=>({id:hostname,zone_id:'synthetic-zone',hostname,service:'bitbi-frontend',environment:'production'})):endpoint.endsWith('/deployments')?{deployments:[{id:activated.deploymentId,versions:[{version_id:activated.versionId,percentage:100}]}]}:{id:activated.versionId,annotations:{'workers/message':`bitbi:${activated.sha}:123:1:${packageDigest}`}}};
const reconciled=await publishFrontend(publishOptions);assert.equal(reconciled.versionId,activated.versionId);assert.equal(uploads,0);assert.equal(identityChecks,2);assert.deepEqual(reconciled.activationReconciliation,{run:'failed-upload-run'});
for(const key of ['sha','run','attempt','packageDigest','worker','account','deploymentId','versionId'])await assert.rejects(()=>publishFrontend({...publishOptions,reconcile:async()=>({receipt:{...activated,[key]:'wrong'},reconciliation:{}})}),key);
await assert.rejects(()=>publishFrontend({...publishOptions,reconcile:async()=>{throw Error('unknown activation');}}));assert.equal(uploads,0);
// Fresh appearance publications require the same public acceptance before a
// receipt can be returned; activation alone cannot claim a successful release.
const ordinaryManifest={...appearanceManifest,selection:{appearance:true,auth:true}};
const ordinaryDigest=digest(JSON.stringify(ordinaryManifest));
const ordinary={...publishOptions,manifest:ordinaryManifest,reconcile:undefined,
  proofs:['browser-validation','frontend-runtime'].map(job=>({job,status:'passed',manifestHash:ordinaryDigest,tests:1,reportHash:'synthetic'})),
  upload:async()=>({worker_name:'bitbi-frontend',version_id:activated.versionId}),
  read:async endpoint=>endpoint.includes('/versions/')?{id:activated.versionId,annotations:{'workers/message':`bitbi:${activated.sha}:123:1:${ordinaryDigest}`}}:publishOptions.read(endpoint)};
const acceptedOrdinary=await publishFrontend(ordinary);
assert(acceptedOrdinary.appearanceAcceptance.verified.includes('css/base/tokens.css'));
assert.equal(acceptedOrdinary.appearanceAcceptance.personalEnabled,false);
for(const fault of ['changed-tokens','changed-html','personal','foreign-redirect'])await assert.rejects(()=>publishFrontend({...ordinary,readPublic:liveFixture(fault)}),fault);
console.log('Public appearance integrity/locale and in-place activation/no-upload countercontrols passed.');
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

assert(fast.includes('Refuse the retired duplicate validation path'));
assert(fast.includes('exit 1'));assert(!fast.includes('npm run test:'));
