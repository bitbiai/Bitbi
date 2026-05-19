# Data Inventory

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

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

## Current User And Auth Data

- User accounts, profiles, wallets, sessions, verification/reset tokens, admin MFA state, recovery metadata, and activity logs exist.
- Admin access requires appropriate authorization and MFA flows.
- Secrets must never be printed into evidence.
- Admin user deletion is an operational cleanup path, not a full legal erasure claim: it uses explicit confirmation plus dependency preflight, disables login through an operational anonymized user row, removes the account from the default Admin Users list, clears sessions, verification/reset tokens, profile, wallet/preference/storage quota rows, and user-owned AI image/text/folder metadata through guarded Admin deletion, while audit/activity, billing/credit, data lifecycle, legal, and other retention-governed records remain policy-controlled.

## Current Billing And AI Cost Data

- Credit ledgers, usage attempts/events, billing evidence status, billing review/reconciliation evidence, platform budget switches/caps/repair/archive tables exist.
- Live billing readiness remains blocked.
- Billing evidence surfaces must remain presence/shape-only for Stripe config and must not store or render raw Stripe payloads, signatures, secrets, payment methods, cookies, or session tokens. Refund/dispute/payment-failure records are review-only unless a later approved workflow explicitly changes credit behavior.
- Admin/platform budget controls are scoped; internal AI Worker provider-cost routes require caller policy, but not every provider/budget scope is universally capped.
- Operator Timeline/Triage reads audit/activity, billing, lifecycle, tenant, AI budget, readiness, and archive metadata as bounded redacted Admin-only summaries. It must not call external APIs, list live R2, or mutate D1/R2/Queues.

## Current Media And Tenant Asset Data

- `ai_folders` and `ai_images` include nullable ownership metadata.
- New personal folder/image writes assign ownership metadata.
- Legacy folder/image rows remain unresolved unless current evidence proves otherwise.
- `ai_asset_manual_review_items` and `ai_asset_manual_review_events` store manual-review state and events.
- `tenant_asset_media_reset_actions` and `tenant_asset_media_reset_action_events` store reset action/evidence tracking.
- `ai_text_assets`, video jobs, music/audio assets, profile avatars, lifecycle exports, audit archives, and unknown media tables remain outside first-pass reset execution. Confirmed first-pass reset is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is explicitly enabled in a future approved phase; no sanitized reset dry-run evidence package is currently accepted.
- Data lifecycle request, approval, export archive, cleanup, and safe-execution rows are admin-controlled evidence surfaces. High-risk lifecycle mutations require idempotency, explicit confirmation where needed, audit logging, and redacted private storage references.

## Current Evidence State

- Folder/image owner-map evidence exists and requires manual review.
- Manual-review operator evidence exists but still needs import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence.
- Legacy media reset dry-run decision evidence is rejected unsafe because it exposed a raw idempotency key; the raw JSON is not present in the current checkout.
- Confirmed media reset/deletion has not been approved or performed.
- Local evidence index tooling inventories repo evidence files, classifies accepted/pending/rejected-unsafe/template/historical states, and reports unsafe marker IDs without printing raw values.
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
