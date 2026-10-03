import { requireUser } from '../../lib/session.js';
import { json } from '../../lib/response.js';
import { readFormDataLimited, BODY_LIMITS } from '../../lib/request.js';
import { saveGeneratedVideoAsset } from '../../lib/ai-text-assets.js';
import { assertOmniMediaSignature } from '../../lib/gemini-omni-media.js';
import { evaluateSharedRateLimit, sensitiveRateLimitOptions, rateLimitResponse, rateLimitUnavailableResponse } from '../../lib/rate-limit.js';

// Owned uploads use the existing storage quota, atomic asset writer and private
// file routes. Uploading a reference never invokes an inference provider.
export async function handleReferenceVideoUpload(ctx) {
    const { request, env, correlationId } = ctx;
    const session = await requireUser(request, env);
    if (session instanceof Response) return session;
    const limit = await evaluateSharedRateLimit(env,'ai-reference-upload-user',session.user.id,12,600000,sensitiveRateLimitOptions({component:'ai-reference-upload',correlationId}));
    if (limit.unavailable) return rateLimitUnavailableResponse(correlationId);
    if (limit.limited) return rateLimitResponse();
    try {
        const form = await readFormDataLimited(request,{maxBytes:BODY_LIMITS.aiReferenceVideoMultipart}), file=form.get('file');
        if (!(file instanceof File) || file.size<16 || file.size>24*1024*1024 || !['video/mp4','video/webm','video/quicktime'].includes(file.type)) return json({ok:false,code:'reference_video_invalid',error:'Choose an MP4, WebM or MOV video up to 24 MiB.'},{status:400});
        const bytes = new Uint8Array(await file.arrayBuffer());assertOmniMediaSignature(bytes,file.type);
        const asset = await saveGeneratedVideoAsset(env,{userId:session.user.id,title:file.name,videoBytes:bytes,mimeType:file.type,payload:{provider:'user_upload',workflow:'uploaded-reference',model:{id:'uploaded-reference',label:'Uploaded video'},receivedAt:new Date().toISOString()}});
        return json({ok:true,asset},{status:201,headers:{'Cache-Control':'private, no-store'}});
    } catch(error) {
        return json({ok:false,code:error.code||'reference_upload_failed',error:error.status<500?error.message:'The reference could not be stored.'},{status:error.status||503});
    }
}
