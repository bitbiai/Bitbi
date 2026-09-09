import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { REPOSITORY, Q4_BASE, REQUIRED_JOBS, tree, validateSource, verifyManifest, verifyProofs } from './pages-candidate.mjs';
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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-candidate-'));
try {
 fs.mkdirSync(path.join(dir,'_site'));fs.writeFileSync(path.join(dir,'_site/index.html'),'<main>synthetic candidate</main>');
 const cli=new URL('./pages-candidate.mjs',import.meta.url).pathname;
 const env={...process.env,GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:sha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',CANDIDATE_BASE:Q4_BASE,CANDIDATE_FULL:'true'};
 // Actual CLI record -> both browser receipts -> unchanged publication, no build.
 const invoke=(command,extra={})=>{const r=spawnSync(process.execPath,[cli,command],{cwd:dir,env:{...env,...extra},encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 invoke('record');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate/manifest.json')));
 verifyManifest(manifest,expected,path.join(dir,'_site'));
 assert.throws(()=>verifyManifest({...manifest,full:false},expected,path.join(dir,'_site')));
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({stats:{expected:18,unexpected:0,flaky:0,skipped:0}}));
 for(const job of ['homepage-validation','homepage-webkit-media'])invoke('proof',{GITHUB_JOB:job,CANDIDATE_REPORT:'report.json'});
 const proofs=fs.readdirSync(path.join(dir,'candidate-proofs')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,'candidate-proofs',f))));
 verifyProofs(manifest,proofs);assert.throws(()=>verifyProofs(manifest,proofs.slice(1)));assert.throws(()=>verifyProofs(manifest,proofs.map(p=>({...p,manifestHash:'foreign'}))));
 for(const file of fs.readdirSync(path.join(dir,'candidate-proofs')))fs.copyFileSync(path.join(dir,'candidate-proofs',file),path.join(dir,'candidate',file));
 const before=tree(path.join(dir,'_site'));fs.renameSync(path.join(dir,'_site'),path.join(dir,'tested-site'));
 invoke('publish');assert.deepEqual(tree(path.join(dir,'_site')),before);
 fs.writeFileSync(path.join(dir,'_site/index.html'),'wrong token');assert.throws(()=>verifyManifest(manifest,expected,path.join(dir,'_site')));
} finally {fs.rmSync(dir,{recursive:true,force:true});}

// Execute the actual job selection expression: reuse performs no second suite.
const workflow=fs.readFileSync(new URL('../.github/workflows/static.yml',import.meta.url),'utf8');
const block=name=>workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`,'m'))[0];
for (const [job, steps] of Object.entries(REQUIRED_JOBS)) {
  for (const step of steps) assert(block(job).includes(`- name: ${step}\n`), `Unwired required evidence: ${job}/${step}`);
}
assert(block('release-compatibility').includes("CI_FORCE_FULL: 'true'"));
assert(block('release-compatibility').includes('CI_BASE_REF: ${{ env.CANDIDATE_BASE }}'));
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
assert(block('browser-validation').includes('needs: [release-compatibility, homepage-validation]'));
assert(!block('deploy').includes('npm run build:static'),'Publication must not regenerate its tested artifact');
for(const job of ['homepage-validation','homepage-webkit-media'])assert(block(job).includes('node scripts/pages-candidate.mjs restore')&&block(job).includes('node scripts/pages-candidate.mjs proof'));
assert(block('deploy').includes('digest-mismatch: error'));assert(block('deploy').includes('node scripts/pages-candidate.mjs source'));
console.log('Exact candidate/run/attempt/suite/artifact, later-failure, full-scope, immutable bytes and no-second-suite controls passed.');
