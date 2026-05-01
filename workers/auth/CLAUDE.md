# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Cloudflare Worker providing auth API for bitbi.ai. Modular ES module architecture using Cloudflare D1 (SQLite) for persistence, Cloudflare AI for image generation, R2 for protected/user-owned media, and cookie-based sessions. No framework — pure request/response handling with manual route matching. Wrangler v4 bundles all ES module imports via esbuild automatically.

## Commands

```bash
# Local dev (uses local D1 SQLite)
npx wrangler dev

# Deploy to Cloudflare
npx wrangler deploy

# Run D1 migrations (local)
npx wrangler d1 migrations apply bitbi-auth-db --local

# Run D1 migrations (remote/production)
npx wrangler d1 migrations apply bitbi-auth-db --remote
```

Repository tests are run from the repo root:

```bash
npm run test:workers
npm run test:release-compat
npm run validate:release
npm run check:route-policies
```

Apply remote D1 migrations before deploying auth-worker code that depends on new tables. Public auth/contact abuse-sensitive rate limiting no longer depends on `0015_add_rate_limit_counters.sql`; that migration still matters for the remaining lower-risk D1-backed limiter callers inside the auth worker.

## Architecture

**Module structure**: `src/index.js` is a thin router (~60 lines) that dispatches to handler modules in `src/routes/`. Shared utilities live in `src/lib/`.

```
src/
├── index.js              ← thin router + scheduled handler
├── lib/
│   ├── response.js       ← json() helper
│   ├── request.js        ← normalizeEmail, isValidEmail, readJsonBody
│   ├── cookies.js        ← parseCookies, buildSessionCookie, buildExpiredSessionCookie
│   ├── passwords.js      ← hashPassword, verifyPassword (PBKDF2-SHA256)
│   ├── tokens.js         ← nowIso, addDaysIso, addMinutesIso, randomTokenHex, sha256Hex
│   ├── session.js        ← getSessionUser, requireUser, requireAdmin
│   ├── rate-limit.js     ← in-memory + shared Durable Object / D1 rate limiting helpers
│   ├── email.js          ← sendVerificationEmail, sendResetEmail, createAndSendVerificationToken
│   ├── activity.js       ← queue-backed admin audit / user activity producers + fallback inserts
│   ├── activity-ingestion.js ← queue consumer batch persistence for audit/activity tables
│   ├── admin-ai-response.js ← admin-only AI proxy response-code normalization
│   └── constants.js      ← VALID_MONSTER_IDS
├── app/
│   └── route-policy.js   ← high-risk route security metadata + lookup helpers
└── routes/
    ├── health.js         ← GET /api/health
    ├── auth.js           ← GET /api/me, POST /api/register, /login, /logout
    ├── password.js       ← POST /api/forgot-password, GET /api/reset-password/validate, POST /api/reset-password
    ├── verification.js   ← GET /api/verify-email, POST /api/resend-verification
    ├── admin.js          ← all /api/admin/* (single dispatcher)
    ├── admin-ai.js       ← admin-only /api/admin/ai/* proxy to workers/ai
    ├── profile.js        ← GET/PATCH /api/profile
    ├── avatar.js         ← GET/POST/DELETE /api/profile/avatar
    ├── favorites.js      ← GET/POST/DELETE /api/favorites
    ├── ai.js             ← /api/ai/* image studio + quota + cleanup handoff
    └── media.js          ← GET /api/thumbnails/*, /api/images/*, /api/music/*, /api/soundlab-thumbs/*
```

**Handler signature**: All route handlers receive a context object `{ request, env, url, pathname, method, isSecure }` built once in index.js. Exceptions: `handleHealth()` takes no args; `handleAdmin(ctx)` and `handleMedia(ctx)` do internal sub-routing and return `null` for unmatched paths.

**Route matching**: Manual `pathname + method` checks in index.js dispatch to route modules. Admin endpoints use `pathname.startsWith()`/`endsWith()` with path splitting to extract `:id` parameters inside `admin.js`.

**Route policy registry**: High-risk auth-worker routes are registered in `src/app/route-policy.js`. Mutating dispatcher branches in `src/index.js` and selected `src/routes/*` files carry `// route-policy: <id>` markers. Keep those markers in sync with the registry and run `npm run check:route-policies` from the repo root after adding or changing sensitive routes. The registry is a review/preflight guard, not a replacement for the existing route-level auth, MFA, CSRF, body-limit, and fail-closed limiter checks.

**Auth flow**: PBKDF2-SHA256 password hashing (100k iterations — Cloudflare Workers runtime cap). Transparent rehash-on-login if stored iterations are below the target. Sessions use a random 32-byte hex token stored in an HttpOnly cookie (`__Host-bitbi_session` on secure HTTPS responses, with legacy `bitbi_session` still accepted for compatibility and local non-HTTPS dev). New session rows store only the SHA-256 hash of `token:SESSION_HASH_SECRET`; legacy `token:SESSION_SECRET` hashes are accepted only while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` is enabled and are opportunistically upgraded after successful validation. Origin validation blocks cross-origin state-changing requests.

**Password reset**: Token-based flow via Resend API email. Raw token sent in email link, only hash stored in DB. Tokens expire after 60 minutes, single-use.

**Email verification**: Token-based flow via Resend API. Verification email sent on registration. Tokens expire after 60 minutes (configured via `addMinutesIso(60)`). Users can resend verification emails. Login is blocked until email is verified (`EMAIL_NOT_VERIFIED` error code).

**Protected media**: R2 bucket (`PRIVATE_MEDIA`) serves images and music only to authenticated users. Media routes return the R2 object with appropriate content-type headers.

**AI Image Studio**: `/api/ai/*` uses the `AI` binding for member image generation, stores saved image blobs in `USER_IMAGES`, stores folder/image metadata in D1, and uses `r2_cleanup_queue` plus the scheduled handler for durable cleanup retries after deletes. `/api/ai/generate-image` without organization context charges the signed-in non-admin member credit balance after successful provider execution. Member balances get at most one UTC-day top-up to 10 credits through `member_credit_ledger`; existing balances of 10 or more receive a zero-credit top-up marker and are not overwritten. Member and organization image charges use the shared server-side image pricing helper. When `organization_id` / `organizationId` is supplied, it requires a valid `Idempotency-Key`, active org membership with `member` or higher role, the `ai.image.generate` entitlement, and sufficient credits before provider execution. Org-scoped image generation creates an `ai_usage_attempts` reservation before provider execution, suppresses same-key duplicate provider calls while pending, finalizes one usage debit only after successful generation, and replays the stored temporary result for same-key/same-body retries when the temp object is still available. `/api/ai/generate-text` is backend-only and org-scoped only: it requires auth, explicit organization context, `Idempotency-Key`, `member` or higher role, the `ai.text.generate` entitlement, and credits. It calls the HMAC-protected `AI_LAB` internal text route and stores bounded generated-text replay metadata in `ai_usage_attempts.metadata_json`; it does not charge admin AI Lab text routes or text asset storage routes. Expired/stuck attempts are handled by bounded scheduled/admin cleanup: stale reservations are released without debits, expired replay metadata is cleared, and expired attempt-linked temporary image replay objects under `tmp/ai-generated/{userId}/{tempId}` are deleted only after strict prefix/user/attempt validation. Cleanup does not delete ledger rows, usage events, attempt rows, saved media, private media, derivatives, video outputs, audit archives, export archives, or unrelated R2 objects.

**Authorization pattern**: `requireUser()` and `requireAdmin()` return either a session object or a `Response` (error). Callers check `result instanceof Response` to distinguish.

## API Routes

- `GET /api/health` — health check
- `GET /api/me` — current user (no auth required, returns `loggedIn: false` if anonymous)
- `POST /api/register` — create account (sends verification email)
- `POST /api/login` — login, sets session cookie
- `POST /api/logout` — destroy session
- `POST /api/forgot-password` — request reset email (always returns success to prevent enumeration)
- `GET /api/reset-password/validate?token=` — check if reset token is valid
- `POST /api/reset-password` — set new password with token
- `GET /api/verify-email?token=` — verify email address
- `POST /api/resend-verification` — resend verification email (requires auth)
- `POST /api/request-reverification` — legacy users request real email verification (requires auth)
- `POST /api/billing/webhooks/test` — synthetic test-only billing event ingestion route with raw-body HMAC verification, byte limit, and fail-closed limiter; no browser CSRF and no live billing side effects
- `POST /api/billing/webhooks/stripe` — Stripe Testmode-only billing webhook route with raw-body `Stripe-Signature` verification, byte limit, and fail-closed limiter; no browser CSRF, no live-mode side effects, no subscriptions/invoices/customer portal
- `POST /api/billing/webhooks/stripe/live` — live Stripe one-time credit-pack webhook route with separate raw-body `Stripe-Signature` verification using `STRIPE_LIVE_WEBHOOK_SECRET`; accepts only live checkout events and grants credits only for persisted live checkout rows created by a currently authorized platform admin or active org owner
- `GET /api/profile` — user profile data (requires auth)
- `PATCH /api/profile` — update profile fields (requires auth)
- `GET /api/profile/avatar` — user's avatar image from R2, or 404 (requires auth)
- `POST /api/profile/avatar` — upload avatar via FormData (requires auth, rate-limited 10/hr)
- `DELETE /api/profile/avatar` — delete avatar from R2 (requires auth)
- `GET /api/favorites` — list saved favorites (requires auth)
- `POST /api/favorites` — save a favorite item (requires auth)
- `DELETE /api/favorites` — remove a favorite item (requires auth)
- `GET /api/orgs` — list organizations for the authenticated user (requires membership)
- `POST /api/orgs` — create an organization with owner membership (requires auth, same-origin, `Idempotency-Key`, fail-closed limiter)
- `GET /api/orgs/:id` — read organization detail for an active member
- `GET /api/orgs/:id/members` — list active members for an active member
- `POST /api/orgs/:id/members` — add a member as org owner/admin with basic role limits (requires auth, same-origin, `Idempotency-Key`, fail-closed limiter)
- `GET /api/orgs/:id/entitlements` — read effective plan entitlements for an active organization member
- `GET /api/orgs/:id/billing` — read organization billing/credit summary for an org owner/admin
- `GET /api/orgs/:id/usage` — read recent organization usage events for an org owner/admin
- `POST /api/orgs/:id/billing/checkout/credit-pack` — create a Stripe Testmode Checkout Session for a fixed server-side credit pack as an active platform admin who is also an org owner/admin (requires auth/admin session, production admin MFA where applicable, same-origin, `Idempotency-Key`, fail-closed limiter, and `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true`); credits are granted only by verified Testmode webhook completion for admin-created persisted checkout sessions
- `POST /api/orgs/:id/billing/checkout/live-credit-pack` — create a live Stripe one-time credit-pack Checkout Session for `live_credits_5000` or `live_credits_12000` as a platform admin or active owner of the target organization (requires auth, same-origin, `Idempotency-Key`, fail-closed limiter, `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true`, live-like Stripe secret config, and server-side role checks; organization admins are not sufficient)
- `GET /api/orgs/:id/billing/credits-dashboard` — read sanitized Credits dashboard data for a platform admin or active organization owner, including balance summary, live fixed-pack catalog, checkout config status, recent live purchases, and recent ledger rows
- `GET /api/orgs/:id/organization-dashboard` — read sanitized Organization dashboard data for a platform admin or active organization owner, including access scope, current organization role, credit balance summary, recent ledger rows, recent `admin_ai_image_test` debits, active member summaries, and platform-admin-not-owner warnings
- `GET /api/thumbnails/little-monster-NN` — protected thumbnail from R2 (requires auth, NN: 01–15)
- `GET /api/images/little-monster-NN` — protected full image from R2 (requires auth, NN: 01–15)
- `GET /api/music/exclusive-track-01` — protected music from R2 (requires auth)
- `GET /api/soundlab-thumbs/:slug` — protected Sound Lab thumbnail from R2 (requires auth)
- `GET /api/admin/me` — admin identity check
- `GET /api/admin/users?search=` — list/search users
- `PATCH /api/admin/users/:id/role` — change role (user/admin)
- `PATCH /api/admin/users/:id/status` — change status (active/disabled)
- `POST /api/admin/users/:id/revoke-sessions` — revoke all sessions
- `DELETE /api/admin/users/:id` — delete user
- `GET /api/admin/stats` — aggregate admin dashboard stats
- `GET /api/admin/billing/plans` — list sanitized billing plans and entitlements (requires admin/MFA in production, fail-closed limiter)
- `GET /api/admin/orgs` — list organization metadata for admin inspection (requires admin/MFA in production, fail-closed limiter)
- `GET /api/admin/orgs/:id` — inspect sanitized organization and member metadata (requires admin/MFA in production, fail-closed limiter)
- `GET /api/admin/orgs/:id/billing` — inspect sanitized organization billing/credit state (requires admin/MFA in production, fail-closed limiter)
- `POST /api/admin/orgs/:id/credits/grant` — grant organization credits manually with `Idempotency-Key` (requires admin/MFA in production, same-origin, byte-limited JSON, fail-closed limiter)
- `GET /api/admin/users/:id/billing` — inspect sanitized member credit state (requires admin/MFA in production, fail-closed limiter)
- `POST /api/admin/users/:id/credits/grant` — grant member credits manually with `Idempotency-Key` (requires admin/MFA in production, same-origin, byte-limited JSON, fail-closed limiter)
- `GET /api/admin/billing/events` — list sanitized billing-provider event metadata (requires admin/MFA in production, fail-closed limiter)
- `GET /api/admin/billing/events/:id` — inspect one sanitized billing-provider event and deferred dry-run action summaries (requires admin/MFA in production, fail-closed limiter)
- `GET /api/admin/avatars/latest` — latest avatar uploads
- `GET /api/admin/avatars/:userId` — serve a user's avatar
- `GET /api/admin/activity?limit=&cursor=&search=` — signed-cursor-paginated audit log with hot-window action counts and indexed prefix search over normalized action/email/entity fields
- `GET /api/admin/user-activity?limit=&cursor=&search=` — signed-cursor-paginated user activity log with indexed prefix search over normalized action/email/entity fields
- `GET /api/admin/data-lifecycle/requests` — list admin-created data export/deletion/anonymization requests (requires admin)
- `POST /api/admin/data-lifecycle/requests` — create a data lifecycle request with `Idempotency-Key` (requires admin; planning/archive lifecycle flow)
- `GET /api/admin/data-lifecycle/requests/:id` — inspect sanitized request details and plan items (requires admin)
- `POST /api/admin/data-lifecycle/requests/:id/plan` — build an idempotent export/deletion/anonymization plan without destructive execution (requires admin)
- `POST /api/admin/data-lifecycle/requests/:id/approve` — approve a planned request; execution remains deferred (requires admin)
- `POST /api/admin/data-lifecycle/requests/:id/generate-export` — generate a bounded private JSON export archive for an approved export request (requires admin and `Idempotency-Key`)
- `GET /api/admin/data-lifecycle/requests/:id/export` — inspect sanitized export archive metadata for a request (requires admin)
- `POST /api/admin/data-lifecycle/requests/:id/execute-safe` — execute only reversible/low-risk lifecycle actions for an approved delete/anonymize request; destructive hard delete remains disabled (requires admin and `Idempotency-Key`)
- `GET /api/admin/data-lifecycle/exports` — list sanitized export archive metadata with signed cursor pagination (requires admin)
- `POST /api/admin/data-lifecycle/exports/cleanup-expired` — run a bounded, prefix-scoped expired export archive cleanup batch (requires admin and `Idempotency-Key`)
- `GET /api/admin/data-lifecycle/exports/:id` — authorized admin download of private export archive JSON (requires admin)
- `GET /api/admin/ai/models` — list AI lab presets and allowlisted models (requires admin)
- `POST /api/admin/ai/test-text` — proxy a text-generation test into `workers/ai` (requires admin)
- `POST /api/admin/ai/test-image` — proxy an image-generation test into `workers/ai` (requires platform admin). Phase 2-M charges selected organization credits only for BFL image tests using Flux 1 schnell or Flux 2 klein 9B; charged calls require `organization_id`, `Idempotency-Key`, sufficient credits, server-side model cost calculation, and preserve no-charge-on-provider-failure behavior.
- `POST /api/admin/ai/test-embeddings` — proxy an embeddings test into `workers/ai` (requires admin)
- `POST /api/admin/ai/test-video` — proxy a synchronous video-generation test into `workers/ai` (requires admin; debug compatibility path; disabled unless `ALLOW_SYNC_VIDEO_DEBUG=true`)
- `POST /api/admin/ai/video-jobs` — create an async admin video-generation job (requires admin)
- `GET /api/admin/ai/video-jobs/:id` — read owner-scoped async admin video job status (requires admin)
- `GET /api/admin/ai/video-jobs/:id/output` — serve owner-scoped completed async video output from `USER_IMAGES` (requires admin)
- `GET /api/admin/ai/video-jobs/:id/poster` — serve owner-scoped completed async video poster from `USER_IMAGES` when present (requires admin)
- `GET /api/admin/ai/video-jobs/poison` — list recent sanitized async-video poison messages for admin/support inspection (requires admin)
- `GET /api/admin/ai/video-jobs/poison/:id` — view one sanitized poison message (requires admin)
- `GET /api/admin/ai/video-jobs/failed` — list sanitized failed async-video job diagnostics (requires admin)
- `GET /api/admin/ai/video-jobs/failed/:id` — view one sanitized failed async-video job diagnostic (requires admin)
- `GET /api/admin/ai/usage-attempts` — list sanitized org-scoped AI usage attempts/reservations for admin inspection (requires admin)
- `GET /api/admin/ai/usage-attempts/:id` — inspect one sanitized org-scoped AI usage attempt/reservation (requires admin)
- `POST /api/admin/ai/usage-attempts/cleanup-expired` — run a bounded dry-run/default cleanup batch for expired/stuck AI usage attempts; execution releases stale reservations and deletes only expired, attempt-linked temporary replay objects under the approved `tmp/ai-generated/` prefix (requires admin, same-origin, `Idempotency-Key`)
- `POST /api/admin/ai/compare` — proxy a multi-model compare request into `workers/ai` (requires admin)
- `GET /api/ai/quota` — member credit balance and daily top-up state for non-admin accounts
- `POST /api/ai/generate-image` — generate an image via Cloudflare AI; member mode charges the signed-in user credit balance using shared image pricing after provider success; optional org-scoped mode requires `organization_id`, `Idempotency-Key`, active member/admin/owner membership, `ai.image.generate`, and priced available credits, then uses `ai_usage_attempts` for retry-safe reservation/finalization and temporary result replay
- `POST /api/ai/generate-text` — generate text through the HMAC-protected AI worker; org-scoped only, requires `organization_id`, `Idempotency-Key`, active member/admin/owner membership, `ai.text.generate`, and one available credit, then uses `ai_usage_attempts` for retry-safe reservation/finalization and bounded text replay metadata
- `GET /api/ai/folders` — list folders (+ counts)
- `POST /api/ai/folders` — create folder
- `DELETE /api/ai/folders/:id` — delete folder and queue blob cleanup
- `GET /api/ai/images` — list saved images
- `POST /api/ai/images/save` — persist a generated image to `USER_IMAGES`
- `GET /api/ai/images/:id/file` — serve saved image bytes
- `DELETE /api/ai/images/:id` — delete saved image and queue blob cleanup
- `PATCH /api/ai/images/bulk-move` — move up to 50 images between folders
- `POST /api/ai/images/bulk-delete` — delete up to 50 images atomically

## Database & Storage

**D1 database** `bitbi-auth-db` with binding `DB` in `wrangler.jsonc`. The contact worker no longer depends on this database for public abuse-sensitive rate limiting; that protection now uses worker-local Durable Objects instead.

**Tables**: `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `admin_audit_log`, `activity_search_index`, `profiles`, `favorites`, `ai_folders`, `ai_images`, `ai_video_jobs`, `ai_generation_log`, `r2_cleanup_queue`, `user_activity_log`, `ai_daily_quota_usage`, `rate_limit_counters`, `data_lifecycle_requests`, `data_lifecycle_request_items`, `data_export_archives`, `organizations`, `organization_memberships`, `plans`, `organization_subscriptions`, `entitlements`, `billing_customers`, `credit_ledger`, `usage_events`, `member_credit_ledger`, `member_usage_events`, `ai_usage_attempts`, `billing_provider_events`, `billing_event_actions`, `billing_checkout_sessions`

**R2 bucket** `bitbi-private-media` bound as `PRIVATE_MEDIA` — stores protected images, protected audio, Sound Lab thumbnails, and avatars. Key layout: `images/Little_Monster/little-monster_NN.png` (full), `images/Little_Monster/thumbnails/little-monster_NN.webp` (thumbnails), `audio/sound-lab/{slug}.mp3`, `sound-lab/thumbs/{slug}.webp`, `avatars/{userId}`.

**R2 bucket** `bitbi-user-images` bound as `USER_IMAGES` — stores saved Image Studio renders under `users/{userId}/folders/{folderSlug}/{timestamp}-{random}.png`, temporary generated-image replay/save-reference objects under `tmp/ai-generated/{userId}/{tempId}`, and async admin video job output under `users/{userId}/video-jobs/{jobId}/`. Cleanup may delete expired temporary replay objects only through the approved prefix and attempt-linkage checks; it must not broad-delete `users/` media prefixes.

**R2 bucket** `bitbi-audit-archive` bound as `AUDIT_ARCHIVE` — stores cold admin audit and user activity log archives as private JSONL chunks under deterministic date-partitioned keys. It also stores data export archive JSON under `data-exports/{subjectUserId}/{requestId}/{archiveId}.json`. Phase 1-J cleanup deletes only expired lifecycle export objects under that approved prefix and never broad-deletes audit archives or user media objects. The scheduled auth cleanup keeps only the recent hot window in D1, archives older rows here before pruning them, runs the bounded export-archive cleanup step, and runs a bounded AI usage-attempt cleanup step that releases stale reservations and deletes only expired attempt-linked temporary replay objects after approved-prefix validation.

**Queue** `bitbi-auth-activity-ingest` bound as `ACTIVITY_INGEST_QUEUE` — carries routine `admin_audit_log` and `user_activity_log` events off the hot request path. The auth worker itself consumes the queue and batch-persists those events back into the existing D1 tables with idempotent `INSERT OR IGNORE` writes.

**Queue** `bitbi-ai-video-jobs` bound as `AI_VIDEO_JOBS_QUEUE` — carries async admin video jobs from `/api/admin/ai/video-jobs`. The auth worker consumes the queue, leases `ai_video_jobs` rows, invokes signed internal AI worker task create/poll routes, ingests completed output into `USER_IMAGES`, and records success/failure/retry/poison state in D1. The existing synchronous `/api/admin/ai/test-video` compatibility route is disabled by default and only available for controlled admin/debug rollback when `ALLOW_SYNC_VIDEO_DEBUG=true`.

**Cloudflare AI binding** `AI` — required for `/api/ai/generate-image`.

**Service binding** `AI_LAB` — required for `/api/admin/ai/*` and org-scoped `/api/ai/generate-text` to reach the internal `workers/ai` service.

**Secret** `AI_SERVICE_AUTH_SECRET` — required for HMAC signing of auth-worker requests to `workers/ai`. This value must exactly match the `AI_SERVICE_AUTH_SECRET` provisioned on `workers/ai`; do not deploy Phase 0-A to production until both Worker environments have the matching secret. Missing or short values fail closed and block internal AI access.

**Secret** `BILLING_WEBHOOK_TEST_SECRET` — optional Phase 2-I synthetic billing webhook verification secret for `POST /api/billing/webhooks/test`. If missing or too short, the route fails closed. This is not a live provider secret and does not enable production payment processing.

**Stripe Testmode config** — optional Phase 2-J/2-K config for credit-pack checkout. `STRIPE_MODE` must be `test`; `STRIPE_SECRET_KEY` must be a Testmode key; `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` must be HTTPS for checkout creation; and `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` must be exactly `true` or checkout creation fails closed before any Stripe API call. `STRIPE_WEBHOOK_SECRET` is required only for `POST /api/billing/webhooks/stripe` verification and is not required to create Checkout Sessions. The current product-facing Testmode catalog exposes `credits_5000` and `credits_10000`; older small placeholder packs are not exposed by the pricing rollout. Missing config makes Stripe routes fail closed with safe variable-name diagnostics and does not affect unrelated routes. Live-mode Stripe keys/events are rejected in this phase. Verified webhook credit grants require a persisted checkout session created by an active platform admin; Stripe metadata alone is not trusted for admin authorization.

**Stripe live credit-pack config** — optional Phase 2-L/2-M config for narrow live one-time credit packs. `ENABLE_LIVE_STRIPE_CREDIT_PACKS` must be exactly `true` or live checkout creation fails closed before any Stripe API call. `STRIPE_LIVE_SECRET_KEY` must be present and look live-like (`sk_live_...`) for checkout creation; `sk_test_...` is rejected. `STRIPE_LIVE_CHECKOUT_SUCCESS_URL` and `STRIPE_LIVE_CHECKOUT_CANCEL_URL` must be configured for checkout creation. `STRIPE_LIVE_WEBHOOK_SECRET` is required only for `POST /api/billing/webhooks/stripe/live`. The fixed live catalog is `live_credits_5000` (5,000 credits, 9.99 EUR) and `live_credits_12000` (12,000 credits, 19.99 EUR). `live_credits_10000` is not offered for new live checkout; legacy persisted sessions can only be validated against their stored server-side row. Live checkout is limited to platform admins and active organization owners; organization admins, members, viewers, normal users, and unauthenticated users are denied. This does not implement public pricing, subscriptions, invoices, customer portal, Stripe Tax, coupons, Connect, or refund/chargeback automation.

**Admin AI image-test credit pricing** — Phase 2-M charges only platform-admin Admin AI image tests for `@cf/black-forest-labs/flux-1-schnell`, `@cf/black-forest-labs/flux-2-klein-9b`, and proxied `black-forest-labs/flux-2-klein-9b`. The server computes cost in `workers/auth/src/lib/admin-ai-image-credit-pricing.js`; the frontend label is display-only. Flux 1 schnell default 1024x1024/4 steps charges 1 credit. Flux 2 klein 9B text-only output up to 1MP charges 10 credits. The route requires a selected organization and `Idempotency-Key`; provider failures release reservations/no-charge, successful calls debit `credit_ledger`/`usage_events` with source `admin_ai_image_test`, and raw prompts/provider payloads/secrets are not stored in billing metadata.

**Active organization context** — Phase 2-N adds `/account/organization.html`, `GET /api/orgs/:id/organization-dashboard`, and a frontend convenience localStorage key `bitbi.activeOrganizationId`. That selected organization is shared by `/account/organization.html`, `/account/credits.html`, and platform-admin Admin AI Lab BFL image tests. localStorage is not trusted for authorization; every backend route still enforces platform-admin or active-owner access. If a platform admin is not owner of the selected organization, the Organization page warns that credits belong to the organization, not the platform-admin user. Charged Admin AI image-test responses return safe diagnostics including organization id/name, model id, charged credits, ledger/usage/attempt ids when available, idempotency status, and balance before/after.

Local `workers/auth/.dev.vars` example for Stripe Testmode checkout/webhook testing:

```dotenv
STRIPE_MODE=test
ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true
STRIPE_SECRET_KEY=sk_test_REPLACE_WITH_TESTMODE_KEY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_WITH_TESTMODE_ENDPOINT_SECRET
STRIPE_CHECKOUT_SUCCESS_URL=https://bitbi.ai/pricing.html?checkout=success
STRIPE_CHECKOUT_CANCEL_URL=https://bitbi.ai/pricing.html?checkout=cancel
```

Staging setup commands, using placeholder values only:

```bash
cd workers/auth
printf '%s' 'sk_test_REPLACE_WITH_TESTMODE_KEY' | npx wrangler secret put STRIPE_SECRET_KEY
printf '%s' 'whsec_REPLACE_WITH_TESTMODE_ENDPOINT_SECRET' | npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ENABLE_ADMIN_STRIPE_TEST_CHECKOUT
npx wrangler secret put STRIPE_MODE
npx wrangler secret put STRIPE_CHECKOUT_SUCCESS_URL
npx wrangler secret put STRIPE_CHECKOUT_CANCEL_URL
```

For the four non-secret values above, enter `true`, `test`, `https://bitbi.ai/pricing.html?checkout=success`, and `https://bitbi.ai/pricing.html?checkout=cancel` when prompted, or configure equivalent staging HTTPS URLs. Keep `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` absent/false except during an explicitly approved admin-only Testmode canary window.

Local `workers/auth/.dev.vars` example for the gated live credit-pack canary, using placeholders only:

```dotenv
ENABLE_LIVE_STRIPE_CREDIT_PACKS=false
STRIPE_LIVE_SECRET_KEY=sk_live_REPLACE_WITH_LIVE_KEY
STRIPE_LIVE_WEBHOOK_SECRET=whsec_REPLACE_WITH_LIVE_ENDPOINT_SECRET
STRIPE_LIVE_CHECKOUT_SUCCESS_URL=https://bitbi.ai/account/credits.html?checkout=success
STRIPE_LIVE_CHECKOUT_CANCEL_URL=https://bitbi.ai/account/credits.html?checkout=cancel
```

Keep `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` except during an explicitly approved, bounded operator canary.

Migrations in `migrations/` are numbered sequentially from `0001_init` through `0041_add_member_credit_ledger`.

Key migration-dependent behavior:
- `0010_add_r2_cleanup_queue` — required before auth deploy if AI image/folder deletes and scheduled cleanup retries must work immediately
- `0012_add_user_activity_log` — required before auth deploy if admin user-activity views and durable user activity logging must work immediately
- `0014_add_ai_daily_quota_usage` — legacy quota table retained for compatibility/history; current member image generation uses member credits
- `0015_add_rate_limit_counters` — required before auth deploy if remaining D1-backed limiter paths (for example avatar upload, favorites add, admin actions, AI generation) must work immediately
- `0016_add_ai_text_assets` — required before auth/AI deploy if admin AI text asset persistence must work immediately
- `0017_add_ai_image_derivatives` — required before auth deploy if saved-image derivative tracking must work immediately
- `0018_add_profile_avatar_state` — required before auth deploy if `/api/me` must use cached avatar state instead of per-request R2 probing
- `0020_add_wallet_siwe` — required before auth deploy if wallet SIWE login/link/unlink routes must work immediately
- `0023_add_text_asset_publication` and `0024_add_text_asset_poster` — required before auth deploy if text-asset publication/poster routes must work immediately
- `0025_add_media_favorite_types` — required before auth deploy if favorites must support media item types beyond the original gallery-only contract
- `0026_add_cursor_pagination_support` — required before auth deploy if admin activity/user-activity and cursor-based asset listing must work immediately
- `0027_add_admin_mfa` — required before auth deploy if production admin access must enforce TOTP MFA enrollment/verification and recovery-code state safely
- `0028_add_admin_mfa_failed_attempts` — required before auth deploy if admin MFA verification lockout must fail closed with durable failed-attempt state and reset-on-success semantics
- `0029_add_ai_video_jobs` — required before auth deploy if async admin video job creation/status/queue processing must work immediately
- `0030_harden_ai_video_jobs_phase1b` — required before auth deploy if queue-safe video task polling, R2 output/poster metadata, and video poison-message persistence must work immediately
- `0031_add_activity_search_index` — required before auth deploy if activity ingest writes and admin audit/user-activity indexed search must work immediately
- `0032_add_data_lifecycle_requests` — required before auth deploy if admin data lifecycle export/deletion/anonymization request planning APIs must work immediately
- `0033_harden_data_export_archives` — required before auth deploy if bounded private export archive generation/download APIs must work immediately
- `0034_add_organizations` — required before auth deploy if Phase 2-A organization creation, membership, and admin organization inspection APIs must work immediately
- `0035_add_billing_entitlements` — required before auth deploy if Phase 2-B billing plan, entitlement, credit ledger, usage event, and admin credit-grant APIs must work immediately
- `0036_add_ai_usage_attempts` — required before auth deploy if Phase 2-D org-scoped image-generation retry safety, credit reservations, result replay, Phase 2-E usage-attempt cleanup/admin inspection, Phase 2-F replay object cleanup, and Phase 2-H org-scoped text generation replay must work immediately
- `0037_add_billing_event_ingestion` — required before auth deploy if Phase 2-I synthetic billing webhook ingestion and admin billing-event inspection must work immediately
- `0038_add_stripe_credit_pack_checkout` — required before auth deploy if Phase 2-J Stripe Testmode credit-pack checkout session tracking and verified checkout credit grants must work immediately
- `0039_raise_credit_balance_cap_for_pricing_packs` — required before exposing the admin-only Pricing page credit packs, otherwise 5000/10000-credit Testmode webhook grants can exceed the original Phase 2-B free-plan balance cap and fail closed
- `0040_add_live_stripe_credit_pack_scope` — required before auth deploy if Phase 2-L live credit-pack checkout, Credits dashboard purchase history, authorization-scope revalidation, payment-state tracking, and exactly-once live credit grants must work immediately
- `0041_add_member_credit_ledger` — required before auth deploy if member image credit top-ups, member credit charging, and admin user credit grants must work immediately

## Conventions

- All user-facing error messages are in **English**
- Admin actions are logged to `admin_audit_log` with action type and JSON metadata, now normally via the auth activity-ingest queue with a narrow direct-D1 fallback if queue publish fails
- Admins cannot remove their own admin role, disable their own account, revoke their own sessions, or delete themselves
- Sessions expire after 30 days; `last_seen_at` is updated at most every 10 minutes per session
- Production admin access is centrally MFA-gated: unenrolled admins can only reach `/api/admin/me` plus `/api/admin/mfa/*` bootstrap routes until TOTP setup is enabled, and enrolled admins must present a valid `__Host-bitbi_admin_mfa` proof cookie bound to the primary session before other admin routes are allowed
- Shared fixed-window rate limiting is now split by risk: register/login/forgot-password/resend-verification/request-reverification/verify-email/reset-password validate/reset, wallet SIWE nonce/verify, admin MFA, admin mutations, admin AI proxying, member AI generation, avatar upload, favorites add, and contact submission use worker-local Durable Object counters. The security-sensitive auth/admin/MFA/AI/avatar/favorites paths fail closed if the `PUBLIC_RATE_LIMITER` binding is unavailable. Legacy D1-backed `rate_limit_counters` remains for scheduled cleanup and compatibility paths that have not moved to Durable Objects yet.
- Password reset invalidates ALL unused reset tokens for the user (not just the used one)
- Avatar uploads validated by magic bytes (JPEG/PNG/WebP signatures), not just MIME type
- Profile URL fields (website, youtube_url) require valid `https://` URLs
- Login checks password BEFORE status to prevent account enumeration via distinguishable error messages
- Session queries filter by `users.status = 'active'` — disabled users are immediately de-authenticated
- `verification_method` column tracks how email was verified: `legacy_auto` (migration backfill), `email_verified` (real verification), or NULL (new unverified user)
- Scheduled cleanup: daily cron (03:00 UTC) purges expired sessions/tokens, expired AI quota reservations, expired shared rate-limit counters, retries pending `r2_cleanup_queue` deletes, cleans expired lifecycle export archives under the `data-exports/` prefix, releases expired/stuck AI usage-attempt reservations, deletes only expired attempt-linked temporary replay objects under `tmp/ai-generated/`, and re-enqueues only stale AI-image derivative work that has cooled down enough for recovery
- Queue consumers: `bitbi-ai-image-derivatives` handles derivative generation, `bitbi-auth-activity-ingest` batch-persists queued admin audit / user activity rows into the hot D1 tables, and `bitbi-ai-video-jobs` processes async admin video jobs outside browser request lifecycles
- Admin audit/user activity search uses signed cursors from `PAGINATION_SIGNING_SECRET` and the `activity_search_index` projection. Do not reintroduce raw `meta_json LIKE` search or raw `created_at|id` cursors; run `npm run check:admin-activity-query-shape` after activity endpoint changes.
- Environment secrets: `SESSION_HASH_SECRET`, `PAGINATION_SIGNING_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, `ADMIN_MFA_RECOVERY_HASH_SECRET`, `AI_SAVE_REFERENCE_SIGNING_SECRET`, legacy compatibility `SESSION_SECRET`, `AI_SERVICE_AUTH_SECRET`, optional `BILLING_WEBHOOK_TEST_SECRET`, `RESEND_API_KEY`
- Optional env var: `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` (defaults enabled for the Phase 1-D compatibility window; set to `false` only after legacy session hashes, MFA material/proofs, cursors, and image save references have expired or migrated)
- Optional env var: `PBKDF2_ITERATIONS` (int, default 100000, clamped to 100000 max — Cloudflare Workers runtime limit)
