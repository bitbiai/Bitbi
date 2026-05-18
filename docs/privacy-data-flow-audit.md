# Privacy Data Flow Audit

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current engineering privacy/data-flow summary for legal/product review. This is not legal certification, production readiness, or live billing readiness.

## Current Data Flow Summary

| Flow | Current state | Privacy/audit concern |
| --- | --- | --- |
| Account/auth | User identity, sessions, MFA, wallet, profile, password/reset/email flows in Auth Worker/D1. | Preserve secret and token handling; verify live configuration. |
| Member AI generation | Image/music/video generation paths with usage attempts, credit checks, and media storage. | Provider prompts/payloads must not enter public evidence; billing evidence remains scoped. |
| Admin AI/platform tools | Admin AI Lab, platform budget controls, reconciliation/repair/report/archive flows. | Admin/provider-cost operations need scoped evidence and secret-safe logs. |
| Saved media | D1 metadata and R2 media objects for folders/images/text/audio/video/derivatives/posters. | Legacy ownership remains unresolved; tenant isolation is not claimed. |
| Public galleries | Published media is public through gallery routes and user/profile attribution. | Organization publisher policy and public reset handling remain unresolved. |
| Data lifecycle/export | Admin lifecycle planning and export archive foundations exist. | Self-service and legal-approved irreversible deletion remain open. |
| Tenant manual review | Review items/events store ownership review evidence. | Review state is audit evidence; it does not change source ownership or access. |
| Legacy media reset | Dry-run/action tracking exists for narrow domains. | Current live dry-run evidence is unsafe; confirmed deletion is blocked. |

## Current Sensitive Data Rules

Do not expose in docs, logs, exports, or test output:

- raw prompts or provider request/response bodies,
- private R2 keys or signed URLs,
- cookies, auth headers, bearer tokens, secrets, private keys,
- Stripe or Cloudflare secret data,
- raw idempotency keys or raw request fingerprints,
- unsafe metadata blobs.

## Current Privacy Blockers

- Production/live privacy posture is not proven by local tests.
- Tenant isolation is not claimed.
- Existing legacy media rows are not backfilled or deleted.
- Public/gallery reset implications require explicit operator and product/legal review.
- Data lifecycle remains user-subject centered for current implementation.
- Live billing readiness and remediation workflows are incomplete.

## Current Evidence Links

- Audit baseline: `docs/audits/NEXT_AUDIT_BASELINE.md`
- Data inventory: `DATA_INVENTORY.md`
- Retention baseline: `docs/DATA_RETENTION_POLICY.md`
- Production readiness: `docs/production-readiness/README.md`
- Tenant evidence index: `docs/tenant-assets/evidence/README.md`

## Current Claims Not Made

- No legal compliance certification.
- No production readiness.
- No live billing readiness.
- No access-switch readiness.
- No ownership backfill readiness.
- No confirmed legacy media reset readiness.
