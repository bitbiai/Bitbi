import os from 'node:os';
import {createHash} from 'node:crypto';
import {publishMedia,mediaActive,mediaSmoke,assertMediaAuthConfig,verifyMediaEvidence} from './media-publication.mjs';
import {requiresPrivateMediaImage} from './ci-test-selection.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backendContinuationSupported} from './backend-continuation.mjs';
import {createReleasePlanFromRepo} from './release-plan.mjs';
import {verifyUploadSource} from './frontend-source.mjs';
import {cloudflareRead} from './frontend-hosting.mjs';
import {api} from '../pages-candidate.mjs';
const worker='bitbi-auth';
const backendEnv=()=>({...process.env,CLOUDFLARE_API_TOKEN:process.env.CF_BACKEND_DEPLOY_TOKEN||process.env.CLOUDFLARE_API_TOKEN});
const readBackend=endpoint=>cloudflareRead(endpoint,backendEnv());
const run=(args)=>{try{return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{cwd:'workers/auth',env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000});}catch(error){throw new Error(`Backend command failed (${error.status??'unavailable'}); ${args[0]}. No frontend continuation.`);}};
export function verifyBackendActivation(receipt,{sha,base,runId,attempt,version,deployment,migration,processorSha}) {
  assert.equal(receipt.sha,sha);assert.equal(receipt.base,base);assert.equal(receipt.run,runId);assert.equal(receipt.attempt,attempt);
  assert.equal(receipt.worker,worker);assert.equal(receipt.migration,migration);assert.equal(processorSha,sha);
  assert.equal(version.id,receipt.version);assert.equal(version.annotations?.['workers/message'],`bitbi-auth:${sha}`);
  assert.equal(deployment.id,receipt.deployment);assert.deepEqual(deployment.versions,[{version_id:receipt.version,percentage:100}]);
}
async function query(db,sql,params=[]) {
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${db}/query`,{method:'POST',headers:{Authorization:`Bearer ${backendEnv().CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(20000)});
  assert(r.ok,`Backend D1 access denied/unavailable (${r.status}); existing credential needs D1 access. No automatic permission expansion.`);
  const b=await r.json();assert(b.success&&b.result?.[0]?.success,'Backend D1 verification failed');return b.result[0].results;
}
function context() {
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_JOB,'deploy');assert.equal(process.env.GITHUB_REF,'refs/heads/main');
  assert.equal(process.env.GITHUB_REPOSITORY,'bitbiai/Bitbi');
  const sha=process.env.GITHUB_SHA,base=process.env.CANDIDATE_BASE;
  assert(/^[a-f0-9]{40}$/.test(sha||'')&&/^[a-f0-9]{40}$/.test(base||''));
  const plan=createReleasePlanFromRepo(process.cwd(),{base,head:sha});assert(backendContinuationSupported(plan),'Backend continuation not supported for this plan');
  const config=JSON.parse(fs.readFileSync('workers/auth/wrangler.jsonc'));
  return {sha,base,plan,config,db:config.d1_databases.find(b=>b.binding==='DB').database_id,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
}
async function current(sha) {assert.equal((await api('git/ref/heads/main')).object.sha,sha,'Superseded backend candidate');}
async function active() {
  const deployment=(await readBackend(`workers/scripts/${worker}/deployments`)).deployments[0];
  assert(deployment?.versions?.length===1&&deployment.versions[0].percentage===100,'Ambiguous Auth traffic');
  return {deployment,version:await readBackend(`workers/scripts/${worker}/versions/${deployment.versions[0].version_id}`)};
}
function prerequisites(plan,version,config,settings=true) {
  const bindings=version.resources?.bindings||[];
  for(const p of plan.manualPrerequisites.required) assert(bindings.some(b=>b.name===(p.name||p.binding)),`Missing active prerequisite ${p.id}`);
  for(const name of ['MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET','GITHUB_ACTIONS_DISPATCH_TOKEN'])assert(bindings.some(b=>b.name===name&&b.type==='secret_text'),`Missing processor credential ${name}`);
  if(settings)for(const [key,value] of Object.entries(config.vars).filter(([k])=>k.startsWith('GITHUB_ACTIONS_DISPATCH_')||k==='ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH'))assert(bindings.some(b=>b.name===key&&b.text===value),`Processor setting mismatch ${key}`);
}
export async function verifyBackendReceipt(file=process.env.BACKEND_RELEASE_RECEIPT) {
  const c=context();await current(c.sha);
  const receipt=JSON.parse(fs.readFileSync(file));const state=await active();
  const migration=JSON.parse(fs.readFileSync('config/release-compat.json')).release.schemaCheckpoints.auth.latest;
  assert((await query(c.db,'SELECT name FROM d1_migrations WHERE name=?',[migration])).length===1,'Required schema not active');
  prerequisites(c.plan,state.version,c.config);
  if(requiresPrivateMediaImage(c.plan.changedFiles)) {
    verifyMediaEvidence(receipt,{sha:c.sha,run:process.env.CANDIDATE_RUN,attempt:process.env.CANDIDATE_ATTEMPT});
    await mediaActive(receipt.media,backendEnv());
  }
  for(const [name,value] of [['PRIVATE_MEDIA_SOURCE_SHA',c.sha]])assert(state.version.resources.bindings.some(b=>b.name===name&&b.text===value),'Wrong active media source');
  assert(state.version.resources.bindings.some(b=>b.name==='PRIVATE_MEDIA_PROCESSOR'&&b.service==='bitbi-private-media'),'Missing media service binding');
  assert(state.version.resources.bindings.some(b=>b.name==='PRIVATE_MEDIA_PROCESSOR_SECRET'&&b.type==='secret_text'),'Missing private processor credential');
  const processor=await api(`contents/services/homepage-ffmpeg-processor/processor.mjs?ref=${c.sha}`);assert.equal(processor.sha,execFileSync('git',['rev-parse',`${c.sha}:services/homepage-ffmpeg-processor/processor.mjs`],{encoding:'utf8'}).trim());
  verifyBackendActivation(receipt,{...c,...state,migration,processorSha:c.sha});return receipt;
}
export async function advanceBackend({sha,pending,activeVersion,assertCurrent,applyMigration,assertSchema,deploy,readActive,prepareMedia,verifyMedia}) {
  await assertCurrent();
  if(pending.length)await applyMigration();
  await assertSchema();await assertCurrent();
  if(prepareMedia){await prepareMedia();await assertCurrent();}
  if(activeVersion.annotations?.['workers/message']!==`bitbi-auth:${sha}`)await deploy();
  const state=await readActive();if(verifyMedia)await verifyMedia();return state;
}

export async function publishBackend() {
  const c=context();await verifyUploadSource();await current(c.sha);
  const mediaRequired=requiresPrivateMediaImage(c.plan.changedFiles);
  const beforeConfig=JSON.parse(execFileSync('git',['show',`${c.base}:workers/auth/wrangler.jsonc`],{encoding:'utf8'}));
  assertMediaAuthConfig(beforeConfig,c.config);
  assert(process.env.CLOUDFLARE_API_TOKEN,'Missing protected backend deployment credential');
  assert(process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET,'Missing existing processor credential');
  if(mediaRequired)await readBackend('containers/applications');

  const before=await active();prerequisites(c.plan,before.version,c.config,false);
  const migration=JSON.parse(fs.readFileSync('config/release-compat.json')).release.schemaCheckpoints.auth.latest;
  const applied=new Set((await query(c.db,'SELECT name FROM d1_migrations')).map(r=>r.name));
  const pending=fs.readdirSync('workers/auth/migrations').filter(f=>f.endsWith('.sql')&&!applied.has(f));
  // This authority covers the reviewed additive Canvas migration only. Future
  // schema changes need their own reviewed release support.
  assert(pending.every(f=>['0088_add_canvas_video_processing.sql','0089_add_private_media_services.sql'].includes(f)),'Unexpected pending migrations');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-backend-secret-'));
  let state,media,smoke;
  try {
    const secret=createHash('sha256').update(`bitbi-private-media-v1:${process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET}`).digest('hex');
    const secretFile=path.join(temporary,'secrets.json');fs.writeFileSync(secretFile,JSON.stringify({PRIVATE_MEDIA_PROCESSOR_SECRET:secret}),{mode:0o600});
    state=await advanceBackend({sha:c.sha,pending,activeVersion:before.version,
      assertCurrent:()=>current(c.sha),
      applyMigration:()=>run(['d1','migrations','apply','bitbi-auth-db','--remote']),
      assertSchema:async()=>assert((await query(c.db,'SELECT name FROM d1_migrations WHERE name=?',[migration])).length===1,'Migration did not apply'),
      prepareMedia:mediaRequired?async()=>{media=await publishMedia(c,secretFile);}:undefined,
      deploy:()=>run(['deploy','--secrets-file',secretFile,'--var',`PRIVATE_MEDIA_SOURCE_SHA:${c.sha}`,'--message',`bitbi-auth:${c.sha}`]),
      readActive:active,
      verifyMedia:mediaRequired?async()=>{smoke=await mediaSmoke(c,secret);}:undefined,
    });
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
  prerequisites(c.plan,state.version,c.config);
  const receipt={sha:c.sha,base:c.base,run:c.runId,attempt:c.attempt,worker,migration,version:state.version.id,deployment:state.deployment.id,
    ...(media?{media,smoke}:{}),processorRef:c.sha,sourceTree:execFileSync('git',['rev-parse',`${c.sha}:workers/auth`],{encoding:'utf8'}).trim()};
  verifyBackendActivation(receipt,{...c,...state,migration,processorSha:c.sha});
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/backend-release.json',JSON.stringify(receipt,null,2)+'\n');
  await verifyBackendReceipt('test-results/backend-release.json');
  console.log(JSON.stringify(receipt));
  if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`BACKEND_RELEASE_RECEIPT=${path.resolve('test-results/backend-release.json')}\n`);
}
