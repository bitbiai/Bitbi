# Legacy Media Reset Dry-run Evidence Decision

Date: 2026-05-18

Decision status: `legacy_media_reset_dry_run_rejected_unsafe`

Sanitized evidence status: `pending_sanitized_evidence_required`

Dry-run topic status: not closed.

## Decision

The current repository does not contain an accepted sanitized legacy media reset executor dry-run evidence package.

The prior operator-provided live/main executor dry-run evidence was referenced at:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`

The historical decision summary says that prior evidence showed an executor dry-run plan with `dryRun: true` and `execute: false`. It also recorded selected domains, candidate counts, public/gallery impact, derivative/R2 key-type counts, deferred domains, and safety flags.

However, the prior evidence review recorded a raw top-level idempotency key from the operator request. That value is not repeated in this decision, the raw evidence file is absent from the current checkout, and the evidence is classified as unsafe for confirmation-gate purposes. Confirmed reset execution remains blocked until a sanitized replacement or separate evidence-safety review removes the raw key exposure and revalidates the same dry-run facts.

Current runtime safety note: confirmed execution is hard-disabled by default by optional Auth Worker env gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`. Dry-run/reporting remains available without that gate. The gate must not be enabled until sanitized evidence and a future separately approved confirmation phase exist.

P0-03 current-state note: the raw JSON file referenced above is not present in the current checkout, and no replacement sanitized operator/live dry-run JSON or Markdown evidence file was found. This decision remains rejected unsafe and keeps confirmation blocked.

This document does not approve deletion, public/gallery depublishing, R2 cleanup, ownership backfill, access-check switching, tenant isolation, production readiness, or live billing readiness.

## Evidence Reviewed

Repository-controlled locations reviewed:

- `docs/tenant-assets/evidence/`
- `docs/production-readiness/evidence/` if present

Evidence candidates reviewed:

| Path | Classification | Decision |
| --- | --- | --- |
| `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json` | Prior real operator/live dry-run evidence referenced by decision docs; raw file absent from current checkout. | Rejected unsafe based on prior raw idempotency key exposure; not available for sanitized validation. |
| `docs/tenant-assets/evidence/2026-05-18-legacy-media-reset-dry-run-closure-summary.md` | Historical summary of the rejected unsafe evidence. | Useful background summary, not accepted sanitized operator evidence. |
| `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` | Current decision document. | Authoritative blocker state, not raw evidence. |

Sanitized legacy reset dry-run evidence files found:

- none

Required sanitized evidence file still missing:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-sanitized-live.json`
  or an equivalent sanitized JSON/Markdown export that satisfies `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md`.

Current checkout availability: the raw JSON is not present as of P0-03 review. The decision status remains rejected unsafe based on the prior operator-provided evidence review.

The referenced prior evidence is treated as real main/live operator evidence based on the operator update and filename. Synthetic fixtures, Phase 6.21 dry-run design docs, Phase 6.22 executor design docs, Phase 6.23 implementation tests, Phase 6.24 runbook/template docs, pending markers, and screenshots without JSON/Markdown executor dry-run evidence were excluded.

## Historical Dry-run Request Summary

The historical decision summary records:

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

## Historical Candidate Counts

These counts are carried from the prior decision summary. They are not accepted sanitized evidence until a safe replacement evidence file is committed.

| Field | Historical value |
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

## Historical Public/Gallery Findings

The dry-run would retire 17 public/gallery references if a later confirmed reset phase selected and acknowledged public content removal.

No public/gallery row was depublished or deleted by Phase 6.25 Codex/test activity. Future confirmation remains blocked until the operator explicitly acknowledges public content removal in a separately approved phase.

## Historical Derivative And R2 Key-type Findings

The evidence records 100 derivative references.

R2 key-type counts are recorded as counts only:

| R2 key type | Evidence value |
| --- | ---: |
| original | 50 |
| thumb | 50 |
| medium | 50 |

No raw R2 object keys are repeated in this decision. The evidence response records `r2LiveListed: false` and `r2ObjectsMutated: false`.

## Storage/Quota Findings

The prior request selected `includeQuotaVerification: true`, but the historical evidence summary does not include a before/after storage quota verification result. A future confirmation review must require explicit quota verification evidence before and after any confirmed execution.

## Action And Idempotency Evidence

The prior evidence file reportedly included a raw top-level request idempotency key, so the evidence is unsafe for confirmation-gate purposes. The raw value is not repeated here.

The executor response itself records:

- idempotency required: true
- idempotency stored: false
- stored-as policy: `sha256`
- raw key exposed by response: false

Because this was a dry-run, no persisted reset action/result is treated as confirmed execution evidence. A future sanitized evidence file must omit raw idempotency keys and raw request hashes while preserving enough safe action/idempotency metadata to prove replay safety.

## Safety Confirmations From The Historical Summary

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

The historical response summary does not include explicit `sourceAssetRowsMutated: false`, `ownershipMetadataUpdated: false`, `manualReviewRowsMutated: false`, or `resetActionRowsInserted: false` fields. Because the summary says `dryRun: true` and `execute: false`, it supports non-execution of reset behavior, but it is not enough to accept sanitized evidence or open the confirmation gate.

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

- No accepted sanitized operator/live dry-run evidence file is present.
- The prior evidence file reportedly contained a raw idempotency key and is rejected as unsafe.
- The prior raw JSON file is absent from the current checkout and cannot be revalidated.
- Confirmed reset execution is not approved.
- Confirmed execution remains hard-disabled by default behind `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`.
- Public content removal acknowledgement is still required for any future selected public/gallery reset.
- Irreversible deletion acknowledgement is still required.
- No-credit-refund acknowledgement is still required.
- Quota before/after verification evidence is not present.
- Explicit source-row, ownership-metadata, manual-review-row, and reset-action-row non-mutation evidence is not present as accepted sanitized evidence.
- Deferred video/music/text/profile/export/audit domains remain out of first-pass reset scope.
- The executor response records blocked reasons:
  - `video_music_text_profile_avatar_domains_deferred`
  - `ownership_backfill_blocked`
  - `access_switch_blocked`
- Tenant isolation remains unclaimed.
- Production readiness remains blocked.

## Confirmation Gate

`docs/tenant-assets/LEGACY_MEDIA_RESET_CONFIRMATION_GATE_CHECKLIST.md` defines the gate for any later confirmed reset phase.

The gate remains closed. The current repository does not contain accepted sanitized dry-run evidence, and the historical evidence is not sufficient for confirmed execution because it included a raw idempotency key and lacks accepted public-gallery, irreversible-deletion, no-credit-refund, source-row, ownership-metadata, reset-action-row, manual-review-row, and quota-verification evidence.

## Required Operator Action

Collect or provide a sanitized dry-run evidence package using:

- `docs/tenant-assets/LEGACY_MEDIA_RESET_OPERATOR_DRY_RUN_RUNBOOK.md`
- `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md`

The sanitized evidence must prove dry-run-only execution and must omit raw idempotency keys, raw request hashes, cookies/auth headers, signed URLs, private R2 keys, secrets, provider payloads, Stripe data, Cloudflare tokens, private user data, and unsafe metadata.

Recommended next work: `OMEGA follow-up — Operator Provides Sanitized Legacy Reset Dry-run Evidence`

That work must not execute confirmed deletion, enable `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`, backfill ownership, switch access checks, mutate source rows, update ownership metadata, update review rows, update reset action rows, list or mutate live R2, or claim tenant isolation.
