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

**Auth flow**: PBKDF2-SHA256 password hashing (100k iterations — Cloudflare Workers runtime cap). Transparent rehash-on-login if stored iterations are below the target. Sessions use a random 32-byte hex token stored in an HttpOnly cookie (`__Host-bitbi_session` on secure HTTPS responses, with legacy `bitbi_session` still accepted for compatibility and local non-HTTPS dev). Only the SHA-256 hash of `token:SESSION_SECRET` is stored in D1. Origin validation blocks cross-origin state-changing requests.

**Password reset**: Token-based flow via Resend API email. Raw token sent in email link, only hash stored in DB. Tokens expire after 60 minutes, single-use.

**Email verification**: Token-based flow via Resend API. Verification email sent on registration. Tokens expire after 60 minutes (configured via `addMinutesIso(60)`). Users can resend verification emails. Login is blocked until email is verified (`EMAIL_NOT_VERIFIED` error code).

**Protected media**: R2 bucket (`PRIVATE_MEDIA`) serves images and music only to authenticated users. Media routes return the R2 object with appropriate content-type headers.

**AI Image Studio**: `/api/ai/*` uses the `AI` binding for generation, stores saved image blobs in `USER_IMAGES`, stores folder/image/quota metadata in D1, and uses `r2_cleanup_queue` plus the scheduled handler for durable cleanup retries after deletes.

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
- `GET /api/profile` — user profile data (requires auth)
- `PATCH /api/profile` — update profile fields (requires auth)
- `GET /api/profile/avatar` — user's avatar image from R2, or 404 (requires auth)
- `POST /api/profile/avatar` — upload avatar via FormData (requires auth, rate-limited 10/hr)
- `DELETE /api/profile/avatar` — delete avatar from R2 (requires auth)
- `GET /api/favorites` — list saved favorites (requires auth)
- `POST /api/favorites` — save a favorite item (requires auth)
- `DELETE /api/favorites` — remove a favorite item (requires auth)
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
- `GET /api/admin/avatars/latest` — latest avatar uploads
- `GET /api/admin/avatars/:userId` — serve a user's avatar
- `GET /api/admin/activity?limit=&cursor=` — cursor-paginated audit log with action counts
- `GET /api/admin/user-activity?limit=&cursor=&search=` — cursor-paginated user activity log
- `GET /api/admin/ai/models` — list AI lab presets and allowlisted models (requires admin)
- `POST /api/admin/ai/test-text` — proxy a text-generation test into `workers/ai` (requires admin)
- `POST /api/admin/ai/test-image` — proxy an image-generation test into `workers/ai` (requires admin)
- `POST /api/admin/ai/test-embeddings` — proxy an embeddings test into `workers/ai` (requires admin)
- `POST /api/admin/ai/compare` — proxy a multi-model compare request into `workers/ai` (requires admin)
- `GET /api/ai/quota` — remaining non-admin daily image quota
- `POST /api/ai/generate-image` — generate an image via Cloudflare AI
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

**Tables**: `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `admin_audit_log`, `profiles`, `favorites`, `ai_folders`, `ai_images`, `ai_generation_log`, `r2_cleanup_queue`, `user_activity_log`, `ai_daily_quota_usage`, `rate_limit_counters`

**R2 bucket** `bitbi-private-media` bound as `PRIVATE_MEDIA` — stores protected images, protected audio, Sound Lab thumbnails, and avatars. Key layout: `images/Little_Monster/little-monster_NN.png` (full), `images/Little_Monster/thumbnails/little-monster_NN.webp` (thumbnails), `audio/sound-lab/{slug}.mp3`, `sound-lab/thumbs/{slug}.webp`, `avatars/{userId}`.

**R2 bucket** `bitbi-user-images` bound as `USER_IMAGES` — stores saved Image Studio renders under `users/{userId}/folders/{folderSlug}/{timestamp}-{random}.png`.

**R2 bucket** `bitbi-audit-archive` bound as `AUDIT_ARCHIVE` — stores cold admin audit and user activity log archives as private JSONL chunks under deterministic date-partitioned keys. The scheduled auth cleanup keeps only the recent hot window in D1 and archives older rows here before pruning them.

**Queue** `bitbi-auth-activity-ingest` bound as `ACTIVITY_INGEST_QUEUE` — carries routine `admin_audit_log` and `user_activity_log` events off the hot request path. The auth worker itself consumes the queue and batch-persists those events back into the existing D1 tables with idempotent `INSERT OR IGNORE` writes.

**Cloudflare AI binding** `AI` — required for `/api/ai/generate-image`.

**Service binding** `AI_LAB` — required for `/api/admin/ai/*` to reach the internal `workers/ai` service.

**Secret** `AI_SERVICE_AUTH_SECRET` — required for HMAC signing of auth-worker requests to `workers/ai`. This value must exactly match the `AI_SERVICE_AUTH_SECRET` provisioned on `workers/ai`; do not deploy Phase 0-A to production until both Worker environments have the matching secret. Missing or short values fail closed and block internal AI access.

Migrations in `migrations/` are numbered sequentially from `0001_init` through `0027_add_admin_mfa`.

Key migration-dependent behavior:
- `0010_add_r2_cleanup_queue` — required before auth deploy if AI image/folder deletes and scheduled cleanup retries must work immediately
- `0012_add_user_activity_log` — required before auth deploy if admin user-activity views and durable user activity logging must work immediately
- `0014_add_ai_daily_quota_usage` — required before auth deploy if `/api/ai/quota` and non-admin daily quota enforcement must work immediately
- `0015_add_rate_limit_counters` — required before auth deploy if remaining D1-backed limiter paths (for example avatar upload, favorites add, admin actions, AI generation) must work immediately
- `0016_add_ai_text_assets` — required before auth/AI deploy if admin AI text asset persistence must work immediately
- `0017_add_ai_image_derivatives` — required before auth deploy if saved-image derivative tracking must work immediately
- `0018_add_profile_avatar_state` — required before auth deploy if `/api/me` must use cached avatar state instead of per-request R2 probing
- `0020_add_wallet_siwe` — required before auth deploy if wallet SIWE login/link/unlink routes must work immediately
- `0023_add_text_asset_publication` and `0024_add_text_asset_poster` — required before auth deploy if text-asset publication/poster routes must work immediately
- `0025_add_media_favorite_types` — required before auth deploy if favorites must support media item types beyond the original gallery-only contract
- `0026_add_cursor_pagination_support` — required before auth deploy if admin activity/user-activity and cursor-based asset listing must work immediately
- `0027_add_admin_mfa` — required before auth deploy if production admin access must enforce TOTP MFA enrollment/verification and recovery-code state safely

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
- Scheduled cleanup: daily cron (03:00 UTC) purges expired sessions/tokens, expired AI quota reservations, expired shared rate-limit counters, retries pending `r2_cleanup_queue` deletes, and re-enqueues only stale AI-image derivative work that has cooled down enough for recovery
- Queue consumers: `bitbi-ai-image-derivatives` handles derivative generation, and `bitbi-auth-activity-ingest` batch-persists queued admin audit / user activity rows into the hot D1 tables
- Environment secrets: `SESSION_SECRET`, `RESEND_API_KEY`
- Optional env var: `PBKDF2_ITERATIONS` (int, default 100000, clamped to 100000 max — Cloudflare Workers runtime limit)
