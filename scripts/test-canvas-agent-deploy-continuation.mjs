// Fresh deployment-boundary checks only. The accepted product suites are not run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CANVAS_AGENT_DEPLOY_SOURCE as source,assertCanvasAgentDeployDelta,resolveCanvasAgentDeploySource,assertCanvasAgentDeployArtifact,canvasAgentDeployIdentity,assertCanvasAgentDeployAcceptance,canvasAgentDeployPushDeferred} from './lib/canvas-agent-deploy-continuation.mjs';
import {validateSource,gitSelection} from './pages-candidate.mjs';
import {LOCAL_REQUIRED_JOBS} from './lib/local-release-evidence.mjs';
import {sourceExpectation} from './lib/frontend-source.mjs';
import {loadDurableReceipt,durableBaseline,persistDurableReceipt,RECEIPT_TASK} from './lib/frontend-receipts.mjs';
import {hash,hostingPolicy} from './lib/frontend-hosting.mjs';

const root=process.cwd(),git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const head=git(['rev-parse','HEAD']);
assertCanvasAgentDeployDelta(head);
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_SHA:head,GITHUB_RUN_ID:'900000001',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'deploy',
  CANDIDATE_BASE:source.base,CANDIDATE_RUN:source.run,CANDIDATE_ATTEMPT:source.attempt,
  CANVAS_AGENT_DEPLOY_SOURCE_SHA:source.sha,CANVAS_AGENT_DEPLOY_SOURCE_RUN:source.run,CANVAS_AGENT_DEPLOY_SOURCE_ATTEMPT:source.attempt};
assert.equal(resolveCanvasAgentDeploySource(env),source);
assert.equal(resolveCanvasAgentDeploySource({GITHUB_SHA:source.sha}),null);
for(const change of [{GITHUB_REF:'refs/heads/other'},{GITHUB_EVENT_NAME:'push'},{GITHUB_REPOSITORY:'foreign/repo'},
  {CANDIDATE_BASE:head},{CANDIDATE_RUN:'2'},{CANDIDATE_ATTEMPT:'2'},{CANVAS_AGENT_DEPLOY_SOURCE_SHA:head},
  {CANVAS_AGENT_DEPLOY_SOURCE_RUN:'2'},{CANVAS_AGENT_DEPLOY_SOURCE_ATTEMPT:''},{REPAIR_SOURCE_SHA:source.sha}])
  assert.throws(()=>resolveCanvasAgentDeploySource({...env,...change}));
assert.equal(canvasAgentDeployPushDeferred({...env,GITHUB_EVENT_NAME:'push'}),true);
assert.equal(canvasAgentDeployPushDeferred(env),false);
assert.equal(canvasAgentDeployPushDeferred({...env,GITHUB_EVENT_NAME:'push',GITHUB_SHA:source.sha}),false);
const expectation=sourceExpectation(false,env);
assert.equal(expectation.sha,source.sha);assert.equal(expectation.publicationSha,head);
assert.throws(()=>sourceExpectation(true,env));

// Real isolated Git objects exercise the exact protected-tree boundary. Nothing
// is written to this checkout, and no fixture can authorize a remote operation.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-deploy-tree-'));
try {
  const fixtureEnv={...process.env,GIT_ALTERNATE_OBJECT_DIRECTORIES:path.resolve(git(['rev-parse','--git-path','objects'])),
    GIT_AUTHOR_NAME:'Deployment fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Deployment fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const local=(args,input)=>execFileSync('git',args,{cwd:temporary,env:fixtureEnv,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  local(['init','-q']);
  const changed=(file,mode='100644',remove=false)=>{
    local(['read-tree',head]);
    if(remove)local(['update-index','--force-remove',file]);
    else {const blob=local(['hash-object','-w','--stdin'],'changed protected fixture\n');local(['update-index','--add','--cacheinfo',`${mode},${blob},${file}`]);}
    return local(['commit-tree',local(['write-tree']),'-p',source.sha],`counterexample ${file}\n`);
  };
  const verify=sha=>assertCanvasAgentDeployDelta(sha,{readGit:args=>local(args)});
  assert.doesNotThrow(()=>verify(head));
  for(const file of ['js/pages/canvas/main.js','tests/canvas.spec.js','package-lock.json','config/release-compat.json','scripts/build.mjs','unreviewed-deploy-input.mjs'])
    assert.throws(()=>verify(changed(file)),`Changed protected input must fail: ${file}`);
  assert.throws(()=>verify(changed('scripts/pages-candidate.mjs','120000')),'Symlink tooling cannot authorize deployment');
  assert.throws(()=>verify(changed('scripts/pages-candidate.mjs','100644',true)),'Deleted tooling cannot authorize deployment');
  local(['read-tree',head]);
  const second=local(['commit-tree',local(['write-tree']),'-p',head],'unreviewed second successor\n');
  assert.throws(()=>verify(second),'Continuation cannot extend itself to another commit');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}

const artifact=kind=>({id:source[kind].id,digest:source[kind].digest,size_in_bytes:source[kind].size,expired:false,
  expires_at:new Date(Date.now()+600000).toISOString(),workflow_run:{id:Number(source.run),head_sha:source.sha},
  name:`${kind==='candidate'?'pages-candidate':'private-media-image'}-${source.sha}-${source.run}-${source.attempt}`});
for(const kind of ['candidate','media']) {
  assertCanvasAgentDeployArtifact(artifact(kind),kind);
  for(const change of [{id:1},{digest:`sha256:${'f'.repeat(64)}`},{size_in_bytes:1},{expired:true},{expires_at:'2000-01-01'},
    {name:'other'},{workflow_run:{id:Number(source.run),head_sha:head}}])assert.throws(()=>assertCanvasAgentDeployArtifact({...artifact(kind),...change},kind));
}
const step=name=>({name,status:'completed',conclusion:'success'});
const accepted=()=>[
  {name:'reuse-candidate',head_sha:head,run_id:Number(env.GITHUB_RUN_ID),run_attempt:1,status:'completed',conclusion:'success',steps:
    ['Verify Canvas deployment-only source','Check new Canvas deployment-only guards','Preflight acknowledged full release','Verify exact completed source acceptance'].map(step)},
  {name:'release-compatibility',conclusion:'skipped'},
];
assertCanvasAgentDeployAcceptance(accepted(),head,env.GITHUB_RUN_ID,'1');
for(const mutate of [jobs=>jobs[0].steps.pop(),jobs=>{jobs[0].steps[1].conclusion='skipped';},jobs=>{jobs[0].run_attempt=2;},
  jobs=>jobs.push(jobs[0]),jobs=>{jobs[1].conclusion='success';}]) {
  const jobs=accepted();mutate(jobs);assert.throws(()=>assertCanvasAgentDeployAcceptance(jobs,head,env.GITHUB_RUN_ID,'1'));
}
const selection=gitSelection(source.base,source.sha);
const original={run:{id:Number(source.run),run_attempt:1,head_sha:source.sha,head_branch:'main',path:'.github/workflows/static.yml',
  repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},event:'push',status:'completed',conclusion:'success',created_at:'2026-10-15T00:00:00Z'},
  jobs:[...Object.entries(LOCAL_REQUIRED_JOBS).map(([name,steps])=>({name,head_sha:source.sha,status:'completed',conclusion:'success',steps:steps.map(step)})),{name:'deploy',conclusion:'skipped'}],
  artifacts:[artifact('candidate')],laterRuns:[],mainSha:head};
const expected={repository:'bitbiai/Bitbi',sha:source.sha,base:source.base,run:source.run,attempt:source.attempt,publicationSha:head,selection};
assert.equal(validateSource(original,expected,{canvasAgentDeploy:true})[0].id,source.candidate.id);
for(const mutate of [row=>row.jobs[0].steps.pop(),row=>{row.jobs[1].conclusion='success';},row=>{row.mainSha=source.sha;},
  row=>{row.artifacts[0].id=1;},row=>{row.run.conclusion='failure';},row=>row.laterRuns.push({id:2,created_at:'2026-10-16T00:00:00Z',status:'completed',conclusion:'failure'})]) {
  const row=structuredClone(original);mutate(row);assert.throws(()=>validateSource(row,expected,{canvasAgentDeploy:true}));
}

// The durable next-release baseline must use the publication commit while the
// immutable frontend version continues to name its original tested artifact.
const policy=hostingPolicy(),account='a'.repeat(32),log=`https://github.com/bitbiai/Bitbi/actions/runs/${env.GITHUB_RUN_ID}/job/300`;
const receipt={kind:'publication',sha:source.sha,run:source.run,attempt:source.attempt,publicationSha:head,
  publicationRun:env.GITHUB_RUN_ID,publicationAttempt:'1',authorizingDeployment:200,authorizingJob:300,
  deploymentContinuation:canvasAgentDeployIdentity(head),worker:policy.worker,account,provider:'cloudflare',target:'production',
  versionId:'version-1',deploymentId:'activation-1',packageDigest:'b'.repeat(64)};
function fixtureApi(value=receipt,jobs=accepted()) {
  const routes={
    'deployments/100':{id:100,task:RECEIPT_TASK,environment:policy.productionEnvironment,sha:value.sha,payload:{receipt:value,receiptSHA256:hash(JSON.stringify(value))}},
    'deployments/100/statuses':[{state:'success'}],
    'deployments/200':{id:200,task:'deploy',environment:policy.productionEnvironment,sha:head},
    'deployments/200/statuses':[{state:'success',log_url:log}],
    [`actions/runs/${env.GITHUB_RUN_ID}`]:{id:Number(env.GITHUB_RUN_ID),event:'workflow_dispatch',repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},path:'.github/workflows/static.yml',head_branch:'main',head_sha:head},
    'actions/jobs/300':{id:300,name:'deploy',run_id:Number(env.GITHUB_RUN_ID),run_attempt:1,head_sha:head,status:'completed',conclusion:'success',steps:
      ['Deploy and verify Cloudflare frontend','Record durable frontend receipt','Validate candidate references before backend publication','Apply verified candidate backend prerequisites'].map(step)},
    [`actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`]:{jobs},
    [`deployments?environment=${policy.productionEnvironment}&task=${RECEIPT_TASK}&per_page=1`]:[{id:100}],
  };
  return async endpoint=>{assert(Object.hasOwn(routes,endpoint),`Unexpected receipt request: ${endpoint}`);return structuredClone(routes[endpoint]);};
}
assert.deepEqual(await loadDurableReceipt(100,fixtureApi()),receipt);
for(const mutate of [value=>{value.deploymentContinuation.sourceAttempt='2';},value=>{value.run='2';},value=>{value.releaseRepair={};},value=>{value.publicationSha=source.sha;}]) {
  const value=structuredClone(receipt);mutate(value);await assert.rejects(()=>loadDurableReceipt(100,fixtureApi(value)));
}
const missing=accepted();missing[0].steps.splice(1,1);await assert.rejects(()=>loadDurableReceipt(100,fixtureApi(receipt,missing)));
const cloudflare={
  [`workers/scripts/${policy.worker}/deployments`]:{deployments:[{id:receipt.deploymentId,versions:[{version_id:receipt.versionId,percentage:100}]}]},
  [`workers/scripts/${policy.worker}/versions/${receipt.versionId}`]:{id:receipt.versionId,annotations:{'workers/message':`bitbi:${source.sha}:${source.run}:${source.attempt}:${receipt.packageDigest}`}},
  'workers/domains':policy.domains.map((hostname,index)=>({hostname,id:`domain-${index}`,zone_id:'zone',service:policy.worker,environment:'production'})),
};
const priorAccount=process.env.CLOUDFLARE_ACCOUNT_ID;
try {
  process.env.CLOUDFLARE_ACCOUNT_ID=account;
  const read=async endpoint=>{assert(Object.hasOwn(cloudflare,endpoint));return structuredClone(cloudflare[endpoint]);};
  assert.deepEqual(await durableBaseline(fixtureApi(),read),{sha:head,deployment:receipt.deploymentId,run:env.GITHUB_RUN_ID,receipt:100});
  // Existing protected recovery inherits source provenance, not permission to
  // start another deployment-only continuation. It has no candidate inputs.
  const recoveryEnv={GITHUB_REPOSITORY:env.GITHUB_REPOSITORY,GITHUB_REF:env.GITHUB_REF,GITHUB_SHA:head,
    GITHUB_JOB:'recover-frontend',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:env.GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT:'1',CLOUDFLARE_ACCOUNT_ID:account};
  const rollback={...receipt,kind:'rollback',restoredFrom:100};let stored;
  const recoveryApi=async(endpoint,body)=>{
    if(endpoint==='git/ref/heads/main')return {object:{sha:head}};
    if(endpoint===`actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`)return {jobs:[{id:300,name:'recover-frontend',status:'in_progress'}]};
    if(endpoint===`deployments?environment=${policy.productionEnvironment}&sha=${head}&per_page=100`)return [{id:200,task:'deploy'}];
    if(endpoint==='deployments/200/statuses')return [{state:'in_progress',log_url:log}];
    if(endpoint==='deployments'&&body){stored={id:101,sha:body.ref,payload:body.payload};return stored;}
    if(endpoint==='deployments/101/statuses'&&body)return body;
    if(endpoint==='deployments/101')return stored;
    assert.fail(`Unexpected recovery request: ${endpoint}`);
  };
  assert.equal(await persistDurableReceipt(rollback,{api:recoveryApi,read,env:recoveryEnv}),101);
  assert.equal(stored.payload.receipt.kind,'rollback');assert.deepEqual(stored.payload.receipt.deploymentContinuation,receipt.deploymentContinuation);
  await assert.rejects(()=>persistDurableReceipt({...rollback,kind:'publication'},{api:recoveryApi,read,env:recoveryEnv}),
    'A new publication cannot inherit rollback provenance without its candidate authority');
}finally{if(priorAccount===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=priorAccount;}

const workflow=fs.readFileSync(path.join(root,'.github/workflows/static.yml'),'utf8');
function verifyWorkflow(text) {
  const reuse=text.split('\n  reuse-candidate:')[1]?.split('\n  deploy:')[0];assert(reuse);
  for(const file of ['test-canvas-agent-deploy-continuation.mjs','test-canvas-agent-deploy-backend.mjs'])
    assert.equal((reuse.match(new RegExp(`node scripts/${file.replaceAll('.','\\.')}`,'g'))||[]).length,1);
  assert(!/npm (?:run )?test|playwright|release:local|local-release\.mjs import/.test(reuse),'Reuse must not repeat accepted suites');
  const validation=text.split('\n  release-compatibility:')[1]?.split('\n  reuse-candidate:')[0];assert(validation);
  const later=validation.split('      - name: Defer pinned deployment-only push')[1];assert(later);
  for(const block of later.split('      - name:').slice(1))assert(block.includes("if: steps.deployment_continuation.outputs.deferred != 'true'"),'A deferred push step could repeat validation or issue a candidate');
  assert(reuse.includes("if: steps.deployment_continuation.outputs.active == 'true'"));
}
verifyWorkflow(workflow);
assert.throws(()=>verifyWorkflow(workflow.replace('node scripts/test-canvas-agent-deploy-backend.mjs','npm run test:workers')));
assert.throws(()=>verifyWorkflow(workflow.replace("        if: steps.deployment_continuation.outputs.deferred != 'true'\n",'')));
console.log('Pinned Canvas deployment continuation guards passed; no accepted product suites were repeated.');
