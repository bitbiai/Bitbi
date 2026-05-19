# Tenant Asset Domain Expansion Roadmap

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0059_add_data_lifecycle_completion_state.sql`.

Purpose: current-state roadmap for expanding tenant asset ownership evidence beyond folders/images. This is not approval for backfill, access-switching, confirmed reset, deletion, tenant isolation, live billing, or production readiness.

## Current Covered Domains

- `ai_folders` and `ai_images`: ownership metadata exists for new rows only; legacy rows remain evidence-pending.
- `ai_image_derivatives`: represented through parent image rows and redacted derivative counts only.
- `ai_asset_manual_review_items` and `ai_asset_manual_review_events`: manual-review workflow exists, but idempotency evidence remains pending.
- `tenant_asset_media_reset_actions` and `tenant_asset_media_reset_action_events`: reset action tracking exists; confirmed execution remains hard-disabled by default.
- `user_asset_storage_usage`: quota/accounting rows exist; admin D1-only storage reconciliation dry-run now reports recorded usage, known metadata bytes, deltas, and missing metadata without R2 listing.

## Deferred Domains

- `ai_text_assets`, text asset posters, member music/audio assets, member video assets, and generated video outputs.
- Public gallery references: Mempics, Memvids, and Memtracks.
- Profile avatars, private media, public media, lifecycle exports, audit/evidence archives, platform/admin generated assets, and unknown legacy media rows.
- R2 object families `USER_IMAGES`, `PRIVATE_MEDIA`, and `AUDIT_ARCHIVE` are not ownership sources by themselves; they require D1 parent/evidence mapping.

## Current Admin Visibility

- `GET /api/admin/tenant-assets/domains/evidence` provides an admin/MFA read-only cross-domain registry and evidence-readiness report.
- The Admin Tenant Asset Center renders the domain matrix, blocked claims, evidence template paths, and storage safety guidance.
- Admin selected-user storage reconciliation is available at `GET /api/admin/users/:id/storage/reconciliation`.
- Admin Tenant Isolation Execution controls now surface Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset together with warning/exclamation explainers, dry-run/diagnostics, evidence export, exact confirmation requirements, and disabled reasons. This is an operator control plane, not approval to execute in production.
- These surfaces are bounded, redacted, D1-metadata based, and do not list or mutate R2.

## Proposed Later Additive Migrations

Do not add these automatically. Each requires a separate approved migration package:

- Add ownership metadata or verified ownership inheritance for `ai_text_assets`.
- Add explicit parent ownership/evidence linkage for text posters, saved audio, saved video, and generated video job outputs.
- Add public gallery depublish/evidence records for Mempics, Memvids, and Memtracks before reset/delete claims.
- Add profile/avatar ownership/deletion evidence if avatars become part of tenant isolation claims.
- Add indexes only after query-shape evidence shows a specific admin/report path needs one.

## Evidence Required Before Ownership Backfill

- Use the Admin Ownership Backfill dry-run and evidence export first. The write endpoint remains high-risk and requires Admin/MFA, `Idempotency-Key`, reason, explicit domain scope, bounded batch limit, and exact typed confirmation `BACKFILL OWNERSHIP`.
- Sanitized owner-map evidence for all covered and newly added domains.
- Manual-review replay/conflict/status-success evidence accepted for the review workflow.
- Storage reconciliation evidence showing recorded counters, D1 metadata bytes, missing-byte rows, and orphan metadata.
- Remote migration verification through the current release checkpoint.
- Operator sign-off that raw private R2 keys, idempotency keys, request hashes, cookies, tokens, and secrets are absent from committed evidence.
- Unsafe, public, missing-evidence, manual-review, deferred-domain, and legacy-unclassified rows must remain blocked unless separately reviewed and approved.

## Evidence Required Before Access Switch

- Use the Admin Access-Switch shadow diagnostics before any mode change. The current repo status reports enforced runtime switching as blocked because no durable enforced switch state is approved.
- Backfilled or inherited ownership state must be proven complete for the target domain.
- Dual-read comparison must show no unsafe divergence between legacy user checks and proposed owner checks.
- Public/gallery depublish behavior must be reviewed separately.
- Rollback must preserve legacy user-scoped access checks.
- Tests must prove cross-tenant denial, same-tenant access, public route behavior, and redacted admin evidence.

## Evidence Required Before Confirmed Reset Or Deletion

- Review Backfill and Access-Switch evidence before considering reset. The Admin reset control remains warning-gated and confirmed execution is disabled by default.
- Sanitized legacy reset dry-run evidence must be accepted for dry-run only.
- Confirmed execution must remain blocked until a future approved confirmation package explicitly authorizes it.
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` must stay disabled unless a separate operator-approved phase enables it.
- Storage quota before/after evidence must be available.
- R2 cleanup must use approved D1-derived keys only; no live R2 listing is acceptable as a Codex step.

## Required Tests For Future Packages

- Registry coverage tests so known domains cannot silently disappear.
- Admin endpoint tests for auth/MFA, bounded output, redaction, no mutation, and blocked claims.
- Backfill tests for idempotency, replay/conflict behavior, dry-run mode, and rollback records.
- Access-switch tests for same-user, cross-user, org, public, and legacy rows.
- Reset/delete tests for default-off gates, confirmation fields, Idempotency-Key handling, quota accounting, and no raw key exposure.

## Rollback And Recovery

- Keep legacy `user_id` access checks available until a separately approved switch package proves rollback safety.
- Keep confirmed reset execution disabled by default.
- Preserve action/evidence rows for operator review; do not delete evidence to hide uncertainty.
- Record affected deploy units, previous Worker version, static rollback method, owner, and smoke-test steps before any future deployment.

## Explicit Blocked Claims

- Tenant isolation is not claimed.
- Ownership backfill readiness remains blocked.
- Access-switch readiness remains blocked.
- Confirmed legacy media reset readiness remains blocked.
- Confirmed media deletion/reset is not approved.
- Production readiness remains blocked.
- Live billing readiness remains blocked.
