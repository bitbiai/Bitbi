# Tenant Asset Migration Risk Matrix

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current risk register for tenant asset ownership and legacy media reset work. This is not phase history and does not approve destructive execution.

## Current High-Risk Gaps

| Risk | Severity | Current evidence | Required mitigation |
| --- | --- | --- | --- |
| Ownership ambiguity on legacy rows | High | Folder/image evidence shows metadata-missing and manual-review rows. | Complete review evidence before any backfill or access switch. |
| Organization ownership not durable on old saved assets | High | New personal writes assign metadata; old org ownership is not proven. | Add explicit row-level org evidence in a future approved phase. |
| Public gallery attribution is user/profile based | High | Public/gallery rows need special treatment before any reset. | Require explicit public-content acknowledgement and verification. |
| Derivative/poster/thumb ownership is inherited | High | Derivative R2 references are known from D1 but not live-listed. | Clean parent/derivatives together only through approved bounded paths. |
| R2 key inference is unsafe | High | Keys often encode users, not organizations. | Never list or delete by broad prefix; use D1-known bounded keys only. |
| Lifecycle/export/delete is user-subject centered | High | Org subject lifecycle is deferred. | Design org lifecycle separately before tenant-isolation claims. |
| Storage quota is user-centered | High | Current quota accounting is per user. | Verify/recalculate quota after any future approved reset. |
| Reset dry-run evidence is unsafe | High | Prior live dry-run evidence exposed a raw idempotency key, the raw file is absent from the checkout, and no sanitized replacement is accepted. | Provide sanitized dry-run evidence before confirmation review. |
| Deferred media domains | High | Video, music, text, profile, lifecycle export, audit archive domains are not first-pass reset domains. | Expand coverage separately before touching those domains. |

## Current Allowed Evidence Uses

- Owner-map evidence can support manual review and planning only.
- Manual-review statuses can record operator review state only.
- Reset dry-run evidence can support blocker review only because the current file is unsafe.
- Action tracking can preserve reset executor dry-run/execute evidence, but confirmed execution is not approved.

## Current Blocked Actions

- Ownership backfill.
- Runtime access-check switching.
- Existing ownership metadata rewrite.
- Confirmed legacy media reset/deletion.
- Live R2 listing, broad prefix deletion, or uncontrolled SQL deletion.
- Billing/credit mutation tied to reset.
- Tenant isolation or production readiness claims.

## Future Gate Requirements

Before any future backfill, access switch, or confirmed reset:

1. Current evidence must be sanitized and complete.
2. Operator approval must be explicit and bounded.
3. Required migrations must be applied remotely before dependent Worker deploys.
4. Admin/MFA/same-origin/idempotency/reason/acknowledgement requirements must be satisfied for destructive paths.
5. Before/after evidence exports must be captured.
6. Public/gallery, derivative/R2, quota, manual-review, and deferred-domain impacts must be reviewed separately.
