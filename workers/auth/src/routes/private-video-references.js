import { processorBackend } from '../lib/private-media-service.js';
import { referenceError } from '../lib/private-video-references.js';
import { inspectH3TimeReference } from '../lib/h3-reference-metadata.js';
import { reserveUserAssetStorage } from '../lib/asset-storage-quota.js';
import { putNewManagedR2Object } from '../lib/r2-cleanup.js';
import { readJsonBodyOrResponse, readFormDataLimited, BODY_LIMITS } from '../lib/request.js';
import { nowIso, randomTokenHex } from '../lib/tokens.js';
import { json } from '../lib/response.js';
const base='/api/internal/homepage/hero-videos/reference-videos/jobs';
const reply=data=>json({ok:true,data},{headers:{'Cache-Control':'no-store'}});

export async function handleVideoReferenceProcessor(ctx) {
  if(!ctx.pathname.startsWith(base))return null;
  const {env,method,request}=ctx,backend=await processorBackend(env,request);
  if(!backend)return json({ok:false,code:'processor_auth_failed'},{status:403});
  try {
    if(ctx.pathname===base+'/claim') {
      if(method==='GET')return reply({protocol:1});
      // route-policy: internal.video-reference.claim
      if(!(method === 'POST'))return null;
      const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});
      if(parsed.response)return parsed.response;
      if(parsed.body?.protocol!==1)throw referenceError('reference_protocol');
      const now=nowIso(),token=randomTokenHex(16);
      const row=await env.DB.prepare(`UPDATE private_video_references SET status='processing',processing_token=?,locked_until=?,attempt_count=attempt_count+1,updated_at=?
        WHERE id=(SELECT id FROM private_video_references WHERE processing_backend=? AND status IN ('queued','processing')
          AND attempt_count<3 AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?) ORDER BY created_at LIMIT 1)
        RETURNING *`).bind(token,new Date(Date.now()+10*60_000).toISOString(),now,backend,now,now).first();
      return reply({protocol:1,jobs:row?[{id:row.id,claim:token,source:{url:`${base}/${row.id}/source/0`,size:row.source_bytes},metadata:JSON.parse(row.source_metadata_json),
        completion:{url:`${base}/${row.id}/complete`,failure_url:`${base}/${row.id}/fail`}}]:[]});
    }
    const match=ctx.pathname.match(/^\/api\/internal\/homepage\/hero-videos\/reference-videos\/jobs\/([a-f0-9]{32})\/(source\/0|complete|fail)$/);
    if(!match)return null;
    const token=request.headers.get('X-BITBI-Canvas-Claim'),id=match[1];
    const row=await env.DB.prepare("SELECT * FROM private_video_references WHERE id=? AND processing_backend=? AND processing_token=? AND status='processing' AND locked_until>?")
      .bind(id,backend,token,nowIso()).first();
    if(!row)throw referenceError('reference_claim_lost');
    if(match[2]==='source/0' && method==='GET') {
      const object=await env.USER_IMAGES.get(row.source_r2_key,{onlyIf:{etagMatches:row.source_etag}});
      if(!object?.body || object.size!==row.source_bytes)throw referenceError('media_source_changed');
      return new Response(object.body,{headers:{'Content-Type':'video/mp4','Content-Length':String(object.size),'Cache-Control':'no-store'}});
    }
    // route-policy: internal.video-reference.fail
    if(match[2]==='fail' && method === 'POST') {
      const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.homepageHeroProcessorJson});
      if(parsed.response)return parsed.response;
      // A failed decode/validation is terminal. Transport interruption leaves the
      // finite lease recoverable, without another inference or new output key.
      await env.DB.prepare("UPDATE private_video_references SET status='failed',error_code='h3_reference_preparation_failed',locked_until=NULL,updated_at=? WHERE id=? AND processing_token=? AND locked_until>?")
        .bind(nowIso(),id,token,nowIso()).run();
      return reply({recorded:true});
    }
    // route-policy: internal.video-reference.complete
    if(match[2]==='complete' && method === 'POST') {
      const form=await readFormDataLimited(request,{maxBytes:BODY_LIMITS.homepageHeroVideoUpload}),file=form.get('video');
      if(!file || file.type!=='video/mp4' || !file.size || file.size>50_000_000)throw referenceError('h3_reference_metadata_invalid',400);
      let bytes=new Uint8Array(await file.arrayBuffer());
      const existing=await env.USER_IMAGES.get(row.output_r2_key);
      if(existing?.body)bytes=new Uint8Array(await new Response(existing.body).arrayBuffer());
      const metadata=inspectH3TimeReference(bytes,'video','video/mp4'),source=JSON.parse(row.source_metadata_json);
      if(metadata.width!==source.width || metadata.height!==source.height || Math.abs(metadata.fps-source.fps)>0.001
        || Boolean(metadata.audioDuration)!==Boolean(source.audioDuration) || metadata.duration<14.9)throw referenceError('h3_reference_metadata_invalid',400);
      const head=await env.USER_IMAGES.head(row.source_r2_key);
      if(!head || head.etag!==row.source_etag)throw referenceError('media_source_changed');
      await reserveUserAssetStorage(env,{userId:row.user_id,uploadBytes:bytes.length,generationReservation:{table:'private_video_references',id,token}});
      if(!existing)await putNewManagedR2Object(env,row.output_r2_key,bytes,{httpMetadata:{contentType:'video/mp4'}});
      const output=await env.USER_IMAGES.head(row.output_r2_key);
      const changed=await env.DB.prepare("UPDATE private_video_references SET status='ready',output_etag=?,output_metadata_json=?,locked_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND processing_token=? AND status='processing' AND locked_until>?")
        .bind(output.etag,JSON.stringify(metadata),nowIso(),id,token,nowIso()).run();
      if(!changed.meta?.changes)throw referenceError('reference_claim_lost');
      return reply({status:'ready'});
    }
    return null;
  } catch(error) {return json({ok:false,code:error.code||'h3_reference_preparation_failed'},{status:error.status||500});}
}
