import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createReleasePlanFromRepo} from './lib/release-plan.mjs';
import {backendContinuationSupported} from './lib/backend-continuation.mjs';
import {assertSupportedBackendMigrations,advanceBackend} from './lib/backend-publication.mjs';
import {sourceExpectation} from './lib/frontend-source.mjs';
import {selectCiTests} from './lib/ci-test-selection.mjs';
const root=process.cwd(),migration='0118_retire_missing_member_stripe_customers.sql';
const contactFiles=['workers/contact/src/index.js','workers/contact/src/lib/contact-mail.js'];
const combinedFiles=[...contactFiles,'workers/auth/src/lib/stripe-billing.js',`workers/auth/migrations/${migration}`];
const contact=createReleasePlanFromRepo(root,{files:contactFiles}),combined=createReleasePlanFromRepo(root,{files:combinedFiles});
assert.deepEqual(contact.workerDeploys.map(s=>s.worker),['contact']);assert.deepEqual(contact.schemaApplies,[]);
assert.deepEqual(combined.workerDeploys.map(s=>s.worker),['auth','contact']);assert.equal(combined.schemaApplies[0].latestMigration,migration);
for(const plan of [contact,combined]){assert(backendContinuationSupported(plan));assert.equal(plan.staticDeploy.required,false);}
assertSupportedBackendMigrations([migration],combined);
assert.throws(()=>assertSupportedBackendMigrations(['0117_consumer_contracts.sql'],combined),/outside this candidate/);
assert.throws(()=>assertSupportedBackendMigrations(['9999_unknown.sql']),/Unexpected pending/);
for(const file of ['workers/contact/wrangler.jsonc','workers/contact/package.json','workers/contact/src/unreviewed.js','workers/ai/src/routes/unreviewed.js','workers/other/src/index.js'])
  assert(!backendContinuationSupported(createReleasePlanFromRepo(root,{files:[...combinedFiles,file]})),file);
assert(!backendContinuationSupported({...contact,manualPrerequisites:{required:[{worker:'contact',kind:'secret',name:'UNAPPROVED'}]}}));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-contact-guard-'));
try {
 for(const [name,files] of [['contact',contactFiles],['combined',combinedFiles]]) {
  const output=path.join(temp,name);
  const result=spawnSync(process.execPath,['scripts/check-static-deploy-safety.mjs','--files',files.join(','),'--event-name','push','--backend-preflight','--github-output'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output}});
  assert.equal(result.status,0,result.stderr);const values=fs.readFileSync(output,'utf8');
  assert.match(values,/backend_continuation=true/);assert.match(values,/static_deploy_allowed=false/,'Plan admission alone cannot authorize publication');
 }
 const invalid=spawnSync(process.execPath,['scripts/check-static-deploy-safety.mjs','--base','HEAD','--head','0'.repeat(40),'--event-name','push','--backend-preflight'],{cwd:root,encoding:'utf8'});
 assert.match(invalid.stdout,/untrusted-ci-context/);assert.doesNotMatch(invalid.stdout,/Supported backend prerequisites pending/);
 const env={...process.env};for(const key of ['GITHUB_ACTIONS','GITHUB_JOB','GITHUB_REF','GH_TOKEN','CLOUDFLARE_API_TOKEN','CF_BACKEND_DEPLOY_TOKEN'])delete env[key];
 // Use the actual protected CLI; a local invocation cannot create deployment authority.
 const protectedCall=spawnSync(process.execPath,[path.join(root,'scripts/release-apply.mjs'),'--ci-verified-candidate'],{cwd:temp,encoding:'utf8',env});
 assert.notEqual(protectedCall.status,0);assert(!fs.existsSync(path.join(temp,'test-results/backend-release.json')));
 assert.throws(()=>sourceExpectation(false,{GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_SHA:'a'.repeat(40),CANDIDATE_BASE:'b'.repeat(40),CANDIDATE_RUN:'1',CANDIDATE_ATTEMPT:'1'}),/Checkout is not source SHA/);
 assert.throws(()=>sourceExpectation(false,{GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_SHA:'a'.repeat(40),CANDIDATE_BASE:'b'.repeat(40)}),/CANDIDATE_RUN/);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
const sequence=[];
await advanceBackend({sha:'a'.repeat(40),pending:[migration],activeVersion:{annotations:{}},assertCurrent:async()=>{},
 verifyConfiguration:async()=>{},applyMigration:async()=>sequence.push('0118'),assertSchema:async()=>sequence.push('schema'),
 deploy:async()=>sequence.push('auth'),readActive:async()=>({version:{},deployment:{}})});
assert.deepEqual(sequence,['0118','schema','auth']);
const require=createRequire(import.meta.url),workflow=require('../node_modules/playwright-core/lib/utilsBundle.js').yaml.parse(fs.readFileSync('.github/workflows/static.yml','utf8'));
assert.equal(workflow.jobs.deploy.concurrency.group,'pages');assert.equal(workflow.jobs.deploy.concurrency['cancel-in-progress'],false);
assert.match(workflow.jobs.deploy.environment.name,/cloudflare-static-production/);
const steps=workflow.jobs.deploy.steps,apply=steps.find(s=>s.name==='Apply verified candidate backend prerequisites');
assert.match(apply.if,/backend_continuation/);assert.match(apply.run,/node scripts\/release-apply.mjs --ci-verified-candidate/);assert(!apply['continue-on-error']);
const receipt=steps.find(s=>s.name==='Preserve backend activation evidence');assert.match(receipt.if,/success\(\)/);assert.equal(receipt.with['if-no-files-found'],'error');
for(const file of ['scripts/lib/contact-publication.mjs','scripts/test-contact-publication.mjs','scripts/test-contact-release.mjs']) {
 assert.equal(selectCiTests([file]).full,false,file);assert(fs.readFileSync('scripts/test-release-plan.mjs','utf8').includes("import('./test-contact-publication.mjs')"));
}
assert.equal(selectCiTests(['scripts/lib/contact-unreviewed.mjs']).full,true);
console.log('Contact release: real guard/CLI, Contact-only and Auth+0118, receipt/workflow lock, candidate and scope rejection passed.');
