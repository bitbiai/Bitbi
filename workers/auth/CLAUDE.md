# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Cloudflare Worker providing auth API for bitbi.ai. Single-file worker (`src/index.js`, ~1300 lines) using Cloudflare D1 (SQLite) for persistence, R2 for protected media, and cookie-based sessions. No framework — pure request/response handling with manual route matching.

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

## Architecture

**Single entry point**: `src/index.js` exports a `fetch` handler. All routes, helpers, and business logic live in this one file.

**Route matching**: Manual `pathname + method` checks in the fetch handler — no router library. Admin endpoints use `pathname.startsWith()`/`endsWith()` with path splitting to extract `:id` parameters.

**Auth flow**: PBKDF2-SHA256 password hashing (100k iterations). Sessions use a random 32-byte hex token stored in a `bitbi_session` HttpOnly cookie. Only the SHA-256 hash of `token:SESSION_SECRET` is stored in D1.

**Password reset**: Token-based flow via Resend API email. Raw token sent in email link, only hash stored in DB. Tokens expire after 60 minutes, single-use.

**Email verification**: Token-based flow via Resend API. Verification email sent on registration. Tokens expire after 24 hours (configured via `addDaysIso`). Users can resend verification emails.

**Protected media**: R2 bucket (`PRIVATE_MEDIA`) serves images and music only to authenticated users. Media routes return the R2 object with appropriate content-type headers.

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
- `GET /api/images/little-monster` — protected image from R2 (requires auth)
- `GET /api/music/exclusive-track-01` — protected music from R2 (requires auth)
- `GET /api/admin/me` — admin identity check
- `GET /api/admin/users?search=` — list/search users
- `PATCH /api/admin/users/:id/role` — change role (user/admin)
- `PATCH /api/admin/users/:id/status` — change status (active/disabled)
- `POST /api/admin/users/:id/revoke-sessions` — revoke all sessions
- `DELETE /api/admin/users/:id` — delete user

## Database & Storage

**D1 database** `bitbi-auth-db` with two bindings in `wrangler.jsonc`:
- `DB` — primary binding (local preview in dev)
- `bitbi_auth_db` — remote-only binding for direct production queries

**Tables**: `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `admin_audit_log`

**R2 bucket** `bitbi-private-media` bound as `PRIVATE_MEDIA` — stores protected images and audio files.

Migrations in `migrations/` — numbered sequentially. Note: there are two `0002_*` migrations (admin role and password reset tokens) that were applied separately.

## Conventions

- All user-facing error messages are in **German**
- Admin actions are logged to `admin_audit_log` with action type and JSON metadata
- Admins cannot remove their own admin role, disable their own account, revoke their own sessions, or delete themselves
- Sessions expire after 30 days; `last_seen_at` is updated on each authenticated request
- Environment secrets: `SESSION_SECRET`, `RESEND_API_KEY`
