import './test-frontend-review.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { hash, readJson, hostingPolicy, cloudflarePublishedBase, wrangler, verifyFrontend, validateActivation, verifyDomains, prepareFrontend, cutoverRecovery, materializeFrontendConfig } from './lib/frontend-hosting.mjs';
import { tree } from './pages-candidate.mjs';
import worker from '../frontend/index.mjs';
import { publishFrontend } from './frontend-release.mjs';

// Log payloads have a closed vocabulary, even for malicious URLs/headers/errors.
const loggingResults=[], originals={warn:console.warn,error:console.error};
const captured=[]; console.warn=(...args)=>captured.push(['warn',...args]);console.error=(...args)=>captured.push(['error',...args]);
try {
 const request=new Request('https://bitbi.ai/account/reset-password.html?token=SYNTHETIC_SECRET', {
   headers:{Cookie:'session=SYNTHETIC_COOKIE',Authorization:'Bearer SYNTHETIC_AUTH'}});
 for(const [name,fetch,status,expectedLogs] of [
  ['successful request',async()=>new Response('ok'),200,[]],
  ['missing document',async()=>new Response(null,{status:404}),404,[['warn','frontend_not_found']]],
  ['asset error response',async()=>new Response('SYNTHETIC_BODY',{status:503}),503,[['error','frontend_asset_response_error']]],
  ['asset exception',async()=>{throw Error('SYNTHETIC_SECRET '+request.url);},500,[['error','frontend_asset_fetch_failed']]],
 ]) {
  captured.length=0;const response=await worker.fetch(request,{ASSETS:{fetch}});
  assert.equal(response.status,status);assert.deepEqual(captured,expectedLogs,name);
  if(status===500)assert.equal(await response.text(),'Internal server error');
  loggingResults.push({name,passed:true,logs:structuredClone(captured)});
 }
 captured.length=0;
 const head=await worker.fetch(new Request(request,{method:'HEAD'}),{ASSETS:{fetch:async()=>{throw 'SYNTHETIC_SECRET';}}});
 assert.equal(head.status,500);assert.equal(await head.text(),'');assert.deepEqual(captured,[['error','frontend_asset_fetch_failed']]);
 captured.length=0;
 await worker.fetch(new Request('https://bitbi.ai/private/SYNTHETIC_PATH?code=SYNTHETIC_CODE',{method:'POST',body:'SYNTHETIC_BODY'}),{});
 assert.deepEqual(captured,[],'Rejected method must not read or log request body');
} finally {Object.assign(console,originals);}
fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/frontend-logging.json',JSON.stringify({scope:'local emitted payloads, not Cloudflare persisted metadata',passed:true,checks:loggingResults},null,2));

const expected={sha:'a'.repeat(40),run:'123',attempt:'1',packageDigest:'b'.repeat(64),worker:'bitbi-frontend',account:'c'.repeat(32)};
const receipt={...expected,provider:'cloudflare',target:'production',deploymentId:'deployment-1',versionId:'version-1'};
const deployment={id:'deployment-1',versions:[{version_id:'version-1',percentage:100}]};
const version={id:'version-1',annotations:{'workers/message':`bitbi:${expected.sha}:123:1:${expected.packageDigest}`}};
assert.equal(validateActivation({receipt,deployment,version},expected),expected.sha);
for(const field of ['sha','run','attempt','packageDigest','worker','account','target','versionId','deploymentId'])assert.throws(()=>validateActivation({receipt:{...receipt,[field]:'wrong'},deployment,version},expected));
for(const versions of [[],[{version_id:'old',percentage:100}],[{version_id:'version-1',percentage:50}]])assert.throws(()=>validateActivation({receipt,deployment:{...deployment,versions},version},expected));
assert.throws(()=>validateActivation({receipt,deployment,version:{...version,annotations:{}}},expected));
for(const country of ['DE','US','AT']) {
 const request=new Request('https://bitbi.ai/?q=1',{headers:{'Accept-Language':'de','Cookie':'bitbi_locale=de'}});request.cf={country};
 const response=await worker.fetch(request,{ASSETS:{fetch:async r=>{return new URL(r.url).pathname==='/'?new Response(null,{status:404}):new Response('English');}}});
 assert.equal(response.status,200);assert.equal(await response.text(),'English');
}
const api=await worker.fetch(new Request('https://bitbi.ai/api/admin/me'),{ASSETS:{fetch:()=>{throw Error('API reached assets');}}});assert.equal(api.status,404);assert.match(api.headers.get('content-type'),/json/);
const snapshot={zone:'bitbi.ai',pagesAvailable:true,pagesSha:expected.sha,dns:[{id:'a',name:'bitbi.ai',type:'A',content:'185.199.108.153'},{id:'w',name:'www.bitbi.ai',type:'CNAME',content:'bitbiai.github.io'}]};
assert.deepEqual(cutoverRecovery(snapshot,{createdDomains:[{id:'new-www',hostname:'www.bitbi.ai'}],removedDnsIds:['w']}).map(x=>x.operation),['remove-created-custom-domain','restore-hosting-dns','verify-pages-origin-and-api-route']);
assert.throws(()=>cutoverRecovery({...snapshot,dns:[{name:'pay.bitbi.ai',type:'CNAME'}]},{}));
assert.throws(()=>cutoverRecovery({...snapshot,pagesAvailable:false},{}));
assert.equal(cutoverRecovery({...snapshot,pagesAvailable:false},{previousCloudflareVersion:'known'})[0].operation,'deploy-known-frontend-version');
const synthetic={sha:expected.sha,run:'123',attempt:'1',selection:{},hosting:{worker:'bitbi-frontend'}};
const proof={job:'frontend-runtime',status:'passed',manifestHash:hash(JSON.stringify(synthetic)),tests:1,reportHash:'synthetic'};
const domains=['bitbi.ai','www.bitbi.ai'].map(hostname=>({hostname,id:hostname,zone_id:'zone',service:'bitbi-frontend',environment:'production'}));
assert.equal(verifyDomains(domains).length,2);
assert.throws(()=>verifyDomains(domains.slice(1)));
assert.throws(()=>verifyDomains(domains.map(d=>({...d,service:'bitbi-auth'}))));
let uploads=0;
const options={manifest:synthetic,proofs:[proof],account:expected.account,current:async()=>{},upload:async()=>{uploads++;return {worker_name:'bitbi-frontend',version_id:'version-1'};},read:async endpoint=>endpoint==='workers/domains'?domains:endpoint.endsWith('/deployments')?{deployments:[deployment]}:{...version,annotations:{'workers/message':`bitbi:${synthetic.sha}:123:1:${hash(JSON.stringify(synthetic))}`}}};
assert.equal((await publishFrontend(options)).versionId,'version-1');
uploads=0;await assert.rejects(publishFrontend({...options,account:undefined}));assert.equal(uploads,0);
await assert.rejects(publishFrontend({...options,proofs:[]}));assert.equal(uploads,0);
await assert.rejects(publishFrontend({...options,current:async()=>{throw Error('superseded candidate');}}));assert.equal(uploads,0);
await assert.rejects(publishFrontend({...options,upload:async()=>{throw Error('upload failed');}}));
let currentChecks=0;await assert.rejects(publishFrontend({...options,current:async()=>{if(++currentChecks===2)throw Error('displaced during upload');}}));assert.equal(currentChecks,2);

await assert.rejects(publishFrontend({...options,read:async()=>({deployments:[]})}));
await assert.rejects(publishFrontend({...options,read:async()=>{throw Error('permission denied');}}));
// Candidate archive digests/expiry are exercised through the real CLI in
// test-frontend-review. Baseline adoption now requires durable platform evidence.
const bootstrapApi=async endpoint=>endpoint.includes('task=bitbi-static-receipt')?[]:[];
assert.equal(await cloudflarePublishedBase(bootstrapApi,hostingPolicy()),null);
await assert.rejects(cloudflarePublishedBase(async endpoint=>endpoint.includes('task=bitbi-static-receipt')?[]:endpoint.includes('/statuses')?[{state:'success'}]:[{id:1}],hostingPolicy()),/Missing durable receipt/);
console.log('Hosting provenance, inactive/partial/wrong-version and no-Geo/API unit counterchecks passed.');
if(process.argv.includes('--unit'))process.exit(0);
if(process.argv.includes('--standalone')) {
  assert(!fs.existsSync('candidate'),'Do not overwrite candidate evidence');
  fs.mkdirSync('candidate');fs.cpSync('_site','candidate/site',{recursive:true});
  const local={files:tree('_site'),localOnly:true};prepareFrontend(local,tree);
  fs.writeFileSync('candidate/manifest.json',JSON.stringify(local));
}
const manifest=readJson('candidate/manifest.json');verifyFrontend(manifest,tree);
const home=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'bitbi-frontend-runtime-'));
const env={XDG_CONFIG_HOME:path.join(home,'config'),CLOUDFLARE_CF_FETCH_ENABLED:'false',PATH:process.env.PATH,HOME:home,TMPDIR:home,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(home,'wrangler.log')};
let child;let log='';let tests=0;
try {
 const config=materializeFrontendConfig(path.join(home,'runtime'));
 console.log(wrangler(['deploy','--dry-run','--config',config,'--outdir',path.join(home,'dry-run')],env));
 const start=async extra=>{
 child=spawn(process.execPath,['workers/contact/node_modules/wrangler/bin/wrangler.js','dev','--local','--config',config,'--ip','127.0.0.1','--port','3000','--inspector-port','0','--show-interactive-dev-session=false','--persist-to',path.join(home,'state'),...extra],{env,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Local Wrangler startup timed out: '+log)),20000);
   let startup='';const data=b=>{log+=b.toString();startup+=b.toString();if(startup.includes('Ready on')){clearTimeout(timer);resolve();}};
   child.stdout.on('data',data);child.stderr.on('data',data);child.once('exit',code=>{clearTimeout(timer);reject(Error(`Wrangler exited ${code}: ${log}`));});
 });
 };
 await start([]);
 const get=async (url,options={})=>{tests++;return fetch('http://127.0.0.1:3000'+url,{redirect:'manual',signal:AbortSignal.timeout(5000),...options});};
 for(const url of ['/','/de/','/admin/','/admin/index.html','/account/profile.html','/pricing.html?x=1','/de/pricing.html?x=1']) {
   const r=await get(url);assert.equal(r.status,200,url);assert.match(r.headers.get('content-type'),/text\/html/);assert(!r.headers.has('location'));
 }
 for(const url of ['/de','/admin']) {const r=await get(url+'?q=1');assert.equal(r.status,301);assert.equal(new URL(r.headers.get('location'),'http://localhost').pathname,url+'/');assert.equal(new URL(r.headers.get('location'),'http://localhost').search,'?q=1');}
 for(const url of ['/api','/api/admin/me','/api/nope']) {const r=await get(url);assert.equal(r.status,404);assert.match(r.headers.get('content-type'),/json/);assert.equal((await r.json()).error,'API_NOT_AVAILABLE_ON_STATIC_HOST');}
 for(const url of ['/account/','/missing','/de/missing','/admin/missing.html','/_worker.js','/frontend/index.mjs','/config/static-hosting.json','/candidate/manifest.json','/.git/config','/test-results/admin-discovery.json']) {const r=await get(url);assert.equal(r.status,404,url);}
 const asset='/js/pages/admin/newsfeed.js?v=unchanged-token';const a=await get(asset);assert.equal(a.status,200);assert.match(a.headers.get('content-type'),/javascript/);assert.equal(hash(Buffer.from(await a.arrayBuffer())),manifest.files['js/pages/admin/newsfeed.js']);assert(a.headers.get('etag'));
 const head=await get(asset,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.text()).length,0);
 const cached=await get(asset,{headers:{'If-None-Match':head.headers.get('etag')}});assert.equal(cached.status,304);
 const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;
 // Wrangler rewrites ordinary Host headers. Use its supported local upstream
 // URL override to exercise real request.hostname handling without DNS/network.
 await start(['--local-upstream','www.bitbi.ai','--upstream-protocol','https']);
 for(const url of ['/','/pricing.html?q=1','/api/me']) {
   const r=await get(url);assert.equal(r.status,301,'www canonical '+url);assert.equal(r.headers.get('location'),'https://bitbi.ai'+url);
 }
 assert(log.includes('frontend_not_found'),'Real local Worker did not emit the safe missing-document code');
 verifyFrontend(manifest,tree);assert.deepEqual(tree('candidate/site'),manifest.files);
 fs.writeFileSync('candidate/proof-frontend-runtime.json',JSON.stringify({job:'frontend-runtime',status:'passed',manifestHash:hash(JSON.stringify(manifest)),reportHash:hash(JSON.stringify({tests,log})),tests}));
 console.log(`Local Wrangler Static Assets: ${tests} routing/byte/header checks passed; dry-run passed; no upload.`);
} finally {
 if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/frontend-runtime.log',log);try {fs.rmSync(home,{recursive:true,force:true});} catch(error) {console.error('Local cleanup failed:',error.code);process.exitCode=1;}
}
