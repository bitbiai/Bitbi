import { processR2CleanupQueue } from './r2-cleanup.js';
import { nowIso } from './tokens.js';
import { deleteUserAiImage, deleteUserAiTextAsset } from '../routes/ai/lifecycle.js';

const contexts = new WeakMap();
export const canvasMediaRun = env => contexts.get(env) || null;
export function canvasMediaEnvironment(env, runId) {
  const scoped = Object.create(env); contexts.set(scoped, runId); return scoped;
}
export function canvasMediaStatements(env, {runId,userId,projectId,nodeId,kind}) {
  if (!['image','video','music'].includes(kind)) return [];
  return [env.DB.prepare(`INSERT OR IGNORE INTO canvas_media_outputs
    (run_id,user_id,project_id,node_id,asset_id,kind,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(runId,userId,projectId,nodeId,runId,kind,nowIso())];
}
export async function registerCanvasMedia(env, input) {
  const statements=canvasMediaStatements(env,input);if(statements.length)await env.DB.batch(statements);
}
export async function saveCanvasMedia(env, userId, projectId, runId) {
  // The conditional transition is atomic with respect to producer deletion and
  // reclamation. Saving never copies bytes, invokes a provider or charges credits.
  await env.DB.prepare(`UPDATE canvas_media_outputs SET state='saved',saved_at=?
    WHERE run_id=? AND user_id=? AND project_id=? AND role='original' AND state='canvas'
    AND EXISTS(SELECT 1 FROM canvas_nodes n JOIN canvas_projects p ON p.id=n.project_id
      WHERE n.id=canvas_media_outputs.node_id AND n.deleted_at IS NULL AND p.deleted_at IS NULL)
    AND (EXISTS(SELECT 1 FROM ai_images a WHERE a.id=canvas_media_outputs.asset_id AND a.user_id=?)
      OR EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=canvas_media_outputs.asset_id AND a.user_id=?))
    AND EXISTS(SELECT 1 FROM canvas_runs r WHERE r.id=canvas_media_outputs.run_id AND r.status='completed')
    AND NOT EXISTS(SELECT 1 FROM member_generation_unready_assets WHERE id=canvas_media_outputs.asset_id)`)
    .bind(nowIso(),runId,userId,projectId,userId,userId).run();
  const row=await env.DB.prepare("SELECT asset_id,state FROM canvas_media_outputs WHERE run_id=? AND user_id=? AND project_id=? AND role='original'")
    .bind(runId,userId,projectId).first();
  if(row?.state!=='saved') throw Object.assign(new Error('This Canvas output is unavailable or has been deleted.'), {status:409,code:'canvas_output_unavailable'});
  return {asset_id:row.asset_id,storage:'assets'};
}
export async function annotateCanvasMedia(env,userId,rows) {
  const ids=[...new Set(rows.map(row=>row.asset_id).filter(Boolean))],byAsset=new Map();
  for(let offset=0;offset<ids.length;offset+=50) {
    const chunk=ids.slice(offset,offset+50);
    const outputs=await env.DB.prepare(`SELECT run_id,asset_id,state FROM canvas_media_outputs WHERE user_id=? AND asset_id IN (${chunk.map(()=>'?').join(',')}) AND state<>'deleted'`).bind(userId,...chunk).all();
    for(const row of outputs.results||[])byAsset.set(row.asset_id,row);
  }
  return rows.map(row=>{
    const state=byAsset.get(row.asset_id); if(!state || !row.output_json)return row;
    const output=JSON.parse(row.output_json);
    return {...row,output_json:JSON.stringify({...output,runId:state.run_id,storage:state.state==='saved'?'assets':'canvas'})};
  });
}
export async function reclaimCanvasMedia(env, userId=null) {
  const rows=await env.DB.prepare(`SELECT * FROM canvas_media_reclaimable c WHERE ${userId?'user_id=? AND ':''}
    (EXISTS(SELECT 1 FROM ai_images a WHERE a.id=c.asset_id) OR EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=c.asset_id)) ORDER BY created_at LIMIT 20`);
  const result=await (userId?rows.bind(userId):rows).all();
  for(const row of result.results||[]) {
    try {
      // Existing managed deletion enqueues exact original/derivative keys and
      // releases quota. SQL triggers recheck consumers inside that transaction.
      if(row.kind==='image') await deleteUserAiImage({env,userId:row.user_id,imageId:row.asset_id,canvasRunId:row.run_id});
      else await deleteUserAiTextAsset({env,userId:row.user_id,assetId:row.asset_id,canvasRunId:row.run_id});
    } catch(error) {
      if(!['canvas_media_in_use','canvas_media_identity'].some(code=>String(error?.cause||error).includes(code)) && error.status!==404 && !String(error?.cause||error).includes('JSON path')) throw error;
    }
  }
  await reclaimCanvasDownloads(env);
}

// Finished ingestion caches are no longer needed after their unsaved original
// was reclaimed. Keep provider/ledger outcome receipts; do not enable a replay.
export async function reclaimCanvasDownloads(env) {
  const rows=await env.DB.prepare(`SELECT j.id,j.user_id,j.provider_receipts_json FROM member_generation_jobs j
    JOIN canvas_media_outputs c ON c.asset_id=j.id WHERE c.state='deleted' AND c.role='original'
    AND j.status='failed' AND j.error_code='generation_asset_removed'
    AND EXISTS(SELECT 1 FROM json_each(j.provider_receipts_json) r WHERE json_extract(r.value,'$.kind')='download') LIMIT 20`).all();
  for(const row of rows.results||[]) {
    const receipts=JSON.parse(row.provider_receipts_json),keys=[];
    for(const [name,value] of Object.entries(receipts)) if(value.kind==='download'
        && value.key===`users/${row.user_id}/generation-jobs/${row.id}/${name}`) {keys.push(value.key);delete receipts[name];}
    if(!keys.length)continue;
    await env.DB.batch([
      env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM member_generation_jobs WHERE id=? AND status='failed'
        AND error_code='generation_asset_removed' AND provider_receipts_json=?) THEN 1 ELSE json_extract('[]','$[') END`).bind(row.id,row.provider_receipts_json),
      env.DB.prepare('UPDATE member_generation_jobs SET provider_receipts_json=? WHERE id=?').bind(JSON.stringify(receipts),row.id),
      ...keys.map(key=>env.DB.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").bind(key,nowIso())),
    ]);
    await processR2CleanupQueue(env,{keys});
  }
}
