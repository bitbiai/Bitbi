# Legacy Media Reset Dry-run Evidence Decision

Date: 2026-05-18

Decision status: `legacy_media_reset_dry_run_rejected_unsafe`

Dry-run topic status: not closed.

## Decision

Phase 6.25 reviewed the operator-provided live/main executor dry-run evidence at:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`

The evidence proves that the Phase 6.23 executor returned a dry-run plan with `dryRun: true` and `execute: false`. It also records selected domains, candidate counts, public/gallery impact, derivative/R2 key-type counts, deferred domains, and safety flags.

However, the evidence file includes a raw top-level idempotency key from the operator request. That value is not repeated in this decision, and the evidence is classified as unsafe for confirmation-gate purposes. Confirmed reset execution remains blocked until a sanitized replacement or separate evidence-safety review removes the raw key exposure and revalidates the same dry-run facts.

Current runtime safety note: confirmed execution is hard-disabled by default by optional Auth Worker env gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`. Dry-run/reporting remains available without that gate. The gate must not be enabled until sanitized evidence and a future separately approved confirmation phase exist.

DOC-2 current-state note: the raw JSON file referenced above is not present in the current checkout. This decision remains the current reset dry-run decision and keeps confirmation blocked; future work must restore a safe/sanitized export or explicitly review the missing raw evidence before any confirmation phase.

This document does not approve deletion, public/gallery depublishing, R2 cleanup, ownership backfill, access-check switching, tenant isolation, production readiness, or live billing readiness.

## Evidence Reviewed

Repository-controlled locations reviewed:

- `docs/tenant-assets/evidence/`
- `docs/production-readiness/evidence/` if present

Real legacy reset dry-run evidence files found:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`

Current checkout availability: not present as of DOC-2 consolidation. The decision status remains rejected unsafe based on the prior operator-provided evidence review.

The file is treated as real main/live operator evidence based on the operator update and filename. Synthetic fixtures, Phase 6.21 dry-run design docs, Phase 6.22 executor design docs, Phase 6.23 implementation tests, Phase 6.24 runbook/template docs, pending markers, and screenshots without JSON/Markdown executor dry-run evidence were excluded.

## Dry-run Request Summary

The evidence request records:

- `dryRun: true`
- selected request domains:
  - `ai_images`
  - `ai_folders`
  - `ai_image_derivatives`
  - `public_gallery_references`
- `includeFolders: true`
- `includeImages: true`
- `includePublic: true`
- `includeDerivatives: true`
- `includeQuotaVerification: true`
- `limit: 500`

The response records:

- `ok: true`
- report version: `tenant-asset-legacy-media-reset-executor-v1`
- generated at: `2026-05-18T04:07:36.312Z`
- `dryRun: true`
- `execute: false`
- evidence snapshot generated at: `2026-05-18T04:07:35.532Z`

The snapshot hash is present in the evidence file, but this decision does not rely on it as a confirmation approval.

## Selected And Deferred Domains

Selected domains recorded by the response:

- `ai_folders`
- `ai_image_derivatives`
- `ai_images`
- `public_gallery_references`

Allowed domains recorded by the response:

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

Deferred domains recorded by the response:

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

The evidence includes a bounded proposed item list, but this decision intentionally does not repeat item IDs, user IDs, folder IDs, or full row details.

## Public/Gallery Findings

The dry-run would retire 17 public/gallery references if a later confirmed reset phase selected and acknowledged public content removal.

No public/gallery row was depublished or deleted by Phase 6.25 Codex/test activity. Future confirmation remains blocked until the operator explicitly acknowledges public content removal in a separately approved phase.

## Derivative And R2 Key-type Findings

The evidence records 100 derivative references.

R2 key-type counts are recorded as counts only:

| R2 key type | Evidence value |
| --- | ---: |
| original | 50 |
| thumb | 50 |
| medium | 50 |

No raw R2 object keys are repeated in this decision. The evidence response records `r2LiveListed: false` and `r2ObjectsMutated: false`.

## Storage/Quota Findings

The request selected `includeQuotaVerification: true`, but the evidence response does not include a before/after storage quota verification result. A future confirmation review must require explicit quota verification evidence before and after any confirmed execution.

## Action And Idempotency Evidence

The evidence file includes a raw top-level request idempotency key, so the evidence is unsafe for confirmation-gate purposes.

The executor response itself records:

- idempotency required: true
- idempotency stored: false
- stored-as policy: `sha256`
- raw key exposed by response: false

Because this was a dry-run, no persisted reset action/result is treated as confirmed execution evidence. A future sanitized evidence file must omit raw idempotency keys while preserving enough action/idempotency metadata to prove replay safety.

## Safety Confirmations From The Evidence

The response records:

- `dryRun: true`
- `execute: false`
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

The response does not include explicit `sourceAssetRowsMutated: false` or `ownershipMetadataUpdated: false` fields. Because the response is `dryRun: true` and `execute: false`, the evidence supports non-execution of reset behavior, but a future confirmation review should still require explicit before/after source-row and ownership-metadata evidence.

For Phase 6.25 Codex/test activity:

- No confirmed reset execution occurred.
- No dry-run executor call was made by Codex/tests.
- No media rows were deleted.
- No ownership backfill was performed.
- No source asset rows were updated.
- No ownership metadata was updated.
- No review rows were mutated.
- No reset action rows were mutated.
- No access checks changed.
- No R2 objects were listed, moved, copied, rewritten, or deleted live.
- No provider, Stripe, Cloudflare, GitHub, credit, or billing mutation occurred.

## Remaining Blockers

- The committed evidence file contains a raw idempotency key and is rejected as unsafe.
- Confirmed reset execution is not approved.
- Public content removal acknowledgement is still required for any future selected public/gallery reset.
- Irreversible deletion acknowledgement is still required.
- No-credit-refund acknowledgement is still required.
- Quota before/after verification evidence is not present.
- Deferred video/music/text/profile/export/audit domains remain out of first-pass reset scope.
- The executor response records blocked reasons:
  - `video_music_text_profile_avatar_domains_deferred`
  - `ownership_backfill_blocked`
  - `access_switch_blocked`
- Tenant isolation remains unclaimed.
- Production readiness remains blocked.

## Confirmation Gate

`docs/tenant-assets/LEGACY_MEDIA_RESET_CONFIRMATION_GATE_CHECKLIST.md` defines the gate for any later confirmed reset phase.

The gate remains closed. This evidence is not sufficient for confirmed execution because it includes a raw idempotency key and because public-gallery, irreversible-deletion, no-credit-refund, source-row, ownership-metadata, and quota-verification evidence still require a separate approved confirmation review.

## Next Recommended Phase

`Phase 6.26 — Legacy Media Reset Blocker Review`

That phase should either replace the evidence with a sanitized dry-run export or explicitly review the unsafe evidence issue and remaining blockers. It must not execute confirmed deletion, backfill ownership, switch access checks, mutate source rows, update ownership metadata, update review rows, update reset action rows, list or mutate live R2, or claim tenant isolation.
