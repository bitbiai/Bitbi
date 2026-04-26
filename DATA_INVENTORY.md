# DATA_INVENTORY.md

Date: 2026-04-26

Scope: Phase 1-H / Phase 1-I engineering inventory for user/account/media/admin/activity/contact/AI data in this repository. This is not a legal compliance certification. Policy decisions that need legal or product review are marked as open decisions.

## Summary

The product stores user account data, authentication state, wallet addresses, profile/avatar data, favorites, generated AI assets, admin/user activity, async video job metadata, poison-message diagnostics, and operational cleanup state in Cloudflare D1 and R2. The contact Worker sends contact form content through Resend; this repository does not currently define durable contact-message storage.

Phase 1-H adds request tracking tables for export/deletion/anonymization planning. Phase 1-I adds bounded JSON export archive generation into private R2 for approved export plans. The current lifecycle system does not execute irreversible deletion by default and does not inline binary R2 media into exports.

## D1 Data Inventory

| Table | Owner key | PII class | Exportable | Deletion/anonymization | Retention recommendation | Notes/open questions |
| --- | --- | ---: | --- | --- | --- | --- |
| `users` | `id` | High | Yes, redacted account fields only | Anonymize or mark pending deletion; do not export `password_hash` | Retain minimal anonymized security record as required | Legal/product must define account-deletion grace period. |
| `sessions` | `user_id` | Secret | No | Revoke/delete on approved deletion | Expire by existing session TTL | Never export token hashes. |
| `password_reset_tokens` | `user_id` | Secret | No | Expire/delete | Short TTL only | Never export token/code hashes. |
| `email_verification_tokens` | `user_id` | Secret | No | Expire/delete | Short TTL only | Never export token/code hashes. |
| `siwe_challenges` | `user_id` | Medium/secret | No | Expire/delete | Short TTL only | Challenge material is auth state, not user export content. |
| `profiles` | `user_id` | Medium | Yes | Delete/anonymize | Retain only if account remains active | Avatar object is represented as an R2 reference, not inline binary. |
| `linked_wallets` | `user_id` | Medium | Yes | Delete/unlink | Retain only while account is active | Wallet addresses can identify a user and should be handled as PII. |
| `favorites` | `user_id` | Low/medium | Yes | Delete | Retain only while account is active | Contains user preference/activity. |
| `ai_folders` | `user_id` | Low/medium | Yes | Delete | Retain only while account is active | Folder names can contain user-provided text. |
| `ai_images` | `user_id` | Medium/high | Yes, metadata and R2 references | Delete D1 row and R2 objects after approved execution | Retain while account/assets are active | Prompts can contain personal data; do not export provider secrets or raw internal payloads. |
| `ai_text_assets` | `user_id` | Medium/high | Yes, metadata and R2 references | Delete D1 row and R2 objects after approved execution | Retain while account/assets are active | Preview text can contain user content; treat as exportable user data. |
| `ai_video_jobs` | `user_id` | Medium/high | Yes, sanitized job metadata and R2 references | Delete/anonymize job metadata; delete output/poster R2 objects after approved execution | Retain operationally while job/output is active | Provider raw payloads and internal errors must remain redacted. |
| `ai_generation_log` | `user_id` when present | Medium | Summary only | Retain/anonymize depending on security/cost policy | Use bounded operational retention | May contain prompts or provider metadata; export policy requires review. |
| `ai_daily_quota_usage` | `user_id` | Low/medium | Summary yes | Retain or anonymize | Retain for billing/cost/security window | Phase 1-H export plan includes bounded summary entries. |
| `user_activity_log` | `user_id` | Medium | Bounded summary only | Retain/anonymize | Hot window plus archive policy | Do not export raw `meta_json` by default. |
| `admin_audit_log` | `admin_user_id`, `target_user_id` | Medium/high | Redacted only if policy allows | Retain or anonymize, not hard-delete by default | Security/audit retention likely longer than user content | Deletion requests should not erase security evidence without policy approval. |
| `activity_search_index` | `source_id`, actor/target ids | Medium | Derived summary only | Delete/anonymize with source record policy | Same as source activity/audit row | Phase 1-G projection must not become a separate PII sink. |
| `admin_mfa_credentials` | `admin_user_id` | Secret | No | Revoke/delete only after admin continuity review | Retain only for enrolled admins | Never export encrypted TOTP secrets or recovery material. |
| `admin_mfa_recovery_codes` | `credential_id` | Secret | No | Revoke/delete with credential | Retain only for enrolled admins | Never export code hashes. |
| `admin_mfa_failed_attempts` | `admin_user_id` | Security | No | Expire/delete by lockout policy | Short operational retention | Used for security controls, not user export content. |
| `rate_limit_counters` | route/key | Low/security | No | Expire/delete | Short operational retention | Keys may include IP-derived values; avoid export. |
| `r2_cleanup_queue` | R2 bucket/key | Operational | No | Process/delete after object cleanup | Short retry retention | Contains object keys and error summaries. |
| `ai_video_job_poison_messages` | `job_id` when parseable | Operational/security | No by default | Retain/redact | Operational retention window | Admin inspection returns sanitized diagnostics only. |
| `data_lifecycle_requests` | `subject_user_id` | Medium/high | Request metadata yes | Retain as compliance/support evidence | Define legal retention | Added in migration `0032`. |
| `data_lifecycle_request_items` | `request_id` | Medium/high | Yes to authorized admin/support | Retain with request | Define legal retention | Summaries must remain redacted and planning-only unless approved executor exists. |
| `data_export_archives` | `subject_user_id` | High | Authorized admin download/reference only | Expire metadata and later delete archive object by TTL | 14 days for generated archives | Phase 1-I records private R2 archive metadata, SHA-256, size, manifest version, expiration, and status. |

## R2 Inventory

| Binding | Bucket | Owner key pattern | PII class | Export behavior | Deletion behavior | Notes/open questions |
| --- | --- | --- | ---: | --- | --- | --- |
| `PRIVATE_MEDIA` | `bitbi-private-media` | `avatars/{user_id}` and private media keys | Medium/high | Export reference/manifest only; no inline binaries | Delete planned after approval | Do not inline binary objects during planning or archive generation. |
| `USER_IMAGES` | `bitbi-user-images` | AI image/text/audio/video object keys | Medium/high | Export reference/manifest only; no inline binaries | Delete planned after approval | Includes generated images, text assets, video outputs/posters. |
| `AUDIT_ARCHIVE` | `bitbi-audit-archive` | Archived audit/activity objects; generated export archive JSON under `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` | Medium/high/security | Audit archives are not user-exportable by default; generated export archives are admin-authorized JSON manifests | Retain/anonymize audit archives per audit policy; expire export archives by TTL | Must preserve security evidence unless legal policy says otherwise. Generated export archives use ids only in archive keys, do not inline binary media, and expose media key digests/classes instead of raw internal media R2 keys. |

## Contact Worker Data

| Data | Owner key | PII class | Exportable | Deletion/anonymization | Notes |
| --- | --- | ---: | --- | --- | --- |
| Contact form payload sent through Resend | Email address/message content | High | Not currently represented in D1 export plan | External retention policy required | `workers/contact/src/index.js` sends email via Resend; no repo-owned contact-message table was identified. |
| Contact rate-limit state | IP/rate key | Security | No | Expire | Durable Object state is operational, not export content. |

## Current Phase 1-H / Phase 1-I Coverage

- Export planning covers account/profile/wallet/favorite/folder/AI asset/video/quota/activity summaries plus R2 object references.
- Approved export plans can generate bounded JSON archives in `AUDIT_ARCHIVE`; archive metadata is tracked in D1 and admin download is authorized through the auth Worker.
- Deletion/anonymization planning covers the same owned records plus session/token revocation, admin MFA revocation, and audit-log retain/anonymize actions.
- Planning is idempotent by request id and safe by default; no irreversible deletion executor is present.
- Export archives are metadata-expired after 14 days; physical R2 cleanup for expired archive objects remains future work.
- User self-service export/delete endpoints are deferred; Phase 1-H/1-I provides admin/support APIs only.

## Open Decisions

- Legal retention windows for audit logs, activity logs, lifecycle requests, export archives, contact emails, and generated AI content.
- Whether generated prompts/content should be exportable in full or summarized/redacted.
- Whether contact-form messages should be stored in a repo-owned table for export/delete traceability.
- Whether historical R2 objects have complete owner-key coverage before destructive deletion execution.
- Whether user self-service requests should require email confirmation, cooldowns, and delayed execution.
- Whether deleted accounts should be anonymized in place, tombstoned, or recreated as separate compliance records.
