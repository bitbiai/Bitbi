import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { CONSUMER_TERMS_VERSION, CREDIT_PACK_PERFORMANCE_CONSENT_VERSION, creditPackPerformanceConsentText } from '../js/shared/consumer-contract.mjs';
import { persistConsumerContractSnapshot, prepareConsumerContractSnapshot } from '../workers/auth/src/lib/consumer-contracts.js';
import { CONSUMER_TERMS_CONTENT as HISTORICAL_TERMS } from '../workers/auth/src/lib/consumer-terms-content-2026-10-23.js';
import { sha256Hex } from '../workers/auth/src/lib/tokens.js';
import { prepareTransactionalMessage } from '../workers/auth/src/lib/transactional-messages.js';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

// Signed Stripe HTTP reaches the actual candidate; snapshots seed only accepted
// checkout evidence. All commits, triggers and mail claims use native workerd D1.
export async function runConsumerContractBillingTests(f,{seed}) {
  const {db,sql,rows,scalar,test}=f;
  const acceptance={termsVersion:'2026-10-25',locale:'de',termsAccepted:true,earlyStartRequested:true,consentVersion:'consumer-v1'};
  async function accepted(index) {
    const s=await seed(index);
    await sql('UPDATE billing_member_subscription_checkout_sessions SET metadata_json=? WHERE id=?',JSON.stringify(acceptance),s.id).run();
    await persistConsumerContractSnapshot({DB:db},{checkoutId:s.id,userId:s.user,scope:'member_subscription',acceptance,
      offer:{id:'bitbi_pro_monthly',name:'BITBI Pro',allowanceCredits:6000,storageLimitBytes:5*1024**3,amountCents:999,currency:'eur',interval:'month'}});
    return s;
  }
  await test('q4_consumer_native_confirmation_outbox_failure_rolls_back_grant_and_original_receipt_retries_once',async()=>{
    const s=await accepted(200),invoice=s.invoice();
    await sql("CREATE TRIGGER consumer_mail_fault BEFORE INSERT ON transactional_messages WHEN NEW.kind='contract_confirmation' BEGIN SELECT RAISE(ABORT,'consumer confirmation fault'); END").run();
    const failed=await s.deliver(invoice);assert.equal(failed.status,503);assert.equal(await s.credits(),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_contract_confirmations WHERE checkout_id=?',s.id),0);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM billing_provider_events WHERE provider_event_id=?',invoice.id),1);
    await sql('DROP TRIGGER consumer_mail_fault').run();
    const successful=await s.deliver(invoice);assert.equal(successful.status,200);assert.equal(await s.credits(),1);
    assert.equal((await s.deliver(invoice)).body.creditGrant.creditsGranted,0);assert.equal(await s.credits(),1);
    const row=await sql('SELECT * FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first(),doc=JSON.parse(row.document_json);
    assert.equal(doc.snapshot.consent.extinction,'not_determined');assert.equal(doc.snapshot.consent.withdrawalKnowledgeAccepted,false);
    assert.ok(doc.text.includes('Widerruf')&&doc.text.length>6000);assert.equal(doc.payment.providerEventId,invoice.id);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM transactional_messages WHERE source_id=?',s.id),1);
    assert.equal((await sql('SELECT state,delivered_at FROM transactional_messages WHERE source_id=?',s.id).first()).state,'queued');
    await expectNativeRejection(()=>sql("UPDATE consumer_contract_confirmations SET document_json='{}' WHERE checkout_id=?",s.id).run(),'immutable');
    await expectNativeRejection(()=>sql("UPDATE consumer_contract_snapshots SET snapshot_json='{}' WHERE checkout_id=?",s.id).run(),'immutable');
    // Recurring payment is not a new consent or another contract-confirmation message.
    const next=s.invoice('renewal',{start:Math.floor(Date.now()/1000)+40*86400,end:Math.floor(Date.now()/1000)+70*86400});
    assert.equal((await s.deliver(next)).status,202);assert.equal(await s.credits(),2);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM transactional_messages WHERE source_id=?',s.id),1);
  });
  await test('q4_consumer_native_current_snapshot_required_but_legacy_checkout_preserved',async()=>{
    const missing=await seed(201);await sql('UPDATE billing_member_subscription_checkout_sessions SET metadata_json=? WHERE id=?',JSON.stringify(acceptance),missing.id).run();
    assert.ok((await missing.deliver(missing.invoice())).status>=500);assert.equal(await missing.credits(),0);
    const legacy=await seed(202);assert.equal((await legacy.deliver(legacy.invoice())).status,202);assert.equal(await legacy.credits(),1);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_contract_confirmations WHERE checkout_id=?',legacy.id),0);
  });
  await test('q4_consumer_native_delayed_historical_snapshot_survives_new_version_invoice_renewal_and_duplicate',async()=>{
    const s=await seed(203);
    // Model the already accepted immutable v1 row, without using new-checkout
    // admission to mint old consent. All subsequent fulfillment uses signed HTTP.
    const prepared=await prepareConsumerContractSnapshot({DB:db},{checkoutId:s.id,userId:s.user,scope:'member_subscription',acceptance,
      offer:{id:'bitbi_pro_monthly',name:'BITBI Pro',allowanceCredits:6000,storageLimitBytes:5*1024**3,amountCents:999,currency:'eur',interval:'month'}});
    const snapshot={...prepared.snapshot,terms:HISTORICAL_TERMS.de};delete snapshot.offer.contractSummary;
    snapshot.consent.wording.terms='Ich akzeptiere die BITBI-Nutzungsbedingungen vom 23.10.2026.';
    snapshot.acceptedAt='2026-10-23T12:00:00.000Z';
    const json=JSON.stringify(snapshot),hash=await sha256Hex(json);
    await sql('INSERT INTO consumer_contract_snapshots(checkout_id,user_id,checkout_scope,terms_version,locale,snapshot_json,snapshot_hash,accepted_at) VALUES (?,?,?,?,?,?,?,?)',
      s.id,s.user,'member_subscription','2026-10-23','de',json,hash,snapshot.acceptedAt).run();
    await sql('UPDATE billing_member_subscription_checkout_sessions SET metadata_json=? WHERE id=?',JSON.stringify({...acceptance,termsVersion:'2026-10-23'}),s.id).run();
    const invoice=s.invoice();assert.equal((await s.deliver(invoice)).status,202);assert.equal(await s.credits(),1);
    const original=await sql('SELECT * FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first();
    const doc=JSON.parse(original.document_json);assert.deepEqual(doc.snapshot,snapshot);assert.ok(doc.text.includes(HISTORICAL_TERMS.de.text));
    assert.ok(doc.text.includes('auf 6.000 Credits aufgefüllt'));
    await sql("UPDATE transactional_messages SET state='sending',attempt_count=1,error_code='mail_acceptance_unknown' WHERE source_id=?",s.id).run();
    const originalMail=await sql('SELECT * FROM transactional_messages WHERE source_id=?',s.id).first();
    assert.equal((await s.deliver(invoice)).status,200);assert.equal(await s.credits(),1);
    const renewal=s.invoice('renewal',{start:Math.floor(Date.now()/1000)+40*86400,end:Math.floor(Date.now()/1000)+70*86400});
    assert.equal((await s.deliver(renewal)).status,202);assert.equal(await s.credits(),2);
    assert.deepEqual(await sql('SELECT * FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first(),original);
    assert.deepEqual(await sql('SELECT * FROM transactional_messages WHERE source_id=?',s.id).first(),originalMail);
    assert.deepEqual(await sql('SELECT snapshot_json,snapshot_hash FROM consumer_contract_snapshots WHERE checkout_id=?',s.id).first(),{snapshot_json:json,snapshot_hash:hash});
  });
  await test('q4_consumer_native_mail_claim_and_expired_unknown_keep_contract_receipt_without_send',async()=>{
    const now=new Date().toISOString();
    const message=await prepareTransactionalMessage({DB:db},{id:'contract:native-no-config',sourceId:'native-no-config',kind:'contract_confirmation',recipientEmail:'synthetic@example.invalid',subject:'Contract receipt',text:'Synthetic durable content',now});
    await message.statement.run();
    const response=await f.control('/consumer-mail',{});assert.equal(response.status,200);
    assert.deepEqual(await sql('SELECT state,error_code FROM transactional_messages WHERE id=?','contract:native-no-config').first(),{state:'review_required',error_code:'mail_config_unavailable'});
    await sql("UPDATE transactional_messages SET state='sending',attempt_count=5,first_attempt_at=?,lease_expires_at=? WHERE id=?",new Date(Date.now()-24*60*60_000).toISOString(),new Date(Date.now()-60_000).toISOString(),'contract:native-no-config').run();
    assert.equal((await f.control('/consumer-mail',{})).status,200);
    assert.deepEqual(await sql('SELECT state,attempt_count,error_code FROM transactional_messages WHERE id=?','contract:native-no-config').first(),{state:'review_required',attempt_count:5,error_code:'mail_outcome_requires_review'});
    assert.equal(f.counters.outboundDenied,0);assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  });
  await runPackMailTests(f);
}

async function runPackMailTests(f) {
  const {db,sql,scalar,test,consumerMailProvider:provider}=f;
  const mail=id=>sql('SELECT * FROM transactional_messages WHERE id=?',`contract:${id}`).first();
  const sends=id=>provider.requests.filter(row=>row.method==='POST'&&row.key===`bitbi/contract:${id}`);
  const runMail=async minutes=>{
    const response=await f.control('/consumer-mail',{syntheticDelivery:true,now:new Date(Date.now()+minutes*60_000).toISOString()});
    assert.equal(response.status,200);return response.json();
  };
  async function acceptedPack(suffix,locale) {
    const id=`q4-native-pack-${suffix}`,user=id,session=`cs_live_native_pack_${suffix}`,now=new Date().toISOString();
    const acceptance={termsVersion:CONSUMER_TERMS_VERSION,locale,termsAccepted:true,earlyStartRequested:true,
      creditPackPerformanceConsent:true,creditPackConsentVersion:CREDIT_PACK_PERFORMANCE_CONSENT_VERSION,
      creditPackConsentText:creditPackPerformanceConsentText(locale)};
    await sql("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,'synthetic-unused',?,'user','active',?)",user,`${user}@example.invalid`,now,now).run();
    await sql(`INSERT INTO billing_member_checkout_sessions(id,provider,provider_mode,provider_checkout_session_id,user_id,credit_pack_id,
      credits,amount_cents,currency,status,idempotency_key_hash,request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
      VALUES(?,'stripe','live',?,?,'live_credits_5000',5000,999,'eur','created',?,?,'member',?,?,?)`,
      id,session,user,await sha256Hex(id),await sha256Hex(`request:${id}`),JSON.stringify(acceptance),now,now).run();
    const snapshot=await persistConsumerContractSnapshot({DB:db},{checkoutId:id,userId:user,scope:'member',acceptance,
      offer:{id:'live_credits_5000',name:'Starter Credits',credits:5000,amountCents:999,currency:'eur'}});
    const payload={id:`evt_native_pack_${suffix}`,object:'event',type:'checkout.session.completed',livemode:true,created:Math.floor(Date.now()/1000),data:{object:{
      id:session,object:'checkout.session',livemode:true,mode:'payment',payment_status:'paid',amount_total:999,currency:'eur',
      customer:`cus_native_pack_${suffix}`,payment_intent:`pi_native_pack_${suffix}`,payment_method_details:{type:'card'},
      metadata:{checkout_scope:'member',user_id:user,credit_pack_id:'live_credits_5000',credits:'5000',internal_checkout_session_id:id},
    }}};
    const deliver=async(event=payload,badSignature=false)=>{
      const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),digest=createHmac('sha256',f.webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
      const response=await f.control('/consumer-pack-webhook',{raw,signature:`t=${timestamp},v1=${badSignature?'0'.repeat(64):digest}`});
      assert.equal(response.status,200);return response.json();
    };
    return {id,user,snapshot,payload,deliver,grants:()=>scalar('SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=?',user)};
  }
  await test('q4_consumer_native_old_redirect_error_is_rejected_before_any_provider_request',async()=>{
    const response=await f.control('/consumer-mail-redirect-contract',{});assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{name:'TypeError',invalidRedirect:true});
    assert.equal(provider.requests.length,0);assert.equal(provider.paymentRequests.length,0);assert.equal(f.counters.outboundDenied,0);
  });
  await test('q4_consumer_native_realistic_payment_intent_lookup_reaches_provider_and_pins_charged_method',async()=>{
    const s=await acceptedPack('payment-method','en');delete s.payload.data.object.payment_method_details;
    s.payload.data.object.payment_intent='pi_3NativePackContractMethod';
    provider.paymentIntent={id:s.payload.data.object.payment_intent,livemode:true,customer:s.payload.data.object.customer,latest_charge:{payment_method_details:{type:'sepa_debit'}}};
    assert.equal((await s.deliver()).status,202);
    const document=JSON.parse((await sql('SELECT document_json FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first()).document_json);
    assert.equal(provider.paymentRequests.length,1);assert.equal(document.payment.method,'SEPA direct debit');
    assert.equal((await s.deliver()).body.creditGrant.creditsGranted,0);assert.equal(provider.paymentRequests.length,1);assert.equal(await s.grants(),1);
  });
  for(const locale of ['de','en'])await test(`q4_consumer_native_${locale}_signed_pack_immediate_mail_ignores_backlog_and_observes_delivery`,async()=>{
    const s=await acceptedPack(`delivered-${locale}`,locale);
    assert.equal((await s.deliver(s.payload,true)).status,401);assert.equal(await s.grants(),0);assert.equal(await mail(s.id),null);
    const backlog=[];
    for(let i=0;i<3;i++){
      const id=`q4-native-pack-backlog-${locale}-${i}`;backlog.push(id);
      const prepared=await prepareTransactionalMessage({DB:db,RESEND_FROM_EMAIL:'receipts@example.invalid'},{id:`contract:${id}`,sourceId:id,
        kind:'contract_confirmation',recipientEmail:`${id}@example.invalid`,subject:'Earlier synthetic receipt',text:'Earlier accepted contract',now:new Date(Date.now()-60_000).toISOString()});
      await prepared.statement.run();
    }
    const fulfilled=await s.deliver();assert.equal(fulfilled.status,202);assert.equal(fulfilled.body.creditGrant.creditsGranted,5000);
    assert.ok(fulfilled.waitUntilCount>0);assert.equal(await s.grants(),1);
    const confirmation=await sql('SELECT * FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first();
    const document=JSON.parse(confirmation.document_json);assert.deepEqual(document.snapshot,s.snapshot);
    assert.ok(document.text.includes(s.snapshot.terms.text));assert.equal(document.payment.method,locale==='de'?'Karte':'Card');
    const sent=await mail(s.id);assert.equal(sent.state,'accepted');assert.ok(sent.accepted_at);assert.equal(sent.delivered_at,null);
    assert.equal(sends(s.id).length,1);assert.equal(sends(s.id)[0].body.text,document.text);
    for(const id of backlog){assert.equal((await mail(id)).state,'queued');assert.equal(sends(id).length,0);}
    const replay=await Promise.all([s.deliver(),s.deliver()]);assert.ok(replay.every(row=>row.status===200&&row.body.creditGrant.creditsGranted===0));
    assert.equal(await s.grants(),1);assert.equal(sends(s.id).length,1);
    // An invoice event for this one-time payment neither grants again nor sends
    // another contract document; the signed checkout remains the authority.
    const invoice={...s.payload,id:`evt_native_pack_invoice_${locale}`,type:'invoice.paid',data:{object:{id:`in_native_pack_${locale}`,object:'invoice',livemode:true,
      customer:s.payload.data.object.customer,amount_paid:999,currency:'eur',status:'paid',metadata:s.payload.data.object.metadata,lines:{data:[]}}}};
    const ignored=await s.deliver(invoice);assert.ok([200,202].includes(ignored.status));assert.equal(await s.grants(),1);assert.equal(sends(s.id).length,1);
    if(locale==='de'){
      provider.observationRedirect=true;await runMail(6);provider.observationRedirect=false;
      assert.equal((await mail(s.id)).state,'accepted');assert.equal((await mail(s.id)).error_code,'mail_observation_unavailable');
      assert.equal((await mail(s.id)).delivered_at,null);assert.equal(sends(s.id).length,1);assert.equal(f.counters.outboundDenied,0);
    }
    await runMail(locale==='de'?37:6);assert.equal((await mail(s.id)).state,'delivered');assert.ok((await mail(s.id)).delivered_at);
    assert.equal(sends(s.id).length,1);assert.deepEqual(await sql('SELECT * FROM consumer_contract_confirmations WHERE checkout_id=?',s.id).first(),confirmation);
  });
  await test('q4_consumer_native_unknown_mail_acceptance_retries_same_identity_once_without_duplicate_credit_or_message',async()=>{
    const s=await acceptedPack('unknown','de');provider.loseNextAcknowledgement=true;
    assert.equal((await s.deliver()).status,202);assert.equal(await s.grants(),1);
    const uncertain=await mail(s.id);assert.equal(uncertain.state,'queued');assert.equal(uncertain.error_code,'mail_acceptance_unknown');
    assert.equal(uncertain.provider_message_id,null);assert.equal(uncertain.delivered_at,null);assert.equal(sends(s.id).length,1);
    assert.ok(provider.accepted.has(`bitbi/contract:${s.id}`),'The synthetic provider accepted the original key despite a lost identity acknowledgement');
    await Promise.all([runMail(3),runMail(3)]);
    const accepted=await mail(s.id);assert.equal(accepted.state,'accepted');assert.equal(accepted.attempt_count,2);assert.equal(accepted.delivered_at,null);
    assert.equal(sends(s.id).length,2);assert.equal(sends(s.id)[0].raw,sends(s.id)[1].raw);
    assert.equal((await s.deliver()).body.creditGrant.creditsGranted,0);assert.equal(await s.grants(),1);assert.equal(sends(s.id).length,2);
    await runMail(9);assert.equal((await mail(s.id)).state,'delivered');assert.equal(sends(s.id).length,2);
    assert.equal(await scalar('SELECT COUNT(*) AS value FROM consumer_contract_confirmations WHERE checkout_id=?',s.id),1);
    assert.equal(f.counters.outboundDenied,0);assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
  });
  await test('q4_consumer_native_mail_redirect_is_not_followed_and_keeps_committed_contract_and_grant',async()=>{
    const s=await acceptedPack('redirect','en');provider.redirectNextSend=true;
    assert.equal((await s.deliver()).status,202);assert.equal(await s.grants(),1);
    const row=await mail(s.id);assert.equal(row.state,'review_required');assert.equal(row.error_code,'mail_http_302');
    assert.equal(row.provider_message_id,null);assert.equal(row.delivered_at,null);assert.equal(sends(s.id).length,1);
    assert.equal(provider.accepted.has(`bitbi/contract:${s.id}`),false);assert.equal(f.counters.outboundDenied,0);
    assert.equal((await s.deliver()).body.creditGrant.creditsGranted,0);assert.equal(sends(s.id).length,1);
  });
}
