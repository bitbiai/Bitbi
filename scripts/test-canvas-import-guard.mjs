// Fresh import/recovery boundary checks. Existing accepted suites are retained.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {verifyImportWorkflow,validationPlan} from './lib/local-release-plan.mjs';
import {CANVAS_AGENT_DEPLOY_SOURCE,CANVAS_AGENT_RECOVERY_SOURCE,assertCanvasAgentRecoveryDelta,
  assertCanvasAgentDeployDelta,canvasAgentDeployPushDeferred,resolveCanvasAgentDeploySource} from './lib/canvas-agent-deploy-continuation.mjs';

const require=createRequire(import.meta.url),{yaml}=require('../node_modules/playwright-core/lib/utilsBundle.js');
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const head=git(['rev-parse','HEAD']),file='.github/workflows/static.yml';
const source=CANVAS_AGENT_RECOVERY_SOURCE.sha;
for(const name of ['scripts/lib/local-release-plan.mjs','scripts/lib/canvas-agent-deploy-continuation.mjs','scripts/test-canvas-import-guard.mjs'])
  assert.equal(fs.readFileSync(name,'utf8').trim(),git(['show',`${head}:${name}`]),'Run the new guard only against its committed source');
const workflow=yaml.parse(git(['show',`${head}:${file}`]));
assert.equal(fs.readFileSync(file,'utf8').trim(),git(['show',`${head}:${file}`]),'Actual workflow differs from committed input');
verifyImportWorkflow(workflow);validationPlan();
verifyImportWorkflow(yaml.parse(git(['show',`${CANVAS_AGENT_DEPLOY_SOURCE.sha}:${file}`])));
const steps=value=>value.jobs['release-compatibility'].steps;
const importStep=value=>steps(value).find(step=>step.id==='local_evidence');
const defer=value=>steps(value).find(step=>step.id==='deployment_continuation');
for(const mutate of [
  value=>{value.jobs['release-compatibility'].steps=steps(value).filter(step=>step.id!=='deployment_continuation');},
  value=>{defer(value).id='other';},value=>{defer(value).run='echo deferred=true';},
  value=>{defer(value).if='false';},value=>{defer(value).if=false;},value=>{defer(value)['continue-on-error']=true;},
  value=>{defer(value).env={UNREVIEWED:'true'};},value=>steps(value).push({...defer(value)}),
  value=>{delete importStep(value).if;},value=>{importStep(value).if='false';},value=>{importStep(value).if=false;},
  value=>{importStep(value).if="steps.deployment_continuation.outputs.deferred == 'true'";},
  value=>{importStep(value)['continue-on-error']=true;},value=>{value.jobs['release-compatibility']['continue-on-error']=true;},
  value=>{delete steps(value).find(step=>step.name==='Upload immutable candidate build').if;},
  value=>{delete steps(value).find(step=>step.name==='Preserve tested private media image').if;},
  value=>{value.permissions.contents='write';},value=>{value.jobs['release-compatibility'].env={GH_TOKEN:'${{ github.token }}'};},
]) {
  const wrong=structuredClone(workflow);mutate(wrong);assert.throws(()=>verifyImportWorkflow(wrong),'Unsafe import/deferral boundary was accepted');
}

assertCanvasAgentRecoveryDelta(head);
assertCanvasAgentDeployDelta(source); // Existing fa95 receipt still has its original proof.
const env={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:head};
assert.equal(canvasAgentDeployPushDeferred(env),true);
assert.equal(canvasAgentDeployPushDeferred({...env,GITHUB_EVENT_NAME:'workflow_dispatch'}),false);
assert.equal(resolveCanvasAgentDeploySource(env),null,'A push grants no publication authority');
assert.equal(resolveCanvasAgentDeploySource({...env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_EVENT_NAME:'workflow_dispatch',
  CANDIDATE_RUN:CANVAS_AGENT_DEPLOY_SOURCE.run,CANDIDATE_ATTEMPT:CANVAS_AGENT_DEPLOY_SOURCE.attempt,CANDIDATE_BASE:CANVAS_AGENT_DEPLOY_SOURCE.base}),CANVAS_AGENT_DEPLOY_SOURCE);
const reuse=workflow.jobs['reuse-candidate'];
assert.equal(reuse.steps.find(step=>step.name==='Check new Canvas deployment-only guards').if,
  "steps.deployment_continuation.outputs.active == 'true' && steps.deployment_continuation.outputs.recovery != 'true'");
assert.equal(reuse.steps.find(step=>step.name==='Check Canvas backend recovery guards').if,"steps.deployment_continuation.outputs.recovery == 'true'");
const fresh=reuse.steps.find(step=>step.name==='Check Canvas backend recovery guards').run;
assert(!fresh.includes('test-canvas-agent-deploy-continuation.mjs')&&!fresh.includes('test-canvas-agent-deploy-backend.mjs'));
assert.equal((fresh.match(/npx playwright test/g)||[]).length,1);assert(fresh.includes('tests/q2-processor-capability.spec.js --workers=1 --retries=0 --reporter=list,json'));

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-import-guard-'));
try {
  // validationPlan is the actual early caller, not only a synthetic helper.
  fs.mkdirSync(path.join(temporary,'.github/workflows'),{recursive:true});fs.mkdirSync(path.join(temporary,'config'));
  fs.copyFileSync('config/release-validation.yml',path.join(temporary,'config/release-validation.yml'));
  fs.writeFileSync(path.join(temporary,file),yaml.stringify(workflow));validationPlan(temporary);
  const missing=structuredClone(workflow);delete steps(missing).find(step=>step.name==='Upload immutable candidate build').if;
  fs.writeFileSync(path.join(temporary,file),yaml.stringify(missing));assert.throws(()=>validationPlan(temporary));
  const objectEnv={...process.env,GIT_ALTERNATE_OBJECT_DIRECTORIES:path.resolve(git(['rev-parse','--git-path','objects'])),
    GIT_AUTHOR_NAME:'Import guard fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Import guard fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const local=(args,input)=>execFileSync('git',args,{cwd:temporary,env:objectEnv,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  local(['init','-q']);
  const verify=sha=>assertCanvasAgentRecoveryDelta(sha,{readGit:args=>local(args)});
  verify(head);
  const changed=(name,mode='100644',remove=false)=>{
    local(['read-tree',head]);
    if(remove)local(['update-index','--force-remove',name]);
    else {const blob=local(['hash-object','-w','--stdin'],'unreviewed change\n');local(['update-index','--add','--cacheinfo',`${mode},${blob},${name}`]);}
    return local(['commit-tree',local(['write-tree']),'-p',source],`negative ${name}\n`);
  };
  for(const name of ['js/pages/canvas/main.js','tests/canvas.spec.js','package-lock.json','config/release-validation.yml',
    CANVAS_AGENT_RECOVERY_SOURCE.auth.path,CANVAS_AGENT_RECOVERY_SOURCE.test.path,'scripts/test-canvas-agent-deploy-continuation.mjs','unknown-input.mjs'])
    assert.throws(()=>verify(changed(name)),`Protected input changed: ${name}`);
  assert.throws(()=>verify(changed('scripts/lib/local-release-plan.mjs','120000')));
  assert.throws(()=>verify(changed('scripts/lib/local-release-plan.mjs','100644',true)));
  local(['read-tree',head]);const second=local(['commit-tree',local(['write-tree']),'-p',head],'second successor\n');
  assert.throws(()=>verify(second));
  assert.equal(canvasAgentDeployPushDeferred({...env,GITHUB_SHA:second},{readGit:args=>local(args)}),false,'Later ordinary releases must not inherit deferral');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('New import-guard repair checks passed; accepted product and deployment suites were not repeated.');
