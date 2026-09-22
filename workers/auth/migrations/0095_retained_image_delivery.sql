-- A released reservation is not a debit. Only a completed, audited delivery of
-- the exact retained GPT Image 2.5 receipt may become an accessible asset.
DROP VIEW member_generation_unready_assets;
CREATE VIEW member_generation_unready_assets AS
SELECT jobs.id FROM member_generation_jobs jobs JOIN member_ai_usage_attempts_v2 usage ON usage.id=jobs.usage_attempt_id
WHERE usage.billing_status <> 'finalized' AND NOT COALESCE((
 jobs.user_id=usage.user_id AND jobs.media_type='image' AND jobs.status='succeeded' AND jobs.asset_id=jobs.id
 AND jobs.result_r2_key IS NOT NULL AND jobs.error_code IS NULL
 AND usage.billing_status='released' AND usage.reservation_released_at IS NOT NULL
 AND usage.provider_outcome='unknown' AND usage.late_outcome='succeeded' AND usage.result_status='stored'
 AND usage.result_model IN ('openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare')
 AND COALESCE(json_extract(usage.metadata_json,'$.image_delivery_reconciliation.policy'),'')='retained_completed_image_no_retroactive_debit'
 AND COALESCE(json_extract(usage.metadata_json,'$.image_delivery_reconciliation.jobId'),'')=jobs.id
 AND json_extract(usage.metadata_json,'$.image_delivery_reconciliation.creditsCharged')=0
 AND length(json_extract(usage.metadata_json,'$.image_delivery_reconciliation.receiptSha256'))=64
 AND json_extract(usage.metadata_json,'$.image_delivery_reconciliation.receiptSha256')=json_extract(jobs.provider_receipts_json,'$."ai-0".delivery.receiptSha256')
 AND json_extract(jobs.provider_receipts_json,'$."ai-0".delivery.status')='saved'
 AND json_extract(jobs.provider_receipts_json,'$."ai-0".delivery.billing')='released_no_debit'
),0);
