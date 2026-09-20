import { nowIso } from './tokens.js';
import { THUMBNAIL_BACKEND_SQL, notifyPrivateMedia } from './private-media-service.js';
import { h3EncoderOverrun, h3DurationError } from './h3-reference-metadata.js';

export const referenceError=(code,status=409)=>Object.assign(new Error(code),{code,status});
export async function referenceId(userId,key,etag) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['h3-reference-15s-v1',userId,key,etag])));
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);
}
// Asset metadata alone is editable/importable. Require the original accepted
// generation input and its output identity; no provider call during preparation.
export async function generatedReferencePlan(env,userId,row,head,metadata) {
  let input;
  const member=await env.DB.prepare("SELECT input_r2_key FROM member_generation_jobs WHERE id=? AND user_id=? AND asset_id=? AND status='succeeded'")
    .bind(row.id,userId,row.id).first();
  if(member) {
    const object=await env.USER_IMAGES.get(member.input_r2_key);
    if(object)input=await new Response(object.body).json();
  } else {
    const admin=await env.DB.prepare("SELECT input_json FROM ai_video_jobs_v2 WHERE user_id=? AND output_r2_key=? AND status='succeeded' LIMIT 1")
      .bind(userId,row.r2_key).first();
    if(admin)input=JSON.parse(admin.input_json);
  }
  if(input?.model!=='minimax/h3' || !h3EncoderOverrun(metadata,Number(input.duration)))throw h3DurationError();
  return {reference_id:await referenceId(userId,row.r2_key,head.etag),reference_metadata:metadata};
}

export async function generationReferenceSnapshots(env,userId,jobId) {
  const member=await env.DB.prepare("SELECT source_refs_json AS sources FROM member_generation_jobs WHERE id=? AND user_id=? AND status IN ('queued','processing','ingesting','outcome_unknown')")
    .bind(jobId,userId).first();
  const job=member || await env.DB.prepare("SELECT json_extract(input_json,'$._source_snapshots') AS sources FROM ai_video_jobs_v2 WHERE id=? AND user_id=? AND status IN ('queued','starting','provider_pending','polling','processing','ingesting')")
    .bind(jobId,userId).first();
  if(!job)throw referenceError('media_source_job_unavailable');
  return JSON.parse(job.sources||'[]');
}

export async function prepareVideoReferences(env,userId,jobId) {
  const sources=await generationReferenceSnapshots(env,userId,jobId);let pending=false;
  for(const source of sources.filter(s=>s.reference_id)) {
    const id=await referenceId(userId,source.r2_key,source.etag);
    if(id!==source.reference_id || !h3EncoderOverrun(source.reference_metadata,15))throw referenceError('h3_reference_identity_invalid');
    const now=nowIso(),key=`users/${userId}/video-references/${id}.mp4`;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO private_video_references
        (id,user_id,source_asset_id,source_r2_key,source_etag,source_bytes,output_r2_key,source_metadata_json,processing_backend,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,${THUMBNAIL_BACKEND_SQL},?,?,?)`).bind(id,userId,source.asset_id,source.r2_key,source.etag,source.size_bytes,key,JSON.stringify(source.reference_metadata),now,now,now),
      // Register cleanup before any PUT. The live-reference view holds this key
      // until retirement; interrupted/late uploads use the same tracked key.
      env.DB.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) SELECT ?,'q2_pending',? WHERE NOT EXISTS(SELECT 1 FROM r2_cleanup_queue WHERE r2_key=?)").bind(key,now,key),
    ]);
    const row=await env.DB.prepare('SELECT * FROM private_video_references WHERE id=? AND user_id=?').bind(id,userId).first();
    if(!row || ['failed','retired'].includes(row.status))throw referenceError('h3_reference_preparation_failed');
    if(row.status==='ready')await readyVideoReference(env,userId,source);
    else {pending=true;await notifyPrivateMedia(env,row.processing_backend);}
  }
  if(pending)throw referenceError('h3_reference_preparing');
}

export async function readyVideoReference(env,userId,source) {
  if(!source.reference_id)return source;
  const row=await env.DB.prepare("SELECT * FROM private_video_references WHERE id=? AND user_id=? AND status='ready'")
    .bind(source.reference_id,userId).first();
  if(!row || row.source_r2_key!==source.r2_key || row.source_etag!==source.etag || row.source_asset_id!==source.asset_id)throw referenceError('h3_reference_preparation_failed');
  const head=await env.USER_IMAGES.head(row.output_r2_key);
  if(!head || head.etag!==row.output_etag || head.size!==row.storage_reserved_bytes)throw referenceError('h3_reference_preparation_failed');
  return {...source,r2_key:row.output_r2_key,etag:row.output_etag,size_bytes:head.size,mime_type:'video/mp4'};
}

export async function retireVideoReferences(env) {
  const now=nowIso(),grace=new Date(Date.now()-5*60_000).toISOString();
  const rows=await env.DB.prepare(`SELECT id FROM private_video_references r WHERE status<>'retired'
    AND (locked_until IS NULL OR locked_until<?)
    AND NOT EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=r.source_asset_id AND a.user_id=r.user_id AND a.r2_key=r.source_r2_key)
    AND NOT EXISTS(SELECT 1 FROM private_video_reference_consumers c WHERE c.id=r.id) LIMIT 20`).bind(grace).all();
  for(const {id} of rows.results||[])await env.DB.batch([
    env.DB.prepare(`UPDATE private_video_references SET status='retired',updated_at=? WHERE id=? AND status<>'retired'
      AND (locked_until IS NULL OR locked_until<?)
      AND NOT EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=source_asset_id AND a.user_id=private_video_references.user_id AND a.r2_key=source_r2_key)
      AND NOT EXISTS(SELECT 1 FROM private_video_reference_consumers c WHERE c.id=private_video_references.id)`).bind(now,id,grace),
    env.DB.prepare(`UPDATE user_asset_storage_usage SET used_bytes=MAX(0,used_bytes-(SELECT storage_reserved_bytes FROM private_video_references WHERE id=?)),updated_at=?
      WHERE user_id=(SELECT user_id FROM private_video_references WHERE id=?) AND changes()=1`).bind(id,now,id),
    env.DB.prepare("UPDATE private_video_references SET storage_reserved_bytes=0 WHERE id=? AND status='retired'").bind(id),
  ]);
  await env.DB.prepare("UPDATE private_video_references SET status='failed',error_code='h3_reference_preparation_failed',locked_until=NULL,updated_at=? WHERE status IN ('queued','processing') AND attempt_count>=3 AND locked_until<=?").bind(now,now).run();
}
