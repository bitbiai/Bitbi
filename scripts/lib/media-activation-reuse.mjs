// Reuse only the exact, already-active Media version from a protected partial
// activation. This proves component identity; it grants no frontend acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mediaImageInputs} from '../private-media-image.mjs';
import {api,collection,sourceAttempt,gitSelection,isRequiredValidationRun,validateSource,REPOSITORY} from '../pages-candidate.mjs';
import {cloudflareRead} from './frontend-hosting.mjs';

const shaPattern=/^[a-f0-9]{40}$/;
export function mediaInputsUnchanged(source,head,{repoRoot=process.cwd(),inputs=Object.keys(mediaImageInputs())}={}) {
  for(const sha of [source,head])assert(shaPattern.test(sha||''),'Missing exact media input source');
  const git=args=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git(['merge-base','--is-ancestor',source,head]);
  // Directory roots also catch deleted inputs absent from the current file map.
  const paths=[...new Set(['services/homepage-ffmpeg-processor','workers/media',...inputs])].sort();
  const tree=sha=>git(['ls-tree','-rz','--full-tree',sha,'--',...paths]).split('\0').filter(Boolean).sort();
  const before=tree(source),after=tree(head);
  assert(before.length&&after.length,'Missing media source tree');
  for(const row of [...before,...after])assert(/^100(?:644|755) blob [a-f0-9]{40}\t/.test(row),'Media input is not a regular Git file');
  return JSON.stringify(before)===JSON.stringify(after);
}

export function verifyMediaActivationWindow({authorization,status,job,run,deployment,version},sourceSha) {
  assert.equal(authorization.environment,'cloudflare-static-production');
  assert.equal(authorization.task,'deploy');assert.equal(authorization.sha,sourceSha);
  assert.equal(status.state,'failure');
  const link=status.log_url?.match(/^https:\/\/github\.com\/bitbiai\/Bitbi\/actions\/runs\/(\d+)\/job\/(\d+)$/);
  assert(link,'Missing protected media activation job');
  assert.equal(String(run.id),link[1]);assert.equal(String(job.id),link[2]);
  assert.equal(run.repository?.full_name,REPOSITORY);assert.equal(run.head_repository?.full_name,REPOSITORY);
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');
  assert(['push','workflow_dispatch'].includes(run.event));
  assert.equal(run.head_sha,sourceSha);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assert.equal(job.name,'deploy');assert.equal(job.head_sha,sourceSha);assert.equal(String(job.run_id),String(run.id));
  assert.equal(job.run_attempt,run.run_attempt);assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  for(const [name,conclusion] of [['Validate candidate references before backend publication','success'],['Apply verified candidate backend prerequisites','failure'],['Preserve backend activation evidence','skipped']])
    assert(job.steps?.some(s=>s.name===name&&s.status==='completed'&&s.conclusion===conclusion),`Unexpected partial media activation step: ${name}`);
  const step=job.steps.find(s=>s.name==='Apply verified candidate backend prerequisites');
  const at=Date.parse(deployment.created_on),start=Date.parse(step.started_at),end=Date.parse(step.completed_at);
  assert([at,start,end].every(Number.isFinite)&&start<=at&&at<=end,'Media activation is outside the protected failed step');
  assert.deepEqual(deployment.versions,[{version_id:version.id,percentage:100}],'Media is not fully active');
  return {run:String(run.id),attempt:String(run.run_attempt),job:job.id,authorization:authorization.id,
    workerVersion:version.id,deployment:deployment.id,activatedAt:deployment.created_on};
}

export async function resolveActiveMediaSource(c,{
  readCloudflare=cloudflareRead,read=api,list=collection,loadAttempt=sourceAttempt,
  selection=gitSelection,unchanged=mediaInputsUnchanged,
}={}) {
  for(const sha of [c.sha,c.base])assert(shaPattern.test(sha||''),'Missing exact candidate source');
  let deployments;
  try{deployments=await readCloudflare('workers/scripts/bitbi-private-media/deployments');}
  catch(error){if(error.message==='Cloudflare read failed (404)')return null;throw error;}
  const deployment=deployments.deployments?.[0];
  if(!deployment)return null;
  assert(deployment.versions?.length===1&&deployment.versions[0].percentage===100,'Ambiguous active media traffic');
  const version=await readCloudflare(`workers/scripts/bitbi-private-media/versions/${deployment.versions[0].version_id}`);
  assert.equal(version.id,deployment.versions[0].version_id,'Wrong active media version');
  const message=version.annotations?.['workers/message']?.match(/^bitbi-media:([a-f0-9]{40}):(registry\.cloudflare\.com\/[a-f0-9]{32}\/bitbi-private-media@sha256:[a-f0-9]{64})$/);
  assert(message,'Unattributed active media source');
  const [,sha,imageDigest]=message;
  assert(version.resources?.bindings?.some(b=>b.name==='SOURCE_SHA'&&b.text===sha),'Active media source binding differs');
  if(sha===c.sha)return null; // Existing same-source publication already fences reuse.
  if(!unchanged(sha,c.sha))return null; // Changed media requires its normal new deployment.
  execFileSync('git',['merge-base','--is-ancestor',c.base,sha],{stdio:'pipe'});

  const authorizations=await read(`deployments?environment=cloudflare-static-production&sha=${sha}&per_page=100`);
  const matches=[];
  for(const authorization of authorizations.filter(d=>d.environment==='cloudflare-static-production'&&d.task==='deploy'&&d.sha===sha)) {
    const statuses=await read(`deployments/${authorization.id}/statuses`);
    for(const status of statuses.filter(s=>s.state==='failure')) {
      const link=status.log_url?.match(/^https:\/\/github\.com\/bitbiai\/Bitbi\/actions\/runs\/(\d+)\/job\/(\d+)$/);
      if(!link)continue;
      const job=await read(`actions/jobs/${link[2]}`),step=job.steps?.find(s=>s.name==='Apply verified candidate backend prerequisites');
      const at=Date.parse(deployment.created_on);
      if(!step||!(Date.parse(step.started_at)<=at&&at<=Date.parse(step.completed_at)))continue;
      const selected=selection(c.base,sha);
      const run=await loadAttempt(link[1],String(job.run_attempt),selected);
      const activation=verifyMediaActivationWindow({authorization,status,job,run,deployment,version},sha);
      const [jobs,artifacts,runs,ref]=await Promise.all([
        list(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,'jobs'),
        list(`actions/runs/${run.id}/artifacts`,'artifacts'),
        list(`actions/runs?head_sha=${sha}`,'workflow_runs'),read('git/ref/heads/main'),
      ]);
      const relevant=runs.filter(r=>isRequiredValidationRun(r,selected));
      for(const later of relevant.filter(r=>Date.parse(r.created_at)>Date.parse(run.created_at)&&r.conclusion!=='success'))
        later.jobs=await list(`actions/runs/${later.id}/attempts/${later.run_attempt}/jobs`,'jobs');
      validateSource({run,jobs,artifacts,laterRuns:relevant,mainSha:ref.object.sha},
        {repository:REPOSITORY,sha,publicationSha:c.sha,base:c.base,run:String(run.id),attempt:String(run.run_attempt),selection:selected},
        {historicalActivation:true});
      const images=artifacts.filter(a=>a.name===`private-media-image-${sha}-${run.id}-${run.run_attempt}`);
      assert.equal(images.length,1,'Missing/ambiguous original tested media image');
      const artifact=images[0];
      assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now(),'Expired original media image');
      assert.equal(artifact.workflow_run?.id,run.id);assert.equal(artifact.workflow_run?.head_sha,sha);
      assert(artifact.size_in_bytes>0&&/^sha256:[a-f0-9]{64}$/.test(artifact.digest),'Invalid original media image artifact');
      matches.push({sha,run:String(run.id),attempt:String(run.run_attempt),imageDigest,
        artifact:{id:artifact.id,digest:artifact.digest},activation});
    }
  }
  assert.equal(matches.length,1,'Missing/ambiguous protected media activation provenance');
  const current=(await readCloudflare('workers/scripts/bitbi-private-media/deployments')).deployments?.[0];
  assert.deepEqual(current,deployment,'Media activation changed during source verification');
  return matches[0];
}

export function verifyReusedMediaReceipt(receipt,c,source) {
  assert(source,'Original media source no longer eligible');
  assert.equal(receipt.mediaSourceSha,source.sha,'Wrong retained media source');
  for(const [key,value] of Object.entries({sha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,imageDigest:source.imageDigest}))
    assert.equal(receipt.media?.[key],value,`Wrong reused media ${key}`);
  assert.deepEqual(receipt.media.artifact,source.artifact,'Wrong reused media artifact');
  assert.deepEqual(receipt.media.reusedActivation,source.activation,'Wrong original media activation');
  assert.equal(receipt.media.workerVersion,source.activation.workerVersion);
  assert.equal(receipt.media.deployment,source.activation.deployment);
  assert.deepEqual(receipt.mediaAcceptance,{publicationSha:c.sha,run:c.runId,attempt:c.attempt},'Missing fresh media acceptance identity');
}
