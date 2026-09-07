const { test, expect } = require('@playwright/test');
const { withSubscription, state, sessionEvent, invoiceEvent } = require('./helpers/q4-subscription-fixture.js');

test('Q4 subscription signed HTTP checkout records a member customer without violating the organization customer FK', async () => withSubscription(async f => {
  const response = await f.deliver(sessionEvent());
  expect(response.status).toBe(202);
  const s = state(f);
  expect(s.checkouts[0].status).toBe('completed');
  expect(s.ledger).toHaveLength(0);
  expect(s.events[0].billing_customer_id).toBeNull();
  expect(s.subscriptions[0].status).toBe('incomplete');
}));

test('Q4 subscription signed paid invoice fulfills once and duplicate receipt is not a second grant', async () => withSubscription(async f => {
  const response = await f.deliver(invoiceEvent());
  expect(response.status).toBe(202);
  const s = state(f);
  expect(s.ledger).toHaveLength(1);
  expect(s.ledger[0].amount).toBe(6000);
  expect(s.ledger[0].balance_after).toBe(6000);
  expect(s.buckets.find(b => b.bucket_type === 'subscription').balance).toBe(6000);
  expect(s.bucketEvents).toHaveLength(1);
  const replay = await f.deliver(invoiceEvent());
  expect(replay.status).toBe(200);
  expect(state(f).ledger).toHaveLength(1);
}));

const { MEMBER, OTHER, PRICE, START, END, checkout, lifecycleEvent, load } = require('./helpers/q4-subscription-fixture.js');
function assertOneAllowance(f, expected = 6000) {
  const s = state(f);
  expect(s.ledger.filter(l => l.source === 'subscription_period_top_up')).toHaveLength(1);
  expect(s.ledger.filter(l => l.source === 'subscription_period_top_up')[0].amount).toBe(expected);
  expect(s.bucketEvents.filter(b => b.source === 'subscription_period_top_up')).toHaveLength(1);
  expect(s.events.every(e => e.billing_customer_id === null)).toBe(true);
  expect(s.actions.filter(a => a.dry_run === 0 && a.status === 'planned').every(a => JSON.parse(a.summary_json).fulfillmentStatus === 'completed')).toBe(true);
  return s;
}
function failure(f, stage) {
  const at = {
    customer: 'BEFORE INSERT ON billing_member_customers',
    subscription: 'BEFORE INSERT ON billing_member_subscriptions',
    period: 'BEFORE INSERT ON billing_member_subscription_periods',
    ledger: 'BEFORE INSERT ON member_credit_ledger',
    bucket: "BEFORE UPDATE ON member_credit_buckets WHEN NEW.bucket_type = 'subscription'",
    checkout: 'BEFORE UPDATE ON billing_member_subscription_checkout_sessions',
    event: 'BEFORE UPDATE ON billing_provider_events WHEN NEW.member_billing_customer_id IS NOT NULL',
    action: "BEFORE UPDATE ON billing_event_actions WHEN NEW.dry_run = 0 AND NEW.status = 'planned'",
    completion: "BEFORE UPDATE ON billing_member_subscription_operations WHEN NEW.state = 'completed'",
  }[stage];
  f.db.exec(`CREATE TEMP TRIGGER q4_subscription_failure ${at} BEGIN SELECT RAISE(ABORT,'synthetic subscription failure'); END`);
  return () => f.db.exec('DROP TRIGGER q4_subscription_failure');
}
for (const stage of ['customer','subscription','period','ledger','bucket','checkout','event','action','completion']) {
  test(`Q4 subscription ${stage} failure rolls back fulfillment and identical signed receipt resumes`, async () => withSubscription(async f => {
    const remove = failure(f,stage);
    expect((await f.deliver(invoiceEvent())).status).toBe(503);
    const failed = state(f);
    expect(failed.ledger).toHaveLength(0); expect(failed.buckets).toHaveLength(0); expect(failed.subscriptions).toHaveLength(0);
    expect(failed.checkouts[0].provider_subscription_id).toBeNull();
    expect(f.db.database.prepare('SELECT * FROM billing_member_subscription_operations').all()).toHaveLength(0);
    expect(f.db.database.prepare('SELECT * FROM billing_member_customers').all()).toHaveLength(0);
    remove();
    const replay = await f.deliver(invoiceEvent());
    expect(replay.status).toBe(200); expect(replay.body.creditGrant.creditsGranted).toBe(6000);
    assertOneAllowance(f);
  }));
}
test('Q4 subscription receipt survives initial action insert failure and resumes real fulfillment', async () => withSubscription(async f => {
  f.db.exec("CREATE TEMP TRIGGER q4_action_receipt_failure BEFORE INSERT ON billing_event_actions WHEN NEW.dry_run=1 BEGIN SELECT RAISE(ABORT,'synthetic receipt-action failure'); END");
  const failure = await f.deliver(invoiceEvent());
  expect(failure.status).toBe(500); expect(failure.body.code).toBe('billing_webhook_unexpected_error');
  expect(state(f).events).toHaveLength(1); expect(state(f).actions).toHaveLength(0); expect(state(f).ledger).toHaveLength(0);
  f.db.exec('DROP TRIGGER q4_action_receipt_failure');
  expect((await f.deliver(invoiceEvent())).status).toBe(200); assertOneAllowance(f);
}));
test('Q4 subscription lost batch acknowledgement retains proof and retry cannot repeat the allowance', async () => withSubscription(async f => {
  const original = f.db.batch.bind(f.db); let lost = false;
  f.db.batch = async statements => { const result = await original(statements); if (!lost && statements.some(s => s.sql.includes("SET state='completed'"))) { lost=true; throw new Error('Synthetic acknowledgement lost after committed fulfillment'); } return result; };
  expect((await f.deliver(invoiceEvent())).status).toBe(503);
  assertOneAllowance(f);
  const replay = await f.deliver(invoiceEvent()); expect(replay.status).toBe(200); expect(replay.body.creditGrant.creditsGranted).toBe(0);
  assertOneAllowance(f);
}));
for (const sameEvent of [true,false]) test(`Q4 subscription concurrent ${sameEvent ? 'same event' : 'different invoice events'} grants one period`, async () => withSubscription(async f => {
  const original=f.db.batch.bind(f.db); let count=0; let release; const held=new Promise(r => {release=r;});
  f.db.batch=async statements => { if (statements.some(s => s.sql.includes('INSERT INTO billing_member_subscription_operations')) && ++count <= 2) { if(count===2)release(); await held; } return original(statements); };
  const responses=await Promise.all([f.deliver(invoiceEvent()),f.deliver(invoiceEvent(sameEvent ? undefined : 'evt_q4_second_invoice_event'))]);
  expect(responses.every(r => r.status === 200 || r.status === 202)).toBe(true);
  expect(responses.reduce((n,r) => n+r.body.creditGrant.creditsGranted,0)).toBe(6000); assertOneAllowance(f);
}));
test('Q4 subscription a different invoice for the same consumed period cannot refill it; next period can', async () => withSubscription(async f => {
  expect((await f.deliver(invoiceEvent())).status).toBe(202);
  const billing=await load('workers/auth/src/lib/billing.js');
  await billing.consumeMemberCredits({ env:f.env,userId:MEMBER,featureKey:'ai.image.generate',credits:1000,idempotencyKey:'q4-consume-period',source:'synthetic_q4_usage' });
  const second=await f.deliver(invoiceEvent('evt_q4_other_invoice',{invoice:'in_q4_other_invoice'}));
  expect(second.status).toBe(202); expect(second.body.creditGrant).toMatchObject({creditsGranted:0,subscriptionCredits:5000,reused:true});
  expect(state(f).ledger.filter(l => l.source==='subscription_period_top_up')).toHaveLength(1);
  const renewal=await f.deliver(invoiceEvent('evt_q4_renewal',{invoice:'in_q4_renewal',start:END,end:END+31*86400}));
  expect(renewal.status).toBe(202); expect(renewal.body.creditGrant.creditsGranted).toBe(6000);
  expect(state(f).ledger.filter(l => l.source==='subscription_period_top_up')).toHaveLength(2);
}));
test('Q4 subscription invoice before lifecycle and delayed checkout keep active period and exact customer', async () => withSubscription(async f => {
  expect((await f.deliver(invoiceEvent())).status).toBe(202);
  expect((await f.deliver(lifecycleEvent())).status).toBe(202);
  expect((await f.deliver(sessionEvent())).status).toBe(202);
  const s=assertOneAllowance(f); expect(s.subscriptions[0].status).toBe('active'); expect(s.checkouts[0].status).toBe('completed');
  const customer=f.db.database.prepare('SELECT * FROM billing_member_customers').get();
  expect(customer.id).not.toBe(checkout.customer); expect(customer).toMatchObject({user_id:MEMBER,provider:'stripe',provider_mode:'live',provider_customer_ref:checkout.customer});
  expect(s.events.every(e => e.member_billing_customer_id===customer.id)).toBe(true);
}));
test('Q4 subscription delayed created/paid snapshots cannot resurrect a canceled identity', async () => withSubscription(async f => {
  expect((await f.deliver(lifecycleEvent('evt_q4_cancel',{type:'customer.subscription.deleted',status:'canceled'}))).status).toBe(202);
  expect((await f.deliver(lifecycleEvent())).status).toBe(202);
  expect((await f.deliver(invoiceEvent())).status).toBe(202);
  expect(state(f).subscriptions[0].status).toBe('canceled'); assertOneAllowance(f);
}));
for (const [name, change, status] of [
  ['wrong owner', p => {p.data.object.parent.subscription_details.metadata.user_id=OTHER;},409],
  ['unknown intent', p => {p.data.object.parent.subscription_details.metadata.internal_checkout_session_id='missing-local-intent';p.data.object.lines.data[0].metadata.internal_checkout_session_id='missing-local-intent';},403],
  ['missing customer', p => {p.data.object.customer=null;},400],
  ['wrong currency', p => {p.data.object.currency='usd';},409],
  ['wrong amount', p => {p.data.object.amount_paid=998;},409],
  ['unpaid status', p => {p.data.object.status='open';},400],
  ['test mode', p => {p.livemode=false;},403],
  ['connected account', p => {p.account='acct_other_installation';},403],
  ['proration', p => {p.data.object.lines.data[0].parent.subscription_item_details.proration=true;},409],
  ['partial lines', p => {p.data.object.lines.has_more=true;},409],
]) test(`Q4 subscription ${name} cannot grant`, async () => withSubscription(async f => {
  const p=invoiceEvent(); change(p); const r=await f.deliver(p); expect(r.status,JSON.stringify(r.body)).toBe(status);
  expect(state(f).ledger).toHaveLength(0); expect(state(f).subscriptions).toHaveLength(0);
}));
test('Q4 subscription wrong price remains ignored; invalid signature and payload replay cannot grant', async () => withSubscription(async f => {
  expect((await f.deliver(invoiceEvent(),{invalidSignature:true})).status).toBe(401); expect(state(f).events).toHaveLength(0);
  const bad=invoiceEvent(); bad.data.object.lines.data[0].pricing.price_details.price='price_unrelated';
  expect((await f.deliver(bad)).status).toBe(202); expect(state(f).ledger).toHaveLength(0);
  expect((await f.deliver(invoiceEvent())).status).toBe(409); expect(state(f).ledger).toHaveLength(0);
}));
test('Q4 subscription one customer cannot be reassigned to another valid member intent', async () => withSubscription(async f => {
  expect((await f.deliver(sessionEvent())).status).toBe(202);
  f.db.exec(`UPDATE billing_member_subscription_checkout_sessions SET provider_customer_id=NULL,provider_subscription_id=NULL,user_id='${OTHER}'`);
  const p=invoiceEvent(); p.data.object.parent.subscription_details.subscription='sub_q4_second_owner'; p.data.object.lines.data[0].parent.subscription_item_details.subscription='sub_q4_second_owner';
  p.data.object.parent.subscription_details.metadata.user_id=OTHER; p.data.object.lines.data[0].metadata.user_id=OTHER;
  expect((await f.deliver(p)).status).toBe(409); expect(state(f).ledger).toHaveLength(0);
}));
for (const shape of ['modern','legacy']) test(`Q4 subscription ${shape} automatic tax preserves the configured allowance`, async () => withSubscription(async f => {
  const p=invoiceEvent(); const invoice=p.data.object;
  invoice.amount_paid=1189; invoice.amount_due=1189; invoice.total=1189; invoice.subtotal=999;
  if(shape==='modern') invoice.total_taxes=[{amount:190,tax_behavior:'exclusive'}];
  else { p.api_version='2024-06-20'; invoice.total_tax_amounts=[{amount:190,inclusive:false}]; }
  expect((await f.deliver(p)).status).toBe(202); assertOneAllowance(f);
}));
test('Q4 subscription legacy invoice shape uses the same period and customer identity', async () => withSubscription(async f => {
  const p=invoiceEvent(); const invoice=p.data.object; p.api_version='2024-06-20';
  invoice.subscription=invoice.parent.subscription_details.subscription; invoice.subscription_details={metadata:invoice.parent.subscription_details.metadata}; delete invoice.parent;
  const line=invoice.lines.data[0]; line.subscription=invoice.subscription; line.price={id:PRICE}; delete line.pricing; delete line.parent;
  expect((await f.deliver(p)).status).toBe(202); assertOneAllowance(f);
}));
for(const [name,change] of [
  ['unexplained tax total',p=>{p.data.object.amount_paid=1189;p.data.object.amount_due=1189;p.data.object.total=1189;}],
  ['different line subscription',p=>{p.data.object.lines.data[0].parent.subscription_item_details.subscription='sub_another_subscription';}],
  ['invoice instead of service period',p=>{p.data.object.period_start=START;p.data.object.period_end=END;delete p.data.object.lines.data[0].period;}],
]) test(`Q4 subscription ${name} is not fulfillment proof`, async () => withSubscription(async f=>{
  const p=invoiceEvent();change(p);expect((await f.deliver(p)).status).toBe(409);expect(state(f).ledger).toHaveLength(0);
}));
test('Q4 subscription period end and invoice period conflicts cannot create a second allowance', async () => withSubscription(async f=>{
  expect((await f.deliver(invoiceEvent())).status).toBe(202);
  expect((await f.deliver(invoiceEvent('evt_q4_conflicting_end',{invoice:'in_q4_conflicting_end',end:END+86400}))).status).toBe(409);
  expect((await f.deliver(invoiceEvent('evt_q4_same_invoice_new_period',{start:END,end:END+31*86400}))).status).toBe(409);
  assertOneAllowance(f);
}));
test('Q4 subscription proven same-period updates apply; unproven reversible order remains retryable', async () => withSubscription(async f=>{
  expect((await f.deliver(lifecycleEvent())).status).toBe(202);
  const uncertain=lifecycleEvent('evt_q4_past_due',{type:'customer.subscription.updated',status:'past_due'});
  expect((await f.deliver(uncertain)).status).toBe(503); expect(state(f).subscriptions[0].status).toBe('active');
  const proven=lifecycleEvent('evt_q4_cancel_end',{type:'customer.subscription.updated',cancelAtPeriodEnd:true});
  proven.data.previous_attributes={cancel_at_period_end:false};
  expect((await f.deliver(proven)).status).toBe(202);expect(state(f).subscriptions[0].cancel_at_period_end).toBe(1);
  const reverse=lifecycleEvent('evt_q4_cancel_reverse',{type:'customer.subscription.updated'});
  reverse.data.previous_attributes={cancel_at_period_end:true};
  expect((await f.deliver(reverse)).status).toBe(202);expect(state(f).subscriptions[0].cancel_at_period_end).toBe(0);
}));
test('Q4 subscription a conflicting concurrent state snapshot loses its CAS without customer or event completion', async () => withSubscription(async f=>{
  expect((await f.deliver(lifecycleEvent())).status).toBe(202);
  const original=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async statements=>{if(!injected && statements.some(s=>s.sql.includes('INSERT INTO billing_member_subscription_operations'))){injected=true;f.db.exec("UPDATE billing_member_subscriptions SET status='past_due'");}return original(statements);};
  const p=lifecycleEvent('evt_q4_stale_transition',{type:'customer.subscription.updated',cancelAtPeriodEnd:true});p.data.previous_attributes={cancel_at_period_end:false};
  expect((await f.deliver(p)).status).toBe(503);expect(state(f).subscriptions[0]).toMatchObject({status:'past_due',cancel_at_period_end:0});
  expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM billing_member_subscription_operations').get().n).toBe(1);
}));
test('Q4 subscription legacy fulfilled period proof prevents a grant after spending', async () => withSubscription(async f=>{
  const billing=await load('workers/auth/src/lib/billing.js');
  const subscription=await billing.upsertMemberSubscriptionFromProvider({env:f.env,userId:MEMBER,provider:'stripe',providerMode:'live',providerCustomerId:checkout.customer,providerSubscriptionId:checkout.subscription,providerPriceId:PRICE,status:'active',currentPeriodStart:new Date(START*1000).toISOString(),currentPeriodEnd:new Date(END*1000).toISOString()});
  await billing.topUpMemberSubscriptionCredits({env:f.env,userId:MEMBER,subscriptionId:subscription.id,providerSubscriptionId:checkout.subscription,periodStart:subscription.currentPeriodStart,periodEnd:subscription.currentPeriodEnd,stripeInvoiceId:'in_q4_legacy_paid',providerEventId:'evt_q4_legacy_paid'});
  await billing.consumeMemberCredits({env:f.env,userId:MEMBER,featureKey:'ai.image.generate',credits:1000,idempotencyKey:'q4-legacy-consume',source:'synthetic_q4_usage'});
  const delivered=await f.deliver(invoiceEvent());expect(delivered.status).toBe(202);expect(delivered.body.creditGrant.creditsGranted).toBe(0);
  expect(delivered.body.creditGrant.subscriptionCredits).toBe(5000);assertOneAllowance(f);
}));
test('Q4 subscription permanent customer binding rejects legacy owner and customer mutation', async () => withSubscription(async f=>{
  expect((await f.deliver(sessionEvent())).status).toBe(202);
  expect(()=>f.db.exec(`UPDATE billing_member_subscriptions SET user_id='${OTHER}'`)).toThrow('member subscription identity is immutable');
  expect(()=>f.db.exec("UPDATE billing_member_subscriptions SET provider_customer_id='cus_reassigned'")).toThrow('member subscription identity is immutable');
  expect(()=>f.db.exec(`UPDATE billing_member_customers SET user_id='${OTHER}'`)).toThrow('member customer identity is immutable');
  expect(state(f).subscriptions[0].user_id).toBe(MEMBER);
}));
test('Q4 subscription completed fulfillment remains completed after acknowledgement loss and replay', async () => withSubscription(async f=>{
  const batch=f.db.batch.bind(f.db);let lost=false;
  f.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.includes("SET state='completed'"))){lost=true;throw new Error('Synthetic lost committed acknowledgement');}return result;};
  expect((await f.deliver(invoiceEvent())).status).toBe(503);
  let s=state(f);expect(s.events[0].processing_status).toBe('planned');expect(s.actions[0].status).toBe('planned');
  expect(JSON.parse(s.actions[0].summary_json)).toMatchObject({fulfillmentStatus:'completed',creditGrantStatus:'granted',creditsGranted:6000,allowance:6000,subscriptionCredits:6000});
  const repeated=await f.deliver(invoiceEvent());expect(repeated.status).toBe(200);
  expect(state(f).events[0].member_billing_customer_id).toBeTruthy();expect(repeated.body.event.billingCustomerId).toBeNull();
  expect(repeated.body.subscription).toMatchObject({provider:'stripe',providerMode:'live',providerPriceId:PRICE,status:'active'});
  assertOneAllowance(f);
}));
for(const [name,change] of [
  ['line owner',p=>{p.data.object.lines.data[0].metadata.user_id=OTHER;}],
  ['line checkout intent',p=>{p.data.object.lines.data[0].metadata.internal_checkout_session_id='bcs_different_local_intent';}],
  ['invoice subscription',p=>{p.data.object.subscription='sub_different_invoice_subscription';}],
]) test(`Q4 subscription contradictory ${name} is rejected even with a matching preferred field`,async()=>withSubscription(async f=>{
  const p=invoiceEvent();change(p);const r=await f.deliver(p);expect(r.status).toBe(409);expect(r.body.code).toBe('subscription_invoice_identity_conflict');expect(state(f).ledger).toHaveLength(0);
}));
test('Q4 subscription organization and member customer scopes cannot be reassigned by either writer',async()=>withSubscription(async f=>{
  f.db.exec(`INSERT INTO organizations(id,name,slug,created_by_user_id,created_at,updated_at) VALUES('q4-org','Synthetic','q4-org','${MEMBER}','2026-09-01','2026-09-01');
    INSERT INTO billing_customers(id,organization_id,provider,provider_customer_ref,created_at,updated_at) VALUES('bc_q4_org','q4-org','stripe','${checkout.customer}','2026-09-01','2026-09-01');`);
  expect((await f.deliver(invoiceEvent())).status).toBe(409);expect(state(f).ledger).toHaveLength(0);
  f.db.exec("UPDATE billing_customers SET provider_customer_ref='cus_other_org_identity'");
  expect((await f.deliver(invoiceEvent())).status).toBe(200);
  expect(()=>f.db.exec(`UPDATE billing_customers SET provider_customer_ref='${checkout.customer}'`)).toThrow('billing customer scope conflicts');
  expect(()=>f.db.exec(`INSERT INTO billing_customers(id,organization_id,provider,provider_customer_ref,created_at,updated_at) VALUES('bc_q4_org_other','q4-org','stripe','${checkout.customer}','2026-09-01','2026-09-01')`)).toThrow('billing customer scope conflicts');
  assertOneAllowance(f);
}));
test('Q4 subscription a surviving legacy bucket without exact ledger proof cannot be refilled by replay',async()=>withSubscription(async f=>{
  const billing=await load('workers/auth/src/lib/billing.js');
  await billing.grantMemberCredits({env:f.env,userId:MEMBER,amount:2000,createdByUserId:MEMBER,idempotencyKey:'q4-ambiguous-period-seed',source:'synthetic_missing_legacy_proof',creditBucketType:'subscription',bucketScope:{providerSubscriptionId:checkout.subscription,periodStart:new Date(START*1000).toISOString(),periodEnd:new Date(END*1000).toISOString()}});
  const before=state(f);const r=await f.deliver(invoiceEvent());expect(r.status).toBe(409);expect(r.body.code).toBe('subscription_legacy_period_unproven');
  expect(state(f).ledger).toEqual(before.ledger);expect(state(f).buckets).toEqual(before.buckets);
  expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM billing_member_subscription_periods').get().n).toBe(0);
  expect((await f.deliver(invoiceEvent())).status).toBe(409);expect(state(f).ledger).toEqual(before.ledger);
}));
test('Q4 subscription archived completed receipt acknowledges signed replay without unarchiving or granting again',async()=>withSubscription(async f=>{
  expect((await f.deliver(invoiceEvent())).status).toBe(202);const completed=state(f).events[0];
  await f.db.prepare("INSERT INTO billing_operator_item_states(id,item_type,item_id,state,archived_at,created_at,updated_at) VALUES('q4-archived-receipt','billing_provider_event',?,'archived','2026-09-06','2026-09-06','2026-09-06')").bind(completed.id).run();
  const before=state(f).ledger;const replay=await f.deliver(invoiceEvent());expect(replay.status).toBe(200);expect(replay.body.event.archived).toBe(true);
  expect(replay.body.creditGrant.creditsGranted).toBe(0);expect(state(f).ledger).toEqual(before);
  expect(f.db.database.prepare('SELECT COUNT(*) AS n FROM billing_operator_item_states').get().n).toBe(1);
}));
