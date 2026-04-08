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

No test framework is configured.

Apply remote D1 migrations before deploying auth-worker code that depends on new tables. The contact worker also depends on `0015_add_rate_limit_counters.sql` because it shares the same D1 database for durable abuse counters.

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
│   ├── rate-limit.js     ← in-memory + shared D1 rate limiting helpers
│   ├── email.js          ← sendVerificationEmail, sendResetEmail, createAndSendVerificationToken
│   ├── activity.js       ← fire-and-forget user activity logging
│   └── constants.js      ← VALID_MONSTER_IDS
└── routes/
    ├── health.js         ← GET /api/health
    ├── auth.js           ← GET /api/me, POST /api/register, /login, /logout
    ├── password.js       ← POST /api/forgot-password, GET /api/reset-password/validate, POST /api/reset-password
    ├── verification.js   ← GET /api/verify-email, POST /api/resend-verification
    ├── admin.js          ← all /api/admin/* (single dispatcher)
    ├── profile.js        ← GET/PATCH /api/profile
    ├── avatar.js         ← GET/POST/DELETE /api/profile/avatar
    ├── favorites.js      ← GET/POST/DELETE /api/favorites
    ├── ai.js             ← /api/ai/* image studio + quota + cleanup handoff
    └── media.js          ← GET /api/thumbnails/*, /api/images/*, /api/music/*, /api/soundlab-thumbs/*
```

**Handler signature**: All route handlers receive a context object `{ request, env, url, pathname, method, isSecure }` built once in index.js. Exceptions: `handleHealth()` takes no args; `handleAdmin(ctx)` and `handleMedia(ctx)` do internal sub-routing and return `null` for unmatched paths.

**Route matching**: Manual `pathname + method` checks in index.js dispatch to route modules. Admin endpoints use `pathname.startsWith()`/`endsWith()` with path splitting to extract `:id` parameters inside `admin.js`.

**Auth flow**: PBKDF2-SHA256 password hashing (100k iterations — Cloudflare Workers runtime cap). Transparent rehash-on-login if stored iterations are below the target. Sessions use a random 32-byte hex token stored in a `bitbi_session` HttpOnly cookie. Only the SHA-256 hash of `token:SESSION_SECRET` is stored in D1. Origin validation blocks cross-origin state-changing requests.

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

**D1 database** `bitbi-auth-db` with binding `DB` in `wrangler.jsonc`. The contact worker also binds this same database for shared durable contact rate limiting.

**Tables**: `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `admin_audit_log`, `profiles`, `favorites`, `ai_folders`, `ai_images`, `ai_generation_log`, `r2_cleanup_queue`, `user_activity_log`, `ai_daily_quota_usage`, `rate_limit_counters`

**R2 bucket** `bitbi-private-media` bound as `PRIVATE_MEDIA` — stores protected images, protected audio, Sound Lab thumbnails, and avatars. Key layout: `images/Little_Monster/little-monster_NN.png` (full), `images/Little_Monster/thumbnails/little-monster_NN.webp` (thumbnails), `audio/sound-lab/{slug}.mp3`, `sound-lab/thumbs/{slug}.webp`, `avatars/{userId}`.

**R2 bucket** `bitbi-user-images` bound as `USER_IMAGES` — stores saved Image Studio renders under `users/{userId}/folders/{folderSlug}/{timestamp}-{random}.png`.

**Cloudflare AI binding** `AI` — required for `/api/ai/generate-image`.

Migrations in `migrations/` are numbered sequentially from `0001_init` through `0015_add_rate_limit_counters`.

Key migration-dependent behavior:
- `0010_add_r2_cleanup_queue` — required before auth deploy if AI image/folder deletes and scheduled cleanup retries must work immediately
- `0012_add_user_activity_log` — required before auth deploy if admin user-activity views and durable user activity logging must work immediately
- `0014_add_ai_daily_quota_usage` — required before auth deploy if `/api/ai/quota` and non-admin daily quota enforcement must work immediately
- `0015_add_rate_limit_counters` — required before auth/contact deploy if shared durable rate limiting must work immediately

## Conventions

- All user-facing error messages are in **English**
- Admin actions are logged to `admin_audit_log` with action type and JSON metadata
- Admins cannot remove their own admin role, disable their own account, revoke their own sessions, or delete themselves
- Sessions expire after 30 days; `last_seen_at` is updated at most every 5 minutes per session
- Shared durable fixed-window rate limiting via `rate_limit_counters` covers register/login/forgot-password/resend-verification/request-reverification/admin actions/AI generation, with in-memory fallback if `DB` or the table is unavailable
- In-memory-only limits remain on verify-email, reset-password validate/reset, avatar-upload, and favorites add
- Password reset invalidates ALL unused reset tokens for the user (not just the used one)
- Avatar uploads validated by magic bytes (JPEG/PNG/WebP signatures), not just MIME type
- Profile URL fields (website, youtube_url) require valid `https://` URLs
- Login checks password BEFORE status to prevent account enumeration via distinguishable error messages
- Session queries filter by `users.status = 'active'` — disabled users are immediately de-authenticated
- `verification_method` column tracks how email was verified: `legacy_auto` (migration backfill), `email_verified` (real verification), or NULL (new unverified user)
- Scheduled cleanup: daily cron (03:00 UTC) purges expired sessions/tokens, expired AI quota reservations, expired shared rate-limit counters, and retries pending `r2_cleanup_queue` deletes
- Environment secrets: `SESSION_SECRET`, `RESEND_API_KEY`
- Optional env var: `PBKDF2_ITERATIONS` (int, default 100000, clamped to 100000 max — Cloudflare Workers runtime limit)
