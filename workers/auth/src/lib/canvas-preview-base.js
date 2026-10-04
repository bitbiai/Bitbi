import { reserveUserAssetStorage } from './asset-storage-quota.js';
import { putNewManagedR2Object } from './r2-cleanup.js';
import { publicVideoResponse } from './public-video-response.mjs';
import { canvasProcessingError, CANVAS_VIDEO_LIMITS } from './canvas-video-processing.js';
import { nowIso } from './tokens.js';
import { canvasExportSubject } from '../../../../js/shared/canvas-export.mjs';

// Called only by the authenticated processor, inside an explicit export lease.
// Register cleanup before PUT; a lost response/lease never invents a new job.
export async function storeCanvasPreviewBase(env,job,bytes) {
  if(!job.recipe_json || !(JSON.parse(job.recipe_json).version===3 || JSON.parse(job.recipe_json).backgroundMusic?.enabled))throw canvasProcessingError('canvas_music_settings');
  if(!bytes.length || bytes.length>CANVAS_VIDEO_LIMITS.outputBytes || String.fromCharCode(...bytes.slice(4,8))!=='ftyp')throw canvasProcessingError('canvas_export_file_invalid');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const key=`users/${job.user_id}/canvas-export-bases/${job.id}/${digest}.mp4`;
  if(job.preview_base_etag) {
    if(job.preview_base_key!==key)throw canvasProcessingError('canvas_preview_base_conflict');
    const head=await env.USER_IMAGES.head(key);
    if(head?.etag!==job.preview_base_etag || head.size!==bytes.length)throw canvasProcessingError('canvas_preview_base_unavailable');
    return;
  }
  await reserveUserAssetStorage(env,{userId:job.user_id,uploadBytes:bytes.length,generationReservation:{id:job.id,token:job.processing_token,table:'canvas_video_processing',kind:'canvas_base'}});
  await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_video_processing WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?) THEN 1 ELSE json_extract('[]','$[') END`).bind(job.id,job.processing_token,nowIso()),
    env.DB.prepare('UPDATE canvas_video_processing SET preview_base_key=?,preview_base_etag=NULL WHERE id=?').bind(key,job.id),
    env.DB.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) SELECT ?,'q2_pending',? WHERE NOT EXISTS(SELECT 1 FROM r2_cleanup_queue WHERE r2_key=?)").bind(key,nowIso(),key),
  ]);
  let object=await env.USER_IMAGES.head(key);
  if(!object)object=await putNewManagedR2Object(env,key,bytes,{httpMetadata:{contentType:'video/mp4'}});
  if(object.size!==bytes.length)throw canvasProcessingError('canvas_preview_base_conflict');
  const written=await env.DB.prepare("UPDATE canvas_video_processing SET preview_base_etag=? WHERE id=? AND processing_token=? AND preview_base_key=? AND status='processing' AND locked_until>?")
    .bind(object.etag,job.id,job.processing_token,key,nowIso()).run();
  if(!written.meta?.changes)throw canvasProcessingError('canvas_processing_claim_lost');
}

export async function readCanvasPreviewBase(ctx,userId,projectId,runId,id) {
  const subject=canvasExportSubject(runId);
  const row=await ctx.env.DB.prepare(`SELECT p.* FROM canvas_video_processing p JOIN ai_text_assets a ON a.id=p.asset_id AND a.user_id=p.user_id
    WHERE p.id=? AND p.user_id=? AND p.project_id=? AND p.${subject.column}=? AND p.preview_base_etag IS NOT NULL`)
    .bind(id,userId,projectId,subject.id).first();
  const head=row && await ctx.env.USER_IMAGES.head(row.preview_base_key);
  if(!head || head.etag!==row.preview_base_etag || head.size!==row.preview_base_bytes)throw canvasProcessingError('canvas_preview_base_unavailable','Preview unavailable.',404);
  return await publicVideoResponse(ctx.request,ctx.env.USER_IMAGES,row.preview_base_key,object=>new Headers({
    'Content-Type':'video/mp4','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  })) || new Response(null,{status:404});
}

export async function retireFailedCanvasPreviewBases(env,userId=null) {
  const rows=(await env.DB.prepare("SELECT id FROM canvas_video_processing WHERE asset_id IS NULL AND status='failed' AND preview_base_bytes>0 AND (locked_until IS NULL OR locked_until<?) AND (? IS NULL OR user_id=?) LIMIT 20").bind(nowIso(),userId,userId).all()).results;
  for(const row of rows||[])await env.DB.batch([
    env.DB.prepare(`UPDATE user_asset_storage_usage SET used_bytes=MAX(0,used_bytes-(SELECT preview_base_bytes FROM canvas_video_processing WHERE id=?))
      WHERE user_id=(SELECT user_id FROM canvas_video_processing WHERE id=? AND asset_id IS NULL AND status='failed' AND (locked_until IS NULL OR locked_until<?))`).bind(row.id,row.id,nowIso()),
    env.DB.prepare("UPDATE canvas_video_processing SET preview_base_key=NULL,preview_base_etag=NULL,preview_base_bytes=0 WHERE id=? AND asset_id IS NULL AND status='failed' AND (locked_until IS NULL OR locked_until<?)").bind(row.id,nowIso()),
  ]);
}
