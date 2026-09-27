import { exportMusicSettings, isExportMusic } from '../../../../js/shared/canvas-export.mjs';
import { sha256Hex, nowIso } from './tokens.js';
import { ownedCanvasVideo } from './canvas-video-input.js';

const fail = code => { throw Object.assign(new Error(code), {code,status:409}); };
export async function validateExportEdge(env,userId,projectId,sourceId,targetId,config) {
  if(config.purpose!==undefined && !['','export_background_music'].includes(config.purpose))fail('canvas_connection_purpose');
  if(!isExportMusic(config))return;
  if(config.videoInput)fail('canvas_connection_purpose');
  const nodes=(await env.DB.prepare('SELECT id,type,asset_id,output_json FROM canvas_nodes WHERE user_id=? AND project_id=? AND id IN (?,?) AND deleted_at IS NULL').bind(userId,projectId,sourceId,targetId).all()).results;
  const source=nodes.find(n=>n.id===sourceId),target=nodes.find(n=>n.id===targetId);
  if(!source || !target || !['music_generation','asset_reference'].includes(source.type) || target.type!=='video_generation')fail('canvas_connection_purpose');
  const output=JSON.parse(source.output_json||'{}'),assetId=source.asset_id||output.assetId||output.asset?.id;
  if(assetId)await ownedCanvasMusic(env,userId,assetId);
}
export async function ownedCanvasMusic(env,userId,assetId,expectedVersion=null) {
  const row=await env.DB.prepare("SELECT id,r2_key,mime_type FROM ai_text_assets WHERE id=? AND user_id=? AND source_module='music'")
    .bind(assetId,userId).first();
  if(!row?.r2_key || !['audio/mpeg','audio/mp3','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/aac'].includes(row.mime_type)) fail('canvas_music_unavailable');
  const head=await env.USER_IMAGES.head(row.r2_key);
  if(!head?.size || head.size>80_000_000) fail('canvas_music_unavailable');
  const version=await sha256Hex(`${row.id}:${row.r2_key}:${head.etag}:${head.size}`);
  if(expectedVersion && version!==expectedVersion) fail('canvas_music_changed');
  return {...row,version,size:head.size,etag:head.etag};
}
export const ownedExportSource=(env,userId,source)=>source.kind==='music'
  ? ownedCanvasMusic(env,userId,source.assetId,source.version)
  : ownedCanvasVideo(env,userId,source.assetId,source.version,80_000_000);

export async function connectedExportMusic(env,userId,projectId,runId) {
  const rows=await env.DB.prepare(`SELECT e.config_json,n.asset_id,n.output_json FROM canvas_edges e
    JOIN canvas_runs r ON r.node_id=e.target_node_id AND r.id=? AND r.user_id=e.user_id AND r.project_id=e.project_id
    JOIN canvas_nodes n ON n.id=e.source_node_id AND n.user_id=e.user_id AND n.project_id=e.project_id
    WHERE e.user_id=? AND e.project_id=? AND e.deleted_at IS NULL AND n.deleted_at IS NULL`).bind(runId,userId,projectId).all();
  const music=rows.results.filter(row=>isExportMusic(JSON.parse(row.config_json||'{}')));
  if(!music.length)return null;
  if(music.length!==1)fail('canvas_music_ambiguous');
  const output=JSON.parse(music[0].output_json||'{}');
  const assetId=music[0].asset_id||output.assetId||output.asset?.id;
  if(!assetId)fail('canvas_music_unavailable');
  const asset=await ownedCanvasMusic(env,userId,assetId);
  return {kind:'music',assetId:asset.id,version:asset.version,size:asset.size};
}
export async function canvasExportRecipe(env,userId,projectId,runId,videos,settings) {
  const backgroundMusic=exportMusicSettings(settings);
  const music=backgroundMusic.enabled?await connectedExportMusic(env,userId,projectId,runId):null;
  if(backgroundMusic.enabled && !music)fail('canvas_music_unavailable');
  const sources=[...videos,...(music?[music]:[])];
  if(sources.reduce((total,s)=>total+s.size,0)>400_000_000)fail('canvas_chain_size');
  return {version:1,videos,music,backgroundMusic};
}
export async function exportHead(env,userId,runId) {
  const rows=await env.DB.prepare(`SELECT p.*,v.state AS export_state,h.latest_id,h.current_id
    FROM canvas_export_heads h JOIN canvas_video_processing p ON p.id IN (h.latest_id,h.current_id)
    JOIN canvas_export_versions v ON v.id=p.id WHERE h.run_id=? AND p.user_id=?`).bind(runId,userId).all();
  return {latest:rows.results.find(r=>r.id===r.latest_id),current:rows.results.find(r=>r.id===r.current_id && r.export_state!=='deleted')};
}
export async function saveCanvasExport(env,userId,projectId,runId,id) {
  if(!/^[a-f0-9]{32}$/.test(id||''))fail('canvas_export_unavailable');
  await env.DB.prepare(`UPDATE canvas_export_versions SET state='saved',saved_at=?
    WHERE id=? AND user_id=? AND project_id=? AND run_id=? AND state='canvas'
    AND EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=canvas_export_versions.id AND a.user_id=?)
    AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id=p.id)
    AND EXISTS(SELECT 1 FROM canvas_projects p WHERE p.id=canvas_export_versions.project_id AND p.deleted_at IS NULL)`)
    .bind(nowIso(),id,userId,projectId,runId,userId).run();
  const row=await env.DB.prepare("SELECT id FROM canvas_export_versions WHERE id=? AND user_id=? AND project_id=? AND run_id=? AND state='saved'")
    .bind(id,userId,projectId,runId).first();
  if(!row)fail('canvas_export_unavailable');
  return {asset_id:id,storage:'assets'};
}
