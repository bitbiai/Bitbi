-- Phase 4.5 admin async video job budget metadata.
-- Additive only: stores sanitized Admin/Platform budget policy evidence for
-- admin async video jobs before provider-cost queue processing.

ALTER TABLE ai_video_jobs ADD COLUMN budget_policy_json TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN budget_policy_status TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN budget_policy_fingerprint TEXT;
ALTER TABLE ai_video_jobs ADD COLUMN budget_policy_version TEXT;

