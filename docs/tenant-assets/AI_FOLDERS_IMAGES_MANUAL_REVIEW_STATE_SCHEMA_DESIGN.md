# AI Folders / Images Manual Review State Schema

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current schema and safety baseline for manual-review state. This is not a historical phase narrative.

## Current Schema State

Migration `0057_add_ai_asset_manual_review_state.sql` adds:

- `ai_asset_manual_review_items`
- `ai_asset_manual_review_events`

The tables store review queue state and immutable review events for tenant asset owner-map/manual-review work.

## Current Write Boundaries

Manual-review writes may:

- create review items/events through the import executor,
- update review item status/reviewer timestamps through the status workflow,
- append immutable events.

Manual-review writes must not:

- update `ai_folders`,
- update `ai_images`,
- update ownership metadata,
- backfill ownership,
- switch access checks,
- change public/gallery state,
- move/list/delete R2 objects,
- call providers, Stripe, or Cloudflare APIs,
- mutate billing or credits.

## Current Status And Event Model

Review items use bounded statuses such as `pending_review`, `review_in_progress`, `approved_personal_user_asset`, blocked statuses such as `blocked_public_unsafe`, `deferred`, `rejected`, and `superseded`.

Events record safe review evidence such as creation/import/status changes. Responses must not expose raw prompts, provider payloads, private R2 keys, signed URLs, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, raw idempotency keys, raw request fingerprints, or unsafe metadata.

Current issue categories include `metadata_missing`, `public_unsafe`, `derivative_risk`, and `dual_read_unsafe`. The helper surface still centers review-item creation through `create_review_item_from_evidence` semantics, and the schema keeps the domain/asset lookup indexed through `idx_ai_asset_manual_review_items_domain_asset`.

Admin status writes require an `Idempotency-Key`; import dry-runs create no review rows.

## Current Evidence State

- Main owner-map evidence requires manual review.
- Manual-review operator evidence exists but needs more idempotency evidence.
- The queue/status workflow is operational evidence only; it does not prove tenant isolation or backfill/access readiness.

## Current Deployment Prerequisite

Remote migration `0057_add_ai_asset_manual_review_state.sql` must be applied before deploying Auth Worker code that depends on manual-review tables.

Remote migration `0058_add_legacy_media_reset_actions.sql` is also current release truth for reset action tracking.

## Next Audit Questions

- Is status-update replay/conflict evidence complete?
- Are any reviewed rows eligible for non-destructive backfill planning?
- Are public/gallery and derivative-risk decisions sufficiently documented?
- Are access-check changes still blocked by unresolved old rows?
