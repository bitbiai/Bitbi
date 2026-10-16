// One completed release, blocked before activation by deployment classification.
// Preserve its accepted artifacts; this is not a general cross-SHA test cache.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const CANVAS_AGENT_DEPLOY_SOURCE = Object.freeze({
  policy:'canvas-agent-deploy-only-v1',
  sha:'f75d812f6a08337be81249387e194d27bd404f0d',
  base:'005c0dd4ec7bc3cf6bcb568ae9cf5becc5915439',run:'38818004151',attempt:'1',
  candidate:Object.freeze({id:12011946363,digest:'sha256:bac99d786373c40f149c5f5f0a0ba006d6cc36a5ce5111de7ee81ff7c648cd7e',size:119730376}),
  media:Object.freeze({id:12010824709,digest:'sha256:2e41f6a224dddf5ceeb41f69056a5aed8a6a96c001d5c579ac8b8f66b85b80e8',size:255547879}),
});
export const CANVAS_AGENT_DEPLOY_FILES = Object.freeze([
  '.github/workflows/static.yml',
  'scripts/lib/canvas-agent-deploy-continuation.mjs',
  'scripts/lib/worker-tooling-impact.mjs',
  'scripts/pages-candidate.mjs','scripts/lib/frontend-source.mjs',
  'scripts/lib/frontend-receipts.mjs','scripts/frontend-release.mjs',
  'scripts/lib/backend-publication.mjs','scripts/lib/media-publication.mjs',
  'scripts/test-canvas-agent-deploy-continuation.mjs','scripts/test-canvas-agent-deploy-backend.mjs',
  'docs/runbooks/REGRESSION_REGISTER.md',
]);
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const entries=text=>text.split('\0').filter(Boolean).map(line=>{
  const [identity,file]=line.split('\t');assert(identity&&file,'Invalid continuation tree');return {identity,file};
});
export function assertCanvasAgentDeployDelta(head,{readGit=git}={}) {
  const source=CANVAS_AGENT_DEPLOY_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||'')&&head!==source.sha,'Exact new publication SHA required');
  // A single reviewed correction immediately follows the completed candidate.
  assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Continuation is not the direct source successor');
  readGit(['merge-base','--is-ancestor',source.base,source.sha]);
  const before=entries(readGit(['ls-tree','-rz',source.sha]));
  const after=entries(readGit(['ls-tree','-rz',head]));
  const allowed=new Set(CANVAS_AGENT_DEPLOY_FILES);
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),
    'Deployment continuation changed product, tests, build or toolchain inputs');
  const previous=new Map(before.map(row=>[row.file,row.identity]));
  const changed=after.filter(row=>previous.get(row.file)!==row.identity).map(row=>row.file);
  for(const row of before)assert(after.some(next=>next.file===row.file),'Deployment continuation deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity),'Deployment tooling must remain regular files');
  for(const file of CANVAS_AGENT_DEPLOY_FILES.filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing required deployment correction: ${file}`);
  return changed;
}
export function resolveCanvasAgentDeploySource(env=process.env,options) {
  const source=CANVAS_AGENT_DEPLOY_SOURCE;
  const explicit=Boolean(env.CANVAS_AGENT_DEPLOY_SOURCE_SHA||env.CANVAS_AGENT_DEPLOY_SOURCE_RUN||env.CANVAS_AGENT_DEPLOY_SOURCE_ATTEMPT);
  if(!explicit&&(env.CANDIDATE_RUN!==source.run||env.GITHUB_SHA===source.sha))return null;
  assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,'bitbiai/Bitbi');
  assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
  assert.equal(env.CANDIDATE_BASE,source.base);assert.equal(env.CANDIDATE_RUN,source.run);assert.equal(env.CANDIDATE_ATTEMPT,source.attempt);
  assert(!env.REPAIR_SOURCE_SHA&&!env.REPAIR_SOURCE_RUN&&!env.REPAIR_SOURCE_ATTEMPT,'Ambiguous legacy repair authority');
  if(explicit)for(const [key,value]of [['SHA',source.sha],['RUN',source.run],['ATTEMPT',source.attempt]])assert.equal(env[`CANVAS_AGENT_DEPLOY_SOURCE_${key}`],value,'Changed deployment source identity');
  assertCanvasAgentPublicationDelta(env.GITHUB_SHA,options);
  return source;
}
export function assertCanvasAgentDeployArtifact(artifact,kind) {
  const source=CANVAS_AGENT_DEPLOY_SOURCE,pin=source[kind];assert(pin&&['candidate','media'].includes(kind));
  const prefix=kind==='candidate'?'pages-candidate':'private-media-image';
  assert.equal(artifact.id,pin.id);assert.equal(artifact.digest,pin.digest);assert.equal(artifact.size_in_bytes,pin.size);
  assert.equal(artifact.name,`${prefix}-${source.sha}-${source.run}-${source.attempt}`);
  assert.equal(artifact.workflow_run?.id,Number(source.run));assert.equal(artifact.workflow_run?.head_sha,source.sha);
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now(),'Expired accepted deployment artifact');
}
export function canvasAgentDeployIdentity(publicationSha) {
  assert(/^[a-f0-9]{40}$/.test(publicationSha||'')&&publicationSha!==CANVAS_AGENT_DEPLOY_SOURCE.sha);
  const {policy,sha,run,attempt}=CANVAS_AGENT_DEPLOY_SOURCE;
  return {policy,sourceSha:sha,sourceRun:run,sourceAttempt:attempt,publicationSha};
}
export function assertCanvasAgentDeployAcceptance(jobs,sha,run,attempt) {
  assert(/^[a-f0-9]{40}$/.test(sha||'')&&sha!==CANVAS_AGENT_DEPLOY_SOURCE.sha);
  const matches=jobs.filter(job=>job.name==='reuse-candidate');assert.equal(matches.length,1,'Missing unique deployment continuation');
  const job=matches[0];assert.equal(job.head_sha,sha);assert.equal(String(job.run_id),String(run));assert.equal(String(job.run_attempt),String(attempt));
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  for(const name of ['Verify Canvas deployment-only source','Check new Canvas deployment-only guards','Preflight acknowledged full release','Verify exact completed source acceptance'])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion==='success'),`Missing deployment-only gate: ${name}`);
  const validation=jobs.filter(job=>job.name==='release-compatibility');assert.equal(validation.length,1);
  assert.equal(validation[0].conclusion,'skipped','Deployment-only dispatch must not repeat accepted validation');
}
// The failed publication already activated AI/media. Only the exact Auth
// capability correction may differ from its accepted product tree.
export const CANVAS_AGENT_RECOVERY_SOURCE=Object.freeze({policy:'canvas-agent-backend-recovery-v1',
  sha:'fa95bf71b59510d4f8debfd041fd052babda1a2f',run:'38847674259',attempt:'1',job:'116801900254',authorization:7110438668,guardJob:'116801784610',
  log:Object.freeze({sha256:'0e5208ff86b1b88de9a81a56806f041960ade6f04be084bceed2673495ad3e40',bytes:86993}),
  auth:Object.freeze({path:'workers/auth/src/routes/canvas-video-processing.js',before:'0cf17d720b976febc2c45225fe307c50620040e1',after:'c8b31a6f382720bb7ab81e9e46487ba3d4aa809b'}),
  test:Object.freeze({path:'tests/q2-processor-capability.spec.js',blob:'79553f219a1f7cf2fe4922bff7e890e7023cf4f3'}),
});
// Both recovery guards completed in this job; its sole Auth case failed while
// seeding the fixture. Retain those guards and finish only that failed case.
export const CANVAS_AGENT_RECOVERY_CHECK_SOURCE=Object.freeze({
  sha:'f0f189b664c39f5ae10c24ad69d71970a1ae0b04',run:'38851208388',attempt:'1',job:'116812585513',
  log:Object.freeze({sha256:'323eb4e4c6e5b1662af2043d441019146a3d808a4bb9966077b6ade58f0029b7',bytes:120219}),
  artifact:Object.freeze({id:12025451086,digest:'sha256:a791e0bcb583814f8dfafb46c96252bf40a62d32b17fca2260aeffd75ab48dc0',size:2476}),
  testBlob:'55dde5f508f193391feaedc54f75991a54f8be20',
  archive:Object.freeze({path:'scripts/lib/backend-publication.mjs',before:'594fdf571d9d155ded3b7dabea295ed4354a5796',after:'620d3f7f91c44801304816eae3a68a1314947118'}),
});
// The corrected Auth case also passed. Only the installed Wrangler location
// for the original-source media dry run remains to be corrected.
export const CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE=Object.freeze({
  sha:'3a7eaaed8a024d900eb9cbb929bca3f0db828f29',run:'38852027878',attempt:'1',job:'116815151179',deployJob:'116815439125',
  backend:Object.freeze({path:'scripts/lib/backend-publication.mjs',before:'620d3f7f91c44801304816eae3a68a1314947118',after:'b0c67e8d860cd39e1b7c8659414d6007131b0e69'}),
});
// Backend activation and its acceptance are complete. Retain that receipt;
// this final tooling correction authorizes only frontend continuation.
export const CANVAS_AGENT_FRONTEND_SOURCE=Object.freeze({
  sha:'6825cbf9d646af6e81eeb000895b00e338c6cba9',run:'38852692377',attempt:'1',job:'116817211746',deployJob:'116817296647',
  artifact:Object.freeze({id:12025684633,digest:'sha256:8532deda77bb7f0d4ec663c927b6df583c6953f7bc0c507384bccfcc29bf3cd3',size:4795}),
  backend:Object.freeze({path:'scripts/lib/backend-publication.mjs',before:'b0c67e8d860cd39e1b7c8659414d6007131b0e69',after:'9b9b23f255b7367cd9d1b808b5ec716df71a7487'}),
});
export const CANVAS_AGENT_RECONCILIATION_SOURCE=Object.freeze({
  sha:'8cc67b08a8d660844d3dc52777c1cec6d830af7e',run:'38853747854',attempt:'1',version:'1656258f-8945-49c0-a9bf-fc789a9e68e0',
  job:'116820612342',authorization:7111371881,
  artifact:Object.freeze({id:12026726017,digest:'sha256:7cc760cc6dd1f88242b24d59982f4df57d19a64a52b4580f13a2a4735d16ff5f',size:603}),
  receipt:Object.freeze({path:'scripts/lib/frontend-receipts.mjs',before:'61f542dbfa38716de0938bb27fdd4d9d4e9c49d2',after:'8c92aa4810e39f818057e5d00a7271a39591aee8'}),
});
export function assertCanvasAgentReconciliationDelta(head,{readGit=git}={}) {
  const source=CANVAS_AGENT_RECONCILIATION_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||''));assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Receipt reconciliation must directly follow 8cc');
  assertCanvasAgentFrontendDelta(source.sha,{readGit});
  const allowed=new Set(['scripts/lib/canvas-agent-deploy-continuation.mjs',source.receipt.path,'docs/runbooks/REGRESSION_REGISTER.md']);
  const before=entries(readGit(['ls-tree','-rz',source.sha])),after=entries(readGit(['ls-tree','-rz',head]));
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),'Receipt reconciliation changed accepted product, tests, backend or workflow');
  for(const row of before)assert(after.some(next=>next.file===row.file),'Receipt reconciliation deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity));
  assert.equal(readGit(['rev-parse',`${source.sha}:${source.receipt.path}`]),source.receipt.before);
  assert.equal(readGit(['rev-parse',`${head}:${source.receipt.path}`]),source.receipt.after,'Wrong frontend receipt reconciliation correction');
  const prior=new Map(before.map(row=>[row.file,row.identity]));
  const changed=after.filter(row=>prior.get(row.file)!==row.identity).map(row=>row.file);
  for(const file of [...allowed].filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing receipt reconciliation input: ${file}`);
  return changed;
}
export function assertCanvasAgentFrontendDelta(head,{readGit=git}={}) {
  const source=CANVAS_AGENT_FRONTEND_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||''));assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Frontend continuation must directly follow completed 6825 activation');
  assertCanvasAgentRecoveryDeployDelta(source.sha,{readGit});
  const allowed=new Set(['.github/workflows/static.yml','scripts/lib/canvas-agent-deploy-continuation.mjs',source.backend.path,'docs/runbooks/REGRESSION_REGISTER.md']);
  const before=entries(readGit(['ls-tree','-rz',source.sha])),after=entries(readGit(['ls-tree','-rz',head]));
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),'Frontend continuation changed accepted product or tests');
  for(const row of before)assert(after.some(next=>next.file===row.file),'Frontend continuation deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity));
  assert.equal(readGit(['rev-parse',`${source.sha}:${source.backend.path}`]),source.backend.before);
  assert.equal(readGit(['rev-parse',`${head}:${source.backend.path}`]),source.backend.after,'Wrong completed backend receipt correction');
  const prior=new Map(before.map(row=>[row.file,row.identity]));
  const changed=after.filter(row=>prior.get(row.file)!==row.identity).map(row=>row.file);
  for(const file of [...allowed].filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing frontend continuation input: ${file}`);
  return changed;
}
export function resolveCanvasAgentFrontendSource(env=process.env,options={}) {
  if(!resolveCanvasAgentDeploySource(env,options))return null;
  return [CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes((options.readGit||git)(['rev-parse',`${env.GITHUB_SHA}^`]))?CANVAS_AGENT_FRONTEND_SOURCE:null;
}
export function assertCanvasAgentRecoveryDeployDelta(head,{readGit=git}={}) {
  const source=CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||''));assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Deployment continuation must directly follow 3a');
  assertCanvasAgentRecoveryCheckDelta(source.sha,{readGit});
  const allowed=new Set(['.github/workflows/static.yml','scripts/lib/canvas-agent-deploy-continuation.mjs',source.backend.path,'docs/runbooks/REGRESSION_REGISTER.md']);
  const before=entries(readGit(['ls-tree','-rz',source.sha])),after=entries(readGit(['ls-tree','-rz',head]));
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),'Deployment continuation changed accepted product or tests');
  for(const row of before)assert(after.some(next=>next.file===row.file),'Deployment continuation deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity));
  assert.equal(readGit(['rev-parse',`${source.sha}:${source.backend.path}`]),source.backend.before);
  assert.equal(readGit(['rev-parse',`${head}:${source.backend.path}`]),source.backend.after,'Wrong original-source Wrangler correction');
  const prior=new Map(before.map(row=>[row.file,row.identity]));
  const changed=after.filter(row=>prior.get(row.file)!==row.identity).map(row=>row.file);
  for(const file of [...allowed].filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing deployment continuation input: ${file}`);
  return changed;
}
export function assertCanvasAgentRecoveryCheckDelta(head,{readGit=git}={}) {
  const source=CANVAS_AGENT_RECOVERY_CHECK_SOURCE,test=CANVAS_AGENT_RECOVERY_SOURCE.test.path;
  assert(/^[a-f0-9]{40}$/.test(head||''));assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Auth check continuation must directly follow f0');
  assertCanvasAgentRecoveryDelta(source.sha,{readGit});
  const allowed=new Set(['.github/workflows/static.yml','scripts/lib/canvas-agent-deploy-continuation.mjs',test,source.archive.path,'docs/runbooks/REGRESSION_REGISTER.md']);
  const before=entries(readGit(['ls-tree','-rz',source.sha])),after=entries(readGit(['ls-tree','-rz',head]));
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),
    'Auth check continuation changed accepted product, guards, build or toolchain inputs');
  for(const row of before)assert(after.some(next=>next.file===row.file),'Auth check continuation deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity));
  assert.equal(readGit(['rev-parse',`${head}:${test}`]),source.testBlob,'Wrong corrected Auth acceptance');
  assert.equal(readGit(['rev-parse',`${source.sha}:${source.archive.path}`]),source.archive.before);
  assert.equal(readGit(['rev-parse',`${head}:${source.archive.path}`]),source.archive.after,'Wrong original-source bundle archive correction');
  const prior=new Map(before.map(row=>[row.file,row.identity]));
  const changed=after.filter(row=>prior.get(row.file)!==row.identity).map(row=>row.file);
  for(const file of [...allowed].filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing Auth check continuation input: ${file}`);
  return changed;
}
export function assertCanvasAgentRecoveryDelta(head,{readGit=git}={}) {
  if(readGit(['rev-parse',`${head}^`])===CANVAS_AGENT_RECONCILIATION_SOURCE.sha)return assertCanvasAgentReconciliationDelta(head,{readGit});
  if(readGit(['rev-parse',`${head}^`])===CANVAS_AGENT_FRONTEND_SOURCE.sha)return assertCanvasAgentFrontendDelta(head,{readGit});
  if(readGit(['rev-parse',`${head}^`])===CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha)return assertCanvasAgentRecoveryDeployDelta(head,{readGit});
  if(readGit(['rev-parse',`${head}^`])===CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha)return assertCanvasAgentRecoveryCheckDelta(head,{readGit});
  const source=CANVAS_AGENT_RECOVERY_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||''));assert.equal(readGit(['rev-parse',`${head}^`]),source.sha,'Recovery must directly follow fa95');
  assertCanvasAgentDeployDelta(source.sha,{readGit});
  const allowed=new Set(['.github/workflows/static.yml','scripts/lib/local-release-plan.mjs','scripts/lib/canvas-agent-deploy-continuation.mjs',
    'scripts/test-canvas-import-guard.mjs','scripts/lib/backend-publication.mjs','scripts/lib/media-publication.mjs',
    'scripts/lib/canvas-agent-backend-recovery.mjs','scripts/test-canvas-agent-backend-recovery.mjs',
    'scripts/pages-candidate.mjs','scripts/lib/frontend-source.mjs','scripts/lib/frontend-receipts.mjs','scripts/frontend-release.mjs',
    source.auth.path,source.test.path,'docs/runbooks/REGRESSION_REGISTER.md']);
  const before=entries(readGit(['ls-tree','-rz',source.sha])),after=entries(readGit(['ls-tree','-rz',head]));
  assert.deepEqual(after.filter(row=>!allowed.has(row.file)),before.filter(row=>!allowed.has(row.file)),
    'Recovery changed protected product, image, frontend, tests or toolchain inputs');
  const prior=new Map(before.map(row=>[row.file,row.identity]));
  for(const row of before)assert(after.some(next=>next.file===row.file),'Recovery deleted an input');
  for(const row of after.filter(row=>allowed.has(row.file)))assert(/^100644 blob [a-f0-9]{40}$/.test(row.identity));
  assert.equal(readGit(['rev-parse',`${source.sha}:${source.auth.path}`]),source.auth.before);
  assert.equal(readGit(['rev-parse',`${head}:${source.auth.path}`]),source.auth.after,'Wrong Auth capability correction');
  assert.equal(readGit(['rev-parse',`${head}:${source.test.path}`]),source.test.blob,'Wrong new Auth acceptance');
  const changed=after.filter(row=>prior.get(row.file)!==row.identity).map(row=>row.file);
  for(const file of [...allowed].filter(file=>!file.startsWith('docs/')))assert(changed.includes(file),`Missing recovery input: ${file}`);
  return changed;
}
export function assertCanvasAgentPublicationDelta(head,options={}) {
  const readGit=options.readGit||git;
  if([CANVAS_AGENT_RECOVERY_SOURCE.sha,CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha,CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(readGit(['rev-parse',`${head}^`])))return assertCanvasAgentRecoveryDelta(head,{readGit});
  return assertCanvasAgentDeployDelta(head,{readGit});
}
export function resolveCanvasAgentRecoverySource(env=process.env,options={}) {
  if(!resolveCanvasAgentDeploySource(env,options))return null;
  return [CANVAS_AGENT_RECOVERY_SOURCE.sha,CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha,CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes((options.readGit||git)(['rev-parse',`${env.GITHUB_SHA}^`]))?CANVAS_AGENT_RECOVERY_SOURCE:null;
}
export function canvasAgentRecoveryIdentity(publicationSha) {
  assertCanvasAgentRecoveryDelta(publicationSha);const {policy,sha,run,attempt}=CANVAS_AGENT_RECOVERY_SOURCE;
  return {policy,sourceSha:sha,sourceRun:run,sourceAttempt:attempt,publicationSha};
}
export function assertCanvasAgentRecoveryAcceptance(jobs,sha,run,attempt) {
  assertCanvasAgentRecoveryDelta(sha);
  const parent=git(['rev-parse',`${sha}^`]),deployOnly=[CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(parent);
  const tail=deployOnly||parent===CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha;
  const selected=jobs.filter(job=>job.name==='reuse-candidate');assert.equal(selected.length,1);const job=selected[0];
  assert.equal(job.head_sha,sha);assert.equal(String(job.run_id),String(run));assert.equal(String(job.run_attempt),String(attempt));
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  for(const name of ['Verify Canvas deployment-only source','Preflight acknowledged full release','Verify exact completed source acceptance',
    ...(!deployOnly?[tail?'Check corrected Canvas processor capability':'Check Canvas backend recovery guards','Preserve Canvas recovery check evidence']:[])])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion==='success'),`Missing recovery gate: ${name}`);
  if(deployOnly)for(const name of ['Prepare Canvas backend recovery checks','Check corrected Canvas processor capability','Preserve Canvas recovery check evidence'])
    assert(job.steps?.some(step=>step.name===name&&step.conclusion==='skipped'),`Accepted tests/preparation must not repeat: ${name}`);
  if(tail)assert(job.steps?.some(step=>step.name==='Check Canvas backend recovery guards'&&step.conclusion==='skipped'),'Passed recovery guards must not repeat');
  assert(job.steps?.some(step=>step.name==='Check new Canvas deployment-only guards'&&step.conclusion==='skipped'),'Already accepted guards must not repeat');
  assert.equal(jobs.filter(job=>job.name==='release-compatibility').length,1);
  assert.equal(jobs.find(job=>job.name==='release-compatibility').conclusion,'skipped');
}
export async function verifyCanvasAgentRecoverySource(env,{read,list,download=fetch}) {
  const source=resolveCanvasAgentRecoverySource(env);assert(source,'Missing closed recovery source');
  const retainedGuards=[CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha,CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(git(['rev-parse',`${env.GITHUB_SHA}^`]))
    ?await verifyCanvasAgentRecoveryChecks(env,{read,list,download}):null;
  const [run,jobs,authorization,statuses]=await Promise.all([read(`actions/runs/${source.run}`),list(`actions/runs/${source.run}/attempts/${source.attempt}/jobs`,'jobs'),
    read(`deployments/${source.authorization}`),read(`deployments/${source.authorization}/statuses`)]);
  assert.equal(String(run.id),source.run);assert.equal(String(run.run_attempt),source.attempt);assert.equal(run.head_sha,source.sha);
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assertCanvasAgentDeployAcceptance(jobs,source.sha,source.run,source.attempt);
  assert.equal(String(jobs.find(job=>job.name==='reuse-candidate').id),source.guardJob);
  const matches=jobs.filter(job=>String(job.id)===source.job);assert.equal(matches.length,1);const job=matches[0];
  assert.equal(job.name,'deploy');assert.equal(job.head_sha,source.sha);assert.equal(String(job.run_id),source.run);assert.equal(String(job.run_attempt),source.attempt);
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  for(const [name,conclusion]of [['Validate candidate references before backend publication','success'],['Apply verified candidate backend prerequisites','failure'],
    ['Preserve backend activation evidence','skipped'],['Deploy and verify Cloudflare frontend','skipped'],['Record durable frontend receipt','skipped']])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion===conclusion),`Wrong failed activation stage: ${name}`);
  assert.equal(authorization.id,source.authorization);assert.equal(authorization.sha,source.sha);assert.equal(authorization.environment,'cloudflare-static-production');assert.equal(authorization.task,'deploy');
  const log=`https://github.com/bitbiai/Bitbi/actions/runs/${source.run}/job/${source.job}`;
  const status=statuses.find(status=>status.state==='failure'&&status.log_url===log);assert(status,'Missing exact failed protected authorization');
  const response=await download(`https://api.github.com/repos/bitbiai/Bitbi/actions/jobs/${source.job}/logs`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Missing failed activation log');const bytes=Buffer.from(await response.arrayBuffer());
  const logDigest=createHash('sha256').update(bytes).digest('hex');assert.equal(bytes.length,source.log.bytes);assert.equal(logDigest,source.log.sha256);
  assert(bytes.includes(Buffer.from('Private media smoke did not complete within release acceptance window'))&&bytes.includes(Buffer.from('1 !== 0')),'Wrong incomplete media acceptance');
  return {source,run,job,authorization,status,logDigest,logBytes:bytes.length,...(retainedGuards?{retainedGuards}:{})};
}
export async function verifyCanvasAgentRecoveryChecks(env,{read,list,download=fetch}) {
  assertCanvasAgentRecoveryDelta(env.GITHUB_SHA);
  const completed=[CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(git(['rev-parse',`${env.GITHUB_SHA}^`]))
    ?await verifyCanvasAgentCompletedRecoveryChecks(env,{read,list}):null;
  const backend=resolveCanvasAgentFrontendSource(env)?await verifyCanvasAgentFrontendSource(env,{read,list}):null;
  const source=CANVAS_AGENT_RECOVERY_CHECK_SOURCE;
  const [run,jobs,artifact]=await Promise.all([read(`actions/runs/${source.run}`),
    list(`actions/runs/${source.run}/attempts/${source.attempt}/jobs`,'jobs'),read(`actions/artifacts/${source.artifact.id}`)]);
  assert.equal(String(run.id),source.run);assert.equal(String(run.run_attempt),source.attempt);assert.equal(run.head_sha,source.sha);
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  const matches=jobs.filter(job=>job.name==='reuse-candidate');assert.equal(matches.length,1);const job=matches[0];
  assert.equal(String(job.id),source.job);assert.equal(job.head_sha,source.sha);assert.equal(String(job.run_id),source.run);assert.equal(String(job.run_attempt),source.attempt);
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  for(const [name,conclusion]of [['Verify Canvas deployment-only source','success'],['Preflight acknowledged full release','success'],
    ['Prepare Canvas backend recovery checks','success'],['Check Canvas backend recovery guards','failure'],['Preserve Canvas recovery check evidence','success'],
    ['Check new Canvas deployment-only guards','skipped'],['Verify exact completed source acceptance','skipped']])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion===conclusion),`Wrong retained recovery stage: ${name}`);
  for(const name of ['release-compatibility','deploy']) {
    const selected=jobs.filter(row=>row.name===name);assert.equal(selected.length,1);assert.equal(selected[0].conclusion,'skipped');
  }
  assert.equal(artifact.id,source.artifact.id);
  assert.equal(artifact.digest,source.artifact.digest);assert.equal(artifact.size_in_bytes,source.artifact.size);
  assert.equal(artifact.name,`canvas-recovery-checks-${source.sha}-${source.run}-${source.attempt}`);
  assert.equal(artifact.workflow_run?.id,Number(source.run));assert.equal(artifact.workflow_run?.head_sha,source.sha);
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now());
  const response=await download(`https://api.github.com/repos/bitbiai/Bitbi/actions/jobs/${source.job}/logs`,
    {headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Missing retained recovery guard log');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length,source.log.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),source.log.sha256);
  for(const marker of ['New import-guard repair checks passed; accepted product and deployment suites were not repeated.',
    'New Canvas backend recovery guards passed: original activation/source bounds, redacted pre-mutation evidence, result-only completion, retained lifecycle provenance, Auth-only publication.',
    'tests/q2-processor-capability.spec.js:58:33'])assert(bytes.includes(Buffer.from(marker)),'Missing exact retained guard/failed Auth evidence');
  return {sourceSha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,sourceJob:source.job,log:source.log,artifact:source.artifact,...(completed?{completed}:{}),
    ...(backend?{completedBackend:{sourceSha:backend.source.sha,sourceRun:backend.source.run,sourceAttempt:backend.source.attempt,sourceJob:backend.source.deployJob,artifact:backend.source.artifact}}:{})};
}
export async function verifyCanvasAgentCompletedRecoveryChecks(env,{read,list}) {
  assertCanvasAgentRecoveryDelta(env.GITHUB_SHA);
  const source=CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE;
  const [run,jobs]=await Promise.all([read(`actions/runs/${source.run}`),list(`actions/runs/${source.run}/attempts/${source.attempt}/jobs`,'jobs')]);
  assert.equal(String(run.id),source.run);assert.equal(String(run.run_attempt),source.attempt);assert.equal(run.head_sha,source.sha);
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assertCanvasAgentRecoveryAcceptance(jobs,source.sha,source.run,source.attempt);
  assert.equal(String(jobs.find(job=>job.name==='reuse-candidate').id),source.job);
  const selected=jobs.filter(job=>job.name==='deploy');assert.equal(selected.length,1);const job=selected[0];
  assert.equal(String(job.id),source.deployJob);assert.equal(job.head_sha,source.sha);assert.equal(String(job.run_id),source.run);assert.equal(String(job.run_attempt),source.attempt);
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  for(const [name,conclusion]of [['Validate candidate references before backend publication','success'],['Apply verified candidate backend prerequisites','failure'],
    ['Deploy and verify Cloudflare frontend','skipped'],['Record durable frontend receipt','skipped']])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion===conclusion),`Wrong deployment-only source stage: ${name}`);
  return {sourceSha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,sourceJob:source.job};
}
export async function verifyCanvasAgentFrontendSource(env,{read,list}) {
  const source=resolveCanvasAgentFrontendSource(env);assert(source,'Missing closed completed backend source');
  const [run,jobs,artifact]=await Promise.all([read(`actions/runs/${source.run}`),
    list(`actions/runs/${source.run}/attempts/${source.attempt}/jobs`,'jobs'),read(`actions/artifacts/${source.artifact.id}`)]);
  assert.equal(String(run.id),source.run);assert.equal(String(run.run_attempt),source.attempt);assert.equal(run.head_sha,source.sha);
  assert.equal(run.repository?.full_name,'bitbiai/Bitbi');assert.equal(run.head_repository?.full_name,'bitbiai/Bitbi');
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assertCanvasAgentRecoveryAcceptance(jobs,source.sha,source.run,source.attempt);
  assert.equal(String(jobs.find(job=>job.name==='reuse-candidate').id),source.job);
  const selected=jobs.filter(job=>job.name==='deploy');assert.equal(selected.length,1);const job=selected[0];
  assert.equal(String(job.id),source.deployJob);assert.equal(job.head_sha,source.sha);assert.equal(String(job.run_id),source.run);assert.equal(String(job.run_attempt),source.attempt);
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  for(const [name,conclusion]of [['Validate candidate references before backend publication','success'],['Apply verified candidate backend prerequisites','success'],
    ['Preserve backend activation evidence','success'],['Check static deploy release-plan safety','failure'],
    ['Deploy and verify Cloudflare frontend','skipped'],['Record durable frontend receipt','skipped']])
    assert(job.steps?.some(step=>step.name===name&&step.status==='completed'&&step.conclusion===conclusion),`Wrong completed backend stage: ${name}`);
  assert.equal(artifact.id,source.artifact.id);assert.equal(artifact.digest,source.artifact.digest);assert.equal(artifact.size_in_bytes,source.artifact.size);
  assert.equal(artifact.name,`backend-receipt-${source.sha}-${source.run}-${source.attempt}`);
  assert.equal(artifact.workflow_run?.id,Number(source.run));assert.equal(artifact.workflow_run?.head_sha,source.sha);
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now());
  return {source,run,job,artifact};
}
export function canvasAgentDeployPushDeferred(env=process.env,options={}) {
  if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main')return false;
  const readGit=options.readGit||git;
  const parent=readGit(['rev-parse',`${env.GITHUB_SHA}^`]);
  if([CANVAS_AGENT_RECOVERY_SOURCE.sha,CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha,CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha,CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(parent)){assertCanvasAgentRecoveryDelta(env.GITHUB_SHA,{readGit});return true;}
  if(parent!==CANVAS_AGENT_DEPLOY_SOURCE.sha)return false;
  assertCanvasAgentDeployDelta(env.GITHUB_SHA,{readGit});
  return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const command=process.argv[2];assert(['push','source'].includes(command));
    if(command==='push') {
      const deferred=canvasAgentDeployPushDeferred();
      if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`deferred=${deferred}\n`);
      console.log(deferred?'Accepted artifacts remain unchanged; use the explicit protected candidate continuation.':'Ordinary exact-source validation.');
    } else {
      const source=resolveCanvasAgentDeploySource(),recovery=resolveCanvasAgentRecoverySource();
      const parent=git(['rev-parse',`${process.env.GITHUB_SHA}^`]),frontendOnly=Boolean(recovery&&[CANVAS_AGENT_FRONTEND_SOURCE.sha,CANVAS_AGENT_RECONCILIATION_SOURCE.sha].includes(parent));
      const deployOnly=Boolean(recovery&&(frontendOnly||parent===CANVAS_AGENT_RECOVERY_DEPLOY_SOURCE.sha));
      const tail=Boolean(recovery&&(deployOnly||parent===CANVAS_AGENT_RECOVERY_CHECK_SOURCE.sha));
      if(tail) {
        // Keep this entrypoint independent of pages-candidate, which imports
        // this module itself. Read only the one pinned job and artifact.
        const read=async endpoint=>{
          const response=await fetch(`https://api.github.com/repos/bitbiai/Bitbi/${endpoint}`,
            {headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
          assert(response.ok,'Missing retained recovery metadata');return response.json();
        };
        const list=async(endpoint,key)=>{const response=await read(`${endpoint}?per_page=100`);assert(Array.isArray(response[key])&&response.total_count===response[key].length,'Incomplete retained job list');return response[key];};
        await verifyCanvasAgentRecoveryChecks(process.env,{read,list});
      }
      if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`active=${Boolean(source)}\nrecovery=${Boolean(recovery)}\nrecovery_tail=${tail}\nrecovery_deploy_only=${deployOnly}\nfrontend_only=${frontendOnly}\n${source?`source_sha=${source.sha}\nsource_run=${source.run}\nsource_attempt=${source.attempt}\n`:''}`);
      console.log(source?'Pinned completed Canvas candidate accepted for deployment-only continuation.':'Ordinary same-source candidate reuse.');
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
