import { nowIso, randomTokenHex } from './tokens.js';

export async function claimMemberVideoPosters(env, limit) {
  const now=nowIso();
  const due=await env.DB.prepare(`SELECT id FROM member_generation_jobs WHERE media_type='video' AND status='preview_pending'
    AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?) AND attempt_count<16 ORDER BY created_at LIMIT ?`).bind(now,now,limit).all();
  const rows=[];
  for(const item of due.results||[]) {
    const token=randomTokenHex(16);
    const claim=await env.DB.prepare(`UPDATE member_generation_jobs SET processing_token=?,locked_until=?,attempt_count=attempt_count+1
      WHERE id=? AND status='preview_pending' AND (locked_until IS NULL OR locked_until<=?)`)
      .bind(token,new Date(Date.now()+15*60_000).toISOString(),item.id,now).run();
    if(claim.meta?.changes) {
      const row=await memberVideoPosterSource(env,item.id,token);
      if(row) rows.push(row);
    }
  }
  return rows;
}

export async function memberVideoPosterSource(env,id,token) {
  if(!/^[a-f0-9]{32}$/.test(token||'')) return null;
  return env.DB.prepare(`SELECT assets.*,jobs.id AS generation_job_id,jobs.processing_token AS poster_processing_token
    FROM member_generation_jobs jobs JOIN ai_text_assets assets ON assets.id=jobs.asset_id AND assets.user_id=jobs.user_id
    WHERE jobs.id=? AND jobs.processing_token=? AND jobs.status='preview_pending' AND jobs.locked_until>?
    AND assets.source_module='video'`).bind(id,token,nowIso()).first();
}

export async function finishMemberVideoPoster(env,row,{status}) {
  const ready=Boolean((await env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=?').bind(row.id,row.user_id).first())?.poster_r2_key);
  const exhausted=Number((await env.DB.prepare('SELECT attempt_count FROM member_generation_jobs WHERE id=?').bind(row.generation_job_id).first())?.attempt_count)>=16;
  await env.DB.prepare(`UPDATE member_generation_jobs SET status=?,error_code=?,locked_until=NULL,next_attempt_at=?,updated_at=?,completed_at=?
    WHERE id=? AND processing_token=? AND status='preview_pending'`)
    .bind(ready?'succeeded':'preview_pending',ready?null:exhausted?'preview_retry_exhausted':status==='failed'?'preview_processing_failed':null,
      new Date(Date.now()+5*60_000).toISOString(),nowIso(),ready?nowIso():null,row.generation_job_id,row.poster_processing_token).run();
  return {poster_status:ready?'ready':exhausted?'failed':'pending'};
}

// Explicit owner retry can only re-arm an exhausted poster, never generation or
// its credit operation. Automatic retries remain bounded between owner actions.
export async function retryMemberVideoPoster(ctx,id) {
  const {requireUser}=await import('./session.js');
  const {json}=await import('./response.js');
  const {readJsonBodyOrResponse,BODY_LIMITS}=await import('./request.js');
  const {evaluateSharedRateLimit,sensitiveRateLimitOptions,rateLimitResponse,rateLimitUnavailableResponse}=await import('./rate-limit.js');
  const session=await requireUser(ctx.request,ctx.env);
  if(session instanceof Response)return session;
  const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});
  if(parsed.response)return parsed.response;
  if(!parsed.body || typeof parsed.body!=='object' || Array.isArray(parsed.body) || Object.keys(parsed.body).length)return json({ok:false,code:'unsupported_option'},{status:400});
  const limit=await evaluateSharedRateLimit(ctx.env,'member-preview-retry',session.user.id,3,60*60_000,
    sensitiveRateLimitOptions({component:'member-preview-retry',correlationId:ctx.correlationId||null,requestInfo:ctx}));
  if(limit.unavailable)return rateLimitUnavailableResponse(ctx.correlationId||null);
  if(limit.limited)return rateLimitResponse();
  const result=await ctx.env.DB.prepare(`UPDATE member_generation_jobs SET attempt_count=0,error_code=NULL,next_attempt_at=?,updated_at=?
    WHERE id=? AND user_id=? AND media_type='video' AND status='preview_pending'
    AND error_code='preview_retry_exhausted' AND (locked_until IS NULL OR locked_until<=?)
    AND EXISTS (SELECT 1 FROM ai_text_assets a JOIN member_ai_usage_attempts_v2 u ON u.id=member_generation_jobs.usage_attempt_id
      WHERE a.id=member_generation_jobs.asset_id AND a.user_id=member_generation_jobs.user_id
      AND a.poster_r2_key IS NULL AND u.billing_status='finalized')`)
    .bind(nowIso(),nowIso(),id,session.user.id,nowIso()).run();
  return json(result.meta?.changes?{ok:true}:{ok:false,code:'preview_retry_not_available'},
    {status:result.meta?.changes?202:404,headers:{'Cache-Control':'no-store'}});
}
