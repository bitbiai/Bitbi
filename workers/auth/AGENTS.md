# AGENTS.md

## Scope

These rules apply specifically to `workers/auth` and override broader repo guidance when more specific.

## Core rules

- Preserve the existing `workers/auth` architecture and route organization.
- Reuse existing helpers, response shapes, auth guards, and error-handling patterns.
- Prefer extending the current worker over introducing new workers unless separation clearly reduces risk.

## Security and access

- Do not weaken auth, session, admin, ownership, or private-media protections.
- Never expose private assets publicly to simplify implementation.
- Preserve existing `requireUser`, `requireAdmin`, and ownership-check patterns where they exist.
- Treat private media access and user-owned image access as high-risk areas.

## D1 and migrations

- Follow existing D1 schema and migration naming/style conventions.
- Make schema changes through explicit migrations.
- Prefer safe, additive migrations over destructive changes.
- Keep data migrations and backfill paths resumable and production-safe.

## R2 and media

- Respect current bucket responsibilities, especially `USER_IMAGES` and `PRIVATE_MEDIA`.
- Preserve existing object-key conventions unless a change is required for robustness.
- Prefer deterministic keys for derived assets.
- Keep originals as the source of truth unless the task explicitly changes that.

## Async and queue work

- Any queue/background processing must be idempotent and retry-safe.
- Handle duplicate delivery, stale messages, and partial failure safely.
- Prefer explicit processing state over implicit assumptions.
- Do not create flows that can get stuck permanently without recovery.

## API and compatibility

- Preserve existing API shapes unless all affected callers are updated together.
- Validate input carefully.
- Keep protected endpoints protected.
- Avoid breaking current frontend integrations.

## Verification

- Add or update meaningful tests for changed worker behavior.
- Run relevant worker tests after changes.
- Call out manual Cloudflare binding/dashboard/setup steps explicitly.

## Required report for worker changes

When changing `workers/auth`, end with:
- exact files changed
- migrations added/changed
- wrangler/config changes
- why each file changed
- deploy order
- manual setup still required
- tests run
- known limitations