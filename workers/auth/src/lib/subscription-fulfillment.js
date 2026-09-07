import { BillingError, prepareAtomicSubscriptionPeriod, getMemberCreditBucketBalances, serializeMemberSubscriptionRow } from './billing.js';
import { getBillingProviderEvent } from './billing-events.js';
import { nowIso, randomTokenHex } from './tokens.js';
import { BITBI_MEMBER_SUBSCRIPTION } from '../../../../js/shared/member-subscription.mjs';

const error = (message, code, status = 409) => new BillingError(message, { code, status });
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const trim = value => typeof value === 'string' && value.trim() ? value.trim() : null;

async function resolveContext(env, input, payload) {
  if (payload.account || payload.context) throw error('Connected-account subscription events are not configured.', 'subscription_account_unsupported', 403);
  if (!/^cus_[A-Za-z0-9_:-]{1,200}$/.test(input.customer || '')) throw error('Stripe subscription customer is missing or invalid.', 'subscription_customer_invalid', 400);
  const existing = await env.DB.prepare("SELECT * FROM billing_member_subscriptions WHERE provider = 'stripe' AND provider_mode = 'live' AND provider_subscription_id = ?").bind(input.subscriptionId).first();
  const checkoutId = trim(input.internalCheckoutSessionId || input.metadata?.internal_checkout_session_id);
  let checkout = checkoutId
    ? await env.DB.prepare('SELECT * FROM billing_member_subscription_checkout_sessions WHERE id = ?').bind(checkoutId).first()
    : null;
  if (!checkout && existing) checkout = await env.DB.prepare("SELECT * FROM billing_member_subscription_checkout_sessions WHERE provider = 'stripe' AND provider_mode = 'live' AND provider_subscription_id = ? ORDER BY created_at LIMIT 1").bind(input.subscriptionId).first();
  // Existing bound subscriptions are a valid source for renewals; new metadata
  // alone is never authority to attach a payment to a user.
  const userId = existing?.user_id || checkout?.user_id;
  if (!userId || (!existing && !checkout)) throw error('Subscription has no recognized local purchase intent.', 'subscription_checkout_unrecognized', 403);
  if (input.userId && input.userId !== userId) throw error('Subscription owner mismatch.', 'subscription_owner_mismatch');
  if (existing && existing.provider_customer_id && existing.provider_customer_id !== input.customer) throw error('Subscription customer mismatch.', 'subscription_customer_mismatch');
  if (checkout && (checkout.provider !== 'stripe' || checkout.provider_mode !== 'live' || checkout.authorization_scope !== 'member'
    || checkout.user_id !== userId || checkout.plan_id !== BITBI_MEMBER_SUBSCRIPTION.id || checkout.provider_price_id !== input.priceId
    || Number(checkout.amount_cents) !== BITBI_MEMBER_SUBSCRIPTION.amountCents || checkout.currency !== BITBI_MEMBER_SUBSCRIPTION.currency
    || (checkout.provider_subscription_id && checkout.provider_subscription_id !== input.subscriptionId)
    || (checkout.provider_customer_id && checkout.provider_customer_id !== input.customer)
    || (input.sessionId && checkout.provider_checkout_session_id !== input.sessionId))) throw error('Subscription checkout identity conflicts.', 'stripe_checkout_session_mismatch');
  if (checkoutId && (!checkout || checkout.id !== checkoutId)) throw error('Subscription checkout metadata conflicts.', 'stripe_checkout_session_mismatch');
  const user = await env.DB.prepare('SELECT id,status FROM users WHERE id = ?').bind(userId).first();
  if (user?.status !== 'active') throw error('Subscription account is not active.', 'stripe_checkout_creator_inactive', 403);
  const organizationCustomer = await env.DB.prepare("SELECT id FROM billing_customers WHERE provider='stripe' AND provider_customer_ref=? LIMIT 1").bind(input.customer).first();
  if (organizationCustomer) throw error('Stripe customer belongs to an organization billing context.', 'subscription_customer_scope_mismatch');
  const customer = await env.DB.prepare("SELECT * FROM billing_member_customers WHERE provider = 'stripe' AND provider_mode = 'live' AND provider_customer_ref = ?").bind(input.customer).first();
  if (customer && customer.user_id !== userId) throw error('Stripe customer is already bound to another account.', 'subscription_customer_owner_mismatch');
  const other = await env.DB.prepare("SELECT id FROM billing_member_subscriptions WHERE provider = 'stripe' AND provider_mode = 'live' AND provider_customer_id = ? AND user_id <> ? LIMIT 1").bind(input.customer, userId).first();
  if (other) throw error('Legacy Stripe customer ownership is ambiguous.', 'subscription_customer_owner_mismatch');
  return { existing, checkout, userId, customerId: customer?.id || `bmc_${randomTokenHex(16)}` };
}

function desiredState(existing, input, payload, kind) {
  const defaults = { status: 'incomplete', current_period_start: null, current_period_end: null, cancel_at_period_end: 0, canceled_at: null };
  const old = existing || defaults;
  if (kind === 'checkout') return { ...old };
  const next = { status: input.status, current_period_start: input.currentPeriodStart || old.current_period_start,
    current_period_end: input.currentPeriodEnd || old.current_period_end, cancel_at_period_end: input.cancelAtPeriodEnd ? 1 : 0,
    canceled_at: input.canceledAt || old.canceled_at };
  if (old.status === 'canceled' || old.status === 'incomplete_expired') return { ...old };
  if (kind === 'invoice') {
    if (old.current_period_start && input.currentPeriodStart < old.current_period_start) return { ...old };
    return { ...next, status: 'active', cancel_at_period_end: old.cancel_at_period_end, canceled_at: old.canceled_at };
  }
  // Cancellation is terminal for this Stripe subscription identity.
  if (next.status === 'canceled') return next;
  if (!existing || (old.status === 'incomplete' && !parse(existing.metadata_json).state_evidence_kind)) return next;
  if (next.current_period_start && old.current_period_start && next.current_period_start < old.current_period_start) return { ...old };
  if (next.current_period_start && old.current_period_start && next.current_period_start > old.current_period_start) return next;
  const changed = ['status','cancel_at_period_end'].filter(key => next[key] !== old[key]);
  if (!changed.length) return next;
  // Stripe event.created is not a total order. A reversible same-period change
  // needs its actual previous attributes to match the locally observed state.
  const previous = payload.data?.previous_attributes || {};
  if (changed.every(key => Object.hasOwn(previous, key) && (key === 'cancel_at_period_end' ? Number(Boolean(previous[key])) : previous[key]) === old[key])) return next;
  if (payload.type === 'customer.subscription.created' && old.status !== 'incomplete') return { ...old };
  throw error('Subscription transition order is not established; reconcile the current provider state.', 'subscription_transition_unproven', 503);
}

export async function markMemberSubscriptionEventFailed(env, { eventId, actionType, errorCode, errorMessage }) {
  const now = nowIso();
  const unfinished = "NOT EXISTS (SELECT 1 FROM billing_member_subscription_operations WHERE event_id = ? AND state = 'completed')";
  await env.DB.batch([
    env.DB.prepare(`UPDATE billing_provider_events SET processing_status='failed',error_code=?,error_message=?,updated_at=?,last_processed_at=? WHERE id=? AND ${unfinished}`)
      .bind(errorCode,errorMessage,now,now,eventId,eventId),
    env.DB.prepare(`UPDATE billing_event_actions SET status='failed',dry_run=0,summary_json=?,updated_at=? WHERE event_id=? AND action_type=? AND ${unfinished}`)
      .bind(JSON.stringify({sideEffectsEnabled:true,creditGrantStatus:'failed',errorCode}),now,eventId,actionType,eventId),
  ]);
}

export async function applyMemberSubscriptionEvent({ env, stored, payload, input, kind }) {
  const context = await resolveContext(env, input, payload);
  const { userId, customerId, existing, checkout } = context;
  const operation = await env.DB.prepare('SELECT * FROM billing_member_subscription_operations WHERE event_id = ?').bind(stored.event.id).first();
  if (operation?.state === 'completed') return result(env, stored, input, operation, true);
  let priorPeriod = null;
  if (kind === 'invoice') {
    priorPeriod = await env.DB.prepare('SELECT * FROM billing_member_subscription_periods WHERE provider_subscription_id = ? AND period_start = ?').bind(input.subscriptionId,input.currentPeriodStart).first();
    if (!priorPeriod) {
      const legacyBucket = await env.DB.prepare("SELECT id FROM member_credit_buckets WHERE user_id=? AND bucket_type='subscription' AND provider_subscription_id=? AND period_start=?")
        .bind(userId,input.subscriptionId,input.currentPeriodStart).first();
      const legacyGrant = await env.DB.prepare("SELECT id FROM member_credit_ledger WHERE user_id=? AND source='subscription_period_top_up' AND amount>0 AND json_extract(metadata_json,'$.bucket_scope.providerSubscriptionId')=? AND json_extract(metadata_json,'$.bucket_scope.periodStart')=? AND json_extract(metadata_json,'$.bucket_scope.periodEnd')=? LIMIT 1")
        .bind(userId,input.subscriptionId,input.currentPeriodStart,input.currentPeriodEnd).first();
      if (legacyBucket && !legacyGrant) throw error('Existing subscription period has no conclusive retained fulfillment proof; reconcile it before replay.', 'subscription_legacy_period_unproven');
    }
    const sameInvoice = await env.DB.prepare('SELECT * FROM billing_member_subscription_periods WHERE provider_invoice_id = ?').bind(input.invoiceId).first();
    if ((priorPeriod && (priorPeriod.user_id !== userId || priorPeriod.period_end !== input.currentPeriodEnd))
      || (sameInvoice && (sameInvoice.provider_subscription_id !== input.subscriptionId || sameInvoice.period_start !== input.currentPeriodStart || sameInvoice.period_end !== input.currentPeriodEnd))) {
      throw error('Subscription invoice or period identity conflicts.', 'subscription_period_conflict');
    }
  }
  const desired = kind === 'invoice' && priorPeriod && existing ? { ...existing } : desiredState(existing, input, payload, kind);
  const now = nowIso(), token = randomTokenHex(24), subscriptionId = existing?.id || `msub_${randomTokenHex(16)}`;
  const statements = [], add = (sql,...args) => statements.push(env.DB.prepare(sql).bind(...args));
  const owns = "EXISTS (SELECT 1 FROM billing_member_subscription_operations WHERE event_id = ? AND mutation_token = ? AND state = 'started')";
  const own = [stored.event.id, token];
  add(`INSERT INTO billing_member_customers (id,user_id,provider,provider_mode,provider_customer_ref,created_at)
    VALUES (?,?,'stripe','live',?,?) ON CONFLICT(provider,provider_mode,provider_customer_ref) DO NOTHING`, customerId,userId,input.customer,now);
  add(`INSERT INTO billing_member_subscription_operations
    (event_id,user_id,member_customer_id,provider_subscription_id,mutation_token,state,created_at)
    SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')
      AND NOT EXISTS (SELECT 1 FROM billing_member_subscriptions WHERE provider_subscription_id = ? AND (user_id <> ? OR (provider_customer_id IS NOT NULL AND provider_customer_id <> ?)))
      THEN ? ELSE NULL END,
      (SELECT id FROM billing_member_customers WHERE provider = 'stripe' AND provider_mode = 'live' AND provider_customer_ref = ? AND user_id = ?), ?,?,'started',?
    ON CONFLICT(event_id) DO NOTHING`, stored.event.id,userId,input.subscriptionId,userId,input.customer,userId,input.customer,userId,input.subscriptionId,token,now);
  const prior = existing || { status: 'incomplete', current_period_start: null, current_period_end: null, cancel_at_period_end: 0, canceled_at: null };
  add(`INSERT INTO billing_member_subscriptions
    (id,user_id,provider,provider_mode,provider_customer_id,provider_subscription_id,provider_price_id,status,current_period_start,current_period_end,cancel_at_period_end,canceled_at,metadata_json,created_at,updated_at)
    SELECT ?,?,'stripe','live',?,?,?,?,?,?,?,?,?,?,? WHERE ${owns}
    ON CONFLICT(provider,provider_mode,provider_subscription_id) DO UPDATE SET
      provider_customer_id=excluded.provider_customer_id, provider_price_id=excluded.provider_price_id,
      status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,canceled_at=excluded.canceled_at,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    WHERE billing_member_subscriptions.user_id = ? AND billing_member_subscriptions.status = ?
      AND billing_member_subscriptions.current_period_start IS ? AND billing_member_subscriptions.current_period_end IS ?
      AND billing_member_subscriptions.cancel_at_period_end = ? AND billing_member_subscriptions.canceled_at IS ?`,
    subscriptionId,userId,input.customer,input.subscriptionId,input.priceId,desired.status,desired.current_period_start,desired.current_period_end,desired.cancel_at_period_end,desired.canceled_at,
    JSON.stringify({ ...parse(existing?.metadata_json), source_event_type: payload.type, provider_event_id: stored.event.providerEventId, state_evidence_kind: kind === 'checkout' ? parse(existing?.metadata_json).state_evidence_kind || null : kind }),existing?.created_at || now,now,...own,
    userId,prior.status,prior.current_period_start,prior.current_period_end,prior.cancel_at_period_end,prior.canceled_at);
  // NOT NULL token guard makes a lost CAS roll back the entire operation.
  add(`UPDATE billing_member_subscription_operations SET mutation_token = CASE WHEN EXISTS (
      SELECT 1 FROM billing_member_subscriptions WHERE provider_subscription_id = ? AND user_id = ? AND provider_customer_id = ?
      AND status = ? AND current_period_start IS ? AND current_period_end IS ? AND cancel_at_period_end = ? AND canceled_at IS ?)
      THEN mutation_token ELSE NULL END,
      local_subscription_id = (SELECT id FROM billing_member_subscriptions WHERE provider_subscription_id = ? AND user_id = ?)
    WHERE event_id = ? AND mutation_token = ? AND state = 'started'`,input.subscriptionId,userId,input.customer,desired.status,desired.current_period_start,desired.current_period_end,desired.cancel_at_period_end,desired.canceled_at,input.subscriptionId,userId,...own);
  if (checkout) {
    add(`UPDATE billing_member_subscription_checkout_sessions SET provider_subscription_id = ?, provider_customer_id = ?,
      status = CASE WHEN ? = 'checkout' THEN 'completed' ELSE status END,
      payment_status = CASE WHEN ? = 'checkout' THEN ? ELSE payment_status END,
      billing_event_id = CASE WHEN ? = 'checkout' THEN ? ELSE billing_event_id END,
      completed_at = CASE WHEN ? = 'checkout' THEN COALESCE(completed_at, ?) ELSE completed_at END,
      updated_at = ? WHERE id = ? AND user_id = ? AND provider = 'stripe' AND provider_mode = 'live'
      AND (provider_subscription_id IS NULL OR provider_subscription_id = ?)
      AND (provider_customer_id IS NULL OR provider_customer_id = ?) AND ${owns}`,
      input.subscriptionId,input.customer,kind,kind,input.paymentStatus || null,kind,stored.event.id,kind,now,now,checkout.id,userId,input.subscriptionId,input.customer,...own);
    add(`UPDATE billing_member_subscription_operations SET mutation_token = CASE WHEN EXISTS (
      SELECT 1 FROM billing_member_subscription_checkout_sessions WHERE id = ? AND user_id = ? AND provider_subscription_id = ? AND provider_customer_id = ?
      AND provider='stripe' AND provider_mode='live' AND plan_id='bitbi_pro_monthly' AND provider_price_id = ? AND authorization_scope = 'member' AND amount_cents = ? AND currency = ?)
      THEN mutation_token ELSE NULL END WHERE event_id = ? AND mutation_token = ? AND state = 'started'`,
      checkout.id,userId,input.subscriptionId,input.customer,input.priceId,BITBI_MEMBER_SUBSCRIPTION.amountCents,BITBI_MEMBER_SUBSCRIPTION.currency,...own);
  }
  if (kind === 'invoice') statements.push(...await prepareAtomicSubscriptionPeriod({ env, userId, input, eventId: stored.event.id, token, now }));
  const outcome = { kind, fulfillmentStatus: 'completed', providerSubscriptionId: input.subscriptionId, stripeInvoiceId: input.invoiceId || null };
  add(`UPDATE billing_provider_events SET processing_status='planned', user_id=?, billing_customer_id=NULL,
    member_billing_customer_id=(SELECT id FROM billing_member_customers WHERE provider='stripe' AND provider_mode='live' AND provider_customer_ref=? AND user_id=?),
    error_code=NULL,error_message=NULL,last_processed_at=?,updated_at=? WHERE id=? AND ${owns}`,userId,input.customer,userId,now,now,stored.event.id,...own);
  add(`INSERT INTO billing_event_actions (id,event_id,action_type,status,dry_run,summary_json,created_at,updated_at)
    SELECT ?,?,?,'planned',0,json_patch(?,json_object('subscriptionStatus',?,
      'creditGrantStatus',CASE WHEN ? <> 'invoice' THEN 'not_applicable'
        WHEN EXISTS(SELECT 1 FROM billing_member_subscription_periods WHERE provider_subscription_id=? AND period_start=? AND mutation_token=? AND granted_credits>0) THEN 'granted'
        WHEN EXISTS(SELECT 1 FROM billing_member_subscription_periods WHERE provider_subscription_id=? AND period_start=? AND mutation_token=?) THEN 'already_full' ELSE 'already_granted' END,
      'creditsGranted',COALESCE((SELECT granted_credits FROM billing_member_subscription_periods WHERE provider_subscription_id=? AND period_start=? AND mutation_token=?),0),
      'allowance',?, 'subscriptionCredits',COALESCE((SELECT SUM(balance) FROM member_credit_buckets WHERE user_id=? AND bucket_type='subscription' AND period_end>?),0))),?,? WHERE ${owns}
    ON CONFLICT(event_id,action_type) DO UPDATE SET status='planned',dry_run=0,summary_json=excluded.summary_json,updated_at=excluded.updated_at`,
    `bea_${randomTokenHex(16)}`,stored.event.id,payload.type,JSON.stringify({ ...outcome, sideEffectsEnabled: true, liveBillingEnabled: true }),desired.status,kind,
    input.subscriptionId,input.currentPeriodStart || null,token,input.subscriptionId,input.currentPeriodStart || null,token,input.subscriptionId,input.currentPeriodStart || null,token,
    kind === 'invoice' ? BITBI_MEMBER_SUBSCRIPTION.allowanceCredits : null,userId,now,now,now,...own);
  add(`UPDATE billing_member_subscription_operations SET state='completed',outcome_json=?,completed_at=? WHERE event_id=? AND mutation_token=? AND state='started'`,JSON.stringify(outcome),now,...own);
  await env.DB.batch(statements);
  const completed = await env.DB.prepare('SELECT * FROM billing_member_subscription_operations WHERE event_id = ?').bind(stored.event.id).first();
  if (completed?.state !== 'completed') throw error('Subscription fulfillment was not confirmed.', 'subscription_fulfillment_unconfirmed', 503);
  return result(env, stored, input, completed, completed.mutation_token !== token);
}

async function result(env, stored, input, operation, reused) {
  const outcome = parse(operation.outcome_json);
  const subscription = await env.DB.prepare('SELECT * FROM billing_member_subscriptions WHERE id = ?').bind(operation.local_subscription_id).first();
  let creditGrant = null;
  if (outcome.kind === 'invoice') {
    const period = await env.DB.prepare('SELECT * FROM billing_member_subscription_periods WHERE provider_subscription_id = ? AND period_start = ?').bind(input.subscriptionId,input.currentPeriodStart).first();
    const balances = await getMemberCreditBucketBalances(env, operation.user_id);
    creditGrant = { checkoutScope: 'member_subscription', userId: operation.user_id,
      creditsGranted: !reused && period?.mutation_token === operation.mutation_token ? period.granted_credits : 0,
      balanceAfter: balances.totalCredits, subscriptionCredits: balances.subscriptionCredits,
      reused: reused || period?.mutation_token !== operation.mutation_token };
  }
  return { event: await getBillingProviderEvent(env,{id:stored.event.id,includeArchived:true}), duplicate: stored.duplicate, actionPlanned:true,
    creditGrant, checkout: null, subscription: serializeMemberSubscriptionRow(subscription) };
}
