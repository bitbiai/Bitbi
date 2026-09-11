import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {tree,gitSelection,requiredJobs,proofJobs,MEDIA_POLICY} from './pages-candidate.mjs';
import {prepareFrontend,hash,hostingPolicy} from './lib/frontend-hosting.mjs';
import {durableBaseline,loadDurableReceipt,activateRecovery,persistDurableReceipt,RECEIPT_TASK} from './lib/frontend-receipts.mjs';
import {yaml} from '../node_modules/playwright-core/lib/utilsBundle.js';
import vm from 'node:vm';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'bitbi-hosting-review-'));
const results=[];const record=(name,kind='positive')=>results.push({name,kind,passed:true});
const environment={...process.env};
try {
 // Real CLI, real Git fixture and real ZIPs; only HTTP responses are synthetic.
 const fixture=path.join(temp,'checkout');fs.mkdirSync(fixture);
 for(const file of ['scripts','frontend','config/static-hosting.json','workers/contact/package-lock.json']) {
  fs.mkdirSync(path.dirname(path.join(fixture,file)),{recursive:true});fs.cpSync(path.join(root,file),path.join(fixture,file),{recursive:true});
 }
 const initialPolicy=JSON.parse(fs.readFileSync(path.join(fixture,'config/static-hosting.json')));initialPolicy.provider='cloudflare';fs.writeFileSync(path.join(fixture,'config/static-hosting.json'),JSON.stringify(initialPolicy));
 fs.writeFileSync(path.join(fixture,'.gitignore'),'candidate/\n.local/\n');
 const git=args=>execFileSync('git',args,{cwd:fixture,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:'pipe'}).toString().trim();
 git(['init','-q']);git(['add','--all']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic CLI fixture only']);
 const sha=git(['rev-parse','HEAD']);process.chdir(fixture);
 fs.mkdirSync('candidate/site',{recursive:true});fs.writeFileSync('candidate/site/index.html','<h1>Synthetic static bytes</h1>');
 const selection=gitSelection(sha,sha),manifest={schema:2,repository:'bitbiai/Bitbi',sha,base:sha,run:'101',attempt:'1',selection,full:selection.full,mediaPolicy:MEDIA_POLICY,files:tree('candidate/site')};
 prepareFrontend(manifest,tree);fs.writeFileSync('candidate/manifest.json',JSON.stringify(manifest));
 for(const job of [...proofJobs(selection),'frontend-runtime'])fs.writeFileSync(`candidate/proof-${job}.json`,JSON.stringify({job,status:'passed',manifestHash:hash(JSON.stringify(manifest)),tests:1,reportHash:'synthetic-not-native'}));
 const candidateBackup=path.join(temp,'original');fs.cpSync('candidate',candidateBackup,{recursive:true});
 const jobs=Object.entries(requiredJobs(selection)).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
 jobs.push({name:'deploy',status:'completed',conclusion:'skipped',head_sha:sha});
 const run={id:101,run_attempt:1,repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},path:'.github/workflows/static.yml',head_branch:'prep/workers-static-assets',head_sha:sha,event:'workflow_dispatch',status:'completed',conclusion:'success',created_at:'2026-09-11T00:00:00Z'};
 const names=[`pages-candidate-${sha}-101-1`,...proofJobs(selection).map(job=>`pages-proof-${job}-${sha}-101-1`)];
 const artifacts=[];
 for(const [i,name] of names.entries()) {
  const dir=path.join(temp,`archive-${i}`);fs.mkdirSync(dir);
  if(!i)for(const f of ['site','frontend','manifest.json','proof-frontend-runtime.json'])fs.cpSync(path.join('candidate',f),path.join(dir,f),{recursive:true});
  else {const job=proofJobs(selection)[i-1];fs.copyFileSync(`candidate/proof-${job}.json`,path.join(dir,`proof-${job}.json`));}
  execFileSync('zip',['-qr',path.join(temp,`${i+1}.zip`),'.'],{cwd:dir});const bytes=fs.readFileSync(path.join(temp,`${i+1}.zip`));
  artifacts.push({id:i+1,name,digest:`sha256:${hash(bytes)}`,size_in_bytes:bytes.length,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),workflow_run:{id:101,head_sha:sha}});
 }
 const responses={run,jobs,artifacts,sha};const dataFile=path.join(temp,'responses.json');
 const loader=path.join(temp,'http.mjs');fs.writeFileSync(loader,`import fs from 'node:fs';\nconst d=JSON.parse(fs.readFileSync(${JSON.stringify(dataFile)}));\nglobalThis.fetch=async (input,options={})=>{\n if(options.method&&options.method!=='GET')throw Error('Test forbids external writes');\n const u=new URL(input);if(u.hostname!=='api.github.com')throw Error('Unexpected network');\n const p=u.pathname.replace('/repos/bitbiai/Bitbi/','');\n if(p.match(/^actions\\/artifacts\\/\\d+\\/zip$/))return new Response(fs.readFileSync(${JSON.stringify(temp)}+'/'+p.split('/')[2]+'.zip'));\n let r;if(p==='actions/runs/101')r=d.run;else if(p==='actions/runs/101/attempts/1/jobs')r={jobs:d.jobs,total_count:d.jobs.length};else if(p==='actions/runs/101/artifacts')r={artifacts:d.artifacts,total_count:d.artifacts.length};else if(p==='actions/runs')r={workflow_runs:[d.run],total_count:1};else if(p.startsWith('git/ref/heads/'))r={object:{sha:d.sha}};else throw Error('Unmapped HTTP '+p);\n return Response.json(r);};\n`);
 const env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp,NODE_OPTIONS:`--import=${loader}`,GH_TOKEN:'synthetic-read-only',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_SHA:sha,CANDIDATE_BASE:sha,CANDIDATE_RUN:'101',CANDIDATE_ATTEMPT:'1',CANDIDATE_BRANCH:'prep/workers-static-assets'};
 const cli=(name,command,mutate=()=>{},overrides={},pass=false)=>{
  fs.rmSync('candidate',{recursive:true,force:true});fs.cpSync(candidateBackup,'candidate',{recursive:true});
  const d=structuredClone(responses);mutate(d);fs.writeFileSync(dataFile,JSON.stringify(d));
  const q=spawnSync(process.execPath,['scripts/frontend-release.mjs',command],{cwd:fixture,env:{...env,...overrides},encoding:'utf8',timeout:30000});
  assert.equal(q.error,undefined,name);assert.equal(q.status===0,pass,`${name}: ${q.stdout}\n${q.stderr}`);results.push({name,passed:true,exit:q.status,stdout:q.stdout,stderr:q.stderr});
 };
 cli('branch preview verified config','preview-config',()=>{}, {},true);
 cli('digest checked source download','preview-source',()=>fs.rmSync('candidate',{recursive:true}),{},true);
 cli('changed index bytes','preview-config',()=>fs.writeFileSync('candidate/site/index.html','tampered'));
 cli('extra asset','preview-config',()=>fs.writeFileSync('candidate/site/unlisted.txt','extra'));
 cli('symlink file','preview-config',()=>{fs.unlinkSync('candidate/site/index.html');fs.symlinkSync(path.join(candidateBackup,'site/index.html'),'candidate/site/index.html');});
 cli('symlink asset root','preview-config',()=>{fs.rmSync('candidate/site',{recursive:true});fs.symlinkSync(path.join(candidateBackup,'site'),'candidate/site');});
 for(const [key,value] of [['CANDIDATE_BRANCH',''],['GITHUB_SHA','0'.repeat(40)],['CANDIDATE_RUN','102'],['CANDIDATE_ATTEMPT','2'],['GITHUB_REPOSITORY','foreign/repo']])cli(`wrong/missing ${key}`,'preview-config',()=>{},{[key]:value});
 cli('wrong remote branch SHA','preview-config',d=>d.sha='b'.repeat(40));
 cli('wrong artifact digest','preview-config',d=>d.artifacts[0].digest='sha256:'+'0'.repeat(64));
 cli('expired archive','preview-config',d=>d.artifacts[0].expires_at='2000-01-01');
 cli('failed required suite','preview-config',d=>d.jobs[0].conclusion='failure');
 cli('missing required suite','preview-config',d=>d.jobs.shift());
 cli('foreign source event','preview-config',d=>d.run.event='pull_request');
 cli('self-consistent forged proof','preview-config',()=>{const f='candidate/proof-frontend-runtime.json',v=JSON.parse(fs.readFileSync(f));v.tests=999;fs.writeFileSync(f,JSON.stringify(v));});
 cli('main verified production config','production-config',d=>d.run.head_branch='main',{},true);
 cli('branch cannot become staging source','production-config');
 cli('preview upload rechecks changed bytes','preview-upload',()=>fs.writeFileSync('candidate/site/index.html','changed'),{FRONTEND_EXTERNAL_PHASE:'APPROVED_PREVIEW'});
 cli('staging upload rechecks extra file','stage-upload',()=>fs.writeFileSync('candidate/site/x','changed'),{FRONTEND_EXTERNAL_PHASE:'APPROVED_UNROUTED_STAGING'});
 cli('ordinary upload rechecks actual asset','deploy',()=>fs.writeFileSync('candidate/site/index.html','bad'), {GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push'});
 process.chdir(root);

 // Effective permissions: job permissions REPLACE the workflow mapping;
 // omitted write rights are none, including branch/validation_only jobs.
 const workflow=yaml.parse(fs.readFileSync('.github/workflows/static.yml','utf8'));
 assert.deepEqual(workflow.permissions,{contents:'read',actions:'read',deployments:'read'});
 for(const [name,job] of Object.entries(workflow.jobs)) {
  const permissions=job.permissions||workflow.permissions;
  for(const step of job.steps||[])if(step.uses?.startsWith('actions/checkout@'))assert.equal(step.with['persist-credentials'],false);
  if(!['deploy','recover-frontend'].includes(name)) {
   assert(!Object.values(permissions).includes('write'),name+' inherits writes');
   assert(!JSON.stringify(job).includes('secrets.CF_FRONTEND_DEPLOY_TOKEN'));
  } else assert(JSON.stringify(job.environment).includes('cloudflare-static-production'));
  record('effective permissions '+name);
 }
 for(const file of ['full-regression','ui-fast-deploy']) {
  const w=yaml.parse(fs.readFileSync(`.github/workflows/${file}.yml`,'utf8'));
  for(const [name,job] of Object.entries(w.jobs)) {
   const rights=job.permissions||w.permissions;
   if(!(file==='ui-fast-deploy'&&name==='deploy'))assert(!Object.values(rights).includes('write'),file+'/'+name);
   for(const step of job.steps||[])if(step.uses?.startsWith('actions/checkout@'))assert.equal(step.with?.['persist-credentials'],false,file+'/'+name+' persists checkout credential');
  }
  record('effective permissions '+file);
 }
 const recoveryCondition=workflow.jobs['recover-frontend'].if.slice(3,-2).trim();
 for(const branch of ['refs/heads/main','refs/heads/prep/workers-static-assets'])for(const validation of ['true','false'])for(const event of ['push','workflow_dispatch']) {
  const github={ref:branch,event_name:event,event:{inputs:{validation_only:validation,frontend_recovery_receipt:'1'}}};
  assert.equal(Boolean(vm.runInNewContext(recoveryCondition,{github,cancelled:()=>false})),branch==='refs/heads/main'&&validation==='false'&&event==='workflow_dispatch');
 }
 record('branch/validation-only recovery denied');

 // Durable receipts: A -> B -> protected rollback A -> actual A baseline,
 // independent of expired Actions artifacts. All platform responses synthetic.
 process.chdir(fixture);const policy=hostingPolicy();policy.provider='cloudflare';fs.writeFileSync('config/static-hosting.json',JSON.stringify(policy));
 const account='c'.repeat(32);process.env.CLOUDFLARE_ACCOUNT_ID=account;
 const domains=policy.domains.map(hostname=>({hostname,id:hostname,zone_id:'zone',service:policy.worker,environment:'production'}));
 const db={};let current;let latest;let readCalls=[];
 function addReceipt(id,sha,versionId,deploymentId,kind='publication',restoredFrom) {
  const publicationSha=kind==='rollback'?'b'.repeat(40):sha;
  const r={sha,run:sha[0]==='a'?'101':'102',attempt:'1',packageDigest:sha[0].repeat(64),account,worker:policy.worker,target:'production',provider:'cloudflare',versionId,deploymentId,kind,restoredFrom,publicationSha,publicationRun:String(id+1000),publicationAttempt:'1',authorizingDeployment:id+2000,authorizingJob:id+3000};
  db[`deployments/${id}`]={id,sha,task:RECEIPT_TASK,environment:policy.productionEnvironment,payload:{receipt:r,receiptSHA256:hash(JSON.stringify(r))},created_at:'2020-01-01'};
  db[`deployments/${id}/statuses`]=[{state:'success'}];
  db[`deployments/${id+2000}`]={id:id+2000,sha:publicationSha,task:'deploy',environment:policy.productionEnvironment};
  db[`deployments/${id+2000}/statuses`]=[{state:'success',log_url:`https://github.com/bitbiai/Bitbi/actions/runs/${id+1000}/job/${id+3000}`}];
  db[`actions/runs/${id+1000}`]={id:id+1000,repository:{full_name:'bitbiai/Bitbi'},head_repository:{full_name:'bitbiai/Bitbi'},path:'.github/workflows/static.yml',head_branch:'main',head_sha:publicationSha,event:'workflow_dispatch'};
  db[`actions/jobs/${id+3000}`]={id:id+3000,run_id:id+1000,run_attempt:1,head_sha:publicationSha,name:kind==='rollback'?'recover-frontend':'deploy',status:'completed',conclusion:'success',steps:[kind==='rollback'?'Activate approved frontend recovery':'Deploy and verify Cloudflare frontend','Record durable frontend receipt'].map(name=>({name,status:'completed',conclusion:'success'}))};
  return r;
 }
 const A=addReceipt(1,'a'.repeat(40),'version-A','deployment-A'),B=addReceipt(2,'b'.repeat(40),'version-B','deployment-B');
 const api=async endpoint=>{
  if(endpoint.includes('task='+RECEIPT_TASK))return [{id:latest}];
  if(endpoint==='git/ref/heads/main')return {object:{sha:B.sha}};
  assert(endpoint in db,'Unexpected platform read '+endpoint);return structuredClone(db[endpoint]);
 };
 const read=async endpoint=>{readCalls.push(endpoint);if(endpoint==='workers/domains')return domains;if(endpoint.endsWith('/deployments'))return {deployments:[current]};const v=endpoint.endsWith('version-A')?A:B;return {id:v.versionId,annotations:{'workers/message':`bitbi:${v.sha}:${v.run}:1:${v.packageDigest}`}};};
 const active=r=>({id:r.deploymentId,versions:[{version_id:r.versionId,percentage:100}]});
 latest=1;current=active(A);assert.equal((await durableBaseline(api,read)).sha,A.sha);
 latest=2;current=active(B);assert.equal((await durableBaseline(api,read)).sha,B.sha);
 let activations=0;
 const opts={receiptId:1,expectedDeployment:B.deploymentId,api,read,env:{GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_SHA:B.sha,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_JOB:'recover-frontend',CLOUDFLARE_ACCOUNT_ID:account},activate:async v=>{activations++;assert.equal(v,A.versionId);current={id:'recovery-A',versions:[{version_id:v,percentage:100}]};}};
 await assert.rejects(activateRecovery({...opts,expectedDeployment:'stale'}));assert.equal(activations,0);
 const rollback=await activateRecovery(opts);assert.equal(rollback.sha,A.sha);assert.equal(rollback.deploymentId,'recovery-A');
 const C=addReceipt(3,A.sha,A.versionId,'recovery-A','rollback',1);latest=3;
 assert.equal((await durableBaseline(api,read)).sha,A.sha);record('A B authorized rollback A next baseline');
 // Exercise actual persistence request sequence against synthetic endpoints.
 const written=[];let durableRecord;
 const persistenceApi=async(endpoint,body)=>{
  if(body){written.push({endpoint,body});if(endpoint==='deployments'){durableRecord={id:90,sha:body.ref,payload:body.payload};return durableRecord;}return {...body};}
  if(endpoint==='deployments/90')return durableRecord;
  if(endpoint.includes('/attempts/1/jobs'))return {jobs:[{id:3010,name:'recover-frontend',status:'in_progress'}]};
  if(endpoint.includes('&sha='))return [{id:2010,task:'deploy'}];
  if(endpoint==='deployments/2010/statuses')return [{state:'in_progress',log_url:'https://github.com/bitbiai/Bitbi/actions/runs/1010/job/3010'}];
  return api(endpoint);
 };
 const recoveryEnv={...opts.env,GITHUB_RUN_ID:'1010',GITHUB_RUN_ATTEMPT:'1'};
 assert.equal(await persistDurableReceipt(rollback,{api:persistenceApi,read,env:recoveryEnv}),90);
 assert.equal(written[0].body.ref,A.sha);assert.equal(written[0].body.auto_merge,false);assert.equal(written[0].body.payload.receipt.restoredFrom,1);
 await assert.rejects(persistDurableReceipt(rollback,{api:persistenceApi,read,env:{...recoveryEnv,GITHUB_REF:'refs/heads/prep/x'}}));
 record('durable metadata persistence and branch write denial');
 assert(!readCalls.some(p=>p.includes('artifacts')));record('old production survives artifact expiry via protected durable record');
 db['actions/jobs/3003'].conclusion='failure';await assert.rejects(durableBaseline(api,read));db['actions/jobs/3003'].conclusion='success';record('failed recovery authorization denied','negative');
 delete db['deployments/2003'];await assert.rejects(durableBaseline(api,read));db['deployments/2003']={id:2003,sha:B.sha,task:'deploy',environment:policy.productionEnvironment};record('missing recovery authorization denied','negative');
 current={id:'unrecorded-recovery',versions:[{version_id:A.versionId,percentage:100}]};await assert.rejects(durableBaseline(api,read));current=active(C);record('unrecorded rollback denied','negative');
 db['deployments/3'].payload.receipt.restoredFrom=2;db['deployments/3'].payload.receiptSHA256=hash(JSON.stringify(db['deployments/3'].payload.receipt));await assert.rejects(durableBaseline(api,read));record('wrong rollback source denied','negative');
 db['deployments/3'].payload.receipt={...C};db['deployments/3'].payload.receipt.restoredFrom=1;db['deployments/3'].payload.receiptSHA256=hash(JSON.stringify(db['deployments/3'].payload.receipt));
 db['deployments/1'].payload.receiptSHA256='tampered';await assert.rejects(loadDurableReceipt(1,api));record('invalid old replacement receipt denied','negative');
} finally {
 process.chdir(root);if(environment.CLOUDFLARE_ACCOUNT_ID===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=environment.CLOUDFLARE_ACCOUNT_ID;
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/frontend-review.json',JSON.stringify({syntheticPlatform:true,nativeBrowser:false,results},null,2));
 fs.rmSync(temp,{recursive:true,force:true});
}
console.log(`Frontend review: ${results.length} CLI, effective-permission and durable-recovery controls passed (synthetic platform).`);
