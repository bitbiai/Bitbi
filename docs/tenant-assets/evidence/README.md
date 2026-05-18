# Tenant Asset Evidence Index

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current evidence index for tenant asset ownership, manual review, and legacy media reset decisions. Evidence files are preserved; active current-state summaries should not duplicate full phase history.

## Current Decision Files

| File | Current status | Notes |
| --- | --- | --- |
| `MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` | `needs_manual_review` | Main folder/image owner-map evidence requires manual review; access switch and backfill remain blocked. |
| `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md` | `operator_evidence_collected_needs_more_idempotency` | Import/queue/status evidence exists, but replay/conflict and successful standalone status-update evidence remain incomplete. |
| `LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` | `legacy_media_reset_dry_run_rejected_unsafe` | The reset dry-run decision references live evidence with a raw idempotency key; the raw JSON is not present in the current checkout and confirmed reset remains blocked. |

## Current Authoritative Evidence Summaries

| File | Purpose |
| --- | --- |
| `2026-05-17-main-folders-images-owner-map-evidence.md` | Main folder/image owner-map evidence summary. |
| `2026-05-17-manual-review-status-operator-evidence-summary.md` | Manual-review import/status operator evidence summary. |
| `2026-05-18-legacy-media-reset-dry-run-closure-summary.md` | Legacy media reset dry-run closure summary and unsafe-evidence decision. |

## Raw Or Operator-Provided Evidence

| File | Status |
| --- | --- |
| `manual-review-import-dry-run-live.json` | Operator evidence; keep sanitized. |
| `manual-review-import-confirmed-live.json` | Operator evidence; keep sanitized. |
| `manual-review-status-update-live.json` | Operator evidence; keep sanitized. |
| `tenant-asset-manual-review-evidence-2026-05-17T19-03-30.974Z.json` | Queue/evidence export. |
| `legacy-media-reset-dry-run-live.json` | Referenced by the reset decision as rejected unsafe because it contains a raw idempotency key; the raw JSON is not present in the current checkout. Do not recreate or repeat the key in summaries. |

## Current Evidence Facts

- Owner-map evidence exists and shows folder/image legacy ownership remains unsafe for access-switch/backfill.
- Manual-review tables and workflows exist; operator evidence is partially complete.
- Legacy media reset dry-run evidence was reviewed in the decision docs, but the raw JSON is not present in the current checkout and the evidence is rejected unsafe; the reset dry-run topic is not closed.
- Confirmed legacy media reset/deletion has not been approved or performed.
- Tenant isolation, access-switch readiness, ownership backfill readiness, and production readiness remain unclaimed.

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
