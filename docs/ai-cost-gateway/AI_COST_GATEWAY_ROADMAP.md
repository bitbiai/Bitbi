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

Status: completed for the pilot route only.

Scope:

- Migrate member image generation personal mode to mandatory idempotency and pre-provider reservation, while preserving org-scoped behavior.
- Keep response shape as close as possible.

Likely files:

- `workers/auth/src/routes/ai/images-write.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/lib/member-ai-usage-attempts.js`
- `workers/auth/migrations/0048_add_member_ai_usage_attempts.sql`
- `workers/auth/src/lib/ai-usage-policy.js`
- `tests/workers.spec.js`
- frontend idempotency callers if they do not already send keys

Tests:

- missing/malformed `Idempotency-Key` fails before provider
- insufficient credits fail before provider
- same-key same-body duplicate does not call provider twice and does not debit twice
- same-key different-body conflicts
- provider failure releases/no charge
- billing failure does not persist/return uncharged result
- org-scoped image and admin legacy image tests still pass

Rollback:

- Restore previous member-image adapter path or feature-disable the member personal image route while leaving the additive `0048` table idle. Do not delete member attempt or ledger rows during rollback.

Deploy units:

- Auth Worker. Static/pages only if frontend idempotency generation changes.

Migration risk:

- Additive migration `0048_add_member_ai_usage_attempts.sql` is required because existing `ai_usage_attempts` is organization-scoped and cannot safely represent member-credit reservations.

Non-goals:

- No music/video migration, no admin AI migration, no platform/background AI migration, no internal AI Worker migration, no org-scoped route migration, no pricing changes.

## Phase 3.4.1: Main-Only Deploy/Evidence Checklist

Status: completed for documentation/checklist scope only.

Scope:

- Add the main-only operator checklist for the Phase 3.4 member personal image pilot.
- Document that remote auth D1 migration `0048_add_member_ai_usage_attempts.sql` must be applied and verified before auth Worker deployment.
- Record expected release-plan impact: auth schema checkpoint `0048` plus auth Worker; no static/pages, AI Worker, or contact Worker impact for Phase 3.4 itself.
- Add evidence template fields for member image gateway smoke checks.

Files:

- `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md`
- `docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md`
- `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`
- `docs/production-readiness/EVIDENCE_TEMPLATE.md`
- `docs/production-readiness/README.md`

Tests:

- Documentation/check tooling validation only. No live provider calls, remote migrations, deploys, or route behavior changes.

Rollback:

- Revert documentation/checklist changes if the owner chooses a different evidence process. Do not delete migration `0048` or member attempt rows as rollback.

Deploy units:

- None from Phase 3.4.1 itself. Phase 3.4 runtime still requires auth schema checkpoint `0048` and auth Worker when an operator releases it.

Non-goals:

- No runtime AI change, no new migration, no provider call, no music/video/admin/platform migration, no credit behavior change.

## Phase 3.5: Member Music Cost Decomposition And Gateway Prep

Status: completed for design, registry, docs, and report-only checks only. No live music route behavior changed.

Scope:

- Decompose member music into parent request, optional lyrics generation, required audio generation, and generated cover/background cover sub-operations.
- Add explicit registry metadata for `member.music.generate`, `member.music.lyrics.generate`, `member.music.audio.generate`, and `member.music.cover.generate`.
- Document current charge model, failure scenarios, partial-success risks, replay needs, and cover budget ambiguity.
- Strengthen report-only `check:ai-cost-policy` output and deterministic tests for music sub-operation gaps.

Files:

- `docs/ai-cost-gateway/MEMBER_MUSIC_COST_DECOMPOSITION.md`
- `docs/ai-cost-gateway/AI_COST_GATEWAY_DESIGN.md`
- `docs/ai-cost-gateway/AI_COST_ROUTE_INVENTORY.md`
- `workers/auth/src/lib/ai-cost-operations.js`
- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `scripts/test-ai-cost-operations.mjs`

Tests:

- registry entry uniqueness and normalizer coverage
- member music parent/lyrics/audio/cover operation presence
- deterministic bundled-vs-sub-operation metadata
- report-only output keeps member music marked unmigrated
- member image remains pilot-covered
- no external provider or secret access

Rollback:

- Revert documentation, registry metadata, and report-only check/test changes. No live route or schema depends on Phase 3.5.

Deploy units:

- Validation-only by behavior. The release classifier may mark auth Worker impacted because the registry file lives under `workers/auth/src/lib`, but no live music route imports new music behavior.

Migration risk:

- None. No schema is added in Phase 3.5.

Non-goals:

- No music route migration, no idempotency requirement change, no reservation, no replay, no credit debit change, no provider call.

## Phase 3.6: Member Music Gateway Migration

Scope:

- Require idempotency on `/api/ai/generate-music`.
- Reserve the full parent music cost before optional lyrics or required audio provider calls.
- Treat optional lyrics generation and audio generation as sub-operations under one parent cost policy.
- Decide whether cover generation is bundled, platform-budgeted, or disabled/retry-limited before claiming cover coverage.
- Preserve the current bundled credit schedule unless product explicitly changes pricing separately.

Likely files:

- `workers/auth/src/routes/ai/music-generate.js`
- `workers/auth/src/lib/member-music-cover.js`
- `workers/auth/src/lib/ai-cost-gateway.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/lib/member-ai-usage-attempts.js`
- `tests/workers.spec.js`
- static Sound Lab callers/tests if needed

Why music is more complex than member image:

- One user request can run a separate lyrics text provider call and a MiniMax audio provider call before final debit.
- Audio provider success is followed by local R2/D1 save and then billing finalization, so storage/billing failures must not return unpaid output.
- Background cover generation currently runs after music success and has an unresolved bundled-vs-platform-budget policy.
- Safe replay may need both asset replay metadata and sub-operation status metadata.

Tests:

- missing/malformed key fails before provider
- duplicate key does not run text/music provider twice
- same key with different request conflicts before provider
- separate lyrics provider failure is no-charge
- music provider failure is no-charge
- audio success plus storage failure is no-charge and does not return unpaid output
- billing failure is terminal and safe
- cover failure does not affect finalized music billing unless policy says otherwise
- save/billing failure cleanup remains safe
- same-key completed retry does not debit twice and does not call providers again when replay is available

Rollback:

- Revert the music adapter to previous post-provider debit behavior. Leave gateway modules and additive tables intact. Do not delete saved music assets, member attempt rows, or credit ledger rows during rollback.

Deploy units:

- Auth Worker and static/pages if caller idempotency changes.

Migration risk:

- Existing `member_ai_usage_attempts` from migration `0048` may be sufficient if it can safely store music operation keys, parent request fingerprints, replay metadata, and terminal billing failure states. Verify before coding. Additive schema should be used only if the table cannot safely represent music parent/sub-operation metadata.

Non-goals:

- No video migration, no admin/platform/internal AI migration, no public pricing change, no automatic cover retry storm, no Stripe work.

## Phase 3.7: Migrate Member Video

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

## Phase 3.8: Normalize Admin AI Provider-Cost Behavior

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

## Phase 3.9: Provider Replay And Result Cache Hardening

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

## Phase 3.10: Cost Telemetry And Admin Cost Dashboard

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

## Phase 3.11: Policy Enforcement Guard

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
