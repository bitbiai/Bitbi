# AI Folders / Images Owner-Map Dry Run

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Purpose: current dry-run/evidence baseline for `ai_folders` and `ai_images`. This file is not a phase log and does not approve backfill or access switching.

## Current Dry-run Commands

```bash
npm run dry-run:tenant-assets -- --domain folders-images
npm run dry-run:tenant-assets:images
npm run test:tenant-assets
```

These commands are local/source/fixture checks. They do not call live endpoints, query live D1, list R2, mutate data, deploy, backfill, or switch access checks.

## Current Classification Model

Dry-run planning uses these classes:

- `personal_user_asset`
- `organization_asset`
- `platform_admin_test_asset`
- `legacy_unclassified_asset`
- `ambiguous_owner`
- `orphan_reference`
- `unsafe_to_migrate`

Organization ownership requires explicit row-level evidence. UI active organization context, folder membership, or R2 key shape is not enough.

## Post-Cleanup Evidence Decision

Main owner-map evidence exists at `docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md`.

Post-cleanup status: `post_cleanup_evidence_pending`.

The operator manually deleted most old images and videos after that evidence was captured. The decision and counts are now historical retained evidence only, classified as `superseded_by_manual_media_cleanup` for current transition decisions. Use `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md` before proposing Backfill, Access-Switch, Reset, or manual-review cleanup.

Superseded key evidence counts:

- Folders scanned: 16
- Images scanned: 63
- Metadata missing total: 75
- Public unsafe: 21
- Derivative risk: 63
- Dual-read unsafe: 42
- Manual review needed: 90

## Current Blockers

- Existing current rows are not fully classified by fresh post-cleanup evidence.
- Manual-review evidence still has idempotency gaps.
- Public/gallery rows require explicit review.
- Derivative/R2 ownership cannot be inferred from key shape alone.
- Backfill and access-switching remain blocked.

## Current Next Use

Use this dry-run output as planning/evidence only. The next deep audit should start from `docs/audits/NEXT_AUDIT_BASELINE.md` and consult current decision files before proposing any migration/backfill/reset work.
