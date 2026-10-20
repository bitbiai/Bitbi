// One interrupted protected publication. Retain tested product bytes and stored
// synthetic outputs; this grants no permission to start or repair media jobs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readCanvasRecoveryJobs,canvasRecoveryActor} from './canvas-agent-backend-recovery.mjs';

export const COMPLETED_MEDIA_SOURCE=Object.freeze({
  sha:'5124a1c8d5e36fa855dc9442a45874f9f513b4fe',base:'6881a7f8a558097bc16b5370239635777a63b0cf',
  run:'39477957529',attempt:'1',job:'118819126004',authorization:7208253183,
  log:Object.freeze({sha256:'96e4f9c4c9e9b7b4354a652132fb15f33f88b112391fd10c5efc6060b3a31779',bytes:86773}),
  candidate:Object.freeze({id:12290100847,digest:'sha256:88fc2d4a8ab602af5ae526173217d2b6cd1e6a588c355209734ec0739ae53b81'}),
  media:Object.freeze({id:12289713086,digest:'sha256:a873781a2ffb27ed155c2433c693935c0e71f8f45e1f22ade41106682067e708'}),
});
export const COMPLETED_MEDIA_FIRST_CONTINUATION='b7b5ede1ff5a5af19b0f9ddeb98b27ae73f0ff59';
// The original GitHub runner finished its accepted poster publication after the
// independent release observer failed. Retain that exact terminal row; the
// protected activation window remains unchanged for every other record.
export const COMPLETED_MEDIA_LATE_FINISH=Object.freeze({
  backend:'github',id:'cbf25be74d8712aa4bfc163baa09fb1a',
  createdAt:'2026-10-20T18:53:28.238Z',completedAt:'2026-10-20T18:55:14.793Z',
  rowDigest:'5611dac1bb6836044aca2f6b1e9e088e1309744e21892741a8d0f7861c94f1a3',
});
export const COMPLETED_MEDIA_FILES=Object.freeze([
  '.github/workflows/static.yml','scripts/lib/completed-media-continuation.mjs',
  'scripts/lib/canvas-agent-deploy-continuation.mjs','scripts/lib/media-repair-source.mjs',
  'scripts/lib/media-publication.mjs','scripts/lib/backend-publication.mjs',
  'scripts/pages-candidate.mjs','scripts/test-completed-media-continuation.mjs',
  'scripts/test-release-plan.mjs','scripts/lib/ci-test-selection.mjs',
  'docs/runbooks/REGRESSION_REGISTER.md',
]);
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const hash=value=>createHash('sha256').update(value).digest('hex');
export function completedMediaFiles(files) {
  return files.includes('scripts/lib/completed-media-continuation.mjs')&&
    files.every(file=>COMPLETED_MEDIA_FILES.includes(file));
}
export function assertCompletedMediaDelta(head,{read=git}={}) {
  const source=COMPLETED_MEDIA_SOURCE;
  assert(/^[a-f0-9]{40}$/.test(head||'')&&head!==source.sha,'Missing exact continuation head');
  const parent=read(['rev-parse',`${head}^`]);
  if(parent===COMPLETED_MEDIA_FIRST_CONTINUATION)
    assert.equal(read(['rev-parse',`${parent}^`]),source.sha,'Changed first continuation ancestry');
  else assert.equal(parent,source.sha,'Continuation must follow its accepted source or the pinned first continuation');
  const rows=sha=>read(['ls-tree','-rz',sha]).split('\0').filter(Boolean);
  const keep=rows=>rows.filter(row=>!COMPLETED_MEDIA_FILES.includes(row.split('\t')[1]));
  assert.deepEqual(keep(rows(head)),keep(rows(source.sha)),'Completed-media continuation changed accepted product inputs');
  const files=read(['diff','--name-only','--no-renames',source.sha,head]).split('\n').filter(Boolean);
  assert(completedMediaFiles(files),'Unreviewed continuation files');
  for(const file of COMPLETED_MEDIA_FILES.filter(file=>!file.startsWith('docs/')))assert(rows(head).some(row=>row.endsWith(`\t${file}`)),'Missing continuation input');
  for(const row of rows(head).filter(row=>COMPLETED_MEDIA_FILES.includes(row.split('\t')[1])))
    assert(/^100644 blob [a-f0-9]{40}\t/.test(row),'Continuation requires regular reviewed files');
  return files;
}
export function resolveCompletedMediaSource(env=process.env,options) {
  const source=COMPLETED_MEDIA_SOURCE;
  if(env.CANDIDATE_RUN!==source.run||env.GITHUB_SHA===source.sha)return null;
  for(const[key,value]of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'bitbiai/Bitbi',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',CANDIDATE_BASE:source.base,CANDIDATE_ATTEMPT:source.attempt}))assert.equal(env[key],value,'Wrong completed-media continuation authority');
  assertCompletedMediaDelta(env.GITHUB_SHA,options);return source;
}
export function assertCompletedMediaAcceptance(jobs,sha) {
  const selected=jobs.filter(job=>job.name==='reuse-candidate');assert.equal(selected.length,1);
  const job=selected[0];assert.equal(job.head_sha,sha);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  for(const name of ['Verify completed media continuation guards','Preflight acknowledged full release','Verify exact completed source acceptance'])
    assert(job.steps.some(step=>step.name===name&&step.status==='completed'&&step.conclusion==='success'),`Missing continuation guard: ${name}`);
  assert(jobs.some(job=>job.name==='release-compatibility'&&job.conclusion==='skipped'),'Accepted suites must retain their source identity');
}
export function assertCompletedMediaArtifact(artifact,kind) {
  const source=COMPLETED_MEDIA_SOURCE,pin=source[kind];assert(pin&&['candidate','media'].includes(kind));
  assert.equal(artifact.id,pin.id);assert.equal(artifact.digest,pin.digest);
  assert.equal(artifact.workflow_run?.id,Number(source.run));assert.equal(artifact.workflow_run?.head_sha,source.sha);
  assert.equal(artifact.expired,false);assert(Date.parse(artifact.expires_at)>Date.now());
}
export function completedMediaDeferredPush(jobs,sha) {
  const lifecycle=new Set(['Set up job','Checkout','Defer pinned deployment-only push','Post Checkout','Complete job']);
  const validation=jobs.filter(job=>job.name==='release-compatibility');
  return validation.length===1&&jobs.every(job=>job.name==='release-compatibility'
    ?job.head_sha===sha&&job.status==='completed'&&job.conclusion==='success'&&job.steps.some(step=>step.name==='Defer pinned deployment-only push'&&step.conclusion==='success')&&job.steps.every(step=>lifecycle.has(step.name)?step.conclusion==='success':step.conclusion==='skipped')
    :job.conclusion==='skipped');
}
export async function completedMediaEvidence({read,download,token}) {
  const source=COMPLETED_MEDIA_SOURCE;
  const [run,job,authorization,statuses]=await Promise.all([read(`actions/runs/${source.run}`),read(`actions/jobs/${source.job}`),read(`deployments/${source.authorization}`),read(`deployments/${source.authorization}/statuses`)]);
  for(const key of ['repository','head_repository'])assert.equal(run[key]?.full_name,'bitbiai/Bitbi');
  assert.equal(run.path,'.github/workflows/static.yml');assert.equal(run.head_branch,'main');assert.equal(run.head_sha,source.sha);assert.equal(String(run.run_attempt),source.attempt);assert.equal(run.conclusion,'failure');assert.equal(run.status,'completed');
  assert.equal(String(job.id),source.job);assert.equal(job.name,'deploy');assert.equal(job.head_sha,source.sha);assert.equal(String(job.run_id),source.run);assert.equal(String(job.run_attempt),source.attempt);assert.equal(job.conclusion,'failure');assert.equal(job.status,'completed');
  assert.equal(authorization.sha,source.sha);assert.equal(authorization.task,'deploy');assert.equal(authorization.environment,'cloudflare-static-production');
  assert(statuses.some(status=>status.state==='failure'&&status.log_url===`https://github.com/bitbiai/Bitbi/actions/runs/${source.run}/job/${source.job}`),'Missing original protected failure');
  for(const[name,conclusion]of [['Validate candidate references before backend publication','success'],['Apply verified candidate backend prerequisites','failure'],['Preserve backend activation evidence','skipped'],['Deploy and verify Cloudflare frontend','skipped']])
    assert(job.steps.some(step=>step.name===name&&step.status==='completed'&&step.conclusion===conclusion),'Changed original failure boundary');
  const response=await download(`https://api.github.com/repos/bitbiai/Bitbi/actions/jobs/${source.job}/logs`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Original protected log unavailable');const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length,source.log.bytes);assert.equal(hash(bytes),source.log.sha256);
  return {source,run,job,logBytes:bytes.length,logDigest:hash(bytes)};
}
export async function readCompletedMediaJobs(evidence,query) {
  assert.deepEqual(evidence.source,COMPLETED_MEDIA_SOURCE);
  const proof=await readCanvasRecoveryJobs(evidence,query,{completed:true});
  verifyCompletedMediaJobs(proof);return proof;
}
export function verifyCompletedMediaJobs(proof) {
  const source=COMPLETED_MEDIA_SOURCE;
  for(const[key,value]of Object.entries({sourceSha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,sourceJob:source.job,logDigest:source.log.sha256,logBytes:source.log.bytes}))assert.equal(proof[key],value);
  assert.equal(proof.owner,'bitbi-private-media-release-smoke');assert.equal(hash(JSON.stringify(proof.records)),proof.recordsDigest);
  assert(Number.isFinite(Date.parse(proof.window.startedAt))&&Date.parse(proof.window.completedAt)>Date.parse(proof.window.startedAt));
  for(const backend of ['github','cloudflare']) {
    const rows=proof.records.groups[backend]?.rows;assert.equal(rows?.length,3);
    for(const row of rows) {
      assert(row.status==='ready'&&row.attempt_count===1&&row.processing_token===true&&!row.locked_until,'Only original completed smoke jobs with final-stage attempt 1 may be retained');
      if(Date.parse(row.updated_at)<=Date.parse(proof.window.completedAt))continue;
      const late=COMPLETED_MEDIA_LATE_FINISH;
      assert.equal(backend,late.backend);assert.equal(row.id,late.id);
      assert.equal(row.created_at,late.createdAt);assert.equal(row.updated_at,late.completedAt);
      assert.equal(hash(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))),late.rowDigest,'Changed late completed smoke receipt');
    }
  }
}
export function verifyCompletedMediaLifecycle(cycle,proof) {
  verifyCompletedMediaJobs(proof);
  assert.equal(cycle.policy,'prior-completed-processing-v1');assert.deepEqual(cycle.priorExecution,proof);
  assert.equal(cycle.actor.sourceSha,proof.sourceSha);assert.equal(cycle.actor.name,'private-media-singleton');
  assert.equal(cycle.stoppedNow.instance,cycle.actor.instance);assert(['stopped','inactive'].includes(cycle.stoppedNow.state));
  const completedAt=Math.max(Date.parse(proof.window.completedAt),...Object.values(proof.records.groups).flatMap(group=>group.rows.map(row=>Date.parse(row.updated_at))));
  assert(Date.parse(cycle.stoppedNow.observedAt)>=completedAt);
  assert(!cycle.running&&!cycle.stoppedBefore&&!cycle.stoppedAfter,'Unrecorded historical lifecycle observations must not be fabricated');
}
export function completedMediaLifecycle(media,proof,stoppedNow) {
  const cycle={policy:'prior-completed-processing-v1',priorExecution:proof,actor:canvasRecoveryActor(media,COMPLETED_MEDIA_SOURCE),stoppedNow};
  verifyCompletedMediaLifecycle(cycle,proof);return cycle;
}
