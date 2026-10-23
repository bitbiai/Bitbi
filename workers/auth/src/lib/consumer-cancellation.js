import { getActiveMemberSubscription } from './billing.js';
import { cancelStripeLiveMemberSubscriptionAtPeriodEnd, reconcileStripeLiveMemberSubscriptionCancellation } from './stripe-billing.js';
import { nowIso,sha256Hex } from './tokens.js';
import { ConsumerDeclarationError } from './consumer-declarations.js';

const error=(code,status=409)=>{throw new ConsumerDeclarationError(code,status);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);

// Only a verified operator association can turn an anonymous declaration into a
// subscription change. The public receipt remains evidence, never authority.
export async function applyConsumerCancellation(env,{declarationId,actorId,input}) {
  if(!input||Object.keys(input).some(k=>!['requestId','expectedRevision','userId','providerSubscriptionId','identityVerified','note'].includes(k))
    ||!id(input.userId)||!/^sub_[A-Za-z0-9_:-]{8,200}$/.test(input.providerSubscriptionId||'')
    ||input.identityVerified!==true||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
    ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId||'')
    ||typeof input.note!=='string'||!input.note.trim()||input.note.length>1500||/[<>\u0000-\u001f]/u.test(input.note))error('consumer_cancellation_review_invalid',400);
  let row=await env.DB.prepare('SELECT * FROM consumer_declarations WHERE id=?').bind(declarationId).first();
  if(!row)error('consumer_declaration_not_found',404);
  const reviewId=await sha256Hex(`consumer-cancel:${actorId}:${input.requestId}`),fingerprint=await sha256Hex(JSON.stringify({declarationId,...input}));
  const prior=await env.DB.prepare('SELECT declaration_id,input_hash FROM consumer_declaration_reviews WHERE id=?').bind(reviewId).first();
  if(prior&&(prior.declaration_id!==declarationId||prior.input_hash!==fingerprint))error('consumer_request_conflict');
  const declaration=JSON.parse(row.declaration_json);
  if(row.kind!=='cancellation'||declaration.cancellationType!=='ordinary')error('consumer_cancellation_requires_individual_review');
  if(row.user_id&&row.user_id!==input.userId)error('consumer_cancellation_owner_conflict');
  const existing=row.provider_result_json?JSON.parse(row.provider_result_json):null;
  if(existing&&(existing.subscriptionId!==input.providerSubscriptionId||existing.userId!==input.userId))error('consumer_cancellation_target_conflict');
  if(row.provider_state==='applied')return {state:'applied',reused:true,result:existing};
  if(row.state==='closed')error('consumer_declaration_review_closed');
  let operation=existing;
  if(row.provider_state==='not_requested') {
    // New mutations need a currently eligible contract. Previously accepted
    // operations reconcile their original identity even after a terminal webhook.
    const subscription=await getActiveMemberSubscription(env,input.userId);
    if(subscription?.providerSubscriptionId!==input.providerSubscriptionId)error('consumer_cancellation_subscription_changed');
    if(declaration.endRequest==='date'&&declaration.requestedEndDate!==subscription.currentPeriodEnd?.slice(0,10))error('consumer_cancellation_date_requires_review');
    if(row.revision!==input.expectedRevision)error('consumer_review_conflict');
    const now=nowIso();
    operation={requestId:input.requestId,subscriptionId:input.providerSubscriptionId,userId:input.userId,requestedAt:now};
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO consumer_declaration_reviews(id,declaration_id,actor_id,expected_revision,action,input_hash,note,created_at)
        SELECT ?,id,?,?,?,?,?,? FROM consumer_declarations WHERE id=? AND revision=? AND provider_state='not_requested'`)
        .bind(reviewId,actorId,input.expectedRevision,'cancel_period_end',fingerprint,input.note.trim(),now,declarationId,input.expectedRevision),
      env.DB.prepare(`UPDATE consumer_declarations SET provider_state='dispatching',provider_result_json=?,verified_user_id=?,state='in_review',revision=revision+1,
        reviewed_by=?,reviewed_at=?,review_note=?,updated_at=? WHERE id=? AND revision=? AND provider_state='not_requested'
        AND EXISTS(SELECT 1 FROM consumer_declaration_reviews WHERE id=?)`)
        .bind(JSON.stringify(operation),input.userId,actorId,now,input.note.trim(),now,declarationId,input.expectedRevision,reviewId),
    ]);
    if(results[1]?.meta?.changes!==1)error('consumer_review_conflict');
    try {
      const result=await cancelStripeLiveMemberSubscriptionAtPeriodEnd({env,userId:input.userId,
        expectedProviderSubscriptionId:input.providerSubscriptionId,idempotencyKey:`consumer-${declarationId}`,locale:row.locale});
      return await recordOutcome(env,row,operation,result);
    } catch(error) {
      await env.DB.prepare(`UPDATE consumer_declarations SET provider_state='unknown',updated_at=? WHERE id=? AND provider_state='dispatching'`)
        .bind(nowIso(),declarationId).run();
      return {state:'unknown',code:'consumer_cancellation_outcome_requires_reconciliation'};
    }
  }
  // Never issue another POST after an ambiguous result, including a crash after
  // dispatch intent. Reconcile the exact original provider subscription by GET.
  if(!operation||!['dispatching','unknown','not_applied'].includes(row.provider_state))error('consumer_cancellation_state_invalid');
  if(row.provider_state==='dispatching'&&Date.now()-Date.parse(operation.requestedAt)<60_000)return {state:'dispatching'};
  const result=await reconcileStripeLiveMemberSubscriptionCancellation({env,userId:operation.userId,expectedProviderSubscriptionId:operation.subscriptionId,
    idempotencyKey:`consumer-${declarationId}`,locale:row.locale});
  return recordOutcome(env,row,operation,result);
}

async function recordOutcome(env,row,operation,result) {
  const subscription=result.subscription;
  if(subscription?.providerSubscriptionId!==operation.subscriptionId)error('consumer_cancellation_result_mismatch');
  const applied=typeof result.cancellationConfirmed==='boolean'?result.cancellationConfirmed:subscription.cancelAtPeriodEnd===true||subscription.status==='canceled';
  const effectiveEnd=applied?(subscription.status==='canceled'?result.effectiveEnd||null:subscription.currentPeriodEnd):null;
  const state=applied?'applied':'not_applied',document={...operation,confirmedAt:nowIso(),effectiveEnd,
    cancelAtPeriodEnd:subscription.cancelAtPeriodEnd,status:subscription.status};
  const saved=await env.DB.prepare(`UPDATE consumer_declarations SET provider_state=?,provider_result_json=?,updated_at=?
    WHERE id=? AND verified_user_id=? AND json_extract(provider_result_json,'$.subscriptionId')=? AND provider_state IN ('dispatching','unknown','not_applied')`)
    .bind(state,JSON.stringify(document),nowIso(),row.id,operation.userId,operation.subscriptionId).run();
  if(saved.meta?.changes!==1) {
    const current=await env.DB.prepare('SELECT provider_state,provider_result_json FROM consumer_declarations WHERE id=?').bind(row.id).first();
    if(current?.provider_state==='applied')return {state:'applied',reused:true,result:JSON.parse(current.provider_result_json)};
    error('consumer_cancellation_projection_conflict');
  }
  return {state,result:document};
}
