import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BITBI_GENERATION_TIMEOUT_MS} from '../../js/shared/generation-timeout.mjs';
// The two authorized incidents, not a best-effort sample of recent jobs.
export const IMAGE_DELIVERY_INCIDENTS = Object.freeze([
 Object.freeze({id:'6779ba33ae9043a715c68940387a2edf',model:'openai/gpt-image-2.5-sunburst'}),
 Object.freeze({id:'404b60bbdd0863323a5db28124850515',model:'openai/gpt-image-2.5-flare'}),
]);
const MAX_ATTEMPTS=3, CRON_MS=5*60_000, RETRY_MS=60_000, STORAGE_MS=2*60_000, POLL_MS=10_000;
// One cron interval, all three existing processing deadlines, two queue retry
// delays and storage/readback margin. Both jobs share this absolute deadline.
export const IMAGE_DELIVERY_ACCEPTANCE_MS=CRON_MS+MAX_ATTEMPTS*BITBI_GENERATION_TIMEOUT_MS+(MAX_ATTEMPTS-1)*RETRY_MS+STORAGE_MS;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const select=`SELECT j.*,a.billing_status,a.reservation_released_at,a.metadata_json,
 (SELECT COUNT(*) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0) AS debits
 FROM member_generation_jobs j JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id AND a.user_id=j.user_id`;

function exactIncidents(rows,key) {
 assert(Array.isArray(rows),'Missing image recovery acceptance');
 assert.deepEqual(rows.map(row=>row[key]).sort(),IMAGE_DELIVERY_INCIDENTS.map(row=>row.id).sort(),'Both exact image incidents are required, without duplicates or unrelated jobs');
}

export function verifyImageDeliveryEvidence(results) {
 exactIncidents(results,'job');
 for(const result of results){
  for(const key of ['receiptSha256','assetSha256','resultSha256'])assert.match(result[key]||'',/^[a-f0-9]{64}$/,'Missing authenticated recovery digest');
  assert(result.bytes>0&&result.width>0&&result.height>0,'Missing recovered image');
  assert.equal(result.creditsCharged,0);assert.equal(result.releasePreserved,true);
  assert.equal(result.visibilityFenceCleared,true,'Recovered asset is not available to its owner');
  assert(Number.isFinite(Date.parse(result.verifiedAt)),'Missing recovery observation');
 }
}

// Only already-completed, released image attempts. This acceptance invokes no
// model, changes no credit row, and leaves processing to the existing cron/queue.
export async function captureImageDeliveryRecovery(query,object) {
 const rows=await query(`${select} WHERE j.id IN (?,?)`,IMAGE_DELIVERY_INCIDENTS.map(row=>row.id));
 exactIncidents(rows,'id');
 const targets=[];
 for(const row of rows){
  assert.equal(row.media_type,'image');assert.equal(row.billing_status,'released');
  assert(['outcome_unknown','queued','processing','ingesting','succeeded'].includes(row.status),`Image recovery is terminal: ${row.id}`);
  assert(!['generation_asset_removed','generation_output_delivery_failed'].includes(row.error_code),`Image recovery cannot continue: ${row.id}`);
  assert.equal(row.input_r2_key,`users/${row.user_id}/generation-jobs/${row.id}/input.json`);
  const inputBytes=await object(row.input_r2_key),input=JSON.parse(inputBytes);
  assert.equal(input.model,IMAGE_DELIVERY_INCIDENTS.find(incident=>incident.id===row.id).model,'Wrong incident model');
  const receipt=JSON.parse(row.provider_receipts_json)['ai-0'];
  assert.equal(receipt?.key,`users/${row.user_id}/generation-jobs/${row.id}/provider-ai-0.json`);
  assert.match(receipt.fingerprint,/^[a-f0-9]{64}$/);assert.match(receipt.correlationId,/^[a-f0-9]{32}$/);assert.equal(row.debits,0);assert(row.reservation_released_at);
  const bytes=await object(receipt.key),stored=JSON.parse(bytes),value=stored.kind==='response'&&stored.status===200?JSON.parse(Buffer.from(stored.body,'base64')):null;
  assert(value?.state==='Completed'&&typeof value.result?.image==='string','Missing authenticated completed provider result');
  const deliveryAttempts=receipt.delivery?.attempts??0,attempts=row.attempt_count-deliveryAttempts;
  assert(Number.isInteger(deliveryAttempts)&&deliveryAttempts>=0&&deliveryAttempts<=MAX_ATTEMPTS&&attempts>=8,'Invalid recovery attempt history');
  assert(row.usage_attempt_id,'Missing original usage attempt');
  targets.push({id:row.id,owner:row.user_id,usageAttempt:row.usage_attempt_id,inputKey:row.input_r2_key,inputSha256:hash(inputBytes),receipt,receiptSha256:hash(bytes),releasedAt:row.reservation_released_at,attempts});
 }
 return targets;
}

export async function verifyImageDeliveryRecovery(targets,{query,object,current,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>performance.now()}) {
 exactIncidents(targets,'id');
 const deadline=now()+IMAGE_DELIVERY_ACCEPTANCE_MS,completed=new Map();
 // Observe both targets in each round: failure of the second must not be hidden
 // behind a pending first target. No retry, dispatch or credit mutation here.
 while(completed.size<targets.length){
  await current();
  for(const target of targets.filter(target=>!completed.has(target.id))){
   const [row]=await query(`${select} WHERE j.id=?`,[target.id]);
   assert(row&&row.id===target.id&&row.user_id===target.owner,'Recovery owner/identity changed');
   assert.equal(row.usage_attempt_id,target.usageAttempt,'Recovery usage attempt changed');
   assert.equal(row.billing_status,'released');assert.equal(row.debits,0);
   assert(['outcome_unknown','queued','processing','ingesting','succeeded'].includes(row.status),`Image recovery is terminal: ${target.id}`);
   assert(!['generation_asset_removed','generation_output_delivery_failed'].includes(row.error_code),`Image recovery cannot continue: ${target.id}`);
   assert.notEqual(JSON.parse(row.provider_receipts_json)['ai-0']?.delivery?.status,'failed',`Image delivery failed: ${target.id}`);
   if(row.status==='succeeded')completed.set(target.id,row);
  }
  assert(now()<=deadline,'Completed image recovery has not reached durable storage within its cron/processing deadline');
  if(completed.size<targets.length)await pause(Math.min(POLL_MS,Math.max(1,deadline-now())));
 }
 const results=[];
 for(const target of targets){
  await current();
  const row=completed.get(target.id);
  assert.equal(row.status,'succeeded','Completed image recovery has not reached durable storage');
  assert.equal(row.asset_id,target.id);assert.equal(row.billing_status,'released');assert.equal(row.reservation_released_at,target.releasedAt);assert.equal(row.debits,0);
  const receipt=JSON.parse(row.provider_receipts_json)['ai-0'];
  assert.equal(row.input_r2_key,target.inputKey);assert.equal(hash(await object(target.inputKey)),target.inputSha256,'Recovery input changed');
  for(const key of ['key','fingerprint','correlationId'])assert.equal(receipt[key],target.receipt[key]);
  assert.equal(hash(await object(receipt.key)),target.receiptSha256);
  assert.equal(receipt.delivery?.status,'saved');assert.equal(receipt.delivery.billing,'released_no_debit');
  assert(row.attempt_count>target.attempts&&row.attempt_count<=target.attempts+3);
  const audit=JSON.parse(row.metadata_json).image_delivery_reconciliation;
  assert.equal(audit.receiptSha256,target.receiptSha256);assert.equal(audit.creditsCharged,0);
  const [asset]=await query('SELECT id,user_id,r2_key,size_bytes,width,height FROM ai_images WHERE id=? AND user_id=?',[target.id,target.owner]);
  assert(asset&&asset.width>0&&asset.height>0,'Recovered decoded asset missing');
  assert.equal(asset.id,target.id);assert.equal(asset.user_id,target.owner);
  assert.deepEqual(await query('SELECT id FROM member_generation_unready_assets WHERE id=?',[target.id]),[],'Recovered image remains hidden by the unfinished-asset guard');
  assert(asset.r2_key.startsWith(`users/${target.owner}/`),'Foreign original object');
  assert.equal(row.result_r2_key,`users/${target.owner}/generation-jobs/${target.id}/result.json`);
  const original=await object(asset.r2_key),resultBytes=await object(row.result_r2_key),saved=JSON.parse(resultBytes);
  assert.equal(original.length,asset.size_bytes);assert.equal(saved.data.asset.id,asset.id);
  assert.equal(hash(original),hash(Buffer.from(saved.data.imageBase64,'base64')),'Saved original differs from recovered result');
  assert.equal(saved.billing.billing_status,'released_no_debit');assert.equal(saved.billing.credits_charged,0);
  results.push({job:target.id,receiptSha256:target.receiptSha256,assetSha256:hash(original),resultSha256:hash(resultBytes),bytes:original.length,
   width:asset.width,height:asset.height,creditsCharged:0,releasePreserved:true,visibilityFenceCleared:true,verifiedAt:new Date().toISOString()});
 }
 verifyImageDeliveryEvidence(results);
 return results;
}
