import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { yaml } from '../node_modules/playwright-core/lib/utilsBundle.js';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { validationPlan, selectedCommands, sha256 } from './lib/local-release-plan.mjs';
import { environmentInputs, environmentKey, TOOL_PREFLIGHT } from './lib/local-release-environment.mjs';
import { validateLocator, extractEvidence } from './lib/local-release-transport.mjs';
import { verifyLocalEvidence, rebindLocalCandidate, verifyNativeLocalReports } from './lib/local-release-evidence.mjs';
import { prepareFrontend } from './lib/frontend-hosting.mjs';
import { gitSelection, tree, MEDIA_POLICY, validateSource, verifyManifest, verifyProofs } from './pages-candidate.mjs';
import { assertHostedBootstrapAllowed, assertLocalBootstrapAllowed } from '../tests/helpers/q2-runtime/linux-hosted.mjs';
import { acquireLocalReleaseLock } from './local-release.mjs';

const workflow = yaml.parse(fs.readFileSync('.github/workflows/static.yml','utf8'));
assert.deepEqual(Object.keys(workflow.jobs),['release-compatibility','reuse-candidate','deploy','recover-frontend']);
assert.deepEqual(workflow.jobs.deploy.needs,['release-compatibility','reuse-candidate']);
const source = JSON.stringify(workflow);
for(const name of ['test:workers','test:homepage-core','test:auth','test:static','test:q2-runtime','test:quality-gates','playwright test','Validate JS import paths','Validate page metadata','Check target=']) assert(!source.includes(name),`Migrated check still executes on GitHub: ${name}`);
assert(source.includes('node scripts/local-release.mjs import'));
assert(!source.includes('continue-on-error'));
assert.equal(workflow.permissions.deployments,'read');
assert.equal(workflow.jobs.deploy.permissions.deployments,'write');
const fast=yaml.parse(fs.readFileSync('.github/workflows/ui-fast-deploy.yml','utf8'));
assert.deepEqual(Object.keys(fast.on),['workflow_dispatch']);
assert.equal(Object.keys(fast.jobs).length,1);
assert(!JSON.stringify(fast).match(/contents: write/));
assert(fast.jobs.guard.steps.every(step=>!/^\s*(?:npm|npx|node|wrangler)\b/m.test(step.run||'')));
assert(fast.jobs.guard.steps.some(step=>step.run?.includes('exit 1')),'Legacy fast entry point must reject without claiming acceptance');
assert(fs.readFileSync('scripts/release-preflight.mjs','utf8').includes('await preflightLocal(options)'));
const blockedLegacy=spawnSync(process.execPath,['scripts/release-apply.mjs','--execute'],{encoding:'utf8'});
assert.equal(blockedLegacy.status,1);assert.match(blockedLegacy.stderr,/Use npm run release:local/);

const plan = validationPlan();
assert.equal(Object.keys(plan.jobs).length,4);
const expected = { GITHUB_SHA:'a'.repeat(40), CANDIDATE_BASE:'b'.repeat(40) };
for (const files of [['index.html'],['workers/auth/src/index.js'],['js/pages/admin/model-pricing.js'],['js/pages/canvas/full-video.js'],['services/homepage-ffmpeg-processor/canvas-full-video.mjs'],['docs/readme.md']]) {
  const selection = selectCiTests(files), commands = selectedCommands(selection,expected);
  assert(commands.length > 25);
  assert.equal(commands.filter(c=>c.name==='Run quality gate tests').length,1);
  assert(commands.some(c=>c.name==='Check frontend hosting package'));
  assert.equal(commands.some(c=>c.name==='Run worker route tests'),selection.workers&&!selection.mediaLifecycle);
  assert.equal(commands.some(c=>c.name==='Run Linux homepage functional acceptance'),selection.homepage||selection.carousel);
  assert(!commands.some(c=>c.name==='Verify repaired native media smoke'),'Missing output cannot accidentally select a historical native repeat');
  assert(!commands.some(c=>/\b(?:npm|node|npx) (?:run|scripts|playwright|--)[^\n]*\|\| true/.test(c.run)),'Test failures cannot be suppressed');
  assert(commands.every(c=>!c.run.includes('${{')));
}
const inputs=environmentInputs(), key=environmentKey(inputs);
assert.equal(environmentKey({...inputs}),key);
for(const file of Object.keys(inputs)) assert.notEqual(environmentKey({...inputs,[file]:'changed'}),key,file);
assert.notEqual(environmentKey(inputs,'linux/amd64'),key);

const identity={platform:'linux',uid:1001,gid:1001};
const local={...identity,container:true,marker:{policy:'development-mac-v1',boundary:'disposable-container'}};
assertLocalBootstrapAllowed({BITBI_LOCAL_RELEASE_CONTAINER:'1'},local);
for(const patch of [{container:false},{uid:0},{gid:0},{marker:{}},{platform:'darwin'}]) assert.throws(()=>assertLocalBootstrapAllowed({BITBI_LOCAL_RELEASE_CONTAINER:'1'},{...local,...patch}));
for(const env of [{},{BITBI_LOCAL_RELEASE_CONTAINER:'1',GITHUB_ACTIONS:'true'},{BITBI_LOCAL_RELEASE_CONTAINER:'1',RUNNER_ENVIRONMENT:'github-hosted'}]) assert.throws(()=>assertLocalBootstrapAllowed(env,local));
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP:'1'};
assertHostedBootstrapAllowed(hosted,identity);
assert.throws(()=>assertHostedBootstrapAllowed({...hosted,RUNNER_ENVIRONMENT:'self-hosted'},identity));

const scope={sha:'a'.repeat(40),base:'b'.repeat(40)}, digest='sha256:'+'c'.repeat(64);
const record={repository_url:'https://api.github.com/repos/bitbiai/Bitbi',task:'bitbi-local-validation',environment:'bitbi-local-validation',production_environment:false,creator:{login:'bitbiai'},payload:{localValidation:{policy:'development-mac-v1',...scope,asset:1,release:2,digest,name:`bitbi-local-${scope.sha}-${digest.slice(7,23)}.zip`}}};
validateLocator(record,scope);
for(const patch of [{task:'deploy'},{production_environment:true},{creator:{login:'outsider'}},{payload:{}}]) assert.throws(()=>validateLocator({...record,...patch},scope));
assert.throws(()=>validateLocator(record,{...scope,sha:scope.base}));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-archive-'));
try {
  const bin=path.join(temporary,'bin');fs.mkdirSync(bin);
  const tools=['zip','unzip','python3','git','curl','ffmpeg','ffprobe'];
  for(const tool of tools)fs.writeFileSync(path.join(bin,tool),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const preflight=()=>spawnSync('/bin/bash',['-euc',TOOL_PREFLIGHT],{env:{PATH:bin}}).status;
  assert.equal(preflight(),0);
  for(const tool of tools){fs.renameSync(path.join(bin,tool),path.join(temporary,tool));assert.notEqual(preflight(),0,`Missing ${tool} must stop before suites`);fs.renameSync(path.join(temporary,tool),path.join(bin,tool));}
  const lockDir=path.join(temporary,'lock');const unlock=acquireLocalReleaseLock(lockDir);
  assert.throws(()=>acquireLocalReleaseLock(lockDir),/Another local release is active/);
  unlock();acquireLocalReleaseLock(lockDir)();
  const native=path.join(temporary,'runtime/q2-runtime-evidence/native-control');fs.mkdirSync(path.join(native,'reports'),{recursive:true});
  const launcher={origin:'development-mac-v1',mode:'runtime',status:0,failure:null,childBoundaryVerified:true,postcheckFailures:[]};
  const log=JSON.stringify({q2LinuxEvidence:'/tmp/bitbi-release/q2-runtime-evidence/native-control'});
  fs.writeFileSync(path.join(native,'launcher-result.json'),JSON.stringify(launcher));
  for(const name of ['isolation-result.json','isolation-final.json'])fs.writeFileSync(path.join(native,'reports',name),JSON.stringify({passed:true}));
  const result={failedSuites:0,passed:1,reports:[{failure:null,records:[{status:'PASS'}]}]};
  fs.writeFileSync(path.join(native,'reports/result.json'),JSON.stringify(result));verifyNativeLocalReports(temporary,log);
  assert.throws(()=>verifyNativeLocalReports(temporary,''),/Missing executed/);
  fs.writeFileSync(path.join(native,'reports/result.json'),JSON.stringify({...result,failedSuites:1}));assert.throws(()=>verifyNativeLocalReports(temporary,log));
  fs.unlinkSync(path.join(native,'reports/result.json'));assert.throws(()=>verifyNativeLocalReports(temporary,log));
  for(const entry of ['safe.txt','../escape','/absolute']) {
    const zip=path.join(temporary,'fixture.zip'), dest=fs.mkdtempSync(path.join(temporary,'unpack-'));
    const result=spawnSync('python3',['-I','-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr(sys.argv[2],"synthetic")',zip,entry]);assert.equal(result.status,0);
    if(entry==='safe.txt'){extractEvidence(zip,dest);assert.equal(sha256(fs.readFileSync(path.join(dest,entry))),sha256('synthetic'));}
    else assert.throws(()=>extractEvidence(zip,dest));
  }
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('Local command mapping, no hosted duplicate suites, dependency invalidation, distinct isolation origins and authenticated archive counterchecks passed.');

// Real Git/source/file queries, with explicitly synthetic execution records.
// No provider or production call is possible in this fixture.
const repo=process.cwd(), fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-local-proof-'));
try {
  for(const file of [...Object.keys(environmentInputs()),'config/release-validation.yml','config/static-hosting.json','frontend/index.mjs','frontend/wrangler.jsonc']) {
    const dest=path.join(fixtureRoot,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(repo,file),dest);
  }
  process.chdir(fixtureRoot);
  const planPath='config/release-validation.yml',originalPlan=fs.readFileSync(planPath,'utf8');
  for(const setup of ['Install Worker media test tools','Install Canvas browser media tools']) {
    fs.writeFileSync(planPath,originalPlan.replace(setup,'Missing prerequisite'));
    assert.throws(()=>selectedCommands(selectCiTests(['workers/auth/src/index.js']),expected),/required preparation/);
  }
  fs.writeFileSync(planPath,originalPlan.replace('run: npm ci','run: npm run test:workers'));
  assert.throws(()=>selectedCommands(selectCiTests(['workers/auth/src/index.js']),expected),/preparation capability/);
  fs.writeFileSync(planPath,originalPlan);
  const git=(...args)=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('add','.');git('commit','-qm','Synthetic original source');const base=git('rev-parse','HEAD');
  fs.writeFileSync('fixture.md','Synthetic local evidence contract');git('add','.');git('commit','-qm','Synthetic candidate');const sha=git('rev-parse','HEAD');
  const selection=gitSelection(base,sha), bundle=path.join(fixtureRoot,'bundle');fs.mkdirSync('candidate/site',{recursive:true});
  fs.writeFileSync('candidate/site/index.html','<p>Synthetic candidate</p>');
  const manifest={schema:2,repository:'bitbiai/Bitbi',sha,base,run:'synthetic-local',attempt:'1',full:false,selection,mediaPolicy:MEDIA_POLICY,files:tree('candidate/site')};
  prepareFrontend(manifest,tree);fs.writeFileSync('candidate/manifest.json',JSON.stringify(manifest));
  const nativeLog='Synthetic native HTTP fixture; this is not runtime acceptance';
  const proof={job:'frontend-runtime',status:'passed',manifestHash:sha256(JSON.stringify(manifest)),tests:1,reportHash:sha256(JSON.stringify({tests:1,log:nativeLog}))};
  fs.writeFileSync('candidate/proof-frontend-runtime.json',JSON.stringify(proof));fs.mkdirSync(bundle);fs.cpSync('candidate',path.join(bundle,'candidate'),{recursive:true});
  fs.mkdirSync(path.join(bundle,'logs'));fs.mkdirSync(path.join(bundle,'test-results'));fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),nativeLog);
  const commandRows=selectedCommands(selection,{GITHUB_SHA:sha,CANDIDATE_BASE:base}).map((command,index)=>{
    const log=`logs/${index}.log`,bytes=`Synthetic successful command ${index}\n`;fs.writeFileSync(path.join(bundle,log),bytes);
    return {command,exitCode:0,durationMs:1,log,logHash:sha256(bytes)};
  });
  const eInputs=environmentInputs(), now=Date.now();
  const accepted={policy:'development-mac-v1',repository:'bitbiai/Bitbi',id:manifest.run,sha,base,sourceTree:git('rev-parse','HEAD^{tree}'),planHash:validationPlan().digest,
    selection,status:'passed',ci:true,origin:'development-mac',startedAt:new Date(now-1000).toISOString(),completedAt:new Date(now-1).toISOString(),
    environment:{inputs:eInputs,key:environmentKey(eInputs),platform:'linux/arm64',image:'sha256:'+'d'.repeat(64),node:'v22.23.1',playwright:'1.58.2'},commands:commandRows,candidateFiles:tree(path.join(bundle,'candidate'))};
  const write=value=>fs.writeFileSync(path.join(bundle,'evidence.json'),JSON.stringify(value));write(accepted);
  const verified=verifyLocalEvidence(bundle,{sha,base});
  const rebound=rebindLocalCandidate(verified,{run:123,attempt:1,receipt:9});
  verifyManifest(rebound.manifest,{sha,base,run:'123',attempt:'1',selection},path.join(bundle,'candidate/site'));verifyProofs(rebound.manifest,rebound.proofs);
  for(const change of [e=>e.status='failed',e=>e.sha='0'.repeat(40),e=>e.sourceTree='0'.repeat(40),e=>e.planHash='0'.repeat(64),e=>e.commands.pop(),e=>e.commands[0].exitCode=1,
    e=>e.commands[0].command.run='echo pretend',e=>e.ci=false,e=>e.environment.inputs['package-lock.json']='changed',e=>e.startedAt='2000-01-01T00:00:00Z',e=>e.selection.workers=true,e=>e.candidateFiles['site/index.html']='changed']) {
    const wrong=structuredClone(accepted);change(wrong);write(wrong);assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  }
  write(accepted);fs.renameSync(path.join(bundle,'test-results/frontend-runtime.log'),path.join(bundle,'saved.log'));assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  fs.renameSync(path.join(bundle,'saved.log'),path.join(bundle,'test-results/frontend-runtime.log'));
  fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),'Changed report');assert.throws(()=>verifyLocalEvidence(bundle,{sha,base}));
  fs.writeFileSync(path.join(bundle,'test-results/frontend-runtime.log'),nativeLog);
  const run={id:123,run_attempt:1,repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},head_sha:sha,head_branch:'main',path:'.github/workflows/static.yml',event:'push',status:'completed',conclusion:'success',created_at:new Date(now).toISOString()};
  const jobs=[{name:'release-compatibility',head_sha:sha,status:'completed',conclusion:'success',steps:['Preflight complete static release plan','Select tests from changed files','Verify local release evidence and candidate bytes','Upload immutable candidate build'].map(name=>({name,status:'completed',conclusion:'success'}))}];
  const artifacts=[{id:1,name:`pages-candidate-${sha}-123-1`,expired:false,size_in_bytes:1,digest:'sha256:'+'e'.repeat(64),workflow_run:{id:123,head_sha:sha}}];
  const expectedSource={repository:'bitbiai/Bitbi',sha,base,run:'123',attempt:'1',selection};
  assert.equal(validateSource({run,jobs,artifacts,mainSha:sha,laterRuns:[]},expectedSource).length,1);
  for(const conclusion of ['failure','skipped',undefined]) {
    const broken=structuredClone(jobs);broken[0].steps[2].conclusion=conclusion;
    assert.throws(()=>validateSource({run,jobs:broken,artifacts,mainSha:sha,laterRuns:[]},expectedSource));
  }
  console.log('Synthetic evidence: matching exact Git/candidate/commands accepted; 14 missing, stale, failed, changed and skipped controls rejected through the actual verifier.');
} finally { process.chdir(repo);fs.rmSync(fixtureRoot,{recursive:true,force:true}); }

if(process.env.BITBI_LOCAL_RELEASE_CONTAINER==='1') {
  // Real launch smoke for the new local image, not a replacement for selected
  // product suites. No provider/public site request or persisted browser state.
  const engines=await import('playwright');
  for(const engine of ['chromium','firefox','webkit']) {
    const browser=await engines[engine].launch();
    try {
      const page=await browser.newPage();await page.route('**/*',route=>route.abort());
      await page.setContent('<button aria-label="Local readiness">Ready</button>');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('button').evaluate(el=>el===document.activeElement),true);
      console.log(`Pinned ${engine} launch and keyboard smoke passed (${browser.version()}); synthetic local content only.`);
    }finally{await browser.close();}
  }
}
