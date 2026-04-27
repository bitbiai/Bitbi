-- Phase Pricing / Credit Purchase: allow product-facing Testmode credit packs
-- to be granted without tripping the original small Phase 2-B free-plan cap.

UPDATE entitlements
SET value_numeric = 100000,
    updated_at = '2026-04-27T00:00:00.000Z'
WHERE plan_id = 'plan_free'
  AND feature_key = 'credits.balance.max'
  AND value_kind = 'number'
  AND value_numeric < 100000;
