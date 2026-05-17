# Tenant Asset Ownership Evidence

Date: 2026-05-17

Purpose: store sanitized operator evidence snapshots and summaries for AI folders/images tenant asset ownership diagnostics.

This directory is for **main-only evidence**. The owner does not use a separate staging environment for this workflow. Evidence here must come from the live/main deployment or be clearly marked pending.

## What Belongs Here

- Sanitized summaries derived from `/api/admin/tenant-assets/folders-images/evidence/export?format=json`.
- Sanitized manual-review queue/import/status evidence derived from `/api/admin/tenant-assets/folders-images/manual-review/*` endpoints.
- Completed operator evidence records based on `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md`.
- Pending placeholders that explicitly state main evidence has not been collected.

## What Must Not Be Stored Here

- Raw prompts or generated private content.
- Private R2 keys, signed URLs, cookies, auth headers, bearer tokens, secrets, Stripe data, Cloudflare tokens, private keys, or raw idempotency keys.
- Unredacted provider request/response bodies.
- Files that imply ownership backfill, access-check switching, R2 listing, tenant isolation completion, production readiness, or live billing readiness.

## Current State

`MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` is the current Phase 6.10 decision. Status is `needs_manual_review` based on the main-only summary in `2026-05-17-main-folders-images-owner-map-evidence.md`.

The current evidence summary records nonzero high-risk counts, so access-check switching and ownership backfill remain blocked. Manual review is required before any future access-check/backfill phase.

Phase 6.11 adds the design-only manual review workflow and plan:

- `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md`
- `docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md`

The workflow defines review categories and statuses. Later phases added review-state schema, import/status endpoints, read-only evidence APIs, and Admin Control Plane visibility, but no ownership backfill, D1 source ownership row rewrite, R2 listing/mutation, or access-check switch has occurred.

Phase 6.12 adds review-state schema planning:

- `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md`

Phase 6.13 adds the empty review-state tables:

- `workers/auth/migrations/0057_add_ai_asset_manual_review_state.sql`

The schema creates `ai_asset_manual_review_items` and `ai_asset_manual_review_events` plus lookup/audit indexes only. No review rows were created or imported, no evidence was imported into D1, no endpoint/UI was added, and no access-switch/backfill execution occurred.

Phase 6.14 adds local-only import dry-run planning:

- `scripts/dry-run-tenant-asset-manual-review-import.mjs`
- `npm run tenant-assets:dry-run-review-import`

The current Markdown evidence summary supports aggregate buckets only. Item-level review import planning requires a bounded JSON evidence export with safe detail arrays. The dry run creates no review rows, connects to no D1 database, emits no executable SQL, performs no backfill, switches no access checks, and performs no R2 operation.

Phase 6.15 adds an admin-approved review-item import executor:

- `POST /api/admin/tenant-assets/folders-images/manual-review/import`
- helper: `workers/auth/src/lib/tenant-asset-manual-review-import.js`

The endpoint defaults to dry-run and requires admin auth, production MFA, same-origin protection, rate limiting, `Idempotency-Key`, `confirm: true`, and a bounded `reason` before execution. Confirmed execution may create only review items/events in `ai_asset_manual_review_items` and `ai_asset_manual_review_events`. It does not update `ai_folders`, update `ai_images`, backfill ownership, switch access checks, add Admin UI, or list/mutate R2.

Phase 6.16 adds read-only review queue/evidence visibility:

- `GET /api/admin/tenant-assets/folders-images/manual-review/items`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export`
- helper: `workers/auth/src/lib/tenant-asset-manual-review-queue.js`

These endpoints are admin-only, production-MFA protected through route policy, bounded, sanitized, and read-only. They expose queue items, item event history, queue rollups, and JSON/Markdown evidence exports without updating review statuses, creating notes, mutating source asset rows, backfilling ownership, switching access checks, adding Admin UI, or listing/mutating R2.

Phase 6.17 adds the admin-approved status workflow endpoint:

- `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`
- helper: `workers/auth/src/lib/tenant-asset-manual-review-status.js`

The endpoint requires admin auth, production MFA through route policy, same-origin protection, rate limiting, `Idempotency-Key`, `confirm: true`, and a bounded `reason`. It updates only review item status/review metadata and appends sanitized events. It does not update source asset rows, ownership metadata, public visibility, access checks, backfill ownership, or list/mutate R2. Queue evidence reports include status-change event counts, terminal approved/blocked counts, and keep `accessSwitchReady=false`, `backfillReady=false`, `tenantIsolationClaimed=false`, and `productionReadiness=blocked`.

Phase 6.18 adds operator evidence/Admin visibility for the queue:

- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence` now includes the latest status update timestamp in addition to status/event rollups.
- Admin Control Plane includes a compact "Tenant Asset Manual Review Queue" panel with refresh, JSON export, filters, safe item detail, event history, readiness badges, and review-status controls that call only the Phase 6.17 endpoint.
- The panel intentionally contains no backfill, access-switch, source-asset update, delete, R2, provider, Stripe, credit, or billing controls.
- Status controls remain review-state only and do not approve ownership backfill, access-check switching, tenant isolation, or production readiness.

Phase 6.19 added operator evidence collection docs and a pending decision for the Phase 6.15-6.18 manual-review workflow:

- `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_RUNBOOK.md`
- `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_TEMPLATE.md`
- `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`

Phase 6.20 reviews the committed live/main operator evidence and updates the decision:

- `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`
- `docs/tenant-assets/evidence/2026-05-17-manual-review-status-operator-evidence-summary.md`
- `docs/tenant-assets/evidence/manual-review-import-dry-run-live.json`
- `docs/tenant-assets/evidence/manual-review-import-confirmed-live.json`
- `docs/tenant-assets/evidence/manual-review-status-update-live.json`
- `docs/tenant-assets/evidence/tenant-asset-manual-review-evidence-2026-05-17T19-03-30.974Z.json`

Current Phase 6.20 status is `operator_evidence_collected_needs_more_idempotency`: the live/main import dry-run, confirmed import, and queue evidence export were captured, and the final export records one status-changed event. Same-key replay/conflict evidence and a successful standalone status-update response with hashed idempotency/request-hash evidence are still missing. Backfill, access-switching, tenant isolation, production readiness, and live billing readiness remain blocked.

Phase 6.21 adds a read-only legacy personal media reset dry-run:

- `docs/tenant-assets/LEGACY_PERSONAL_MEDIA_RESET_DRY_RUN.md`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run/export`

The dry-run inventories `ai_folders`, `ai_images`, public/gallery rows, derivative references, text/music/video records, quota summaries, and manual-review impact using bounded D1 reads only. It adds no delete executor or bulk-delete UI, performs no deletion, mutates no source/review rows, performs no ownership backfill or access switch, and does not list or mutate R2.

Phase 6.22 adds the design-only reset executor plan:

- `docs/tenant-assets/LEGACY_PERSONAL_MEDIA_RESET_EXECUTOR_DESIGN.md`

The design defines future allowed/deferred domains, endpoint shape, deletion order, public/gallery handling, derivative/R2 safety, audit/idempotency, action tracking, partial-failure, and verification requirements. It adds no executor, endpoint, UI, migration, deletion, source mutation, review-row mutation, R2 action, ownership backfill, or access switch.

Phase 6.23 adds legacy media reset action tracking and the admin-approved executor path:

- `workers/auth/migrations/0058_add_legacy_media_reset_actions.sql`
- `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/export`

The executor defaults to dry-run. Confirmed execution is limited to `ai_images`, `ai_folders`, `ai_image_derivatives`, and `public_gallery_references`; video/music/text/profile/avatar/export/audit/unknown domains are rejected. It requires admin auth, production MFA, same-origin protection, `Idempotency-Key`, `confirm: true`, bounded `reason`, and explicit public/removal/no-credit/irreversible-deletion acknowledgements. Codex/tests did not execute the reset against live/main data, run remote migrations, deploy, backfill ownership, switch access checks, mutate billing/credits, or list/mutate live R2.

`PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` is retained as a historical pending marker from before the real main evidence summary was added. It is not current evidence and should not be used for counts.

Synthetic fixtures, runbook instructions, and pending markers must not be treated as main evidence.

## Adding A Future Snapshot

1. Follow `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md`.
2. Save live/main JSON export evidence in an approved private evidence store.
3. Redact and review the export for unsafe fields.
4. Optionally run:

   ```bash
   npm run tenant-assets:summarize-evidence -- --input docs/tenant-assets/evidence/<redacted-export>.json --output docs/tenant-assets/evidence/YYYY-MM-DD-main-folders-images-owner-map-evidence.md
   ```

5. Commit only sanitized summaries or approved redacted exports.
6. Update `MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` with the reviewed source files and explicit counts.
7. Update the manual-review plan if high-risk counts change.
8. Run the import dry run if item-level JSON evidence is available:

   ```bash
   npm run tenant-assets:dry-run-review-import -- --input docs/tenant-assets/evidence/<redacted-export>.json --format markdown
   ```

9. Keep any access-check switch or backfill blocked unless operator evidence and a later approved phase explicitly allow it.

10. If using the Phase 6.15 import executor, first run dry-run mode, then execute only with an admin-approved reason and `Idempotency-Key`; inspect the resulting rows through the Phase 6.16 read-only queue/evidence endpoints before any status workflow, backfill design, or access-check migration.

11. If using the Phase 6.17 status workflow or Phase 6.18 Admin panel, change only review statuses with explicit reasons and idempotency, then export updated queue evidence. Status changes are operator evidence only and do not approve backfill or access-check switching.

12. For manual-review operator evidence, follow `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_RUNBOOK.md`, complete `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_TEMPLATE.md`, and update `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`. If evidence is collected but replay/conflict proof is missing, keep the decision at `operator_evidence_collected_needs_more_idempotency`.

13. Phase 6.20 redacted raw operator request idempotency keys from committed JSON evidence before summarizing. Future evidence archives must store only hashed or redacted idempotency values.

14. For legacy personal media reset planning, use the Phase 6.21 dry-run/export endpoints only. Save sanitized JSON/Markdown output if operators want to review a deletion-executor design; do not treat the dry-run as deletion approval, backfill approval, access-switch readiness, tenant isolation, or production readiness.

Production readiness, live billing readiness, and full tenant isolation remain blocked by default.
