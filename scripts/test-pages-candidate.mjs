import assert from 'node:assert/strict';
import { selectCiTests } from './lib/ci-test-selection.mjs';
import { HOMEPAGE_WEBKIT_REQUIRED } from './lib/homepage-test-selection.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { REPOSITORY, Q4_BASE, REQUIRED_JOBS, requiredJobs, proofJobs, validatePublishedDeployment, verifyAdminReport, tree, validateSource, verifyManifest, verifyProofs, MEDIA_POLICY } from './pages-candidate.mjs';
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
 const env={...process.env,GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:candidateSha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',CANDIDATE_BASE:base,CANDIDATE_FULL:'true'};
 const invoke=(command,extra={})=>{const r=spawnSync(process.execPath,[cli,command],{cwd:dir,env:{...env,...extra},encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 invoke('record');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json')));
 assert.equal(manifest.mediaPolicy,MEDIA_POLICY);
 assert.deepEqual(manifest.selection,selection, 'Scope includes the intervening unpublished Admin commit');
 verifyManifest(manifest,candidateExpected,path.join(dir,'_site'));
 assert.throws(()=>verifyManifest({...manifest,full:false},candidateExpected,path.join(dir,'_site')));
 assert.throws(()=>verifyManifest({...manifest,full:false},candidateExpected,path.join(dir,'_site'),{allowPartial:true}));
 assert.throws(()=>verifyManifest({...manifest,mediaPolicy:'retired'},candidateExpected,path.join(dir,'_site')));
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({stats:{expected:2*HOMEPAGE_WEBKIT_REQUIRED.length,unexpected:0,flaky:0,skipped:0},suites:[{specs:HOMEPAGE_WEBKIT_REQUIRED.map(title=>({file:'homepage-hero-playback.spec.js',title,tests:['webkit','chromium'].map(projectName=>({projectName,expectedStatus:'passed',results:[{status:'passed'}]}))}))}]}));
 for(const job of ['homepage-validation','homepage-webkit-media'])invoke('proof',{GITHUB_JOB:job,CANDIDATE_REPORT:'report.json'});
 const goodReport=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
 fs.mkdirSync(path.join(dir,'test-results'));
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
for(const files of [['admin/index.html','tests/oma2-q3-newsfeed.spec.js'],['README.md'],['workers/auth/src/index.js'],['index.html'],['.github/workflows/static.yml']]) {
 const selection=selectCiTests(files);
 const outputs=Object.fromEntries(Object.entries(selection).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),String(v)]));
 const ctx={needs:{'release-compatibility':{outputs}},steps:{selection:{outputs},homepage_discovery:{outcome:selection.homepage||selection.carousel?'success':'skipped'}},success:()=>true};
 const active=(condition)=>condition ? Boolean(vm.runInNewContext(condition.replace(/^\$\{\{ (.*) \}\}$/,'$1').replace(/needs\.([\w-]+)/g,(_,key)=>`needs[${JSON.stringify(key)}]`),ctx)) : true;
 for(const [job,required] of Object.entries(requiredJobs(selection))) {
   const steps=[...block(job).matchAll(/^      - name: (.+)\n([\s\S]*?)(?=^      - name:|$(?![\s\S]))/gm)];
   for(const title of required) {
     const step=steps.find(m=>m[1]===title);assert(step,`Missing wired step ${title}`);
     assert(active(step[2].match(/^        if: (.+)$/m)?.[1]),`${files}: required step would be skipped: ${title}`);
   }
 }
 if(!selection.homepage&&!selection.carousel)for(const job of ['homepage-validation','homepage-webkit-media']) {
   for(const title of REQUIRED_JOBS[job]) {
     const body=block(job).split(`      - name: ${title}\n`)[1].split('      - name:')[0];
     assert(!active(body.match(/^        if: (.+)$/m)?.[1]),`Unselected ${title} still runs`);
   }
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
const context={github:{event_name:'workflow_dispatch',event:{inputs:{candidate_run_id:'123'}}},cancelled:()=>false,needs:Object.fromEntries([...Object.keys(REQUIRED_JOBS),'reuse-candidate'].map(name=>[name,{result:name==='reuse-candidate'?'success':'skipped'}]))};
assert.equal(permits('release-compatibility',context),false);assert.equal(permits('reuse-candidate',context),true);assert.equal(permits('deploy',context),true);
for(const result of ['failure','skipped','cancelled'])assert.equal(permits('deploy',{...context,needs:{...context.needs,'reuse-candidate':{result}}}),false);
assert.equal(permits('deploy',{...context,cancelled:()=>true}),false);
const normal={...context,github:{event_name:'push',event:{inputs:{}}},needs:Object.fromEntries([...Object.keys(REQUIRED_JOBS),'reuse-candidate'].map(name=>[name,{result:name==='reuse-candidate'?'skipped':'success',outputs:{pages_allowed:'true',pages_required:'true'}}]))};
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
 ['static.yml','browser-validation',['release-compatibility','homepage-validation','homepage-webkit-media','worker-validation']],
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
