import { transitionSettings,TRANSITION_POLICY } from '../../../../js/shared/canvas-transitions.mjs';
import { exportMusicSettings, isExportMusic, canvasExportSubject, canvasNodeMediaKind } from '../../../../js/shared/canvas-export.mjs';
import { sha256Hex, nowIso } from './tokens.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import {smoothJoinSettings,seamPreviewSettings} from '../../../../js/shared/canvas-smooth-joins.mjs';
import {CANVAS_AUDIO_FIT_POLICY} from '../../../../js/shared/canvas-audio-fit.mjs';
import { canvasAssembly, resolveCanvasTrimFrames, fitCanvasCreativeTransitions } from '../../../../js/shared/canvas-assembly.mjs';

const fail = code => { throw Object.assign(new Error(code), {code,status:409}); };
// A processor result may explain a creative source-end correction; it never
// changes the accepted recipe. Recompute the only permitted frame/overlap edits.
export function validateCanvasSourceEndFit(recipe, report, timeline) {
  if(report===undefined)return null;
  const invalid=()=>{throw Object.assign(new Error('canvas_source_end_fit_invalid'),{code:'canvas_source_end_fit_invalid',status:400});};
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
  if(recipe?.version!==8||recipe.assembly?.target?.mode!=='creative'
    ||!keys(report,'policy,clips,transitions,frameRate,durations')||report.policy!=='fit-source-end-v1'
    ||!Number.isFinite(report.frameRate)||report.frameRate<=0||report.frameRate>60
    ||!Array.isArray(report.clips)||!report.clips.length||report.clips.length>120
    ||!Array.isArray(report.transitions)||!Array.isArray(report.durations)||report.durations.length!==recipe.videos?.length
    ||report.durations.length>120||!Array.isArray(timeline)||timeline.length!==(recipe.preview?2:report.durations.length))invalid();
  try {
    const assembly=canvasAssembly(recipe.assembly),durations=report.durations,indices=[];
    if(assembly.clips.length!==durations.length||recipe.transitions?.length!==durations.length-1
      ||durations.some(duration=>!Number.isFinite(duration)||duration<=0||duration>600
        ||Math.abs(duration*report.frameRate-Math.round(duration*report.frameRate))>.0001))invalid();
    for(const clip of report.clips) {
      if(!keys(clip,'index,sourceFrames,startFrame,requestedEndFrame,endFrame,frameRateNumerator,frameRateDenominator')
        ||!Number.isSafeInteger(clip.index)||clip.index<0||clip.index>=durations.length||indices.includes(clip.index)
        ||['sourceFrames','startFrame','requestedEndFrame','endFrame','frameRateNumerator','frameRateDenominator'].some(key=>!Number.isSafeInteger(clip[key]))
        ||clip.frameRateNumerator<=0||clip.frameRateDenominator<=0)invalid();
      const interval=resolveCanvasTrimFrames({...assembly.clips[clip.index].trim,sourceFrames:clip.sourceFrames,
        frameRateNumerator:clip.frameRateNumerator,frameRateDenominator:clip.frameRateDenominator,creative:true});
      if(!interval.fit||Object.keys(interval.fit).some(key=>interval.fit[key]!==clip[key]))invalid();
      const normalized=Math.ceil(interval.durationSeconds*report.frameRate-.0001)/report.frameRate;
      if(!Number.isFinite(durations[clip.index])||Math.abs(durations[clip.index]-normalized)>.0001)invalid();
      indices.push(clip.index);
    }
    const fitted=fitCanvasCreativeTransitions(durations,recipe.transitions,report.frameRate,indices);
    if(report.transitions.length!==fitted.adjustments.length)invalid();
    for(const [index,transition]of report.transitions.entries()) {
      if(!keys(transition,'index,requestedFrames,effectiveFrames,requestedPreset,effectivePreset')
        ||Object.keys(fitted.adjustments[index]).some(key=>transition[key]!==fitted.adjustments[index][key]))invalid();
    }
    let selected=durations;
    if(recipe.preview) {
      const seam=recipe.preview.seamIndex;
      if(!Number.isSafeInteger(seam)||seam<0||seam>=durations.length-1)invalid();
      const window=Math.ceil(Math.max(1.5,2*(fitted.transitions[seam].duration||0)+1/report.frameRate)*report.frameRate)/report.frameRate;
      selected=durations.slice(seam,seam+2).map(duration=>Math.min(window,duration));
    }
    if(timeline.some((clip,index)=>!Number.isFinite(clip?.duration)||Math.abs(clip.duration-selected[index])>.0001))invalid();
    return fitted;
  }catch{invalid();}
}
export async function validateExportEdge(env,userId,projectId,sourceId,targetId,config) {
  if(config.purpose!==undefined && !['','export_background_music'].includes(config.purpose))fail('canvas_connection_purpose');
  if(config.transition!==undefined){
    const transition=transitionSettings(config.transition);
    if(transition.preset!=='none'){
      const rows=(await env.DB.prepare('SELECT id,type,asset_id,output_json,content_json FROM canvas_nodes WHERE user_id=? AND project_id=? AND id IN (?,?) AND deleted_at IS NULL').bind(userId,projectId,sourceId,targetId).all()).results;
      if(isExportMusic(config)||rows.length!==2||rows.some(n=>canvasNodeMediaKind({...n,output:JSON.parse(n.output_json||'null'),content:JSON.parse(n.content_json||'{}')})!=='video'))fail('canvas_transition_connection');
    }
  }
  if(!isExportMusic(config))return;
  if(config.videoInput)fail('canvas_connection_purpose');
  const nodes=(await env.DB.prepare('SELECT id,type,asset_id,output_json,content_json FROM canvas_nodes WHERE user_id=? AND project_id=? AND id IN (?,?) AND deleted_at IS NULL').bind(userId,projectId,sourceId,targetId).all()).results;
  const source=nodes.find(n=>n.id===sourceId),target=nodes.find(n=>n.id===targetId);
  if(!source || !target || !['music_generation','asset_reference'].includes(source.type)
    || canvasNodeMediaKind({...target,output:JSON.parse(target.output_json||'null'),content:JSON.parse(target.content_json||'{}')})!=='video')fail('canvas_connection_purpose');
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

export async function connectedExportMusic(env,userId,projectId,runId,selectedId=null) {
  const subject=canvasExportSubject(runId);
  const rows=await env.DB.prepare(`SELECT e.config_json,n.asset_id,n.output_json FROM canvas_edges e
    ${subject.nodeId?'JOIN canvas_nodes r ON r.id=e.target_node_id AND r.id=? AND r.user_id=e.user_id AND r.project_id=e.project_id AND r.deleted_at IS NULL':'JOIN canvas_runs r ON r.node_id=e.target_node_id AND r.id=? AND r.user_id=e.user_id AND r.project_id=e.project_id'}
    JOIN canvas_nodes n ON n.id=e.source_node_id AND n.user_id=e.user_id AND n.project_id=e.project_id
    WHERE e.user_id=? AND e.project_id=? AND e.deleted_at IS NULL AND n.deleted_at IS NULL`).bind(subject.id,userId,projectId).all();
  const music=rows.results.filter(row=>isExportMusic(JSON.parse(row.config_json||'{}'))).filter(row=>!selectedId || (row.asset_id||JSON.parse(row.output_json||'{}').assetId||JSON.parse(row.output_json||'{}').asset?.id)===selectedId);
  if(!music.length)return null;
  if(music.length!==1)fail('canvas_music_ambiguous');
  const output=JSON.parse(music[0].output_json||'{}');
  const assetId=music[0].asset_id||output.assetId||output.asset?.id;
  if(!assetId)fail('canvas_music_unavailable');
  const asset=await ownedCanvasMusic(env,userId,assetId);
  return {kind:'music',assetId:asset.id,version:asset.version,size:asset.size};
}
export async function canvasExportRecipe(env,userId,projectId,runId,videos,settings,explicit=false,smooth=false,preview,transitions=[],assembly=null) {
  const backgroundMusic=exportMusicSettings(settings);
  let music=null;
  if(backgroundMusic.enabled&&assembly?.musicNodeId){
    const node=await env.DB.prepare('SELECT asset_id,output_json FROM canvas_nodes WHERE id=? AND user_id=? AND project_id=? AND deleted_at IS NULL').bind(assembly.musicNodeId,userId,projectId).first();
    const assetId=node?.asset_id||JSON.parse(node?.output_json||'{}').asset?.id;
    if(!assetId||backgroundMusic.musicAssetId&&backgroundMusic.musicAssetId!==assetId)fail('canvas_music_unavailable');
    const asset=await ownedCanvasMusic(env,userId,assetId);music={kind:'music',assetId:asset.id,version:asset.version,size:asset.size};
  } else if(backgroundMusic.enabled)music=await connectedExportMusic(env,userId,projectId,runId,backgroundMusic.musicAssetId);

  if(backgroundMusic.enabled && !music)fail('canvas_music_unavailable');
  const sources=[...videos,...(music?[music]:[])];
  if(sources.reduce((total,s)=>total+s.size,0)>400_000_000)fail('canvas_chain_size');
  const smoothJoins=smoothJoinSettings(smooth),comparison=seamPreviewSettings(preview,videos.length);
  if(assembly)assembly=canvasAssembly(assembly);
  const effects=transitions.some(t=>t.preset!=='none');
  if(comparison&&!smoothJoins.enabled&&!effects)fail('canvas_smooth_settings');
  return {version:assembly?(assembly.target?.mode==='creative'?8:7):effects?6:5,...(effects||assembly?{transitionPolicy:TRANSITION_POLICY,transitions}:{}),...(assembly?{assembly}:{}),spatialPolicy:'center-crop-v1',timingPolicy:'video-clock-v2',originalAudioPolicy:CANVAS_AUDIO_FIT_POLICY,smoothJoins,...(comparison?{preview:comparison}:{}),...(explicit?{sequence:'explicit'}:{}),videos,music,backgroundMusic};
}
export async function exportHead(env,userId,runId) {
  const subject=canvasExportSubject(runId);
  const rows=await env.DB.prepare(`SELECT p.*,v.state AS export_state,h.latest_id,h.current_id
    FROM canvas_export_heads h JOIN canvas_video_processing p ON p.id IN (h.latest_id,h.current_id)
    JOIN canvas_export_versions v ON v.id=p.id WHERE h.${subject.column}=? AND p.user_id=?`).bind(subject.id,userId).all();
  return {latest:rows.results.find(r=>r.id===r.latest_id),current:rows.results.find(r=>r.id===r.current_id && r.export_state!=='deleted')};
}
export async function saveCanvasExport(env,userId,projectId,runId,id) {
  const subject=canvasExportSubject(runId);
  if(!/^[a-f0-9]{32}$/.test(id||''))fail('canvas_export_unavailable');
  await env.DB.prepare(`UPDATE canvas_export_versions SET state='saved',saved_at=?
    WHERE id=? AND user_id=? AND project_id=? AND ${subject.column}=? AND state='canvas'
    AND EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=canvas_export_versions.id AND a.user_id=?)
    AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id=p.id AND json_extract(p.recipe_json,'$.preview') IS NULL)
    AND EXISTS(SELECT 1 FROM canvas_projects p WHERE p.id=canvas_export_versions.project_id AND p.deleted_at IS NULL)`)
    .bind(nowIso(),id,userId,projectId,subject.id,userId).run();
  const row=await env.DB.prepare(`SELECT id FROM canvas_export_versions WHERE id=? AND user_id=? AND project_id=? AND ${subject.column}=? AND state='saved'`)
    .bind(id,userId,projectId,subject.id).first();
  if(!row)fail('canvas_export_unavailable');
  return {asset_id:id,storage:'assets'};
}
