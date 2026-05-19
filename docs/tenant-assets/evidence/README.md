# Tenant Asset Evidence Index

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Purpose: current evidence index for tenant asset ownership, manual review, and legacy media reset decisions. Evidence files are preserved; active current-state summaries should not duplicate full phase history.

## Current Decision Files

| File | Current status | Notes |
| --- | --- | --- |
| `POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md` | `post_cleanup_evidence_pending` | Current control file after manual media cleanup. Live authenticated read-only evidence is required before old counts can be used for Backfill, Access-Switch, or Reset decisions. |
| `MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` | `stale/superseded_by_manual_media_cleanup`; previous decision `needs_manual_review` retained | Old folder/image counts are historical after manual media deletion; access switch and backfill remain blocked until fresh evidence is collected. |
| `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md` | `stale/superseded_by_manual_media_cleanup`; previous idempotency status retained as historical | Import/queue/status evidence may reference removed assets; collect a fresh queue/status export before using counts. |
| `LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` | `stale/superseded_by_manual_media_cleanup`; sanitized evidence still `pending_sanitized_evidence_required` | Prior reset counts are stale and the evidence was already rejected unsafe. Confirmed reset remains blocked. |

## Current Authoritative Evidence Summaries

| File | Purpose |
| --- | --- |
| `2026-05-17-main-folders-images-owner-map-evidence.md` | Historical pre-cleanup main folder/image owner-map evidence summary; counts are stale after manual media cleanup. |
| `2026-05-17-manual-review-status-operator-evidence-summary.md` | Historical pre-cleanup manual-review import/status operator evidence summary; counts may reference removed assets. |
| `2026-05-18-legacy-media-reset-dry-run-closure-summary.md` | Historical pre-cleanup legacy media reset dry-run closure summary and unsafe-evidence decision; counts are stale and evidence remains rejected unsafe. |
| `2026-05-19-post-cleanup-rebaseline/README.md` | Pending post-cleanup evidence packet and operator command list. |
| `2026-05-19-post-cleanup-rebaseline/pending-evidence-manifest.json` | Machine-readable pending evidence manifest. |

## Raw Or Operator-Provided Evidence

| File | Status |
| --- | --- |
| `manual-review-import-dry-run-live.json` | Operator evidence; keep sanitized. |
| `manual-review-import-confirmed-live.json` | Operator evidence; keep sanitized. |
| `manual-review-status-update-live.json` | Operator evidence; keep sanitized. |
| `tenant-asset-manual-review-evidence-2026-05-17T19-03-30.974Z.json` | Queue/evidence export. |
| `legacy-media-reset-dry-run-live.json` | Referenced by the reset decision as rejected unsafe because it contained a raw idempotency key; the raw JSON is not present in the current checkout. Do not recreate or repeat the key in summaries. |
| `legacy-media-reset-dry-run-sanitized-live.json` | Not present. This or an equivalent sanitized JSON/Markdown dry-run export is required before the reset dry-run evidence blocker can be cleared. |

## Current Evidence Facts

- Owner-map evidence exists but old folder/image counts are stale after manual cleanup. Fresh authenticated read-only evidence is required.
- Manual-review tables and workflows exist; old operator evidence is partially complete but may reference removed assets.
- Manual-review idempotency completion is pending; use `docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_RUNBOOK.md` and `docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md` before any backfill/access-switch readiness claim.
- Legacy media reset dry-run evidence was reviewed in the decision docs, but the raw JSON is not present in the current checkout, no sanitized replacement is present, the old counts are stale after cleanup, and the evidence is rejected unsafe; the reset dry-run topic is not closed.
- Confirmed legacy media reset/deletion has not been approved or performed.
- Tenant isolation, access-switch readiness, ownership backfill readiness, and production readiness remain unclaimed.

## Current Sanitized Reset Evidence Requirement

Use `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` and `docs/tenant-assets/LEGACY_MEDIA_RESET_OPERATOR_DRY_RUN_RUNBOOK.md` to collect a replacement. The accepted package must prove `dryRun: true`, `execute: false`, bounded first-pass domains, candidate counts, public/gallery impact, derivative/R2 key-type counts, explicit no-mutation safety flags, safe idempotency handling, and no raw secrets or private values.

## Historical Evidence Records

Dated plans, import dry-runs, pending markers, and raw exports are retained as evidence. Treat them as historical unless a current decision file references them.

Examples:

- `2026-05-17-main-folders-images-manual-review-plan.md`
- `2026-05-17-main-folders-images-review-import-dry-run.md`
- `PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md`
- `tenant-asset-ownership-evidence-2026-05-17T12-58-02.735Z.json`

## Safety Rules

- Do not delete unique evidence.
- Do not summarize raw idempotency keys, private R2 keys, signed URLs, prompts, provider payloads, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, or unsafe metadata.
- Do not treat synthetic fixtures as live/main evidence.
- Do not claim deletion, backfill, access-switching, or tenant isolation unless a current decision file explicitly proves it.
