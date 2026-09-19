import { nowIso } from './tokens.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { parseCanvasJson } from './canvas-video-processing.js';

export async function refreshCanvasVideoOutputs(env,userId,rows) {
  return Promise.all(rows.map(async row=>{
    const output=parseCanvasJson(row.output_json);
    if(output.kind!=='video' || !row.asset_id) return row;
    const asset=await env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=?').bind(row.asset_id,userId).first();
    if(!asset) return row;
    const preview=asset.poster_r2_key?`/api/ai/text-assets/${row.asset_id}/poster`:null;
    output.previewUrl=preview;
    output.asset={...output.asset,preview_url:preview};
    output.posterStatus=preview?'ready':'pending';
    if(!preview) {
      const task=await env.DB.prepare("SELECT error_code,status FROM canvas_video_processing WHERE asset_id=? AND user_id=? LIMIT 1").bind(row.asset_id,userId).first();
      const generation=await env.DB.prepare("SELECT error_code FROM member_generation_jobs WHERE asset_id=? AND user_id=? LIMIT 1").bind(row.asset_id,userId).first();
      if(task?.status==='failed' || generation?.error_code==='preview_retry_exhausted') output.posterStatus='failed';
    }
    return {...row,output_json:JSON.stringify(output)};
  }));
}

// Queue completion owns the stored Canvas result, even with no browser left.
// A later run on the same node cannot be overwritten by an earlier completion.
export async function finishCanvasGeneration(env,job,result) {
  if(job.media_type!=='video' || !job.request_key?.startsWith('canvas-video-') || !result.data?.asset?.id) return;
  const runId=job.request_key.slice('canvas-video-'.length);
  const row=await env.DB.prepare("SELECT * FROM canvas_runs WHERE id=? AND user_id=? AND operation_type='canvas.video.generate'").bind(runId,job.user_id).first();
  if(!row) return;
  const asset=result.data.asset;
  const original=await ownedCanvasVideo(env,job.user_id,asset.id,null,80_000_000);
  const output={kind:'video',assetId:asset.id,assetType:'video',runId,modelId:row.model_id,createdAt:nowIso(),
    sourceVersion:original.version,fileUrl:asset.file_url,previewUrl:asset.poster_url||null,posterStatus:asset.poster_url?'ready':'pending',
    asset:{id:asset.id,asset_type:'video',mime_type:asset.mime_type,file_url:asset.file_url,preview_url:asset.poster_url||null}};
  const encoded=JSON.stringify(output),now=nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_text_assets SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.canvas_run_id',?,'$.canvas_poster_status',?) WHERE id=? AND user_id=?").bind(runId,asset.poster_url?'ready':'pending',asset.id,job.user_id),
    env.DB.prepare(`UPDATE canvas_runs SET status='completed',asset_id=?,output_json=?,usage_attempt_id=?,error_code=NULL,error_message=NULL,completed_at=?,updated_at=? WHERE id=? AND user_id=?`)
      .bind(asset.id,encoded,job.usage_attempt_id,now,now,runId,job.user_id),
    env.DB.prepare(`UPDATE canvas_nodes SET asset_id=?,output_json=?,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM canvas_runs r WHERE r.node_id=canvas_nodes.id AND r.user_id=canvas_nodes.user_id AND r.deleted_at IS NULL AND (r.created_at>? OR (r.created_at=? AND r.rowid>?)))`)
      .bind(asset.id,encoded,now,row.node_id,job.user_id,row.created_at,row.created_at,(await env.DB.prepare('SELECT rowid AS seq FROM canvas_runs WHERE id=?').bind(runId).first()).seq),
  ]);
}
