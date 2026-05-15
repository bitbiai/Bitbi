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
- historical Phase 3.5 report-only output kept member music marked unmigrated before the Phase 3.6 migration
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

Status: completed for the member music route only. Phase 3.6 adds mandatory idempotency, one parent member-credit reservation, duplicate provider-call suppression, exactly-once debit after audio persistence, safe no-charge failure handling, and an explicit bundled cover-generation budget policy. It adds no migration and does not deploy.

Scope:

- Require idempotency on `/api/ai/generate-music`.
- Reserve the full parent music cost before optional lyrics or required audio provider calls.
- Treat optional lyrics generation, audio generation, and scheduled cover generation as sub-operations under one parent cost policy.
- Use the conservative cover policy: cover generation is included in the parent bundled music reservation with no separate visible charge.
- Preserve the current bundled credit schedule.

Likely files:

- `workers/auth/src/routes/ai/music-generate.js`
- `workers/auth/src/lib/ai-usage-policy.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/lib/member-ai-usage-attempts.js`
- `tests/workers.spec.js`
- `tests/helpers/auth-worker-harness.js`
- AI Cost Gateway docs and current-state docs

Why music is more complex than member image:

- One user request can run a separate lyrics text provider call and a MiniMax audio provider call before final debit.
- Audio provider success is followed by local R2/D1 save and then billing finalization, so storage/billing failures must not return unpaid output.
- Background cover generation runs after music success and is included in the parent bundle for now, but cover final-status writeback remains partial.
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
- attempt metadata does not contain raw prompts, raw lyrics, secrets, cookies, or unsafe R2 keys

Rollback:

- Revert the music adapter to previous post-provider debit behavior if needed. Leave gateway modules and additive tables intact. Do not delete saved music assets, member attempt rows, or credit ledger rows during rollback.

Deploy units:

- Auth Worker. Static/pages are not required by Phase 3.6 because existing callers already send an idempotency key in tested paths.

Migration risk:

- Existing `member_ai_usage_attempts` from migration `0048` is reused. No new schema was added. Operators must still apply/verify migration `0048` before deploying auth Worker code that depends on member attempts.

Non-goals:

- No video migration, no admin/platform/internal AI migration, no public pricing change, no automatic cover retry storm, no Stripe work.

## Phase 3.7: Replay/Result Cache Hardening Before Member Video

Status: completed for already migrated member image/music flows only. Phase 3.7 adds replay-unavailable handling, safe result metadata, music cover status writeback, terminal finalization behavior, and scheduled cleanup for `member_ai_usage_attempts`. It adds no migration and does not deploy.

Scope:

- Harden member image/music replay metadata and result availability semantics.
- Return safe replay-unavailable responses for completed attempts whose result metadata/object is missing or expired.
- Avoid automatic provider re-execution and double debit for completed same-key replay-unavailable attempts.
- Keep generated lyrics intentionally absent from attempt metadata and replay responses.
- Add cover final-status writeback with `pending`, `succeeded`, `failed`, and `skipped`.
- Add scheduled cleanup/expiry behavior for expired/stuck `member_ai_usage_attempts`.
- Preserve these invariants while migrating member video.

Likely files:

- `workers/auth/src/lib/member-ai-usage-attempts.js`
- `workers/auth/src/routes/ai/images-write.js`
- `workers/auth/src/routes/ai/music-generate.js`
- `workers/auth/src/lib/member-music-cover.js`
- `tests/workers.spec.js`
- AI Cost Gateway docs/check scripts

Tests:

- expired/replay-unavailable member image/music attempts do not call providers or double debit
- metadata cleanup does not delete saved media, ledger rows, member usage rows, or unrelated R2 objects
- cover status writeback does not expose raw prompts/lyrics/R2 keys
- member image and music gateway behavior remains compatible except that replay responses omit raw prompt/lyrics fields

Rollback:

- Revert replay metadata/writeback changes only. Do not delete attempt rows, saved assets, ledger rows, or R2 media.

Deploy units:

- Auth Worker if route/helper behavior changes; no schema unless a later approved additive migration is required.

Migration risk:

- No schema was added. Existing 0048 fields and bounded `metadata_json` are sufficient for this phase.

Non-goals:

- No admin/platform/internal AI migration, no public pricing change, no Stripe work.

## Phase 3.8: Migrate Member Video

Status: completed for member `/api/ai/generate-video` only. Phase 3.8 uses the existing 0048 `member_ai_usage_attempts` foundation and adds no migration.

Scope:

- Require idempotency on member `/api/ai/generate-video`.
- Reserve one parent member attempt before PixVerse/HappyHorse provider execution and remote output ingest.
- Persist safe durable saved-asset replay metadata after successful ingest and debit.
- Treat provider success plus output fetch/storage failure as terminal no-charge before debit.
- Return replay-unavailable without provider re-execution or double debit when the saved result is missing.

Files touched:

- `workers/auth/src/routes/ai/video-generate.js`
- `workers/auth/src/lib/ai-usage-policy.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/app/route-policy.js`
- `scripts/check-ai-cost-policy.mjs`
- `tests/workers.spec.js`

Tests:

- missing key fails before provider
- same-key duplicate does not call provider twice
- provider failure no charge
- remote output fetch failure no charge but no unbounded retry storm
- billing failure cleanup is safe
- result replay/expired replay behavior
- same-key/different request conflict
- no raw prompt/internal R2 keys in attempt replay metadata

Rollback:

- Revert member-video adapter; do not delete existing saved outputs or ledger rows.

Deploy units:

- Auth Worker. No static/pages change was required in Phase 3.8.

Migration risk:

- No schema was added. Existing 0048 fields and bounded `metadata_json` are sufficient for this phase.

Non-goals:

- No admin async video rewrite, no admin/platform/internal/OpenClaw migration, no public pricing change, no Stripe work.

## Phase 3.9: Enforcement Guard And Known-Gap Baseline

Status: completed for validation/check/tooling/docs only. No runtime route behavior changed.

Scope:

- Add `config/ai-cost-policy-baseline.json` for accepted-for-now admin/platform/background/OpenClaw/internal AI cost gaps.
- Make default `npm run check:ai-cost-policy` fail when a new provider-cost source file appears without registry metadata or baseline coverage.
- Validate duplicate registry ids, duplicate baseline ids, missing baseline file/route references, member gateway regressions, and unbaselined route-policy gaps.
- Keep strict `--strict` behavior deterministic for future use when all baseline gaps are resolved.
- Add the default local guard to release preflight.

Files touched:

- `config/ai-cost-policy-baseline.json`
- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `scripts/lib/release-plan.mjs`
- docs under `docs/ai-cost-gateway/` and current-state docs

Tests:

- baseline loads and validates
- duplicate baseline ids fail
- duplicate registry ids fail
- member image/music/video are not reported as gaps
- member image/music/video regression fixtures fail
- known admin/platform/internal gaps pass in default mode
- unknown provider-cost source fixture fails
- strict mode fails deterministically while baseline gaps remain
- no external provider or secret access

Rollback:

- Revert baseline/check/release-preflight integration. No route behavior, schema, ledger, or provider state depends on Phase 3.9.

Deploy units:

- Validation-only by behavior. No Worker deploy is needed unless unrelated runtime files remain in the working tree.

Migration risk:

- None. No schema was added.

Non-goals:

- No admin AI migration, no platform budget runtime enforcement, no internal AI Worker migration, no public pricing change, no Stripe work.

## Phase 4.1: Admin/Platform AI Budget Policy Design

Status: completed for design, registry metadata, baseline metadata, report output, and deterministic tests only. No runtime admin/platform/internal/OpenClaw route behavior changed.

Scope:

- Convert the Phase 3.9 known-gap baseline into a concrete budget policy model for non-member-credit AI provider spend.
- Define budget scopes: `admin_org_credit_account`, `platform_admin_lab_budget`, `platform_background_budget`, `openclaw_news_pulse_budget`, `internal_ai_worker_caller_enforced`, `explicit_unmetered_admin`, and `external_provider_only`.
- Add budget policy metadata to admin/platform/internal registry entries without marking them runtime-enforced.
- Add `targetBudgetScope` and `temporaryAllowanceReason` to known baseline gaps.
- Group `check:ai-cost-policy` output by admin, platform/background, and internal caller-enforced budget scope.

Files:

- `docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md`
- `workers/auth/src/lib/ai-cost-operations.js`
- `config/ai-cost-policy-baseline.json`
- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `scripts/test-ai-cost-operations.mjs`
- AI Cost Gateway docs and current-state docs

Tests:

- budget scope taxonomy exists
- admin/platform/internal operations have target budget scopes
- baseline items have target future phase and temporary allowance reason
- member image/music/video are not baseline gaps
- admin/OpenClaw/internal gaps remain explicit baseline gaps
- default check passes with the baseline
- strict mode fails while baseline gaps remain
- no external provider or secret access

Rollback:

- Revert design docs, registry budget metadata, baseline budget fields, and report/test output. No route behavior, schema, ledger, provider state, or saved result depends on Phase 4.1.

Deploy units:

- Validation-only by behavior. The release classifier may mark auth Worker impacted because registry metadata lives under `workers/auth/src/lib`, but no runtime admin/platform route imports new behavior.

Migration risk:

- None. No schema is added.

Non-goals:

- No runtime budget enforcement, admin route migration, internal AI Worker route change, Admin UI, pricing change, provider call, Stripe work, or production/live billing readiness claim.

## Phase 4.2: Admin/Platform Budget Policy Contract Helpers

Status: completed for pure helper, baseline validation, preflight, and deterministic tests only. No runtime admin/platform/internal/OpenClaw route behavior changed.

Scope:

- Add pure budget policy helper functions and tests for admin/platform operations without migrating live routes.
- Normalize budget operation configs, budget owners, kill-switch metadata, explicit unmetered justification, and safe observability/audit metadata.
- Define deterministic fingerprints for admin lab, streaming, fan-out, background, and internal caller-enforced operation types.
- Classify future budget plan statuses such as `platform_budget_review`, `admin_org_credit_required`, `caller_enforced`, `explicit_unmetered`, `requires_kill_switch`, and `invalid_config`.
- Keep `ALLOW_SYNC_VIDEO_DEBUG` disabled by default.

Likely files:

- `workers/auth/src/lib/admin-platform-budget-policy.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `scripts/test-admin-platform-budget-policy.mjs`
- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `scripts/lib/release-plan.mjs`
- docs under `docs/ai-cost-gateway/`

Tests:

- valid admin/platform budget configs normalize
- explicit unmetered admin exceptions require reason/owner/kill switch
- budget scopes reject missing owner/kill-switch metadata
- internal caller-enforced and external-provider-only exemptions must be explicit
- deterministic fingerprints are stable
- audit fields omit secrets, prompts, cookies, auth headers, Stripe data, Cloudflare tokens, and private keys
- default AI cost policy baseline requires kill-switch target or exemption plus future enforcement path
- no providers, Stripe, Cloudflare APIs, D1, R2, or network calls

Rollback:

- Remove unused helper functions/tests, package script, preflight check, and baseline validation fields. No runtime route should depend on Phase 4.2 until a later narrow migration imports it.

Deploy units:

- Auth Worker may be classified as impacted if helper files live under `workers/auth/src/lib`; behavior is validation-only until imported by runtime routes.

Migration risk:

- None expected. Do not add schema in this contract phase.

Non-goals:

- No admin AI runtime migration, no admin video job migration, no OpenClaw/News Pulse migration, no internal route enforcement, no Admin UI.

## Phase 4.3: Admin BFL Image Test Budget Enforcement Hardening

Scope:

- Narrowly harden priced Admin AI BFL image tests that already debit selected organization credits.
- Preserve existing selected-organization credit debit behavior and add explicit `admin_org_credit_account` metadata, budget reason, finalization/replay classification, and operator-safe telemetry.
- Keep unpriced admin image models either disabled or under explicit platform admin lab budget policy.

Likely files:

- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/lib/admin-ai-image-credit-pricing.js`
- `workers/auth/src/lib/ai-usage-attempts.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/app/route-policy.js`
- `tests/workers.spec.js`

Tests:

- priced admin BFL image still requires organization id and `Idempotency-Key`
- insufficient org credits fail before provider call
- provider failure does not debit credits
- same-key duplicate does not double debit
- unpriced branch cannot silently bypass budget metadata
- no Stripe, public pricing, or member route behavior changes

Rollback:

- Feature-disable/hide the priced admin BFL test branch or revert the route adapter while preserving historical `ai_usage_attempts` and ledger rows.

Deploy units:

- Auth Worker.

Migration risk:

- None expected if existing `ai_usage_attempts` metadata is sufficient; add only nullable metadata if evidence proves otherwise.

Non-goals:

- No broad Admin AI Lab migration, no admin video jobs, no public billing/pricing changes.

## Phase 4.4: Admin Async Video Job Budget Enforcement

Scope:

- Add platform admin lab budget reservation/telemetry to admin async video job create and queue processing.
- Tie internal video-task create/poll calls to a parent admin video job budget state.
- Address response-loss and duplicate queue delivery around provider task creation without changing member video behavior.

Likely files:

- `workers/auth/src/lib/ai-video-jobs.js`
- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/lib/ai-cost-operations.js`
- `workers/auth/src/app/route-policy.js`
- `workers/ai/src/routes/video-task.js` only if caller-policy metadata must be passed through
- Worker tests

Tests:

- job creation budget denied before provider task creation
- duplicate job idempotency does not create duplicate provider tasks
- queue retry after task create response loss is safe
- poll only uses persisted provider task id
- no member video/image/music regression
- no real provider calls in tests

Rollback:

- Disable admin async video job creation or revert budget adapter while keeping existing job rows/provider task ids for operator review.

Deploy units:

- Auth Worker. AI Worker only if service-route caller metadata contract changes.

Migration risk:

- Possible additive job/budget metadata if existing job table cannot represent reservation/finalization safely.

Non-goals:

- No member video migration, no live provider testing, no public UI, no Stripe work.

## Phase 4.5: OpenClaw/News Pulse Visual Budget Controls

Scope:

- Add `openclaw_news_pulse_budget` controls around ingest-triggered and scheduled visual generation.
- Use deterministic item/job budget keys, batch/window caps, attempt caps, and a visual-generation kill switch.
- Preserve current public News Pulse read behavior and existing visual status rows.

Likely files:

- `workers/auth/src/lib/news-pulse-visuals.js`
- `workers/auth/src/routes/openclaw-news-pulse.js`
- `workers/auth/src/index.js` scheduled handler
- `workers/auth/src/lib/ai-cost-operations.js`
- route-policy/check docs and Worker tests

Tests:

- cap/kill-switch blocks provider before execution
- item-level status suppresses duplicate visual work
- scheduled batch respects budget window
- ready thumbnail prevents regeneration
- failed rows retry only within attempt/budget caps
- no member/org/admin credit mutation

Rollback:

- Disable visual generation/backfill while keeping existing ready thumbnails and News Pulse cache rows.

Deploy units:

- Auth Worker.

Migration risk:

- Possible additive budget/status metadata only if existing News Pulse visual columns are insufficient.

Non-goals:

- No public News Pulse UI redesign, no member billing, no OpenClaw ingest auth changes.

## Phase 4.6: Internal AI Worker Caller-Policy Guard

Scope:

- Keep internal AI Worker routes service-only but require caller-supplied operation/budget metadata or a signed caller policy before provider execution.
- Reject unknown/internal callers and prevent new service routes from bypassing registry/baseline classification.
- Preserve member image/music/video callers and admin callers during migration.

Likely files:

- `workers/ai/src/index.js`
- `workers/ai/src/routes/text.js`
- `workers/ai/src/routes/image.js`
- `workers/ai/src/routes/music.js`
- `workers/ai/src/routes/video.js`
- `workers/ai/src/routes/video-task.js`
- `workers/ai/src/routes/compare.js`
- `workers/ai/src/routes/live-agent.js`
- Auth Worker proxy/caller metadata helpers
- Worker tests and `check:ai-cost-policy`

Tests:

- service auth still required
- missing caller-policy metadata rejects before provider execution where enabled
- migrated member callers pass required operation metadata
- admin callers pass only after their budget phase is ready or remain explicitly baselined
- no public exposure, no secret logging, no real provider calls

Rollback:

- Disable caller-policy enforcement flag while preserving service-auth requirements and route-policy baseline checks.

Deploy units:

- AI Worker and Auth Worker if caller metadata is passed from Auth.

Migration risk:

- None expected unless durable internal call audit is added later.

Non-goals:

- No public route exposure, no member billing changes, no admin budget dashboard.

## Phase 4.7: Admin/Platform Budget Observability Dashboard

Scope:

- Add read-only admin/platform AI budget summaries after telemetry from earlier phases is reliable.
- Show budget scope, operation id, actor/admin, provider/model, daily/monthly spend estimates, kill-switch state, and unresolved budget warnings.
- Keep it observational; remediation and provider actions remain manual/future work.

Likely files:

- admin read-only routes
- `workers/auth/src/lib/ai-cost-gateway.js` or budget telemetry helpers
- Admin Control Plane static UI
- `css/admin/admin.css`
- `tests/auth-admin.spec.js`
- `tests/workers.spec.js`

Tests:

- admin/MFA/rate-limit policy for read endpoint
- sanitized output with no raw prompts, secrets, auth headers, provider payloads, Stripe data, or internal R2 keys
- empty/error/loading states in Admin Control Plane
- no remediation/Stripe/provider action buttons

Rollback:

- Hide the dashboard/read endpoint. Telemetry rows remain historical evidence.

Deploy units:

- Auth Worker and static/pages if UI is added.

Migration risk:

- Possible additive telemetry table only after the contract/helper phases prove existing metadata is insufficient.

Non-goals:

- No automated shutdown/remediation, no live billing readiness claim, no pricing changes.

## Historical Superseded Item: Policy Enforcement Guard

Status: superseded by completed Phase 3.9. Keep this section only as historical roadmap context.

Original scope:

- Turn `check:ai-cost-policy` from report-only into an enforcement guard for new provider-cost routes.
- Require inventory metadata and gateway operation config for every new provider-call path.

Current state:

- Phase 3.9 has implemented the local default guard with `config/ai-cost-policy-baseline.json`.
- Current default behavior passes only when known admin/platform/internal/OpenClaw gaps match the baseline.
- New provider-cost sources, member image/music/video regressions, duplicate registry/baseline ids, and missing baseline references fail local validation.
- Strict mode remains available for future use when accepted baseline gaps are removed.

Likely files:

- `scripts/check-ai-cost-policy.mjs`
- `scripts/test-ai-cost-policy.mjs`
- `workers/auth/src/app/route-policy.js`
- release preflight plan

Historical tests:

- fixture route with provider call but missing gateway metadata fails
- fixture route with optional idempotency fails when marked member-cost-bearing
- historical/admin-unmetered exceptions are explicit

Rollback:

- Revert Phase 3.9 baseline/check/preflight integration. Do not return to silent provider-cost drift.

Deploy units:

- Validation-only.

Migration risk:

- None.

Non-goals:

- No runtime behavior changes.
