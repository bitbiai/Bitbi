# Legacy Media Reset Confirmation Gate Checklist

Date: 2026-05-18

Purpose: define the evidence gate that must pass before any later confirmed legacy media reset execution phase can be proposed.

This checklist does not authorize deletion. Confirmed reset execution must be a separate explicitly approved phase. Current live/main executor dry-run evidence at `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json` contains a raw idempotency key and is rejected as unsafe for confirmation-gate purposes. The gate remains closed.

## Required Evidence

- Sanitized live/main executor dry-run JSON or Markdown evidence from `POST /api/admin/tenant-assets/legacy-media-reset/execute`.
- Decision status in `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` updated from `legacy_media_reset_dry_run_rejected_unsafe` to either `legacy_media_reset_dry_run_collected_blocked` or `legacy_media_reset_dry_run_collected_ready_for_confirmation_review` after a sanitized replacement or evidence-safety review.
- Evidence shows `dryRun: true` and no confirmed execution/deletion.
- Evidence records selected domains, allowed/deferred domains, planned candidate counts, public/gallery findings, derivative/R2 key-type counts if available, and storage/quota findings if available.
- Evidence includes safety flags showing no ownership backfill, no access switch, no source row update, no ownership metadata update, no R2 listing/mutation, no provider/Stripe/Cloudflare call, and no credit/billing mutation.
- Evidence does not include raw idempotency keys, raw private R2 keys, signed URLs, cookies/auth headers, provider bodies, Stripe data, Cloudflare tokens, private keys, or unsafe metadata blobs.

## Required Selected Domains

The first confirmation review may consider only first-pass reset domains:

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

These domains remain deferred unless a later separately approved phase expands coverage:

- video assets/jobs
- music/audio assets
- text assets
- profile avatars
- data lifecycle exports
- audit archive
- unknown media tables
- manual-review supersession

## Required Acknowledgements

A future confirmed execution request must include explicit operator acknowledgements:

- public content removal, if public/gallery references are selected;
- irreversible deletion;
- no credit refund or billing adjustment;
- no tenant isolation claim from the reset itself;
- no ownership backfill;
- no access-check switch.

## Required Execution Conditions

- Admin-only endpoint.
- Production MFA satisfied.
- Same-origin write protection.
- `Idempotency-Key` required and not committed raw.
- `confirm: true` required.
- Bounded reason required.
- Latest dry-run evidence confirmed or recomputed by the server.
- Evidence export captured before execution.
- Evidence export captured after execution in the later approved phase.

## Blockers

Confirmed execution remains blocked while any of these are true:

- the committed evidence is still classified as `legacy_media_reset_dry_run_rejected_unsafe`;
- evidence contains raw private R2 keys, signed URLs, raw prompts, provider bodies, cookies/auth headers, Stripe data, Cloudflare tokens, private keys, raw idempotency keys, or unsafe metadata;
- public/gallery impact is missing or unacknowledged;
- derivative/R2 key-type counts are missing when derivatives are selected;
- candidate counts are missing;
- deferred domains are selected;
- production readiness, tenant isolation, backfill readiness, or access-switch readiness is implied by the evidence.

## Non-Goals

This checklist does not perform deletion, depublish public rows, update D1 rows, update ownership metadata, mutate review/reset action rows, backfill ownership, switch access checks, list/mutate R2, call providers, call Stripe, call Cloudflare APIs, mutate credits/billing, deploy, or apply migrations.
