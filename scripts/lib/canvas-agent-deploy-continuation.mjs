// One completed release, blocked before activation by deployment classification.
// Preserve its accepted artifacts; this is not a general cross-SHA test cache.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
  assertCanvasAgentDeployDelta(env.GITHUB_SHA,options);
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
export function canvasAgentDeployPushDeferred(env=process.env,options={}) {
  if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main')return false;
  const readGit=options.readGit||git;
  if(readGit(['rev-parse',`${env.GITHUB_SHA}^`])!==CANVAS_AGENT_DEPLOY_SOURCE.sha)return false;
  assertCanvasAgentDeployDelta(env.GITHUB_SHA,{readGit});
  return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const command=process.argv[2];assert(['push','source'].includes(command));
    if(command==='push') {
      const deferred=canvasAgentDeployPushDeferred();
      if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`deferred=${deferred}\n`);
      console.log(deferred?'Accepted source remains unchanged; use the explicit protected candidate deployment.':'Ordinary exact-source validation.');
    } else {
      const source=resolveCanvasAgentDeploySource();
      if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`active=${Boolean(source)}\n${source?`source_sha=${source.sha}\nsource_run=${source.run}\nsource_attempt=${source.attempt}\n`:''}`);
      console.log(source?'Pinned completed Canvas candidate accepted for deployment-only continuation.':'Ordinary same-source candidate reuse.');
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
