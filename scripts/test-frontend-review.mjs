import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {tree,gitSelection,requiredJobs,proofJobs,MEDIA_POLICY} from './pages-candidate.mjs';
import {prepareFrontend,hash,hostingPolicy,materializeFrontendConfig} from './lib/frontend-hosting.mjs';
import {durableBaseline,loadDurableReceipt,activateRecovery,persistDurableReceipt,findPendingFrontendActivation,RECEIPT_TASK} from './lib/frontend-receipts.mjs';
import {yaml} from '../node_modules/playwright-core/lib/utilsBundle.js';
import vm from 'node:vm';
import {backendReceiptContext,readToolingBackendReceipt,verifiedRead,verifyBackendActivation} from './lib/backend-publication.mjs';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'bitbi-hosting-review-'));
const results=[];const record=(name,kind='positive')=>results.push({name,kind,passed:true});
const environment={...process.env};
try {
 {
  let calls=0;const waits=[];
  const value=await verifiedRead({provider:'cloudflare',operation:'worker-settings',wait:async milliseconds=>waits.push(milliseconds),action:async()=>{
   calls++;if(calls<3)throw new TypeError('fetch failed',{cause:Object.assign(new Error('private endpoint and credential detail'),{name:'ConnectTimeoutError',code:'UND_ERR_CONNECT_TIMEOUT'})});return 'recovered';
  }});
  assert.equal(value,'recovered');assert.equal(calls,3);assert.deepEqual(waits,[250,500]);
  calls=0;
  await assert.rejects(verifiedRead({provider:'github',operation:'backend-receipt-download',wait:async()=>{},action:async()=>{
   calls++;throw new TypeError('fetch failed SECRET_VALUE',{cause:Object.assign(new Error('https://private.invalid/TOKEN'),{name:'SocketError',code:'UND_ERR_SOCKET'})});
  }}),error=>{
   assert.equal(error.message,'Read verification failed: provider=github operation=backend-receipt-download transport=SocketError code=UND_ERR_SOCKET attempts=3');
   assert(!error.message.includes('SECRET_VALUE')&&!error.message.includes('private.invalid'));return true;
  });
  assert.equal(calls,3);
  calls=0;
  await assert.rejects(verifiedRead({provider:'cloudflare',operation:'d1-read',wait:async()=>{},action:async()=>{calls++;throw Error('Backend D1 verification failed: {"http":403,"category":"authorization"}');}}),/authorization/);
  assert.equal(calls,1,'Authorization failures must not be retried');
  record('backend receipt reads retry transient transport only and expose sanitized provider/operation/cause');
 }
 // Real CLI, real Git fixture and real ZIPs; only HTTP responses are synthetic.
 const fixture=path.join(temp,'checkout');fs.mkdirSync(fixture);
 for(const file of ['scripts','frontend','config/static-hosting.json','workers/contact/package-lock.json']) {
  fs.mkdirSync(path.dirname(path.join(fixture,file)),{recursive:true});fs.cpSync(path.join(root,file),path.join(fixture,file),{recursive:true});
 }
 const initialPolicy=JSON.parse(fs.readFileSync(path.join(fixture,'config/static-hosting.json')));initialPolicy.provider='cloudflare';fs.writeFileSync(path.join(fixture,'config/static-hosting.json'),JSON.stringify(initialPolicy));
 fs.mkdirSync(path.join(fixture,'workers/auth/src'),{recursive:true});fs.writeFileSync(path.join(fixture,'workers/auth/src/index.js'),'// Synthetic unchanged Auth input\n');
 fs.writeFileSync(path.join(fixture,'.gitignore'),'candidate/\n.local/\n');
 const git=args=>execFileSync('git',args,{cwd:fixture,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:'pipe'}).toString().trim();
 git(['init','-q']);git(['add','--all']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic CLI fixture only']);
 const base=git(['rev-parse','HEAD']);
 fs.appendFileSync(path.join(fixture,'frontend/index.mjs'),'\n// Synthetic frontend-only revision.\n');
 git(['add','frontend/index.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic narrow frontend revision']);
 const sha=git(['rev-parse','HEAD']);process.chdir(fixture);
 fs.mkdirSync('candidate/site',{recursive:true});fs.writeFileSync('candidate/site/index.html','<h1>Synthetic static bytes</h1>');
 const selection=gitSelection(base,sha),manifest={schema:2,repository:'bitbiai/Bitbi',sha,base,run:'101',attempt:'1',selection,full:selection.full,mediaPolicy:MEDIA_POLICY,files:tree('candidate/site')};
 assert.equal(selection.full,false);assert.deepEqual(proofJobs(selection),[],'Narrow frontend uses its native runtime proof, no unrelated browser proofs');
 prepareFrontend(manifest,tree);
 const observability=JSON.parse(fs.readFileSync('frontend/wrangler.jsonc')).observability;
 for(const preview of [false,true]) {
  const config=JSON.parse(fs.readFileSync(materializeFrontendConfig('.local/logging-config',{preview})));
  assert.deepEqual(config.observability,observability,'Materialized logging policy changed');
 }
 const configPath='frontend/wrangler.jsonc',originalConfig=fs.readFileSync(configPath);
 for(const change of [c=>delete c.observability,c=>c.observability.logs.invocation_logs=true,c=>c.observability.logs.persist=false,c=>c.observability.logs.head_sampling_rate=1,c=>c.observability.redact_query_string=false,c=>c.observability.traces.enabled=true,c=>c.observability.logs.destinations=['external']]) {
  const c=JSON.parse(originalConfig);change(c);fs.writeFileSync(configPath,JSON.stringify(c));
  try {assert.throws(()=>prepareFrontend(structuredClone(manifest),tree),/logging privacy|Unexpected binding\/route\/config/);}finally{fs.writeFileSync(configPath,originalConfig);}
 }
 record('logging config preserved for preview/production; unsafe sampling/privacy changes rejected');
 fs.writeFileSync('candidate/manifest.json',JSON.stringify(manifest));
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
 const loader=path.join(temp,'http.mjs');fs.writeFileSync(loader,`import fs from 'node:fs';\nconst d=JSON.parse(fs.readFileSync(${JSON.stringify(dataFile)}));\nglobalThis.fetch=async (input,options={})=>{\n if(options.method&&options.method!=='GET')throw Error('Test forbids external writes');\n const u=new URL(input);if(u.hostname!=='api.github.com')throw Error('Unexpected network');\n const p=u.pathname.replace('/repos/bitbiai/Bitbi/','');\n if(p.match(/^actions\\/artifacts\\/\\d+\\/zip$/))return new Response(fs.readFileSync(${JSON.stringify(temp)}+'/'+p.split('/')[2]+'.zip'));\n let r;if(p==='actions/workflows/static.yml/runs')r={workflow_runs:d.runs||[d.run]};else if(p==='actions/runs/101')r=d.run;else if(p==='actions/runs/101/attempts/1/jobs')r={jobs:d.jobs,total_count:d.jobs.length};else if(p==='actions/runs/101/artifacts')r={artifacts:d.artifacts,total_count:d.artifacts.length};else if(p==='actions/runs/202/attempts/1/jobs')r={jobs:d.repairJobs,total_count:d.repairJobs.length};else if(p==='actions/runs/404/attempts/1/jobs')r={jobs:d.publishOnlyJobs,total_count:d.publishOnlyJobs.length};else if(p==='actions/runs')r={workflow_runs:u.searchParams.get('head_sha')===d.run.head_sha?[d.run]:[],total_count:u.searchParams.get('head_sha')===d.run.head_sha?1:0};else if(p.startsWith('git/ref/heads/'))r={object:{sha:d.sha}};else throw Error('Unmapped HTTP '+p);\n return Response.json(r);};\n`);
 const env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp,NODE_OPTIONS:`--import=${loader}`,GH_TOKEN:'synthetic-read-only',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_SHA:sha,CANDIDATE_BASE:base,CANDIDATE_RUN:'101',CANDIDATE_ATTEMPT:'1',CANDIDATE_BRANCH:'prep/workers-static-assets'};
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
 // Real cross-revision CLI: original archived bytes/proofs retain source identity.
 fs.mkdirSync('services/homepage-ffmpeg-processor',{recursive:true});
 fs.writeFileSync('services/homepage-ffmpeg-processor/video-reference.mjs','// Synthetic repair only\n');
 git(['add','services/homepage-ffmpeg-processor/video-reference.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic media repair']);
 const repaired=git(['rev-parse','HEAD']);
 const repairRequirements=requiredJobs({workers:true,mediaLifecycle:true,files:['services/homepage-ffmpeg-processor/video-reference.mjs']});
 repairRequirements['release-compatibility']=repairRequirements['release-compatibility'].filter(n=>n!=='Record candidate build');
 repairRequirements['release-compatibility'].push('Select tests from changed files');repairRequirements['worker-validation'].push('Verify repaired native media smoke');
 const repairJobs=Object.entries(repairRequirements).map(([name,steps])=>({name,head_sha:repaired,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
 const repairEnv={GITHUB_ACTIONS:'true',GITHUB_JOB:'deploy',GITHUB_REF:'refs/heads/main',GITHUB_SHA:repaired,GITHUB_RUN_ID:'202',GITHUB_RUN_ATTEMPT:'1',REPAIR_SOURCE_SHA:sha,REPAIR_SOURCE_RUN:'101',REPAIR_SOURCE_ATTEMPT:'1'};
 const repairData=d=>{d.sha=repaired;d.run.head_branch='main';d.repairJobs=structuredClone(repairJobs);};
 const selectorData=structuredClone(responses);repairData(selectorData);fs.writeFileSync(dataFile,JSON.stringify(selectorData));
 const outputFile=path.join(temp,'selection-output'),envFile=path.join(temp,'selection-env');
 const selected=spawnSync(process.execPath,['scripts/select-ci-tests.mjs','--base',base,'--head',repaired,'--github-output'],{cwd:fixture,env:{...env,...repairEnv,GITHUB_OUTPUT:outputFile,GITHUB_ENV:envFile,CANDIDATE_BASE:base},encoding:'utf8',timeout:30000});
 assert.equal(selected.status,0,selected.stderr);const selectedOutput=fs.readFileSync(outputFile,'utf8');
 for(const line of ['workers=true','media_lifecycle=true','full=false','auth=false','homepage=false','repair_source_sha='+sha,'repair_source_run=101'])assert(selectedOutput.split('\n').includes(line),line);
 assert(fs.readFileSync(envFile,'utf8').includes('REPAIR_SOURCE_SHA='+sha));record('actual CI selector authenticates unchanged source over full unpublished diff');
 cli('repair reuses exact archived frontend identity','production-config',repairData,repairEnv,true);
 cli('repair cannot use failed old validation','production-config',d=>{repairData(d);d.jobs[0].conclusion='failure';},repairEnv);
 cli('repair cannot use expired artifact','production-config',d=>{repairData(d);d.artifacts[0].expired=true;},repairEnv);
 cli('repair cannot use changed archive','production-config',d=>{repairData(d);d.artifacts[0].digest='sha256:'+'0'.repeat(64);},repairEnv);
 for(const title of repairRequirements['worker-validation'])cli('repair requires new '+title,'production-config',d=>{repairData(d);d.repairJobs[1].steps=d.repairJobs[1].steps.filter(s=>s.name!==title);},repairEnv);
 cli('repair cannot substitute current SHA in old artifact','production-config',repairData,{...repairEnv,CANDIDATE_RUN:'202'});
 cli('repair cannot publish superseded head','production-config',d=>{repairData(d);d.sha='d'.repeat(40);},repairEnv);
 fs.appendFileSync('frontend/index.mjs','\n// Changed frontend cannot reuse old bytes\n');
 git(['add','frontend/index.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic incompatible frontend']);
 const incompatible=git(['rev-parse','HEAD']);
 cli('repair rejects changed frontend input','production-config',d=>{repairData(d);d.sha=incompatible;},{...repairEnv,GITHUB_SHA:incompatible});
 // Distinct closed tooling repair: product/Worker inputs are unchanged.
 git(['checkout','--detach',sha]);
 fs.mkdirSync('.github/workflows',{recursive:true});fs.writeFileSync('.github/workflows/static.yml','# Synthetic changed release caller\n');
 fs.appendFileSync('scripts/validate-site-references.mjs','\n// Synthetic reference-check repair\n');
 git(['add','.github/workflows/static.yml','scripts/validate-site-references.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic tooling repair']);
 const toolingSha=git(['rev-parse','HEAD']),toolingFiles=['.github/workflows/static.yml','scripts/validate-site-references.mjs'];
 const toolingContext=backendReceiptContext({sha:toolingSha,base},{REPAIR_SOURCE_SHA:sha,REPAIR_SOURCE_RUN:'101',REPAIR_SOURCE_ATTEMPT:'1'});
 assert.deepEqual(toolingContext,{sha,base,publicationSha:toolingSha,runId:'101',attempt:'1'});
 // Existing backend acceptance may be reused only as its original authenticated
 // identity; ZIP/digest/job checks remain independent of local receipt JSON.
 const backendContext={sha,base,runId:'101',attempt:'1',publicationSha:toolingSha};
 const backendReceipt={sha,base,run:'101',attempt:'1',worker:'bitbi-auth',migration:'0094_model_pricing.sql',version:'auth-original',deployment:'auth-original-deployment',processorRef:sha,sourceTree:git(['rev-parse',`${sha}:workers/auth`]),authBundleDigest:'f'.repeat(64)};
 const backendJob={name:'deploy',head_sha:sha,run_id:101,run_attempt:1,status:'completed',conclusion:'failure',steps:['Apply verified candidate backend prerequisites','Preserve backend activation evidence'].map(name=>({name,status:'completed',conclusion:'success'}))};
 const receiptArchive=value=>{
  const directory=fs.mkdtempSync(path.join(temp,'backend-archive-')),archive=path.join(directory,'receipt.zip');
  fs.writeFileSync(path.join(directory,'backend-release.json'),JSON.stringify(value));
  execFileSync('zip',['-q',archive,'backend-release.json'],{cwd:directory});return fs.readFileSync(archive);
 };
 const receiptBytes=receiptArchive(backendReceipt);
 const receiptArtifact={id:88,name:`backend-receipt-${sha}-101-1`,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),size_in_bytes:receiptBytes.length,digest:`sha256:${hash(receiptBytes)}`,workflow_run:{id:101,head_sha:sha}};
 const backendCheck=async(name,mutate=()=>{},pass=false)=>{
  const d={jobs:[structuredClone(backendJob)],artifacts:[structuredClone(receiptArtifact)],bytes:receiptBytes,context:{...backendContext}};mutate(d);let provenanceChecks=0;
  const promise=readToolingBackendReceipt(d.context,{GH_TOKEN:'synthetic'},{verify:async(_env,options)=>{provenanceChecks++;assert.deepEqual(options,{complete:true});},list:async(endpoint,key)=>{assert(endpoint.startsWith('actions/runs/101/'));return d[key];},download:async(url,options)=>{assert.equal(options.method,undefined,'Receipt retrieval must never mutate production');assert(url.endsWith('/artifacts/88/zip'));return new Response(d.bytes);}});
  if(pass)assert.deepEqual(await promise,backendReceipt);else await assert.rejects(promise);
  assert.equal(provenanceChecks,1);record(name,pass?'positive':'negative');
 };
 await backendCheck('tooling repair retains authenticated already-active backend source identity',()=>{},true);
 for(const [name,mutate] of [
  ['missing receipt',d=>d.artifacts=[]],['expired receipt',d=>d.artifacts[0].expires_at='2000-01-01'],
  ['wrong archive digest',d=>d.artifacts[0].digest='sha256:'+'0'.repeat(64)],
  ['failed backend activation',d=>d.jobs[0].steps[0].conclusion='failure'],
  ['missing source upload',d=>d.jobs[0].steps.pop()],['wrong source job SHA',d=>d.jobs[0].head_sha=incompatible],
  ['wrong source attempt',d=>d.jobs[0].run_attempt=2],['wrong source artifact run',d=>d.artifacts[0].workflow_run.id=202],
  ['ambiguous backend evidence',d=>d.jobs.push(structuredClone(backendJob))],
 ])await backendCheck('backend reuse rejects '+name,mutate);
 for(const field of ['sha','base','run','attempt','processorRef','sourceTree'])await backendCheck('backend reuse rejects wrong receipt '+field,d=>{d.bytes=receiptArchive({...backendReceipt,[field]:'wrong'});d.artifacts[0].size_in_bytes=d.bytes.length;d.artifacts[0].digest=`sha256:${hash(d.bytes)}`;});
 const activation={...backendContext,version:{id:backendReceipt.version,annotations:{'workers/message':`bitbi-auth:${sha}`}},deployment:{id:backendReceipt.deployment,versions:[{version_id:backendReceipt.version,percentage:100}]},migration:backendReceipt.migration,processorSha:sha};
 verifyBackendActivation(backendReceipt,activation);
 assert.throws(()=>verifyBackendActivation(backendReceipt,{...activation,sha:incompatible}));
 assert.throws(()=>verifyBackendActivation(backendReceipt,{...activation,deployment:{...activation.deployment,id:'other-active-deployment'}}));
 assert.deepEqual(backendReceiptContext({sha,base},{ }),{sha,base});
 assert.equal(backendReceiptContext({sha:repaired,base},{REPAIR_SOURCE_SHA:sha}).sha,repaired,'Processor repairs must still publish their changed backend');
 record('receipt reuse cannot relabel source or accept changed production; processor repairs remain deployments');
 // Actual selector after a publish-only failure must retain the original
 // accepted candidate, not treat the failed continuation as fresh validation.
 for(const file of ['scripts/lib/image-delivery-acceptance.mjs','scripts/lib/backend-publication.mjs','scripts/test-release-plan.mjs'])fs.appendFileSync(file,'\n// Synthetic acceptance repair\n');
 git(['add','scripts/lib/image-delivery-acceptance.mjs','scripts/lib/backend-publication.mjs','scripts/test-release-plan.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic image acceptance correction']);
 const imageHead=git(['rev-parse','HEAD']);
 const publishOnly={...run,id:404,head_branch:'main',conclusion:'failure',created_at:'2026-09-12T00:00:00Z'};
 const imageData={...structuredClone(responses),sha:imageHead,run:{...run,head_branch:'main'},runs:[publishOnly,{...run,head_branch:'main'}],publishOnlyJobs:[...Object.keys(requiredJobs(selection)).map(name=>({name,status:'completed',conclusion:'skipped'})),{name:'reuse-candidate',status:'completed',conclusion:'success'},{name:'deploy',status:'completed',conclusion:'failure'}]};
 const imageOutput=path.join(temp,'image-selection-output'),imageEnv=path.join(temp,'image-selection-env');
 const selectImage=()=>spawnSync(process.execPath,['scripts/select-ci-tests.mjs','--base',base,'--head',imageHead,'--github-output'],{cwd:fixture,env:{...env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_SHA:imageHead,GITHUB_RUN_ID:'303',GITHUB_RUN_ATTEMPT:'1',GITHUB_OUTPUT:imageOutput,GITHUB_ENV:imageEnv},encoding:'utf8',timeout:30000});
 fs.writeFileSync(dataFile,JSON.stringify(imageData));const imageSelected=selectImage();assert.equal(imageSelected.status,0,imageSelected.stderr);
 const imageLines=fs.readFileSync(imageOutput,'utf8').split('\n');for(const line of ['repair_source_run=101','repair_source_sha='+sha,'workers=false','auth=false','image_models=false','full=false'])assert(imageLines.includes(line),line);
 imageData.publishOnlyJobs[0].conclusion='failure';fs.writeFileSync(dataFile,JSON.stringify(imageData));assert.notEqual(selectImage().status,0,'Never search past an actual failed validation');
 git(['checkout','--detach',toolingSha]);record('image acceptance actual selector: unchanged source/proofs retained across publish-only failure; actual red validation blocks');

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
 // The active frontend still identifies its original tested bytes, while the
 // completed protected repair revision becomes the next unpublished baseline.
 const D=addReceipt(4,sha,'version-D','deployment-D');D.publicationSha=repaired;D.mediaRepair={sourceSha:sha,publicationSha:repaired};
 db['deployments/4'].payload={receipt:D,receiptSHA256:hash(JSON.stringify(D))};
 db['deployments/2004'].sha=repaired;db['actions/runs/1004'].head_sha=repaired;db['actions/jobs/3004'].head_sha=repaired;
 db['actions/jobs/3004'].steps.push({name:'Apply verified candidate backend prerequisites',status:'completed',conclusion:'success'});
 db['actions/runs/1004/attempts/1/jobs?per_page=100']={jobs:repairJobs};latest=4;current=active(D);
 const repairRead=async endpoint=>endpoint.endsWith('version-D')?{id:D.versionId,annotations:{'workers/message':`bitbi:${D.sha}:${D.run}:1:${D.packageDigest}`}}:read(endpoint);
 assert.equal((await durableBaseline(api,repairRead)).sha,repaired);record('protected media repair baseline keeps original frontend identity');
 db['actions/runs/1004/attempts/1/jobs?per_page=100'].jobs[1].conclusion='failure';await assert.rejects(durableBaseline(api,repairRead));record('repair baseline rejects failed new acceptance','negative');
 const E=addReceipt(5,sha,'version-E','deployment-E');E.publicationSha=toolingSha;E.releaseRepair={kind:'tooling',sourceSha:sha,publicationSha:toolingSha};
 db['deployments/5'].payload={receipt:E,receiptSHA256:hash(JSON.stringify(E))};
 db['deployments/2005'].sha=toolingSha;db['actions/runs/1005'].head_sha=toolingSha;db['actions/jobs/3005'].head_sha=toolingSha;
 db['actions/jobs/3005'].steps.push(...['Apply verified candidate backend prerequisites','Validate candidate references before backend publication'].map(name=>({name,status:'completed',conclusion:'success'})));
 const toolingSteps=requiredJobs({workers:false,files:toolingFiles})['release-compatibility'].filter(n=>n!=='Record candidate build').concat(['Select tests from changed files','Validate static website references']);
 db['actions/runs/1005/attempts/1/jobs?per_page=100']={jobs:[{name:'release-compatibility',head_sha:toolingSha,status:'completed',conclusion:'success',steps:toolingSteps.map(name=>({name,status:'completed',conclusion:'success'}))}]};latest=5;current=active(E);
 const toolingRead=async endpoint=>endpoint.endsWith('version-E')?{id:E.versionId,annotations:{'workers/message':`bitbi:${E.sha}:${E.run}:1:${E.packageDigest}`}}:read(endpoint);
 assert.equal((await durableBaseline(api,toolingRead)).sha,toolingSha);record('protected tooling publication baseline preserves accepted frontend and backend source');
 db['actions/jobs/3005'].steps.pop();await assert.rejects(durableBaseline(api,toolingRead));record('tooling baseline rejects missing before-backend candidate reference check','negative');
 db['actions/jobs/3005'].steps.push({name:'Validate candidate references before backend publication',status:'completed',conclusion:'success'});
 db['actions/runs/1005/attempts/1/jobs?per_page=100'].jobs[0].steps.pop();await assert.rejects(durableBaseline(api,toolingRead));record('tooling baseline rejects missing fresh checker acceptance','negative');

 // Post-activation failure: real Git candidate/repair chain and real ZIP
 // metadata, synthetic platform only. Never upload or pretend the old failed
 // environment job succeeded; the next protected job accepts the same bytes.
 git(['checkout','--detach',toolingSha]);fs.appendFileSync('scripts/frontend-release.mjs','\n// Synthetic verification-only continuation\n');
 git(['add','scripts/frontend-release.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic active publication reconciliation']);
 const reconciliationSha=git(['rev-parse','HEAD']),previous=addReceipt(6,base,'version-previous','deployment-previous');
 const activeVersion='version-pending',activeDeployment='deployment-pending',annotation=`bitbi:${sha}:101:1:${hash(JSON.stringify(manifest))}`;
 const activationRecords=[{type:'wrangler-session',wrangler_version:policy.wranglerVersion,command_line_args:['deploy','--config','/tmp/config','--message',annotation]},{type:'deploy',worker_name:policy.worker,version_id:activeVersion,worker_name_overridden:false}];
 const archiveDir=fs.mkdtempSync(path.join(temp,'pending-upload-')),archivePath=path.join(archiveDir,'upload.zip');
 fs.writeFileSync(path.join(archiveDir,'frontend-upload.ndjson'),activationRecords.map(v=>JSON.stringify(v)).join('\n'));
 execFileSync('zip',['-q',archivePath,'frontend-upload.ndjson'],{cwd:archiveDir});const uploadBytes=fs.readFileSync(archivePath);
 const failedArtifact={id:89,name:`frontend-failed-upload-${toolingSha}-202-1`,expired:false,expires_at:new Date(Date.now()+86400000).toISOString(),size_in_bytes:uploadBytes.length,digest:`sha256:${hash(uploadBytes)}`,workflow_run:{id:202,head_sha:toolingSha}};
 const failedJob={id:4202,run_id:202,run_attempt:1,name:'deploy',head_sha:toolingSha,status:'completed',conclusion:'failure',steps:[...['Validate candidate references before backend publication','Apply verified candidate backend prerequisites','Preserve backend activation evidence','Preserve failed frontend upload identity'].map(name=>({name,status:'completed',conclusion:'success'})),{name:'Deploy and verify Cloudflare frontend',status:'completed',conclusion:'failure'},{name:'Record durable frontend receipt',status:'completed',conclusion:'skipped'}]};
 const pendingSource={...run,head_branch:'main'},failedRun={...pendingSource,id:202,head_sha:toolingSha,conclusion:'failure'};
 const chainedData={...structuredClone(responses),sha:reconciliationSha,run:pendingSource,runs:[failedRun,pendingSource]};fs.writeFileSync(dataFile,JSON.stringify(chainedData));
 const chainedOutput=path.join(temp,'chained-selection-output'),chainedEnv=path.join(temp,'chained-selection-env');
 const chainedSelection=spawnSync(process.execPath,['scripts/select-ci-tests.mjs','--base',base,'--head',reconciliationSha,'--github-output'],{cwd:fixture,env:{...env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_SHA:reconciliationSha,GITHUB_RUN_ID:'303',GITHUB_RUN_ATTEMPT:'1',GITHUB_OUTPUT:chainedOutput,GITHUB_ENV:chainedEnv},encoding:'utf8',timeout:30000});
 assert.equal(chainedSelection.status,0,chainedSelection.stderr);const chainedLines=fs.readFileSync(chainedOutput,'utf8').split('\n');
 for(const line of ['repair_source_sha='+sha,'repair_source_run=101','workers=false','auth=false','full=false'])assert(chainedLines.includes(line),line);
 assert(!chainedLines.includes('repair_source_run=202'),'Repair-only run has no new product acceptance');record('actual chained CI selector keeps original candidate; failed tooling run is not a replacement candidate');
 const pendingState={head:reconciliationSha,previous:structuredClone(previous),source:pendingSource,sourceJobs:structuredClone(jobs),sourceArtifacts:structuredClone(artifacts),failedRun,failedJob,failedArtifact,failedChecks:[{name:'release-compatibility',head_sha:toolingSha,status:'completed',conclusion:'success',steps:toolingSteps.map(name=>({name,status:'completed',conclusion:'success'}))}],version:{id:activeVersion,annotations:{'workers/message':annotation}},active:{id:activeDeployment,versions:[{version_id:activeVersion,percentage:100}]},domains};
 const pendingEnv={GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_SHA:reconciliationSha,GITHUB_RUN_ID:'303',CLOUDFLARE_ACCOUNT_ID:account,GH_TOKEN:'synthetic'};
 function pendingOptions(state) {
  const api=async endpoint=>{
   if(endpoint.includes(`task=${RECEIPT_TASK}`))return [{id:6}];
   if(endpoint===`deployments?environment=${policy.productionEnvironment}&per_page=100`)return [{id:2202,task:'deploy',sha:state.failedRun.head_sha,environment:policy.productionEnvironment}];
   if(endpoint==='git/ref/heads/main')return {object:{sha:state.head}};
   if(endpoint==='deployments/2202')return {id:2202,task:'deploy',sha:state.failedRun.head_sha,environment:policy.productionEnvironment};
   if(endpoint==='deployments/2202/statuses')return [{state:'failure',log_url:`https://github.com/bitbiai/Bitbi/actions/runs/${state.failedRun.id}/job/${state.failedJob.id}`}];
   if(endpoint==='actions/runs/101')return state.source;
   if(endpoint==='actions/runs/101/attempts/1/jobs?per_page=100')return {jobs:state.sourceJobs};
   if(endpoint==='actions/runs/101/artifacts?per_page=100')return {artifacts:state.sourceArtifacts};
   if(endpoint===`actions/runs?head_sha=${sha}&per_page=100`)return {workflow_runs:[state.source]};
   if(endpoint==='actions/runs/202')return state.failedRun;
   if(endpoint===`actions/jobs/${state.failedJob.id}`)return state.failedJob;
   if(endpoint==='actions/runs/202/attempts/1/jobs?per_page=100')return {jobs:state.failedChecks};
   if(endpoint==='actions/runs/202/artifacts?per_page=100')return {artifacts:[state.failedArtifact]};
   assert(endpoint in db,'Unexpected reconciliation read '+endpoint);return structuredClone(db[endpoint]);
  };
  const read=async endpoint=>{if(endpoint==='workers/domains')return state.domains;if(endpoint.endsWith('/deployments'))return {deployments:[state.active]};assert(endpoint.endsWith('/'+activeVersion));return state.version;};
  const download=async(input,options)=>{assert.equal(options.method,undefined,'Reconciliation never mutates production');const id=String(input).match(/artifacts\/(\d+)\/zip$/)?.[1];assert(['1','89'].includes(id));return new Response(id==='89'?uploadBytes:fs.readFileSync(path.join(temp,'1.zip')));};
  return {api,read,download,env:pendingEnv,baseline:{id:6,receipt:state.previous},manifest};
 }
 const pending=await findPendingFrontendActivation(pendingOptions(structuredClone(pendingState)));
 assert.equal(pending.receipt.versionId,activeVersion);assert.equal(pending.receipt.deploymentId,activeDeployment);assert.equal(pending.baseline.sha,base);assert.equal(pending.reconciliation.publicationSha,toolingSha);assert.equal(pending.reconciliation.run,'202');
 const sameHeadState=structuredClone(pendingState);sameHeadState.head=toolingSha;const sameHeadOptions=pendingOptions(sameHeadState);sameHeadOptions.env={...pendingEnv,GITHUB_SHA:toolingSha};
 assert.equal((await findPendingFrontendActivation(sameHeadOptions)).reconciliation.run,'202','Read-only diagnosis recognizes prior failed activation at current main');
 await assert.rejects(findPendingFrontendActivation({...sameHeadOptions,env:{...sameHeadOptions.env,GITHUB_RUN_ID:'202'}}));record('same-head prior activation recognized; failed run cannot authorize its own reconciliation');
 const pendingGate=pendingOptions(structuredClone(pendingState)),oldBaseline=await durableBaseline(pendingGate.api,pendingGate.read,pendingGate);
 assert.equal(oldBaseline.sha,base,'Active but unaccepted candidate cannot become release baseline');assert.equal(oldBaseline.pendingReconciliation.versionId,activeVersion);
 record('protected post-activation reconciliation retains exact candidate and previous accepted baseline without upload');
 for(const [name,mutate] of [
  ['wrong active version',d=>d.active.versions[0].version_id='foreign'],['mixed activation',d=>d.active.versions[0].percentage=50],
  ['wrong package identity',d=>d.version.annotations['workers/message']=annotation.replace(hash(JSON.stringify(manifest)),'0'.repeat(64))],
  ['wrong failed-upload digest',d=>d.failedArtifact.digest='sha256:'+'0'.repeat(64)],['expired upload',d=>d.failedArtifact.expired=true],
  ['wrong artifact run',d=>d.failedArtifact.workflow_run.id=303],['missing protected job',d=>d.failedJob.name='unprotected'],
  ['wrong protected head',d=>d.failedJob.head_sha=sha],['failed repair acceptance',d=>d.failedChecks[0].conclusion='failure'],
  ['missing original required suite',d=>d.sourceJobs.shift()],['failed original required suite',d=>d.sourceJobs[0].conclusion='failure'],
  ['wrong original artifact digest',d=>d.sourceArtifacts[0].digest='sha256:'+'0'.repeat(64)],
  ['superseded repair',d=>d.head=sha],['stale prior baseline',d=>d.previous.sha=sha],
  ['missing domain',d=>d.domains.pop()],['old failure relabelled success',d=>d.failedJob.conclusion='success'],
 ]) {const d=structuredClone(pendingState);mutate(d);await assert.rejects(findPendingFrontendActivation(pendingOptions(d)));record('pending activation rejects '+name,'negative');}
 const accepted=addReceipt(7,sha,activeVersion,activeDeployment);accepted.publicationSha=reconciliationSha;accepted.releaseRepair={kind:'tooling',sourceSha:sha,publicationSha:reconciliationSha};accepted.activationReconciliation=pending.reconciliation;accepted.appearanceAcceptance={verified:['index.html','de/index.html'],revision:1};
 db['deployments/7'].payload={receipt:accepted,receiptSHA256:hash(JSON.stringify(accepted))};db['deployments/2007'].sha=reconciliationSha;db['actions/runs/1007'].head_sha=reconciliationSha;db['actions/jobs/3007'].head_sha=reconciliationSha;
 db['actions/jobs/3007'].steps.push(...['Apply verified candidate backend prerequisites','Validate candidate references before backend publication'].map(name=>({name,status:'completed',conclusion:'success'})));
 db['actions/runs/1007/attempts/1/jobs?per_page=100']={jobs:[{...structuredClone(pendingState.failedChecks[0]),head_sha:reconciliationSha}]};
 const durableState=structuredClone(pendingState);durableState.failedArtifact.expired=true;
 assert.equal((await loadDurableReceipt(7,pendingOptions(durableState).api)).publicationSha,reconciliationSha);
 durableState.failedJob.conclusion='success';await assert.rejects(loadDurableReceipt(7,pendingOptions(durableState).api));
 record('new protected success records unchanged activation durably; old failed job stays failed and archive expiry cannot erase acceptance');
 // Ordinary product publication failed after activation, then main acquired
 // new product bytes. Recognize history without accepting either revision.
 fs.mkdirSync('js/shared',{recursive:true});fs.writeFileSync('js/shared/synthetic-new-product.mjs','export const changedProduct = true;\n');
 git(['add','js/shared/synthetic-new-product.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic new product after failed activation']);
 const newProductSha=git(['rev-parse','HEAD']),ordinary=structuredClone(pendingState);
 ordinary.head=newProductSha;ordinary.failedRun={...ordinary.source,head_sha:sha,conclusion:'failure'};
 ordinary.source=ordinary.failedRun;ordinary.failedJob={...ordinary.failedJob,id:4101,run_id:101,head_sha:sha};
 ordinary.sourceJobs=ordinary.sourceJobs.filter(j=>j.name!=='deploy').concat(ordinary.failedJob);
 ordinary.failedArtifact.name=`frontend-failed-upload-${sha}-101-1`;ordinary.failedArtifact.workflow_run={id:101,head_sha:sha};
 ordinary.sourceArtifacts.push(ordinary.failedArtifact);
 const ordinaryOptions=d=>({...pendingOptions(d),env:{...pendingEnv,GITHUB_SHA:newProductSha}});
 const historical=await findPendingFrontendActivation(ordinaryOptions(ordinary));
 assert.equal(historical.baseline.sha,base);assert.equal(historical.reconciliation.publicationSha,sha);assert.equal(historical.reconciliation.run,'101');
 const gate=ordinaryOptions(ordinary),retained=await durableBaseline(gate.api,gate.read,gate);
 assert.equal(retained.sha,base,'New product must cover complete unpublished range');
 assert.equal(retained.pendingReconciliation.publicationSha,sha);
 assert(gitSelection(base,newProductSha).files.includes('js/shared/synthetic-new-product.mjs'));
 const {repairDelta}=await import('./lib/media-repair-source.mjs');
 assert.throws(()=>repairDelta(sha,newProductSha,base),'Changed product is still forbidden from unchanged-source reuse');
 record('ordinary failed activation plus new product retains old accepted baseline; unchanged-source reuse remains denied');
 for(const [name,mutate] of [
  ['failed original product suite',d=>d.sourceJobs[0].conclusion='failure'],
  ['missing original selected suite',d=>d.sourceJobs.shift()],
  ['wrong original protected job',d=>d.failedJob={...d.failedJob,id:9999}],
  ['wrong original attempt',d=>d.failedJob.run_attempt=2],
  ['foreign original artifact',d=>d.sourceArtifacts[0].workflow_run.head_sha=newProductSha],
  ['invalid failed upload digest',d=>d.failedArtifact.digest='sha256:'+'0'.repeat(64)],
  ['wrong active package',d=>d.version.annotations['workers/message']=annotation.replace(hash(JSON.stringify(manifest)),'0'.repeat(64))],
  ['changed current main',d=>d.head=sha],['missing protected domain',d=>d.domains.pop()],
 ]) {const state=structuredClone(ordinary);mutate(state);await assert.rejects(findPendingFrontendActivation(ordinaryOptions(state)));record('ordinary activation rejects '+name,'negative');}


} finally {
 process.chdir(root);if(environment.CLOUDFLARE_ACCOUNT_ID===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=environment.CLOUDFLARE_ACCOUNT_ID;
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/frontend-review.json',JSON.stringify({syntheticPlatform:true,nativeBrowser:false,results},null,2));
 fs.rmSync(temp,{recursive:true,force:true});
}
console.log(`Frontend review: ${results.length} CLI, effective-permission and durable-recovery controls passed (synthetic platform).`);
