// Existing candidate/Actions flow owns authorization and immutable artifacts.
// This adapter only targets the separate static Worker; never backend resources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hostingPolicy, readJson, verifyFrontend, wrangler, hash, cloudflareRead, validateActivation, verifyDomains, materializeFrontendConfig } from './lib/frontend-hosting.mjs';
import {persistDurableReceipt,activateRecovery} from './lib/frontend-receipts.mjs';
import {verifyUploadSource} from './lib/frontend-source.mjs';
import { tree, verifyProofs } from './pages-candidate.mjs';
export async function publishFrontend({upload,read,current,manifest,proofs,account}) {
  assert(/^[a-f0-9]{32}$/.test(account||''),'Missing explicit frontend account');
  verifyProofs(manifest,proofs);
  const packageDigest=hash(JSON.stringify(manifest));
  const expected={sha:manifest.sha,run:manifest.run,attempt:manifest.attempt,packageDigest,worker:manifest.hosting.worker,account};
  await current();
  // Upload failures throw. No success receipt is emitted on unknown outcomes.
  const uploaded=await upload(`bitbi:${expected.sha}:${expected.run}:${expected.attempt}:${packageDigest}`);
  assert.equal(uploaded.worker_name,expected.worker);assert(uploaded.version_id,'No version identity from Wrangler');
  const active=await read(`workers/scripts/${expected.worker}/deployments`);
  const deployment=active.deployments?.[0];assert(deployment,'No active deployment');
  const version=await read(`workers/scripts/${expected.worker}/versions/${uploaded.version_id}`);
  const receipt={...expected,provider:'cloudflare',target:'production',versionId:uploaded.version_id,deploymentId:deployment.id};
  validateActivation({receipt,deployment,version},expected);
  receipt.domains=verifyDomains(await read('workers/domains'));
  await current();
  return receipt;
}
async function main() {
 const command=process.argv[2],policy=hostingPolicy();
 if(command==='receipt') {console.log('Durable deployment receipt',await persistDurableReceipt(readJson('hosting-receipt.json')));return;}
 if(command==='recover') {
   const receipt=await activateRecovery({receiptId:process.env.FRONTEND_RECOVERY_RECEIPT,expectedDeployment:process.env.FRONTEND_EXPECTED_DEPLOYMENT,activate:async version=>{assert(process.env.CLOUDFLARE_API_TOKEN,'Explicit recovery credential required');return console.log(wrangler(['versions','deploy',`${version}@100%`,'--name',policy.worker,'--message',`bitbi-recovery:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`,'--yes']));}});
   fs.writeFileSync('hosting-receipt.json',JSON.stringify(receipt,null,2)+'\n');return;
 }
 if(command==='target') {if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`provider=${policy.provider}\n`);console.log(policy.provider);return;}
 if(command==='pages-guard') {assert.equal(policy.provider,'github-pages','Pages is retired; use the normal static candidate workflow');execFileSync(process.execPath,['scripts/pages-candidate.mjs','current'],{stdio:'inherit'});return;}
 if(['preview-source','production-source'].includes(command)) {
   const checked=await verifyUploadSource({preview:command==='preview-source',download:true});
   console.log(JSON.stringify(checked.source));return;
 }
 if(['preview-config','production-config','preview-upload','stage-upload'].includes(command)) {
   const preview=command.startsWith('preview-');
   const checked=await verifyUploadSource({preview});
   const config=materializeFrontendConfig(preview?'.local/frontend-preview':'.local/frontend-staging',{preview});
   if(command.endsWith('-upload')) {
     assert.equal(process.env.FRONTEND_EXTERNAL_PHASE,preview?'APPROVED_PREVIEW':'APPROVED_UNROUTED_STAGING','Separate external phase not authorized');
     assert(/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID||''),'Missing explicit account');
     // Fresh source read + complete tree/proof comparison immediately precedes
     // Wrangler. Raw config preparation never grants a later upload bypass.
     verifyFrontend(checked.manifest,tree);
     assert(process.env.CLOUDFLARE_API_TOKEN,'Explicit frontend deployment credential required');
     console.log(wrangler(['deploy','--config',config,'--message',`bitbi:${checked.manifest.sha}:${checked.manifest.run}:${checked.manifest.attempt}:${hash(JSON.stringify(checked.manifest))}`]));
   } else console.log(config+' — preparation only; upload must use the guarded command');
   return;
 }
 assert.equal(command,'deploy','Use target, pages-guard, preview-config, production-config or deploy');
 assert.equal(policy.provider,'cloudflare','Cloudflare production is not enabled by the reviewed hosting contract');
 assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal(process.env.GITHUB_REPOSITORY,'bitbiai/Bitbi');
 assert(['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));
 const {manifest,proofs}=await verifyUploadSource();
 assert.equal(manifest.sha,process.env.GITHUB_SHA);assert.deepEqual(tree('_site'),manifest.files);
 const output='test-results/frontend-upload.ndjson';fs.mkdirSync('test-results',{recursive:true});fs.rmSync(output,{force:true});
 fs.rmSync('hosting-receipt.json',{force:true});
 const current=async()=>execFileSync(process.execPath,['scripts/pages-candidate.mjs','current'],{stdio:'inherit'});
 const receipt=await publishFrontend({manifest,proofs,account:process.env.CLOUDFLARE_ACCOUNT_ID,current,read:cloudflareRead,upload:async message=>{
   await verifyUploadSource();assert(process.env.CLOUDFLARE_API_TOKEN,'Explicit frontend deployment credential required');
   // No --routes, custom domains or backend bindings. Cutover owns domains.
   console.log(wrangler(['deploy','--config',materializeFrontendConfig('.local/frontend-deploy'),'--message',message],{...process.env,WRANGLER_OUTPUT_FILE_PATH:path.resolve(output)}));
   const records=fs.readFileSync(output,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type==='deploy');
   assert.equal(records.length,1,'Missing/ambiguous upload result');return records[0];
 }});
 receipt.publicationRun=String(process.env.GITHUB_RUN_ID);receipt.publicationAttempt=String(process.env.GITHUB_RUN_ATTEMPT);
 fs.writeFileSync('hosting-receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(`Verified ${receipt.worker} ${receipt.versionId} at 100%; deployment ${receipt.deploymentId}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
