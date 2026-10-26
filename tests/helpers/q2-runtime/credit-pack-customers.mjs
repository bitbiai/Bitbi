import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {CONSUMER_TERMS_VERSION,CREDIT_PACK_PERFORMANCE_CONSENT_VERSION} from '../../../js/shared/consumer-contract.mjs';
import {expectNativeRejection} from './assertions.mjs';

// These cases use real authenticated Checkout and signed webhook entrypoints.
// Only the external Stripe/Resend boundary is synthetic; no completed rows are seeded.
export async function runCreditPackCustomerTests(f) {
  const {sql,rows,scalar,test,consumerMailProvider:provider}=f,now=new Date().toISOString();
  const customer=(id)=>({id,object:'customer',preferred_locales:['de']});
  async function user(suffix){
    const id=`q4-native-pack-${suffix}`;
    await sql("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,'synthetic-unused',?,'user','active',?)",id,`${id}@example.invalid`,now,now).run();
    return id;
  }
  async function link(owner,ref){
    await sql("INSERT INTO billing_member_customers(id,user_id,provider,provider_mode,provider_customer_ref,created_at) VALUES(?,?,'stripe','live',?,?)",`bmc_${ref}`,owner,ref,now).run();
  }
  async function checkout(owner,key,{locale='de',organizationId,consent=true}={}){
    const response=await f.control('/consumer-pack-checkout',{userId:owner,key:`native-pack-${key}`,organizationId,input:{
      pack_id:'live_credits_5000',termsAccepted:true,termsVersion:CONSUMER_TERMS_VERSION,consentVersion:'consumer-v1',locale,
      earlyStartRequested:true,creditPackPerformanceConsent:consent,creditPackConsentVersion:CREDIT_PACK_PERFORMANCE_CONSENT_VERSION,
    }});
    assert.equal(response.status,200);return response.json();
  }
  function event(checkoutResponse,ref,suffix){
    const saved=provider.checkoutSessions.get(checkoutResponse.body.session_id);assert.ok(saved);
    const metadata=Object.fromEntries(Object.entries(saved.form).flatMap(([key,value])=>{const match=key.match(/^metadata\[(.+)\]$/);return match?[[match[1],value]]:[];}));
    return {id:`evt_native_pack_${suffix}`,object:'event',type:'checkout.session.completed',livemode:true,created:Math.floor(Date.now()/1000),data:{object:{
      ...saved.body,customer:ref,payment_status:'paid',amount_total:999,currency:'eur',payment_intent:`pi_native_pack_${suffix}`,
      payment_method_details:{type:'card'},invoice:`in_native_pack_${suffix}`,metadata,
    }}};
  }
  async function deliver(event){
    const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),digest=createHmac('sha256',f.webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
    const response=await f.control('/consumer-pack-webhook',{raw,signature:`t=${timestamp},v1=${digest}`});assert.equal(response.status,200);return response.json();
  }
  async function complete(checkoutResponse,ref,suffix){
    provider.customers.set(ref,customer(ref));
    const payload=event(checkoutResponse,ref,suffix);
    provider.invoices.set(payload.data.object.invoice,{id:payload.data.object.invoice,object:'invoice',rendering:{pdf:{page_size:'letter'}}});
    return {payload,result:await deliver(payload)};
  }
  await test('q4_native_pack_checkout_retires_missing_customer_and_completion_links_replacement_once',async()=>{
    const owner=await user('retirement'),old='cus_native_pack_missing',replacement='cus_native_pack_replacement';await link(owner,old);
    const before=await sql('SELECT * FROM billing_member_customers WHERE user_id=?',owner).first();
    const started=await checkout(owner,'retirement',{locale:'en'});assert.equal(started.status,201,JSON.stringify(started));
    const accepted=provider.checkoutSessions.get(started.body.session_id),id=accepted.form['metadata[internal_checkout_session_id]'];
    assert.equal(accepted.form.customer,undefined);assert.equal(accepted.form.customer_creation,'always');assert.equal(accepted.form.locale,'en');
    const retired=await sql('SELECT * FROM billing_member_customers WHERE id=?',before.id).first();assert.ok(retired.retired_at);
    assert.deepEqual({...retired,retired_at:null},before);assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',owner),0);
    const snapshot=await sql('SELECT * FROM consumer_contract_snapshots WHERE checkout_id=?',id).first();assert.equal(snapshot.locale,'en');
    const done=await complete(started,replacement,'replacement');assert.equal(done.result.status,202);assert.equal(done.result.body.creditGrant.creditsGranted,5000);
    const replay=await Promise.all([deliver(done.payload),deliver(done.payload)]);assert.ok(replay.every(r=>r.body.creditGrant.creditsGranted===0));
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',owner),1);
    assert.deepEqual(await sql('SELECT * FROM billing_member_customers WHERE id=?',before.id).first(),retired);
    assert.deepEqual((await rows('SELECT provider_customer_ref FROM billing_member_customers WHERE user_id=? AND retired_at IS NULL',owner)).map(r=>r.provider_customer_ref),[replacement]);
    const calls=provider.stripeRequests.length;assert.equal((await checkout(owner,'retirement',{locale:'en'})).status,200);assert.equal(provider.stripeRequests.length,calls);
    const reused=await checkout(owner,'reuse',{locale:'de'});assert.equal(reused.status,201);assert.equal(provider.checkoutSessions.get(reused.body.session_id).form.customer,replacement);
    const invoice={...done.payload,id:'evt_native_pack_invoice_replacement',type:'invoice.paid',data:{object:{id:done.payload.data.object.invoice,object:'invoice',livemode:true,
      customer:replacement,status:'paid',amount_paid:999,currency:'eur',metadata:done.payload.data.object.metadata,lines:{data:[]}}}};
    assert.ok([200,202].includes((await deliver(invoice)).status));assert.equal(await scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',owner),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_contract_confirmations WHERE checkout_id=?',id),1);
    assert.equal(provider.invoices.get(done.payload.data.object.invoice).rendering.pdf.page_size,'a4');
    await expectNativeRejection(()=>sql("UPDATE billing_member_customers SET provider_customer_ref='cus_rewritten' WHERE user_id=? AND retired_at IS NULL",owner).run(),'immutable');
  });
  await test('q4_native_pack_customer_disappears_between_read_and_checkout_retries_only_session_rejection',async()=>{
    const owner=await user('missing-at-session'),ref='cus_native_pack_missing_at_session';await link(owner,ref);provider.customers.set(ref,customer(ref));provider.missingAtCheckout.add(ref);
    const first=provider.stripeRequests.length,start=await checkout(owner,'missing-at-session');assert.equal(start.status,201);
    const posts=provider.stripeRequests.slice(first).filter(r=>r.path==='/v1/checkout/sessions');assert.equal(posts.length,2);
    assert.equal(posts[0].form.customer,ref);assert.equal(posts[1].form.customer,undefined);assert.notEqual(posts[0].key,posts[1].key);
    assert.ok((await sql('SELECT retired_at FROM billing_member_customers WHERE user_id=?',owner).first()).retired_at);
    const done=await complete(start,'cus_native_pack_after_session_missing','after_session_missing');assert.equal(done.result.body.creditGrant.creditsGranted,5000);
    assert.equal((await deliver(done.payload)).body.creditGrant.creditsGranted,0);assert.equal(provider.stripeRequests.filter(r=>r.path==='/v1/checkout/sessions').length,posts.length+provider.stripeRequests.slice(0,first).filter(r=>r.path==='/v1/checkout/sessions').length);
  });
  await test('q4_native_pack_customer_foreign_owner_and_organization_links_are_never_adopted',async()=>{
    const owner=await user('owner-fence'),foreign=await user('foreign-fence'),ref='cus_native_pack_foreign';await link(foreign,ref);provider.customers.set(ref,customer(ref));
    const old=await sql('SELECT * FROM billing_member_customers WHERE user_id=?',foreign).first(),started=await checkout(owner,'owner-fence');assert.equal(started.status,201);
    assert.equal(provider.checkoutSessions.get(started.body.session_id).form.customer,undefined);
    const done=await complete(started,ref,'foreign');assert.equal(done.result.body.creditGrant.creditsGranted,5000);
    assert.deepEqual(await sql('SELECT * FROM billing_member_customers WHERE user_id=?',foreign).first(),old);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_member_customers WHERE user_id=?',owner),0);
    const org=`org_${'c'.repeat(32)}`;await sql("INSERT INTO organizations(id,name,slug,status,created_by_user_id,created_at,updated_at) VALUES(?,'Synthetic organization',?,'active',?,?,?)",org,org,owner,now,now).run();
    await sql("INSERT INTO organization_memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,'owner','active',?,?)",`${org}-membership`,org,owner,now,now).run();
    const orgRef='cus_native_pack_organization';await sql("INSERT INTO billing_customers(id,organization_id,provider,provider_customer_ref,status,created_at,updated_at) VALUES(?,?,'stripe',?,'active',?,?)",`${org}-customer`,org,orgRef,now,now).run();
    provider.customers.set(orgRef,customer(orgRef));const orgBefore=await rows('SELECT * FROM billing_customers WHERE organization_id=?',org);
    const deniedCount=provider.stripeRequests.length;const denied=await checkout(foreign,'org-denied',{organizationId:org});assert.equal(denied.status,404,JSON.stringify(denied));assert.equal(denied.body.code,'organization_not_found');assert.equal(provider.stripeRequests.length,deniedCount);
    const orgCheckout=await checkout(owner,'org-allowed',{organizationId:org});assert.equal(orgCheckout.status,201,JSON.stringify(orgCheckout));
    const orgDone=await complete(orgCheckout,orgRef,'organization');assert.equal(orgDone.result.body.creditGrant.creditsGranted,5000);
    assert.equal((await deliver(orgDone.payload)).body.creditGrant.creditsGranted,0);assert.equal(await scalar('SELECT COUNT(*) AS value FROM credit_ledger WHERE organization_id=?',org),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_member_customers WHERE provider_customer_ref=?',orgRef),0);assert.deepEqual(await rows('SELECT * FROM billing_customers WHERE organization_id=?',org),orgBefore);
    await expectNativeRejection(()=>link(owner,orgRef),'scope conflicts');
    assert.equal(f.counters.outboundDenied,0);assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  });
}
