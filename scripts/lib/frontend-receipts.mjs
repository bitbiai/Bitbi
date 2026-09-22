import { repairDelta, repairKind, assertRepairAcceptance } from './media-repair-source.mjs';
// GitHub deployment payloads survive Actions artifact expiry. They are only
// evidence together with their protected Actions job and Cloudflare identity.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gitSelection,validateSource,isRequiredValidationRun} from '../pages-candidate.mjs';
import {hash,hostingPolicy,cloudflareRead,validateActivation,verifyDomains} from './frontend-hosting.mjs';
export const RECEIPT_TASK='bitbi-static-receipt';
const repo='bitbiai/Bitbi';
const baselineIdentity=(id,receipt)=>({sha:receipt.kind==='publication'&&(receipt.mediaRepair||receipt.releaseRepair)?receipt.publicationSha:receipt.sha,deployment:receipt.deploymentId,run:receipt.publicationRun,receipt:id});
async function artifactFile(artifact,filename,{download,env,limit=65536}) {
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now(),'Expired activation evidence');
  assert(/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''),'Missing activation archive digest');
  assert(artifact.size_in_bytes>0&&artifact.size_in_bytes<=128*1024*1024,'Invalid activation archive size');
  const response=await download(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`,{headers:{Authorization:`Bearer ${env.GH_TOKEN}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Cannot retrieve activation evidence');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length,artifact.size_in_bytes);assert.equal(`sha256:${hash(bytes)}`,artifact.digest,'Activation archive digest mismatch');
  return execFileSync('python3',['-I','-c',`import sys,io,zipfile,stat,pathlib
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 entries=z.infolist();assert len(entries)<=21000
 names=[e.filename for e in entries];assert len(names)==len(set(names))
 for e in entries:
  p=pathlib.PurePosixPath(e.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in e.filename
  assert stat.S_IFMT((e.external_attr>>16)&0xffff) in (0,stat.S_IFREG,stat.S_IFDIR)
 e=z.getinfo(sys.argv[1]);assert e.file_size<=int(sys.argv[2])
 sys.stdout.buffer.write(z.read(e))
`,filename,String(limit)],{input:bytes,timeout:10000,maxBuffer:limit});
}
// A post-activation verification failure is not a successful publication. This
// read-only path recognizes only its exact protected upload, retaining the LAST
// accepted baseline until a new protected job verifies it and records success.
export async function findPendingFrontendActivation({api=githubRequest,read=cloudflareRead,download=fetch,env=process.env,baseline,manifest}={}) {
  const p=hostingPolicy();
  if(!baseline){const records=await api(`deployments?environment=${p.productionEnvironment}&task=${RECEIPT_TASK}&per_page=1`);assert.equal(records.length,1,'Missing previous durable baseline');baseline={id:records[0].id,receipt:await loadDurableReceipt(records[0].id,api)};}
  const previous=baselineIdentity(baseline.id,baseline.receipt),active=(await read(`workers/scripts/${p.worker}/deployments`)).deployments?.[0];assert(active,'Missing active frontend');
  if(active.id===baseline.receipt.deploymentId)return null;
  assert.equal(env.GITHUB_REPOSITORY,repo);assert.equal(env.GITHUB_REF,'refs/heads/main');assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''));
  assert(/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID||''));assert.equal(baseline.receipt.account,env.CLOUDFLARE_ACCOUNT_ID,'Prior baseline account differs');
  assert.equal((await api('git/ref/heads/main')).object.sha,env.GITHUB_SHA,'Superseded reconciliation revision');
  assert.equal(active.versions?.length,1,'Unconfirmed mixed frontend activation');assert.equal(active.versions[0].percentage,100);
  const version=await read(`workers/scripts/${p.worker}/versions/${active.versions[0].version_id}`),message=version.annotations?.['workers/message'];
  const match=message?.match(/^bitbi:([a-f0-9]{40}):([1-9][0-9]*):([1-9][0-9]*):([a-f0-9]{64})$/);assert(match,'Unattributed active frontend');
  const [,sha,run,attempt,packageDigest]=match,files=repairDelta(sha,env.GITHUB_SHA,previous.sha);assert.equal(repairKind(files),'tooling','Only unchanged frontend tooling repair can reconcile activation');
  const source=await api(`actions/runs/${run}`);assert.equal(String(source.run_attempt),attempt,'Source attempt changed; review its evidence');
  const jobs=(await api(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`)).jobs,artifacts=(await api(`actions/runs/${run}/artifacts?per_page=100`)).artifacts;
  const selection=gitSelection(previous.sha,sha),expected={repository:repo,sha,publicationSha:env.GITHUB_SHA,base:previous.sha,run,attempt,currentRun:env.GITHUB_RUN_ID,selection};
  const later=(await api(`actions/runs?head_sha=${sha}&per_page=100`)).workflow_runs.filter(r=>isRequiredValidationRun(r,selection));
  for(const r of later.filter(r=>Date.parse(r.created_at)>Date.parse(source.created_at)&&r.conclusion!=='success'))r.jobs=(await api(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`)).jobs;
  const selected=validateSource({run:source,jobs,artifacts,laterRuns:later,mainSha:env.GITHUB_SHA},expected,{mediaRepair:true});
  assert(selected.every(a=>Date.parse(a.expires_at)>Date.now()),'Expired original candidate evidence');
  const candidate=JSON.parse(await artifactFile(selected[0],'manifest.json',{download,env,limit:4*1024*1024}));
  for(const key of ['sha','run','attempt','base'])assert.equal(candidate[key],expected[key],`Activated candidate ${key} mismatch`);
  assert.deepEqual(candidate.selection,selection);assert.equal(hash(JSON.stringify(candidate)),packageDigest,'Active version differs from accepted candidate');
  if(manifest)assert.deepEqual(candidate,manifest,'Reconciliation candidate differs from current verified archive');
  const receipt={sha,run,attempt,packageDigest,worker:p.worker,account:env.CLOUDFLARE_ACCOUNT_ID,provider:'cloudflare',target:'production',versionId:version.id,deploymentId:active.id};
  validateActivation({receipt,deployment:active,version},receipt);receipt.domains=verifyDomains(await read('workers/domains'),p);
  const deployments=await api(`deployments?environment=${p.productionEnvironment}&per_page=100`),matches=[];
  for(const d of deployments.filter(d=>d.task==='deploy')) {
    let delta;try{delta=repairDelta(sha,d.sha,previous.sha);execFileSync('git',['merge-base','--is-ancestor',d.sha,env.GITHUB_SHA],{stdio:'pipe'});}catch{continue;}
    if(repairKind(delta)!=='tooling')continue;
    const statuses=await api(`deployments/${d.id}/statuses`),status=statuses[0],log=status?.log_url?.match(/^https:\/\/github\.com\/bitbiai\/Bitbi\/actions\/runs\/(\d+)\/job\/(\d+)$/);
    if(status?.state!=='failure'||!log)continue;
    assert.notEqual(log[1],String(env.GITHUB_RUN_ID),'Current failed run cannot reconcile its own activation');
    assert.equal(d.environment,p.productionEnvironment,'Activation lacks protected production environment');
    const failedRun=await api(`actions/runs/${log[1]}`),job=await api(`actions/jobs/${log[2]}`);
    assert.equal(String(failedRun.id),log[1]);assert.equal(failedRun.repository?.full_name,repo);assert.equal(failedRun.head_repository?.full_name,repo);assert.equal(failedRun.path,'.github/workflows/static.yml');assert.equal(failedRun.head_branch,'main');assert(['push','workflow_dispatch'].includes(failedRun.event));assert.equal(failedRun.head_sha,d.sha);assert.equal(failedRun.status,'completed');assert.equal(failedRun.conclusion,'failure');
    assert.equal(job.name,'deploy');assert.equal(job.head_sha,d.sha);assert.equal(String(job.run_id),log[1]);assert.equal(String(job.id),log[2]);assert.equal(job.run_attempt,failedRun.run_attempt);assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
    for(const name of ['Validate candidate references before backend publication','Apply verified candidate backend prerequisites','Preserve backend activation evidence','Preserve failed frontend upload identity'])assert(job.steps.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'),`Missing protected activation step: ${name}`);
    assert(job.steps.some(s=>s.name==='Deploy and verify Cloudflare frontend'&&s.status==='completed'&&s.conclusion==='failure'),'Missing post-upload failure');assert(job.steps.some(s=>s.name==='Record durable frontend receipt'&&s.status==='completed'&&s.conclusion==='skipped'),'Prior failed job unexpectedly recorded acceptance');
    assertRepairAcceptance((await api(`actions/runs/${log[1]}/attempts/${job.run_attempt}/jobs?per_page=100`)).jobs,d.sha,delta);
    const uploads=(await api(`actions/runs/${log[1]}/artifacts?per_page=100`)).artifacts.filter(a=>a.name===`frontend-failed-upload-${d.sha}-${log[1]}-${job.run_attempt}`);assert.equal(uploads.length,1,'Missing exact failed upload evidence');const artifact=uploads[0];assert.equal(String(artifact.workflow_run?.id),log[1]);assert.equal(artifact.workflow_run?.head_sha,d.sha);
    const records=(await artifactFile(artifact,'frontend-upload.ndjson',{download,env})).toString().trim().split('\n').map(JSON.parse),uploadsFound=records.filter(r=>r.type==='deploy'),sessions=records.filter(r=>r.type==='wrangler-session');assert.equal(uploadsFound.length,1);assert.equal(sessions.length,1);
    const upload=uploadsFound[0],args=sessions[0].command_line_args;assert.equal(sessions[0].wrangler_version,p.wranglerVersion);assert.equal(args[0],'deploy');assert.equal(args[args.indexOf('--message')+1],message);assert.equal(upload.worker_name,p.worker);assert.equal(upload.version_id,version.id);assert.equal(upload.worker_name_overridden,false);
    matches.push({previousReceipt:baseline.id,previousSha:previous.sha,publicationSha:d.sha,run:log[1],attempt:String(job.run_attempt),job:job.id,authorization:d.id,artifact:{id:artifact.id,digest:artifact.digest},candidateArtifact:{id:selected[0].id,digest:selected[0].digest},versionId:version.id,deploymentId:active.id});
  }
  assert.equal(matches.length,1,'Missing unique protected failed activation for exact current candidate');
  receipt.activationReconciliation=matches[0];return {receipt,reconciliation:matches[0],baseline:previous};
}
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
  } else {
    assert.equal(receipt.kind,'publication');
    const repair=receipt.releaseRepair||receipt.mediaRepair;
    if(repair){
      assert(!(receipt.releaseRepair&&receipt.mediaRepair),'Ambiguous repair receipt');
      assert.equal(repair.sourceSha,receipt.sha);assert.equal(repair.publicationSha,receipt.publicationSha);
      const files=repairDelta(receipt.sha,receipt.publicationSha,receipt.sha),kind=repairKind(files);
      assert.equal(kind,receipt.releaseRepair?repair.kind:'media','Repair receipt policy mismatch');
      assertRepairAcceptance((await api(`actions/runs/${receipt.publicationRun}/attempts/${receipt.publicationAttempt}/jobs?per_page=100`)).jobs,receipt.publicationSha,files);
      if(kind==='tooling')assert(job.steps.some(s=>s.name==='Validate candidate references before backend publication'&&s.status==='completed'&&s.conclusion==='success'),'Missing pre-publication reference validation');
      assert(job.steps.some(s=>s.name==='Apply verified candidate backend prerequisites'&&s.conclusion==='success'),'Missing repaired backend publication');
    }else assert.equal(receipt.sha,receipt.publicationSha);
    if(receipt.activationReconciliation) {
      const prior=receipt.activationReconciliation;assert.equal(receipt.releaseRepair?.kind,'tooling');
      assert.notEqual(String(prior.run),String(receipt.publicationRun),'Failed activation cannot authorize itself');
      assert.equal(prior.versionId,receipt.versionId);assert.equal(prior.deploymentId,receipt.deploymentId);
      assert(prior.previousReceipt&&prior.previousSha&&prior.artifact?.digest&&prior.candidateArtifact?.digest&&receipt.appearanceAcceptance,'Incomplete reconciliation receipt');
      const failed=await api(`actions/jobs/${prior.job}`),authorization=await api(`deployments/${prior.authorization}`);
      assert.equal(failed.name,'deploy');assert.equal(failed.head_sha,prior.publicationSha);assert.equal(String(failed.run_id),prior.run);assert.equal(String(failed.run_attempt),prior.attempt);assert.equal(failed.status,'completed');assert.equal(failed.conclusion,'failure','Prior failure must remain failed');
      assert.equal(authorization.environment,p.productionEnvironment);assert.equal(authorization.task,'deploy');assert.equal(authorization.sha,prior.publicationSha);
      assert((await api(`deployments/${prior.authorization}/statuses`)).some(s=>s.state==='failure'&&s.log_url===`https://github.com/${repo}/actions/runs/${prior.run}/job/${prior.job}`),'Missing prior protected activation failure');
    }
  }
  return receipt;
}
export async function durableBaseline(api=githubRequest,read=cloudflareRead,options={}) {
  const p=hostingPolicy(),records=await api(`deployments?environment=${p.productionEnvironment}&task=${RECEIPT_TASK}&per_page=1`);
  if(!records.length)return null;
  const receipt=await loadDurableReceipt(records[0].id,api);
  const active=await read(`workers/scripts/${p.worker}/deployments`);
  if(active.deployments?.[0]?.id!==receipt.deploymentId) {
    const pending=await findPendingFrontendActivation({...options,api,read,baseline:{id:records[0].id,receipt}});
    return {...pending.baseline,pendingReconciliation:pending.reconciliation};
  }
  const version=await read(`workers/scripts/${p.worker}/versions/${receipt.versionId}`);
  verifyDomains(await read('workers/domains'),p);
  validateActivation({receipt,deployment:active.deployments?.[0]||{},version},{...receipt,account:process.env.CLOUDFLARE_ACCOUNT_ID});
  return baselineIdentity(records[0].id,receipt);
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
  if(receipt.activationReconciliation) {
    const pending=await findPendingFrontendActivation({api,read,env});assert(pending,'Reconciled activation is no longer pending');
    assert.deepEqual(receipt.activationReconciliation,pending.reconciliation,'Activation reconciliation changed before durable acceptance');
    for(const key of ['sha','run','attempt','packageDigest','versionId','deploymentId'])assert.equal(receipt[key],pending.receipt[key]);
    assert(receipt.appearanceAcceptance,'Missing current live appearance acceptance');
  }
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
