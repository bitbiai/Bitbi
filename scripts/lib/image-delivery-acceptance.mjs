import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const select=`SELECT j.*,a.billing_status,a.reservation_released_at,a.metadata_json,
 (SELECT COUNT(*) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0) AS debits
 FROM member_generation_jobs j JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id AND a.user_id=j.user_id`;

// Only already-completed, released image attempts. This acceptance invokes no
// model, changes no credit row, and leaves processing to the existing cron/queue.
export async function captureImageDeliveryRecovery(query,object) {
 const rows=await query(`${select} WHERE j.media_type='image' AND a.billing_status='released'
  AND ((j.status='outcome_unknown' AND j.attempt_count>=8) OR json_extract(j.provider_receipts_json,'$."ai-0".delivery.billing')='released_no_debit')
  ORDER BY j.created_at DESC LIMIT 10`);
 const targets=[];
 for(const row of rows){
  assert.equal(row.input_r2_key,`users/${row.user_id}/generation-jobs/${row.id}/input.json`);
  const input=JSON.parse(await object(row.input_r2_key));
  if(!['openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare'].includes(input.model))continue;
  const receipt=JSON.parse(row.provider_receipts_json)['ai-0'];
  assert.equal(receipt?.key,`users/${row.user_id}/generation-jobs/${row.id}/provider-ai-0.json`);
  assert.match(receipt.fingerprint,/^[a-f0-9]{64}$/);assert.equal(row.debits,0);assert(row.reservation_released_at);
  const bytes=await object(receipt.key),stored=JSON.parse(bytes),value=stored.kind==='response'&&stored.status===200?JSON.parse(Buffer.from(stored.body,'base64')):null;
  if(value?.state!=='Completed'||typeof value.result?.image!=='string')continue;
  targets.push({id:row.id,owner:row.user_id,receipt,receiptSha256:hash(bytes),releasedAt:row.reservation_released_at,attempts:row.status==='succeeded'?row.attempt_count-(receipt.delivery?.attempts||0):row.attempt_count});
 }
 return targets;
}

export async function verifyImageDeliveryRecovery(targets,{query,object,current,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
 const results=[];
 for(const target of targets){
  let row;
  // Bounded production acceptance in the existing protected job, not CI polling
  // or an inference retry. Cron remains the sole recovery scheduler.
  for(let read=0;read<19;read++){
   await current();[row]=await query(`${select} WHERE j.id=?`,[target.id]);
   assert(row&&row.user_id===target.owner,'Recovery owner/identity changed');
   if(row.status==='succeeded'||row.status==='failed')break;
   if(read<18)await pause(10000);
  }
  assert.equal(row.status,'succeeded','Completed image recovery has not reached durable storage');
  assert.equal(row.asset_id,target.id);assert.equal(row.billing_status,'released');assert.equal(row.reservation_released_at,target.releasedAt);assert.equal(row.debits,0);
  const receipt=JSON.parse(row.provider_receipts_json)['ai-0'];
  for(const key of ['key','fingerprint','correlationId'])assert.equal(receipt[key],target.receipt[key]);
  assert.equal(hash(await object(receipt.key)),target.receiptSha256);
  assert.equal(receipt.delivery?.status,'saved');assert.equal(receipt.delivery.billing,'released_no_debit');
  assert(row.attempt_count>target.attempts&&row.attempt_count<=target.attempts+3);
  const audit=JSON.parse(row.metadata_json).image_delivery_reconciliation;
  assert.equal(audit.receiptSha256,target.receiptSha256);assert.equal(audit.creditsCharged,0);
  const [asset]=await query('SELECT id,user_id,r2_key,size_bytes,width,height FROM ai_images WHERE id=? AND user_id=?',[target.id,target.owner]);
  assert(asset&&asset.width>0&&asset.height>0,'Recovered decoded asset missing');
  const original=await object(asset.r2_key),saved=JSON.parse(await object(row.result_r2_key));
  assert.equal(original.length,asset.size_bytes);assert.equal(saved.data.asset.id,asset.id);
  assert.equal(hash(original),hash(Buffer.from(saved.data.imageBase64,'base64')),'Saved original differs from recovered result');
  assert.equal(saved.billing.billing_status,'released_no_debit');assert.equal(saved.billing.credits_charged,0);
  results.push({job:target.id,receiptSha256:target.receiptSha256,assetSha256:hash(original),bytes:original.length,
   width:asset.width,height:asset.height,creditsCharged:0,releasePreserved:true,verifiedAt:new Date().toISOString()});
 }
 return results;
}
