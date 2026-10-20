// Changed release guards only. No remote request, deployment, inference or job start.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {COMPLETED_MEDIA_SOURCE as source,COMPLETED_MEDIA_FILES,assertCompletedMediaDelta,resolveCompletedMediaSource,
  assertCompletedMediaAcceptance,assertCompletedMediaArtifact,completedMediaDeferredPush,readCompletedMediaJobs,verifyCompletedMediaJobs,
  completedMediaLifecycle,verifyCompletedMediaLifecycle} from './lib/completed-media-continuation.mjs';
import {canvasRecoveryId,verifyCanvasRecoveryLifecycle} from './lib/canvas-agent-backend-recovery.mjs';
import {mediaSmoke,verifyMediaEvidence} from './lib/media-publication.mjs';
import {backendReceiptContext,verifiedRead} from './lib/backend-publication.mjs';
import {repairKind} from './lib/media-repair-source.mjs';
// Evaluate the changed real workflow conditions, including the double-download
// countercase: source verification must create the candidate only once.
const workflow=fs.readFileSync('.github/workflows/static.yml','utf8');
const step=name=>workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
const condition=name=>step(name)?.match(/^        if: (.+)$/m)?.[1];
for(const repair of ['',source.sha])for(const success of [true,false]) {
  const context={success:()=>success,needs:{'reuse-candidate':{result:'success'}},env:{REPAIR_SOURCE_SHA:repair}};
  const download=vm.runInNewContext(condition('Download selected completed candidate').replace('needs.reuse-candidate',"needs['reuse-candidate']"),context);
  const restore=success&&vm.runInNewContext(condition('Restore unchanged verified frontend package'),context);
  assert.equal(download,success&&!repair);assert.equal(restore,success&&Boolean(repair));assert(!(download&&restore));
}
assert(step('Verify completed media continuation guards').includes('run: node scripts/test-completed-media-continuation.mjs'));
assert(workflow.indexOf('name: Verify completed media continuation guards')<workflow.indexOf('name: Verify exact completed source acceptance'));
assert(workflow.includes('needs.reuse-candidate.outputs.repair_source_sha || needs.release-compatibility.outputs.repair_source_sha'));
const publication=fs.readFileSync('scripts/lib/backend-publication.mjs','utf8');
assert(publication.includes('waitMediaState(application,state,{read:readBackend})'),'Container lifecycle reads must reach bounded transient read handling');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),head='d'.repeat(40);
const tree=files=>files.map(file=>`100644 blob ${'a'.repeat(40)}\t${file}`).join('\0');
const before=tree(['js/pages/canvas.js',...COMPLETED_MEDIA_FILES.filter(file=>!file.includes('completed-media-continuation'))]);
const after=tree(['js/pages/canvas.js',...COMPLETED_MEDIA_FILES]);
const read=args=>args[0]==='rev-parse'?source.sha:args[0]==='diff'?COMPLETED_MEDIA_FILES.join('\n'):args[2]===head?after:before;
assertCompletedMediaDelta(head,{read});
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_SHA:head,CANDIDATE_BASE:source.base,CANDIDATE_RUN:source.run,CANDIDATE_ATTEMPT:source.attempt};
assert.equal(resolveCompletedMediaSource(env,{read}),source);
assert.equal(resolveCompletedMediaSource({...env,CANDIDATE_RUN:'another'}),null);
for(const change of [{CANDIDATE_BASE:head},{CANDIDATE_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'push'},{GITHUB_REPOSITORY:'another/repo'}])assert.throws(()=>resolveCompletedMediaSource({...env,...change},{read}));
for(const bad of [args=>args[0]==='rev-parse'?head:read(args),args=>args[0]==='ls-tree'&&args[2]===head?after.replace('js/pages/canvas.js','js/pages/other.js'):read(args),args=>args[0]==='ls-tree'&&args[2]===head?after.replace('100644','120000'):read(args)])assert.throws(()=>assertCompletedMediaDelta(head,{read:bad}));
assert.equal(repairKind(COMPLETED_MEDIA_FILES),'tooling');
assert.throws(()=>repairKind([...COMPLETED_MEDIA_FILES,'workers/auth/src/routes/canvas.js']));
const acceptedArtifact={...source.candidate,workflow_run:{id:Number(source.run),head_sha:source.sha},expired:false,expires_at:'2100-01-01T00:00:00Z'};
assertCompletedMediaArtifact(acceptedArtifact,'candidate');
for(const patch of [{id:1},{digest:'sha256:'+'a'.repeat(64)},{expired:true},{workflow_run:{id:Number(source.run),head_sha:head}}])assert.throws(()=>assertCompletedMediaArtifact({...acceptedArtifact,...patch},'candidate'));
// Existing receipt context must not accidentally interpret the new profile as fa95.
assert.equal(backendReceiptContext({sha:source.sha},{}).sha,source.sha);
const guards=['Verify completed media continuation guards','Preflight acknowledged full release','Verify exact completed source acceptance'];
const jobs=[{name:'reuse-candidate',head_sha:head,status:'completed',conclusion:'success',steps:guards.map(name=>({name,status:'completed',conclusion:'success'}))},{name:'release-compatibility',conclusion:'skipped'}];
assertCompletedMediaAcceptance(jobs,head);
const missing=structuredClone(jobs);missing[0].steps.pop();assert.throws(()=>assertCompletedMediaAcceptance(missing,head));
const deferred=[{name:'release-compatibility',head_sha:head,status:'completed',conclusion:'success',steps:[{name:'Set up job',conclusion:'success'},{name:'Defer pinned deployment-only push',conclusion:'success'},{name:'Verify local release evidence and candidate bytes',conclusion:'skipped'}]},{name:'deploy',conclusion:'skipped'}];
assert(completedMediaDeferredPush(deferred,head));
const unexpected=structuredClone(deferred);unexpected[0].steps.at(-1).conclusion='failure';assert.equal(completedMediaDeferredPush(unexpected,head),false);
const at='2026-10-20T18:53:00Z',owner='bitbi-private-media-release-smoke';
const evidence={source,logDigest:source.log.sha256,logBytes:source.log.bytes,job:{steps:[{name:'Apply verified candidate backend prerequisites',status:'completed',conclusion:'failure',started_at:'2026-10-20T18:50:10Z',completed_at:'2026-10-20T18:55:07Z'}]}};
const groups=Object.fromEntries(['github','cloudflare'].map(backend=>{
  const project=canvasRecoveryId(`media-smoke:${source.sha}:${backend}`);
  return[backend,{project,rows:[project,...[0,1].map(index=>canvasRecoveryId(`${project}:asset:${index}`))].map((id,index)=>({id,user_id:owner,project_id:project,kind:index?'poster':'concat',status:'ready',attempt_count:1,processing_token:'sensitive-token',locked_until:null,created_at:at,updated_at:at,asset_id:id,r2_key:'private-key',poster_r2_key:'private-poster'})).sort((a,b)=>a.id.localeCompare(b.id))}];
}));
const project=groups.cloudflare.project;
const reference={id:canvasRecoveryId(`${project}:reference`),user_id:owner,status:'ready',attempt_count:1,created_at:at,updated_at:at,output_r2_key:'private-reference'};
const preview={id:`hhvd_${canvasRecoveryId(`${project}:preview`)}`,source_user_id:owner,status:'succeeded',created_at:at,updated_at:at,file_r2_key:'private-preview',poster_r2_key:'private-poster'};
const original={id:canvasRecoveryId(`${project}:preview-source`),user_id:owner,r2_key:'private-original',poster_r2_key:'private-poster',created_at:at};
const data={groups,reference,preview,original};
const queryFor=data=>async(sql,params)=>{
  assert(sql.startsWith('SELECT '),'Continuation must never mutate records');
  if(sql.includes('FROM users'))return[{id:owner,status:'disabled'}];
  if(sql.includes('FROM canvas_video_processing')){assert.equal(params[0],owner);assert.equal(params[1],data.groups[params[2]].project);return structuredClone(data.groups[params[2]].rows);}
  if(sql.includes('FROM private_video_references'))return[structuredClone(data.reference)];
  if(sql.includes('FROM homepage_hero_video_derivatives'))return[structuredClone(data.preview)];
  assert(sql.includes('FROM ai_text_assets'));return[structuredClone(data.original)];
};
const proof=await readCompletedMediaJobs(evidence,queryFor(data));verifyCompletedMediaJobs(proof);
assert(!JSON.stringify(proof).includes('private-key')&&!JSON.stringify(proof).includes('sensitive-token'));
for(const mutate of [row=>row.groups.github.rows[0].status='queued',row=>row.groups.github.rows[0].attempt_count=2,row=>row.groups.github.rows[0].updated_at='2026-10-21T00:00:00Z',row=>row.groups.cloudflare.rows[0].locked_until=at,row=>row.groups.cloudflare.rows[0].user_id='someone-else',row=>row.reference.status='failed']){
  const wrong=structuredClone(data);mutate(wrong);await assert.rejects(()=>readCompletedMediaJobs(evidence,queryFor(wrong)));
}
const media={sha:source.sha,application:'original-application',namespace:'original-namespace',assignedInstance:'a'.repeat(64),workerVersion:'original-version',deployment:'original-deployment',
  imageDigest:`registry.cloudflare.com/${'a'.repeat(32)}/bitbi-private-media@sha256:${'b'.repeat(64)}`,artifact:source.media,sourceRun:source.run,sourceAttempt:source.attempt};
const stopped={state:'stopped',instance:media.assignedInstance,observedAt:'2026-10-20T23:00:00Z'};
const cycle=completedMediaLifecycle(media,proof,stopped);verifyCompletedMediaLifecycle(cycle,proof);
assert.throws(()=>verifyCanvasRecoveryLifecycle(cycle,proof),'Original fa95 profile is not relaxed');
for(const patch of [{running:{state:'running'}},{stoppedBefore:stopped},{stoppedNow:{...stopped,state:'running'}},{stoppedNow:{...stopped,instance:'b'.repeat(64)}}])assert.throws(()=>verifyCompletedMediaLifecycle({...cycle,...patch},proof));
const fixture=fs.readFileSync('tests/fixtures/media/canvas-end-frame.mp4'),ref=fs.readFileSync('tests/fixtures/media/h3-overrun.mp4'),poster=Buffer.from('synthetic-poster');
const output=()=>({video:fixture.toString('base64'),poster:poster.toString('base64'),videoDigest:hash(fixture),posterDigest:hash(poster)});
const result=backend=>({ready:true,sha:source.sha,backend,outputs:[{...output(),...(backend==='cloudflare'?{previewBase:{video:fixture.toString('base64'),digest:hash(fixture)}}:{})},output(),output()],publicPreviews:[output(),output()],videoReference:{video:ref.toString('base64'),videoDigest:hash(ref),originalDigest:hash(ref),metadata:{frames:360,duration:15,audioDuration:15}}});
const requests=[],decoded=[];let lastBackend;
const options={completedProof:proof,now:()=>Date.parse(stopped.observedAt),observeState:async(_app,state)=>{assert.equal(state,'stopped','No synthetic running observation');return stopped;},record:()=>{},
  request:async(_url,init)=>{const body=JSON.parse(init.body);requests.push(body);assert.equal(body.action,'result');assert.equal(body.sha,source.sha);assert.deepEqual(Object.keys(body).sort(),['action','backend','sha']);lastBackend=body.backend;return Response.json({ok:true,data:result(body.backend)});},
  mediaCommand:(command,args)=>{
    decoded.push([lastBackend,command]);
    if(command==='ffprobe')return JSON.stringify({format:{duration:'15'},streams:[{codec_type:'video',width:16,height:16,nb_frames:360},...(args.at(-1).endsWith('clean-base.mp4')?[]:[{codec_type:'audio'}])]});
    assert.equal(command,'ffmpeg');
    if(args.includes('f32le')){const bytes=Buffer.alloc(4800*4);for(let i=0;i<4800;i++)bytes.writeFloatLE(0.1*Math.sin(2*Math.PI*1000*i/48000),i*4);return bytes;}
    assert(args.includes('rgb24'));return Buffer.from([200,20,10]);
  }};
const context={sha:source.sha,completedMediaSource:source,plan:{changedFiles:[]}};
const smoke=await mediaSmoke(context,'synthetic-secret',media,options);
assert.equal(requests.length,2);assert.deepEqual([...new Set(decoded.map(row=>row[0]))].sort(),['cloudflare','github']);
assert(smoke.every(row=>row.validation.mode==='current-decode'));assert(smoke.find(row=>row.backend==='cloudflare').exportMusic.decoded);
verifyMediaEvidence({media,smoke},{sha:source.sha,run:source.run,attempt:source.attempt,lifecycle:true,publicPreviews:true,previewBase:true,videoReferences:true,exportMusic:true,completedProof:proof});
for(const field of ['namespace','application','workerVersion','deployment']) {
  const wrong=structuredClone(smoke);wrong.find(row=>row.backend==='cloudflare').lifecycle.actor[field]='another';
  assert.throws(()=>verifyMediaEvidence({media,smoke:wrong},{sha:source.sha,run:source.run,attempt:source.attempt,lifecycle:true,completedProof:proof}),/actor differs/);
}
await assert.rejects(()=>mediaSmoke(context,'synthetic-secret',media,{...options,request:async(_url,init)=>Response.json({ok:true,data:{...result(JSON.parse(init.body).backend),ready:false}})}),/no longer ready/);
let attempts=0;
assert.equal(await verifiedRead({provider:'cloudflare',operation:'container-readiness',action:async()=>{if(++attempts<3)throw Error('Cloudflare read failed (500)');return'stopped';},wait:async()=>{}}),'stopped');assert.equal(attempts,3);
await assert.rejects(()=>verifiedRead({provider:'cloudflare',operation:'container-readiness',action:async()=>{throw Error('Cloudflare read failed (403)');},wait:async()=>assert.fail('Authorization errors must not retry')}),/403/);
console.log('Completed media continuation: exact source and protected identity, read-only stored jobs, fresh artifact decoding, truthful retained lifecycle and bounded Cloudflare reads verified.');
