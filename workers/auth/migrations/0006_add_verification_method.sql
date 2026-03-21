-- Migration number: 0006 	 2026-03-21T00:00:00.000Z
-- Adds verification_method column to distinguish truly email-verified users
-- from legacy users who were auto-verified by migration 0004.

ALTER TABLE users ADD COLUMN verification_method TEXT;

-- Backfill: users whose email_verified_at was set to created_at by migration 0004
-- are marked as 'legacy_auto'. Truly verified users (who went through the email flow
-- after 0004) have email_verified_at != created_at and remain NULL here until they
-- re-verify, at which point they get 'email_verified'.
UPDATE users
SET verification_method = 'legacy_auto'
WHERE email_verified_at IS NOT NULL
  AND email_verified_at = created_at;
