# Admin Sync Video Debug Retirement Audit

Date: 2026-05-16

Status: Phase 4.13 audit/decision. Production/live billing remains BLOCKED.

## Decision

Phase 4.13 chooses Path A: retire the synchronous Admin Video Debug path from normal provider-cost operations and keep it disabled by default.

`POST /api/admin/ai/test-video` remains registered only as a controlled emergency/debug compatibility route. Normal admin video generation must use the Phase 4.5 async video job path, `POST /api/admin/ai/video-jobs`, because that path has required idempotency, sanitized `platform_admin_lab_budget` job/queue metadata, queue processing checks, and duplicate provider-task suppression.

No budget enforcement was added to the sync route in Phase 4.13 because direct synchronous provider execution is no longer an allowed normal path.

## Current Flow Findings

- Auth route: `POST /api/admin/ai/test-video` in `workers/auth/src/routes/admin-ai.js`.
- Route policy id: `admin.ai.test-video-debug`.
- Authorization: admin-only through the shared admin route handling.
- Production MFA classification: `admin-production-required` in route policy.
- Browser write protection: same-origin JSON write policy.
- Rate limiting: fail-closed `admin-ai-video-ip` limiter when the route is explicitly enabled.
- Default gate: disabled unless `ALLOW_SYNC_VIDEO_DEBUG=true`.
- Disabled behavior: returns a safe 404-style `not_found` response before request body parsing, rate-limit evaluation, queueing, AI Worker calls, provider calls, credit mutation, or billing mutation.
- Enabled emergency compatibility behavior: validates a synchronous video payload, logs a warning, and calls the AI Worker `/internal/ai/test-video` through service-auth with baseline caller-policy metadata.
- Internal route: `/internal/ai/test-video` in `workers/ai/src/routes/video.js`.
- Provider behavior when enabled: one synchronous video generation request through Workers AI and, for Vidu failure compatibility, possible direct Vidu fallback and polling.
- Storage: sync route returns provider response data only; it does not persist output to D1/R2.
- Current idempotency: none on the sync route.
- Current budget behavior: no durable budget metadata, no platform cap, no credit debit, no budget reservation.
- Current caller-policy behavior: baseline metadata only when the emergency route is explicitly enabled; missing policy remains allowed on the internal route for broader compatibility.

## Risk Classification

Provider-cost risk remains high if an operator enables `ALLOW_SYNC_VIDEO_DEBUG=true` because the route can bypass the async video job queue, durable job state, duplicate task-create suppression, and output persistence checks. It can also run synchronously against expensive video providers and expose timeout/response-size risk.

Those risks are acceptable only for emergency debugging because the default runtime state is disabled and the supported admin video path is now async and budget-covered.

## Phase 4.13 Changes

- Classified `admin.video.sync_debug` as `retired_disabled_by_default` evidence rather than a normal provider-cost baseline gap.
- Kept `ALLOW_SYNC_VIDEO_DEBUG` as the emergency compatibility flag.
- Updated route-policy metadata to point operators to `POST /api/admin/ai/video-jobs`.
- Updated `check:ai-cost-policy` and budget evidence reporting so sync video debug is visible as a retired debug path, not as a normal unresolved migration.
- Did not change Admin Async Video Job behavior.
- Did not change member image/music/video behavior.
- Did not call real AI providers, Stripe, Cloudflare, GitHub, or remote migrations.

## Future Reintroduction Requirements

If the sync path is ever retained beyond emergency debugging, it must be treated as a new targeted migration and require:

- `Idempotency-Key` before provider work.
- Durable metadata-only attempt state.
- `platform_admin_lab_budget` budget plan and safe metadata.
- Kill-switch target `ENABLE_ADMIN_AI_SYNC_VIDEO_DEBUG_BUDGET`.
- Caller-policy propagation with a budget-enforced or budget-metadata status.
- Duplicate provider-call suppression.
- Explicit timeout and response-size bounds.
- Tests proving no raw prompts, provider bodies, secrets, cookies, tokens, private keys, Stripe data, or Cloudflare credentials are stored or returned in diagnostics.

Until then, async admin video jobs remain the only supported budgeted admin video path.
