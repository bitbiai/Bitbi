import { MINIMAX_CONSENT_TEXT_VERSION } from '../../../../js/shared/minimax-consent.mjs';
import { json } from '../lib/response.js';
import { requireUser } from '../lib/session.js';
import { BODY_LIMITS,readJsonBodyOrResponse } from '../lib/request.js';
import { evaluateSharedRateLimit,rateLimitResponse,rateLimitUnavailableResponse,sensitiveRateLimitOptions } from '../lib/rate-limit.js';
import { getMinimaxConsent,minimaxGrantStatements,revokeMinimaxConsent,recordMinimaxActivity } from '../lib/minimax-consent.js';

export async function handleMinimaxConsent(ctx) {
  const {request,env}=ctx, session=await requireUser(request,env);
  if(session instanceof Response)return session;
  const userId=session.user.id;
  if(request.method==='GET')return json({ok:true,consent:await getMinimaxConsent(env,userId)});
  const limit=await evaluateSharedRateLimit(env,'minimax-consent-user',userId,30,60_000,sensitiveRateLimitOptions({component:'minimax-consent',correlationId:ctx.correlationId,requestInfo:ctx}));
  if(limit.unavailable)return rateLimitUnavailableResponse(ctx.correlationId);
  if(limit.limited)return rateLimitResponse();
  const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});
  if(parsed.response)return parsed.response;
  const revoke=new URL(request.url).pathname.endsWith('/revoke');
  if(!revoke && (parsed.body?.confirmed!==true || !['first_use','settings'].includes(parsed.body?.source)))return json({ok:false,error:'Explicit consent is required.',code:'invalid_consent'},{status:400});
  if(!revoke && parsed.body.displayedTextVersion!==MINIMAX_CONSENT_TEXT_VERSION)return json({ok:false,error:'Reload the current MiniMax consent text.',code:'consent_text_changed'},{status:409});
  if(!revoke)await env.DB.batch(minimaxGrantStatements(env,userId,{locale:parsed.body.locale||request.headers.get('Accept-Language'),source:parsed.body.source}));
  const consent=revoke?await revokeMinimaxConsent(env,userId):await getMinimaxConsent(env,userId);
  ctx.execCtx.waitUntil(recordMinimaxActivity(ctx,userId,revoke?'revoke':'grant',consent));
  return json({ok:true,consent});
}
