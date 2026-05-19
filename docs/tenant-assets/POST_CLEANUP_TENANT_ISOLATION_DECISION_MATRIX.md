# Post-Cleanup Tenant Isolation Decision Matrix

Date: 2026-05-19

Purpose: decision matrix after the operator manually deleted most old images and videos. This document does not approve production execution, tenant isolation, ownership backfill readiness, Access-Switch readiness, or confirmed legacy reset readiness.

Current evidence status: `post_cleanup_evidence_pending`

Current evidence packet: `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`

## Backfill Decision

Backfill may proceed later only if all of these are true:

- current post-cleanup Ownership Backfill dry-run evidence exists;
- safe candidates are explicitly classified by domain;
- blocked, public unsafe, missing-evidence, manual-review, deferred, and legacy-unclassified candidates are excluded;
- operator reason is recorded;
- `Idempotency-Key` is present and not committed raw;
- exact typed confirmation `BACKFILL OWNERSHIP` is present;
- scope/domain selection is explicit and limited to supported schema domains;
- batch limit is bounded;
- evidence export is captured before and after any approved execution;
- no tenant-isolation claim is made from partial backfill.

Current result: `dry_run_only_until_fresh_evidence_review`.

## Access-Switch Decision

Access-Switch may proceed later only if all of these are true:

- current post-cleanup Backfill evidence exists and is reviewed;
- any approved backfill execution evidence exists for the specific target domain;
- shadow diagnostics are run after the backfill state being evaluated;
- mismatches are zero, or every mismatch has a documented accepted rationale and rollback plan;
- a durable runtime switch state model exists;
- a kill-switch/rollback path is documented and tested;
- access behavior tests cover same-user, cross-user, public/gallery, missing metadata, and legacy rows;
- no tenant-isolation claim is made before live evidence proves it.

Current result: `shadow_only_enforced_blocked`.

## Legacy Media Reset Decision

Reset may proceed later only if all of these are true:

- current post-cleanup legacy reset evidence is collected;
- reset candidate counts are bounded and sanitized;
- public/gallery impact is reviewed and acknowledged;
- derivative/R2 key-type counts are present as counts only;
- storage/quota reconciliation evidence exists where applicable;
- Backfill and Access-Switch evidence has been reviewed first;
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is intentionally enabled by an operator in a later approved phase;
- `Idempotency-Key` is present and not committed raw;
- exact typed confirmation `CONFIRMED LEGACY MEDIA RESET` is present;
- no automatic reset is run from this rebaseline package.

Current result: `status_and_evidence_only_confirmed_blocked`.

## Current Blocked Claims

- Tenant isolation remains unclaimed.
- Ownership-backfill readiness remains blocked.
- Access-Switch readiness remains blocked.
- Confirmed legacy media reset readiness remains blocked.
- Production readiness remains blocked.
- Live billing readiness remains blocked.
