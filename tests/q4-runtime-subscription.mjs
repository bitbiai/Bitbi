import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import payloads from './helpers/q4-subscription-payloads.cjs';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

// Actual Wrangler candidate, signed synthetic HTTP and native D1. Payload shapes
// are shared with Node/SQLite tests; neither path calls Stripe or grants live data.
export async function runSubscriptionTests(f) {
  const { db, sql, rows, scalar, migrations, mf, test, webhookSecret } = f;
  for (const m of migrations.filter(m=>Number(m.path.slice(0,4))<85)) await db.batch(m.statements.map(s=>db.prepare(s)));
  const worker=await mf.getWorker('q2-candidate');
  const now=new Date(), start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000, end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)/1000;
  async function seed(index) {
    const user=`q4-native-sub-member-${index}`, id=`bcs_q4_native_subscription_${index}`, customer=`cus_q4_native_subscription_${index}`, subscription=`sub_q4_native_subscription_${index}`, session=`cs_live_q4_native_subscription_${index}`;
    await sql("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,'synthetic-unused',?,'user','active',?)",user,`${user}@example.invalid`,now.toISOString(),now.toISOString()).run();
    await sql(`INSERT INTO billing_member_subscription_checkout_sessions(id,provider,provider_mode,provider_checkout_session_id,user_id,plan_id,provider_price_id,amount_cents,currency,status,idempotency_key_hash,request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
      VALUES(?,'stripe','live',?,?,'bitbi_pro_monthly',?,999,'eur','created',?,?,'member','{}',?,?)`,id,session,user,payloads.PRICE,`${index}`.padStart(64,'a'),`${index}`.padStart(64,'b'),now.toISOString(),now.toISOString()).run();
    const adapt=p=>JSON.parse(JSON.stringify(p).replaceAll(payloads.MEMBER,user).replaceAll(payloads.checkout.id,id).replaceAll(payloads.checkout.customer,customer).replaceAll(payloads.checkout.subscription,subscription).replaceAll(payloads.checkout.session,session));
    const invoice=(suffix='paid',options={})=>adapt(payloads.invoiceEvent(`evt_q4_native_${index}_${suffix}`,{invoice:`in_q4_native_${index}_${suffix}`,start,end,...options}));
    const lifecycle=(suffix='created',options={})=>adapt(payloads.lifecycleEvent(`evt_q4_native_${index}_${suffix}`,{start,end,...options}));
    const checkout=()=>adapt(payloads.sessionEvent(`evt_q4_native_${index}_checkout`));
    const deliver=async(payload,badSignature=false)=>{const raw=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000),sig=createHmac('sha256',webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
      const response=await worker.fetch(`https://bitbi.ai/api/billing/webhooks/stripe/live`,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.181','Stripe-Signature':`t=${timestamp},v1=${badSignature?'0'.repeat(64):sig}`},body:raw});
      return {status:response.status,body:await response.json()};};
    const credits=()=>scalar("SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=? AND source='subscription_period_top_up'",user);
    return {user,id,customer,subscription,session,invoice,lifecycle,checkout,deliver,credits};
  }
  const baseline=await seed(0), migration=migrations.find(m=>m.path.startsWith('0085_'));
  await test('q4_0085_native_batch_failure_preserves_populated_checkout_and_schema',async()=>{
    const before=await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name');
    await expectNativeRejection(()=>db.batch([...migration.statements.map(s=>db.prepare(s)),db.prepare('INSERT INTO billing_member_customers(id) VALUES(NULL)')]),'NOT NULL constraint failed');
    assert.deepEqual(await rows('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'),before);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_member_subscription_checkout_sessions WHERE id=?',baseline.id),1);
  });
  await test('q4_0085_actual_migration_preserves_sources_and_distinguishes_customer_relations',async()=>{
    const before=await rows('SELECT * FROM billing_member_subscription_checkout_sessions');
    await db.batch(migration.statements.map(s=>db.prepare(s)));
    for(const m of migrations.filter(m=>Number(m.path.slice(0,4))>85))await db.batch(m.statements.map(s=>db.prepare(s)));
    assert.deepEqual(await rows('SELECT * FROM billing_member_subscription_checkout_sessions'),before);
    assert.equal((await rows('PRAGMA table_info(billing_customers)')).find(r=>r.name==='organization_id').notnull,1);
    assert.ok((await rows('PRAGMA foreign_key_list(billing_provider_events)')).some(r=>r.from==='member_billing_customer_id'&&r.table==='billing_member_customers'));
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  });
  await test('q4_actual_Wrangler_checkout_uses_local_member_customer_FK_and_never_grants',async()=>{
    assert.equal((await baseline.deliver(baseline.checkout())).status,202);
    assert.equal(await baseline.credits(),0);
    const event=await sql('SELECT * FROM billing_provider_events WHERE user_id=?',baseline.user).first();
    assert.equal(event.billing_customer_id,null);assert.ok(event.member_billing_customer_id);assert.notEqual(event.member_billing_customer_id,baseline.customer);
    assert.equal((await sql('SELECT * FROM billing_member_customers WHERE id=?',event.member_billing_customer_id).first()).provider_customer_ref,baseline.customer);
  });
  for(const [index,stage,trigger] of [
    [1,'ledger',"BEFORE INSERT ON member_credit_ledger WHEN NEW.source='subscription_period_top_up'"],
    [2,'bucket',"BEFORE UPDATE ON member_credit_buckets WHEN NEW.bucket_type='subscription'"],
    [3,'event',"BEFORE UPDATE ON billing_provider_events WHEN NEW.member_billing_customer_id IS NOT NULL"],
    [4,'completion',"BEFORE UPDATE ON billing_member_subscription_operations WHEN NEW.state='completed'"],
  ]) await test(`q4_native_subscription_${stage}_failure_retains_receipt_and_atomic_retry`,async()=>{
    const s=await seed(index);await sql(`CREATE TRIGGER q4_subscription_fault ${trigger} BEGIN SELECT RAISE(ABORT,'q4 native subscription fault'); END`).run();
    assert.equal((await s.deliver(s.invoice())).status,503);assert.equal(await s.credits(),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_member_subscription_operations WHERE user_id=?',s.user),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_buckets WHERE user_id=?',s.user),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_provider_events WHERE provider_event_id=?',s.invoice().id),1);
    await sql('DROP TRIGGER q4_subscription_fault').run();
    const completed=await s.deliver(s.invoice());assert.equal(completed.status,200);assert.equal(completed.body.creditGrant.creditsGranted,6000);
    assert.equal((await s.deliver(s.invoice())).body.creditGrant.creditsGranted,0);assert.equal(await s.credits(),1);
    assert.equal(await scalar('SELECT balance AS value FROM member_credit_buckets WHERE user_id=? AND bucket_type=\'subscription\'',s.user),6000);
  });
  await test('q4_native_two_event_deliveries_share_one_period_and_preserve_next_period',async()=>{
    const s=await seed(5), a=s.invoice(), b=s.invoice('second');
    const result=await Promise.all([s.deliver(a),s.deliver(b)]);
    assert.ok(result.every(r=>r.status===200||r.status===202));assert.equal(await s.credits(),1);
    const saved=await rows('SELECT * FROM member_credit_ledger WHERE user_id=?',s.user);
    assert.equal(saved[0].amount,6000);assert.equal(saved[0].balance_after,6000);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_bucket_events WHERE user_id=?',s.user),1);
    assert.equal((await s.deliver(s.invoice('renewal',{start:end,end:end+30*86400}))).status,202);assert.equal(await s.credits(),2);
  });
  await test('q4_native_paid_before_lifecycle_and_delayed_checkout_preserve_active_state',async()=>{
    const s=await seed(6);assert.equal((await s.deliver(s.invoice())).status,202);
    assert.equal((await s.deliver(s.lifecycle())).status,202);assert.equal((await s.deliver(s.checkout())).status,202);
    assert.equal((await sql('SELECT * FROM billing_member_subscriptions WHERE user_id=?',s.user).first()).status,'active');
    assert.equal((await sql('SELECT * FROM billing_member_subscription_checkout_sessions WHERE id=?',s.id).first()).status,'completed');assert.equal(await s.credits(),1);
  });
  await test('q4_native_signature_owner_price_mode_and_period_conflicts_do_not_grant',async()=>{
    const s=await seed(7);assert.equal((await s.deliver(s.invoice(),true)).status,401);
    const owner=s.invoice('owner');owner.data.object.parent.subscription_details.metadata.user_id=baseline.user;assert.equal((await s.deliver(owner)).status,409);
    const mode=s.invoice('mode');mode.livemode=false;assert.equal((await s.deliver(mode)).status,403);
    const currency=s.invoice('currency');currency.data.object.currency='usd';assert.equal((await s.deliver(currency)).status,409);
    const price=s.invoice('price');price.data.object.lines.data[0].pricing.price_details.price='price_unrelated';assert.equal((await s.deliver(price)).status,202);assert.equal(await s.credits(),0);
    assert.equal((await s.deliver(s.invoice())).status,202);
    assert.equal((await s.deliver(s.invoice('wrongend',{end:end+86400}))).status,409);assert.equal(await s.credits(),1);
    await expectNativeRejection(()=>sql('UPDATE billing_member_subscriptions SET user_id=? WHERE user_id=?',baseline.user,s.user).run(),'member subscription identity is immutable');
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
  });
  await test('q4_native_ambiguous_legacy_period_is_retained_for_reconciliation_without_grant',async()=>{
    const s=await seed(9);
    await sql("INSERT INTO member_credit_buckets(id,user_id,bucket_type,balance,provider_subscription_id,period_start,period_end,created_at,updated_at) VALUES('q4-native-ambiguous-bucket',?,'subscription',2000,?,?,?,?,?)",s.user,s.subscription,new Date(start*1000).toISOString(),new Date(end*1000).toISOString(),now.toISOString(),now.toISOString()).run();
    const original=await rows('SELECT * FROM member_credit_buckets WHERE user_id=?',s.user);
    const response=await s.deliver(s.invoice());assert.equal(response.status,409);assert.equal(response.body.code,'subscription_legacy_period_unproven');
    assert.equal(await s.credits(),0);assert.deepEqual(await rows('SELECT * FROM member_credit_buckets WHERE user_id=?',s.user),original);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_member_subscription_operations WHERE user_id=?',s.user),0);
  });
  await test('q4_subscription_restricted_recovery_preserves_fulfillment_without_replay',async()=>{
    const s=await seed(8);assert.equal((await s.deliver(s.invoice())).status,202);
    const tables=['billing_member_customers','billing_member_subscription_operations','billing_member_subscription_periods','billing_member_subscriptions','member_credit_ledger','member_credit_buckets','member_credit_bucket_events'];
    const before=await Promise.all(tables.map(table=>rows(`SELECT * FROM ${table} ORDER BY rowid`)));
    const recovery=await mf.getWorker('q2-restricted');
    const raw=JSON.stringify(s.invoice()), timestamp=Math.floor(Date.now()/1000), signature=createHmac('sha256',webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
    const response=await recovery.fetch('https://bitbi.ai/api/billing/webhooks/stripe/live',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${signature}`},body:raw});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'release_access_restricted');
    assert.deepEqual(await Promise.all(tables.map(table=>rows(`SELECT * FROM ${table} ORDER BY rowid`))),before);
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  });

}
