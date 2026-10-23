import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

// Real production fetch middleware, actual workerd D1 transactions, no external
// provider/network calls. The subscription suite has applied populated migrations.
export async function runConsumerDeclarationTests(f) {
  const {mf,sql,rows,scalar,test,control,counters}=f,worker=await mf.getWorker('q2-candidate');
  const now=new Date().toISOString();let requestNumber=0;
  const declaration=(extra={})=>({requestId:randomUUID(),kind:'withdrawal',locale:'de',name:'Synthetic Consumer',
    email:`consumer-${randomUUID()}@example.invalid`,contractReference:'Synthetic purchase from 2020 — statutory eligibility requires review',scope:'Only this order\nNo required reason',...extra});
  const send=async(body,{path='/api/consumer/declarations',origin='https://bitbi.ai',cookie='',method='POST'}={})=>{
    const response=await worker.fetch(`https://bitbi.ai${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':`192.0.2.${1+(requestNumber++%240)}`},body:method==='GET'?undefined:JSON.stringify(body)});
    const payload=response.headers.get('content-type')?.includes('application/json')?await response.json():{nonJson:true};
    return {status:response.status,headers:response.headers,body:payload};
  };
  const originalMoney=await rows('SELECT * FROM member_credit_ledger ORDER BY id');
  const originalSubscriptions=await rows('SELECT * FROM billing_member_subscriptions ORDER BY id');
  const originalOutbound=counters.outboundDenied;
  let first;
  await test('consumer_actual_public_intake_durable_receipt_replay_and_mail_outage',async()=>{
    const body=declaration(),a=await send(body);first=a.body;
    assert.equal(a.status,201);assert.equal(a.body.status,'received');assert.match(a.body.receipt.text,/Stefan van Ark/);assert.match(a.body.receipt.text,/2020/);
    assert.match(a.headers.get('cache-control'),/no-store/);assert.ok(Number.isFinite(Date.parse(a.body.receivedAt)));
    assert.equal(a.body.receipt.text.includes(body.scope),true);assert.equal(a.body.receipt.name,body.name);
    const b=await send(body);assert.equal(b.status,200);assert.equal(b.body.id,a.body.id);assert.equal(b.body.receivedAt,a.body.receivedAt);assert.equal(b.body.receipt.text,a.body.receipt.text);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_declarations WHERE id=?',a.body.id),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM transactional_messages WHERE source_id=?',a.body.id),1);
    assert.notEqual(b.body.acknowledgement.state,'delivered','Missing Resend configuration cannot prove delivery');
    const altered=await send({...body,name:'Changed content'});assert.equal(altered.status,409);assert.equal(altered.body.code,'consumer_request_conflict');
  });
  await test('consumer_actual_input_origin_and_invalid_date_controls',async()=>{
    const before=await scalar('SELECT COUNT(*) AS value FROM consumer_declarations');
    assert.equal((await send(declaration(),{origin:'https://untrusted.example'})).status,403);
    assert.equal((await send(declaration({name:'<script>unsafe</script>'}))).status,400);
    assert.equal((await send(declaration({kind:'cancellation',endRequest:'date',requestedEndDate:'2026-99-99'}))).body.code,'consumer_date_invalid');
    assert.equal((await send(declaration({kind:'cancellation',endRequest:'date',requestedEndDate:'2026-02-30'}))).body.code,'consumer_date_invalid');
    assert.equal((await send(declaration({userId:'foreign-owner'}))).status,400);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_declarations'),before);
  });
  await test('consumer_native_outbox_atomic_failure_preserves_receipt_retry_identity',async()=>{
    const value=declaration(),before=await scalar('SELECT COUNT(*) AS value FROM consumer_declarations');
    await sql("CREATE TRIGGER consumer_mail_fixture_failure BEFORE INSERT ON transactional_messages WHEN NEW.kind='withdrawal_acknowledgement' BEGIN SELECT RAISE(ABORT,'synthetic consumer outbox failure'); END").run();
    assert.equal((await send(value)).body.code,'consumer_receipt_unconfirmed');
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_declarations'),before);
    await sql('DROP TRIGGER consumer_mail_fixture_failure').run();
    const accepted=await send(value);assert.equal(accepted.status,201);
    assert.equal((await send(value)).body.id,accepted.body.id);
    await expectNativeRejection(()=>sql("UPDATE consumer_declarations SET received_at='2000-01-01T00:00:00Z' WHERE id=?",accepted.body.id).run(),'consumer_declaration_evidence_immutable');
  });
  await test('consumer_native_concurrent_duplicate_and_distinct_cancellation_intake',async()=>{
    const value=declaration({kind:'cancellation',cancellationType:'extraordinary',endRequest:'earliest',reason:''});
    const results=await Promise.all([send(value),send(value)]);
    assert.ok(results.every(r=>[200,201].includes(r.status)));assert.equal(results[0].body.id,results[1].body.id);
    assert.equal(results[0].body.receivedAt,results[1].body.receivedAt);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM transactional_messages WHERE source_id=?',results[0].body.id),1);
    assert.match(results[0].body.receipt.text,/außerordentlich/);assert.equal(results[0].body.receipt.reason,'');
  });
  const member='q2-workerd-member',admin='q2-workerd-admin';
  for(const [id,role] of [[member,'user'],[admin,'admin']])await sql("INSERT OR IGNORE INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,'synthetic',?,?,'active',?)",id,`${id}@example.invalid`,now,role,now).run();
  const memberCookie=(await (await control('/session',{userId:member})).json()).cookie;
  await test('consumer_actual_session_association_private_documents_and_admin_denial',async()=>{
    const accepted=await send(declaration(),{cookie:memberCookie});assert.equal(accepted.status,201);
    assert.equal(await scalar('SELECT user_id AS value FROM consumer_declarations WHERE id=?',accepted.body.id),member);
    assert.equal((await send(null,{path:'/api/account/billing/contracts/foreign_checkout',method:'GET',cookie:memberCookie})).status,404);
    assert.equal((await send(null,{path:'/api/account/billing/contracts/foreign_checkout',method:'GET'})).status,401);
    assert.equal((await send(null,{path:'/api/account/billing/contracts',method:'GET'})).status,401);
    assert.equal((await send(null,{path:'/api/account/billing/contracts?cursor=unsafe',method:'GET',cookie:memberCookie})).status,400);
    assert.equal((await send(null,{path:'/api/admin/billing/consumer-declarations',method:'GET'})).status,401);
    assert.equal((await send(null,{path:'/api/admin/billing/consumer-declarations',method:'GET',cookie:memberCookie})).status,403);
  });
  await test('consumer_actual_owner_document_list_is_bounded_private_and_downloadable',async()=>{
    for(const [id,owner] of [['consumer-owned',member],['consumer-foreign',admin]]) {
      const snapshot=JSON.stringify({offer:{name:'Synthetic retained purchase'}}),document=JSON.stringify({text:'Immutable contract content'});
      await sql("INSERT INTO consumer_contract_snapshots(checkout_id,user_id,checkout_scope,terms_version,locale,snapshot_json,snapshot_hash,accepted_at) VALUES(?,?,'member','2026-10-23','en',?,'synthetic',?)",id,owner,snapshot,now).run();
      await sql("INSERT INTO consumer_contract_confirmations(checkout_id,provider_session_id,provider_event_id,document_json,document_hash,created_at) VALUES(?,?,?,?,'synthetic',?)",id,`cs_${id}`,`evt_${id}`,document,now).run();
    }
    const owned=await send(null,{path:'/api/account/billing/contracts',method:'GET',cookie:memberCookie});
    assert.equal(owned.status,200);assert.deepEqual(owned.body.items,[{checkoutId:'consumer-owned',offerName:'Synthetic retained purchase',createdAt:now,locale:'en'}]);
    assert.equal(owned.body.nextCursor,null);assert.match(owned.headers.get('cache-control'),/no-store/);
    const document=await send(null,{path:'/api/account/billing/contracts/consumer-owned',method:'GET',cookie:memberCookie});
    assert.equal(document.status,200);assert.equal(document.body.document.text,'Immutable contract content');
    assert.equal((await send(null,{path:'/api/account/billing/contracts/consumer-foreign',method:'GET',cookie:memberCookie})).status,404);
  });
  let adminCookie=(await (await control('/session',{userId:admin})).json()).cookie;
  const setup=await send({}, {path:'/api/admin/mfa/setup',cookie:adminCookie});assert.equal(setup.status,200);
  const code=(await (await control('/totp',{secret:setup.body.setup.secret})).json()).code;
  const enabled=await send({code},{path:'/api/admin/mfa/enable',cookie:adminCookie});assert.equal(enabled.status,200);
  adminCookie+='; '+enabled.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  await test('consumer_actual_admin_review_replay_revision_guard_and_immutable_receipt',async()=>{
    await sql("UPDATE transactional_messages SET state='accepted',error_code='mail_delivery_unconfirmed',next_attempt_at=NULL WHERE source_id=?",first.id).run();
    const listed=await send(null,{path:'/api/admin/billing/consumer-declarations',method:'GET',cookie:adminCookie});assert.equal(listed.status,200);assert.ok(listed.body.items.some(i=>i.id===first.id));
    assert.ok(listed.body.mailFailures.some(item=>item.source_id===first.id&&item.error_code==='mail_delivery_unconfirmed'),'Stopped observation of an accepted message remains operator-visible');
    const review={requestId:randomUUID(),expectedRevision:0,state:'in_review',note:'Synthetic operator review. No financial action.'};
    const path=`/api/admin/billing/consumer-declarations/${first.id}/review`;
    assert.equal((await send(review,{path,cookie:adminCookie})).status,200);
    assert.equal((await send(review,{path,cookie:adminCookie})).body.reused,true);
    const other=(await send(declaration())).body;
    const wrongTarget=await send(review,{path:`/api/admin/billing/consumer-declarations/${other.id}/review`,cookie:adminCookie});
    assert.equal(wrongTarget.status,409);assert.equal(wrongTarget.body.code,'consumer_request_conflict');
    assert.equal(await scalar('SELECT revision AS value FROM consumer_declarations WHERE id=?',other.id),0);
    assert.equal((await send({...review,requestId:randomUUID(),state:'closed'},{path,cookie:adminCookie})).status,409);
    assert.equal(await scalar('SELECT revision AS value FROM consumer_declarations WHERE id=?',first.id),1);
    assert.equal(await scalar('SELECT received_at AS value FROM consumer_declarations WHERE id=?',first.id),first.receivedAt);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_declaration_reviews WHERE declaration_id=?',first.id),1);
  });
  await test('consumer_actual_cancellation_requires_verified_exact_ordinary_contract_and_preserves_unknown',async()=>{
    const value=declaration({kind:'cancellation',cancellationType:'ordinary',endRequest:'earliest'});
    const accepted=await send(value,{cookie:memberCookie}),id=accepted.body.id;
    const payload={requestId:randomUUID(),expectedRevision:0,userId:member,providerSubscriptionId:'sub_synthetic_unowned',identityVerified:true,note:'Synthetic verified review'};
    const path=`/api/admin/billing/consumer-declarations/${id}/subscription`;
    assert.equal((await send(payload,{path,cookie:memberCookie})).status,403);
    assert.equal((await send({...payload,identityVerified:false},{path,cookie:adminCookie})).body.code,'consumer_cancellation_review_invalid');
    assert.equal((await send({...payload,userId:admin},{path,cookie:adminCookie})).body.code,'consumer_cancellation_owner_conflict');
    assert.equal((await send(payload,{path,cookie:adminCookie})).body.code,'consumer_cancellation_subscription_changed');
    assert.equal((await send(payload,{path:`/api/admin/billing/consumer-declarations/${first.id}/subscription`,cookie:adminCookie})).body.code,'consumer_cancellation_requires_individual_review');
    await sql("UPDATE consumer_declarations SET provider_state='unknown' WHERE id=?",id).run();
    const closed=await send({requestId:randomUUID(),expectedRevision:0,state:'closed',note:'Attempt to close unresolved provider outcome'},{path:`/api/admin/billing/consumer-declarations/${id}/review`,cookie:adminCookie});
    assert.equal(closed.status,409);assert.equal(closed.body.code,'consumer_cancellation_outcome_requires_reconciliation');
    assert.equal(await scalar('SELECT state AS value FROM consumer_declarations WHERE id=?',id),'received');
  });
  await test('consumer_native_keyset_pagination_keeps_equal_time_items_and_finances_unchanged',async()=>{
    const source=await sql('SELECT * FROM consumer_declarations WHERE id=?',first.id).first();
    await f.db.batch(Array.from({length:55},(_,index)=>{
      const suffix=(index+1).toString(16).padStart(32,'0');
      return sql(`INSERT INTO consumer_declarations(id,request_hash,input_hash,kind,locale,name,email,contract_reference,declaration_json,receipt_text,received_at,review_due_at,updated_at)
        VALUES(?, ?,?,'withdrawal','en','Synthetic pagination','page@example.invalid','Synthetic',?,'synthetic receipt',?,?,?)`,
        `cd_${suffix}`,`pagination-${suffix}`,`fingerprint-${suffix}`,source.declaration_json,now,now,now);
    }));
    const page=await send(null,{path:'/api/admin/billing/consumer-declarations',method:'GET',cookie:adminCookie});assert.equal(page.body.items.length,50);assert.ok(page.body.nextCursor);
    assert.equal(page.body.summary.openCount,await scalar("SELECT COUNT(*) AS value FROM consumer_declarations WHERE state IN ('received','in_review')"));
    assert.ok(page.body.summary.overdueCount>=55,'Dashboard summary includes off-page due declarations');
    const next=await send(null,{path:`/api/admin/billing/consumer-declarations?cursor=${encodeURIComponent(page.body.nextCursor)}`,method:'GET',cookie:adminCookie});assert.equal(next.status,200);
    assert.equal(new Set([...page.body.items,...next.body.items].map(i=>i.id)).size,page.body.items.length+next.body.items.length);
    assert.equal(page.body.items.length+next.body.items.length,await scalar("SELECT COUNT(*) AS value FROM consumer_declarations WHERE state IN ('received','in_review')"));
    assert.deepEqual(await rows('SELECT * FROM member_credit_ledger ORDER BY id'),originalMoney);
    assert.deepEqual(await rows('SELECT * FROM billing_member_subscriptions ORDER BY id'),originalSubscriptions);
    assert.equal(counters.outboundDenied,originalOutbound,'Intake and review cannot call Stripe, inference or an unconfigured mail service');
  });
}
