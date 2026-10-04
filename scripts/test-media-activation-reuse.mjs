import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {mediaInputsUnchanged,resolveActiveMediaSource,verifyReusedMediaReceipt} from './lib/media-activation-reuse.mjs';
import {requiredJobs,proofJobs} from './pages-candidate.mjs';
import {mediaImageInputs} from './private-media-image.mjs';
import {hash} from './lib/frontend-hosting.mjs';
import {publishMedia,mediaSmoke} from './lib/media-publication.mjs';

const repoRoot=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-reuse-'));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),value);};
const commit=message=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',message]);return git(['rev-parse','HEAD']);};
try {
  git(['init','-q']);
  for(const file of ['services/homepage-ffmpeg-processor/processor.mjs','workers/media/src/index.js','scripts/private-media-image.mjs','workers/auth/src/lib/h3-reference-metadata.js'])write(file,'original\n');
  for(const name of ['h3-overrun.mp4','canvas-end-frame.mp4'])write(`tests/fixtures/media/${name}`,fs.readFileSync(path.join(repoRoot,'tests/fixtures/media',name)));
  write('workers/auth/src/lib/private-media-smoke.js','old\n');const base=commit('base');
  write('workers/media/src/index.js','tested media\n');const sha=commit('tested media');
  write('workers/auth/src/lib/private-media-smoke.js','read-only admission repair\n');const head=commit('auth repair');
  process.chdir(root);
  assert.equal(mediaInputsUnchanged(sha,head),true);
  assert.equal(mediaInputsUnchanged(base,head),false);
  const c={base,sha:head,runId:'200',attempt:'1'},digest='d'.repeat(64);
  const imageDigest=`registry.cloudflare.com/${'c'.repeat(32)}/bitbi-private-media@sha256:${digest}`;
  const selected={workers:true,full:true,files:['workers/media/src/index.js']};
  const run={id:100,run_attempt:1,repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},path:'.github/workflows/static.yml',head_branch:'main',head_sha:sha,event:'push',status:'completed',conclusion:'failure',created_at:'2026-09-30T12:00:00Z'};
  const job={id:101,run_id:100,run_attempt:1,name:'deploy',head_sha:sha,status:'completed',conclusion:'failure',steps:[
    {name:'Validate candidate references before backend publication',status:'completed',conclusion:'success'},
    {name:'Apply verified candidate backend prerequisites',status:'completed',conclusion:'failure',started_at:'2026-09-30T13:00:00Z',completed_at:'2026-09-30T13:02:00Z'},
    {name:'Preserve backend activation evidence',status:'completed',conclusion:'skipped'},
  ]};
  const validationJobs=Object.entries(requiredJobs(selected)).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
  const artifact=(name,id)=>({id,name,expired:false,expires_at:'2099-01-01T00:00:00Z',size_in_bytes:100,digest:`sha256:${digest}`,workflow_run:{id:100,head_sha:sha}});
  const artifacts=[artifact(`pages-candidate-${sha}-100-1`,1),...proofJobs(selected).map((name,i)=>artifact(`pages-proof-${name}-${sha}-100-1`,i+2)),artifact(`private-media-image-${sha}-100-1`,9)];
  const prior={run,job,jobs:[...validationJobs,job],artifacts,authorizations:[{id:7,sha,environment:'cloudflare-static-production',task:'deploy'}],
    statuses:[{state:'failure',log_url:'https://github.com/bitbiai/Bitbi/actions/runs/100/job/101'}],later:[],
    version:{id:'media-v',annotations:{'workers/message':`bitbi-media:${sha}:${imageDigest}`},resources:{bindings:[{name:'SOURCE_SHA',text:sha}]}},
    deployment:{id:'media-d',created_on:'2026-09-30T13:01:00Z',versions:[{version_id:'media-v',percentage:100}]}};
  const exercise=async(mutate=()=>{},context=c)=>{
    const data=structuredClone(prior);mutate(data);let activeReads=0;
    return resolveActiveMediaSource(context,{
      selection:()=>selected,loadAttempt:async(id,attempt)=>{assert.equal(id,'100');assert.equal(attempt,'1');return data.run;},
      readCloudflare:async endpoint=>{
        if(endpoint==='workers/scripts/bitbi-private-media/deployments'){activeReads++;return {deployments:[activeReads>1&&data.race?data.race:data.deployment]};}
        assert.equal(endpoint,'workers/scripts/bitbi-private-media/versions/media-v');return data.version;
      },
      read:async endpoint=>{
        if(endpoint.startsWith('deployments?'))return data.authorizations;
        if(endpoint==='deployments/7/statuses')return data.statuses;
        if(endpoint==='actions/jobs/101')return data.job;
        if(endpoint==='git/ref/heads/main')return {object:{sha:context.sha}};
        assert.fail(`Unexpected GitHub read: ${endpoint}`);
      },
      list:async endpoint=>{
        if(endpoint==='actions/runs/100/attempts/1/jobs')return data.jobs;
        if(endpoint==='actions/runs/100/artifacts')return data.artifacts;
        if(endpoint===`actions/runs?head_sha=${sha}`)return data.later;
        if(endpoint==='actions/runs/102/attempts/1/jobs')return [];
        assert.fail(`Unexpected GitHub list: ${endpoint}`);
      },
    });
  };
  const source=await exercise();assert.equal(source.sha,sha);assert.equal(source.run,'100');assert.equal(source.attempt,'1');assert.equal(source.activation.deployment,'media-d');
  for(const mutate of [
    d=>d.authorizations=[],d=>d.authorizations[0].environment='unprotected',d=>d.statuses[0].state='success',
    d=>d.run.head_repository.full_name='foreign/repo',d=>d.run.head_sha=head,d=>d.run.run_attempt=2,
    d=>d.job.steps[1].conclusion='success',d=>d.job.steps[2].conclusion='success',
    d=>d.deployment.created_on='2026-09-30T12:59:59Z',d=>d.deployment.versions[0].percentage=50,
    d=>d.version.resources.bindings[0].text=head,d=>d.version.annotations['workers/message']='unknown',
    d=>d.artifacts.at(-1).workflow_run.head_sha=head,d=>d.artifacts.at(-1).expired=true,
    d=>d.artifacts.at(-1).digest='wrong',d=>d.artifacts.push(d.artifacts.at(-1)),
    d=>d.jobs[0].conclusion='failure',d=>d.jobs[0].steps.pop(),
    d=>d.later=[{id:102,run_attempt:1,path:'.github/workflows/full-regression.yml',created_at:'2026-09-30T14:00:00Z',status:'completed',conclusion:'failure'}],
    d=>d.race={...d.deployment,id:'replacement'},
  ])await assert.rejects(exercise(mutate));
  const receipt={mediaSourceSha:sha,media:{sha,sourceRun:'100',sourceAttempt:'1',imageDigest,artifact:source.artifact,reusedActivation:source.activation,workerVersion:'media-v',deployment:'media-d'},mediaAcceptance:{publicationSha:head,run:'200',attempt:'1'}};
  verifyReusedMediaReceipt(receipt,c,source);
  for(const mutate of [r=>r.mediaSourceSha=head,r=>r.media.sha=head,r=>r.media.sourceRun='200',r=>r.media.sourceAttempt='2',r=>r.media.artifact.id=99,r=>r.media.reusedActivation.job=99,r=>r.media.workerVersion='other',r=>r.mediaAcceptance.publicationSha=sha,r=>r.mediaAcceptance.run='100',r=>delete r.mediaAcceptance]) {
    const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>verifyReusedMediaReceipt(bad,c,source));
  }

  // Original archive bytes are verified at the publication boundary before any
  // live reuse; this path never invokes push/deploy, even for a matching label.
  const archive=Buffer.from('synthetic Docker save bytes'),image='sha256:'+'e'.repeat(64);
  const record={sha,run:'100',attempt:'1',dirty:false,sourceFiles:mediaImageInputs(),platform:'linux/amd64',image,tag:`bitbi-private-media:${sha}`,ffmpeg:'ffmpeg fixture',ffprobe:'ffprobe fixture',archiveDigest:hash(archive),tests:['two-five-clips','copy-normalize-audio','background-music-decoded','per-clip-audio-decoded','smooth-joins-decoded','private-drain-poster','container-process-restart','h3-video-reference']};
  const publish=async(change=()=>{})=>{
    const input={record:structuredClone(record),active:{workerVersion:'media-v',deployment:'media-d'},artifact:structuredClone(source.artifact)},calls=[];change(input);
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-media-archive-'));
    try {
      fs.writeFileSync(path.join(folder,'image.json'),JSON.stringify(input.record));fs.writeFileSync(path.join(folder,'image.tar'),archive);fs.writeFileSync(path.join(folder,'test.log'),'passed');
      execFileSync('python3',['-I','-c','import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(p/"image.zip","w") as z:\n for name in ["image.json","image.tar","test.log"]: z.write(p/name,name)',folder]);
      const bytes=fs.readFileSync(path.join(folder,'image.zip'));input.artifact.digest=`sha256:${hash(bytes)}`;
      const reuse={...source,artifact:input.artifact};
      const result=await publishMedia(c,'unused-secret',{reuse,
        listArtifacts:async endpoint=>{assert.equal(endpoint,'actions/runs/100/artifacts');return [{...artifacts.at(-1),...input.artifact}];},
        fetchArtifact:async url=>{assert(url.endsWith(`/artifacts/${input.artifact.id}/zip`));return new Response(input.corruptArchive?Buffer.from('corrupt archive'):bytes);},
        command:(name,args,options)=>{
          calls.push([name,...args]);if(name==='python3')return execFileSync(name,args,{encoding:'utf8',...options});
          assert.equal(name,'docker');if(args[0]==='load')return '';
          assert.deepEqual(args,['image','inspect',record.tag]);return JSON.stringify([{Id:image,Config:{Labels:{'org.opencontainers.image.revision':sha}}}]);
        },
        verifyActive:async expected=>({...expected,...input.active}),
      });
      assert.equal(result.sha,sha);assert.equal(result.sourceRun,'100');assert.equal(result.sourceAttempt,'1');
      assert(!calls.some(c=>c.includes('push')||c.includes('deploy')));return result;
    }finally{fs.rmSync(folder,{recursive:true,force:true});}
  };
  await publish();
  for(const change of [d=>d.corruptArchive=true,d=>d.record.sha=head,d=>d.record.run='200',d=>d.record.attempt='2',d=>d.record.dirty=true,d=>d.record.sourceFiles['workers/media/src/index.js']='bad',d=>d.record.archiveDigest='bad',d=>d.record.tests.pop(),d=>d.active.workerVersion='replacement',d=>d.active.deployment='replacement'])await assert.rejects(publish(change));
  write('workers/media/src/index.js','genuine changed implementation\n');const changed=commit('actual media edit');
  assert.equal(mediaInputsUnchanged(sha,changed),false);assert.equal(await exercise(()=>{},{...c,sha:changed}),null,'A genuine media change selects a new tested deployment');
  assert.equal(await exercise(()=>{},{...c,base:head,sha:changed}),null,'Media older than a later published frontend base must not block a genuine media change');
  git(['rm','-q','services/homepage-ffmpeg-processor/processor.mjs']);const deleted=commit('deleted media input');assert.equal(mediaInputsUnchanged(changed,deleted),false);
}finally{process.chdir(repoRoot);fs.rmSync(root,{recursive:true,force:true});}

// Every smoke response retains the live Media SHA even when Auth/publication
// source advances. Wrong/missing source or backend cannot certify acceptance.
{
  const originalFetch=globalThis.fetch,keys=['REPAIR_SOURCE_SHA','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]])),sha='a'.repeat(40),candidate='b'.repeat(40);
  try {
    delete process.env.REPAIR_SOURCE_SHA;process.env.CLOUDFLARE_API_TOKEN='synthetic';process.env.CLOUDFLARE_ACCOUNT_ID='c'.repeat(32);
    for(const target of ['start','result'])for(const mutation of ['source','backend','missing','terminal']) {
      const calls=[],diagnostics=[];let reads=0;
      globalThis.fetch=async url=>{assert(String(url).endsWith('/instances'));return Response.json({success:true,result:{instances:[{id:'instance',status:{state:++reads===1?'inactive':'running',exit_code:0}}]}});};
      const error=mutation==='terminal'?'media_smoke_reference_terminal':'media_smoke_response_invalid';
      await assert.rejects(mediaSmoke({sha:candidate,plan:{changedFiles:[]}},'synthetic',{sha,application:'app'},
        {record:d=>diagnostics.push(d),request:async(url,init)=>{
          const body=JSON.parse(init.body);calls.push(body);assert.equal(body.sha,sha);assert(!body.fixtureSha);
          if(body.action==='preflight')return Response.json({ok:true,data:{ready:true,admission:'private-media-smoke-v1',sha,backend:body.backend}});
          const data={accepted:true,sha,backend:body.backend};
          if(body.action===target) {
            if(mutation==='source')data.sha=candidate;
            if(mutation==='backend')data.backend=body.backend==='github'?'cloudflare':'github';
            if(mutation==='missing')delete data.sha;
            if(mutation==='terminal')Object.assign(data,{ready:false,failed:true,code:'media_smoke_reference_terminal'});
          }
          return Response.json({ok:true,data});
        }}),new RegExp(error));
      assert.deepEqual(calls.map(c=>c.action),target==='start'?['preflight','preflight','start']:['preflight','preflight','start','start','result']);
      assert.equal(diagnostics.at(-1).action,target);assert.equal(diagnostics.at(-1).code,error);
    }
  }finally{globalThis.fetch=originalFetch;for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
}
console.log('Media activation reuse: exact Git inputs, protected failed activation, accepted original image archive, fresh Auth/smoke identity, no redeploy and rejection controls passed.');
