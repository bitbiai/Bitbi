# Data Inventory

Date: 2026-05-20

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Purpose: current engineering data inventory for audit restart. This is not legal advice or production-readiness approval.

## Primary Stores

| Store | Current use | Current risk |
| --- | --- | --- |
| Auth D1 database | Users, sessions, profiles, orgs, billing/credits, AI attempts, media metadata, lifecycle, audit/activity logs, admin evidence, tenant review/reset state. | Requires migration/deploy verification before readiness claims. Operator timeline reads must stay bounded and redacted. |
| `USER_IMAGES` R2 | User-generated media, derivatives, generated covers/posters, video outputs, platform visual assets. | R2 keys are not tenant-isolation proof; evidence/log surfaces should expose classes/hashes/counts instead of raw private keys. No live listing/deletion without approval. |
| `PRIVATE_MEDIA` R2 | Avatars and protected private media. | Access must remain auth-gated. |
| `AUDIT_ARCHIVE` R2 | Data exports and platform/admin evidence archives. | Retention and access controls must preserve audit integrity. |
| Queues/Durable Objects | Activity ingest, derivative generation, video jobs, rate limiting, replay protection. | Live bindings require verification. |
| Cloudflare deployment/resource metadata | Repo declarations for Workers, routes, D1, R2, Queues, Durable Objects, service bindings, Images, Workers AI, cron, secrets by name, and dashboard-managed prerequisites. | `npm run cloudflare:resource-model` validates repo parity only; live resource presence and dashboard settings require operator evidence. |

## App Settings

- `app_settings` stores bounded operator-controlled platform settings such as registration availability.
- Current use: `registration.availability` enables/disables new account creation during maintenance or SaaS buildout.
- Missing setting defaults to registrations enabled. The switch does not disable existing user login, active sessions, password reset, MFA, admin access, profile access, billing records, or audit retention.

## Current User And Auth Data

- User accounts, profiles, wallets, sessions, verification/reset tokens, admin MFA state, recovery metadata, and activity logs exist.
- Admin access requires appropriate authorization and MFA flows.
- Secrets must never be printed into evidence.
- Admin user deletion has two Admin-only modes. Operational delete uses explicit confirmation plus dependency preflight, disables login through an operational anonymized user row, removes the account from the default Admin Users list, clears sessions, verification/reset tokens, profile, wallet/preference/storage quota rows, and user-owned AI image/text/folder metadata through guarded Admin deletion. The optional Data Erasure/GDPR mode starts a dry-run, approval-required data lifecycle `delete` workflow for privacy/legal review before operational deletion. It does not immediately execute legal erasure or automatically destroy audit/activity, billing/credit, provider, legal, or other retention-governed records.

## Current Billing And AI Cost Data

- Credit ledgers, usage attempts/events, billing evidence status, billing review/reconciliation evidence, platform budget switches/caps/repair/archive tables exist.
- Live billing readiness remains blocked.
- Billing evidence surfaces must remain presence/shape-only for Stripe config and must not store or render raw Stripe payloads, signatures, secrets, payment methods, cookies, or session tokens. Refund/dispute/payment-failure records are review-only unless a later approved workflow explicitly changes credit behavior.
- Admin/platform budget controls are scoped; internal AI Worker provider-cost routes require caller policy, but not every provider/budget scope is universally capped.
- Operator Timeline/Triage reads audit/activity, billing, lifecycle, tenant, AI budget, readiness, and archive metadata as bounded redacted Admin-only summaries. It must not call external APIs, list live R2, or mutate D1/R2/Queues.

## Current Media And Tenant Asset Data

- `ai_folders` and `ai_images` include nullable ownership metadata.
- New personal folder/image writes assign ownership metadata.
- Current post-cleanup folder/image evidence shows one exact safe `ai_images` ownership candidate prepared for operator execution; no global backfill or Access-Switch claim is made. Prior owner-map/manual-review/reset counts are stale after the operator manually deleted most old images/videos, and copied evidence files do not automatically mutate D1 review rows.
- `ai_asset_manual_review_items` and `ai_asset_manual_review_events` store manual-review state and events.
- Manual-review post-cleanup classification/export can split historical D1 review rows from active current, blocked, pending, deferred, unknown, and safe supersession candidates. Guarded supersession marks safe rows `superseded` only; it does not delete media rows or mutate source assets/R2.
- `tenant_asset_media_reset_actions` and `tenant_asset_media_reset_action_events` store reset action/evidence tracking.
- `ai_text_assets`, video jobs, music/audio assets, profile avatars, lifecycle exports, audit archives, and unknown media tables remain outside first-pass reset execution. Confirmed first-pass reset is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is explicitly enabled in a future approved operator package; no sanitized reset dry-run evidence package is currently accepted.
- Admin Tenant Isolation Execution provides warning-gated controls for Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset. Backfill dry-run/evidence classifies folder/image rows and the high-risk executor can write only safe classified ownership metadata when explicitly confirmed with Admin/MFA, `Idempotency-Key`, reason, supported domain scope, and `BACKFILL OWNERSHIP`. Access-Switch remains read-only status/shadow diagnostics; enforced runtime switching is blocked. Reset remains dry-run/evidence/status by default and confirmed execution requires the disabled backend gate plus `CONFIRMED LEGACY MEDIA RESET`.
- Data lifecycle request, approval, export archive, cleanup, safe-execution, final-completion, close/reject, retained-category, and evidence-status rows are admin-controlled evidence surfaces. High-risk lifecycle mutations require idempotency, explicit confirmation where needed, audit logging, and redacted private storage references.
- Admin Data Lifecycle now includes a request detail overlay and evidence packet surface. Request detail, Generate Plan, Approve, Execute Safe, Mark Completed, Reject, Close, private export archive metadata, and JSON/Markdown/HTML evidence exports are Admin/MFA-gated and bounded. Final states distinguish `completed`, `completed_with_retention`, `rejected`, `closed`, and `blocked_requires_legal_review` without claiming production readiness or unchecked legal erasure.

## Current Evidence State

- Folder/image owner-map evidence exists as historical retained evidence and now requires post-cleanup refresh before use in current decisions.
- Manual-review operator evidence exists but old queue/status counts may reference removed assets; it still needs post-cleanup dry-run/export review plus import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence.
- Legacy media reset dry-run decision evidence is rejected unsafe because it exposed a raw idempotency key; the raw JSON is not present in the current checkout, and old candidate counts are stale after manual cleanup.
- Post-cleanup rebaseline status is `post_cleanup_manual_review_supersession_supported_backfill_candidate_still_operator_pending` in `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`.
- Confirmed media reset/deletion has not been approved or performed.
- Local evidence index tooling inventories repo evidence files, classifies accepted/pending/rejected-unsafe/template/historical/stale-superseded states, and reports unsafe marker IDs without printing raw values.
- Production readiness dossier, Cloudflare resource model, rollback drill, RC Go/No-Go manifest, and final RC validation matrix tooling exist as local-only evidence organizers. They keep production readiness blocked, do not call live services, and do not mutate D1/R2/Queues/Cloudflare/GitHub/Stripe/provider state.
- Evidence index unsafe-marker candidates are actionable by file path and marker ID only. Active-current blockers, historical archive candidates, template/example candidates, accepted redacted markers, and manual-review cases must be reviewed without printing raw values.

## Blocked Claims

- No production readiness.
- No live billing readiness.
- No full tenant isolation.
- No ownership backfill readiness.
- No access-switch readiness.
- No confirmed legacy media reset readiness.

## Historical Context

Historical implementation evidence is indexed in `docs/audits/README.md`. Current audit restart starts at `docs/audits/NEXT_AUDIT_BASELINE.md`.
