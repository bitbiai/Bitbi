# Tenant Asset Migration Risk Matrix

Date: 2026-05-19

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

Purpose: current risk register for tenant asset ownership and legacy media reset work. This is not phase history and does not approve destructive execution.

## Current High-Risk Gaps

| Risk | Severity | Current evidence | Required mitigation |
| --- | --- | --- | --- |
| Ownership ambiguity on legacy rows | High | Pre-cleanup folder/image evidence showed metadata-missing and manual-review rows; counts are now stale after manual media cleanup. | Collect current post-cleanup owner-map/backfill dry-run evidence before any backfill or access switch. |
| Organization ownership not durable on old saved assets | High | New personal writes assign metadata; old org ownership is not proven. | Add explicit row-level org evidence in a future approved phase. |
| Public gallery attribution is user/profile based | High | Public/gallery rows need special treatment before any reset. | Require explicit public-content acknowledgement and verification. |
| Derivative/poster/thumb ownership is inherited | High | Derivative R2 references are known from D1 but not live-listed. | Clean parent/derivatives together only through approved bounded paths. |
| R2 key inference is unsafe | High | Keys often encode users, not organizations. | Never list or delete by broad prefix; use D1-known bounded keys only. |
| Lifecycle/export/delete is user-subject centered | High | Org subject lifecycle is deferred. | Design org lifecycle separately before tenant-isolation claims. |
| Storage quota is user-centered | High | Current quota accounting is per user. | Verify/recalculate quota after any future approved reset. |
| Reset dry-run evidence is unsafe and stale | High | Prior live dry-run evidence exposed a raw idempotency key, the raw file is absent from the checkout, no sanitized replacement is accepted, and old candidate counts are superseded by manual media cleanup. | Provide fresh post-cleanup sanitized dry-run/status evidence before confirmation review. |
| Deferred media domains | High | Video, music, text, profile, lifecycle export, audit archive domains are not first-pass reset domains. | Expand coverage separately before touching those domains. |

## Current Allowed Evidence Uses

- Owner-map evidence can support manual review and planning only.
- Manual-review statuses can record operator review state only.
- Reset dry-run evidence can support blocker review only because the current file is unsafe.
- Pre-cleanup owner-map, manual-review, and reset counts are historical retained evidence only after manual media cleanup; use `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md` and the pending evidence packet before making new decisions.
- Action tracking can preserve reset executor dry-run/execute evidence, but confirmed execution is not approved.
- The Admin Tenant Isolation Execution panel can run bounded dry-runs/diagnostics and export redacted evidence for Ownership Backfill, Access-Switch, and Legacy Media Reset. Its warning/exclamation markers explain action impact, affected domains, evidence requirements, rollback limits, and exact confirmation phrases.
- The Ownership Backfill executor is available only through strict Admin/MFA/idempotency/confirmation gates and may write only locally classified safe `ai_folders`/`ai_images` ownership metadata in approved non-production/mock execution. It does not prove global backfill readiness.

## Current Blocked Actions

- Ungated ownership backfill.
- Runtime access-check switching or enforced Access-Switch mode.
- Existing ownership metadata rewrite.
- Confirmed legacy media reset/deletion.
- Live R2 listing, broad prefix deletion, or uncontrolled SQL deletion.
- Billing/credit mutation tied to reset.
- Tenant isolation or production readiness claims.

## Future Gate Requirements

Before any future backfill, access switch, or confirmed reset:

1. Current post-cleanup evidence must be sanitized and complete.
2. Operator approval must be explicit and bounded; default actions must remain dry-run/diagnostics.
3. Required migrations must be applied remotely before dependent Worker deploys.
4. Admin/MFA/same-origin/idempotency/reason/acknowledgement and exact typed confirmation requirements must be satisfied for destructive paths.
5. Before/after evidence exports must be captured.
6. Public/gallery, derivative/R2, quota, manual-review, and deferred-domain impacts must be reviewed separately.
7. Reset must not be executed before Backfill and Access-Switch evidence is reviewed and the reset confirmation gate is separately approved.
