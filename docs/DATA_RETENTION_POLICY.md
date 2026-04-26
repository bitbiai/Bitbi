# Data Retention Policy Engineering Baseline

Date: 2026-04-26

This file is an engineering baseline for retention and deletion behavior. It is not legal advice and does not claim GDPR/CCPA compliance. Product/legal review is required before enabling irreversible deletion or promising user-facing retention terms.

## Principles

- Keep authentication secrets, session material, MFA material, reset tokens, service signatures, and provider credentials out of exports.
- Preserve security/audit evidence unless a reviewed retention policy explicitly allows deletion or anonymization.
- Prefer dry-run deletion plans and admin approval before any irreversible operation.
- Treat generated AI prompts, previews, media, wallet addresses, contact messages, and profile fields as potentially personal data.
- Do not inline large R2 binaries into export archives; use authorized manifest references or a separate archive workflow.

## Retention Candidates

| Data | Current behavior observed | Proposed retention | Deletion/anonymization action | Enforcement status |
| --- | --- | --- | --- | --- |
| Sessions | Cron cleanup exists for expired sessions. | Session TTL plus cleanup grace. | Revoke/delete on approved deletion. | Existing cleanup plus Phase 1-H plan item. |
| Password reset tokens | Expiring auth tokens exist. | Short TTL only. | Expire/delete. | Existing cleanup plus Phase 1-H plan item. |
| Email verification tokens | Expiring verification tokens exist. | Short TTL only. | Expire/delete. | Existing cleanup plus Phase 1-H plan item. |
| SIWE challenges | Challenge table exists. | Short TTL only. | Expire/delete. | Existing cleanup plus Phase 1-H plan item. |
| Admin MFA proofs/failed attempts | Durable failed-attempt state exists. | Short operational lockout window. | Expire/delete after lockout window. | Existing security state; explicit retention cleanup remains future work. |
| Admin MFA credentials/recovery codes | Stored for enrolled admins. | Retain while admin enrollment is active. | Revoke/delete only after admin continuity review. | Phase 1-H plans revoke action; executor deferred. |
| Profiles/avatars | Profile row and private R2 avatar. | Retain while account is active. | Delete/anonymize row; delete avatar object after approval. | Phase 1-H plan item only. |
| Wallet addresses | Linked wallet table. | Retain while linked/account active. | Delete/unlink. | Phase 1-H plan item only. |
| Favorites/folders | User-owned D1 rows. | Retain while account is active. | Delete. | Phase 1-H plan item only. |
| Generated AI images/text/audio/video | D1 metadata and `USER_IMAGES` R2 objects. | Retain while user keeps assets or product policy allows. | Delete D1 rows and R2 objects after approval. | Phase 1-H plan item only; executor deferred. |
| AI video jobs | D1 job state plus R2 output/poster references. | Retain operationally while output is active; later archive or prune. | Delete/anonymize job metadata and R2 output after approval. | Phase 1-H plan item only. |
| AI video poison messages | D1 operational diagnostics. | Short to medium operational window. | Retain/redact; eventually purge. | Admin inspection exists; retention cleanup remains future work. |
| User activity logs | Hot table plus archive behavior. | Hot operational window plus archive policy. | Retain/anonymize for deletion requests. | Phase 1-G bounded hot-window search; Phase 1-H plan item. |
| Admin audit logs | Admin/security audit table and archive. | Security/legal retention window, likely longer than user content. | Retain or anonymize target identifiers after approved policy. | Phase 1-H plans retain/anonymize; no hard-delete. |
| Activity search projection | Derived indexed fields. | Same as source event. | Delete/anonymize with source event. | Projection cleanup exists for archive/prune; lifecycle executor deferred. |
| Contact form submissions | Sent through Resend; no repo-owned D1 table identified. | External processor retention policy required. | Manual processor workflow until repo-owned storage exists. | Not enforced by repo. |
| Export archives | Schema added in `data_export_archives`. | Proposed 14 days. | Expire/delete archive object. | Schema only in Phase 1-H; archive generation deferred. |
| Data lifecycle requests/items | D1 request evidence. | Legal/support retention to be defined. | Retain as compliance/support evidence. | Schema and admin APIs added. |
| Temporary R2 objects/cleanup queue | Cleanup/retry queue exists for some objects. | Short operational retry window. | Retry/delete stale objects. | Existing cleanup plus future lifecycle executor. |

## Current Enforcement

Phase 1-H enforces request creation, planning, approval state, idempotency, route policy registration, admin-only access, fail-closed rate limiting, same-origin checks, and byte-limited bodies. It does not execute irreversible deletion and does not generate export archives.

## Required Before Destructive Deletion

1. Legal/product approval of retention windows and deletion exceptions.
2. Staging verification that every R2 object key pattern is owner-scoped and complete.
3. A two-step approval/execution model with idempotency and audit events.
4. A recovery grace period or explicit no-recovery policy.
5. Dry-run comparison of planned D1/R2 actions against expected user data.
6. Tests proving cross-user data is not included and audit records are retained/anonymized correctly.
7. Runbook updates for accidental deletion, rollback limitations, and support communication.
