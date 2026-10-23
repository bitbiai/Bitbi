import assert from 'node:assert/strict';
import { persistConsumerContractSnapshot } from '../workers/auth/src/lib/consumer-contracts.js';
import { prepareTransactionalMessage } from '../workers/auth/src/lib/transactional-messages.js';
import { expectNativeRejection } from './helpers/q2-runtime/assertions.mjs';

// Signed Stripe HTTP reaches the actual candidate; snapshots seed only accepted
// checkout evidence. All commits, triggers and mail claims use native workerd D1.
export async function runConsumerContractBillingTests(f,{seed}) {
  const {db,sql,rows,scalar,test}=f;
  const acceptance={termsVersion:'2026-10-23',locale:'de',termsAccepted:true,earlyStartRequested:true,consentVersion:'consumer-v1'};
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
}
