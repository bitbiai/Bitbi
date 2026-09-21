import assert from 'node:assert/strict';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { HOMEPAGE_WEBKIT_REQUIRED, flattenHomepageDiscovery } from './lib/homepage-test-selection.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { REPOSITORY, Q4_BASE, REQUIRED_JOBS, requiredJobs, proofJobs, isRequiredValidationRun, validatePublishedDeployment, verifyAdminReport, verifyAssetReport, verifyPublicMediaReport, verifyWorkspaceHelpReport, tree, verifyLaterAttempt, validateSource, verifyManifest, verifyProofs, MEDIA_POLICY } from './pages-candidate.mjs';
const sha='a'.repeat(40),expected={repository:REPOSITORY,sha,base:Q4_BASE,run:'123',attempt:'1',currentRun:'456'};
const run={repository:{full_name:REPOSITORY},head_repository:{full_name:REPOSITORY},head_sha:sha,head_branch:'main',id:123,run_attempt:1,path:'.github/workflows/static.yml',event:'push',status:'completed',conclusion:'success',created_at:'2026-09-09T00:00:00Z'};
const jobs=Object.entries(REQUIRED_JOBS).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
const artifacts=['pages-candidate','pages-proof-homepage-validation','pages-proof-homepage-webkit-media'].map((name,i)=>({id:i+1,name:`${name}-${sha}-123-1`,expired:false,size_in_bytes:123,digest:`sha256:${'b'.repeat(64)}`,workflow_run:{id:123,head_sha:sha}}));
const valid={run,jobs,artifacts,laterRuns:[],mainSha:sha};
assert.equal(validateSource(valid,expected).length,3);
assert.equal(validateSource({...valid,run:{...run,conclusion:'failure'},jobs:[...jobs,{name:'deploy',status:'completed',conclusion:'failure'}]},expected).length,3,'A failed write does not erase completed passing validation');
for(const patch of [{head_sha:'b'.repeat(40)},{run_attempt:2},{repository:{full_name:'foreign/repo'}},{head_repository:{full_name:'foreign/repo'}},{event:'pull_request'},{path:'.github/workflows/full-regression.yml'},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>validateSource({...valid,run:{...run,...patch}},expected));
assert.throws(()=>validateSource(valid,{...expected,base:sha}));assert.throws(()=>validateSource({...valid,mainSha:'b'.repeat(40)},expected));
for(const j of jobs) {
 assert.throws(()=>validateSource({...valid,jobs:jobs.filter(x=>x!==j)},expected));
 assert.throws(()=>validateSource({...valid,jobs:jobs.map(x=>x===j?{...x,conclusion:'skipped'}:x)},expected));
 for(const step of j.steps)assert.throws(()=>validateSource({...valid,jobs:jobs.map(x=>x===j?{...x,steps:x.steps.filter(s=>s!==step)}:x)},expected));
}
for(const a of artifacts) {
 assert.throws(()=>validateSource({...valid,artifacts:artifacts.filter(x=>x!==a)},expected));
 for(const patch of [{expired:true},{digest:null},{workflow_run:{id:999,head_sha:sha}},{size_in_bytes:0}])assert.throws(()=>validateSource({...valid,artifacts:artifacts.map(x=>x===a?{...x,...patch}:x)},expected));
}
for(const [status,conclusion] of [['completed','failure'],['in_progress',null]])assert.throws(()=>validateSource({...valid,laterRuns:[{...run,id:200,created_at:'2026-09-09T01:00:00Z',status,conclusion}]},expected));
assert.equal(validateSource({...valid,laterRuns:[{...run,id:456,created_at:'2026-09-09T01:00:00Z',status:'in_progress'}]},expected).length,3);
// An ordinary Admin release after published Q4 requires its selected Admin
// execution and tested bytes, not unrelated Worker/decoder receipts.
const newsSelection=selectCiTests(['admin/index.html','css/admin/newsfeed.css','js/pages/admin/main.js','js/pages/admin/newsfeed.js','js/pages/admin/router.js','tests/oma2-q3-newsfeed.spec.js']);
assert.equal(newsSelection.full,false);
const ordinary={...expected,base:'843a566372cefc7184a11a73ab981801ef7854ed',selection:newsSelection};
const newsJobs=Object.entries(requiredJobs(newsSelection)).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
const newsArtifacts=[artifacts[0],{...artifacts[1],name:`pages-proof-browser-validation-${sha}-123-1`}];
const newsEvidence={...valid,jobs:newsJobs,artifacts:newsArtifacts};
assert.deepEqual(proofJobs(newsSelection),['browser-validation']);
assert.equal(validateSource({...newsEvidence,jobs:[...newsJobs,{name:'worker-validation',conclusion:'skipped'}]},ordinary).length,2);
for(const name of Object.keys(requiredJobs(newsSelection))) {
 for(const result of ['failure','skipped','cancelled'])assert.throws(()=>validateSource({...newsEvidence,jobs:newsJobs.map(j=>j.name===name?{...j,conclusion:result}:j)},ordinary));
 assert.throws(()=>validateSource({...newsEvidence,jobs:newsJobs.filter(j=>j.name!==name)},ordinary));
}
assert.throws(()=>validateSource({...newsEvidence,artifacts:[newsArtifacts[0]]},ordinary));
assert.throws(()=>validateSource({...newsEvidence,laterRuns:[{...run,id:200,created_at:'2026-09-09T01:00:00Z',conclusion:'failure'}]},ordinary));
const published={environment:'github-pages',sha};
const status={state:'success',log_url:'https://github.com/bitbiai/Bitbi/actions/runs/123/job/456'};
const deploymentJob={id:456,head_sha:sha,status:'completed',conclusion:'success',steps:[{name:'Deploy to GitHub Pages',status:'completed',conclusion:'success'}]};
assert.equal(validatePublishedDeployment(published,status,run,deploymentJob),sha);
for(const patch of [{state:'pending'},{state:'failure'},{log_url:'https://github.com/foreign/repo/actions/runs/123/job/456'}])assert.throws(()=>validatePublishedDeployment(published,{...status,...patch},run,deploymentJob));
for(const patch of [{head_sha:'b'.repeat(40)},{steps:[]},{conclusion:'skipped'},{id:999}])assert.throws(()=>validatePublishedDeployment(published,status,run,{...deploymentJob,...patch}));
assert.throws(()=>validatePublishedDeployment(published,status,{...run,path:'.github/workflows/unknown.yml'},deploymentJob));
const adminReport={stats:{expected:10,unexpected:0,flaky:0,skipped:0},suites:[{specs:[]}]} ;
for(const engine of ['chromium','webkit'])for(const [scope,files] of [
 ['reader',['oma2-q3-newsfeed.spec.js','oma2-q3-shell.spec.js','oma2-q3-auth-lifecycle.spec.js']],
 ['mfa',['auth-admin.spec.js']],['smoke',['smoke.spec.js']],
])for(const file of files)adminReport.suites[0].specs.push({id:engine+file,file,tests:[{projectName:`${engine}-${scope}`,results:[{status:'passed'}]}]});
verifyAdminReport(adminReport,adminReport);
for(const fault of ['missing','failed','skipped','empty','foreign']) {
 const bad=structuredClone(adminReport);
 if(fault==='missing')bad.suites[0].specs.pop();
 else if(fault==='empty')bad.suites=[];
 else if(fault==='foreign')bad.suites[0].specs[0].id='wrong-build-case';
 else bad.suites[0].specs[0].tests[0].results[0].status=fault;
 assert.throws(()=>verifyAdminReport(bad,adminReport),fault);
}
assert.throws(()=>verifyAdminReport({suites:[]},{suites:[]}));
const missingDiscovery=structuredClone(adminReport);missingDiscovery.suites[0].specs.pop();
assert.throws(()=>verifyAdminReport(missingDiscovery,missingDiscovery));
// Synthetic repositories inherit OS settings, never the invoking release's
// identity, tokens or Actions output files. Poisoned parent values exercise
// this boundary locally as well as in the actual repair CI environment.
const parentEnv={...process.env,REPAIR_SOURCE_SHA:'f'.repeat(40),REPAIR_SOURCE_RUN:'987',REPAIR_SOURCE_ATTEMPT:'7',CANDIDATE_RUN:'987',CANDIDATE_ATTEMPT:'7'};
const processKeys=['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','WINDIR','LANG','LC_ALL'];
const fixtureProcessEnv=Object.fromEntries(processKeys.filter(key=>parentEnv[key]!==undefined).map(key=>[key,parentEnv[key]]));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-candidate-'));
try {
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
 fs.writeFileSync(path.join(dir,'README.md'),'base');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 fs.mkdirSync(path.join(dir,'admin'));fs.writeFileSync(path.join(dir,'admin/index.html'),'unpublished news');git('add','.');git('commit','-qm','failed unpublished push');
 fs.mkdirSync(path.join(dir,'.github/workflows'),{recursive:true});fs.writeFileSync(path.join(dir,'.github/workflows/full-regression.yml'),'synthetic broad input');
 git('add','.');git('commit','-qm','candidate');const candidateSha=git('rev-parse','HEAD');
 const selection=selectCiTests(['.github/workflows/full-regression.yml','admin/index.html']);
 const candidateExpected={...expected,sha:candidateSha,base,selection};
 fs.mkdirSync(path.join(dir,'_site'));fs.writeFileSync(path.join(dir,'_site/index.html'),'<main>synthetic candidate</main>');
 const cli=new URL('./pages-candidate.mjs',import.meta.url).pathname;
 const env={...fixtureProcessEnv,GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:candidateSha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',CANDIDATE_BASE:base,CANDIDATE_FULL:'true'};
 const invoke=(command,extra={})=>{const r=spawnSync(process.execPath,[cli,command],{cwd:dir,env:{...env,...extra},encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 assert.throws(()=>invoke('record',{REPAIR_SOURCE_SHA:parentEnv.REPAIR_SOURCE_SHA}),/Not a valid commit name/,'The production CLI must still reject a foreign repair identity');
 invoke('record');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json')));
 assert.deepEqual([manifest.sha,manifest.base,manifest.run,manifest.attempt],[candidateSha,base,'123','1'],'Parent release identity must not enter fixture artifacts');
 assert.equal(manifest.mediaPolicy,MEDIA_POLICY);
 assert.deepEqual(manifest.selection,selection, 'Scope includes the intervening unpublished Admin commit');
 verifyManifest(manifest,candidateExpected,path.join(dir,'_site'));
 assert.throws(()=>verifyManifest({...manifest,full:false},candidateExpected,path.join(dir,'_site')));
 assert.throws(()=>verifyManifest({...manifest,full:false},candidateExpected,path.join(dir,'_site'),{allowPartial:true}));
 assert.throws(()=>verifyManifest({...manifest,mediaPolicy:'retired'},candidateExpected,path.join(dir,'_site')));
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({stats:{expected:2*HOMEPAGE_WEBKIT_REQUIRED.length,unexpected:0,flaky:0,skipped:0},suites:[{specs:HOMEPAGE_WEBKIT_REQUIRED.map(title=>({file:'homepage-hero-playback.spec.js',title,tests:['webkit','chromium'].map(projectName=>({projectName,expectedStatus:'passed',results:[{status:'passed'}]}))}))}]}));
 fs.mkdirSync(path.join(dir,'test-results'));
 fs.writeFileSync(path.join(dir,'test-results/homepage-discovery.json'),JSON.stringify({status:'passed',collections:{functional:flattenHomepageDiscovery(JSON.parse(fs.readFileSync(path.join(dir,'report.json'))))}}));
 for(const job of ['homepage-validation','homepage-webkit-media'])invoke('proof',{GITHUB_JOB:job,CANDIDATE_REPORT:'report.json'});
 const goodReport=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
 for(const name of ['static','carousel'])fs.copyFileSync(path.join(dir,'report.json'),path.join(dir,`test-results/candidate-${name}.json`));
 invoke('proof',{GITHUB_JOB:'browser-validation'});
 for(const fault of ['missing','unexecuted','failed','empty']) {
   const bad=structuredClone(goodReport);
   if(fault==='empty')bad.suites=[];
   else if(fault==='missing')bad.suites[0].specs.pop();
   else bad.suites[0].specs[0].tests[0].results=fault==='unexecuted'?[]:[{status:'failed'}];
   fs.writeFileSync(path.join(dir,'bad-report.json'),JSON.stringify(bad));
   assert.throws(()=>invoke('proof',{GITHUB_JOB:'homepage-webkit-media',CANDIDATE_REPORT:'bad-report.json'}));
 }
 const proofs=fs.readdirSync(path.join(dir,'candidate-proofs')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,'candidate-proofs',f))));
 verifyProofs(manifest,proofs);assert.throws(()=>verifyProofs(manifest,proofs.slice(1)));assert.throws(()=>verifyProofs(manifest,proofs.map(p=>({...p,manifestHash:'foreign'}))));
 for(const file of fs.readdirSync(path.join(dir,'candidate-proofs')))fs.copyFileSync(path.join(dir,'candidate-proofs',file),path.join(dir,'candidate',file));
 const before=tree(path.join(dir,'_site'));fs.renameSync(path.join(dir,'_site'),path.join(dir,'tested-site'));
 invoke('publish');assert.deepEqual(tree(path.join(dir,'_site')),before);
 fs.writeFileSync(path.join(dir,'_site/index.html'),'wrong token');assert.throws(()=>verifyManifest(manifest,candidateExpected,path.join(dir,'_site')));
 // The same real CLI accepts an ordinary post-publication Admin build with
 // only its selected browser receipt, and refuses absent/empty evidence.
 fs.mkdirSync(path.join(dir,'js/pages/admin'),{recursive:true});fs.writeFileSync(path.join(dir,'js/pages/admin/newsfeed.js'),'// synthetic Admin input');
 git('add','js/pages/admin/newsfeed.js');git('commit','-qm','ordinary Admin');
 const ordinarySha=git('rev-parse','HEAD'),ordinarySelection=selectCiTests(['js/pages/admin/newsfeed.js']);
 Object.assign(env,{GITHUB_SHA:ordinarySha,CANDIDATE_BASE:candidateSha,CANDIDATE_FULL:'false'});
 fs.rmSync(path.join(dir,'candidate'),{recursive:true});fs.rmSync(path.join(dir,'candidate-proofs'),{recursive:true});
 invoke('record');const ordinaryManifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json')));
 verifyManifest(ordinaryManifest,{...expected,sha:ordinarySha,base:candidateSha,selection:ordinarySelection},path.join(dir,'_site'));
 assert.equal(ordinaryManifest.full,false);
 assert.throws(()=>invoke('proof',{GITHUB_JOB:'homepage-webkit-media',CANDIDATE_REPORT:'report.json'}));
 assert.throws(()=>invoke('proof',{GITHUB_JOB:'browser-validation'}));
 fs.writeFileSync(path.join(dir,'test-results/candidate-admin-release.json'),JSON.stringify({stats:{expected:1,unexpected:0,flaky:0},suites:[]}));
 assert.throws(()=>invoke('proof',{GITHUB_JOB:'browser-validation'}));
 fs.writeFileSync(path.join(dir,'test-results/admin-discovery.json'),JSON.stringify(adminReport));
 fs.writeFileSync(path.join(dir,'test-results/candidate-admin-release.json'),JSON.stringify(adminReport));invoke('proof',{GITHUB_JOB:'browser-validation'});
 fs.copyFileSync(path.join(dir,'candidate-proofs/proof-browser-validation.json'),path.join(dir,'candidate/proof-browser-validation.json'));
 const ordinaryBytes=tree(path.join(dir,'_site'));fs.rmSync(path.join(dir,'_site'),{recursive:true});invoke('publish');assert.deepEqual(tree(path.join(dir,'_site')),ordinaryBytes);

 // The real selector CLI and candidate record independently read the same Git
 // sources. No source context or a neighboring credit edit may narrow the spec.
 fs.mkdirSync(path.join(dir,'tests'),{recursive:true});
 const memberFile='tests/oma2-q1-member.spec.js';
 const memberSource=fs.readFileSync(new URL('../'+memberFile,import.meta.url),'utf8');
 fs.writeFileSync(path.join(dir,memberFile),memberSource);git('add',memberFile);git('commit','-qm','published member tests');
 const pickerBase=git('rev-parse','HEAD');
 fs.mkdirSync(path.join(dir,'js/pages/canvas'),{recursive:true});
 fs.writeFileSync(path.join(dir,'js/pages/canvas/asset-picker.js'),'// synthetic picker');
 fs.writeFileSync(path.join(dir,memberFile),memberSource.replace('expect(accepted).toBe(1);','expect(accepted).toBe(1); // body-only correction'));
 git('add',memberFile,'js/pages/canvas/asset-picker.js');git('commit','-qm','picker and saved-state test');
 fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
 fs.copyFileSync(new URL('./select-ci-tests.mjs',import.meta.url),path.join(dir,'scripts/select-ci-tests.mjs'));
 fs.symlinkSync(new URL('./lib',import.meta.url).pathname,path.join(dir,'scripts/lib'),'dir');
 for(const broader of [false,true]) {
   if(broader) {fs.appendFileSync(path.join(dir,memberFile),'\n// changed shared/other member context');git('add',memberFile);git('commit','-qm','broader member change');}
   const pickerHead=git('rev-parse','HEAD');
   const selected=spawnSync(process.execPath,['scripts/select-ci-tests.mjs','--base',pickerBase,'--head',pickerHead],{cwd:dir,env:fixtureProcessEnv,encoding:'utf8'});
   assert.equal(selected.status,0,selected.stderr);
   const parsed=JSON.parse(selected.stdout.slice(selected.stdout.indexOf('{')));
   assert.equal(parsed.policy==='member-assets-v1',!broader);
   fs.rmSync(path.join(dir,'candidate'),{recursive:true});
   Object.assign(env,{GITHUB_SHA:pickerHead,CANDIDATE_BASE:pickerBase});
   invoke('record');
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json'))).selection,parsed,'Selector and proof source contracts must agree');
 }
} finally {fs.rmSync(dir,{recursive:true,force:true});}

// Execute the actual job selection expression: reuse performs no second suite.
const workflow=fs.readFileSync(new URL('../.github/workflows/static.yml',import.meta.url),'utf8');
const block=name=>workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`,'m'))[0];
for (const [job, steps] of Object.entries(REQUIRED_JOBS)) {
  for (const step of steps) assert(block(job).includes(`- name: ${step}\n`), `Unwired required evidence: ${job}/${step}`);
}
assert(!block('release-compatibility').includes('CI_FORCE_FULL:'));
assert(block('release-compatibility').includes('CI_BASE_REF: ${{ env.CANDIDATE_BASE }}'));
assert(!block('release-compatibility').includes('github.event.before'));
// Evaluate the real selected-step conditions, not only job names/counts.
for(const files of [['workers/media/src/index.js','scripts/test-private-media-lifecycle.mjs'],['js/pages/index/public-media-detail-panel.js'],['js/shared/saved-assets-browser.js','workers/auth/src/lib/asset-names.js'],['admin/index.html','tests/oma2-q3-newsfeed.spec.js'],['README.md'],['workers/auth/src/index.js'],['index.html'],['.github/workflows/static.yml'],['css/components/news-pulse.css'],['tests/homepage-hero-playback.spec.js']]) {
 const selection=selectCiTests(files);
 const outputs=Object.fromEntries(Object.entries(selection).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),String(v)]));
 const ctx={env:{REPAIR_SOURCE_SHA:''},needs:{'release-compatibility':{outputs}},steps:{selection:{outputs},media_image:{outputs:{required:String(files.some(f=>f.startsWith('workers/media/')))}},homepage_discovery:{outcome:selection.homepage||selection.carousel?'success':'skipped'}},success:()=>true};
 const active=(condition)=>condition ? Boolean(vm.runInNewContext(condition.replace(/^\$\{\{ (.*) \}\}$/,'$1').replace(/needs\.([\w-]+)/g,(_,key)=>`needs[${JSON.stringify(key)}]`),ctx)) : true;
 for(const [job,required] of Object.entries(requiredJobs(selection))) {
   const steps=[...block(job).matchAll(/^      - name: (.+)\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/gm)];
   for(const title of required) {
     const step=steps.find(m=>m[1]===title);assert(step,`Missing wired step ${title}`);
     assert(active(step[2].match(/^        if: (.+)$/m)?.[1]),`${files}: required step would be skipped: ${title}`);
   }
 }
 for(const job of ['homepage-validation','homepage-webkit-media']) if(!requiredJobs(selection)[job]) {
   const title=job==='homepage-validation'?'Run Linux homepage functional acceptance':REQUIRED_JOBS[job][0];
   const body=block(job).split(`      - name: ${title}\n`)[1].split('      - name:')[0];
   assert(!active(body.match(/^        if: (.+)$/m)?.[1]),`Unselected ${title} still runs`);
 }

}
assert(workflow.includes('deployments: read'),'Verified baseline needs read-only deployment metadata permission');
for(const job of ['release-compatibility','homepage-validation','homepage-webkit-media','browser-validation','reuse-candidate','deploy']) {
 const checkout=block(job).split('uses: actions/checkout@v5')[1].split('      - name:')[0];
 assert(checkout.includes('fetch-depth: 0'),'Candidate scope needs its historical base in every consumer');
}
assert(block('browser-validation').includes('STATIC_TEST_ROOT: _site'));
assert(block('browser-validation').includes('node scripts/pages-candidate.mjs restore'));
assert(block('browser-validation').includes('pages-proof-browser-validation-'));
const expression=name=>block(name).match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
const permits=(name,ctx)=>Boolean(vm.runInNewContext(expression(name).replace(/needs\.([\w-]+)/g, (_, key) => `needs[${JSON.stringify(key)}]`),ctx));
const context={github:{ref:'refs/heads/main',event_name:'workflow_dispatch',event:{inputs:{candidate_run_id:'123'}}},cancelled:()=>false,needs:Object.fromEntries([...Object.keys(REQUIRED_JOBS),'reuse-candidate'].map(name=>[name,{result:name==='reuse-candidate'?'success':'skipped'}]))};
assert.equal(permits('release-compatibility',context),false);assert.equal(permits('reuse-candidate',context),true);assert.equal(permits('deploy',context),true);
for(const result of ['failure','skipped','cancelled'])assert.equal(permits('deploy',{...context,needs:{...context.needs,'reuse-candidate':{result}}}),false);
assert.equal(permits('deploy',{...context,cancelled:()=>true}),false);
const normal={...context,github:{ref:'refs/heads/main',event_name:'push',event:{inputs:{}}},needs:Object.fromEntries([...Object.keys(REQUIRED_JOBS),'reuse-candidate'].map(name=>[name,{result:name==='reuse-candidate'?'skipped':'success',outputs:{pages_allowed:'true',pages_required:'true',workers:'true',homepage:'true',homepage_media:'true',carousel:'true',assets:'true',auth:'true'}}]))};
const validationOnly={...normal,needs:{...normal.needs,'release-compatibility':{result:'success',outputs:{pages_allowed:'false',pages_required:'true'}}}};
assert.equal(permits('deploy',{...normal,needs:{...normal.needs,'release-compatibility':{result:'success',outputs:{}}}}),false);
assert.equal(permits('deploy',validationOnly),false,'Validation-only run must not acquire the production write lock');
assert.equal(permits('release-compatibility',normal),true);assert.equal(permits('reuse-candidate',normal),false);assert.equal(permits('deploy',normal),true);
for(const name of Object.keys(REQUIRED_JOBS))assert.equal(permits('deploy',{...normal,needs:{...normal.needs,[name]:{...normal.needs[name],result:'failure'}}}),false);
assert(!/^concurrency:/m.test(workflow));assert(block('deploy').includes('group: "pages"'));
assert(block('browser-validation').includes('needs: [release-compatibility, homepage-validation, homepage-webkit-media, worker-validation]'));
assert(!block('deploy').includes('npm run build:static'),'Publication must not regenerate its tested artifact');
for(const job of ['homepage-validation','homepage-webkit-media'])assert(block(job).includes('node scripts/pages-candidate.mjs restore')&&block(job).includes('node scripts/pages-candidate.mjs proof'));
assert(block('deploy').includes('digest-mismatch: error'));assert(block('deploy').includes('node scripts/pages-candidate.mjs source'));
console.log('Exact candidate/run/attempt/suite/artifact, later-failure, full-scope, immutable bytes and no-second-suite controls passed.');

for (const [file,jobName,required] of [
 ['full-regression.yml','browser-tests',['release-security','homepage-validation','homepage-webkit-media','worker-tests']],
]) {
 const source=fs.readFileSync(new URL(`../.github/workflows/${file}`,import.meta.url),'utf8');
 const section=source.match(new RegExp(`^  ${jobName}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`,'m'))[0];
 const dependencies=section.match(/^    needs: \[(.+)\]/m)[1].split(',').map(s=>s.trim());
 assert.deepEqual(dependencies,required);
 assert(!/^    if:/m.test(section),'Default success() must retain upstream failure/cancellation gating');
 const starts=states=>dependencies.every(name=>states[name]==='success');
 const passed=Object.fromEntries(required.map(name=>[name,'success']));
 assert(starts(passed));
 for(const name of required)for(const state of ['failure','cancelled','skipped',undefined])assert(!starts({...passed,[name]:state}),`${file} started after ${name}/${state}`);
 // Worker job deliberately reporting unselected work is successful. That is
 // different from a required failed/skipped job; existing selection owns it.
 assert(starts({...passed,[required.at(-1)]:'success'}));
}

// Execute the actual job conditions: unrelated jobs are skipped, while every
// selected result and every selection flag must be present and successful.
const narrow=structuredClone({github:normal.github,needs:normal.needs});narrow.cancelled=()=>false;
Object.assign(narrow.needs['release-compatibility'].outputs,{workers:'false',homepage:'false',homepage_media:'false',carousel:'false',assets:'false',auth:'false'});
for(const name of ['worker-validation','homepage-validation','homepage-webkit-media','browser-validation']) {
 narrow.needs[name].result='skipped';assert(!permits(name,narrow),name+' must not allocate a runner');
}
assert(permits('deploy',narrow),'Native frontend/release-only candidate publishes without browser/backend jobs');
for(const key of ['workers','homepage','homepage_media','carousel','assets','auth']) {
 const missing={...narrow,needs:structuredClone(narrow.needs)};delete missing.needs['release-compatibility'].outputs[key];
 assert(!permits('deploy',missing),'Missing selection '+key);
 const selected={...narrow,needs:structuredClone(narrow.needs)};selected.needs['release-compatibility'].outputs[key]='true';
 assert(!permits('deploy',selected),'Skipped selected '+key);
}
const adminOnly={...narrow,needs:structuredClone(narrow.needs)};adminOnly.needs['release-compatibility'].outputs.auth='true';
assert(permits('browser-validation',adminOnly),'Admin starts despite unrelated skipped upstream jobs');
adminOnly.needs['browser-validation'].result='success';assert(permits('deploy',adminOnly));
for(const result of ['failure','cancelled','skipped',undefined]) {
 const bad={...normal,needs:structuredClone(normal.needs)};
 for(const name of ['worker-validation','homepage-validation','homepage-webkit-media']) {
  const c={...bad,needs:structuredClone(bad.needs)};c.needs[name].result=result;
  assert(!permits('browser-validation',c),name+'/'+result);assert(!permits('deploy',c));
 }
 const c={...adminOnly,needs:structuredClone(adminOnly.needs)};c.needs['browser-validation'].result=result;assert(!permits('deploy',c));
}
assert(!permits('deploy',{...narrow,cancelled:()=>true}));

const loggingSelection=selectCiTests(['frontend/index.mjs','frontend/wrangler.jsonc','scripts/lib/ci-test-selection.mjs']);
const loggingExpected={...ordinary,selection:loggingSelection};
const loggingJobs=Object.entries(requiredJobs(loggingSelection)).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
assert.deepEqual(Object.keys(requiredJobs(loggingSelection)),['release-compatibility']);assert.deepEqual(proofJobs(loggingSelection),[]);
const loggingEvidence={...valid,jobs:loggingJobs,artifacts:[artifacts[0]]};
assert.equal(validateSource(loggingEvidence,loggingExpected).length,1);
for(const step of loggingJobs[0].steps)for(const state of ['failure','skipped',undefined]) {
 const bad=structuredClone(loggingJobs);bad[0].steps.find(s=>s.name===step.name).conclusion=state;
 assert.throws(()=>validateSource({...loggingEvidence,jobs:bad},loggingExpected));
}
const loggingManifest={selection:loggingSelection,hosting:{},sha};
const loggingProof={job:'frontend-runtime',manifestHash:crypto.createHash('sha256').update(JSON.stringify(loggingManifest)).digest('hex'),status:'passed',tests:28,reportHash:'synthetic-runtime'};
verifyProofs(loggingManifest,[loggingProof]);
for(const patch of [{tests:0},{status:'failed'},{manifestHash:'wrong'}])assert.throws(()=>verifyProofs(loggingManifest,[{...loggingProof,...patch}]));
assert.throws(()=>verifyProofs(loggingManifest,[]));
for(const status of ['in_progress','completed']) {
 assert.equal(isRequiredValidationRun({path:'.github/workflows/full-regression.yml'},loggingSelection),false);
 assert.equal(isRequiredValidationRun({path:'.github/workflows/full-regression.yml'},{full:true}),true);
 const extended={...run,path:'.github/workflows/full-regression.yml',id:200,created_at:'2026-09-09T01:00:00Z',status,conclusion:'failure'};
 assert.equal(validateSource({...loggingEvidence,laterRuns:[extended]},loggingExpected).length,1);
 assert.throws(()=>validateSource({...valid,laterRuns:[extended]},expected),'Full selection still requires its later full acceptance');
 assert.throws(()=>validateSource({...loggingEvidence,laterRuns:[{...extended,path:'.github/workflows/static.yml'}]},loggingExpected));
}

// Real Playwright discovery guards this config against lost News coverage or an
// accidental single-engine/empty selection. It does not execute the browser.
const discoveryDir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-admin-discovery-'));
try {
 const root=new URL('../',import.meta.url).pathname;
 const discover=(config,files=[])=>{
   const output=path.join(discoveryDir,'list.json');
   const r=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','-c',config,...files,'--list','--reporter=json'],{cwd:root,env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_NAME:output},encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);return JSON.parse(fs.readFileSync(output));
 };
 const scoped=discover('playwright.admin-release.config.js');
 const baseline=discover('playwright.config.js',['tests/oma2-q3-newsfeed.spec.js']);
 const cases=(report,project)=>{
   const result=[];const visit=suite=>{for(const spec of suite.specs||[])if(path.basename(spec.file)==='oma2-q3-newsfeed.spec.js'&&spec.tests.some(t=>t.projectName===project))result.push(`${spec.line}:${spec.title}`);(suite.suites||[]).forEach(visit);};(report.suites||[]).forEach(visit);return result.sort();
 };
 const allNews=cases(baseline,'chromium');assert(allNews.length>0);
 for(const engine of ['chromium','webkit'])assert.deepEqual(cases(scoped,`${engine}-reader`),allNews,'Every existing News scenario must be selected');
 // Fill synthetic result statuses only to exercise the discovery contract;
 // real acceptance still requires the separate actual report and bytes.
 const sample=structuredClone(scoped);const fill=suite=>{for(const spec of suite.specs||[])for(const t of spec.tests)t.results=[{status:'passed'}];(suite.suites||[]).forEach(fill);};sample.suites.forEach(fill);
 verifyAdminReport(sample,scoped);
 console.log(`Admin discovery: ${allNews.length} News scenarios in each engine; all reader/MFA/smoke groups present (discovery only).`);
} finally { fs.rmSync(discoveryDir,{recursive:true,force:true}); }

// Exercise the workflow's real discovery -> execution commands. No browser
// fixture is requested: this isolates Playwright's output cleanup lifecycle.
const lifecycleDir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-admin-report-lifecycle-')));
try {
 const root=new URL('../',import.meta.url).pathname;
 const commands=block('browser-validation').split('      - name: Run selected Admin release acceptance\n')[1]
   .split('      - name:')[0].split('        run: |\n')[1].trim().split('\n').map(line=>line.trim());
 assert.equal(commands.length,3,'Keep lifecycle regression aligned with the complete Admin command sequence');
 for(const oldLayout of [true,false]) {
   const cwd=path.join(lifecycleDir,oldLayout?'old':'fixed');fs.mkdirSync(cwd);
   fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({scripts:{'test:static':`node ${JSON.stringify(path.join(root,'node_modules/@playwright/test/cli.js'))} test`}}));
   fs.writeFileSync(path.join(cwd,'playwright.admin-release.config.js'),`
     const config=require(${JSON.stringify(path.join(root,'playwright.admin-release.config.js'))});
     module.exports={...config,testDir:__dirname,webServer:undefined,
       outputDir:require('node:path').resolve(__dirname,${oldLayout?"'test-results'":"config.outputDir"}),
       projects:config.projects.map(project=>({...project,testMatch:'lifecycle.spec.js',grep:undefined}))};
   `);
   fs.writeFileSync(path.join(cwd,'lifecycle.spec.js'),`
     const {test,expect}=require(${JSON.stringify(path.join(root,'node_modules/@playwright/test'))});
     test('writes disposable evidence',async({},info)=>{
       require('node:fs').writeFileSync(info.outputPath('artifact.txt'),'current run');
       expect(true).toBe(true);
     });
   `);
   const discovery=path.join(cwd,'test-results/admin-discovery.json');
   const report=path.join(cwd,'test-results/candidate-admin-release.json');
   const output=path.join(cwd,oldLayout?'test-results':'test-results/admin-artifacts');
   fs.mkdirSync(output,{recursive:true});
   for(const file of [discovery,report,path.join(output,'stale.txt')])fs.writeFileSync(file,'stale');
   const execute=command=>{
     const r=spawnSync('/bin/sh',['-ec',command],{cwd,env:{...process.env,CI:'1'},encoding:'utf8',timeout:30000});
     assert.equal(r.status,0,r.error?.message||r.stdout+r.stderr);
   };
   execute(commands[0]);assert(!fs.existsSync(discovery)&&!fs.existsSync(report),'Evidence starts fresh');
   execute(commands[1]);const before=fs.readFileSync(discovery);
   const listed=JSON.parse(before);assert.equal(listed.config.projects.length,6);
   for(const project of listed.config.projects)assert.equal(project.outputDir,output);
   execute(commands[2]);
   assert(!fs.existsSync(path.join(output,'stale.txt')),'Disposable output must still be cleaned');
   const result=JSON.parse(fs.readFileSync(report));
   assert.equal(result.stats.expected,6);assert.equal(result.stats.unexpected+result.stats.skipped+result.stats.flaky,0);
   assert.equal(fs.existsSync(discovery),!oldLayout,'Old layout must lose discovery; fixed layout must retain it');
   if(!oldLayout)assert.deepEqual(fs.readFileSync(discovery),before,'Execution must preserve exact pre-run discovery bytes');
 }
 console.log('Actual Playwright lifecycle: old layout loses discovery; isolated artifacts retain fresh discovery and all 6 project results. Browser-free control.');
} finally {fs.rmSync(lifecycleDir,{recursive:true,force:true});}

// Same config and npm/workflow commands as the selected Assets -> Auth job.
// Only the product scenarios are replaced by tiny browser-free cases.
const sequenceDir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-selected-report-lifecycle-')));
try {
 const root=new URL('../',import.meta.url).pathname;
 const workflow=block('browser-validation');
 const stepRun=name=>workflow.split(`      - name: ${name}\n`)[1].split('      - name:')[0]
   .split('        run: ')[1].replace(/^\|\n/,'').trim().split('\n').map(s=>s.trim()).join('\n');
 const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).scripts;
 for(const oldLayout of [true,false]) {
   const cwd=path.join(sequenceDir,oldLayout?'old':'fixed');fs.mkdirSync(cwd);
   const git=(...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
   git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
   fs.writeFileSync(path.join(cwd,'README.md'),'base');
   fs.mkdirSync(path.join(cwd,'tests'));
   for(const file of ['assets-manager-focused.spec.js','auth-admin.spec.js','oma2-q1-member.spec.js','canvas.spec.js','oma2-q1-canvas.spec.js'])fs.writeFileSync(path.join(cwd,'tests',file),`
     const {test,expect}=require(${JSON.stringify(path.join(root,'node_modules/@playwright/test'))});
     test('${file==='auth-admin.spec.js'?'account Assets Manager lets the owner publish':file==='oma2-q1-member.spec.js'?'durable generation selected':'selected cards'}',async({},info)=>{
       expect(require('node:fs').existsSync(require('node:path').join(info.project.outputDir,'stale.txt'))).toBe(false);
       require('node:fs').writeFileSync(info.outputPath('artifact.txt'),'current invocation');
     });
   `);
   git('add','README.md','tests/canvas.spec.js','tests/oma2-q1-canvas.spec.js');git('commit','-qm','base');
   const base=git('rev-parse','HEAD');
   git('add','.');git('commit','-qm','selected candidate');const head=git('rev-parse','HEAD');
   fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({scripts:Object.fromEntries(['test:static','test:assets-manager','test:auth'].map(name=>[name,scripts[name].replace(/^playwright /,`node ${JSON.stringify(path.join(root,'node_modules/@playwright/test/cli.js'))} `)]))}));
   fs.writeFileSync(path.join(cwd,'playwright.config.js'),`
     const config=require(${JSON.stringify(path.join(root,'playwright.config.js'))});
     module.exports={...config,testDir:require('node:path').join(__dirname,'tests'),webServer:undefined,
       retries:0};
   `);
   fs.writeFileSync(path.join(cwd,'playwright.assets.config.js'),fs.readFileSync(path.join(root,'playwright.assets.config.js'),'utf8') + `\nmodule.exports.outputDir=${JSON.stringify(oldLayout?'test-results':'test-results/asset-artifacts')};`);
   fs.mkdirSync(path.join(cwd,'scripts'));fs.writeFileSync(path.join(cwd,'scripts/pages-candidate.mjs'),`import {spawnSync} from 'node:child_process';const r=spawnSync(process.execPath,[${JSON.stringify(new URL('./pages-candidate.mjs',import.meta.url).pathname)},...process.argv.slice(2)],{stdio:'inherit'});process.exitCode=r.status ?? 1;`);
   const env={...fixtureProcessEnv,CI:'1',GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:head,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'browser-validation',CANDIDATE_BASE:base,CANDIDATE_FULL:'false'};
   const execute=(command,success=true,extra={})=>{if(oldLayout)command=command.replace(' --output=test-results/browser-artifacts','');const r=spawnSync('/bin/sh',['-ec',command],{cwd,env:{...env,...extra},encoding:'utf8',timeout:30000});assert.equal(r.status===0,success,r.error?.message||r.stdout+r.stderr);return r;};
   fs.mkdirSync(path.join(cwd,'_site'));fs.writeFileSync(path.join(cwd,'_site/index.html'),'synthetic tested build');
   execute('node scripts/pages-candidate.mjs record');fs.rmSync(path.join(cwd,'_site'),{recursive:true});
   const reportDir=path.join(cwd,'test-results');fs.mkdirSync(reportDir);
   const reports=['candidate-assets.json','candidate-auth.json'].map(f=>path.join(reportDir,f));
   for(const f of reports)fs.writeFileSync(f,'stale report');
   execute(stepRun('Restore exact candidate static site'));
   for(const f of reports)assert(!fs.existsSync(f),'Restore must remove stale evidence before any selected invocation');
   execute(stepRun('Confirm tested browser candidate bytes'),false);
   execute(stepRun('Run selected Assets Manager tests'));
   const first=fs.readFileSync(reports[0]);
   const report=JSON.parse(first);assert.equal(report.stats.expected,10);
   const output=report.config.projects[0].outputDir;
   assert.equal(output,path.join(cwd,oldLayout?'test-results':'test-results/asset-artifacts'));
   const nextOutput=path.join(cwd,oldLayout?'test-results':'test-results/browser-artifacts');
   fs.mkdirSync(nextOutput,{recursive:true});
   fs.writeFileSync(path.join(nextOutput,'stale.txt'),'previous invocation');
   execute(stepRun('Run selected auth and admin tests').replaceAll('${{ needs.release-compatibility.outputs.model_pricing }}','false').replaceAll('${{ needs.release-compatibility.outputs.canvas_text }}','false').replaceAll('${{ needs.release-compatibility.outputs.public_media }}','false').replaceAll('${{ needs.release-compatibility.outputs.model_pricing }}','false').replaceAll('${{ needs.release-compatibility.outputs.canvas_text }}','false').replaceAll('${{ needs.release-compatibility.outputs.model_status }}','false').replaceAll('${{ needs.release-compatibility.outputs.workspace_help }}','false'));
   assert(!fs.existsSync(path.join(nextOutput,'stale.txt')),'Second invocation must still clean disposable output');
   assert.equal(fs.existsSync(reports[0]),!oldLayout);
   execute(stepRun('Confirm tested browser candidate bytes'),!oldLayout);
   if(!oldLayout) {
     assert.deepEqual(fs.readFileSync(reports[0]),first);
     const proofFile=path.join(cwd,'candidate-proofs/proof-browser-validation.json');
     const proof=JSON.parse(fs.readFileSync(proofFile));assert.equal(proof.tests,12);
     const auth=fs.readFileSync(reports[1]);
     for(const fault of ['missing','failed','empty']) {
       if(fault==='missing')fs.unlinkSync(reports[1]);
       else {const bad=JSON.parse(auth);bad.stats.expected=0;bad.stats.unexpected=fault==='failed'?1:0;fs.writeFileSync(reports[1],JSON.stringify(bad));}
       execute(stepRun('Confirm tested browser candidate bytes'),false);fs.writeFileSync(reports[1],auth);
     }
     for(const extra of [{GITHUB_SHA:'b'.repeat(40)},{GITHUB_RUN_ID:'999'},{GITHUB_RUN_ATTEMPT:'2'}])execute(stepRun('Confirm tested browser candidate bytes'),false,extra);
     fs.appendFileSync(path.join(cwd,'_site/index.html'),'changed bytes');execute(stepRun('Confirm tested browser candidate bytes'),false);
   }
 }
 console.log('Actual selected Assets -> Auth -> proof: old output loses Assets; fixed output preserves both reports, cleans disposable files and rejects missing/failed/empty evidence or wrong candidate identity.');
} finally {fs.rmSync(sequenceDir,{recursive:true,force:true});}

for(const c of [context,normal]) {
 assert.equal(permits('deploy',{...c,github:{...c.github,ref:'refs/heads/prep/hosting'}}),false);
 assert.equal(permits('deploy',{...c,github:{...c.github,event:{inputs:{...c.github.event.inputs,validation_only:'true'}}}}),false);
}

const assetReport={suites:[{specs:[]}]};
for(const engine of ['chromium','webkit'])for(const [scope,file] of [['cards','assets-manager-focused.spec.js'],['jobs','oma2-q1-member.spec.js'],['actions','auth-admin.spec.js'],['canvas','canvas.spec.js'],['canvas','oma2-q1-canvas.spec.js']])
 assetReport.suites[0].specs.push({id:engine+file,file,tests:[{projectName:`${engine}-${scope}`,results:[{status:'passed'}]}]});
verifyAssetReport(assetReport,assetReport);
for (const file of ['canvas.spec.js','oma2-q1-canvas.spec.js']) {
 const missing=structuredClone(assetReport);missing.suites[0].specs=missing.suites[0].specs.filter(spec=>spec.file!==file);
 assert.throws(()=>verifyAssetReport(missing,missing),/Missing required Admin discovery/);
}
for(const fault of ['missing','failed','skipped','empty','foreign']) {
 const bad=structuredClone(assetReport);
 if(fault==='missing')bad.suites[0].specs.pop();
 else if(fault==='empty')bad.suites=[];
 else if(fault==='foreign')bad.suites[0].specs[0].id='another-case';
 else bad.suites[0].specs[0].tests[0].results[0].status=fault;
 assert.throws(()=>verifyAssetReport(bad,assetReport),fault);
}
assert.throws(()=>verifyAssetReport({suites:[]},{suites:[]}));

const detailReport={suites:[{specs:['chromium','webkit'].map(engine=>({
 id:engine+'-dialog',file:'public-media-dialog.spec.js',tests:[{projectName:engine+'-dialog',results:[{status:'passed'}]}]
}))}]};
detailReport.suites[0].specs.push({id:'route',file:'workers.spec.js',title:'public Memvid file and poster routes original contract',tests:[{projectName:'file-contract',results:[{status:'passed'}]}]});
for(const engine of ['chromium','webkit'])for(const file of ['smoke.spec.js','auth-admin.spec.js'])detailReport.suites[0].specs.push({id:engine+file,file,tests:[{projectName:engine+'-neighbors',results:[{status:'passed'}]}]});
verifyPublicMediaReport(detailReport,detailReport);
for(const status of ['failed','skipped','timedOut']) {
 const bad=structuredClone(detailReport);bad.suites[0].specs[0].tests[0].results[0].status=status;
 assert.throws(()=>verifyPublicMediaReport(bad,detailReport));
}
const missingRoute=structuredClone(detailReport);missingRoute.suites[0].specs=missingRoute.suites[0].specs.filter(spec=>spec.file!=='workers.spec.js');
assert.throws(()=>verifyPublicMediaReport(missingRoute,missingRoute));
const missingBrowser=structuredClone(detailReport);missingBrowser.suites[0].specs.shift();
assert.throws(()=>verifyPublicMediaReport(missingBrowser,detailReport));
const detailSelection=selectCiTests(['js/pages/index/public-media-detail-panel.js']);
assert.deepEqual(Object.keys(requiredJobs(detailSelection)),['release-compatibility','browser-validation']);
assert(requiredJobs(detailSelection)['browser-validation'].includes('Run selected auth and admin tests'));

const dialogContext=structuredClone(normal.needs);
dialogContext['release-compatibility'].outputs={pages_allowed:'true',pages_required:'true',workers:'false',homepage:'false',homepage_media:'false',carousel:'false',assets:'false',auth:'true',public_media:'true'};
for(const job of ['worker-validation','homepage-validation','homepage-webkit-media'])dialogContext[job].result='skipped';
const publicContext={...normal,needs:dialogContext};
assert(permits('browser-validation',publicContext));assert(permits('deploy',publicContext));
for(const result of ['failure','skipped','cancelled',undefined]) {
 assert(!permits('deploy',{...publicContext,needs:{...dialogContext,'browser-validation':{result}}}));
}

const workspaceDiscovery={suites:[{specs:['chromium','webkit'].flatMap(engine=>[
 {id:engine+'-form',file:'smoke.spec.js',tests:[{projectName:engine+'-workspace',results:[]}]},
 {id:engine+'-copy',file:'locale.spec.js',tests:[{projectName:engine+'-guidance',results:[]}]},
])}]};
const workspaceReport=structuredClone(workspaceDiscovery);
for(const spec of workspaceReport.suites[0].specs)spec.tests[0].results=[{status:'passed'}];
verifyWorkspaceHelpReport(workspaceReport,workspaceDiscovery);
for(const status of ['failed','skipped','timedOut']) {
 const invalid=structuredClone(workspaceReport);invalid.suites[0].specs[0].tests[0].results=[{status}];
 assert.throws(()=>verifyWorkspaceHelpReport(invalid,workspaceDiscovery));
}
const missingWorkspace=structuredClone(workspaceReport);missingWorkspace.suites[0].specs.pop();
assert.throws(()=>verifyWorkspaceHelpReport(missingWorkspace,workspaceDiscovery));
assert.throws(()=>verifyWorkspaceHelpReport({suites:[]},{suites:[]}));
const workspaceSelection=selectCiTests(['js/pages/generate-lab/model-help.js']);
assert.deepEqual(Object.keys(requiredJobs(workspaceSelection)),['release-compatibility','browser-validation']);
const workspaceNeeds=structuredClone(dialogContext);
workspaceNeeds['release-compatibility'].outputs.public_media='false';
workspaceNeeds['release-compatibility'].outputs.workspace_help='true';
assert(permits('browser-validation',{...normal,needs:workspaceNeeds}));
assert(permits('deploy',{...normal,needs:workspaceNeeds}));
for(const result of ['failure','skipped','cancelled',undefined])assert(!permits('deploy',{...normal,needs:{...workspaceNeeds,'browser-validation':{result}}}));
// Execute the actual selected shell branch. Browser results above and in the
// dedicated config are separate from this command-routing/fail-fast control.
const workspaceShell=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-workspace-shell-'));
try {
 const text=fs.readFileSync(new URL('../.github/workflows/static.yml',import.meta.url),'utf8');
 const block=text.split('      - name: Run selected auth and admin tests\n')[1].split('\n      - name:')[0];
 const command=block.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n')
   .replaceAll('${{ needs.release-compatibility.outputs.model_pricing }}','false').replaceAll('${{ needs.release-compatibility.outputs.canvas_text }}','false').replaceAll('${{ needs.release-compatibility.outputs.model_status }}','false').replaceAll('${{ needs.release-compatibility.outputs.workspace_help }}','true')
   .replaceAll('${{ needs.release-compatibility.outputs.public_media }}','false');
 fs.writeFileSync(path.join(workspaceShell,'npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> calls\nexit "${FAIL_NPM:-0}"\n',{mode:0o755});
 for(const fail of ['0','1']) {
   fs.rmSync(path.join(workspaceShell,'calls'),{force:true});
   const result=spawnSync('bash',['-e','-c',command],{cwd:workspaceShell,env:{...process.env,PATH:workspaceShell+':'+process.env.PATH,FAIL_NPM:fail},encoding:'utf8'});
   assert.equal(result.status,Number(fail));
   const calls=fs.readFileSync(path.join(workspaceShell,'calls'),'utf8').trim().split('\n');
   assert.equal(calls.length,fail==='0'?2:1);
   assert(calls[0].includes('--config playwright.workspace.config.js --list --reporter=json'));
   if(fail==='0')assert(calls[1].includes('--config playwright.workspace.config.js --reporter=list,json'));
 }
} finally {fs.rmSync(workspaceShell,{recursive:true,force:true});}

const {verifyModelStatusReport}=await import('./pages-candidate.mjs');
const statusDiscovery={suites:[{specs:['chromium','webkit'].map(engine=>({id:engine+'-status',file:'oma2-q3-model-status.spec.js',tests:[{projectName:engine+'-status',results:[]}]}))}]};
const statusReport=structuredClone(statusDiscovery);for(const s of statusReport.suites[0].specs)s.tests[0].results=[{status:'passed'}];
verifyModelStatusReport(statusReport,statusDiscovery);
for(const status of ['failed','skipped','timedOut']){const wrong=structuredClone(statusReport);wrong.suites[0].specs[0].tests[0].results=[{status}];assert.throws(()=>verifyModelStatusReport(wrong,statusDiscovery));}
assert.throws(()=>verifyModelStatusReport({suites:[]},statusDiscovery));
const statusSelection=selectCiTests(['workers/auth/src/lib/admin-model-status.js','js/pages/admin/model-status.js']);
assert.deepEqual(Object.keys(requiredJobs(statusSelection)),['release-compatibility','worker-validation','browser-validation']);
const statusShell=fs.readFileSync(new URL('../.github/workflows/static.yml',import.meta.url),'utf8').split('      - name: Run selected auth and admin tests\n')[1].split('\n      - name:')[0].split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n').replaceAll('${{ needs.release-compatibility.outputs.model_pricing }}','false').replaceAll('${{ needs.release-compatibility.outputs.canvas_text }}','false').replaceAll('${{ needs.release-compatibility.outputs.model_status }}','true').replaceAll('${{ needs.release-compatibility.outputs.workspace_help }}','false').replaceAll('${{ needs.release-compatibility.outputs.public_media }}','false');
const statusTmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-status-shell-'));
try{
 fs.mkdirSync(path.join(statusTmp,'test-results'));fs.writeFileSync(path.join(statusTmp,'npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> calls\nexit "${FAIL_NPM:-0}"\n',{mode:0o755});
 for(const fail of ['0','37']){fs.rmSync(path.join(statusTmp,'calls'),{force:true});const r=spawnSync('bash',['-e','-c',statusShell],{cwd:statusTmp,env:{...process.env,PATH:statusTmp+':'+process.env.PATH,FAIL_NPM:fail},encoding:'utf8'});assert.equal(r.status,Number(fail));const calls=fs.readFileSync(path.join(statusTmp,'calls'),'utf8').trim().split('\n');assert.equal(calls.length,fail==='0'?2:1);assert(calls[0].includes('playwright.model-status.config.js --list'));if(fail==='0')assert(calls[1].includes('playwright.model-status.config.js --reporter=list,json'));}
}finally{fs.rmSync(statusTmp,{recursive:true,force:true});}

const layoutContext={...normal,needs:structuredClone(normal.needs)};
Object.assign(layoutContext.needs['release-compatibility'].outputs,{workers:'false',homepage_media:'false',carousel:'false',assets:'false',auth:'false'});
layoutContext.needs['worker-validation'].result='skipped';layoutContext.needs['homepage-webkit-media'].result='skipped';
assert(permits('browser-validation',layoutContext)); assert(permits('deploy',layoutContext));
assert(!permits('homepage-webkit-media',layoutContext));
for(const result of ['failure','skipped',undefined]) {
 const bad={...layoutContext,needs:structuredClone(layoutContext.needs)};
 bad.needs['homepage-validation'].result=result;assert(!permits('browser-validation',bad));assert(!permits('deploy',bad));
}
layoutContext.needs['release-compatibility'].outputs.homepage_media='true';
assert(!permits('browser-validation',layoutContext));assert(!permits('deploy',layoutContext));
layoutContext.needs['homepage-webkit-media'].result='success';assert(permits('deploy',layoutContext));

// Registry parity must reach the ordinary production caller, not only a fast-path flag.
const models=selectCiTests(['js/shared/member-model-exposure.mjs']);
assert(requiredJobs(models)['browser-validation'].includes('Run selected homepage core tests'));
const fastWorkflow=fs.readFileSync(new URL('../.github/workflows/ui-fast-deploy.yml',import.meta.url),'utf8');
const fastCondition=fastWorkflow.match(/    if: \$\{\{ (!cancelled\(\).*ui_only.*) \}\}/)[1].replace(/needs\.([\w-]+)/g,(_,k)=>`needs[${JSON.stringify(k)}]`);
const fastContext={cancelled:()=>false,needs:{guard:{result:'success',outputs:{ui_only:'true',homepage_media:'false'}},'homepage-validation':{result:'success'},'homepage-webkit-media':{result:'skipped'}}};
const fastPermits=()=>Boolean(vm.runInNewContext(fastCondition,fastContext));
assert(fastPermits());fastContext.needs.guard.outputs.homepage_media='true';assert(!fastPermits());
for(const result of ['failure','cancelled',undefined]) {fastContext.needs['homepage-webkit-media'].result=result;assert(!fastPermits());}
fastContext.needs['homepage-webkit-media'].result='success';assert(fastPermits());
fastContext.needs['homepage-validation'].result='failure';assert(!fastPermits());

verifyLaterAttempt({...run,run_attempt:2,conclusion:'failure'},[{name:'deploy',conclusion:'failure'}],newsSelection);
assert.throws(()=>verifyLaterAttempt({...run,status:'in_progress'},[{name:'deploy',conclusion:null}],newsSelection));
assert.throws(()=>verifyLaterAttempt({...run,conclusion:'failure'},[{name:'deploy',conclusion:'skipped'},{name:'browser-validation',conclusion:'failure'}],newsSelection));

{
 const selection=selectCiTests(['workers/media/src/index.js','scripts/test-private-media-lifecycle.mjs']);
 const required=requiredJobs(selection);
 const selectedJobs=Object.entries(required).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
 const scope={...ordinary,selection},evidence={...valid,jobs:selectedJobs,artifacts:[artifacts[0]]};
 assert.equal(validateSource(evidence,scope).length,1);
 const worker=selectedJobs.find(j=>j.name==='worker-validation');
 for(const result of ['failure','skipped','cancelled'])assert.throws(()=>validateSource({...evidence,jobs:selectedJobs.map(j=>j===worker?{...j,conclusion:result}:j)},scope));
 for(const step of worker.steps)assert.throws(()=>validateSource({...evidence,jobs:selectedJobs.map(j=>j===worker?{...j,steps:j.steps.filter(s=>s!==step)}:j)},scope));
 assert.throws(()=>validateSource({...evidence,mainSha:'b'.repeat(40)},scope));
 console.log('Media lifecycle selection: real required steps, missing/failed execution and supersession remain blocking.');
}

{
  const {verifyCanvasTextReport,requiredJobs}=await import('./pages-candidate.mjs');
  const suite=(result=true)=>({suites:[{specs:['canvas.spec.js','oma2-q1-canvas.spec.js','auth-admin.spec.js','smoke.spec.js'].map((file,i)=>({id:String(i),file,tests:['chromium','webkit-canvas'].map(projectName=>({projectName,results:result?[{status:'passed'}]:[]}))}))}]});
  const report=suite(),discovery=suite(false);verifyCanvasTextReport(report,discovery);
  for(const status of ['skipped','failed','timedOut']){const bad=structuredClone(report);bad.suites[0].specs[0].tests[0].results=[{status}];assert.throws(()=>verifyCanvasTextReport(bad,discovery));}
  const missing=structuredClone(report);missing.suites[0].specs.pop();assert.throws(()=>verifyCanvasTextReport(missing,discovery));
  const jobs=requiredJobs({canvasText:true,workers:true,auth:true,static:true});assert(jobs['worker-validation']);assert(jobs['browser-validation']);assert(!jobs['homepage-webkit-media']);
}

{
 const {assertRepairFiles,repairSelection,assertRepairAcceptance}=await import('./lib/media-repair-source.mjs');
 const files=['services/homepage-ffmpeg-processor/video-reference.mjs','workers/auth/src/lib/private-media-smoke.js','.github/workflows/static.yml'];
 const full=selectCiTests(['js/pages/canvas/main.js',...files]);
 const repair=repairSelection(full,files);
 assert.equal(repair.workers,true);assert.equal(repair.mediaLifecycle,true);assert.equal(repair.canvasText,false);
 for(const key of ['auth','homepage','homepageMedia','carousel','full'])assert.equal(repair[key],false);
 assert.deepEqual(repair.files,full.files,'Complete unpublished range remains recorded');
 for(const file of ['index.html','workers/auth/src/lib/session.js','workers/ai/src/index.js','unknown.mjs','services/homepage-ffmpeg-processor/processor.mjs'])assert.throws(()=>assertRepairFiles([...files,file]));
 const required=requiredJobs(repair);required['release-compatibility']=required['release-compatibility'].filter(n=>n!=='Record candidate build');
 required['release-compatibility'].push('Select tests from changed files');required['worker-validation'].push('Verify repaired native media smoke');
 const jobs=Object.entries(required).map(([name,steps])=>({name,head_sha:sha,status:'completed',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}));
 assertRepairAcceptance(jobs,sha);
 for(const j of jobs) {
  assert.throws(()=>assertRepairAcceptance(jobs.filter(x=>x!==j),sha));
  for(const conclusion of ['failure','skipped','cancelled'])assert.throws(()=>assertRepairAcceptance(jobs.map(x=>x===j?{...x,conclusion}:x),sha));
  for(const step of j.steps)assert.throws(()=>assertRepairAcceptance(jobs.map(x=>x===j?{...x,steps:x.steps.filter(s=>s!==step)}:x),sha));
 }
 assert.throws(()=>assertRepairAcceptance(jobs,'d'.repeat(40)));
 const outputs=Object.fromEntries(Object.entries(repair).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),String(v)]));
 outputs.repair_source_sha=sha;
 const context={needs:{'release-compatibility':{outputs}},env:{REPAIR_SOURCE_SHA:sha},success:()=>true,steps:{media_image:{outputs:{required:'true'}}}};
 const active=body=>{const condition=body.match(/^        if: (.+)$/m)?.[1];return !condition||Boolean(vm.runInNewContext(condition.replace(/needs\.([\w-]+)/g,(_,k)=>`needs[${JSON.stringify(k)}]`),context));};
 for(const name of ['Run worker route tests','Verify native Linux isolation before Worker tests'])assert(!active(block('worker-validation').split(`- name: ${name}\n`)[1].split('      - name:')[0]));
 for(const name of required['worker-validation'])assert(active(block('worker-validation').split(`- name: ${name}\n`)[1].split('      - name:')[0]),name);
 assert(!active(block('release-compatibility').split('- name: Record candidate build\n')[1].split('      - name:')[0]));
 console.log('Closed media repair: unchanged candidate identity, full range, fresh native/image checks and unknown/security deltas fail closed.');
}

const {verifyModelPricingReport}=await import('./pages-candidate.mjs');
const pricingDiscovery={suites:[{specs:['chromium','webkit'].map(engine=>({id:engine+'-pricing',file:'oma2-q3-model-pricing.spec.js',tests:[{projectName:engine+'-pricing',results:[]}]}))}]};
const pricingReport=structuredClone(pricingDiscovery);for(const spec of pricingReport.suites[0].specs)spec.tests[0].results=[{status:'passed'}];
verifyModelPricingReport(pricingReport,pricingDiscovery);
for(const status of ['failed','skipped','timedOut']){const wrong=structuredClone(pricingReport);wrong.suites[0].specs[0].tests[0].results=[{status}];assert.throws(()=>verifyModelPricingReport(wrong,pricingDiscovery));}
assert.throws(()=>verifyModelPricingReport({suites:[]},pricingDiscovery));
assert.throws(()=>verifyModelPricingReport(pricingReport,{suites:[]}));
const pricingSelected=selectCiTests(['workers/auth/src/lib/model-tariffs.js','tests/oma2-q3-model-pricing.spec.js']);
assert.deepEqual(Object.keys(requiredJobs(pricingSelected)),['release-compatibility','worker-validation','browser-validation']);
// Execute the exact named browser branch; fail-fast preserves the discovery/run contract.
const pricingShell=fs.readFileSync(new URL('../.github/workflows/static.yml',import.meta.url),'utf8').split('      - name: Run selected auth and admin tests\n')[1].split('\n      - name:')[0].split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n').replaceAll('${{ needs.release-compatibility.outputs.model_pricing }}','true');
const pricingTmp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-pricing-shell-'));
try{
 fs.mkdirSync(path.join(pricingTmp,'test-results'));fs.writeFileSync(path.join(pricingTmp,'npm'),'#!/bin/sh\nprintf "%s\\n" "$*" >> calls\nexit "${FAIL_NPM:-0}"\n',{mode:0o755});
 for(const fail of ['0','37']){fs.rmSync(path.join(pricingTmp,'calls'),{force:true});const result=spawnSync('bash',['-e','-c',pricingShell],{cwd:pricingTmp,env:{...process.env,PATH:pricingTmp+':'+process.env.PATH,FAIL_NPM:fail},encoding:'utf8'});assert.equal(result.status,Number(fail),result.stderr);const calls=fs.readFileSync(path.join(pricingTmp,'calls'),'utf8').trim().split('\n');assert.equal(calls.length,fail==='0'?2:1);assert(calls[0].includes('playwright.model-pricing.config.js --list'));if(fail==='0')assert(calls[1].includes('playwright.model-pricing.config.js --reporter=list,json'));}
}finally{fs.rmSync(pricingTmp,{recursive:true,force:true});}
console.log('Pricing: actual selected shell, both engines and missing/failed/skipped/empty report rejection.');
