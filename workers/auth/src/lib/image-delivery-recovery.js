import { isGptImage25Model } from '../../../../js/shared/gpt-image-25-contract.mjs';
import { readImage25Bytes } from '../../../shared/gpt-image-25.mjs';
import { nowIso } from './tokens.js';

export const IMAGE_DELIVERY_ATTEMPTS = 3;

// A completed, immutable response is permission to retrieve output, never to
// repeat inference. Keep the original request/receipt identity and billing row.
export async function retainedImageDelivery(env, job) {
  if (job.media_type !== 'image' || job.error_code === 'generation_asset_removed') return null;
  const receipt = JSON.parse(job.provider_receipts_json || '{}')['ai-0'];
  if (receipt?.key !== `users/${job.user_id}/generation-jobs/${job.id}/provider-ai-0.json`
    || !/^[a-f0-9]{64}$/.test(receipt.fingerprint || '') || receipt.rejection) return null;
  const input = await env.USER_IMAGES.get(job.input_r2_key);
  if (!input) return null;
  const model = (await new Response(input.body).json()).model;
  if (!isGptImage25Model(model)) return null;
  const object = await env.USER_IMAGES.get(receipt.key);
  if (!object) return null;
  const bytes = await readImage25Bytes(object, 32 * 1024 * 1024);
  const stored = JSON.parse(new TextDecoder().decode(bytes));
  const value = stored.kind === 'response' && stored.status === 200
    ? JSON.parse(atob(stored.body)) : stored.kind === 'json' ? stored.value : null;
  if (value?.state !== 'Completed' || typeof value.result?.image !== 'string') return null;
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return { model, receipt, sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''), attempts:receipt.delivery?.attempts || 0 };
}

export async function recordImageDelivery(env, job, patch) {
  const row = await env.DB.prepare('SELECT provider_receipts_json FROM member_generation_jobs WHERE id=? AND processing_token=?')
    .bind(job.id,job.processing_token).first();
  if (!row) throw new Error('Image delivery claim lost');
  const receipts = JSON.parse(row.provider_receipts_json), receipt = receipts['ai-0'];
  if (!receipt) throw new Error('Image delivery receipt missing');
  receipt.delivery = { version:1, attempts:1, ...receipt.delivery, ...patch, observedAt:nowIso() };
  const saved = await env.DB.prepare(`UPDATE member_generation_jobs SET provider_receipts_json=?
    WHERE id=? AND processing_token=? AND provider_receipts_json=? AND locked_until>?`)
    .bind(JSON.stringify(receipts),job.id,job.processing_token,row.provider_receipts_json,nowIso()).run();
  if (!saved.meta?.changes) throw new Error('Image delivery claim lost');
  return receipt.delivery;
}

export async function checkpointReleasedImageDelivery(env, execution, attempt, result) {
  const {job,retainedImage}=execution;
  if (!retainedImage || !execution.creditReview || retainedImage.model!==result.model
    || !result.tempKey || !result.saveReference) throw new Error('Released image delivery is not authorized');
  await execution.assertClaim();
  const evidence={policy:'retained_completed_image_no_retroactive_debit',actor:'system:member-generation',jobId:job.id,
    receiptSha256:retainedImage.sha256,correlationId:retainedImage.receipt.correlationId,
    deliveredAt:nowIso(),creditsCharged:0};
  const updated=await env.DB.prepare(`UPDATE member_ai_usage_attempts_v2 SET result_status='stored',result_temp_key=?,
    result_save_reference=?,result_mime_type=?,result_model=?,
    metadata_json=json_set(metadata_json,'$.image_delivery_reconciliation',json(?))
    WHERE id=? AND user_id=? AND dispatch_token=? AND billing_status='released' AND reservation_released_at IS NOT NULL
    AND provider_outcome='unknown' AND late_outcome='succeeded'
    AND EXISTS(SELECT 1 FROM member_generation_jobs j WHERE j.id=? AND j.usage_attempt_id=member_ai_usage_attempts_v2.id
      AND j.user_id=member_ai_usage_attempts_v2.user_id AND j.processing_token=? AND j.locked_until>? AND j.status='processing')`)
    .bind(result.tempKey,result.saveReference,result.mimeType,result.model,JSON.stringify(evidence),attempt.id,attempt.userId,
      attempt.dispatchToken,job.id,job.processing_token,nowIso()).run();
  if(!updated.meta?.changes)throw new Error('Released image delivery checkpoint rejected');
}
