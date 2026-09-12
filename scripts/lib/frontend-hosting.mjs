import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function hostingPolicy() {
  const p = readJson('config/static-hosting.json');
  assert.equal(p.schema, 1); assert(['github-pages','cloudflare'].includes(p.provider));
  assert.equal(p.worker, 'bitbi-frontend'); assert.equal(p.previewWorker, 'bitbi-frontend-preview');
  assert.deepEqual(p.domains,['bitbi.ai','www.bitbi.ai']);
  assert.equal(p.productionEnvironment,'cloudflare-static-production');
  assert(/^[a-f0-9]{40}$/.test(p.bootstrapPagesSha));assert(Number.isSafeInteger(p.bootstrapPagesDeployment)&&p.bootstrapPagesDeployment>0);
  assert.equal(p.wranglerVersion, '4.129.0'); assert.equal(p.wranglerPackage, 'workers/contact');
  return p;
}
export function wrangler(args, env = process.env) {
  const p = hostingPolicy(), installed = readJson(`${p.wranglerPackage}/node_modules/wrangler/package.json`);
  assert.equal(installed.version, p.wranglerVersion, 'Unexpected frontend Wrangler');
  assert.equal(readJson(`${p.wranglerPackage}/package-lock.json`).packages['node_modules/wrangler'].version,p.wranglerVersion);
  return execFileSync(process.execPath,[`${p.wranglerPackage}/node_modules/wrangler/bin/wrangler.js`,...args], {
    env: {...env, WRANGLER_SEND_METRICS:'false'}, encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:120000,
  });
}
export function assertPublicAssets(files, directory) {
  assert(Object.keys(files).length > 0 && Object.keys(files).length <= 20000, 'Asset count exceeds conservative free-plan boundary');
  for (const file of Object.keys(files)) {
    assert(!/(^|\/)(?:\.[^/]+|node_modules|workers|frontend|scripts|tests|config|test-results|candidate)(\/|$)/.test(file), `Private/control path in assets: ${file}`);
    assert(!/(?:\.map|\.sql|\.jsonc|\.pem|\.key)$/.test(file) && file !== '_worker.js', `Non-public artifact: ${file}`);
    assert(fs.statSync(path.join(directory,file)).size <= 25*1024*1024, `Oversized static asset: ${file}`);
  }
}
export function prepareFrontend(manifest, tree) {
  const policy = hostingPolicy();
  assertPublicAssets(manifest.files, 'candidate/site');
  const config = readJson('frontend/wrangler.jsonc');
  assert.equal(config.name, policy.worker); assert.equal(config.no_bundle, true);
  assert.deepEqual(Object.keys(config).sort(), ['$schema','name','main','compatibility_date','no_bundle','workers_dev','preview_urls','assets','observability'].sort(), 'Unexpected binding/route/config');
  assert.deepEqual(config.observability, {enabled:true,head_sampling_rate:0.1,redact_query_string:true,
    logs:{enabled:true,head_sampling_rate:0.1,invocation_logs:false,persist:true},
    traces:{enabled:false,persist:false}}, 'Frontend logging privacy/sampling contract changed');
  assert.equal(config.workers_dev,false); assert.equal(config.preview_urls,false);
  assert.equal(config.assets.html_handling,'none'); assert.equal(config.assets.not_found_handling,'none');
  assert.deepEqual(config.assets.run_worker_first,['/*','!/assets/*','!/css/*','!/js/*','!/fonts/*']);
  fs.mkdirSync('candidate/frontend',{recursive:true});
  fs.copyFileSync('frontend/index.mjs','candidate/frontend/index.mjs');
  delete config.$schema; config.assets.directory='../site';
  fs.writeFileSync('candidate/frontend/wrangler.jsonc',JSON.stringify(config,null,2)+'\n');
  manifest.hosting = {provider:policy.provider,worker:policy.worker,wrangler:policy.wranglerVersion,
    files:tree('candidate/frontend'), sourceHash:hash(fs.readFileSync('frontend/index.mjs')),
    configHash:hash(fs.readFileSync('frontend/wrangler.jsonc')),
    lockHash:hash(fs.readFileSync(`${policy.wranglerPackage}/package-lock.json`))};
}
export function verifyFrontend(manifest, tree) {
  assert(manifest.hosting,'Missing frontend package identity'); const p=hostingPolicy();
  assert.equal(manifest.hosting.provider,p.provider,'Hosting target changed');
  assert.equal(manifest.hosting.worker,p.worker); assert.equal(manifest.hosting.wrangler,p.wranglerVersion);
  assert.deepEqual(tree('candidate/frontend'),manifest.hosting.files,'Frontend package changed');
  assert.equal(hash(fs.readFileSync('frontend/index.mjs')),manifest.hosting.sourceHash);
  assert.equal(hash(fs.readFileSync('frontend/wrangler.jsonc')),manifest.hosting.configHash);
  assert.equal(hash(fs.readFileSync(`${p.wranglerPackage}/package-lock.json`)),manifest.hosting.lockHash);
  assert.deepEqual(tree('candidate/site'),manifest.files,'Actual upload asset tree differs from candidate');
  assertPublicAssets(manifest.files,'candidate/site');
}
export function validateActivation({receipt,deployment,version}, expected) {
  for(const key of ['sha','run','attempt','packageDigest','worker','account'])assert.equal(receipt[key],expected[key],`Hosting receipt ${key} mismatch`);
  assert.equal(receipt.provider,'cloudflare'); assert.equal(receipt.target,'production');
  assert.equal(deployment.id,receipt.deploymentId);
  assert.deepEqual(deployment.versions,[{version_id:receipt.versionId,percentage:100}], 'Candidate is not the sole active version');
  assert.equal(version.id,receipt.versionId);
  assert.equal(version.annotations?.['workers/message'],`bitbi:${expected.sha}:${expected.run}:${expected.attempt}:${expected.packageDigest}`,'Cloudflare version lacks exact package provenance');
  return receipt.sha;
}
export function verifyDomains(domains, policy=hostingPolicy()) {
  return policy.domains.map(hostname=>{
    const matches=domains.filter(d=>d.hostname===hostname);
    assert.equal(matches.length,1,`Missing/ambiguous frontend domain: ${hostname}`);
    const domain=matches[0];assert.equal(domain.service,policy.worker);assert.equal(domain.environment,'production');
    assert(domain.id && domain.zone_id,'Missing domain/zone identity');
    return {hostname,id:domain.id,zone:domain.zone_id};
  });
}
export async function cloudflareRead(endpoint, env=process.env) {
  assert(env.CLOUDFLARE_API_TOKEN && /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID||''),'Missing scoped Cloudflare read access/account');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/${endpoint}`, {
    headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(20000),
  });
  assert(r.ok,`Cloudflare read failed (${r.status})`); const body=await r.json();assert(body.success,'Cloudflare read rejected');return body.result;
}

export async function cloudflarePublishedBase(api, policy, {read=cloudflareRead}={}) {
  const {durableBaseline}=await import('./frontend-receipts.mjs');
  const durable=await durableBaseline(api,read);if(durable)return durable;
  // No frontend has been published yet: exact Pages bootstrap remains possible.
  // An existing successful CF publication without its durable record is NOT a
  // bootstrap and cannot be replaced by a mutable/expired diagnostic ZIP.
  const deployments=await api(`deployments?environment=${policy.productionEnvironment}&per_page=100`);
  for(const deployment of deployments) {
    const statuses=await api(`deployments/${deployment.id}/statuses?per_page=100`);
    assert(!statuses.some(s=>s.state==='success'),'Missing durable receipt for existing Cloudflare publication');
  }
  assert(deployments.length<100,'No authoritative success within bounded deployment history');
  return null;
}

// Read-only recovery planning: only records/domains actually changed by this
// cutover are reversed. No zone inventory replacement or backend operations.
export function cutoverRecovery(snapshot, state) {
  assert.equal(snapshot.zone,'bitbi.ai');
  assert(snapshot.dns.every(r=>['bitbi.ai','www.bitbi.ai'].includes(r.name)&&['A','AAAA','CNAME'].includes(r.type)),'Snapshot includes unrelated DNS');
  if(!snapshot.pagesAvailable) {
    assert(state.previousCloudflareVersion,'Pages is unavailable and no Cloudflare recovery version is recorded');
    return [{operation:'deploy-known-frontend-version',worker:'bitbi-frontend',version:state.previousCloudflareVersion}];
  }
  const created=state.createdDomains||[];
  assert(created.every(d=>['bitbi.ai','www.bitbi.ai'].includes(d.hostname)&&d.id),'Unowned custom domain');
  return [...created.slice().reverse().map(d=>({operation:'remove-created-custom-domain',id:d.id,hostname:d.hostname})),
    ...snapshot.dns.filter(r=>(state.removedDnsIds||[]).includes(r.id)).map(r=>({operation:'restore-hosting-dns',record:r})),
    {operation:'verify-pages-origin-and-api-route',sha:snapshot.pagesSha}];
}

export function materializeFrontendConfig(directory, {preview=false}={}) {
  const config=readJson('candidate/frontend/wrangler.jsonc');
  config.main=path.resolve('candidate/frontend/index.mjs');
  config.assets.directory=path.resolve('candidate/site');
  if(preview){config.name=hostingPolicy().previewWorker;config.workers_dev=true;}
  fs.mkdirSync(directory,{recursive:true});
  const file=path.resolve(directory,'wrangler.jsonc');fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
  return file;
}
