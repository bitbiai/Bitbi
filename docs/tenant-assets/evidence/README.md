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

`PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` is the current Phase 6.9 package state. It is not evidence; it records that no real operator-exported main evidence files were present in the repository when Phase 6.9 was prepared.

## Adding A Future Snapshot

1. Follow `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md`.
2. Save live/main JSON export evidence in an approved private evidence store.
3. Redact and review the export for unsafe fields.
4. Optionally run:

   ```bash
   npm run tenant-assets:summarize-evidence -- --input docs/tenant-assets/evidence/<redacted-export>.json --output docs/tenant-assets/evidence/YYYY-MM-DD-main-folders-images-owner-map-evidence.md
   ```

5. Commit only sanitized summaries or approved redacted exports.
6. Keep any access-check switch or backfill blocked unless operator evidence and a later approved phase explicitly allow it.

Production readiness, live billing readiness, and full tenant isolation remain blocked by default.
