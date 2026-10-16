// Closed recovery of the first Canvas activation. These reads cannot create,
// restart or reassign a job. The original protected failure remains a failure.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const CANVAS_RECOVERY_OWNER='bitbi-private-media-release-smoke';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const canvasRecoveryId=value=>digest(value).slice(0,32);
const time=value=>{const result=Date.parse(value);assert(Number.isFinite(result),'Missing recovery timestamp');return result;};
export function canvasRecoveryWindow(evidence) {
  const step=evidence.job.steps.find(row=>row.name==='Apply verified candidate backend prerequisites');
  assert(step?.status==='completed'&&step.conclusion==='failure','Recovery requires the failed protected backend step');
  const start=time(step.started_at),end=time(step.completed_at);assert(start<end);
  assert.equal(evidence.logDigest,evidence.source.log.sha256);assert.equal(evidence.logBytes,evidence.source.log.bytes);
  return {startedAt:step.started_at,completedAt:step.completed_at};
}
export function verifyCanvasRecoveryComponent(state,evidence,worker) {
  const {source}=evidence,window=canvasRecoveryWindow(evidence);
  assert.equal(state.version.id,state.deployment.versions?.[0]?.version_id);
  assert.deepEqual(state.deployment.versions,[{version_id:state.version.id,percentage:100}],'Retained component must serve all traffic');
  const prefix=worker==='media'?'bitbi-media:':`bitbi-${worker}:`;
  const message=state.version.annotations?.['workers/message'];
  assert(worker==='media'?message?.startsWith(`${prefix}${source.sha}:registry.cloudflare.com/`):message===`${prefix}${source.sha}`,'Wrong retained component source');
  for(const at of [state.deployment.created_on,state.version.metadata?.created_on||state.version.created_on])
    assert(time(at)>=time(window.startedAt)&&time(at)<=time(window.completedAt),'Retained component was not activated by the failed protected step');
  return {sha:source.sha,version:state.version.id,deployment:state.deployment.id,createdAt:state.version.metadata?.created_on||state.version.created_on,activatedAt:state.deployment.created_on};
}
export async function readCanvasRecoveryJobs(evidence,query,{completed=false}={}) {
  const {source}=evidence,window=canvasRecoveryWindow(evidence),owner=CANVAS_RECOVERY_OWNER;
  const accounts=await query('SELECT id,status FROM users WHERE id=?',[owner]);
  assert.deepEqual(accounts,[{id:owner,status:'disabled'}],'Recovery may inspect only the disabled synthetic owner');
  const groups={};
  for(const backend of ['github','cloudflare']) {
    const project=canvasRecoveryId(`media-smoke:${source.sha}:${backend}`);
    const rows=await query(`SELECT p.id,p.user_id,p.project_id,p.kind,p.status,p.attempt_count,p.processing_token,p.locked_until,p.created_at,p.updated_at,p.asset_id,a.r2_key,a.poster_r2_key
      FROM canvas_video_processing p LEFT JOIN ai_text_assets a ON a.id=p.asset_id AND a.user_id=p.user_id
      WHERE p.user_id=? AND p.project_id=? AND p.processing_backend=? ORDER BY p.id`,[owner,project,backend]);
    const expected=[project,...[0,1].map(index=>canvasRecoveryId(`${project}:asset:${index}`))].sort();
    assert.deepEqual(rows.map(row=>row.id).sort(),expected,'Missing or unrelated recovery exports');
    assert.deepEqual(rows.map(row=>row.kind).sort(),['concat','poster','poster']);
    for(const row of rows) {
      assert.equal(row.user_id,owner);assert.equal(row.project_id,project);
      assert(time(row.created_at)>=time(window.startedAt)&&time(row.created_at)<=time(window.completedAt),'Smoke export is outside original activation');
      if(backend==='cloudflare'||!completed)assert(time(row.updated_at)<=time(window.completedAt),'Smoke export changed after original failure');
      assert(!row.locked_until,'Active lease blocks recovery');
      if(backend==='github'&&!completed)assert(row.status==='queued'&&row.attempt_count===0&&!row.processing_token,'GitHub work was accepted or changed; do not replay');
      else assert(row.status==='ready'&&row.processing_token&&row.asset_id&&row.r2_key&&row.poster_r2_key,'Original Cloudflare exports did not complete');
    }
    groups[backend]={project,rows};
  }
  const project=groups.cloudflare.project;
  const references=await query('SELECT id,user_id,status,attempt_count,created_at,updated_at,output_r2_key FROM private_video_references WHERE id=? AND user_id=? AND processing_backend=?',
    [canvasRecoveryId(`${project}:reference`),owner,'cloudflare']);
  const previews=await query('SELECT id,source_user_id,status,created_at,updated_at,file_r2_key,poster_r2_key FROM homepage_hero_video_derivatives WHERE id=? AND source_user_id=? AND processing_backend=?',
    [`hhvd_${canvasRecoveryId(`${project}:preview`)}`,owner,'cloudflare']);
  assert.equal(references.length,1);assert.equal(previews.length,1);
  assert(references[0].status==='ready'&&references[0].output_r2_key,'Original Cloudflare reference is incomplete');
  assert(previews[0].status==='succeeded'&&previews[0].file_r2_key&&previews[0].poster_r2_key,'Original Cloudflare previews are incomplete');
  const sources=await query('SELECT id,user_id,r2_key,poster_r2_key,created_at FROM ai_text_assets WHERE id=? AND user_id=?',
    [canvasRecoveryId(`${project}:preview-source`),owner]);
  assert.equal(sources.length,1);assert(sources[0].r2_key&&sources[0].poster_r2_key,'Original public preview source poster is missing');
  assert(time(sources[0].created_at)>=time(window.startedAt)&&time(sources[0].created_at)<=time(window.completedAt));
  for(const row of [...references,...previews])assert(time(row.created_at)>=time(window.startedAt)&&time(row.updated_at)<=time(window.completedAt),'Output changed after original failure');
  // Even synthetic processing tokens are capabilities. Persist their presence,
  // never the token or storage location; exact rows remain bound by a digest.
  const sanitize=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>
    key==='processing_token'?[key,Boolean(value)]:key.endsWith('r2_key')?[`${key}_sha256`,value?digest(value):null]:[key,value]));
  const records={groups:Object.fromEntries(Object.entries(groups).map(([backend,group])=>[backend,{project:group.project,rows:group.rows.map(sanitize)}])),
    references:references.map(sanitize),previews:previews.map(sanitize),sources:sources.map(sanitize)};
  return {owner,sourceSha:source.sha,sourceRun:source.run,sourceAttempt:source.attempt,sourceJob:source.job,window,
    logDigest:evidence.logDigest,logBytes:evidence.logBytes,recordsDigest:digest(JSON.stringify(records)),records};
}
// The Containers V1 ID is the Durable Object actor ID, not a process ID.
// The unchanged verified Worker addresses only getByName('private-media-singleton')
// in its original namespace. This binds the old wait calls to this same logical
// actor without inventing missing per-event timestamps or a physical lifetime.
export function canvasRecoveryActor(media,source) {
  assert.equal(media.sha,source.sha);assert(/^[a-f0-9]{64}$/.test(media.assignedInstance||''),'Missing documented Durable Object actor identity');
  for(const key of ['namespace','application','workerVersion','deployment'])assert(typeof media[key]==='string'&&media[key],'Missing retained actor binding');
  return {policy:'named-durable-object-actor-v1',sourceSha:source.sha,name:'private-media-singleton',namespace:media.namespace,application:media.application,
    instance:media.assignedInstance,workerVersion:media.workerVersion,deployment:media.deployment};
}
export async function readCanvasRecoveryActor(media,source,read) {
  const actor=canvasRecoveryActor(media,source);
  // Keep the actual V1 envelope: pagination is result_info.next_page_token,
  // which the general cloudflareRead adapter intentionally does not return.
  const body=await read(`containers/applications/${encodeURIComponent(media.application)}/instances`);
  assert.equal(body.success,true);assert(!body.result_info?.next_page_token,'Incomplete instance history');
  const instances=body.result?.instances;assert(Array.isArray(instances)&&instances.length===1,'Ambiguous historical actor');
  const instance=instances[0];assert.equal(instance.id,actor.instance);assert.equal(instance.name,actor.name);
  assert.equal(instance.application_id,actor.application);assert.equal(instance.image,media.imageDigest);
  assert(['stopped','inactive'].includes(instance.status?.state),'Original actor is not stopped');
  assert(instance.status.exit_code===undefined||instance.status.exit_code===0,'Original actor exited abnormally');
  return actor;
}
export function verifyCanvasRecoveryLifecycle(cycle,proof) {
  assert(cycle&&proof,'Missing retained lifecycle provenance');
  assert.equal(cycle.policy,'prior-protected-execution-v1');
  const actor=cycle.actor;assert.equal(actor?.policy,'named-durable-object-actor-v1');assert.equal(actor.sourceSha,proof.sourceSha);
  assert.equal(actor.name,'private-media-singleton');assert(/^[a-f0-9]{64}$/.test(actor.instance||''));
  for(const key of ['namespace','application','workerVersion','deployment'])assert(typeof actor[key]==='string'&&actor[key]);
  assert.equal(cycle.stoppedNow?.instance,actor.instance,'Current stop differs from the original named actor');
  assert.deepEqual(cycle.priorExecution,proof,'Changed original lifecycle evidence');
  assert(['stopped','inactive'].includes(cycle.stoppedNow?.state),'Retained container did not stop');
  assert(time(cycle.stoppedNow.observedAt)>=time(proof.window.completedAt),'Current stop observation predates failure');
  assert(!cycle.running&&!cycle.stoppedBefore&&!cycle.stoppedAfter,'Do not invent historical lifecycle observations');
  assert.equal(proof.owner,CANVAS_RECOVERY_OWNER);assert(/^[a-f0-9]{64}$/.test(proof.recordsDigest));
  assert.equal(proof.recordsDigest,digest(JSON.stringify(proof.records)),'Retained job snapshot changed');
  assert.equal(proof.records.groups.github.rows.length,3);assert.equal(proof.records.groups.cloudflare.rows.length,3);
  for(const row of proof.records.groups.github.rows)assert(row.status==='queued'&&row.attempt_count===0&&!row.processing_token&&!row.locked_until,'Prior GitHub work was not unattempted');
  for(const row of proof.records.groups.cloudflare.rows)assert(row.status==='ready'&&row.processing_token&&!row.locked_until&&time(row.updated_at)<=time(proof.window.completedAt),'Original Cloudflare lifecycle did not complete');
}
export function canvasRecoveryAcceptance(proof) {
  return {sourceSha:proof.sourceSha,sourceRun:proof.sourceRun,sourceAttempt:proof.sourceAttempt,sourceJob:proof.sourceJob,window:proof.window,logDigest:proof.logDigest,logBytes:proof.logBytes,recordsDigest:proof.recordsDigest};
}
export function canvasRecoveryOutputIdentity(result) {
  const outputs=items=>items.map(row=>{for(const key of ['videoDigest','posterDigest'])assert(/^[a-f0-9]{64}$/.test(row[key]||''));return {videoDigest:row.videoDigest,posterDigest:row.posterDigest};});
  assert.equal(result.outputs?.length,3);assert.equal(result.publicPreviews?.length,2);
  assert(/^[a-f0-9]{64}$/.test(result.videoReference?.videoDigest||''));
  const previewBaseDigest=result.outputs[0].previewBase?.digest||result.exportMusic?.previewBaseDigest;
  assert(/^[a-f0-9]{64}$/.test(previewBaseDigest||''),'Missing retained clean base identity');
  return {outputs:outputs(result.outputs),publicPreviews:outputs(result.publicPreviews),referenceDigest:result.videoReference.videoDigest,previewBaseDigest};
}
