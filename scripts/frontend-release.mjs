// Existing candidate/Actions flow owns authorization and immutable artifacts.
// This adapter only targets the separate static Worker; never backend resources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hostingPolicy, readJson, verifyFrontend, wrangler, hash, cloudflareRead, validateActivation, verifyDomains, materializeFrontendConfig } from './lib/frontend-hosting.mjs';
import {persistDurableReceipt,activateRecovery,findPendingFrontendActivation} from './lib/frontend-receipts.mjs';
import {verifyUploadSource} from './lib/frontend-source.mjs';
import {repairDelta,repairKind} from './lib/media-repair-source.mjs';
import { tree, verifyProofs } from './pages-candidate.mjs';
// Exact observed Cloudflare additions, not a general HTML sanitizer. Everything
// else (including whitespace, changed attributes and unknown injections) hashes
// against the authenticated candidate. The beacon digest pins script + config.
export function appearanceHtmlBytes(bytes) {
  let html=bytes.toString('utf8');assert(Buffer.from(html).equals(bytes),'Invalid public HTML encoding');
  const augmentations=[];
  html=html.replace(/(<body>)<a href="https:\/\/bitbi\.ai\/cdn-cgi\/content\?id=[A-Za-z0-9_.-]{64,512}" aria-hidden="true" rel="nofollow noopener" style="display: none !important; visibility: hidden !important"><\/a>/,(_,body)=>{augmentations.push('cloudflare-ai-labyrinth');return body;});
  html=html.replace(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/[^\n]+<\/script>\n(?=<\/body>)/,script=>{
    assert.equal(hash(script),'668d39c8190190ecdbe88eaf468add377a0c5f3e168f54f787529d40625525b5','Unrecognized Cloudflare beacon');
    augmentations.push('cloudflare-insights-pinned');return '';
  });
  return {bytes:Buffer.from(html),augmentations};
}
// Bounded anonymous verification, without settings mutations or polling. Only
// the existing single-hop same-origin DACH redirect is allowed for the root.
export async function verifyPublishedAppearance(manifest,read=fetch) {
  const assets=['js/shared/appearance-contract.js','js/shared/appearance.js','css/base/appearance.css','css/base/tokens.css'];
  const verified=[],documents=[],options=()=>({credentials:'omit',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(20000)});
  for(const [input,url] of [['index.html','/'],['de/index.html','/de/'],...assets.map(file=>[file,`/${file}`])]) {
    let file=input;
    assert(manifest.files[file],`Missing appearance candidate input: ${file}`);
    const suffix=`?v=${manifest.sha.slice(0,12)}-${manifest.run}-${manifest.attempt}`;
    const requested=`https://bitbi.ai${url}${suffix}`;let resolved=requested,response=await read(requested,options());
    if([301,302].includes(response.status)&&url==='/') {
      const location=response.headers.get('location');assert(location,'Missing locale redirect');
      const target=new URL(location,requested);
      assert.equal(target.origin,'https://bitbi.ai','Unexpected locale redirect origin');
      assert.equal(target.pathname,'/de/','Unexpected locale redirect path');
      assert(!target.username&&!target.password&&!target.hash&&['',suffix].includes(target.search),'Unexpected locale redirect parameters');
      await response.body?.cancel();resolved=target.href;response=await read(resolved,options());file='de/index.html';
    }
    assert(!response.redirected&&(!response.url||response.url===resolved),'Unobserved public redirect');
    assert(response.ok,`Public appearance file unavailable: ${file} (${response.status})`);
    const raw=Buffer.from(await response.arrayBuffer()),html=file.endsWith('.html'),normalized=html?appearanceHtmlBytes(raw):{bytes:raw,augmentations:[]};
    if(normalized.augmentations.length)assert.equal(response.headers.get('server'),'cloudflare','Unexpected HTML augmentation source');
    assert.equal(hash(normalized.bytes),manifest.files[file],`Public bytes differ: ${file}`);
    if(html)documents.push({requested,resolved,file,rawSHA256:hash(raw),candidateSHA256:hash(normalized.bytes),augmentations:normalized.augmentations});
    if(!verified.includes(file))verified.push(file);
  }
  const response=await read('https://bitbi.ai/api/appearance',options());
  assert(!response.redirected&&(!response.url||response.url==='https://bitbi.ai/api/appearance'),'Unexpected theme configuration redirect');
  assert(response.ok,`Public theme configuration unavailable (${response.status})`);
  const result=await response.json();assert.equal(result.ok,true);
  const {default:contract}=await import('../js/shared/appearance-contract.js');
  const settings=contract.normalizeAppearance(result.appearance);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  return {checkedAt:new Date().toISOString(),verified,documents,revision:settings.revision,segments:settings.segments,personalEnabled:settings.personalEnabled};
}
export async function publishFrontend({upload,read,current,manifest,proofs,account,reconcile,readPublic=fetch}) {
  assert(/^[a-f0-9]{32}$/.test(account||''),'Missing explicit frontend account');
  verifyProofs(manifest,proofs);
  const packageDigest=hash(JSON.stringify(manifest));
  const expected={sha:manifest.sha,run:manifest.run,attempt:manifest.attempt,packageDigest,worker:manifest.hosting.worker,account};
  await current();
  const pending=await reconcile?.();
  if(pending)for(const key of Object.keys(expected))assert.equal(pending.receipt[key],expected[key],`Pending activation changed ${key}`);
  // A verified protected activation is accepted in place, never uploaded again.
  // Upload failures still throw. Unknown outcomes cannot emit a success receipt.
  const uploaded=pending?{worker_name:pending.receipt.worker,version_id:pending.receipt.versionId}:await upload(`bitbi:${expected.sha}:${expected.run}:${expected.attempt}:${packageDigest}`);
  assert.equal(uploaded.worker_name,expected.worker);assert(uploaded.version_id,'No version identity from Wrangler');
  const active=await read(`workers/scripts/${expected.worker}/deployments`);
  const deployment=active.deployments?.[0];assert(deployment,'No active deployment');
  const version=await read(`workers/scripts/${expected.worker}/versions/${uploaded.version_id}`);
  const receipt={...expected,provider:'cloudflare',target:'production',versionId:uploaded.version_id,deploymentId:deployment.id};
  validateActivation({receipt,deployment,version},expected);
  receipt.domains=verifyDomains(await read('workers/domains'));
  if(pending){assert.equal(receipt.deploymentId,pending.receipt.deploymentId,'Activation changed during reconciliation');receipt.activationReconciliation=pending.reconciliation;}
  if(manifest.selection?.appearance || reconcile)receipt.appearanceAcceptance=await verifyPublishedAppearance(manifest,readPublic);
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
 assert.equal(manifest.sha,process.env.REPAIR_SOURCE_SHA||process.env.GITHUB_SHA);assert.deepEqual(tree('_site'),manifest.files);
 const output='test-results/frontend-upload.ndjson';fs.mkdirSync('test-results',{recursive:true});fs.rmSync(output,{force:true});
 fs.rmSync('hosting-receipt.json',{force:true});
 const current=async()=>{
   execFileSync(process.execPath,['scripts/pages-candidate.mjs','current'],{stdio:'inherit'});
   if(process.env.BACKEND_RELEASE_RECEIPT)await (await import('./lib/backend-publication.mjs')).verifyBackendReceipt();
 };
 const reconcile=process.env.REPAIR_SOURCE_SHA&&repairKind(repairDelta(manifest.sha,process.env.GITHUB_SHA,process.env.CANDIDATE_BASE))==='tooling'?()=>findPendingFrontendActivation({manifest}):undefined;
 const receipt=await publishFrontend({manifest,proofs,account:process.env.CLOUDFLARE_ACCOUNT_ID,current,read:cloudflareRead,reconcile,upload:async message=>{
   await verifyUploadSource();
   assert(process.env.CLOUDFLARE_API_TOKEN,'Explicit frontend deployment credential required');
   // No --routes, custom domains or backend bindings. Cutover owns domains.
   console.log(wrangler(['deploy','--config',materializeFrontendConfig('.local/frontend-deploy'),'--message',message],{...process.env,WRANGLER_OUTPUT_FILE_PATH:path.resolve(output)}));
   const records=fs.readFileSync(output,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type==='deploy');
   assert.equal(records.length,1,'Missing/ambiguous upload result');return records[0];
 }});
 if(process.env.REPAIR_SOURCE_SHA) {
   const kind=repairKind(repairDelta(manifest.sha,process.env.GITHUB_SHA,process.env.CANDIDATE_BASE));
   const identity={sourceSha:manifest.sha,publicationSha:process.env.GITHUB_SHA};
   if(kind==='media')receipt.mediaRepair=identity;
   else receipt.releaseRepair={kind,...identity};
 }
 receipt.publicationRun=String(process.env.GITHUB_RUN_ID);receipt.publicationAttempt=String(process.env.GITHUB_RUN_ATTEMPT);
 fs.writeFileSync('hosting-receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(`Verified ${receipt.worker} ${receipt.versionId} at 100%; deployment ${receipt.deploymentId}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
