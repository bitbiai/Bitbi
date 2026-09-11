// GitHub deployment payloads survive Actions artifact expiry. They are only
// evidence together with their protected Actions job and Cloudflare identity.
import assert from 'node:assert/strict';
import {hash,hostingPolicy,cloudflareRead,validateActivation,verifyDomains} from './frontend-hosting.mjs';
export const RECEIPT_TASK='bitbi-static-receipt';
const repo='bitbiai/Bitbi';
export async function githubRequest(endpoint,body) {
  assert(process.env.GH_TOKEN,'Missing GitHub access');
  const r=await fetch(`https://api.github.com/repos/${repo}/${endpoint}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  assert(r.ok,`GitHub receipt ${endpoint.split('?')[0]} failed (${r.status}); read state before retry`);return r.json();
}
export async function loadDurableReceipt(id,api=githubRequest,{parent=false}={}) {
  assert(/^[1-9][0-9]*$/.test(String(id)),'Explicit durable receipt ID required');
  const p=hostingPolicy(),record=await api(`deployments/${id}`);
  assert.equal(record.task,RECEIPT_TASK);assert.equal(record.environment,p.productionEnvironment);
  const receipt=record.payload?.receipt;assert(receipt,'Missing durable receipt');
  assert.equal(record.payload.receiptSHA256,hash(JSON.stringify(receipt)),'Changed receipt payload');
  assert.equal(record.sha,receipt.sha);assert.equal(receipt.worker,p.worker);assert.equal(receipt.target,'production');assert.equal(receipt.provider,'cloudflare');
  assert.equal((await api(`deployments/${id}/statuses`))[0]?.state,'success','Durable receipt is not confirmed');
  const [authorization,run,job]=await Promise.all([api(`deployments/${receipt.authorizingDeployment}`),api(`actions/runs/${receipt.publicationRun}`),api(`actions/jobs/${receipt.authorizingJob}`)]);
  assert.equal(authorization.environment,p.productionEnvironment);assert.equal(authorization.task,'deploy');
  assert.equal(authorization.sha,receipt.publicationSha);
  const statuses=await api(`deployments/${authorization.id}/statuses`);
  const log=`https://github.com/${repo}/actions/runs/${receipt.publicationRun}/job/${receipt.authorizingJob}`;
  assert(statuses.some(s=>s.state==='success'&&s.log_url===log),'Missing successful protected environment authorization');
  assert.equal(String(run.id),String(receipt.publicationRun));assert.equal(String(job.id),String(receipt.authorizingJob));
  assert(['push','workflow_dispatch'].includes(run.event));
  assert.equal(run.repository?.full_name,repo);assert.equal(run.head_repository?.full_name,repo);
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.head_sha,receipt.publicationSha);
  assert.equal(job.run_id,Number(receipt.publicationRun));assert.equal(job.head_sha,receipt.publicationSha);assert.equal(job.run_attempt,Number(receipt.publicationAttempt));
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  const operation=receipt.kind==='rollback'?'Activate approved frontend recovery':'Deploy and verify Cloudflare frontend';
  assert.equal(job.name,receipt.kind==='rollback'?'recover-frontend':'deploy');
  for(const name of [operation,'Record durable frontend receipt'])assert(job.steps.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'),`Unexecuted protected operation: ${name}`);
  if(receipt.kind==='rollback') {
    assert(!parent,'Nested rollback source is not allowed');
    const original=await loadDurableReceipt(receipt.restoredFrom,api,{parent:true});assert.equal(original.kind,'publication');
    for(const key of ['sha','run','attempt','versionId','packageDigest','account','worker'])assert.equal(receipt[key],original[key],`Recovery changed source ${key}`);
    assert.notEqual(receipt.deploymentId,original.deploymentId,'Rollback must record its new activation');
    assert.equal(run.event,'workflow_dispatch','Recovery requires an explicit protected dispatch');
  } else {assert.equal(receipt.kind,'publication');assert.equal(receipt.sha,receipt.publicationSha);}
  return receipt;
}
export async function durableBaseline(api=githubRequest,read=cloudflareRead) {
  const p=hostingPolicy(),records=await api(`deployments?environment=${p.productionEnvironment}&task=${RECEIPT_TASK}&per_page=1`);
  if(!records.length)return null;
  const receipt=await loadDurableReceipt(records[0].id,api);
  const active=await read(`workers/scripts/${p.worker}/deployments`),version=await read(`workers/scripts/${p.worker}/versions/${receipt.versionId}`);
  verifyDomains(await read('workers/domains'),p);
  validateActivation({receipt,deployment:active.deployments?.[0]||{},version},{...receipt,account:process.env.CLOUDFLARE_ACCOUNT_ID});
  return {sha:receipt.sha,deployment:receipt.deploymentId,run:receipt.publicationRun,receipt:records[0].id};
}
export async function persistDurableReceipt(receipt,{api=githubRequest,read=cloudflareRead,env=process.env}={}) {
  const p=hostingPolicy();assert.equal(p.provider,'cloudflare');assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert(['deploy','recover-frontend'].includes(env.GITHUB_JOB));
  assert.equal((await api('git/ref/heads/main')).object.sha,env.GITHUB_SHA,'Superseded authorizing revision');
  const jobs=await api(`actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`);
  const matches=jobs.jobs.filter(j=>j.name===env.GITHUB_JOB&&j.status==='in_progress');assert.equal(matches.length,1);
  const job=matches[0],log=`https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}/job/${job.id}`;
  const deployments=await api(`deployments?environment=${p.productionEnvironment}&sha=${env.GITHUB_SHA}&per_page=100`);
  const authorizations=[];
  for(const d of deployments.filter(d=>d.task!==RECEIPT_TASK))if((await api(`deployments/${d.id}/statuses`)).some(s=>['in_progress','queued'].includes(s.state)&&s.log_url===log))authorizations.push(d);
  assert.equal(authorizations.length,1,'Missing unique protected environment job');
  const active=await read(`workers/scripts/${p.worker}/deployments`),version=await read(`workers/scripts/${p.worker}/versions/${receipt.versionId}`);
  validateActivation({receipt,deployment:active.deployments?.[0]||{},version},{...receipt,account:env.CLOUDFLARE_ACCOUNT_ID});verifyDomains(await read('workers/domains'),p);
  const durable={...receipt,kind:receipt.kind||'publication',publicationRun:String(env.GITHUB_RUN_ID),publicationAttempt:String(env.GITHUB_RUN_ATTEMPT),publicationSha:env.GITHUB_SHA,authorizingDeployment:authorizations[0].id,authorizingJob:job.id};
  // Metadata records only: this repository has no deployment-event workflow.
  // Existing selected suites and environment job already supplied the gate.
  const created=await api('deployments',{ref:receipt.sha,task:RECEIPT_TASK,environment:p.productionEnvironment,auto_merge:false,required_contexts:[],production_environment:true,payload:{receipt:durable,receiptSHA256:hash(JSON.stringify(durable))}});
  assert(created.id,'No durable deployment identity');assert.equal(created.sha,receipt.sha);assert.equal(created.payload?.receiptSHA256,hash(JSON.stringify(durable)));
  const status=await api(`deployments/${created.id}/statuses`,{state:'success',log_url:log,auto_inactive:false,description:`${receipt.worker} active ${receipt.deploymentId}`});
  assert.equal(status.state,'success');assert.equal(status.log_url,log);
  const stored=await api(`deployments/${created.id}`);assert.equal(stored.payload?.receiptSHA256,created.payload.receiptSHA256);
  return created.id;
}
export async function activateRecovery({receiptId,expectedDeployment,api=githubRequest,read=cloudflareRead,activate,env=process.env}) {
  const p=hostingPolicy();assert.equal(p.provider,'cloudflare');assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_JOB,'recover-frontend');
  assert(expectedDeployment,'Explicit pre-recovery deployment required');
  const target=await loadDurableReceipt(receiptId,api);assert.equal(target.kind,'publication');
  assert.equal(target.account,env.CLOUDFLARE_ACCOUNT_ID);verifyDomains(await read('workers/domains'),p);
  const before=await read(`workers/scripts/${p.worker}/deployments`);assert.equal(before.deployments?.[0]?.id,expectedDeployment,'Serving state changed before recovery');
  const version=await read(`workers/scripts/${p.worker}/versions/${target.versionId}`);
  validateActivation({receipt:target,deployment:{id:target.deploymentId,versions:[{version_id:target.versionId,percentage:100}]},version},target);
  assert.equal((await api('git/ref/heads/main')).object.sha,env.GITHUB_SHA);
  await activate(target.versionId);
  const after=await read(`workers/scripts/${p.worker}/deployments`);assert.notEqual(after.deployments?.[0]?.id,expectedDeployment,'No new recovery activation');
  const receipt={...target,kind:'rollback',restoredFrom:Number(receiptId),deploymentId:after.deployments?.[0]?.id};
  validateActivation({receipt,deployment:after.deployments?.[0]||{},version},target);
  return receipt;
}
