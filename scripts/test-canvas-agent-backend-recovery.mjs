// New recovery-boundary controls only; no accepted suite, provider or remote call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {CANVAS_AGENT_RECOVERY_SOURCE as source,CANVAS_AGENT_DEPLOY_SOURCE as accepted} from './lib/canvas-agent-deploy-continuation.mjs';
import {CANVAS_RECOVERY_OWNER as owner,canvasRecoveryId,readCanvasRecoveryJobs,verifyCanvasRecoveryComponent,verifyCanvasRecoveryLifecycle,canvasRecoveryOutputIdentity,canvasRecoveryActor,readCanvasRecoveryActor} from './lib/canvas-agent-backend-recovery.mjs';
import {mediaSmoke,verifyMediaEvidence} from './lib/media-publication.mjs';
import {activateAuthVersion,verifyBackendActivation} from './lib/backend-publication.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const startedAt='2026-10-16T03:53:32Z',completedAt='2026-10-16T04:09:35Z',at='2026-10-16T03:58:00Z';
const evidence={source,logDigest:source.log.sha256,logBytes:source.log.bytes,job:{steps:[{name:'Apply verified candidate backend prerequisites',status:'completed',conclusion:'failure',started_at:startedAt,completed_at:completedAt}]}};
const groups=Object.fromEntries(['github','cloudflare'].map(backend=>{
  const project=canvasRecoveryId(`media-smoke:${source.sha}:${backend}`);
  return [backend,{project,rows:[project,...[0,1].map(index=>canvasRecoveryId(`${project}:asset:${index}`))].map((id,index)=>({
    id,user_id:owner,project_id:project,kind:index?'poster':'concat',status:backend==='github'?'queued':'ready',attempt_count:backend==='github'?0:1,
    processing_token:backend==='github'?null:'private-capability-not-for-logs',locked_until:null,created_at:at,updated_at:at,
    asset_id:backend==='github'&&!index?null:id,r2_key:backend==='github'&&!index?null:`users/${owner}/${id}.mp4`,poster_r2_key:backend==='github'?null:`users/${owner}/${id}.jpg`,
  })).sort((a,b)=>a.id.localeCompare(b.id))}];
}));
const project=groups.cloudflare.project;
const reference={id:canvasRecoveryId(`${project}:reference`),user_id:owner,status:'ready',attempt_count:1,created_at:at,updated_at:at,output_r2_key:`users/${owner}/reference.mp4`};
const preview={id:`hhvd_${canvasRecoveryId(`${project}:preview`)}`,source_user_id:owner,status:'succeeded',created_at:at,updated_at:at,file_r2_key:`users/${owner}/preview.mp4`,poster_r2_key:`users/${owner}/preview.jpg`};
const original={id:canvasRecoveryId(`${project}:preview-source`),user_id:owner,r2_key:`users/${owner}/original.mp4`,poster_r2_key:`users/${owner}/original.jpg`,created_at:at};
function queryFor(data={groups,reference,preview,original}) {
  return async(sql,params)=>{
    assert(sql.startsWith('SELECT '),'Recovery must not mutate D1');
    if(sql.includes('FROM users')){assert.deepEqual(params,[owner]);return [{id:owner,status:'disabled'}];}
    if(sql.includes('FROM canvas_video_processing')){assert.equal(params[0],owner);assert.equal(params[1],data.groups[params[2]].project);return structuredClone(data.groups[params[2]].rows);}
    if(sql.includes('FROM private_video_references')){assert.deepEqual(params,[reference.id,owner,'cloudflare']);return [structuredClone(data.reference)];}
    if(sql.includes('FROM homepage_hero_video_derivatives')){assert.deepEqual(params,[preview.id,owner,'cloudflare']);return [structuredClone(data.preview)];}
    assert(sql.includes('FROM ai_text_assets'));assert.deepEqual(params,[original.id,owner]);return [structuredClone(data.original)];
  };
}
const proof=await readCanvasRecoveryJobs(evidence,queryFor());
const serialized=JSON.stringify(proof);assert(!serialized.includes('private-capability-not-for-logs'));assert(!serialized.includes(`users/${owner}/`));
assert.equal(proof.records.groups.cloudflare.rows[0].processing_token,true);
for(const mutate of [
  data=>{data.groups.github.rows[0].attempt_count=1;},data=>{data.groups.github.rows[0].processing_token='accepted';},
  data=>{data.groups.github.rows[0].status='processing';},data=>{data.groups.cloudflare.rows[0].status='queued';},
  data=>{data.groups.cloudflare.rows[0].updated_at='2026-10-16T04:10:00Z';},data=>{data.groups.cloudflare.rows[0].user_id='other';},
  data=>{data.groups.cloudflare.rows.pop();},data=>{data.reference.status='failed';},data=>{data.preview.status='queued';},
  data=>{data.original.poster_r2_key=null;},
]) {const data=structuredClone({groups,reference,preview,original});mutate(data);await assert.rejects(()=>readCanvasRecoveryJobs(evidence,queryFor(data)));}
const completed=structuredClone({groups,reference,preview,original});
for(const row of completed.groups.github.rows)Object.assign(row,{status:'ready',attempt_count:1,processing_token:'new-accepted-claim',updated_at:'2026-10-16T05:00:00Z',asset_id:row.id,r2_key:`users/${owner}/${row.id}.mp4`,poster_r2_key:`users/${owner}/${row.id}.jpg`});
assert.deepEqual((await readCanvasRecoveryJobs(evidence,queryFor(completed),{completed:true})).records.groups.cloudflare,proof.records.groups.cloudflare,
  'Completed recovery must preserve the pre-fix queued snapshot instead of requiring jobs to become queued again');
await assert.rejects(()=>readCanvasRecoveryJobs(evidence,queryFor(completed)));
// Exercise the exact production SELECTs against the actual fully migrated
// SQLite schema, including ownership joins and retained ready-token semantics.
const {SqliteD1Database,applyAuthMigrations}=createRequire(import.meta.url)('../tests/helpers/sqlite-d1.js');
const db=new SqliteD1Database();
try {
  applyAuthMigrations(db);
  const insert=async(table,row)=>{const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();};
  await insert('users',{id:owner,email:'recovery@example.invalid',password_hash:'no-login',created_at:at,status:'disabled'});
  const asset=async row=>insert('ai_text_assets',{id:row.id,user_id:owner,r2_key:row.r2_key,title:'Recovery fixture',file_name:'fixture.mp4',source_module:'video',mime_type:'video/mp4',size_bytes:1,created_at:at,poster_r2_key:row.poster_r2_key});
  for(const [backend,group] of Object.entries(groups)) {
    await insert('canvas_projects',{id:group.project,user_id:owner,title:'Exact original smoke',created_at:at,updated_at:at});
    const node=canvasRecoveryId(`${group.project}:node`),run=canvasRecoveryId(`${group.project}:run`);
    await insert('canvas_nodes',{id:node,project_id:group.project,user_id:owner,type:'video_generation',x:0,y:0,created_at:at,updated_at:at});
    await insert('canvas_runs',{id:run,project_id:group.project,node_id:node,user_id:owner,model_id:'synthetic-no-provider',operation_type:'canvas.video.generate',status:'completed',idempotency_key:run,input_json:'{}',created_at:at,updated_at:at});
    for(const row of group.rows) {
      if(row.asset_id)await asset({id:row.asset_id,r2_key:row.r2_key,poster_r2_key:row.poster_r2_key});
      const {r2_key,poster_r2_key,...processing}=row;
      await insert('canvas_video_processing',{...processing,run_id:run,sources_json:'[]',next_attempt_at:at,processing_backend:backend,thumbnail_backend:backend});
    }
  }
  await asset(original);
  await insert('private_video_references',{...reference,source_asset_id:original.id,source_r2_key:original.r2_key,source_etag:'fixture-etag',source_bytes:1,source_metadata_json:'{}',processing_backend:'cloudflare',next_attempt_at:at});
  await insert('homepage_hero_video_derivatives',{...preview,slot:'left_top',source_type:'admin_asset',source_asset_id:original.id,provider:'external_ffmpeg',processing_backend:'cloudflare'});
  // Match Cloudflare's JSON result envelope, not node:sqlite null prototypes.
  const query=async(sql,params)=>JSON.parse(JSON.stringify((await db.prepare(sql).bind(...params).all()).results));
  assert.deepEqual(await readCanvasRecoveryJobs(evidence,query),proof);
  await db.prepare('UPDATE canvas_video_processing SET attempt_count=1 WHERE id=?').bind(groups.github.rows[0].id).run();
  await assert.rejects(()=>readCanvasRecoveryJobs(evidence,query),/GitHub work was accepted or changed/);
  await db.prepare('UPDATE canvas_video_processing SET attempt_count=0 WHERE id=?').bind(groups.github.rows[0].id).run();
  await db.prepare('UPDATE ai_text_assets SET poster_r2_key=NULL WHERE id=?').bind(original.id).run();
  await assert.rejects(()=>readCanvasRecoveryJobs(evidence,query),/source poster is missing/);
} finally {db.close();}
const media={sha:source.sha,application:'retained-container',namespace:'retained-namespace',assignedInstance:'a'.repeat(64),workerVersion:'retained-version',deployment:'retained-deployment',imageDigest:`registry.cloudflare.com/${'a'.repeat(32)}/bitbi-private-media@sha256:${'b'.repeat(64)}`};
const actor=canvasRecoveryActor(media,source);
const actorEnvelope={success:true,result:{instances:[{id:media.assignedInstance,name:'private-media-singleton',application_id:media.application,image:media.imageDigest,status:{state:'stopped',exit_code:0}}]},result_info:{}};
assert.deepEqual(await readCanvasRecoveryActor(media,source,async endpoint=>{assert.equal(endpoint,`containers/applications/${media.application}/instances`);return actorEnvelope;}),actor);
for(const mutate of [row=>{row.result_info.next_page_token='more';},row=>{row.result.instances.push({...row.result.instances[0]});},row=>{row.result.instances[0].id='different';},row=>{row.result.instances[0].name='another-actor';},row=>{row.result.instances[0].image='different';},row=>{row.result.instances[0].status.state='running';}]) {
  const wrong=structuredClone(actorEnvelope);mutate(wrong);await assert.rejects(()=>readCanvasRecoveryActor(media,source,async()=>wrong));
}
assert.throws(()=>canvasRecoveryActor({...media,assignedInstance:'11111111-1111-1111-1111-111111111111'},source),'Undocumented UUID cannot be treated as a stable Durable Object actor');
const stopped={state:'stopped',instance:media.assignedInstance,observedAt:'2026-10-16T05:00:00Z'};
const cycle={policy:'prior-protected-execution-v1',priorExecution:proof,actor,stoppedNow:stopped};verifyCanvasRecoveryLifecycle(cycle,proof);
for(const change of [{stoppedNow:{...stopped,state:'running'}},{stoppedNow:{...stopped,instance:'b'.repeat(64)}},{actor:undefined},{running:{state:'running'}},{priorExecution:{...proof,recordsDigest:'a'.repeat(64)}}])assert.throws(()=>verifyCanvasRecoveryLifecycle({...cycle,...change},proof));
const component={version:{id:'old-version',metadata:{created_on:at},annotations:{'workers/message':`bitbi-ai:${source.sha}`}},deployment:{id:'old-deployment',created_on:at,versions:[{version_id:'old-version',percentage:100}]}};
verifyCanvasRecoveryComponent(component,evidence,'ai');
for(const mutate of [row=>{row.deployment.versions[0].percentage=50;},row=>{row.version.metadata.created_on='2026-10-16T05:00:00Z';},row=>{row.version.annotations['workers/message']=`bitbi-ai:${accepted.sha}`;}]){
  const wrong=structuredClone(component);mutate(wrong);assert.throws(()=>verifyCanvasRecoveryComponent(wrong,evidence,'ai'));
}

// Exercise the actual status loop and command boundary. Decoding itself remains
// covered by the already accepted real media suite; these stand-ins prove that
// recovery does not submit any job or silently switch to a fresh fixture.
const fixture=fs.readFileSync('tests/fixtures/media/canvas-end-frame.mp4'),ref=fs.readFileSync('tests/fixtures/media/h3-overrun.mp4'),poster=Buffer.from('retained-poster');
const output=()=>({video:fixture.toString('base64'),poster:poster.toString('base64'),videoDigest:hash(fixture),posterDigest:hash(poster)});
const result=backend=>({ready:true,sha:source.sha,backend,outputs:[{...output(),...(backend==='cloudflare'?{previewBase:{video:fixture.toString('base64'),digest:hash(fixture)}}:{})},output(),output()],publicPreviews:[output(),output()],videoReference:{video:ref.toString('base64'),videoDigest:hash(ref),originalDigest:hash(ref),metadata:{frames:360,duration:15,audioDuration:15}}});
const requests=[],commands=[],observations=[];let clock=Date.parse(stopped.observedAt),githubReads=0,lastBackend;
const mediaCommand=(command,args)=>{
  assert.equal(lastBackend,'github','Previously passed Cloudflare decode must not run again');
  commands.push([command,args]);
  assert.equal(command,'ffprobe','Recovery may only decode the unfinished GitHub results');
  if(command==='ffprobe')return JSON.stringify({format:{duration:'15'},streams:[{codec_type:'video',width:16,height:16,nb_frames:360},...(args.at(-1).endsWith('clean-base.mp4')?[]:[{codec_type:'audio'}])]});
  assert.fail('Unexpected media command');
};
const context={sha:'d'.repeat(40),recoverySource:source,plan:{changedFiles:[]}};
const options={resumeProof:proof,now:()=>clock,pause:async ms=>{clock+=ms;},observeState:async(application,state)=>{observations.push([application,state]);return stopped;},mediaCommand,
  request:async(url,init)=>{
    assert.equal(url,'https://bitbi.ai/api/internal/homepage/hero-videos/private-media/smoke');
    const body=JSON.parse(init.body);lastBackend=body.backend;requests.push(body);assert.deepEqual(Object.keys(body).sort(),['action','backend','sha']);assert.equal(body.action,'result');assert.equal(body.sha,source.sha);
    const data=body.backend==='github'&&githubReads++===0?{ready:false,sha:source.sha,backend:'github'}:result(body.backend);
    return Response.json({ok:true,data});
  },record:()=>{}};
const smoke=await mediaSmoke(context,'synthetic-test-secret',media,options);
assert.equal(commands.length,11,'Only five GitHub video/poster pairs and its unfinished reference are decoded');
assert.equal(requests.length,3);assert(requests.every(row=>row.action==='result'));assert(observations.every(row=>row[1]==='stopped'));
assert.deepEqual(canvasRecoveryOutputIdentity(smoke.find(row=>row.backend==='cloudflare')),canvasRecoveryOutputIdentity(result('cloudflare')));
const wrong={...options,request:async(url,init)=>{const body=JSON.parse(init.body);return Response.json({ok:true,data:{ready:false,sha:source.sha,backend:body.backend}});}};
await assert.rejects(()=>mediaSmoke(context,'synthetic-test-secret',media,wrong),/Retained Cloudflare outputs are no longer ready/);
for(const mutate of [row=>{row.outputs[0].videoDigest='0'.repeat(64);},row=>{row.outputs[0].previewBase.digest='0'.repeat(64);},row=>{row.videoReference.metadata.duration=14;}]) {
  const bad=result('cloudflare');mutate(bad);
  const broken={...options,request:async(url,init)=>{const body=JSON.parse(init.body);return Response.json({ok:true,data:body.backend==='cloudflare'?bad:{ready:false,sha:source.sha,backend:'github'}});}};
  await assert.rejects(()=>mediaSmoke(context,'synthetic-test-secret',media,broken));
}
const identity={sha:source.sha,imageSourceSha:accepted.sha,sourceRun:accepted.run,sourceAttempt:accepted.attempt,
  imageDigest:`registry.cloudflare.com/${'a'.repeat(32)}/bitbi-private-media@sha256:${'b'.repeat(64)}`,artifact:{id:accepted.media.id,digest:accepted.media.digest},reusedActivation:{job:source.job}};
verifyMediaEvidence({media:identity,smoke},{sha:source.sha,run:accepted.run,attempt:accepted.attempt,imageSha:accepted.sha,lifecycle:true,recoveryProof:proof,publicPreviews:true,videoReferences:true,exportMusic:true,previewBase:true});
const relabeled=structuredClone(smoke);relabeled.find(row=>row.backend==='cloudflare').validation={mode:'current-decode'};
assert.throws(()=>verifyMediaEvidence({media:identity,smoke:relabeled},{sha:source.sha,run:accepted.run,attempt:accepted.attempt,imageSha:accepted.sha,recoveryProof:proof}));
assert.throws(()=>verifyMediaEvidence({media:identity,smoke},{sha:source.sha,run:accepted.run,attempt:accepted.attempt,imageSha:accepted.sha,lifecycle:true}),
  'Historical lifecycle provenance must never masquerade as fresh observations');
const calls=[];
await activateAuthVersion({sha:context.sha,mediaSourceSha:source.sha,secretFile:'synthetic-secret-file',assertCurrent:async()=>calls.push(['current']),
  command:args=>{calls.push(args);return args[1]==='upload'?'Worker Version ID: 11111111-1111-1111-1111-111111111111':'';}});
assert.equal(calls.filter(row=>row[0]==='versions'&&row[1]==='upload').length,1);assert.equal(calls.filter(row=>row[0]==='versions'&&row[1]==='deploy').length,1);
assert(calls[0].includes(`PRIVATE_MEDIA_SOURCE_SHA:${source.sha}`),'Only Auth source changes; existing processor jobs retain fa95');
const receipt={sha:context.sha,base:accepted.base,run:'900',attempt:'1',worker:'bitbi-auth',migration:'0105_canvas_media_inspections.sql',version:'new-auth',deployment:'new-auth-deployment',
  acceptedSource:accepted,recoverySource:source,processorRef:source.sha,mediaSourceSha:source.sha,ai:{sha:source.sha},media:identity,smoke,recovery:{origin:{},jobs:proof}};
const activation={sha:context.sha,base:accepted.base,runId:'900',attempt:'1',acceptedSource:accepted,recoverySource:source,processorSha:source.sha,migration:receipt.migration,
  version:{id:receipt.version,annotations:{'workers/message':`bitbi-auth:${context.sha}`}},deployment:{id:receipt.deployment,versions:[{version_id:receipt.version,percentage:100}]}};
verifyBackendActivation(receipt,activation);
for(const mutate of [row=>{row.ai.sha=context.sha;},row=>{row.mediaSourceSha=context.sha;},row=>{row.media.imageSourceSha=source.sha;},row=>{row.smoke[0].resumedExistingJobs=false;},row=>{row.smoke[0].referenceRecoveryRequested=true;}]){
  const wrong=structuredClone(receipt);mutate(wrong);assert.throws(()=>verifyBackendActivation(wrong,activation));
}
console.log('New Canvas backend recovery guards passed: original activation/source bounds, redacted pre-mutation evidence, result-only completion, retained lifecycle provenance, Auth-only publication.');
