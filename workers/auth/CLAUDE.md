# Auth Worker Current Guide

Date: 2026-07-10

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

Purpose: concise current-state guide for work under `workers/auth`. Historical phase detail is frozen in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and domain evidence docs.

## Current Architecture

- Auth Worker is the primary API/admin/media Worker.
- Entry point: `workers/auth/src/index.js`.
- Routes live under `workers/auth/src/routes/`.
- Shared logic lives under `workers/auth/src/lib/`.
- Auth schema migrations live under `workers/auth/migrations/`.
- Release/deploy contract lives in `config/release-compat.json`.

## Required Bindings And Secrets

Verify bindings/secrets through repo config and operator evidence; do not print secret values.

Current auth Worker resource classes:

- D1 `DB`
- R2 `PRIVATE_MEDIA`, `USER_IMAGES`, `AUDIT_ARCHIVE`
- Cloudflare Images `IMAGES`
- Workers AI `AI`
- service binding `AI_LAB`
- Durable Object `PUBLIC_RATE_LIMITER`
- Queues `ACTIVITY_INGEST_QUEUE`, `AI_IMAGE_DERIVATIVES_QUEUE`, `AI_VIDEO_JOBS_QUEUE`
- auth/session/admin MFA/pagination/AI-save/service-auth/Resend secrets declared in release compatibility

## Current Migration State

Latest auth D1 migration: read `release.schemaCheckpoints.auth.latest` from `config/release-compat.json`.

Current high-impact migration dependencies:

- `0073_add_fable_chat_rolling_memory.sql` for the Standard/Lite conversation setting, immutable inference checkpoint snapshots, and private versioned Qwen rolling-memory checkpoints. Apply it before deploying rolling-memory behavior in `/api/admin/fable-chat/*`.
- `0074_add_fable_web_replay_pruning.sql` for the private monotonic cursor and immutable attempt snapshot used to omit completed historical web-search blocks after five minutes of conversation inactivity. Apply it before deploying the corresponding Auth Worker context projection.
- `0072_add_fable_web_search_effort_limits.sql` for immutable effort-derived Web search maxima and bounded execution counts through ten. Apply it before deploying effort-scaled Web search behavior in `/api/admin/fable-chat/*`.
- `0071_add_fable_chat_web_search.sql` for the server-owned per-conversation Web search switch, immutable tool settings/counts, and bounded persisted citations.
- `0070_add_fable_chat_advanced_inference.sql` for server-owned effort/preset/thinking settings, immutable inference snapshots, estimated token context metadata, and private provider content blocks. Apply it before deploying advanced `/api/admin/fable-chat/*` settings or streaming behavior.
- `0069_add_admin_fable_chat.sql` for private, ownership-scoped platform-admin Fable conversations, messages, and durable idempotent send attempts. Apply it before deploying Auth Worker code that serves `/api/admin/fable-chat/*`.
- `0068_add_canvas_workspaces.sql` for authenticated Canvas projects, graph nodes/edges, and idempotent run records. Apply it before deploying Auth Worker code that serves `/api/account/canvas/*`.

- `0056_add_ai_folder_image_ownership_metadata.sql` for folder/image ownership metadata columns.
- `0057_add_ai_asset_manual_review_state.sql` for manual-review item/event tables.
- `0058_add_legacy_media_reset_actions.sql` for reset action/event tables.
- `0059_add_data_lifecycle_completion_state.sql` for Data Lifecycle final completion, evidence status, retained-category, close/reject, and completion-note metadata.
- `0060_add_app_settings.sql` for the Admin registration availability switch. Missing settings default to registration enabled until the migration is applied.
- `0061_add_homepage_hero_video_slots.sql` for Admin-managed public homepage hero video slots and optimized derivative job metadata. Missing hero-video tables make the public homepage API return an unconfigured state so the existing Memvid fallback can continue.
- `0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql` for signed homepage hero external_ffmpeg processing, private admin hero-source uploads, and Memvid Cloudflare Stream hover-preview metadata/telemetry. The related Worker capability flags default enabled unless explicitly set false; Admin runtime switches in `app_settings` can disable visible behavior, and provider operations still fail closed when secrets/config are absent.
- `0063_add_public_media_comments.sql` for public Mempic, Memvid, and Memtrack comments plus cleanup indexes. Missing comment tables make the public comments API unavailable until the migration is applied.
- `0064_add_public_media_interactions.sql` for public media likes and member follow relationships. Missing interaction tables make live like/follow controls and profile social dashboard reads unavailable until the migration is applied.

Apply remote migrations before deploying Auth Worker code that depends on those columns/tables. Do not run remote migrations without explicit operator approval/evidence.

## Current High-Risk Areas

- Auth/session/cookie logic.
- Admin authorization and MFA-protected routes.
- Private media serving and saved asset ownership checks.
- Billing, credits, Stripe webhooks, and usage finalization.
- AI generation/proxy routes and provider-cost accounting.
- Tenant asset ownership, manual-review, and legacy media reset routes.
- D1 migrations, queue processors, R2 cleanup, and lifecycle/export/delete flows.

Change these conservatively and preserve existing guards.

## Current Tenant Asset State

- Folder/image ownership metadata exists for new personal writes only.
- Legacy rows remain unresolved; tenant isolation is not claimed.
- Manual-review import/read/status/Admin visibility exists and writes review-state rows only.
- Reset dry-run/reporting and reset action tracking/executor endpoints exist, but confirmed reset remains blocked and is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved operator change.
- Current reset dry-run evidence is rejected unsafe because prior live evidence exposed a raw idempotency key, the raw JSON is absent from the checkout, and no sanitized replacement is accepted.

Do not backfill ownership, switch access checks, rewrite source asset rows, mutate ownership metadata, execute confirmed reset, or list/delete live R2 unless a future task explicitly approves that scope.

## Current AI Cost / Budget State

- Member image/music/video paths use AI Cost Gateway protections.
- Selected admin/platform operations have budget classifications, switches, cap foundations, reconciliation, repair, report/export, and archive tooling.
- Other internal/provider-cost scopes may remain future work; check the AI cost registry/tests before making claims.
- Do not call real providers in tests or docs phases.

## Current Deploy Rules

- Static Pages deploy does not deploy Workers.
- Worker deploys are separate.
- Migrations first, then dependent Auth Worker deploy.
- `homepage-ffmpeg-processor` is a separate processor/service deploy unit when `npm run release:plan` reports changes under `services/homepage-ffmpeg-processor/**`.
- Deploy `workers/ai` before Auth only when Auth changes depend on AI Worker service-binding behavior.
- Do not assume dashboard-managed WAF/static header/RUM/alerts exist; call out manual verification.

## Local Validation Commands

```bash
npm run check:js
npm run check:secrets
npm run check:route-policies
npm run test:workers
npm run test:release-compat
npm run validate:release
npm run release:plan
```

For docs-only changes, worker tests may be unnecessary, but release/doc checks should still pass.

## Documentation Hygiene

- Active current docs describe current state, blockers, migration/deploy prerequisites, and next actions.
- Do not append phase-by-phase narratives to active docs.
- Preserve historical detail in frozen archive/changelog/evidence docs.
- Do not claim production readiness, live billing readiness, tenant isolation, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness without evidence.
