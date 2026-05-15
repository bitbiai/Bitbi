# AI Cost Gateway Roadmap

Date: 2026-05-15

Status: phased implementation plan only. Production/live billing remains BLOCKED.

## Phase 3.2: Gateway Contract And Tests

Status: completed for contract/test foundation only.

Scope:

- Add gateway contract module, operation config types by convention, fingerprint helpers, and state-machine tests.
- Do not migrate runtime routes yet.
- Add fixtures for member, org, admin-unmetered, and platform-budget modes.

Likely files:

- `workers/auth/src/lib/ai-cost-gateway.js`
- `scripts/test-ai-cost-gateway.mjs`
- `scripts/check-ai-cost-policy.mjs`
- docs under `docs/ai-cost-gateway/`

Tests:

- fingerprint stability
- missing idempotency rejection
- same-key mismatch rejection
- reservation state transitions
- provider failure release/no charge
- billing failure terminal state
- secret redaction
- invalid config blocking

Rollback:

- Remove unused gateway module and tests; no route behavior should depend on it.

Deploy units:

- Auth Worker only if module is bundled by imports; otherwise validation-only.

Migration risk:

- None unless the contract needs a new table. Prefer adapting existing `ai_usage_attempts` first.

Non-goals:

- No route migration, no public UI change, no billing/pricing change.

## Phase 3.3: AI Cost Operation Registry Baseline

Status: completed for report-only route metadata baseline only. No live route was migrated.

Scope:

- Add a central AI Cost Operation Registry for every inventoried provider-cost operation.
- Validate each target operation config through the Phase 3.2 gateway normalizer.
- Strengthen `check:ai-cost-policy` to load the registry, summarize current gaps, compare route-policy metadata where practical, and remain report-only by default.
- Do not migrate runtime routes yet.

Likely files:

- `workers/auth/src/lib/ai-cost-gateway.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `scripts/test-ai-cost-operations.mjs`
- docs under `docs/ai-cost-gateway/`

Tests:

- every registry entry normalizes through the gateway contract
- operation ids are unique
- known high-risk operations are present
- route-policy/provider-source baselines are deterministic
- report-only mode passes with current known gaps
- strict mode fails on current known gaps
- no external calls are made

Rollback:

- Remove unused registry/check/test additions. No live route should depend on them.

Deploy units:

- Auth Worker may be classified as impacted because the registry is under `workers/auth/src/lib`, but no route imports it yet.

Migration risk:

- None.

Non-goals:

- No route migration, no public UI change, no billing/pricing change.

## Phase 3.4: Migrate Member Personal Image

Scope:

- Migrate member image generation personal mode to mandatory idempotency and pre-provider reservation, while preserving org-scoped behavior.
- Keep response shape as close as possible.

Likely files:

- `workers/auth/src/routes/ai/images-write.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/lib/ai-usage-policy.js`
- `tests/workers.spec.js`
- frontend idempotency callers if they do not already send keys

Tests:

- missing `Idempotency-Key` fails before provider
- same-key same-body duplicate does not call provider twice
- same-key different-body conflicts
- provider failure releases/no charge
- billing failure does not persist/return uncharged result
- org-scoped image tests still pass

Rollback:

- Restore previous member-image adapter path while leaving gateway module and registry unused.

Deploy units:

- Auth Worker and static/pages if frontend idempotency generation changes.

Migration risk:

- Prefer existing `ai_usage_attempts`. If schema gap is found, stop and propose an additive migration.

Non-goals:

- No music/video migration, no pricing changes.

## Phase 3.5: Migrate Member Music

Scope:

- Require idempotency on `/api/ai/generate-music`.
- Reserve before lyrics/music provider calls.
- Treat optional lyrics generation and cover generation as sub-operations under one parent cost policy.
- Decide whether cover generation is bundled, platform-budgeted, or disabled on repeated failures.

Likely files:

- `workers/auth/src/routes/ai/music-generate.js`
- `workers/auth/src/lib/member-music-cover.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- `tests/workers.spec.js`
- static Sound Lab callers/tests if needed

Tests:

- duplicate key does not run text/music provider twice
- separate lyrics provider failure is no-charge
- music provider failure is no-charge
- cover failure does not affect finalized music billing unless policy says otherwise
- save/billing failure cleanup remains safe

Rollback:

- Revert music adapter to previous post-provider debit behavior; leave gateway module.

Deploy units:

- Auth Worker and static/pages if caller idempotency changes.

Migration risk:

- Possible replay metadata needs additive schema or R2 pointer policy. Prefer existing `ai_usage_attempts` first.

Non-goals:

- No video migration, no public pricing change.

## Phase 3.6: Migrate Member Video

Scope:

- Require idempotency on `/api/ai/generate-video`.
- Reserve before provider execution and remote output ingest.
- Persist replay pointer after successful ingest.
- Decide how to handle provider success plus ingest failure.

Likely files:

- `workers/auth/src/routes/ai/video-generate.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- `tests/workers.spec.js`
- static Generate Lab callers/tests if needed

Tests:

- missing key fails before provider
- same-key duplicate does not call provider twice
- provider failure no charge
- remote output fetch failure no charge but no unbounded retry storm
- billing failure cleanup is safe
- result replay/expired replay behavior

Rollback:

- Revert member-video adapter; do not delete existing saved outputs or ledger rows.

Deploy units:

- Auth Worker and static/pages if caller idempotency changes.

Migration risk:

- Replay/output pointer may need additive metadata. Stop before migration if needed.

Non-goals:

- No admin async video rewrite.

## Phase 3.7: Normalize Admin AI Provider-Cost Behavior

Scope:

- Classify admin routes as charged-org, admin-unmetered, debug-disabled, or platform-budgeted.
- Add idempotency requirements or job rows to high-cost admin routes where appropriate.
- Keep `ALLOW_SYNC_VIDEO_DEBUG` disabled by default.

Likely files:

- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/lib/ai-video-jobs.js`
- `workers/auth/src/app/route-policy.js`
- `workers/ai/src/routes/*`
- `tests/workers.spec.js`
- `tests/auth-admin.spec.js`

Tests:

- admin text/music/compare/live-agent policy metadata exists
- charged admin image behavior unchanged
- admin async video idempotency/job behavior unchanged
- sync debug remains hidden unless flag enabled

Rollback:

- Revert route-policy/adapter metadata only; keep admin access controls.

Deploy units:

- Auth Worker; possibly static/pages if Admin AI UI copy changes.

Migration risk:

- None expected.

Non-goals:

- No public/member changes.

## Phase 3.8: Provider Replay And Result Cache Hardening

Scope:

- Harden replay storage across image/text/music/video.
- Add prefix allowlists, retention, cleanup, admin inspection, and expired replay behavior.
- Verify async video provider task create/poll edge cases.

Likely files:

- `workers/auth/src/lib/ai-usage-attempts.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- R2 temp/replay helpers
- `workers/auth/src/lib/ai-video-jobs.js`
- tests

Tests:

- replay object prefix/user/attempt validation
- expired replay metadata cleanup
- no unrelated R2 deletion
- response-loss duplicate provider task scenario for async video, if locally representable

Rollback:

- Disable replay for affected operation while preserving attempts and ledger rows.

Deploy units:

- Auth Worker.

Migration risk:

- Possible additive metadata columns only if existing `metadata_json` is insufficient.

Non-goals:

- No destructive cleanup expansion.

## Phase 3.9: Cost Telemetry And Admin Cost Dashboard

Scope:

- Add safe AI cost telemetry for member/org/admin/platform operations.
- Add admin read-only cost summaries.
- Include News Pulse and generated music covers as platform/internal budget items.

Likely files:

- `workers/auth/src/lib/ai-cost-gateway.js`
- admin read-only routes
- Admin Control Plane UI
- docs/runbooks
- tests

Tests:

- no secrets/raw prompts in telemetry output
- per-route/model/provider cost summaries
- read-only admin endpoint auth/MFA/rate-limit policy
- static UI safe empty/error states

Rollback:

- Hide dashboard/read endpoint; telemetry rows remain historical evidence.

Deploy units:

- Auth Worker and static/pages if UI is added.

Migration risk:

- Likely additive table or use existing attempts/usage metadata. Add only forward migrations.

Non-goals:

- No automated provider budget shutdown until separately approved.

## Phase 3.10: Policy Enforcement Guard

Scope:

- Turn `check:ai-cost-policy` from report-only into an enforcement guard for new provider-cost routes.
- Require inventory metadata and gateway operation config for every new provider-call path.

Likely files:

- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `workers/auth/src/app/route-policy.js`
- release preflight plan

Tests:

- fixture route with provider call but missing gateway metadata fails
- fixture route with optional idempotency fails when marked member-cost-bearing
- historical/admin-unmetered exceptions are explicit

Rollback:

- Return guard to report-only while preserving docs.

Deploy units:

- Validation-only.

Migration risk:

- None.

Non-goals:

- No runtime behavior changes.
