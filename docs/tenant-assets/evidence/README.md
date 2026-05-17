# Tenant Asset Ownership Evidence

Date: 2026-05-17

Purpose: store sanitized operator evidence snapshots and summaries for AI folders/images tenant asset ownership diagnostics.

This directory is for **main-only evidence**. The owner does not use a separate staging environment for this workflow. Evidence here must come from the live/main deployment or be clearly marked pending.

## What Belongs Here

- Sanitized summaries derived from `/api/admin/tenant-assets/folders-images/evidence/export?format=json`.
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

The workflow defines review categories and statuses only. No review execution endpoint, Admin UI, ownership backfill, D1 ownership row rewrite, R2 listing/mutation, or access-check switch has occurred.

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

10. If using the Phase 6.15 import executor, first run dry-run mode, then execute only with an admin-approved reason and `Idempotency-Key`; preserve the resulting import evidence before any status workflow, backfill design, or access-check migration.

Production readiness, live billing readiness, and full tenant isolation remain blocked by default.
