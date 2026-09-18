import { nowIso, sha256Hex, randomTokenHex } from './tokens.js';
import { ownedCanvasVideo } from './canvas-video-input.js';

export const CANVAS_VIDEO_LIMITS = Object.freeze({ sourceBytes: 400_000_000, outputBytes: 80_000_000, durationSeconds: 600, leaseMs: 15*60_000 });
export const parseCanvasJson = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
export const canvasProcessingError = (code, message=code, status=409) => Object.assign(new Error(message), {code,status});

// Immutable run input, never mutable graph edges/positions. Each parent must be
// the same original/version that supplied the last frame used by this child.
export async function canvasVideoChain(env,userId,projectId,runId) {
  const sources=[],seen=new Set(); let expected=null,total=0;
  while(runId) {
    if(seen.has(runId)) throw canvasProcessingError('canvas_chain_cycle');
    if(seen.size>=120) throw canvasProcessingError('canvas_chain_limit','At most 120 historical clips per export (bounded provenance traversal).');
    seen.add(runId);
    const run=await env.DB.prepare(`SELECT * FROM canvas_runs WHERE id=? AND user_id=? AND project_id=? AND deleted_at IS NULL`)
      .bind(runId,userId,projectId).first();
    if(!run || run.status!=='completed' || run.operation_type!=='canvas.video.generate' || !run.asset_id)
      throw canvasProcessingError('canvas_chain_unavailable','A completed original clip in this project is missing.');
    if(expected && expected.assetId!==run.asset_id) throw canvasProcessingError('canvas_chain_provenance');
    const asset=await ownedCanvasVideo(env,userId,run.asset_id,expected?.version,80_000_000);
    const output=parseCanvasJson(run.output_json);
    if(output.sourceVersion && output.sourceVersion!==asset.version) throw canvasProcessingError('video_source_changed');
    sources.unshift({runId:run.id,assetId:asset.id,version:asset.version,size:asset.size}); total+=asset.size;
    if(total>CANVAS_VIDEO_LIMITS.sourceBytes) throw canvasProcessingError('canvas_chain_size','Combined source files exceed 400 MB.');
    const parents=parseCanvasJson(run.input_json).connected_video_inputs || [];
    if(!Array.isArray(parents) || parents.length>1) throw canvasProcessingError('canvas_chain_provenance');
    const parent=parents[0];
    if(!parent) break;
    if(parent.method!=='last_frame' || !parent.runId || !parent.assetId || !parent.frame?.version) throw canvasProcessingError('canvas_chain_provenance','Historical last-frame provenance is incomplete.');
    expected={assetId:parent.assetId,version:parent.frame.version};runId=parent.runId;
  }
  return sources;
}

export async function enqueueCanvasProcessing(env,{userId,projectId,runId,kind,sources,assetId=null}) {
  const id=(await sha256Hex(JSON.stringify(['canvas-processing-v1',userId,projectId,kind,assetId,sources]))).slice(0,32),now=nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO canvas_video_processing
    (id,user_id,project_id,run_id,kind,sources_json,asset_id,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,userId,projectId,runId,kind,JSON.stringify(sources),assetId,now,now,now).run();
  return env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=? AND user_id=?').bind(id,userId).first();
}

export function publicCanvasProcessing(row) {
  return {id:row.id,run_id:row.run_id,status:row.status,error_code:row.error_code||null,
    asset:row.asset_id?{id:row.asset_id,file_url:`/api/ai/text-assets/${row.asset_id}/file`,poster_url:row.status==='ready'?`/api/ai/text-assets/${row.asset_id}/poster`:null}:null};
}

export async function claimCanvasProcessing(env,kind,limit) {
  const now=nowIso();
  const rows=await env.DB.prepare(`SELECT * FROM canvas_video_processing WHERE
    ${kind==='poster'?"((kind='poster' AND status IN ('queued','processing')) OR status='preview_pending')":"kind='concat' AND status IN ('queued','processing')"}
    AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?) AND attempt_count<8 ORDER BY next_attempt_at LIMIT ?`).bind(now,now,limit).all();
  const claimed=[];
  for(const row of rows.results||[]) {
    if(kind==='concat') {
      // Recover an asset committed just before the completion response/write was
      // lost. The original's stable ID and DB claim guard prove its provenance.
      const saved=await env.DB.prepare('SELECT id,poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=? AND canvas_processing_token IS NOT NULL').bind(row.id,row.user_id).first();
      if(saved) {
        await env.DB.prepare("UPDATE canvas_video_processing SET asset_id=?,status=?,attempt_count=0,locked_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND status=? AND (locked_until IS NULL OR locked_until<=?)")
          .bind(saved.id,saved.poster_r2_key?'ready':'preview_pending',now,row.id,row.status,now).run();
        continue;
      }
    }
    const token=randomTokenHex(16);
    const result=await env.DB.prepare(`UPDATE canvas_video_processing SET status=?,processing_token=?,locked_until=?,attempt_count=attempt_count+1,updated_at=?
      WHERE id=? AND status=? AND (locked_until IS NULL OR locked_until<=?)`)
      .bind(kind==='poster'?'preview_pending':'processing',token,new Date(Date.now()+CANVAS_VIDEO_LIMITS.leaseMs).toISOString(),now,row.id,row.status,now).run();
    if(result.meta?.changes) claimed.push({...row,status:kind==='poster'?'preview_pending':'processing',processing_token:token});
  }
  return claimed;
}

export async function canvasProcessingClaim(env,id,token,status='processing') {
  if(!/^[a-f0-9]{32}$/.test(token||'')) return null;
  return env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=? AND processing_token=? AND status=? AND locked_until>?')
    .bind(id,token,status,nowIso()).first();
}

export async function failCanvasProcessing(env,row,code='canvas_processing_failed') {
  await env.DB.prepare(`UPDATE canvas_video_processing SET status=?,error_code=?,locked_until=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND processing_token=? AND status IN ('processing','preview_pending') AND locked_until>?`)
    .bind(row.attempt_count>=7?'failed':row.asset_id?'preview_pending':'queued',/^[a-z_]{1,80}$/.test(code)?code:'canvas_processing_failed',
      new Date(Date.now()+5*60_000).toISOString(),nowIso(),row.id,row.processing_token,nowIso()).run();
}

// A bounded resumable scan of completed Canvas originals only. Missing/unknown
// provider jobs are deliberately excluded; no AI request or credit write here.
export async function catchUpCanvasPosters(env) {
  const rows=await env.DB.prepare(`SELECT r.id,r.user_id,r.project_id,r.asset_id FROM canvas_runs r
    JOIN ai_text_assets a ON a.id=r.asset_id AND a.user_id=r.user_id
    WHERE r.status='completed' AND r.operation_type='canvas.video.generate' AND r.deleted_at IS NULL
    AND a.source_module='video' AND a.poster_r2_key IS NULL
    AND NOT EXISTS(SELECT 1 FROM member_generation_jobs g WHERE g.asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.asset_id=a.id)
    ORDER BY r.created_at LIMIT 25`).all();
  for(const r of rows.results||[]) {
    try {
      const asset=await ownedCanvasVideo(env,r.user_id,r.asset_id,null,80_000_000);
      await enqueueCanvasProcessing(env,{userId:r.user_id,projectId:r.project_id,runId:r.id,kind:'poster',assetId:r.asset_id,
        sources:[{runId:r.id,assetId:asset.id,version:asset.version,size:asset.size}]});
    } catch(error) {
      if(!error.status) throw error;
      const task=await enqueueCanvasProcessing(env,{userId:r.user_id,projectId:r.project_id,runId:r.id,kind:'poster',assetId:r.asset_id,sources:[]});
      await env.DB.prepare("UPDATE canvas_video_processing SET status='failed',error_code='canvas_source_unavailable' WHERE id=?").bind(task.id).run();
    }
  }
  await env.DB.prepare(`UPDATE canvas_video_processing SET status='failed',error_code='canvas_processing_exhausted',locked_until=NULL,updated_at=?
    WHERE attempt_count>=8 AND status IN ('processing','queued','preview_pending') AND (locked_until IS NULL OR locked_until<=?)`).bind(nowIso(),nowIso()).run();
  await env.DB.prepare(`UPDATE ai_text_assets SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.canvas_poster_status',
    CASE WHEN EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.asset_id=ai_text_assets.id AND p.status='failed') THEN 'failed' ELSE 'pending' END)
    WHERE poster_r2_key IS NULL AND id IN (SELECT asset_id FROM canvas_video_processing WHERE asset_id IS NOT NULL ORDER BY updated_at DESC LIMIT 25)`).run();
  return Number((await env.DB.prepare(`SELECT COUNT(*) AS count FROM canvas_video_processing WHERE status IN ('queued','processing','preview_pending')
    AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?) AND attempt_count<8`).bind(nowIso(),nowIso()).first())?.count||0);
}
