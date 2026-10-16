// New deployment-only regression checks. This script does not run any accepted
// product suite, build an image, contact a provider or mutate a remote service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workerToolingPatchEvidence} from './lib/worker-tooling-impact.mjs';
import {createReleasePlanFromRepo} from './lib/release-plan.mjs';
import {backendContinuationSupported} from './lib/backend-continuation.mjs';
import {backendReceiptContext,verifyBackendActivation,advanceBackend} from './lib/backend-publication.mjs';
import {mediaEvidenceRun,mediaFixtureSha,verifyMediaEvidence,activateMedia,mediaActive} from './lib/media-publication.mjs';
import {CANVAS_AGENT_DEPLOY_SOURCE,resolveCanvasAgentDeploySource} from './lib/canvas-agent-deploy-continuation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const source=CANVAS_AGENT_DEPLOY_SOURCE;
const authPackages=['workers/auth/package.json','workers/auth/package-lock.json'];
const actualFiles=git(['diff','--name-only',source.base,source.sha]).split('\n');
const actual=workerToolingPatchEvidence(root,{mode:'git-diff',base:source.base,head:source.sha},actualFiles);
const allPackages=['auth','ai','contact'].flatMap(worker=>[`workers/${worker}/package.json`,`workers/${worker}/package-lock.json`]);
assert.deepEqual([...actual.reviewedToolingPatchFiles].sort(),allPackages.sort(),
  'The actual accepted Auth graph must prove the exact tooling patch');
assert.deepEqual(actual.toolingOnlyWorkerPackageFiles.sort(),allPackages.filter(file=>file.startsWith('workers/contact/')).sort(),
  'Changed Auth/AI runtime must retain deployment impact');
const actualPlan=createReleasePlanFromRepo(root,{base:source.base,head:source.sha});
assert(backendContinuationSupported(actualPlan),'The complete immutable accepted release must admit its protected backend continuation');
assert(actualPlan.workerDeploys.some(row=>row.worker==='auth'));
assert(actualPlan.workerDeploys.some(row=>row.worker==='ai'));
assert(!actualPlan.workerDeploys.some(row=>row.worker==='contact'));
assert(!backendContinuationSupported({...actualPlan,reviewedToolingPatchFiles:[]}),
  'Deploying Auth does not substitute for proof of the package patch');

// A small real Git graph isolates the two missed inputs. Package values come
// from the independently accepted before/after commits, not reconstructed locks.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-agent-deploy-guard-'));
try {
  const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(temporary,file)),{recursive:true});fs.writeFileSync(path.join(temporary,file),typeof value==='string'?value:JSON.stringify(value));};
  const commit=message=>{git(['add','.'],temporary);git(['-c','user.name=Deployment fixture','-c','user.email=fixture@example.invalid','commit','-qm',message],temporary);return git(['rev-parse','HEAD'],temporary);};
  const read=(ref,file)=>git(['show',`${ref}:${file}`]);
  const diagnostic='services/homepage-ffmpeg-processor/canvas-diagnostics.mjs';
  const importDiagnostic="import {safe} from '../../../services/homepage-ffmpeg-processor/canvas-diagnostics.mjs';\n";
  const importContract="import contract from '../../../config/release-compat.json' with {type:'json'};\n";
  const entry=`${importDiagnostic}${importContract}export default {safe,contract};\n`;
  git(['init','-q'],temporary);
  write('package-lock.json',{packages:{'':{}}});
  write('workers/auth/wrangler.jsonc',{main:'src/index.js',vars:{}});
  write('workers/auth/src/index.js',entry);write(diagnostic,'export const safe=true;\n');
  write('config/release-compat.json',{version:1});
  for(const file of authPackages)write(file,read(source.base,file));
  const base=commit('actual pre-patch packages and reviewed runtime graph');
  for(const file of authPackages)write(file,read(source.sha,file));
  const patched=commit('exact accepted Sharp patch only');
  const inspect=head=>workerToolingPatchEvidence(temporary,{mode:'git-diff',base,head},git(['diff','--name-only',base,head],temporary).split('\n'));
  assert.deepEqual(inspect(patched).toolingOnlyWorkerPackageFiles.sort(),[...authPackages].sort(),
    'A known unchanged graph is the positive control for tooling-only classification');
  const change=(label,mutate)=>{git(['checkout','-q',patched],temporary);mutate(write);return inspect(commit(label));};
  const contractChanged=change('changed runtime JSON',write=>write('config/release-compat.json',{version:2}));
  assert.deepEqual(contractChanged.reviewedToolingPatchFiles.sort(),[...authPackages].sort());
  assert.deepEqual(contractChanged.toolingOnlyWorkerPackageFiles,[],
    'A changed imported release contract must not inherit unchanged-runtime proof');
  const leafChanged=change('changed reviewed runtime leaf',write=>write(diagnostic,'export const safe=false;\n'));
  assert.deepEqual(leafChanged.reviewedToolingPatchFiles.sort(),[...authPackages].sort());
  assert.deepEqual(leafChanged.toolingOnlyWorkerPackageFiles,[],
    'Changed imported diagnostic bytes require runtime deployment');
  const unknown=change('unknown service import',write=>{
    write('workers/auth/src/index.js',entry+"import '../../../services/unreviewed.mjs';\n");
    write('services/unreviewed.mjs','export const value=true;\n');
  });
  assert.deepEqual(unknown.reviewedToolingPatchFiles,[],'An unknown external module cannot inherit the narrow diagnostic exception');
  for(const moduleName of ['sharp','@img/sharp-linux-x64','miniflare']) {
    const result=change(`tooling import in reviewed leaf ${moduleName}`,write=>write(diagnostic,`import value from '${moduleName}';export const safe=value;\n`));
    assert.deepEqual(result.reviewedToolingPatchFiles,[],`The external leaf must be scanned for ${moduleName}`);
  }
  const computed=change('computed external import',write=>write(diagnostic,"const target='./'+name;export const safe=import(target);\n"));
  assert.deepEqual(computed.reviewedToolingPatchFiles,[],'Computed module authority stays unproven');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}

const publication=git(['rev-parse','HEAD']);
const publicationPlan=createReleasePlanFromRepo(root,{base:source.base,head:publication});
assert.deepEqual(publicationPlan.consistencyIssues,[],'Publication must retain a coherent complete release contract');
assert.deepEqual(publicationPlan.impacts.uncategorizedFiles,[],'New continuation files must not conceal unknown release impact');
assert(backendContinuationSupported(publicationPlan),'The complete publication tree must admit the protected continuation');
assert.deepEqual(publicationPlan.workerDeploys.map(row=>row.worker),actualPlan.workerDeploys.map(row=>row.worker),
  'Deployment-only tooling must not add or remove selected Workers');
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_SHA:publication,CANDIDATE_BASE:source.base,CANDIDATE_RUN:source.run,CANDIDATE_ATTEMPT:source.attempt,
  CANVAS_AGENT_DEPLOY_SOURCE_SHA:source.sha,CANVAS_AGENT_DEPLOY_SOURCE_RUN:source.run,CANVAS_AGENT_DEPLOY_SOURCE_ATTEMPT:source.attempt};
assert.deepEqual(resolveCanvasAgentDeploySource(env),source);
assert.deepEqual(mediaEvidenceRun(env),{run:source.run,attempt:source.attempt,imageSha:source.sha},
  'Image evidence must keep the exact original accepted source and attempt');
assert.equal(mediaFixtureSha(env),undefined,'Local acceptance must never be presented as previous live smoke');
for(const changed of [{CANDIDATE_ATTEMPT:'2'},{CANVAS_AGENT_DEPLOY_SOURCE_SHA:publication},{REPAIR_SOURCE_SHA:source.sha}])
  assert.throws(()=>mediaEvidenceRun({...env,...changed}),'Mixed or changed source authority must fail closed');

const context={sha:publication,base:source.base,runId:'900000001',attempt:'1',acceptedSource:source};
assert.equal(backendReceiptContext(context,env),context,'First activation must not try to reuse a nonexistent old backend receipt');
const imageDigest=`registry.cloudflare.com/${'a'.repeat(32)}/bitbi-private-media@sha256:${'b'.repeat(64)}`;
const smoke=backend=>({backend,sha:publication,completedMs:1,outputs:Array.from({length:3},()=>({videoDigest:'c'.repeat(64),posterDigest:'d'.repeat(64)}))});
const receipt={sha:publication,base:source.base,run:context.runId,attempt:'1',worker:'bitbi-auth',migration:'0105_canvas_media_inspections.sql',version:'auth-version',deployment:'auth-deployment',
  acceptedSource:source,processorRef:publication,mediaSourceSha:publication,
  media:{sha:publication,imageSourceSha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,imageDigest,artifact:{id:source.media.id,digest:source.media.digest}},
  smoke:['cloudflare','github'].map(smoke)};
const activation={...context,version:{id:receipt.version,annotations:{'workers/message':`bitbi-auth:${publication}`}},
  deployment:{id:receipt.deployment,versions:[{version_id:receipt.version,percentage:100}]},migration:receipt.migration,processorSha:publication};
verifyBackendActivation(receipt,activation);
verifyMediaEvidence(receipt,{sha:publication,...mediaEvidenceRun(env)});
for(const mutate of [
  row=>{row.sha=source.sha;},row=>{row.run=source.run;},row=>{row.processorRef=source.sha;},
  row=>{row.acceptedSource={...row.acceptedSource,attempt:'2'};},row=>{row.mediaSourceSha=source.sha;},
  row=>{row.media.sha=source.sha;},row=>{row.media.imageSourceSha=publication;},
  row=>{row.media.sourceRun=context.runId;},row=>{row.media.sourceAttempt='2';},
  row=>{row.media.reusedActivation={};},row=>{row.smoke[0].fixtureSha=source.sha;},
  row=>{row.smoke[0].reusedOutputs=true;},row=>{row.smoke.pop();},
]) {
  const wrong=structuredClone(receipt);mutate(wrong);
  assert.throws(()=>verifyBackendActivation(wrong,activation),'Old, mixed or incomplete activation must not satisfy fresh deployment');
}
assert.throws(()=>verifyBackendActivation(receipt,{...activation,acceptedSource:undefined}),
  'Cross-source evidence requires the exact authenticated continuation context');
for(const mutate of [row=>{row.media.artifact.digest='invalid';},row=>{row.media.imageDigest='mutable:latest';},row=>{row.smoke[0].sha=source.sha;}]) {
  const wrong=structuredClone(receipt);mutate(wrong);
  assert.throws(()=>verifyMediaEvidence(wrong,{sha:publication,...mediaEvidenceRun(env)}));
}

const calls=[];
await advanceBackend({sha:publication,pending:['0105_canvas_media_inspections.sql'],
  activeVersion:{annotations:{'workers/message':`bitbi-auth:${source.sha}`}},
  assertCurrent:async()=>{},verifyConfiguration:async()=>{},applyMigration:async()=>calls.push('schema'),assertSchema:async()=>calls.push('schema-readback'),
  prepareAi:async()=>calls.push('ai'),prepareMedia:async()=>calls.push('media'),deploy:async()=>calls.push('auth'),
  readActive:async()=>({version:activation.version,deployment:activation.deployment}),verifyMedia:async()=>calls.push('fresh-live-media')});
assert.deepEqual(calls,['schema','schema-readback','ai','media','auth','fresh-live-media']);
let deploys=0,readbacks=0;
const expected=receipt.media;
await activateMedia(expected,{currentVersion:{annotations:{'workers/message':`bitbi-media:${source.sha}:${imageDigest}`}},deploy:async()=>{deploys++;},verify:async()=>{readbacks++;return expected;}});
assert.equal(deploys,1,'Accepted old image is not proof of new runtime activation');
await activateMedia(expected,{currentVersion:{annotations:{'workers/message':`bitbi-media:${publication}:${imageDigest}`}},deploy:async()=>{deploys++;},verify:async()=>{readbacks++;return expected;}});
assert.equal(deploys,1,'An exact partial activation must resume without redeploying it');assert.equal(readbacks,2);

const account='a'.repeat(32),deployment={id:'media-deployment',versions:[{version_id:'media-version',percentage:100}]};
const application={id:'application',account_id:account,durable_objects:{namespace_id:'namespace'},max_instances:1,configuration:{image:imageDigest},instances:0};
const version={id:'media-version',annotations:{'workers/message':`bitbi-media:${publication}:${imageDigest}`},resources:{bindings:[
  {name:'CLOUDFLARE_STREAM_API_TOKEN',type:'secret_text'},{name:'CLOUDFLARE_ACCOUNT_ID',text:account},
  {name:'MEDIA_CONTAINER',namespace_id:'namespace'},{name:'SOURCE_SHA',text:publication},
]}};
const read=async endpoint=>{
  if(endpoint==='workers/scripts/bitbi-private-media/deployments')return {deployments:[deployment]};
  if(endpoint==='workers/scripts/bitbi-private-media/versions/media-version')return version;
  if(endpoint==='containers/applications')return [application];
  if(endpoint==='containers/applications/application')return application;
  if(endpoint==='containers/applications/application/instances')return {instances:[]};
  throw Error(`Unexpected synthetic read: ${endpoint}`);
};
await mediaActive(expected,{CLOUDFLARE_ACCOUNT_ID:account},{read,requireSourceBinding:true});
version.resources.bindings.find(row=>row.name==='SOURCE_SHA').text=source.sha;
await assert.rejects(mediaActive(expected,{CLOUDFLARE_ACCOUNT_ID:account},{read,requireSourceBinding:true}),/source binding/,
  'A new annotation with an old runtime source binding must not pass readback');
console.log('Canvas deployment-only backend guards passed: actual accepted graph, closed tooling inputs, immutable original image, fresh activation, resume and source-binding controls.');
