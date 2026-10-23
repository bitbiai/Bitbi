import { json } from '../lib/response.js';
import { logDiagnostic } from '../../../../js/shared/worker-observability.mjs';
import { BODY_LIMITS,readJsonBodyOrResponse } from '../lib/request.js';
import { getSessionUser,requireUser,requireAdmin } from '../lib/session.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { getClientIp } from '../lib/rate-limit.js';
import { sha256Hex,nowIso } from '../lib/tokens.js';
import { validateConsumerDeclaration,declarationIdentity,findConsumerDeclaration,receiveConsumerDeclaration,consumerDeclarationView,ConsumerDeclarationError } from '../lib/consumer-declarations.js';
import { processTransactionalMessages } from '../lib/transactional-messages.js';
import { applyConsumerCancellation } from '../lib/consumer-cancellation.js';
import { readOwnedContractConfirmation,listOwnedContractConfirmations } from '../lib/consumer-contracts.js';

const response=(body,status=200)=>json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const limit=(ctx,scope,actor,maxRequests,windowMs)=>enforceSensitiveUserRateLimit(ctx,{scope,userId:actor,maxRequests,windowMs,component:'consumer-contracts'});
export async function handleConsumerDeclarations(ctx) {
  const {request,env,url,method}=ctx, pathname=url.pathname;
  if(pathname==='/api/consumer/declarations/config'&&method==='GET')return response({ok:true,requireTurnstile:false});
  if(pathname==='/api/account/billing/contracts'&&method==='GET') {
    const session=await requireUser(request,env);if(session instanceof Response)return session;
    const cursor=url.searchParams.get('cursor');
    if(cursor&&!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[A-Za-z0-9_-]{1,100}$/.test(cursor))return response({ok:false,code:'contract_cursor_invalid'},400);
    return response({ok:true,...await listOwnedContractConfirmations(env,{userId:session.user.id,cursor})});
  }
  const documentMatch=pathname.match(/^\/api\/account\/billing\/contracts\/([A-Za-z0-9_-]{1,100})$/);
  if(documentMatch&&method==='GET') {
    const session=await requireUser(request,env);if(session instanceof Response)return session;
    const document=await readOwnedContractConfirmation(env,{checkoutId:documentMatch[1],userId:session.user.id});
    return document?response({ok:true,...document}):response({ok:false,code:'contract_confirmation_not_found'},404);
  }
  if(pathname!=='/api/consumer/declarations'||method!=='POST')return null;
  // route-policy: consumer.declarations.create
  const limited=await limit(ctx,'consumer-declaration-ip',getClientIp(request),20,60*60_000);if(limited)return limited;
  const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
  try {
    const value=validateConsumerDeclaration(parsed.body),identity=await declarationIdentity(value);
    const existing=await findConsumerDeclaration(env,identity);
    if(existing)return response(await consumerDeclarationView(env,existing));
    // Email keys are hashed; no address or order existence is disclosed to public callers.
    const mailLimited=await limit(ctx,'consumer-declaration-contact',await sha256Hex(value.email),5,24*60*60_000);if(mailLimited)return mailLimited;
    const session=await getSessionUser(request,env);
    const {row,reused}=await receiveConsumerDeclaration(env,value,{userId:session?.user?.status==='active'?session.user.id:null});
    // Receiving the declaration is independent of an email outage. Cron owns recovery.
    if(ctx.execCtx?.waitUntil)ctx.execCtx.waitUntil(processTransactionalMessages(env,{limit:2}).catch(()=>logDiagnostic({service:'bitbi-auth',component:'consumer-mail',event:'consumer_mail_wake_failed',level:'error',code:'consumer_mail_wake_failed',correlationId:ctx.correlationId})));
    return response(await consumerDeclarationView(env,row),reused?200:201);
  } catch(error) {
    if(error instanceof ConsumerDeclarationError)return response({ok:false,code:error.code},error.status);
    return response({ok:false,code:'consumer_receipt_unconfirmed',diagnostic:ctx.correlationId},503);
  }
}

export async function handleAdminConsumerDeclarations(ctx) {
  const {request,env,url,method}=ctx;
  const match=url.pathname.match(/^\/api\/admin\/billing\/consumer-declarations(?:\/(cd_[a-f0-9]{32})\/(review|subscription))?$/);
  if(!match)return null;
  const session=await requireAdmin(request,env,{isSecure:ctx.isSecure,correlationId:ctx.correlationId});if(session instanceof Response)return session;
  const limited=await limit(ctx,'admin-consumer-declarations',session.user.id,100,15*60_000);if(limited)return limited;
  if(!match[1]&&method==='GET') {
    const state=url.searchParams.get('state')||'open';
    if(!['open','closed'].includes(state))return response({ok:false,code:'consumer_filter_invalid'},400);
    const cursor=url.searchParams.get('cursor');
    if(cursor&&!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_cd_[a-f0-9]{32}$/.test(cursor))return response({ok:false,code:'consumer_cursor_invalid'},400);
    const boundary=cursor?.indexOf('_'),before=cursor?cursor.slice(0,boundary):'9999-12-31T23:59:59.999Z',beforeId=cursor?cursor.slice(boundary+1):'zz';
    const rows=await env.DB.prepare(`SELECT d.*,m.state AS acknowledgement_state,m.error_code AS acknowledgement_error
      FROM consumer_declarations d LEFT JOIN transactional_messages m ON m.source_id=d.id AND m.kind IN ('withdrawal_acknowledgement','cancellation_acknowledgement')
      WHERE d.state ${state==='open'?"IN ('received','in_review')":"='closed'"} AND (d.received_at<? OR (d.received_at=? AND d.id<?))
      ORDER BY d.received_at DESC,d.id DESC LIMIT 51`).bind(before,before,beforeId).all();
    const items=(rows.results||[]).slice(0,50);
    const mailFailures=await env.DB.prepare(`SELECT id,source_id,kind,state,error_code,created_at FROM transactional_messages
      WHERE state IN ('review_required','bounced') OR (state='accepted' AND next_attempt_at IS NULL AND error_code IS NOT NULL)
      ORDER BY created_at DESC LIMIT 20`).all();
    const observedAt=nowIso(),summary=await env.DB.prepare(`SELECT COUNT(*) AS openCount,COALESCE(SUM(CASE WHEN review_due_at<=? THEN 1 ELSE 0 END),0) AS overdueCount
      FROM consumer_declarations WHERE state IN ('received','in_review')`).bind(observedAt).first();
    return response({ok:true,items,nextCursor:rows.results?.length>50?`${items.at(-1).received_at}_${items.at(-1).id}`:null,summary,mailFailures:mailFailures.results||[],observedAt});
  }
  // route-policy: admin.consumer.declarations.subscription
  if(match[1]&&match[2]==='subscription'&&method==='POST') {
    const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    try { return response({ok:true,...await applyConsumerCancellation(env,{declarationId:match[1],actorId:session.user.id,input:parsed.body})}); }
    catch(error) {return response({ok:false,code:/^[a-z][a-z0-9_]{2,100}$/.test(error.code||'')?error.code:'consumer_cancellation_review_unavailable'},Number.isInteger(error.status)?error.status:503);}
  }
  // route-policy: admin.consumer.declarations.review
  if(match[1]&&match[2]==='review'&&method==='POST') {
    const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    const body=parsed.body||{};
    if(Object.keys(body).some(k=>!['requestId','expectedRevision','state','note'].includes(k))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0
      ||!['in_review','closed'].includes(body.state)||typeof body.note!=='string'||!body.note.trim()||body.note.length>1500||/[<>\u0000-\u001f]/u.test(body.note)
      ||!/^[a-f0-9-]{36}$/i.test(body.requestId||''))return response({ok:false,code:'consumer_review_invalid'},400);
    const fingerprint=await sha256Hex(JSON.stringify({declarationId:match[1],...body,note:body.note.trim()})),now=nowIso(),key=await sha256Hex(`consumer-review:${session.user.id}:${body.requestId}`);
    const prior=await env.DB.prepare('SELECT * FROM consumer_declaration_reviews WHERE id=?').bind(key).first();
    if(prior)return prior.declaration_id===match[1]&&prior.input_hash===fingerprint?response({ok:true,reused:true}):response({ok:false,code:'consumer_request_conflict'},409);
    if(body.state==='closed') {
      const current=await env.DB.prepare('SELECT provider_state FROM consumer_declarations WHERE id=?').bind(match[1]).first();
      if(current&&['dispatching','unknown'].includes(current.provider_state))return response({ok:false,code:'consumer_cancellation_outcome_requires_reconciliation'},409);
    }
    // Review does not assert a refund or provider cancellation and cannot alter receipt time.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO consumer_declaration_reviews(id,declaration_id,actor_id,expected_revision,action,input_hash,note,created_at)
        SELECT ?,id,?,?,?,?,?,? FROM consumer_declarations WHERE id=? AND revision=? AND (?!='closed' OR provider_state NOT IN ('dispatching','unknown'))`)
        .bind(key,session.user.id,body.expectedRevision,body.state,fingerprint,body.note.trim(),now,match[1],body.expectedRevision,body.state),
      env.DB.prepare(`UPDATE consumer_declarations SET state=?,revision=revision+1,reviewed_by=?,reviewed_at=?,review_note=?,updated_at=?
        WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM consumer_declaration_reviews WHERE id=?)`)
        .bind(body.state,session.user.id,now,body.note.trim(),now,match[1],body.expectedRevision,key),
    ]);
    return result[0]?.meta?.changes===1?response({ok:true,reused:false}):response({ok:false,code:'consumer_review_conflict'},409);
  }
  return response({ok:false,code:'method_not_allowed'},405);
}
