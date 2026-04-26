# DATA_INVENTORY.md

Date: 2026-04-26

Scope: Phase 1-H / Phase 1-I / Phase 1-J engineering inventory for user/account/media/admin/activity/contact/AI data in this repository. This is not a legal compliance certification. Policy decisions that need legal or product review are marked as open decisions.

## Summary

The product stores user account data, authentication state, wallet addresses, profile/avatar data, favorites, generated AI assets, admin/user activity, async video job metadata, poison-message diagnostics, and operational cleanup state in Cloudflare D1 and R2. The contact Worker sends contact form content through Resend; this repository does not currently define durable contact-message storage.

Phase 1-H adds request tracking tables for export/deletion/anonymization planning. Phase 1-I adds bounded JSON export archive generation into private R2 for approved export plans. Phase 1-J adds bounded cleanup for expired export archive objects and a safe executor pilot for reversible auth-state cleanup. Phase 2-A adds organization and membership foundation tables but does not migrate existing user-owned assets into tenant ownership. Phase 2-B adds billing/plan/entitlement/credit ledger foundation tables without enabling a live payment provider. Phase 2-C starts writing organization-scoped `usage_events` / `credit_ledger` debits only for `/api/ai/generate-image` requests that explicitly include organization context. Phase 2-D adds `ai_usage_attempts` so those org-scoped image requests can reserve credits, avoid duplicate provider calls on idempotent retries, and replay stored temporary results when available. Phase 2-E adds bounded cleanup/admin inspection for expired or stuck `ai_usage_attempts`. Phase 2-F adds bounded, prefix-scoped cleanup for expired temporary replay objects after validating attempt linkage. Phase 2-H adds org-scoped member text generation at `/api/ai/generate-text`, using the same `usage_events`, `credit_ledger`, and `ai_usage_attempts` foundation with bounded text replay metadata in `metadata_json`; it does not add no-org text generation or charge admin/text-asset routes. Phase 2-I adds provider-neutral billing event ingestion tables and a synthetic test webhook foundation; it stores payload hashes and sanitized summaries only, does not store raw webhook bodies/signatures/payment method data, and does not grant credits or update subscriptions from provider events. Cleanup still does not hard-delete attempts, ledger rows, usage events, saved media, private media, audit archives, export archives, video outputs, derivatives, or unrelated R2 data. The current lifecycle system does not execute irreversible deletion by default and does not inline binary R2 media into exports.

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
| `data_export_archives` | `subject_user_id` | High | Authorized admin download/reference only | Expire metadata and delete only approved `data-exports/` archive objects through bounded cleanup | 14 days for generated archives | Phase 1-I records private R2 archive metadata, SHA-256, size, manifest version, expiration, and status. Phase 1-J cleanup is prefix-scoped and does not touch audit archives or user media. |
| `organizations` | `id`, `created_by_user_id` | Medium | Deferred; include org metadata only after export policy update | Retain/anonymize according to org ownership policy | Define after org lifecycle policy | Added in Phase 2-A as additive tenant/RBAC foundation. Existing user-owned records are not migrated to org ownership yet. |
| `organization_memberships` | `organization_id`, `user_id` | Medium | Deferred; include user memberships only after export policy update | Remove/anonymize according to membership lifecycle policy | Define after org lifecycle policy | Added in Phase 2-A. Roles are `owner`, `admin`, `member`, `viewer`; no billing/entitlement data is stored here. |
| `plans` | plan id/code | None/low | No user export by default | Retain while referenced by subscriptions/ledger | Product/billing policy | Added in Phase 2-B. Contains plan metadata only; no prices or live provider data. |
| `organization_subscriptions` | `organization_id` | Medium | Deferred; include only after org/billing export policy update | Retain/anonymize according to org billing policy | Define after billing policy | Phase 2-B placeholder for future paid plans; no live provider integration is enabled. |
| `entitlements` | `plan_id`, feature key | None/low | No user export by default | Retain with plan | Product/billing policy | Phase 2-B feature limits/flags for future enforcement. |
| `billing_customers` | `organization_id`, provider reference | Medium | No user export by default until provider policy is defined | Retain/anonymize according to billing/legal policy | Define before payment provider integration | Placeholder mapping table only; must not contain payment secrets. |
| `credit_ledger` | `organization_id`, `created_by_user_id` | Medium | Deferred; summarize only after billing export policy update | Retain for auditability; anonymize actor fields only with approved policy | Billing/audit retention required | Phase 2-B records credit grants/consumption and running balances. |
| `usage_events` | `organization_id`, `user_id` | Medium | Deferred; summarize only after billing export policy update | Retain/anonymize according to usage/billing policy | Billing/cost retention required | Phase 2-B records idempotent feature usage events; Phase 2-C writes org-scoped image generation usage and Phase 2-H writes org-scoped text generation usage. Metadata contains route/operation/model only, not raw prompts or request bodies. |
| `ai_usage_attempts` | `organization_id`, `user_id` | Medium/high | Deferred; summarize only after billing export policy update | Retain short-to-medium operational/audit window; release expired/stuck reservations, expire replay metadata, and delete only expired attempt-linked temporary replay objects under `tmp/ai-generated/{userId}/{tempId}` | Billing/cost/retry safety | Phase 2-D records org-scoped image generation attempt/reservation/finalization state. Phase 2-E adds admin-only sanitized inspection and bounded scheduled/admin cleanup for expired or stuck attempts. Phase 2-F deletes only expired, finalized, attempt-linked replay objects after strict prefix/user/key validation; unsafe keys are skipped. Phase 2-H also records org-scoped text generation attempts and bounded generated-text replay metadata in `metadata_json`. It stores request fingerprints, idempotency hashes, sanitized result references, bounded replay text for text attempts, and status/error codes; it does not store raw prompts, image bytes, provider secrets, service-auth data, or raw request bodies. Admin responses omit raw hashes, fingerprints, temp object keys, save references, and replay text. |
| `billing_provider_events` | provider event id, optional `organization_id`/`billing_customer_id` | Medium | Deferred; admin/support inspection only until billing export policy is defined | Retain according to billing/legal policy after provider selection | Billing/webhook audit retention required | Phase 2-I stores verified synthetic billing event metadata, payload hash, sanitized payload summary, verification status, processing status, and optional resolved references. It intentionally does not store raw webhook bodies, raw signatures, card/bank/payment method data, provider secrets, checkout sessions, invoices, or full provider payloads. Live-mode events are rejected and no subscriptions/credits are changed. |
| `billing_event_actions` | `event_id` | Medium | Deferred; admin/support inspection only until billing export policy is defined | Retain with source event | Billing/webhook audit retention required | Phase 2-I stores dry-run/deferred action summaries only. Action rows are planning records and do not activate subscriptions, grant credits, create invoices, or call provider APIs. |

## R2 Inventory

| Binding | Bucket | Owner key pattern | PII class | Export behavior | Deletion behavior | Notes/open questions |
| --- | --- | --- | ---: | --- | --- | --- |
| `PRIVATE_MEDIA` | `bitbi-private-media` | `avatars/{user_id}` and private media keys | Medium/high | Export reference/manifest only; no inline binaries | Delete planned after approval | Do not inline binary objects during planning or archive generation. |
| `USER_IMAGES` | `bitbi-user-images` | AI image/text/audio/video object keys | Medium/high | Export reference/manifest only; no inline binaries | Delete planned after approval | Includes generated images, text assets, video outputs/posters. |
| `AUDIT_ARCHIVE` | `bitbi-audit-archive` | Archived audit/activity objects; generated export archive JSON under `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` | Medium/high/security | Audit archives are not user-exportable by default; generated export archives are admin-authorized JSON manifests | Retain/anonymize audit archives per audit policy; expire export archives by TTL and delete only approved `data-exports/` objects through bounded cleanup | Must preserve security evidence unless legal policy says otherwise. Generated export archives use ids only in archive keys, do not inline binary media, and expose media key digests/classes instead of raw internal media R2 keys. Phase 1-J cleanup refuses non-`data-exports/` keys. |

## Contact Worker Data

| Data | Owner key | PII class | Exportable | Deletion/anonymization | Notes |
| --- | --- | ---: | --- | --- | --- |
| Contact form payload sent through Resend | Email address/message content | High | Not currently represented in D1 export plan | External retention policy required | `workers/contact/src/index.js` sends email via Resend; no repo-owned contact-message table was identified. Phase 1-J keeps this as an explicit processor-policy gap. |
| Contact rate-limit state | IP/rate key | Security | No | Expire | Durable Object state is operational, not export content. |

## Historical R2 Ownership Policy

Known owner-linked prefixes:

- `PRIVATE_MEDIA` avatar keys under `avatars/{userId}`.
- `USER_IMAGES` generated media keys under `users/{userId}/...`.
- `AUDIT_ARCHIVE` data export archive keys under `data-exports/{subjectUserId}/{requestId}/{archiveId}.json`.

Excluded from destructive deletion until owner mapping is proven:

- Audit/activity archive JSONL chunks outside `data-exports/`.
- Any legacy/private media key not linked to a D1 owner row.
- Any provider/transient object without a D1 owner row.

## Current Phase 1-H / Phase 1-I / Phase 1-J Coverage

- Export planning covers account/profile/wallet/favorite/folder/AI asset/video/quota/activity summaries plus R2 object references.
- Approved export plans can generate bounded JSON archives in `AUDIT_ARCHIVE`; archive metadata is tracked in D1 and admin download is authorized through the auth Worker.
- Expired export archives can be cleaned up through bounded admin/scheduled cleanup that only deletes approved `data-exports/` objects and marks metadata deleted or cleanup-failed.
- Deletion/anonymization planning covers the same owned records plus session/token revocation, admin MFA revocation, and audit-log retain/anonymize actions.
- The safe executor pilot can revoke sessions, expire reset/verification/SIWE challenge rows, and expire export archive metadata for approved requests.
- Planning is idempotent by request id and safe by default; no irreversible deletion executor is present.
- Irreversible hard deletion of users, user media, AI asset rows, and audit records remains disabled.
- User self-service export/delete endpoints are deferred; Phase 1-H/1-I provides admin/support APIs only.
- Organization, membership, billing, entitlement, credit ledger, usage-event, AI usage-attempt, and billing-provider event export/delete behavior is not yet integrated into lifecycle plans; Phase 2-A/2-B/2-C/2-D/2-E/2-F/2-H/2-I only add schema, helpers, minimal APIs, org-scoped image/text generation debits, retry-safe attempt tracking, bounded attempt cleanup/inspection, bounded temporary replay cleanup, and provider-neutral billing-event ingestion/inspection.

## Open Decisions

- Legal retention windows for audit logs, activity logs, lifecycle requests, export archives, contact emails, and generated AI content.
- Whether generated prompts/content should be exportable in full or summarized/redacted.
- Whether contact-form messages should be stored in a repo-owned table for export/delete traceability.
- Whether historical R2 objects have complete owner-key coverage before destructive deletion execution.
- Whether user self-service requests should require email confirmation, cooldowns, and delayed execution.
- Whether deleted accounts should be anonymized in place, tombstoned, or recreated as separate compliance records.
- How organization ownership, membership history, and future tenant-owned assets should be represented in export/deletion/anonymization plans.
- How organization billing history, provider customer mappings, credit ledger entries, usage events, and AI usage attempts should be represented in export/deletion/anonymization plans before a live payment provider is added.
- How provider-specific billing webhook event summaries and dry-run actions should be represented in export/deletion/anonymization plans after provider selection and legal review.
- Whether long-term retention/anonymization policy for `ai_usage_attempts` should remove or summarize old non-secret operational rows after billing dispute windows are defined.
