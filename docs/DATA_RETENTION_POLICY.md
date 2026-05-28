# Data Retention Policy

Date: 2026-05-20

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

Purpose: current engineering retention baseline. This is not legal approval and does not authorize destructive deletion.

## Current Retention Baseline

| Data class | Current handling | Open decision |
| --- | --- | --- |
| User/auth/session data | Stored in Auth D1; cleanup exists for expired/temporary records where implemented. | Legal/product retention windows need final approval. |
| Profiles/avatars | Profile state in D1; avatar media in `PRIVATE_MEDIA`. | Organization publisher/avatar policy remains deferred. |
| Generated media metadata | D1 rows for images, folders, text/audio/video assets, video jobs, derivatives/posters. | Tenant ownership and reset decisions remain blocked for legacy rows. |
| Media objects | R2 objects under known bindings. | No live R2 deletion/listing without explicit approved executor/evidence. |
| Billing/credits/AI usage | D1 ledgers/attempts/events/reconciliation evidence. | Live billing readiness and remediation workflows remain blocked. |
| Data lifecycle/export archives | D1 lifecycle rows and `AUDIT_ARCHIVE` outputs. | Self-service and legal-approved irreversible delete flows remain open. |
| Admin/platform evidence archives | Sanitized evidence archives under audit retention, with metadata visible through Admin evidence/archive panels and Operator Timeline where supported. | Preserve audit integrity; do not delete unique evidence. |
| Tenant manual-review/reset evidence | D1 review/reset action rows plus committed evidence docs. | Current reset dry-run evidence is unsafe and confirmation remains blocked. |

## Current Tenant Asset Retention State

- Existing legacy folder/image rows are not backfilled or deleted by current policy.
- Manual-review rows/events are audit evidence and should be retained until a future retention policy explicitly covers them.
- Reset action/event rows are audit evidence and should be retained.
- Confirmed legacy media reset/deletion has not been approved.

## Current Deletion Boundaries

- Admin user deletion has two guarded modes. The default operational delete requires Admin auth/MFA, rate limiting, explicit JSON confirmation, self-delete prevention, dependency preflight, and audit logging. The current runtime uses operational anonymized deletion: login is disabled, the default Admin Users list hides the account, sessions/auth tokens/profile/wallet links/preferences/storage quota rows and user-owned AI image/text/folder metadata are removed through labeled cleanup statements, and avatar object cleanup is best-effort after the committed D1 mutation.
- Admins may optionally start a Data Erasure/GDPR workflow from the same delete confirmation dialog. That option creates a dry-run, approval-required data lifecycle `delete` request for privacy/legal review before operational deletion; it does not execute destructive legal erasure immediately and does not automatically delete billing, audit, provider, legal, or compliance records.
- Admin user deletion is not full legal/GDPR erasure. The anonymized user row can remain to preserve foreign-key integrity for audit/activity evidence, billing/credit ledgers and provider evidence, data lifecycle records, legal/compliance records, and other retention-governed records until an approved evidence-backed erasure/anonymization workflow completes. This policy is an engineering baseline, not legal advice.
- No broad SQL deletes.
- No direct R2 prefix deletes.
- No live R2 listing as part of documentation/evidence phases.
- No ownership backfill or access-switching through retention policy.
- No billing/credit refunds through media reset.
- Admin data lifecycle approval, export generation, expired archive cleanup, and non-dry-run safe execution require `Idempotency-Key`; high-risk approval/export/cleanup and `execute-safe` with `dryRun:false` also require explicit `confirm=true`.
- Admin Data Lifecycle requests have a review overlay in the Admin Control Plane. It exposes request details, redacted subject/request metadata, plan generation, approval, safe execution where backend policy allows, guarded final completion, reject/close status actions, and sanitized JSON/Markdown/HTML evidence exports for PDF-friendly browser storage.
- Lifecycle final states are category/evidence based: `completed` means completion evidence supports no policy-retained categories beyond lifecycle evidence itself; `completed_with_retention` means completion was recorded with policy-retained categories still present/anonymized; `rejected`, `closed`, and `blocked_requires_legal_review` are status-only outcomes that perform no data purge.
- Lifecycle evidence exports document current workflow state only. They are not legal advice, do not claim full legal/GDPR completion unless status/evidence says completed, and do not render raw private R2 keys, raw idempotency keys, request hashes, cookies, auth headers, tokens, Stripe/provider payloads, or secrets.
- Data export/archive evidence should expose private storage references only as redacted categories, hashes, counts, or archive metadata, not raw private R2 keys.
- Operator Timeline archive visibility is metadata-only. It reports retention policy/count posture from D1 where available and must not list or delete live R2 objects.

## Evidence Requirements Before Destructive Action

Any future destructive action needs:

1. explicit operator approval,
2. legal/product policy approval where user data is affected,
3. current sanitized evidence,
4. idempotency and audit trail,
5. before/after exports,
6. rollback or reconciliation plan where feasible.

## Current Baseline

Use `docs/audits/NEXT_AUDIT_BASELINE.md` for audit restart and `docs/production-readiness/EVIDENCE_TEMPLATE.md` for readiness evidence capture.

Use `docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md` for audit/activity/archive incident triage and `npm run evidence:index` for local repo evidence inventory.
