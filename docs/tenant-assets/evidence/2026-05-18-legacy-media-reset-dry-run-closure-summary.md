# Legacy Media Reset Dry-run Closure Summary

Date: 2026-05-18

Decision status: `legacy_media_reset_dry_run_rejected_unsafe`

Source evidence:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`

## Summary

Phase 6.25 found real operator-provided live/main legacy media reset executor dry-run evidence. The evidence records a dry-run request and response for `POST /api/admin/tenant-assets/legacy-media-reset/execute`.

The dry-run topic is not closed because the evidence file contains a raw top-level idempotency key from the operator request. The key is not repeated here. Confirmed reset execution remains blocked.

DOC-2 current-state note: the raw JSON file cited below is not present in the current checkout. This closure summary is retained as the decision summary, and future work must restore a safe/sanitized export or explicitly review the missing raw evidence before any confirmation phase.

## Dry-run Result

The response records:

- `ok: true`
- `dryRun: true`
- `execute: false`
- report version: `tenant-asset-legacy-media-reset-executor-v1`
- generated at: `2026-05-18T04:07:36.312Z`

Selected domains:

- `ai_folders`
- `ai_image_derivatives`
- `ai_images`
- `public_gallery_references`

Allowed domains:

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

Deferred domains:

- `manual_review_items_supersession`
- `ai_text_assets`
- `music_assets`
- `video_assets`
- `profile_avatars`
- `data_lifecycle_exports`
- `audit_archive`

## Candidate Counts

| Field | Evidence value |
| --- | ---: |
| Proposed source rows to retire | 53 |
| Proposed images to retire | 50 |
| Proposed folders to retire | 3 |
| Public/gallery references to retire | 17 |
| Derivative references | 100 |
| Selected users represented | 5 |
| Dry-run candidate rows | 149 |
| Blocked by dry-run | 386 |
| Deferred video records | 34 |
| Deferred music records | 12 |
| Deferred text asset records | 40 |

## Public/Gallery Impact

The dry-run records 17 public/gallery references that would be retired if a future confirmed reset selected public references. Future confirmation requires explicit public content removal acknowledgement.

## Derivative And R2 Key Types

The dry-run records 100 derivative references.

R2 key-type counts:

| R2 key type | Evidence value |
| --- | ---: |
| original | 50 |
| thumb | 50 |
| medium | 50 |

No raw R2 object keys are repeated in this summary.

## Storage/Quota

The request selected `includeQuotaVerification: true`, but the evidence response does not include explicit before/after quota verification results. Future confirmation review must require quota verification evidence.

## Safety Flags

The evidence response records:

- `noBackfill: true`
- `noAccessSwitch: true`
- `noBillingOrCreditMutation: true`
- `noProviderCalls: true`
- `noStripeCalls: true`
- `noCloudflareApiCalls: true`
- `r2LiveListed: false`
- `r2ObjectsMutated: false`
- `runtimeBehaviorChanged: false`
- `accessChecksChanged: false`
- `tenantIsolationClaimed: false`
- `productionReadiness: blocked`

The response does not include explicit `sourceAssetRowsMutated: false` or `ownershipMetadataUpdated: false` fields, so a future confirmation review must require those before/after checks.

## Blockers

- Evidence contains a raw idempotency key and is rejected as unsafe.
- Confirmed reset execution is not approved.
- Public content removal acknowledgement is still required.
- Irreversible deletion acknowledgement is still required.
- No-credit-refund acknowledgement is still required.
- Quota verification evidence is incomplete.
- Video, music, text, profile, data lifecycle export, audit archive, and manual-review supersession domains remain deferred.
- Tenant isolation remains unclaimed.
- Production readiness remains blocked.

## Confirmation Gate

`docs/tenant-assets/LEGACY_MEDIA_RESET_CONFIRMATION_GATE_CHECKLIST.md` remains the gate for any later confirmed reset phase. This summary does not authorize deletion.

Recommended next phase: `Phase 6.26 — Legacy Media Reset Blocker Review`.
