import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {api,collection} from '../pages-candidate.mjs';
import {cloudflareRead,hash} from './frontend-hosting.mjs';
import {verifyMediaImage} from '../private-media-image.mjs';
const run=(cmd,args,options={})=>{try{return execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:8*1024*1024,...options});}catch{throw Error(`Private media ${path.basename(cmd)} operation failed; no frontend continuation`);}};
const cli=path.resolve('workers/auth/node_modules/wrangler/bin/wrangler.js');
const wrangler=args=>run(process.execPath,[cli,...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
export function assertMediaAuthConfig(before,after) {
  const normalize=c=>{const copy=structuredClone(c);copy.services=copy.services.filter(s=>s.binding!=='PRIVATE_MEDIA_PROCESSOR');copy.secrets.required=copy.secrets.required.filter(s=>s!=='PRIVATE_MEDIA_PROCESSOR_SECRET');delete copy.vars.PRIVATE_MEDIA_SOURCE_SHA;return copy;};
  const previous=normalize(before),next=normalize(after);
  // Private provider upload/source capabilities must not enter automatic URL logs.
  // Only the reviewed privacy reduction is permitted; no other logging/config drift.
  assert.equal(next.observability?.logs?.invocation_logs,false,'Private media requires invocation logs disabled');
  previous.observability.logs.invocation_logs=false;
  assert.deepEqual(next,previous,'Unreviewed Auth configuration change');
  assert.deepEqual(after.services.filter(s=>s.binding==='PRIVATE_MEDIA_PROCESSOR'),[{binding:'PRIVATE_MEDIA_PROCESSOR',service:'bitbi-private-media'}]);
}
export function verifyMediaEvidence(receipt,{sha,run,attempt,lifecycle=false,publicPreviews=false,videoReferences=false}) {
  assert(receipt.media,'Missing media activation evidence');
  assert.equal(receipt.media.sha,sha);assert.equal(receipt.media.sourceRun,run);assert.equal(receipt.media.sourceAttempt,attempt);
  assert(/^registry\.cloudflare\.com\/[a-f0-9]{32}\/bitbi-private-media@sha256:[a-f0-9]{64}$/.test(receipt.media.imageDigest),'Wrong image identity');
  assert(receipt.media.artifact?.id&&/^sha256:[a-f0-9]{64}$/.test(receipt.media.artifact.digest),'Missing CI image artifact');
  assert.deepEqual(receipt.smoke?.map(s=>s.backend).sort(),['cloudflare','github']);
  if(lifecycle) {
    const cycle=receipt.smoke.find(s=>s.backend==='cloudflare')?.lifecycle;
    assert(cycle,'Missing production idle/wake evidence');
    const events=['stoppedBefore','running','completed','stoppedAfter'].map(key=>Date.parse(cycle[key]?.observedAt));
    assert(events.every(Number.isFinite)&&events.every((n,i)=>!i||n>=events[i-1]),'Invalid lifecycle chronology');
    for(const key of ['stoppedBefore','stoppedAfter'])assert(['stopped','inactive'].includes(cycle[key].state),'Container did not stop');
    assert.equal(cycle.running.state,'running');
    assert.equal(cycle.running.instance,cycle.stoppedAfter.instance,'Different container in stop/wake evidence');
  }
  for(const smoke of receipt.smoke) {
    assert.equal(smoke.sha,sha);assert(smoke.completedMs>=0);assert.equal(smoke.outputs.length,3);
    for(const out of smoke.outputs)assert(/^[a-f0-9]{64}$/.test(out.videoDigest)&&/^[a-f0-9]{64}$/.test(out.posterDigest),'Missing durable output');
    if(publicPreviews){assert.equal(smoke.publicPreviews?.length,2,'Missing public preview/poster acceptance');for(const out of smoke.publicPreviews)assert(/^[a-f0-9]{64}$/.test(out.videoDigest)&&/^[a-f0-9]{64}$/.test(out.posterDigest),'Missing public preview bytes');}
    if(videoReferences) {
      const ref=smoke.videoReference;
      assert(ref&&/^[a-f0-9]{64}$/.test(ref.videoDigest),'Missing video reference acceptance');
      assert.equal(ref.originalDigest,'2c67d78cda7252be0cb6ef14396d92abb3b7193940ecc977a5c9fcc823bd1609','Wrong reference fixture');
      assert(ref.metadata?.frames===360&&ref.metadata.duration<=15&&ref.metadata.duration>=14.9&&ref.metadata.audioDuration>14.9,'Invalid video reference result');
    }
  }
}
export async function mediaActive(expected,env=process.env,{read=endpoint=>cloudflareRead(endpoint,env),now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),timeout=120000}={}) {
  const started=now();
  const application=async ns=>{
    const matches=(await read('containers/applications')).filter(a=>a.durable_objects?.namespace_id===ns);
    assert.equal(matches.length,1,'Missing/ambiguous container');const app=matches[0];
    assert.equal(app.account_id,env.CLOUDFLARE_ACCOUNT_ID,'Wrong container account');assert.equal(app.max_instances,1);
    return app;
  };
  do {
    const deployment=(await read('workers/scripts/bitbi-private-media/deployments')).deployments[0];
    assert(deployment?.versions?.length===1&&deployment.versions[0].percentage===100,'Ambiguous media traffic');
    const version=await read(`workers/scripts/bitbi-private-media/versions/${deployment.versions[0].version_id}`);
    assert.equal(version.annotations?.['workers/message'],`bitbi-media:${expected.sha}:${expected.imageDigest}`);
    assert(version.resources.bindings.some(b=>b.name==='CLOUDFLARE_STREAM_API_TOKEN'&&b.type==='secret_text'),'Missing preview processor credential');
    assert(version.resources.bindings.some(b=>b.name==='CLOUDFLARE_ACCOUNT_ID'&&b.text===env.CLOUDFLARE_ACCOUNT_ID),'Wrong preview account');
    const ns=version.resources.bindings.find(b=>b.name==='MEDIA_CONTAINER')?.namespace_id;assert(ns,'Missing container namespace');
    assert.equal(version.id,deployment.versions[0].version_id,'Wrong media version response');
    const app=await application(ns),prefix=`containers/applications/${app.id}`;
    const detail=await read(prefix);
    assert.equal(detail.id,app.id);assert.equal(detail.account_id,env.CLOUDFLARE_ACCOUNT_ID);
    assert.equal(detail.durable_objects?.namespace_id,ns);assert.equal(detail.max_instances,1);
    let converged=detail.configuration?.image===expected.imageDigest,rollout;
    if(app.active_rollout_id) {
      // The list's configuration can remain at the pre-rollout image. Only
      // its CURRENT pointer, completed target distribution and assignment count.
      rollout=await read(`${prefix}/rollouts/${app.active_rollout_id}`);
      assert.equal(rollout.id,app.active_rollout_id,'Wrong current rollout');
      assert(!['failed','cancelled','canceled','superseded'].includes(rollout.status),'Media rollout failed or superseded');
      const progress=rollout.progress,distribution=progress?.version_distribution;
      converged=converged&&rollout.status==='completed'&&rollout.target_configuration?.image===expected.imageDigest
        &&Number.isInteger(rollout.target_version)&&detail.version===rollout.target_version
        &&progress?.total_instances===1&&progress.updated_instances===1
        &&distribution?.target_version_percentage===100&&distribution.target_version_instances===1&&distribution.current_version_instances===0
        &&rollout.steps?.length>0&&rollout.steps.every(s=>s.status==='completed')&&rollout.steps.at(-1).step_size?.percentage===100;
    } else {
      // First creation/no effective configuration change starts no rollout.
      // Never search historical successful rollouts to compensate for a mismatch.
      converged=converged&&app.configuration?.image===expected.imageDigest;
    }
    const assigned=await read(`${prefix}/instances`);
    assert(Array.isArray(assigned.instances)&&assigned.instances.length<=1&&!assigned.next_page_token,'Ambiguous media assignment');
    for(const instance of assigned.instances) {
      assert(instance.id&&instance.application_id===app.id,'Wrong media instance application');
      assert.equal(instance.name,'private-media-singleton','Wrong media singleton');
      assert(!['failed','unhealthy','unknown'].includes(instance.status?.state),'Failed media assignment');
    }
    converged=converged&&assigned.instances.every(i=>i.image===expected.imageDigest)
      &&(assigned.instances.length===1||!app.active_rollout_id&&app.instances===0&&detail.instances===0);
    if(converged) {
      // Fence read races: a historical success cannot certify a replacement rollout.
      const current=await application(ns);
      assert.equal(current.id,app.id,'Media application replaced');
      assert.equal(current.active_rollout_id,app.active_rollout_id,'Media rollout superseded during verification');
      if(!rollout)assert.equal(current.configuration?.image,expected.imageDigest,'Media configuration changed');
      const active=(await read('workers/scripts/bitbi-private-media/deployments')).deployments[0];
      assert.deepEqual(active,deployment,'Media deployment superseded during verification');
      assert(now()-started<timeout,'Media verification exceeded bounded window');
      return {...expected,workerVersion:version.id,deployment:deployment.id,application:app.id,namespace:ns,
        ...(rollout?{rollout:rollout.id}:{}),assignedInstance:assigned.instances[0]?.id??null};
    }
    // Wrangler activates the Worker before the asynchronous container rollout.
    // Wait only for image convergence; wrong Worker/namespace/limits fail above.
    await pause(5000);
  }while(now()-started<timeout);
  throw Error('Media rollout did not converge to the tested image within bounded verification');
}
export async function currentMediaVersion(read=cloudflareRead) {
  let deployment;
  try {deployment=(await read('workers/scripts/bitbi-private-media/deployments')).deployments[0];}
  catch(error){if(error.message==='Cloudflare read failed (404)')return {};throw error;}
  if(!deployment)return {}; // Preserve the existing first-publication path.
  assert(deployment.versions?.length===1&&deployment.versions[0].percentage===100,'Ambiguous current media traffic');
  return read(`workers/scripts/bitbi-private-media/versions/${deployment.versions[0].version_id}`);
}
export async function activateMedia(expected,{currentVersion,deploy,verify}) {
  if(currentVersion.annotations?.['workers/message']!==`bitbi-media:${expected.sha}:${expected.imageDigest}`)await deploy();
  // A previous attempt may already have activated this exact source/image.
  // Still independently verify traffic, binding, limits and completed rollout.
  return verify();
}
export function mediaEvidenceRun(env=process.env) {return {run:env.REPAIR_SOURCE_SHA?env.GITHUB_RUN_ID:env.CANDIDATE_RUN,attempt:env.REPAIR_SOURCE_SHA?env.GITHUB_RUN_ATTEMPT:env.CANDIDATE_ATTEMPT};}
export async function publishMedia(c,secretFile) {
  const source=mediaEvidenceRun();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-release-'));
  try {
    const name=`private-media-image-${c.sha}-${source.run}-${source.attempt}`;
    const candidates=(await collection(`actions/runs/${source.run}/artifacts`,'artifacts')).filter(a=>a.name===name);
    assert.equal(candidates.length,1,'Missing exact tested media image');const a=candidates[0];
    assert(!a.expired&&Date.parse(a.expires_at)>Date.now()&&a.workflow_run.head_sha===c.sha,'Expired/wrong media image');
    const response=await fetch(`https://api.github.com/repos/bitbiai/Bitbi/actions/artifacts/${a.id}/zip`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`},signal:AbortSignal.timeout(120000)});assert(response.ok,'Image artifact unavailable');
    const bytes=Buffer.from(await response.arrayBuffer());assert.equal(`sha256:${hash(bytes)}`,a.digest,'Image archive identity mismatch');
    fs.writeFileSync(path.join(dir,'image.zip'),bytes);
    run('python3',['-I','-c',`import sys,zipfile,pathlib,stat
p=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(p/'image.zip') as z:
 assert sorted(z.namelist())==['image.json','image.tar','test.log']
 assert sum(e.file_size for e in z.infolist())<1024*1024*1024
 for e in z.infolist():
  assert stat.S_IFMT(e.external_attr>>16) in (0,stat.S_IFREG)
  with (p/e.filename).open('xb') as f:f.write(z.read(e))`,dir]);
    const record=JSON.parse(fs.readFileSync(path.join(dir,'image.json')));
    verifyMediaImage(record,{sha:c.sha,run:source.run,attempt:source.attempt,archive:path.join(dir,'image.tar')});
    run('docker',['load','--input',path.join(dir,'image.tar')]);
    const image=JSON.parse(run('docker',['image','inspect',record.tag]))[0];assert.equal(image.Id,record.image);assert.equal(image.Config.Labels['org.opencontainers.image.revision'],c.sha);
    const pushed=wrangler(['containers','push',record.tag,'--config','workers/media/wrangler.jsonc']);
    const tag=pushed.match(/Pushed image: (\S+)/)?.[1];assert(tag?.startsWith(`registry.cloudflare.com/${process.env.CLOUDFLARE_ACCOUNT_ID}/bitbi-private-media:`),'Unexpected registry target');
    const digests=JSON.parse(run('docker',['image','inspect',tag]))[0].RepoDigests;
    const imageDigest=digests.find(d=>d.startsWith(tag.split(':')[0]+'@sha256:'));assert(imageDigest,'No immutable registry digest');
    const config=JSON.parse(fs.readFileSync('workers/media/wrangler.jsonc'));
    config.main=path.resolve('workers/media/src/index.js');config.vars.SOURCE_SHA=c.sha;config.vars.CLOUDFLARE_ACCOUNT_ID=process.env.CLOUDFLARE_ACCOUNT_ID;
    config.containers[0].image=imageDigest;delete config.containers[0].image_build_context;
    const file=path.join(dir,'wrangler.json');fs.writeFileSync(file,JSON.stringify(config));
    const expected={sha:c.sha,imageDigest,image:record.image,artifact:{id:a.id,digest:a.digest},sourceRun:record.run,sourceAttempt:record.attempt};
    const currentVersion=await currentMediaVersion();
    return await activateMedia(expected,{currentVersion,
      deploy:()=>wrangler(['deploy','--config',file,'--secrets-file',secretFile,'--message',`bitbi-media:${c.sha}:${imageDigest}`]),
      verify:()=>mediaActive(expected),
    });
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
// Independent platform state, never an HTTP request to the sleeping container.
// A failed/unknown/absent instance is not a successful idle shutdown.
export async function waitMediaState(application,state,{read=cloudflareRead,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),timeout=120000}={}) {
  const started=now();
  do {
    const result=await read(`containers/applications/${application}/instances`);
    assert(Array.isArray(result.instances)&&result.instances.length===1,'Missing/ambiguous media instance');
    const instance=result.instances[0],actual=instance.status?.state;
    assert(!['failed','unhealthy','unknown'].includes(actual),'Media instance failed or state unknown');
    if(['stopped','inactive'].includes(actual))assert(instance.status.exit_code===undefined||instance.status.exit_code===0,'Media container exited abnormally');
    if(actual===state||(state==='stopped'&&actual==='inactive'))return {state:actual,instance:instance.id,observedAt:new Date(now()).toISOString(),platformAt:instance.status.updated_at};
    await pause(5000);
  }while(now()-started<timeout);
  throw Error(`Media container did not become ${state} within bounded production verification`);
}
export async function mediaSmoke(c,secret,media) {
  const fixture=fs.readFileSync('tests/fixtures/media/canvas-end-frame.mp4').toString('base64'),referenceFixture=fs.readFileSync('tests/fixtures/media/h3-overrun.mp4').toString('base64'),results=[];
  const request=async body=>{
    const r=await fetch('https://bitbi.ai/api/internal/homepage/hero-videos/private-media/smoke',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({...body,sha:c.sha,...(process.env.REPAIR_SOURCE_SHA?{fixtureSha:process.env.REPAIR_SOURCE_SHA}:{})}),redirect:'error',signal:AbortSignal.timeout(30000)});
    const b=await r.json();assert(r.ok&&b.ok,`Private smoke HTTP ${r.status}: ${['media_smoke_reference_terminal','media_smoke_processing_terminal','media_smoke_preview_terminal'].includes(b.code)?b.code:'media_smoke_failed'}`);return b.data;
  };
  const lifecycle={stoppedBefore:await waitMediaState(media.application,'stopped')};
  if(process.env.REPAIR_SOURCE_SHA)await request({action:'retry-reference',backend:'cloudflare'});
  else for(const backend of ['github','cloudflare'])await request({action:'start',backend,fixture,referenceFixture});
  lifecycle.running=await waitMediaState(media.application,'running');
  // This is the protected deployment's own finite job completion check, not
  // agent monitoring. A deadline is a failed acceptance, never synthetic green.
  const started=Date.now(),pending=new Set(['github','cloudflare']);
  while(pending.size&&Date.now()-started<12*60_000) {
    for(const backend of pending) {
      const result=await request({action:'result',backend});
      assert(!result.failed,`Private smoke terminal failure: ${['media_smoke_reference_terminal','media_smoke_processing_terminal','media_smoke_preview_terminal'].includes(result.code)?result.code:'media_smoke_failed'}`);
      if(!result.ready)continue;
      assert.equal(result.outputs.length,3);assert.equal(result.publicPreviews?.length,2);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-smoke-'));
      try {
        for(const [i,out] of [...result.outputs,...result.publicPreviews].entries()) {
          for(const kind of ['video','poster']) {
            const bytes=Buffer.from(out[kind],'base64');assert.equal(hash(bytes),out[`${kind}Digest`]);
            const file=path.join(dir,`${i}-${kind}`);fs.writeFileSync(file,bytes);
            const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',file]));assert(probe.streams.some(s=>s.codec_type==='video'&&s.width>0&&s.height>0));
          }
        }
        const reference=result.videoReference;assert(reference,'Missing H3 reference processing acceptance');
        const bytes=Buffer.from(reference.video,'base64');assert.equal(hash(bytes),reference.videoDigest);assert.equal(reference.originalDigest,hash(Buffer.from(referenceFixture,'base64')));
        const file=path.join(dir,'h3-reference.mp4');fs.writeFileSync(file,bytes);
        const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
        assert(Number(probe.format.duration)<=15);assert(probe.streams.some(s=>s.codec_type==='audio'));assert.equal(Number(probe.streams.find(s=>s.codec_type==='video')?.nb_frames),360);
      }finally{fs.rmSync(dir,{recursive:true,force:true});}
      if(backend==='cloudflare') {
        lifecycle.completed={observedAt:new Date().toISOString()};
        lifecycle.stoppedAfter=await waitMediaState(media.application,'stopped');
      }
      const digests=items=>items.map(o=>({videoDigest:o.videoDigest,posterDigest:o.posterDigest}));
      results.push({backend,sha:c.sha,...(process.env.REPAIR_SOURCE_SHA?{fixtureSha:process.env.REPAIR_SOURCE_SHA,reusedOutputs:true,referenceRecoveryRequested:backend==='cloudflare'}:{}),completedMs:Date.now()-started,outputs:digests(result.outputs),publicPreviews:digests(result.publicPreviews),videoReference:{videoDigest:result.videoReference.videoDigest,originalDigest:result.videoReference.originalDigest,metadata:result.videoReference.metadata}});pending.delete(backend);
    }
    if(pending.size)await new Promise(resolve=>setTimeout(resolve,5000));
  }
  assert.equal(pending.size,0,'Private media smoke did not complete within release acceptance window');
  const cloudflare=results.find(r=>r.backend==='cloudflare');cloudflare.lifecycle=lifecycle;
  if(c.plan.changedFiles.includes('workers/auth/migrations/0091_separate_thumbnail_processing.sql')) {
    const activation=await request({action:'activate-thumbnails',backend:'cloudflare'});
    assert.equal(activation.sha,c.sha);assert.equal(activation.thumbnailBackend,'cloudflare');assert.equal(activation.verified,true);
    cloudflare.thumbnailActivation=activation;
  }
  console.log(JSON.stringify({privateMediaLifecycle:lifecycle}));return results;
}
