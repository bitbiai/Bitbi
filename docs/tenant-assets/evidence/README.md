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

The workflow defines review categories and statuses only. No review execution endpoint, Admin UI, D1 migration, ownership backfill, D1 row rewrite, R2 listing/mutation, or access-check switch has occurred.

Phase 6.12 adds design-only review-state schema planning:

- `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md`

The schema design proposes future `ai_asset_manual_review_items` and `ai_asset_manual_review_events` tables, transitions, idempotency rules, and safe evidence snapshots. No `0057` migration exists yet, no review rows were created, no evidence was imported into D1, and no access-switch/backfill execution occurred.

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
8. Keep any access-check switch or backfill blocked unless operator evidence and a later approved phase explicitly allow it.

Production readiness, live billing readiness, and full tenant isolation remain blocked by default.
