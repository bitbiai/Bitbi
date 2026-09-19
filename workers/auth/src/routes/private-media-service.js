import { privateMediaSmoke } from '../lib/private-media-smoke.js';
import { privateMediaStatus,setPrivateMediaService,processorBackend,mediaRunner } from '../lib/private-media-service.js';
import { requireAdmin } from '../lib/session.js';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse,BODY_LIMITS } from '../lib/request.js';
import { evaluateSharedRateLimit,getClientIp,sensitiveRateLimitOptions,rateLimitResponse,rateLimitUnavailableResponse } from '../lib/rate-limit.js';
import { enqueueAdminAuditEvent } from '../lib/activity.js';
const reply=(body,status=200)=>json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handlePrivateMediaService(ctx) {
  const {method}=ctx;
  const internal=ctx.pathname==='/api/internal/homepage/hero-videos/private-media/runner';
  const smoke=ctx.pathname==='/api/internal/homepage/hero-videos/private-media/smoke';
  const admin=ctx.pathname==='/api/admin/private-media/service';
  if(!internal&&!admin&&!smoke)return null;
  if(!['GET','POST'].includes(ctx.method)||(internal||smoke)&&ctx.method!=='POST')return reply({ok:false,code:'method_not_allowed'},405);
  let actor,backend;
  if(admin){actor=await requireAdmin(ctx.request,ctx.env,{isSecure:ctx.isSecure,correlationId:ctx.correlationId});if(actor instanceof Response)return actor;}
  else {backend=await processorBackend(ctx.env,ctx.request);if(!backend)return reply({ok:false,code:'processor_auth_failed'},403);}
  try {
    if(admin&&ctx.method==='GET')return reply({ok:true,data:await privateMediaStatus(ctx.env)});
    const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    const body=parsed.body;if(!body||typeof body!=='object'||Array.isArray(body))return reply({ok:false,code:'invalid_payload'},400);
    // route-policy: internal.private-media.smoke
    if(smoke && method === 'POST'){
      if(backend!=='cloudflare')return reply({ok:false,code:'processor_auth_failed'},403);
      return reply({ok:true,data:await privateMediaSmoke(ctx.env,body)});
    }
    // route-policy: internal.private-media.runner
    if(internal && method === 'POST'){
      if(Object.keys(body).some(k=>!['token','runner','action'].includes(k)))return reply({ok:false,code:'invalid_payload'},400);
      return reply({ok:true,data:await mediaRunner(ctx.env,backend,body)});
    }
    // route-policy: admin.private-media.service.update
    if (!(method === 'POST')) return null;
    const limit=await evaluateSharedRateLimit(ctx.env,'admin-action-ip',getClientIp(ctx.request),30,900_000,sensitiveRateLimitOptions({component:'private-media-service',correlationId:ctx.correlationId,requestInfo:ctx}));
    if(limit.unavailable)return rateLimitUnavailableResponse(ctx.correlationId);
    if(limit.limited)return rateLimitResponse();
    if(Object.keys(body).some(k=>!['backend','reason'].includes(k))||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>180)return reply({ok:false,code:'reason_required'},400);
    const data=await setPrivateMediaService(ctx.env,{backend:body.backend,actor:actor.user.id,reason:body.reason.trim()});
    await enqueueAdminAuditEvent(ctx.env,{adminUserId:actor.user.id,action:'private_media_service_updated',targetUserId:null,meta:{backend:body.backend,existingJobsUnchanged:true}},{correlationId:ctx.correlationId,requestInfo:ctx,allowDirectFallback:true});
    return reply({ok:true,data});
  } catch(error){return reply({ok:false,code:['media_backend_invalid','media_service_not_ready','media_runner_invalid','media_runner_claim_lost'].includes(error.code)?error.code:'media_service_unavailable'},error.status||503);}
}
