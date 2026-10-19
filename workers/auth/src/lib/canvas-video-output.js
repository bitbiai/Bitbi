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
  const agentTransport=job.request_key?.startsWith('canvas-agent-')&&job.canvas_run_id;
  const imageTransport=job.media_type==='image'&&job.canvas_run_id;
  if(!agentTransport && !imageTransport && (job.media_type!=='video'||!job.request_key?.startsWith('canvas-video-')) || !result.data?.asset?.id)return;
  const runId=job.canvas_run_id||job.request_key.slice('canvas-video-'.length);
  const row=await env.DB.prepare('SELECT * FROM canvas_runs WHERE id=? AND user_id=? AND operation_type=?').bind(runId,job.user_id,`canvas.${job.media_type}.generate`).first();
  if(!row) return;
  if(imageTransport&&row.idempotency_key!==job.request_key)return;
  const agentJob=row.idempotency_key?.startsWith('canvas-agent-');
  const asset=result.data.asset;
  const original=job.media_type==='video'?await ownedCanvasVideo(env,job.user_id,asset.id,null,80_000_000):null;
  const kind=job.media_type==='music'?'audio':job.media_type;
  const preview=job.media_type==='image'?asset.file_url:asset.poster_url||null;
  const output={kind,assetId:asset.id,assetType:kind,runId,modelId:row.model_id,createdAt:nowIso(),
    ...(original?{sourceVersion:original.version}:{}),fileUrl:asset.file_url,previewUrl:preview,posterStatus:preview?'ready':'pending',
    asset:{id:asset.id,asset_type:kind,mime_type:asset.mime_type,file_url:asset.file_url,preview_url:preview}};
  const encoded=JSON.stringify(output),now=nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_text_assets SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.canvas_run_id',?,'$.canvas_poster_status',?) WHERE id=? AND user_id=?").bind(runId,asset.poster_url?'ready':'pending',asset.id,job.user_id),
    env.DB.prepare(`UPDATE canvas_runs SET status='completed',asset_id=?,output_json=?,usage_attempt_id=?,error_code=NULL,error_message=NULL,completed_at=?,updated_at=? WHERE id=? AND user_id=?`)
      .bind(asset.id,encoded,job.usage_attempt_id,now,now,runId,job.user_id),
    // A completed, billed agent result remains an ordinary private saved asset
    // even when pause/takeover or a manual edit prevents its node attachment.
    // Project/account deletion still follows the existing erasure boundary.
    ...(agentJob?[env.DB.prepare(`UPDATE canvas_media_outputs SET state='saved',saved_at=?
      WHERE run_id=? AND user_id=? AND project_id=? AND asset_id=? AND role='original' AND state='canvas'
      AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs a ON a.id=s.run_id
        JOIN member_generation_jobs j ON j.canvas_run_id=canvas_media_outputs.run_id
        JOIN canvas_runs receipt ON receipt.id=j.canvas_run_id AND receipt.idempotency_key='canvas-agent-'||s.id
        JOIN canvas_projects p ON p.id=a.project_id JOIN users u ON u.id=a.user_id
        WHERE s.node_id=canvas_media_outputs.node_id AND a.user_id=canvas_media_outputs.user_id AND a.project_id=canvas_media_outputs.project_id
        AND j.user_id=a.user_id AND j.id=canvas_media_outputs.asset_id AND j.result_r2_key IS NOT NULL AND p.deleted_at IS NULL AND u.status='active')
      AND EXISTS(SELECT 1 FROM canvas_runs r WHERE r.id=canvas_media_outputs.run_id AND r.status='completed' AND r.asset_id=canvas_media_outputs.asset_id)
      AND (EXISTS(SELECT 1 FROM ai_images a WHERE a.id=canvas_media_outputs.asset_id AND a.user_id=?)
        OR EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=canvas_media_outputs.asset_id AND a.user_id=?))
      AND NOT EXISTS(SELECT 1 FROM member_generation_unready_assets WHERE id=canvas_media_outputs.asset_id)`)
      .bind(now,runId,job.user_id,row.project_id,asset.id,job.user_id,job.user_id)]:[]),
    env.DB.prepare(`UPDATE canvas_nodes SET asset_id=?,output_json=?,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL
      AND (? IS NULL OR creative_revision=?)
      AND NOT EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs a ON a.id=s.run_id WHERE s.node_id=canvas_nodes.id
        AND 'canvas-agent-'||s.id=? AND a.status IN ('paused','cancelled','taken_over'))
      AND NOT EXISTS(SELECT 1 FROM canvas_runs r WHERE r.node_id=canvas_nodes.id AND r.user_id=canvas_nodes.user_id AND r.deleted_at IS NULL AND (r.created_at>? OR (r.created_at=? AND r.rowid>?)))`)
      .bind(asset.id,encoded,now,row.node_id,job.user_id,row.node_revision,row.node_revision,row.idempotency_key,row.created_at,row.created_at,(await env.DB.prepare('SELECT rowid AS seq FROM canvas_runs WHERE id=?').bind(runId).first()).seq),
  ]);
}
