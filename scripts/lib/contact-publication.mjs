// Existing Contact service only. The protected backend entrypoint owns source
// acceptance, environment approval, publication lock and durable receipt storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const worker='bitbi-contact',configPath='workers/contact/wrangler.jsonc';
const prefix=`workers/scripts/${worker}`;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
function source(c) {
  for(const name of ['sha','base'])assert(/^[a-f0-9]{40}$/.test(c[name]||''),`Missing Contact ${name}`);
  for(const name of ['runId','attempt'])assert(/^[1-9][0-9]*$/.test(String(c[name]||'')),`Missing Contact ${name}`);
  const selected=c.plan?.workerDeploys?.filter(step=>step.worker==='contact');
  assert.equal(selected?.length,1,'Contact is not uniquely selected');
  assert.equal(selected[0].workerName,worker,'Unexpected Contact target');
  assert.equal(selected[0].wranglerPath,configPath,'Unexpected Contact config');
  git(['merge-base','--is-ancestor',c.base,c.sha]);
  const bytes=git(['show',`${c.sha}:${configPath}`]);
  assert.equal(bytes,git(['show',`${c.base}:${configPath}`]),'Contact config changes require separate review');
  assert.equal(fs.readFileSync(configPath,'utf8').trim(),bytes,'Contact config differs from candidate');
  const config=JSON.parse(bytes);
  assert.equal(config.name,worker);assert.equal(config.main,'src/index.js');assert.equal(config.workers_dev,false);
  assert.deepEqual(config.vars,{BITBI_ENV:'production'});
  assert.deepEqual(config.routes,[{pattern:'contact.bitbi.ai',custom_domain:true}]);
  assert.deepEqual(config.durable_objects,{bindings:[{name:'PUBLIC_RATE_LIMITER',class_name:'ContactPublicRateLimiterDurableObject'}]});
  assert.deepEqual(config.migrations,[{tag:'v1-public-rate-limiter',new_sqlite_classes:['ContactPublicRateLimiterDurableObject']}]);
  return {sourceTree:git(['rev-parse',`${c.sha}:workers/contact`]),configDigest:hash(bytes)};
}
function bindings(version) {
  const values=version.resources?.bindings;
  assert(Array.isArray(values),'Missing Contact binding evidence');
  assert.deepEqual(values.map(b=>b.name).sort(),['BITBI_ENV','PUBLIC_RATE_LIMITER','RESEND_API_KEY'],'Unexpected Contact bindings');
  assert(values.some(b=>b.name==='RESEND_API_KEY'&&b.type==='secret_text'),'Missing existing Contact mail secret');
  assert(values.some(b=>b.name==='BITBI_ENV'&&b.type==='plain_text'&&b.text==='production'),'Wrong Contact environment');
  const limiter=values.find(b=>b.name==='PUBLIC_RATE_LIMITER');
  assert.equal(limiter.type,'durable_object_namespace');
  assert(/^[a-f0-9]{32}$/.test(limiter.namespace_id||''),'Missing existing Contact limiter namespace');
  if(limiter.class_name!==undefined)assert.equal(limiter.class_name,'ContactPublicRateLimiterDurableObject');
  const runtime=version.resources.script_runtime;
  assert.equal(runtime?.migration_tag,'v1-public-rate-limiter','Unexpected Contact migration');
  assert.equal(runtime.compatibility_date,'2026-03-08','Unexpected Contact compatibility date');
  assert.equal(runtime.usage_model,'standard','Unexpected Contact runtime');
  return {namespaceId:limiter.namespace_id,runtime};
}
async function active(read) {
  const deployment=(await read(`${prefix}/deployments`)).deployments?.[0];
  assert(deployment?.id&&deployment.versions?.length===1&&deployment.versions[0].percentage===100,'Ambiguous Contact traffic');
  const version=await read(`${prefix}/versions/${deployment.versions[0].version_id}`);
  assert.equal(version.id,deployment.versions[0].version_id,'Contact version lookup mismatch');
  return {deployment,version};
}
async function triggers(read) {
  const domains=await read(`workers/domains?service=${worker}`);
  assert(Array.isArray(domains)&&domains.length===1,'Unexpected Contact domains');
  const domain=domains[0];
  assert.equal(domain.hostname,'contact.bitbi.ai');assert.equal(domain.service,worker);assert.equal(domain.environment,'production');
  assert(domain.id&&domain.zone_id,'Missing Contact domain identity');
  // Older API responses omit routing flags; false enabled is never accepted.
  assert.notEqual(domain.enabled,false,'Contact domain is disabled');
  const routes=await read(`${prefix}/routes`);
  assert(Array.isArray(routes)&&routes.length<=1&&routes.every(r=>['contact.bitbi.ai','contact.bitbi.ai/*'].includes(r.pattern)&&r.script===worker),'Unexpected Contact routes');
  const subdomain=await read(`${prefix}/subdomain`);
  assert.equal(subdomain.enabled,false,'Unexpected Contact workers.dev exposure');
  assert.equal(typeof subdomain.previews_enabled,'boolean','Missing Contact preview exposure evidence');
  return {domain:{id:domain.id,zone:domain.zone_id,hostname:domain.hostname,...(typeof domain.enabled==='boolean'?{enabled:domain.enabled}:{}),...(typeof domain.previews_enabled==='boolean'?{previewsEnabled:domain.previews_enabled}:{})},routes:routes.map(r=>({id:r.id,pattern:r.pattern,script:r.script})),subdomain:{enabled:subdomain.enabled,previewsEnabled:subdomain.previews_enabled}};
}
export async function verifyContactReceipt(receipt,c,{read,verifyBundle}) {
  const expected=source(c);
  for(const [name,value] of Object.entries({sha:c.sha,base:c.base,run:c.runId,attempt:c.attempt,worker,...expected}))assert.equal(receipt?.[name],value,`Contact receipt ${name} mismatch`);
  assert(/^[a-f0-9]{64}$/.test(receipt.bundleDigest||''),'Missing Contact bundle identity');
  const state=await active(read);
  assert.equal(state.deployment.id,receipt.deployment,'Contact deployment changed');
  assert.equal(state.version.id,receipt.version,'Contact version changed');
  assert.equal(state.version.annotations?.['workers/message'],`${worker}:${c.sha}`,'Wrong Contact source annotation');
  assert.deepEqual(bindings(state.version),receipt.bindings,'Contact limiter changed');
  assert.deepEqual(await triggers(read),receipt.triggers,'Contact triggers changed');
  await verifyBundle(receipt.bundleDigest,undefined,worker);
  return receipt;
}
export async function publishContact(c,{read,command,current,verifyBundle,directory}) {
  const identity=source(c);
  await current(c.sha);
  const before=await active(read),beforeBindings=bindings(before.version),beforeTriggers=await triggers(read);
  await command(['versions','upload','--dry-run','--keep-vars','--outdir',directory]);
  const bundleDigest=hash(fs.readFileSync(path.join(directory,'index.js')));
  if(before.version.annotations?.['workers/message']!==`${worker}:${c.sha}`) {
    await current(c.sha);
    const output=await command(['versions','upload','--keep-vars','--message',`${worker}:${c.sha}`]);
    const id=output.match(/Worker Version ID:\s*([a-f0-9-]{36})\b/)?.[1];
    assert(id,'Missing uploaded Contact version identity');
    const uploaded=await read(`${prefix}/versions/${id}`);
    assert.equal(uploaded.id,id);assert.equal(uploaded.annotations?.['workers/message'],`${worker}:${c.sha}`);
    assert.deepEqual(bindings(uploaded),beforeBindings,'Uploaded Contact bindings changed');
    await current(c.sha);
    await command(['versions','deploy',`${id}@100%`,'--yes','--message',`${worker}:${c.sha}`]);
  }
  const state=await active(read);
  const receipt={sha:c.sha,base:c.base,run:c.runId,attempt:c.attempt,worker,...identity,
    version:state.version.id,deployment:state.deployment.id,bundleDigest,bindings:beforeBindings,triggers:beforeTriggers};
  await verifyContactReceipt(receipt,c,{read,verifyBundle});
  return receipt;
}
