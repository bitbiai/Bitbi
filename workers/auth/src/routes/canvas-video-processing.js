import { canvasVideoChain, enqueueCanvasProcessing, publicCanvasProcessing, claimCanvasProcessing, canvasProcessingClaim, failCanvasProcessing, CANVAS_VIDEO_LIMITS, canvasProcessingError } from '../lib/canvas-video-processing.js';
import { ownedCanvasVideo } from '../lib/canvas-video-input.js';
import { saveGeneratedVideoAsset } from '../lib/ai-text-assets.js';
import { getMemvidStreamPreviewProcessorSecret } from '../lib/video-delivery-settings.js';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse, readFormDataLimited, BODY_LIMITS } from '../lib/request.js';
import { nowIso } from '../lib/tokens.js';

const base='/api/internal/homepage/hero-videos/canvas-exports/jobs';
const reply=(data,status=200)=>json({ok:true,data},{status,headers:{'Cache-Control':'no-store'}});

export async function canvasExport(ctx,userId,projectId,runId) {
  const project=await ctx.env.DB.prepare('SELECT id FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(projectId,userId).first();
  if(!project) throw canvasProcessingError('project_not_found','Project not found.',404);
  const rows=await ctx.env.DB.prepare("SELECT * FROM canvas_video_processing WHERE user_id=? AND project_id=? AND run_id=? AND kind='concat' ORDER BY created_at DESC LIMIT 1").bind(userId,projectId,runId).all();
  let task=rows.results?.[0];
  if(ctx.method==='GET') {
    if(task) return reply({export:publicCanvasProcessing(task),eligible:true,limits:CANVAS_VIDEO_LIMITS});
    const sources=await canvasVideoChain(ctx.env,userId,projectId,runId);
    return reply({export:null,eligible:sources.length>1,clips:sources.length,limits:CANVAS_VIDEO_LIMITS});
  }
  const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});
  if(parsed.response) return parsed.response;
  if(!parsed.body || Object.keys(parsed.body).length) throw canvasProcessingError('unsupported_option');
  if(task?.asset_id) {
    await ownedCanvasVideo(ctx.env,userId,task.asset_id,null,CANVAS_VIDEO_LIMITS.outputBytes);
    if(task.status==='failed') {
      await ctx.env.DB.prepare("UPDATE canvas_video_processing SET status='preview_pending',attempt_count=0,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status='failed'")
        .bind(nowIso(),nowIso(),task.id,userId).run();
      task=await ctx.env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=?').bind(task.id).first();
    }
    return reply({export:publicCanvasProcessing(task),eligible:true,limits:CANVAS_VIDEO_LIMITS},202);
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
  return reply({export:publicCanvasProcessing(task),eligible:true,limits:CANVAS_VIDEO_LIMITS},202);
}

// Existing private processor credential + expiring per-job lease. Neither source
// keys nor browser cookies cross the processor transport.
export async function handleCanvasExportProcessor(ctx) {
  const {method}=ctx;
  if(!ctx.pathname.startsWith(base)) return null;
  const secret=getMemvidStreamPreviewProcessorSecret(ctx.env);
  if(!secret || ctx.request.headers.get('Authorization')!==`Bearer ${secret}`) return json({ok:false,code:'processor_auth_failed'},{status:403});
  try {
    if(ctx.pathname===base+'/claim') {
      if(ctx.method==='GET') return reply({protocol:1});
      // route-policy: internal.canvas-export.claim
      if (!(method === 'POST')) return null;
      const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});
      if(parsed.response)return parsed.response;
      if(parsed.body?.protocol!==1) throw canvasProcessingError('canvas_processor_protocol');
      const jobs=await claimCanvasProcessing(ctx.env,'concat',Math.max(1,Math.min(3,Math.floor(Number(parsed.body.limit)||1))));
      return reply({protocol:1,jobs:jobs.map(row=>({id:row.id,claim:row.processing_token,limits:CANVAS_VIDEO_LIMITS,
        sources:JSON.parse(row.sources_json).map((s,i)=>({url:`${base}/${row.id}/source/${i}`,size:s.size})),
        completion:{url:`${base}/${row.id}/complete`,failure_url:`${base}/${row.id}/fail`}}))});
    }
    const match=ctx.pathname.match(/^\/api\/internal\/homepage\/hero-videos\/canvas-exports\/jobs\/([a-f0-9]{32})\/(source\/\d+|complete|fail)$/);
    if(!match)return null;
    const token=ctx.request.headers.get('X-BITBI-Canvas-Claim');
    const job=await canvasProcessingClaim(ctx.env,match[1],token);
    if(!job) return json({ok:false,code:'canvas_processing_claim_lost'},{status:409});
    if(match[2].startsWith('source/') && ctx.method==='GET') {
      const source=JSON.parse(job.sources_json)[Number(match[2].split('/')[1])];
      if(!source) throw canvasProcessingError('source_not_found');
      const asset=await ownedCanvasVideo(ctx.env,job.user_id,source.assetId,source.version,80_000_000);
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
      for(const source of JSON.parse(job.sources_json)) await ownedCanvasVideo(ctx.env,job.user_id,source.assetId,source.version,80_000_000);
      const form=await readFormDataLimited(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroVideoUpload});
      const file=form.get('video');
      if(!file || file.type!=='video/mp4' || !file.size || file.size>CANVAS_VIDEO_LIMITS.outputBytes) throw canvasProcessingError('canvas_export_file_invalid');
      const duration=Number(form.get('duration')),width=Number(form.get('width')),height=Number(form.get('height'));
      if(!(duration>0 && duration<=CANVAS_VIDEO_LIMITS.durationSeconds && Number.isInteger(width) && width>0 && width<=4096 && Number.isInteger(height) && height>0 && height<=4096)) throw canvasProcessingError('canvas_export_metadata_invalid');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(String.fromCharCode(...bytes.slice(4,8))!=='ftyp') throw canvasProcessingError('canvas_export_file_invalid');
      const asset=await saveGeneratedVideoAsset(ctx.env,{userId:job.user_id,title:'Canvas full video',videoBytes:bytes,mimeType:'video/mp4',
        processingClaim:{id:job.id,token},payload:{duration,width,height,canvas_export:job.id}});
      const written=await ctx.env.DB.prepare("UPDATE canvas_video_processing SET asset_id=?,status='preview_pending',attempt_count=0,locked_until=NULL,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?")
        .bind(asset.id,nowIso(),nowIso(),job.id,token,nowIso()).run();
      if(!written.meta?.changes) throw canvasProcessingError('canvas_processing_claim_lost');
      return reply({asset_id:asset.id,status:'preview_pending'});
    }
    return null;
  } catch(error) {return json({ok:false,code:error.code||'canvas_processing_failed'},{status:error.status||500});}
}
