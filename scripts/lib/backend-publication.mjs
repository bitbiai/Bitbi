import os from 'node:os';
import {captureImageDeliveryRecovery,verifyImageDeliveryRecovery,verifyImageDeliveryEvidence} from './image-delivery-acceptance.mjs';
import {createHash} from 'node:crypto';
import {publishMedia,mediaActive,mediaSmoke,assertMediaAuthConfig,verifyMediaEvidence} from './media-publication.mjs';
import {requiresPrivateMediaImage} from './ci-test-selection.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backendContinuationSupported} from './backend-continuation.mjs';
import {createReleasePlanFromRepo} from './release-plan.mjs';
import {mediaEvidenceRun} from './media-publication.mjs';
import {verifyUploadSource} from './frontend-source.mjs';
import {cloudflareRead} from './frontend-hosting.mjs';
import {api,collection,REPOSITORY} from '../pages-candidate.mjs';
import {repairDelta,repairKind,verifyRepairSource} from './media-repair-source.mjs';
const worker='bitbi-auth';
const backendEnv=()=>({...process.env,CLOUDFLARE_API_TOKEN:process.env.CF_BACKEND_DEPLOY_TOKEN||process.env.CLOUDFLARE_API_TOKEN});
const readBackend=endpoint=>cloudflareRead(endpoint,backendEnv());
// Do not emit Wrangler's binding table or arbitrary API response bodies.
// Preserve actionable, allowlisted diagnostics even when the command fails.
export function backendDiagnostic(error,args) {
  const text=[error.stdout,error.stderr].map(v=>String(v||'')).join('\n').replace(/\u001b\[[0-9;]*m/g,'');
  return {command:args.slice(0,args[0]==='versions'?2:1),exit:Number.isInteger(error.status)?error.status:null,
    signal:error.signal||null,code:/^[A-Z_]+$/.test(error.code||'')?error.code:null,
    apiCodes:[...new Set([...text.matchAll(/\[code:\s*(\d+)\]/g)].map(m=>Number(m[1])))],
    categories:['Routes','Custom domains','Cron schedules','Queue consumers','Other triggers'].filter(s=>text.includes(`${s}:`)),
    authenticationFailure:/Authentication error|Unable to authenticate|not authorized|permission denied/i.test(text),
    zoneNotFound:/Could not find zone/.test(text),partialTriggers:/only partially updated/.test(text),
    networkFailure:/fetch failed|ECONNRESET|ETIMEDOUT/.test(text)};
}
export function backendCommand(args,execute=execFileSync,record=d=>{
  fs.mkdirSync('test-results',{recursive:true});fs.appendFileSync('test-results/backend-diagnostics.jsonl',JSON.stringify(d)+'\n');
  console.error(JSON.stringify({backendCommandFailure:d}));
},workingDirectory='workers/auth') {
  try{return execute(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{cwd:workingDirectory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000});}
  catch(error){record(backendDiagnostic(error,args));throw Error(`Backend command failed (${error.status??'unavailable'}); ${args[0]}. See redacted backend diagnostics. No frontend continuation.`);}
}
const run=backendCommand;
export async function verifyAuthTriggers(config,read=readBackend) {
  const prefix=`workers/scripts/${worker}`;
  const routes=await read(`${prefix}/routes`);
  assert.deepEqual(routes.map(r=>r.pattern).sort(),config.routes.map(r=>r.pattern).sort(),'Auth routes differ from reviewed config');
  assert(routes.every(r=>r.script===worker),'Auth route targets another Worker');
  const schedules=await read(`${prefix}/schedules`);
  assert.deepEqual(schedules.schedules.map(s=>s.cron).sort(),[...config.triggers.crons].sort(),'Auth cron configuration incomplete');
  const subdomain=await read(`${prefix}/subdomain`);
  assert.equal(subdomain.enabled,false,'Unexpected Auth workers.dev exposure');assert.equal(subdomain.previews_enabled,false,'Unexpected Auth preview exposure');
  for(const expected of config.queues.consumers) {
    const matches=(await read(`queues?name=${encodeURIComponent(expected.queue)}`)).filter(q=>q.queue_name===expected.queue);
    assert.equal(matches.length,1,'Missing/ambiguous Auth queue');const queue=matches[0];
    assert.equal(queue.settings.delivery_paused,false,`Paused queue: ${expected.queue}`);
    assert.equal(queue.consumers.length,1,`Unexpected consumers: ${expected.queue}`);
    const consumer=queue.consumers[0];assert.equal(consumer.type,'worker');assert.equal(consumer.script,worker);
    for(const [key,value] of Object.entries({batch_size:expected.max_batch_size,max_retries:expected.max_retries,max_wait_time_ms:expected.max_batch_timeout*1000,retry_delay:expected.retry_delay??0}))assert.equal(consumer.settings[key],value,`Queue setting mismatch: ${expected.queue}/${key}`);
    assert.equal(consumer.settings.max_concurrency,expected.max_concurrency);assert.equal(consumer.dead_letter_queue,expected.dead_letter_queue);
  }
}
// Script-level privacy must be active before a version can accept signed URLs.
// Wrangler versions deploy also synchronizes this non-versioned configuration.
export async function ensurePrivateVideoLogging({read=readBackend,patch=async body=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/bitbi-auth/script-settings`,{method:'PATCH',headers:{Authorization:`Bearer ${backendEnv().CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert(response.ok,'Auth privacy settings update failed');assert((await response.json()).success,'Auth privacy settings rejected');
},verifyOnly=false}={}) {
  const endpoint='workers/scripts/bitbi-auth/script-settings';
  const settings=await read(endpoint);
  if(settings.observability?.logs?.invocation_logs!==false) {
    assert(!verifyOnly,'Private upload invocation logging remains enabled');
    assert(settings.observability?.logs,'Missing existing Auth logging settings');
    await patch({observability:{...settings.observability,logs:{...settings.observability.logs,invocation_logs:false}}});
  }
  const actual=await read(endpoint);
  assert.equal(actual.observability?.logs?.invocation_logs,false,'Private upload invocation logging remains enabled');
  const expected=structuredClone(settings);expected.observability.logs.invocation_logs=false;
  assert.deepEqual(actual,expected,'Unrelated Auth script settings changed');
}
export async function activateAuthVersion({sha,mediaSourceSha=sha,secretFile,assertCurrent,command=run}) {
  // Routes, crons and consumers are unchanged and independently checked. A
  // version publication must not rewrite them or require new zone-write rights.
  const output=command(['versions','upload','--keep-vars','--secrets-file',secretFile,'--var',`PRIVATE_MEDIA_SOURCE_SHA:${mediaSourceSha}`,'--message',`bitbi-auth:${sha}`]);
  const id=output.match(/Worker Version ID:\s*([a-f0-9-]{36})\b/)?.[1];assert(id,'Missing uploaded Auth version identity');
  await assertCurrent();command(['versions','deploy',`${id}@100%`,'--yes','--message',`bitbi-auth:${sha}`]);return id;
}
export async function verifyAuthBundle(digest,read=()=>fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${script}/content/v2`,{headers:{Authorization:`Bearer ${backendEnv().CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(20000)}),script=worker) {
  assert(/^[a-f0-9]{64}$/.test(digest||''),'Missing Auth bundle identity');
  const response=await read();assert(response.ok,`Auth bundle read failed (${response.status})`);
  const modules=await response.formData();assert.deepEqual([...modules.keys()],['index.js'],'Unexpected Auth modules');
  const module=modules.get('index.js');assert(module&&typeof module!=='string'&&module.size<=10*1024*1024,'Invalid Auth module');
  assert.equal(createHash('sha256').update(Buffer.from(await module.arrayBuffer())).digest('hex'),digest,'Active Auth bytes differ from candidate build');
}
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
async function imageDeliveryObject(key) {
  assert(/^users\/[a-zA-Z0-9-]+\//.test(key)&&!key.includes('..'),'Unsafe recovered image key');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/bitbi-user-images/objects/${key.split('/').map(encodeURIComponent).join('/')}`,{headers:{Authorization:`Bearer ${backendEnv().CLOUDFLARE_API_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(30000)});
  assert(response.ok,`Recovered image verification: R2 read failed (${response.status})`);
  const {readImage25Bytes}=await import('../../workers/shared/gpt-image-25.mjs');
  return Buffer.from(await readImage25Bytes(response,32*1024*1024));
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
  for(const p of plan.manualPrerequisites.required.filter(p=>p.worker==='auth')) assert(bindings.some(b=>b.name===(p.name||p.binding)),`Missing active prerequisite ${p.id}`);
  for(const name of ['MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET','GITHUB_ACTIONS_DISPATCH_TOKEN'])assert(bindings.some(b=>b.name===name&&b.type==='secret_text'),`Missing processor credential ${name}`);
  if(settings)for(const [key,value] of Object.entries(config.vars).filter(([k])=>k.startsWith('GITHUB_ACTIONS_DISPATCH_')||k==='ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH'))assert(bindings.some(b=>b.name===key&&b.text===value),`Processor setting mismatch ${key}`);
}
export async function verifyAiActivation(receipt,sha,read=readBackend) {
  assert.equal(receipt.sha,sha,'Wrong AI source');
  const deployment=(await read('workers/scripts/bitbi-ai/deployments')).deployments[0];
  assert.equal(deployment.id,receipt.deployment,'AI activation changed');
  assert.deepEqual(deployment.versions,[{version_id:receipt.version,percentage:100}],'AI not fully active');
  const version=await read(`workers/scripts/bitbi-ai/versions/${receipt.version}`);
  assert.equal(version.annotations?.['workers/message'],`bitbi-ai:${sha}`,'Wrong AI version');
  for(const [name,type] of [['AI','ai'],['SERVICE_AUTH_REPLAY','durable_object_namespace'],['AI_SERVICE_AUTH_SECRET','secret_text']])assert(version.resources.bindings.some(b=>b.name===name&&b.type===type),`Missing AI binding ${name}`);
  assert(version.resources.bindings.some(b=>b.name==='ENABLE_GROK_4_6'&&b.text==='true'),'Grok is disabled');
}
async function publishAi(c,directory) {
  // Existing service, bindings and triggers only; no AI inference during upload.
  assert.equal(execFileSync('git',['show',`${c.base}:workers/ai/wrangler.jsonc`],{encoding:'utf8'}),fs.readFileSync('workers/ai/wrangler.jsonc','utf8'),'AI configuration changes need a separate release review');
  const command=args=>backendCommand(args,execFileSync,undefined,'workers/ai');
  command(['versions','upload','--dry-run','--keep-vars','--outdir',directory]);
  const digest=createHash('sha256').update(fs.readFileSync(path.join(directory,'index.js'))).digest('hex');
  let deployment=(await readBackend('workers/scripts/bitbi-ai/deployments')).deployments[0];
  assert(deployment.versions.length===1&&deployment.versions[0].percentage===100,'Ambiguous AI traffic');
  const before=await readBackend(`workers/scripts/bitbi-ai/versions/${deployment.versions[0].version_id}`);
  const probe={sha:c.sha,version:before.id,deployment:deployment.id};
  // Verify current required bindings before any mutation (annotation is checked after activation).
  for(const name of ['AI','SERVICE_AUTH_REPLAY','AI_SERVICE_AUTH_SECRET'])assert(before.resources.bindings.some(b=>b.name===name),`Missing AI prerequisite ${name}`);
  assert(before.resources.bindings.some(b=>b.name==='ENABLE_GROK_4_6'&&b.text==='true'),'Existing Grok activation required');
  if(before.annotations?.['workers/message']!==`bitbi-ai:${c.sha}`) {
    await current(c.sha);
    const output=command(['versions','upload','--keep-vars','--message',`bitbi-ai:${c.sha}`]);
    const id=output.match(/Worker Version ID:\s*([a-f0-9-]{36})\b/)?.[1];assert(id,'Missing uploaded AI version');
    await current(c.sha);command(['versions','deploy',`${id}@100%`,'--yes','--message',`bitbi-ai:${c.sha}`]);
    deployment=(await readBackend('workers/scripts/bitbi-ai/deployments')).deployments[0];
    probe.version=id;probe.deployment=deployment.id;
  }
  const receipt={...probe,bundleDigest:digest};
  await verifyAiActivation(receipt,c.sha);await verifyAuthBundle(digest,undefined,'bitbi-ai');return receipt;
}
// A tooling repair preserves the independently recorded backend identity. The
// authenticated Actions archive, not a mutable local receipt, authorizes reuse.
export function backendReceiptContext(c,env=process.env) {
  if(!env.REPAIR_SOURCE_SHA)return c;
  const files=repairDelta(env.REPAIR_SOURCE_SHA,c.sha,c.base);
  if(repairKind(files)!=='tooling')return c;
  return {...c,publicationSha:c.sha,sha:env.REPAIR_SOURCE_SHA,runId:env.REPAIR_SOURCE_RUN,attempt:env.REPAIR_SOURCE_ATTEMPT};
}
export async function readToolingBackendReceipt(c,env=process.env,{list=collection,download=fetch,verify=verifyRepairSource}={}) {
  assert(c.publicationSha,'Not a tooling receipt continuation');
  await verify(env,{complete:true});
  const jobs=await list(`actions/runs/${c.runId}/attempts/${c.attempt}/jobs`,'jobs');
  const deploys=jobs.filter(j=>j.name==='deploy');assert.equal(deploys.length,1,'Missing/ambiguous source backend publication');
  const job=deploys[0];assert.equal(job.head_sha,c.sha);assert.equal(String(job.run_id),c.runId);assert.equal(String(job.run_attempt),c.attempt);assert.equal(job.status,'completed');
  for(const name of ['Apply verified candidate backend prerequisites','Preserve backend activation evidence'])assert(job.steps.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'),`Missing backend receipt evidence: ${name}`);
  const artifacts=(await list(`actions/runs/${c.runId}/artifacts`,'artifacts')).filter(a=>a.name===`backend-receipt-${c.sha}-${c.runId}-${c.attempt}`);
  assert.equal(artifacts.length,1,'Missing/ambiguous source backend receipt');const artifact=artifacts[0];
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now(),'Expired backend receipt');
  assert.equal(String(artifact.workflow_run?.id),c.runId);assert.equal(artifact.workflow_run?.head_sha,c.sha);
  assert(/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''),'Missing backend archive digest');assert(artifact.size_in_bytes>0&&artifact.size_in_bytes<=65536,'Oversized backend receipt');
  const response=await download(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Cannot download backend receipt');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length,artifact.size_in_bytes);assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`,artifact.digest,'Backend receipt archive digest mismatch');
  const json=execFileSync('python3',['-I','-c',`import sys,io,zipfile,stat
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 entries=z.infolist();assert len(entries)==1
 e=entries[0];assert e.filename=='backend-release.json' and e.file_size<=65536
 assert stat.S_IFMT((e.external_attr>>16)&0xffff) in (0,stat.S_IFREG)
 sys.stdout.buffer.write(z.read(e))
`],{input:bytes,timeout:10000,maxBuffer:65536});
  const receipt=JSON.parse(json);
  for(const [key,value] of Object.entries({sha:c.sha,base:c.base,run:c.runId,attempt:c.attempt,worker,processorRef:c.sha}))assert.equal(receipt[key],value,`Wrong source backend ${key}`);
  assert.equal(receipt.sourceTree,execFileSync('git',['rev-parse',`${c.sha}:workers/auth`],{encoding:'utf8'}).trim(),'Wrong source Auth tree');
  return receipt;
}
function storeBackendReceipt(receipt) {
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/backend-release.json',JSON.stringify(receipt,null,2)+'\n');
  if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`BACKEND_RELEASE_RECEIPT=${path.resolve('test-results/backend-release.json')}\n`);
}
export async function verifyBackendReceipt(file=process.env.BACKEND_RELEASE_RECEIPT) {
  const publication=context();await current(publication.sha);const c=backendReceiptContext(publication);
  const receipt=JSON.parse(fs.readFileSync(file));
  if(c.publicationSha)assert.deepEqual(receipt,await readToolingBackendReceipt(c),'Local backend receipt differs from authenticated source');
  const state=await active();
  const migration=JSON.parse(fs.readFileSync('config/release-compat.json')).release.schemaCheckpoints.auth.latest;
  assert((await query(c.db,'SELECT name FROM d1_migrations WHERE name=?',[migration])).length===1,'Required schema not active');
  prerequisites(c.plan,state.version,c.config);
  if(c.plan.changedFiles.includes('workers/auth/src/lib/image-delivery-recovery.js'))verifyImageDeliveryEvidence(receipt.imageDelivery);
  await verifyAuthTriggers(c.config);
  await ensurePrivateVideoLogging({verifyOnly:true});
  await verifyAuthBundle(receipt.authBundleDigest);
  if(c.plan.workerDeploys.some(s=>s.worker==='ai')) {assert(receipt.ai,'Missing AI prerequisite receipt');await verifyAiActivation(receipt.ai,c.sha);await verifyAuthBundle(receipt.ai.bundleDigest,undefined,'bitbi-ai');}
  if(requiresPrivateMediaImage(c.plan.changedFiles)) {
    verifyMediaEvidence(receipt,{sha:c.sha,...mediaEvidenceRun(),lifecycle:true,publicPreviews:c.plan.changedFiles.includes('workers/auth/migrations/0091_separate_thumbnail_processing.sql'),videoReferences:true});
    await mediaActive(receipt.media,backendEnv());
    if(c.plan.changedFiles.includes('workers/auth/migrations/0091_separate_thumbnail_processing.sql')) {
      const activation=receipt.smoke.find(s=>s.backend==='cloudflare')?.thumbnailActivation;
      assert.equal(activation?.sha,c.sha,'Missing thumbnail rollout evidence');
      assert.equal(activation?.thumbnailBackend,'cloudflare');assert.equal(activation?.verified,true);
      const rows=await query(c.db,"SELECT value_json FROM app_settings WHERE key='private_media_service'",[]);
      assert.equal(JSON.parse(rows[0]?.value_json||'{}').thumbnailBackend,'cloudflare','Thumbnail default is not active');
    }
  }
  for(const [name,value] of [['PRIVATE_MEDIA_SOURCE_SHA',receipt.mediaSourceSha||c.sha]])assert(state.version.resources.bindings.some(b=>b.name===name&&b.text===value),'Wrong active media source');
  assert(state.version.resources.bindings.some(b=>b.name==='PRIVATE_MEDIA_PROCESSOR'&&b.service==='bitbi-private-media'),'Missing media service binding');
  assert(state.version.resources.bindings.some(b=>b.name==='PRIVATE_MEDIA_PROCESSOR_SECRET'&&b.type==='secret_text'),'Missing private processor credential');
  const processor=await api(`contents/services/homepage-ffmpeg-processor/processor.mjs?ref=${c.sha}`);assert.equal(processor.sha,execFileSync('git',['rev-parse',`${c.sha}:services/homepage-ffmpeg-processor/processor.mjs`],{encoding:'utf8'}).trim());
  verifyBackendActivation(receipt,{...c,...state,migration,processorSha:c.sha});
  // Ephemeral caller binding only; the authenticated stored receipt is intact.
  return c.publicationSha?{...receipt,publicationSha:c.publicationSha}:receipt;
}
export async function advanceBackend({sha,pending,activeVersion,assertCurrent,applyMigration,assertSchema,deploy,readActive,prepareMedia,prepareAi,verifyMedia,verifyConfiguration}) {
  await assertCurrent();
  if(verifyConfiguration)await verifyConfiguration();
  if(pending.length)await applyMigration();
  await assertSchema();await assertCurrent();
  if(prepareAi){await prepareAi();await assertCurrent();}
  if(prepareMedia){await prepareMedia();await assertCurrent();}
  if(activeVersion.annotations?.['workers/message']!==`bitbi-auth:${sha}`)await deploy();
  const state=await readActive();if(verifyConfiguration)await verifyConfiguration();if(verifyMedia)await verifyMedia();return state;
}

export async function publishBackend() {
  fs.mkdirSync('test-results',{recursive:true});fs.rmSync('test-results/backend-diagnostics.jsonl',{force:true});
  const c=context();await verifyUploadSource();await current(c.sha);
  const original=backendReceiptContext(c);
  if(original.publicationSha) {
    const receipt=await readToolingBackendReceipt(original);storeBackendReceipt(receipt);
    await verifyBackendReceipt('test-results/backend-release.json');console.log(JSON.stringify({reusedBackend:receipt}));return;
  }
  const mediaRequired=requiresPrivateMediaImage(c.plan.changedFiles);
  const beforeConfig=JSON.parse(execFileSync('git',['show',`${c.base}:workers/auth/wrangler.jsonc`],{encoding:'utf8'}));
  assertMediaAuthConfig(beforeConfig,c.config);
  assert(process.env.CLOUDFLARE_API_TOKEN,'Missing protected backend deployment credential');
  assert(process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET,'Missing existing processor credential');
  if(mediaRequired)await readBackend('containers/applications');

  const before=await active();prerequisites(c.plan,before.version,c.config,false);
  const imageTargets=c.plan.changedFiles.includes('workers/auth/src/lib/image-delivery-recovery.js')?await captureImageDeliveryRecovery((sql,params)=>query(c.db,sql,params),imageDeliveryObject):[];
  await ensurePrivateVideoLogging();
  const migration=JSON.parse(fs.readFileSync('config/release-compat.json')).release.schemaCheckpoints.auth.latest;
  const applied=new Set((await query(c.db,'SELECT name FROM d1_migrations')).map(r=>r.name));
  const pending=fs.readdirSync('workers/auth/migrations').filter(f=>f.endsWith('.sql')&&!applied.has(f));
  // This authority covers the reviewed additive Canvas migration only. Future
  // schema changes need their own reviewed release support.
  assert(pending.every(f=>['0088_add_canvas_video_processing.sql','0089_add_private_media_services.sql','0090_add_canvas_private_outputs.sql','0091_separate_thumbnail_processing.sql','0092_pin_video_source_inputs.sql','0093_add_private_video_references.sql','0094_model_pricing.sql','0095_retained_image_delivery.sql'].includes(f)),'Unexpected pending migrations');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-backend-secret-'));
  const mediaSourceSha=mediaRequired?c.sha:before.version.resources.bindings.find(b=>b.name==='PRIVATE_MEDIA_SOURCE_SHA')?.text;
  assert(/^[a-f0-9]{40}$/.test(mediaSourceSha||''),'Missing existing media source identity');
  let state,media,smoke,ai;
  try {
    const secret=createHash('sha256').update(`bitbi-private-media-v1:${process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET}`).digest('hex');
    const secretFile=path.join(temporary,'secrets.json');fs.writeFileSync(secretFile,JSON.stringify({PRIVATE_MEDIA_PROCESSOR_SECRET:secret}),{mode:0o600});
    const mediaSecretFile=path.join(temporary,'media-secrets.json');
    if(mediaRequired){
      assert(process.env.CLOUDFLARE_STREAM_API_TOKEN,'Missing existing Stream processor credential');
      fs.writeFileSync(mediaSecretFile,JSON.stringify({PRIVATE_MEDIA_PROCESSOR_SECRET:secret,CLOUDFLARE_STREAM_API_TOKEN:process.env.CLOUDFLARE_STREAM_API_TOKEN}),{mode:0o600});
    }
    const bundleDirectory=path.join(temporary,'auth-bundle');
    run(['versions','upload','--dry-run','--keep-vars','--outdir',bundleDirectory]);
    c.authBundleDigest=createHash('sha256').update(fs.readFileSync(path.join(bundleDirectory,'index.js'))).digest('hex');
    state=await advanceBackend({sha:c.sha,pending,activeVersion:before.version,
      assertCurrent:()=>current(c.sha),
      verifyConfiguration:async()=>{await verifyAuthTriggers(c.config);if(before.version.annotations?.['workers/message']===`bitbi-auth:${c.sha}`)await verifyAuthBundle(c.authBundleDigest);},
      applyMigration:()=>run(['d1','migrations','apply','bitbi-auth-db','--remote']),
      assertSchema:async()=>assert((await query(c.db,'SELECT name FROM d1_migrations WHERE name=?',[migration])).length===1,'Migration did not apply'),
      prepareAi:c.plan.workerDeploys.some(s=>s.worker==='ai')?async()=>{ai=await publishAi(c,path.join(temporary,'ai-bundle'));}:undefined,
      prepareMedia:mediaRequired?async()=>{media=await publishMedia(c,mediaSecretFile);}:undefined,
      deploy:()=>activateAuthVersion({sha:c.sha,mediaSourceSha,secretFile,assertCurrent:()=>current(c.sha)}),
      readActive:async()=>{const result=await active();await verifyAuthBundle(c.authBundleDigest);return result;},
      verifyMedia:mediaRequired?async()=>{smoke=await mediaSmoke(c,secret,media);}:undefined,
    });
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
  prerequisites(c.plan,state.version,c.config);
  const imageDelivery=c.plan.changedFiles.includes('workers/auth/src/lib/image-delivery-recovery.js')?await verifyImageDeliveryRecovery(imageTargets,{query:(sql,params)=>query(c.db,sql,params),object:imageDeliveryObject,current:()=>current(c.sha)}):undefined;
  const receipt={sha:c.sha,base:c.base,run:c.runId,attempt:c.attempt,worker,migration,version:state.version.id,deployment:state.deployment.id,
    ...(media?{media,smoke}:{}),...(ai?{ai}:{}),...(c.plan.changedFiles.includes('workers/auth/src/lib/image-delivery-recovery.js')?{imageDelivery}:{}),mediaSourceSha,authBundleDigest:c.authBundleDigest,processorRef:c.sha,sourceTree:execFileSync('git',['rev-parse',`${c.sha}:workers/auth`],{encoding:'utf8'}).trim()};
  verifyBackendActivation(receipt,{...c,...state,migration,processorSha:c.sha});
  storeBackendReceipt(receipt);
  await verifyBackendReceipt('test-results/backend-release.json');
  console.log(JSON.stringify(receipt));
}
