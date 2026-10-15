import { prepareCanvasMediaInspection, readCanvasMediaInspection, claimCanvasInspections, canvasInspectionClaim, inspectionError } from '../lib/canvas-media-inspections.js';
import { ownedCanvasVideo } from '../lib/canvas-video-input.js';
import { processorBackend, notifyPrivateMedia } from '../lib/private-media-service.js';
import { canvasPrivateImageContext } from '../lib/canvas-private-image-context.js';
import { handleSaveImage } from './ai/images-write.js';
import { readJsonBodyOrResponse, readFormDataLimited, BODY_LIMITS } from '../lib/request.js';
import { nowIso } from '../lib/tokens.js';
import { json } from '../lib/response.js';
const base='/api/internal/homepage/hero-videos/canvas-exports/jobs/inspections';
const reply=(data,status=200)=>json({ok:true,data},{status,headers:{'Cache-Control':'no-store'}});

export async function handleCanvasMediaInspection(ctx,userId,projectId,jobId=null) {
    if(ctx.method==='GET')return reply({inspection:await readCanvasMediaInspection(ctx.env,userId,projectId,jobId)});
    const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    return reply({inspection:await prepareCanvasMediaInspection(ctx.env,userId,projectId,parsed.body)},202);
}

function metadata(value,frame) {
    if(!value||Object.keys(value).sort().join(',')!==(frame.kind==='time'?'duration,fps,frameHeight,frameMimeType,frameTime,frameWidth,frames,hasAudio,height,width':'duration,fps,frameTime,frames,hasAudio,height,width')
        ||![value.duration,value.fps,value.frameTime].every(Number.isFinite)||value.duration<=0||value.duration>600||value.fps<=0||value.fps>60
        ||![value.width,value.height,value.frames].every(Number.isSafeInteger)||value.width<1||value.height<1||value.width>4096||value.height>4096
        ||value.frames<1||value.frames>36000||typeof value.hasAudio!=='boolean'||value.frameTime<0||value.frameTime>=value.duration
        ||Math.abs(value.frames/value.fps-value.duration)>1/value.fps+.001
        ||frame.kind==='last'&&Math.abs(value.frameTime-(value.frames-1)/value.fps)>.001
        ||frame.kind==='time'&&(Math.abs(value.frameTime-frame.seconds)>1/value.fps+.001||value.frameMimeType!=='image/jpeg'||![value.frameWidth,value.frameHeight].every(n=>Number.isSafeInteger(n)&&n>0&&n<=512)))throw inspectionError('canvas_inspection_metadata_invalid',400);
    return {duration:value.duration,width:value.width,height:value.height,fps:value.fps,frames:value.frames,hasAudio:value.hasAudio,frameTime:value.frameTime,...(frame.kind==='time'?{frameWidth:value.frameWidth,frameHeight:value.frameHeight,frameMimeType:value.frameMimeType}:{})};
}

function jpegDimensions(bytes) {
    if(bytes[0]!==255||bytes[1]!==216)return null;
    for(let offset=2;offset+8<bytes.length;) {
        if(bytes[offset++]!==255)return null;while(bytes[offset]===255)offset++;
        const marker=bytes[offset++];if(marker===217||marker===218)return null;
        const length=bytes[offset]*256+bytes[offset+1];if(length<2||offset+length>bytes.length)return null;
        if([192,193,194].includes(marker))return {height:bytes[offset+3]*256+bytes[offset+4],width:bytes[offset+5]*256+bytes[offset+6]};
        offset+=length;
    }return null;
}

export async function handleCanvasInspectionProcessor(ctx) {
    if(!ctx.pathname.startsWith(base+'/'))return null;
    const backend=await processorBackend(ctx.env,ctx.request);
    if(backend!=='cloudflare')return json({ok:false,code:'processor_auth_failed'},{status:403});
    try {
        // route-policy: internal.canvas-inspection.claim
        if(ctx.pathname===base+'/claim'&&ctx.method==='POST') {
            const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});if(parsed.response)return parsed.response;
            if(parsed.body?.protocol!==1)throw inspectionError('canvas_inspection_protocol',400);
            const rows=await claimCanvasInspections(ctx.env,backend);
            return reply({jobs:rows.map(row=>({id:row.id,claim:row.processing_token,frame:JSON.parse(row.frame_json),source:{url:`${base}/${row.id}/source`,size:row.source_bytes},complete:`${base}/${row.id}/complete`,fail:`${base}/${row.id}/fail`}))});
        }
        const match=ctx.pathname.match(/\/inspections\/([a-f0-9]{32})\/(source|complete|fail)$/);
        if(!match)return null;
        const job=await canvasInspectionClaim(ctx.env,match[1],ctx.request.headers.get('X-BITBI-Canvas-Claim'));
        if(!job)throw inspectionError('canvas_processing_claim_lost');
        if(match[2]==='source'&&ctx.method==='GET') {
            const source=await ownedCanvasVideo(ctx.env,job.user_id,job.source_asset_id,job.source_version,80000000),object=await ctx.env.USER_IMAGES.get(source.r2_key,{onlyIf:{etagMatches:source.etag}});
            if(!object?.body)throw inspectionError('video_source_changed');
            return new Response(object.body,{headers:{'Content-Type':source.mime_type,'Content-Length':String(object.size),'Cache-Control':'no-store'}});
        }
        // route-policy: internal.canvas-inspection.fail
        if(match[2]==='fail'&&ctx.method==='POST') {
            const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});if(parsed.response)return parsed.response;
            const transient=parsed.body?.code==='canvas_processing_transient'&&job.attempt_count<3;
            await ctx.env.DB.prepare(`UPDATE canvas_media_inspections SET status=?,error_code=?,locked_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND processing_token=? AND status='processing'`)
                .bind(transient?'queued':'failed',transient?'canvas_processing_transient':'canvas_inspection_failed',new Date(Date.now()+60000).toISOString(),nowIso(),job.id,job.processing_token).run();
            if(transient)await notifyPrivateMedia(ctx.env,'cloudflare');return reply({recorded:true});
        }
        // route-policy: internal.canvas-inspection.complete
        if(match[2]==='complete'&&ctx.method==='POST') {
            await ownedCanvasVideo(ctx.env,job.user_id,job.source_asset_id,job.source_version,80000000);
            const sample=JSON.parse(job.frame_json).kind==='time',mimeType=sample?'image/jpeg':'image/png';
            const form=await readFormDataLimited(ctx.request,{maxBytes:BODY_LIMITS.aiSaveImageJson}),file=form.get('image');
            if(!file||file.type!==mimeType||!file.size||file.size>(sample?48000:10000000))throw inspectionError('canvas_inspection_image_invalid',400);
            let parsed;try{parsed=JSON.parse(form.get('metadata'));}catch{throw inspectionError('canvas_inspection_metadata_invalid',400);}
            const result=JSON.stringify(metadata(parsed,JSON.parse(job.frame_json)));
            if(job.result_json&&job.result_json!==result)throw inspectionError('canvas_inspection_result_conflict');
            const user=await ctx.env.DB.prepare("SELECT id,email,role,status FROM users WHERE id=? AND status='active'").bind(job.user_id).first();
            if(!user)throw inspectionError('canvas_inspection_owner_unavailable');
            const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
            const dimensions=sample?jpegDimensions(bytes):bytes.length>=24&&String.fromCharCode(...bytes.subarray(12,16))==='IHDR'?{width:view.getUint32(16),height:view.getUint32(20)}:null;
            if(!dimensions||dimensions.width!==(sample?parsed.frameWidth:parsed.width)||dimensions.height!==(sample?parsed.frameHeight:parsed.height))throw inspectionError('canvas_inspection_image_invalid',400);
            await ctx.env.DB.prepare(`UPDATE canvas_media_inspections SET result_json=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?`).bind(result,job.id,job.processing_token,nowIso()).run();
            let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
            await ctx.env.DB.prepare(`INSERT OR IGNORE INTO canvas_media_outputs(run_id,user_id,project_id,node_id,asset_id,role,kind,created_at)
                VALUES(NULL,?,?,?,?,'frame','image',?)`).bind(job.user_id,job.project_id,job.node_id,job.id,nowIso()).run();
            const request=new Request(new URL('/api/ai/images/save',ctx.request.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageData:`data:${mimeType};base64,`+btoa(binary),prompt:'Canvas source frame',title:'Canvas source frame',model:'canvas-frame-extraction'})});
            const saved=await handleSaveImage(canvasPrivateImageContext({...ctx,request,canvasImageId:job.id},user));
            if(!saved.ok)throw inspectionError('canvas_inspection_save_pending',saved.status);
            const completed=await ctx.env.DB.prepare(`UPDATE canvas_media_inspections SET status='ready',error_code=NULL,locked_until=NULL,updated_at=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?`)
                .bind(nowIso(),job.id,job.processing_token,nowIso()).run();
            if(!completed.meta?.changes)throw inspectionError('canvas_processing_claim_lost');
            return reply({inspection:await readCanvasMediaInspection(ctx.env,job.user_id,job.project_id,job.id)});
        }
        return null;
    }catch(error){return json({ok:false,code:error.code||'canvas_inspection_failed'},{status:error.status||500});}
}
