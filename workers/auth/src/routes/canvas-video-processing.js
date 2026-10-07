import { canvasMergeView, canvasVideoSelection } from '../lib/canvas-merge-selection.js';
import { canvasClipIdentity, canvasExportSubject } from '../../../../js/shared/canvas-export.mjs';
import { processorBackend, notifyPrivateMedia } from '../lib/private-media-service.js';
import { canvasVideoChain, canvasExportId, enqueueCanvasProcessing, publicCanvasProcessing, claimCanvasProcessing, canvasProcessingClaim, failCanvasProcessing, CANVAS_VIDEO_LIMITS, canvasProcessingError } from '../lib/canvas-video-processing.js';
import { exportMusicSettings } from '../../../../js/shared/canvas-export.mjs';
import { ownedCanvasVideo } from '../lib/canvas-video-input.js';
import { saveGeneratedVideoAsset } from '../lib/ai-text-assets.js';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse, readFormDataLimited, BODY_LIMITS } from '../lib/request.js';
import { nowIso } from '../lib/tokens.js';
import { canvasExportRecipe, exportHead, ownedExportSource, saveCanvasExport } from '../lib/canvas-export-recipes.js';
import { reclaimCanvasMedia } from '../lib/canvas-media-storage.js';
import { readCanvasPreviewBase, storeCanvasPreviewBase } from '../lib/canvas-preview-base.js';
import {smoothJoinSettings,seamPreviewSettings,validSeamResult} from '../../../../js/shared/canvas-smooth-joins.mjs';
import {validAudioFit} from '../../../../js/shared/canvas-audio-fit.mjs';
import {sha256Hex} from '../lib/tokens.js';

const base='/api/internal/homepage/hero-videos/canvas-exports/jobs';
const reply=(data,status=200)=>json({ok:true,data},{status,headers:{'Cache-Control':'no-store'}});

export async function canvasExport(ctx,userId,projectId,runId) {
  const subject=canvasExportSubject(runId);
  const project=await ctx.env.DB.prepare('SELECT id FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(projectId,userId).first();
  if(!project) throw canvasProcessingError('project_not_found','Project not found.',404);
  const previewId=new URL(ctx.request.url).searchParams.get('previewBase');
  if(ctx.method==='GET' && previewId!==null)return readCanvasPreviewBase(ctx,userId,projectId,runId,previewId);
  const comparisonId=new URL(ctx.request.url).searchParams.get('seamPreview');
  if(ctx.method==='GET'&&comparisonId!==null) {
    const row=await ctx.env.DB.prepare(`SELECT * FROM canvas_video_processing WHERE id=? AND user_id=? AND project_id=? AND ${subject.column}=? AND json_extract(recipe_json,'$.preview') IS NOT NULL`)
      .bind(comparisonId,userId,projectId,subject.id).first();
    if(!row)throw canvasProcessingError('canvas_preview_unavailable','Preview unavailable.',404);
    return reply({preview:publicCanvasProcessing(row)});
  }
  const rows=await ctx.env.DB.prepare(`SELECT * FROM canvas_video_processing WHERE user_id=? AND project_id=? AND ${subject.column}=? AND kind='concat' AND json_extract(recipe_json,'$.preview') IS NULL ORDER BY created_at DESC LIMIT 1`).bind(userId,projectId,subject.id).all();
  let task=rows.results?.[0];
  const head=await exportHead(ctx.env,userId,runId);
  const result=async selected=>{
    const currentHead=await exportHead(ctx.env,userId,runId);
    const latest=selected||currentHead.latest;
    const previous=currentHead.current||await ctx.env.DB.prepare(`SELECT * FROM canvas_video_processing WHERE user_id=? AND project_id=? AND ${subject.column}=? AND kind='concat' AND recipe_json IS NULL AND asset_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).bind(userId,projectId,subject.id).first();
    return {export:latest?publicCanvasProcessing(latest):null,current:previous?publicCanvasProcessing(previous):null,eligible:true,limits:CANVAS_VIDEO_LIMITS};
  };
  if(ctx.method==='GET') {
    const {availableClips,chain}=await canvasMergeView(ctx.env,userId,projectId,runId);
    const current=head.latest?await result(head.latest):task?{export:publicCanvasProcessing(task),eligible:true}:{export:null,eligible:!chain.error};
    return reply({...current,availableClips,chain,clips:chain.clips.length,chainError:chain.error,limits:CANVAS_VIDEO_LIMITS});
  }
  const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});
  if(parsed.response) return parsed.response;
  if(!parsed.body || Array.isArray(parsed.body)) throw canvasProcessingError('unsupported_option');
  if(Object.hasOwn(parsed.body,'saveExportId')) {
    if(Object.keys(parsed.body).length!==1)throw canvasProcessingError('unsupported_option');
    return reply(await saveCanvasExport(ctx.env,userId,projectId,runId,parsed.body.saveExportId));
  }
  if(Object.hasOwn(parsed.body,'backgroundMusic')) {
    if(Object.keys(parsed.body).some(k=>!['backgroundMusic','orderedClips','mergeMode','smoothJoins','preview'].includes(k)))throw canvasProcessingError('unsupported_option');
    const smooth=smoothJoinSettings(parsed.body.smoothJoins);
    const requestKey=ctx.request.headers.get('Idempotency-Key');
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey||''))throw canvasProcessingError('canvas_export_key_required');
    const explicit=Object.hasOwn(parsed.body,'orderedClips');
    if(parsed.body.mergeMode!==undefined && (!explicit || parsed.body.mergeMode!=='chain'))throw canvasProcessingError('unsupported_option');
    const requestId=await canvasExportId(userId,projectId,runId,requestKey);
    const existing=await ctx.env.DB.prepare('SELECT * FROM canvas_video_processing WHERE (id=? OR id=(SELECT job_id FROM canvas_preview_requests WHERE request_id=?)) AND user_id=?')
      .bind(requestId,requestId,userId).first();
    if(existing) {
      const recipe=JSON.parse(existing.recipe_json||'null');
      const ordered=recipe?.videos.map(canvasClipIdentity);
      if(![1,2,3,4,5,6].includes(recipe?.version)||JSON.stringify(recipe.backgroundMusic)!==JSON.stringify(exportMusicSettings(parsed.body.backgroundMusic))
        ||(recipe.smoothJoins?.enabled??false)!==smooth.enabled||JSON.stringify(recipe.preview||null)!==JSON.stringify(seamPreviewSettings(parsed.body.preview,recipe.videos.length))
        ||recipe.mergeMode!==parsed.body.mergeMode||explicit!==(recipe.sequence==='explicit')||explicit&&JSON.stringify(parsed.body.orderedClips)!==JSON.stringify(ordered))
        throw canvasProcessingError('canvas_export_idempotency_conflict');
      // A lost response, including one spanning deployment, observes the same
      // immutable job. Never turn a replay into a second render.
      return reply(recipe.preview?{preview:publicCanvasProcessing(existing)}:await result(existing),202);
    }
    const view=await canvasMergeView(ctx.env,userId,projectId,runId);
    if(!explicit && view.chain.error)throw canvasProcessingError(view.chain.error);
    const mode=parsed.body.mergeMode || (explicit?'manual':'chain');
    const {videos,admission,transitions}=await canvasVideoSelection(ctx.env,userId,projectId,runId,
      explicit?parsed.body.orderedClips:view.chain.clips.map(canvasClipIdentity),mode,view);
    const recipe=await canvasExportRecipe(ctx.env,userId,projectId,runId,videos,parsed.body.backgroundMusic,explicit,smooth.enabled,parsed.body.preview,transitions);
    if(parsed.body.mergeMode)recipe.mergeMode=parsed.body.mergeMode;
    let key=requestKey;
    if(recipe.preview) {
      // Recipe includes versions/order/audio/music/mode/policy. Never reuse a
      // comparison solely because the node or asset identifier is unchanged.
      const cached=await ctx.env.DB.prepare(`SELECT p.* FROM canvas_video_processing p JOIN canvas_export_versions v ON v.id=p.id
        WHERE p.user_id=? AND p.project_id=? AND p.${subject.column}=? AND p.recipe_json=? AND v.state='canvas' AND v.retired=0
        AND p.status<>'failed' ORDER BY p.created_at DESC LIMIT 1`).bind(userId,projectId,subject.id,JSON.stringify(recipe)).first();
      if(cached) {
        await ctx.env.DB.prepare('INSERT OR IGNORE INTO canvas_preview_requests(request_id,job_id) VALUES(?,?)').bind(requestId,cached.id).run();
        const alias=await ctx.env.DB.prepare('SELECT job_id FROM canvas_preview_requests WHERE request_id=?').bind(requestId).first();
        if(alias?.job_id!==cached.id)throw canvasProcessingError('canvas_export_idempotency_conflict');
        return reply({preview:publicCanvasProcessing(cached)},202);
      }
      const previous=await ctx.env.DB.prepare(`SELECT id FROM canvas_video_processing WHERE user_id=? AND project_id=? AND ${subject.column}=? AND recipe_json=? ORDER BY created_at DESC LIMIT 1`)
        .bind(userId,projectId,subject.id,JSON.stringify(recipe)).first();
      key='seam-'+await sha256Hex(JSON.stringify([recipe,previous?.id||null]));
    }
    task=await enqueueCanvasProcessing(ctx.env,{userId,projectId,runId,kind:'concat',recipe,requestKey:key,requestAlias:recipe.preview?requestId:null,admission,sources:[...videos,...(recipe.music?[recipe.music]:[])]});
    if(recipe.preview)return reply({preview:publicCanvasProcessing(task)},202);
    return reply(await result(task),202);
  }
  if(Object.keys(parsed.body).length) throw canvasProcessingError('unsupported_option');
  // Retain old in-flight/poster recovery, but a fresh render needs an explicit
  // versioned intent. It must never return a completed padded export as new.
  if(!task || task.status==='ready')throw canvasProcessingError('canvas_export_key_required');
  if(task?.asset_id) {
    await ownedCanvasVideo(ctx.env,userId,task.asset_id,null,CANVAS_VIDEO_LIMITS.outputBytes);
    if(task.status==='failed') {
      await ctx.env.DB.prepare("UPDATE canvas_video_processing SET status='preview_pending',attempt_count=0,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status='failed'")
        .bind(nowIso(),nowIso(),task.id,userId).run();
      task=await ctx.env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=?').bind(task.id).first();
    }
    if(['queued','preview_pending'].includes(task.status))await notifyPrivateMedia(ctx.env,task.status==='preview_pending'?task.thumbnail_backend:task.processing_backend);
  return reply({export:publicCanvasProcessing(task),eligible:true,limits:CANVAS_VIDEO_LIMITS},202);
  }
  if(task.recipe_json) {
    // Retry an accepted recipe with its original sources/settings, even after
    // the graph changes. A retry never fabricates ancestry for an imported node.
    for(const source of JSON.parse(task.sources_json))await ownedExportSource(ctx.env,userId,source);
    await ctx.env.DB.prepare("UPDATE canvas_video_processing SET status='queued',attempt_count=0,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status='failed'")
      .bind(nowIso(),nowIso(),task.id,userId).run();
    task=await ctx.env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=? AND user_id=?').bind(task.id,userId).first();
    if(task.status==='queued')await notifyPrivateMedia(ctx.env,task.processing_backend);
    return reply(await result(task),202);
  }
  const sources=await canvasVideoChain(ctx.env,userId,projectId,runId);
  if(sources.length<2) throw canvasProcessingError('canvas_chain_too_short','Connect and finish at least two last-frame clips.');
  task=await enqueueCanvasProcessing(ctx.env,{userId,projectId,runId,kind:'concat',sources});
  if(task.status==='failed') {
    // Explicit owner retry of postprocessing, never inference. Preserve a saved
    // video and retry only its poster. Stable sources keep the same job identity.
    await ctx.env.DB.prepare("UPDATE canvas_video_processing SET status=?,attempt_count=0,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status='failed'")
      .bind(task.asset_id?'preview_pending':'queued',nowIso(),nowIso(),task.id,userId).run();
    task=await ctx.env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=?').bind(task.id).first();
  }
  if(['queued','preview_pending'].includes(task.status))await notifyPrivateMedia(ctx.env,task.status==='preview_pending'?task.thumbnail_backend:task.processing_backend);
  return reply({export:publicCanvasProcessing(task),eligible:true,limits:CANVAS_VIDEO_LIMITS},202);
}

// Existing private processor credential + expiring per-job lease. Neither source
// keys nor browser cookies cross the processor transport.
export async function handleCanvasExportProcessor(ctx) {
  const {method}=ctx;
  if(!ctx.pathname.startsWith(base)) return null;
  const backend=await processorBackend(ctx.env,ctx.request);
  if(!backend) return json({ok:false,code:'processor_auth_failed'},{status:403});
  try {
    if(ctx.pathname===base+'/claim') {
      if(ctx.method==='GET') return reply({protocol:1,recipeProtocol:7,previewBase:1});
      // route-policy: internal.canvas-export.claim
      if (!(method === 'POST')) return null;
      const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});
      if(parsed.response)return parsed.response;
      if(parsed.body?.protocol!==1) throw canvasProcessingError('canvas_processor_protocol');
      const jobs=await claimCanvasProcessing(ctx.env,'concat',Math.max(1,Math.min(3,Math.floor(Number(parsed.body.limit)||1))),backend,parsed.body.recipeProtocol);
      return reply({protocol:1,jobs:jobs.map(row=>({id:row.id,claim:row.processing_token,limits:CANVAS_VIDEO_LIMITS,
        recipeVersion:row.recipe_json?JSON.parse(row.recipe_json).version:null,
        originalAudio:row.recipe_json?JSON.parse(row.recipe_json).videos.map(clip=>clip.originalAudio||{enabled:true,gain:1,fadeIn:0,fadeOut:0}):null,
        spatialPolicy:row.recipe_json?JSON.parse(row.recipe_json).spatialPolicy||'legacy-pad-v1':'legacy-pad-v1',
        backgroundMusic:row.recipe_json?JSON.parse(row.recipe_json).backgroundMusic:null,
        originalAudioPolicy:row.recipe_json?JSON.parse(row.recipe_json).originalAudioPolicy:null,
        transitionPolicy:row.recipe_json?JSON.parse(row.recipe_json).transitionPolicy:null,
        transitions:row.recipe_json?JSON.parse(row.recipe_json).transitions:null,
        smoothJoins:row.recipe_json?JSON.parse(row.recipe_json).smoothJoins:null,
        preview:row.recipe_json?JSON.parse(row.recipe_json).preview:null,
        sources:JSON.parse(row.sources_json).map((s,i)=>({url:`${base}/${row.id}/source/${i}`,size:s.size,kind:s.kind||'video'})),
        completion:{url:`${base}/${row.id}/complete`,failure_url:`${base}/${row.id}/fail`}}))});
    }
    const match=ctx.pathname.match(/^\/api\/internal\/homepage\/hero-videos\/canvas-exports\/jobs\/([a-f0-9]{32})\/(source\/\d+|complete|fail)$/);
    if(!match)return null;
    const token=ctx.request.headers.get('X-BITBI-Canvas-Claim');
    const job=await canvasProcessingClaim(ctx.env,match[1],token);
    if(!job || job.processing_backend!==backend) return json({ok:false,code:'canvas_processing_claim_lost'},{status:409});
    if(match[2].startsWith('source/') && ctx.method==='GET') {
      const source=JSON.parse(job.sources_json)[Number(match[2].split('/')[1])];
      if(!source) throw canvasProcessingError('source_not_found');
      const asset=await ownedExportSource(ctx.env,job.user_id,source);
      const object=await ctx.env.USER_IMAGES.get(asset.r2_key,{onlyIf:{etagMatches:asset.etag}});
      if(!object?.body) throw canvasProcessingError('video_source_changed');
      return new Response(object.body,{headers:{'Content-Type':asset.mime_type,'Content-Length':String(object.size),'Cache-Control':'no-store'}});
    }
    // route-policy: internal.canvas-export.fail
    if(match[2]==='fail' && method === 'POST') {
      const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});
      if(parsed.response)return parsed.response;
      await failCanvasProcessing(ctx.env,job,parsed.body?.code);return reply({recorded:true});
    }
    // route-policy: internal.canvas-export.complete
    if(match[2]==='complete' && method === 'POST') {
      for(const source of JSON.parse(job.sources_json)) await ownedExportSource(ctx.env,job.user_id,source);
      const form=await readFormDataLimited(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroVideoUpload});
      const file=form.get('video');
      if(!file || file.type!=='video/mp4' || !file.size || file.size>CANVAS_VIDEO_LIMITS.outputBytes) throw canvasProcessingError('canvas_export_file_invalid');
      const duration=Number(form.get('duration')),width=Number(form.get('width')),height=Number(form.get('height'));
      if(!(duration>0 && duration<=CANVAS_VIDEO_LIMITS.durationSeconds && Number.isInteger(width) && width>0 && width<=4096 && Number.isInteger(height) && height>0 && height<=4096)) throw canvasProcessingError('canvas_export_metadata_invalid');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(String.fromCharCode(...bytes.slice(4,8))!=='ftyp') throw canvasProcessingError('canvas_export_file_invalid');
      const recipe=JSON.parse(job.recipe_json||'null');
      if(recipe?.version>=3) {
        let timeline;try{timeline=JSON.parse(form.get('audioTimeline'));}catch{throw canvasProcessingError('canvas_audio_timeline_invalid');}
        const count=recipe.preview?2:recipe.videos.length;
        let end=0;
        if(!Array.isArray(timeline)||timeline.length!==count)throw canvasProcessingError('canvas_audio_timeline_invalid');
        for(const [i,clip] of timeline.entries()) {
          if(!clip||Object.keys(clip).sort().join(',')!==(recipe.version>=6?'duration,originalAudioFit,overlap,start':recipe.version>=5?'duration,originalAudioFit,start':'duration,start')
            ||recipe.version>=5&&!validAudioFit(clip.originalAudioFit)||!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)
            ||clip.duration<=0||Math.abs(clip.start-end)>.001)throw canvasProcessingError('canvas_audio_timeline_invalid');
          if(recipe.version>=6){const transition=i===count-1?null:recipe.transitions[recipe.preview?recipe.preview.seamIndex+i:i];const expected=transition?.preset!=='none'&&transition?.duration||0;if(!Number.isFinite(clip.overlap)||clip.overlap<0||Math.abs(clip.overlap-expected)>.05||clip.overlap>clip.duration/2+.001)throw canvasProcessingError('canvas_audio_timeline_invalid');}
          end=clip.start+clip.duration-(clip.overlap||0);
        }
        if(Math.abs(end-duration)>Math.max(.25,count*.06))throw canvasProcessingError('canvas_audio_timeline_invalid');
        await ctx.env.DB.prepare("UPDATE canvas_video_processing SET audio_timeline_json=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?")
          .bind(JSON.stringify(timeline),job.id,token,nowIso()).run();
      }
      if(new URL(ctx.request.url).searchParams.get('part')==='preview-base') {
        await storeCanvasPreviewBase(ctx.env,job,bytes);
        return reply({base_stored:true});
      }
      if(recipe?.version>=4) {
        let report;try{report=JSON.parse(form.get('seamResult'));}catch{throw canvasProcessingError('canvas_seam_result_invalid');}
        if(!validSeamResult(report,{enabled:recipe.smoothJoins.enabled,preview:recipe.preview,count:recipe.videos.length}))throw canvasProcessingError('canvas_seam_result_invalid');
        await ctx.env.DB.prepare("UPDATE canvas_video_processing SET seam_result_json=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?")
          .bind(JSON.stringify(report),job.id,token,nowIso()).run();
      }
      const asset=await saveGeneratedVideoAsset(ctx.env,{userId:job.user_id,title:'Canvas full video',videoBytes:bytes,mimeType:'video/mp4',
        processingClaim:{id:job.id,token},payload:{duration,width,height,canvas_export:job.id}});
      const written=await ctx.env.DB.prepare("UPDATE canvas_video_processing SET asset_id=?,status='preview_pending',attempt_count=0,locked_until=NULL,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?")
        .bind(asset.id,nowIso(),nowIso(),job.id,token,nowIso()).run();
      if(!written.meta?.changes) throw canvasProcessingError('canvas_processing_claim_lost');
      await notifyPrivateMedia(ctx.env,job.thumbnail_backend);
      await reclaimCanvasMedia(ctx.env,job.user_id);
      return reply({asset_id:asset.id,status:'preview_pending'});
    }
    return null;
  } catch(error) {return json({ok:false,code:error.code||'canvas_processing_failed'},{status:error.status||500});}
}
