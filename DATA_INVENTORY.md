# Data Inventory

Date: 2026-05-19

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current engineering data inventory for audit restart. This is not legal advice or production-readiness approval.

## Primary Stores

| Store | Current use | Current risk |
| --- | --- | --- |
| Auth D1 database | Users, sessions, profiles, orgs, billing/credits, AI attempts, media metadata, lifecycle, admin evidence, tenant review/reset state. | Requires migration/deploy verification before readiness claims. |
| `USER_IMAGES` R2 | User-generated media, derivatives, generated covers/posters, video outputs, platform visual assets. | R2 keys are not tenant-isolation proof; evidence/log surfaces should expose classes/hashes/counts instead of raw private keys. No live listing/deletion without approval. |
| `PRIVATE_MEDIA` R2 | Avatars and protected private media. | Access must remain auth-gated. |
| `AUDIT_ARCHIVE` R2 | Data exports and platform/admin evidence archives. | Retention and access controls must preserve audit integrity. |
| Queues/Durable Objects | Activity ingest, derivative generation, video jobs, rate limiting, replay protection. | Live bindings require verification. |

## Current User And Auth Data

- User accounts, profiles, wallets, sessions, verification/reset tokens, admin MFA state, recovery metadata, and activity logs exist.
- Admin access requires appropriate authorization and MFA flows.
- Secrets must never be printed into evidence.

## Current Billing And AI Cost Data

- Credit ledgers, usage attempts/events, billing evidence status, billing review/reconciliation evidence, platform budget switches/caps/repair/archive tables exist.
- Live billing readiness remains blocked.
- Billing evidence surfaces must remain presence/shape-only for Stripe config and must not store or render raw Stripe payloads, signatures, secrets, payment methods, cookies, or session tokens. Refund/dispute/payment-failure records are review-only unless a later approved workflow explicitly changes credit behavior.
- Admin/platform budget controls are scoped; internal AI Worker provider-cost routes require caller policy, but not every provider/budget scope is universally capped.

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

## Blocked Claims

- No production readiness.
- No live billing readiness.
- No full tenant isolation.
- No ownership backfill readiness.
- No access-switch readiness.
- No confirmed legacy media reset readiness.

## Historical Context

Historical implementation evidence is indexed in `docs/audits/README.md`. Current audit restart starts at `docs/audits/NEXT_AUDIT_BASELINE.md`.
