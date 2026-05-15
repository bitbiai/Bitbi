# AI Cost Gateway Design

Date: 2026-05-15

Status: target design plus Phase 4.2 admin/platform budget policy helper contract. The member gateway module and registry are currently wired into migrated member image, member music, and member video generation. Phase 4.2 adds a pure admin/platform budget-policy helper module for future route migrations, but Admin AI, admin video jobs, platform/background AI, OpenClaw/News Pulse, and internal AI Worker provider routes remain outside runtime budget enforcement.

## Goals

The AI Cost Gateway should give every provider-cost operation the same safety lifecycle while preserving existing route boundaries and the vanilla Cloudflare Worker architecture.

Primary goals:

- prevent duplicate provider spend on same-key retries
- prevent provider execution when entitlement/credit checks fail
- avoid charging on provider failure
- avoid returning paid provider output if billing finalization fails
- expose consistent billing metadata to UI
- record safe, queryable operation state for admins
- keep admin-only experiments explicit and observable
- avoid broad rewrites by using thin route adapters

## Lifecycle

1. Identify operation
   - Route adapter passes a stable operation key, route path, method, provider task type, and model family.
   - Example operation keys: `member.image.generate`, `member.music.generate`, `member.video.generate`, `admin.image.test`, `news_pulse.visual.generate`.

2. Resolve actor and billing scope
   - Actor is anonymous, member, org member, platform admin, or machine actor.
   - Billing scope is member personal balance, organization balance, admin-unmetered, or platform-internal budget.
   - Phase 4.1 adds a target budget-scope taxonomy for non-member-credit flows: `admin_org_credit_account`, `platform_admin_lab_budget`, `platform_background_budget`, `openclaw_news_pulse_budget`, `internal_ai_worker_caller_enforced`, `explicit_unmetered_admin`, and `external_provider_only`.
   - Phase 4.2 adds pure helper validation and plan classification for those scopes; no runtime route imports the helper yet.
   - Platform/admin-unmetered operations still need explicit cost telemetry and a budget exception before runtime migration.

3. Resolve model/provider/cost
   - Gateway calls a model cost resolver before provider execution.
   - Resolver uses shared catalog/pricing modules such as `js/shared/ai-model-pricing.mjs`, `music-2-6-pricing.mjs`, `pixverse-v6-pricing.mjs`, and admin model registry metadata.
   - Unknown or unpriced cost-bearing models must be explicit: blocked, admin-unmetered, or platform-budgeted.

4. Require idempotency for cost-bearing provider calls
   - Member/org cost-bearing routes must require `Idempotency-Key`.
   - Admin-only unmetered routes can remain optional only if their operation config explicitly marks them as `admin_unmetered` and records cost telemetry.
   - Machine/scheduled routes use deterministic operation keys derived from local item/job ids.

5. Build stable request fingerprint
   - Fingerprint includes operation key, actor id, billing scope id, model id, normalized provider payload inputs, credit cost, and pricing version.
   - It excludes secrets, cookies, signatures, raw Authorization headers, and volatile timestamps.

6. Check entitlement
   - Org operations verify membership, role, organization status, and feature entitlement before provider execution.
   - Member operations verify active account status and product gates.
   - Admin operations verify platform admin/MFA where applicable.

7. Check credits/quota
   - Member/org charged operations verify available balance or quota before provider execution.
   - Platform-internal operations verify platform budget/limit state when that exists.

8. Reserve credits before provider call
   - Charged operations create a durable attempt with `reserved` status before provider execution.
   - Reservation records credit amount, request fingerprint, idempotency key, actor, billing scope, model, provider, and expiry.
   - Reservation does not create a final debit until provider success is safely finalized.

9. Suppress duplicate provider execution
   - Same idempotency key and same fingerprint:
     - `reserved` / `provider_running`: return conflict/in-progress.
     - `succeeded`: replay result or return safe metadata if replay expired.
     - `provider_failed`: allow retry with same key only if policy permits and no provider result exists.
     - `billing_failed`: return terminal billing failure and require a new idempotency key.
   - Same idempotency key and different fingerprint: return idempotency conflict.

10. Mark provider running
    - Gateway updates attempt state to `provider_running` immediately before provider call.
    - Observability event includes safe model/provider metadata, operation key, cost estimate, and correlation id.

11. Call provider
    - Route adapter owns provider-specific request construction and response parsing.
    - Gateway owns lifecycle state transitions and billing finalization.

12. On provider success: finalize debit and persist replay pointer
    - Gateway transitions to `finalizing`.
    - Route adapter persists safe result metadata or a replay object pointer when possible.
    - Gateway writes the final debit/usage event exactly once and marks `succeeded`.

13. On provider failure: release reservation/no charge
    - Gateway marks `provider_failed`, clears active reservation accounting, and returns a sanitized error.
    - No debit is written.

14. On billing finalization failure: safe terminal state
    - Gateway marks `billing_failed`.
    - Route must not return or persist uncharged paid output as a user-owned asset.
    - Operator/admin inspection should expose the safe failure state.

15. Replay successful result when safe
    - Replay can return full result only when the stored object/metadata is still valid, scoped to the same actor/billing scope, and safe to return.
    - If replay expired, return safe billing metadata and instruct the client to use a new idempotency key for a fresh provider call.

16. Expose billing metadata to UI
    - Response metadata should include feature, billing scope, credits charged/reserved, balance after, attempt id, idempotent replay flag, replay availability, and pricing version.
    - Do not expose request fingerprints, raw provider payloads, secret headers, payment details, or unredacted internal errors.

17. Emit observability events
    - Events should include operation key, route, actor type, billing scope type, model id, provider, credit estimate, idempotency state, attempt status, result status, and duration.
    - Events must not include prompts beyond bounded length summaries unless a route already intentionally stores them.

18. Cleanup expired attempts/replay objects
    - Expired reservations are released without debits.
    - Replay metadata and temporary replay objects expire according to policy.
    - Cleanup must not delete ledger rows, final usage rows, saved user media, audit archives, or unrelated R2 objects.

## Gateway API Shape

Phase 3.2 module: `workers/auth/src/lib/ai-cost-gateway.js`

The module currently exports:

- `AI_COST_GATEWAY_VERSION`
- `AI_COST_GATEWAY_MODES`
- `AI_COST_GATEWAY_SCOPES`
- `AI_COST_GATEWAY_PHASES`
- `AiCostGatewayError`
- `normalizeAiCostOperationConfig(config)`
- `buildAiCostRequestFingerprint(input)`
- `buildAiCostScopedIdempotencyKey(input)`
- `classifyAiCostGatewayState(input)`
- `createAiCostGatewayPlan(input)`

The Phase 3.2 implementation is pure and deterministic. It does not call D1, R2, Cloudflare AI, the AI Worker, Stripe, Cloudflare APIs, or network fetch. It validates future operation contracts, hashes request fingerprints, scopes client idempotency keys, and classifies the next action a future route adapter would take.

Phase 3.3 registry module: `workers/auth/src/lib/ai-cost-operations.js`

The registry currently exports:

- `AI_COST_OPERATION_REGISTRY_VERSION`
- `AI_COST_BUDGET_SCOPES`
- `AI_COST_BUDGET_SCOPE_POLICIES`
- `AI_COST_OPERATION_REGISTRY`
- `validateAiCostOperationRegistry(entries)`
- `getAiCostRoutePolicyBaselines(entries)`
- `getAiCostProviderCallSourceFiles(entries)`
- `summarizeAiCostOperationRegistry(entries)`

The registry stores target gateway operation configs plus current enforcement metadata. Member image, member music, and member video use it at runtime. Phase 4.1 extends registry metadata for admin/platform/internal operations with target budget scopes and future enforcement notes. Phase 4.2 adds a separate pure budget helper contract, but admin/platform/internal operations still use their pre-existing adapters.

Phase 4.2 admin/platform budget helper: `workers/auth/src/lib/admin-platform-budget-policy.js`

The helper currently exports:

- `ADMIN_PLATFORM_BUDGET_POLICY_VERSION`
- `ADMIN_PLATFORM_BUDGET_SCOPES`
- `ADMIN_PLATFORM_BUDGET_ACTIONS`
- `ADMIN_PLATFORM_BUDGET_PLAN_STATUSES`
- `AdminPlatformBudgetPolicyError`
- `normalizeAdminPlatformBudgetOperation(input)`
- `buildAdminPlatformBudgetFingerprint(input)`
- `buildAdminPlatformBudgetAuditFields(input)`
- `classifyAdminPlatformBudgetPlan(input)`
- `validateAdminPlatformKillSwitchConfig(input)`

The Phase 4.2 implementation is pure and deterministic. It does not call D1, R2, Cloudflare AI, the AI Worker, Stripe, Cloudflare APIs, network fetch, or live environment variables. It validates target budget-scope contracts, kill-switch metadata, explicit unmetered-admin justification, caller-enforced exemptions, safe audit field shape, and plan status for future admin/platform route migrations.

```js
const gateway = await prepareAiCostOperation({
  env,
  request,
  actor,
  operation: {
    key: "member.video.generate",
    route: "/api/ai/generate-video",
    featureKey: "ai.video.generate",
    billingMode: "member_credits",
    provider: "workers-ai",
    modelId,
    cost,
    replay: { kind: "r2-result-pointer", ttlSeconds: 1800 },
  },
  normalizedInput,
  billingScope,
  correlationId,
});

const start = await gateway.prepareForProvider();
if (start.kind !== "reserved") return start.response;

await gateway.markProviderRunning();

try {
  const providerResult = await callProvider();
  const replay = await persistReplay(providerResult);
  const debit = await gateway.finalizeSuccess({ replay, providerResultSummary });
  return buildSuccessResponse(providerResult, debit);
} catch (error) {
  await gateway.markProviderFailed(error);
  return providerFailureResponse(error);
}
```

## Operation Config Shape

Each operation config should define:

- `operationId`
- `routeId` / `routePath`
- `featureKey`
- `actorType`: `member`, `organization`, `admin`, or `platform`
- `billingScope`: `member_credit_account`, `organization_credit_account`, `platform_budget`, `unmetered_admin`, or `external`
- `providerFamily`
- `modelId` or `modelResolverKey`
- `creditCost`, `costUnits`, `quantity`, and/or explicit `costPolicy`
- `idempotencyPolicy`
- `reservationPolicy`
- `replayPolicy`
- `failurePolicy`
- `storagePolicy`
- `observabilityEventPrefix`
- `notes`

The Phase 3.3 registry additionally records:

- current enforcement status: `implemented`, `partial`, `missing`, or `not_applicable`
- current idempotency/reservation/replay/credit/provider-suppression details
- route-policy comparison metadata where practical
- source files that can directly or indirectly cause provider cost
- current gaps
- gap severity
- next migration phase

Future route adapters can use the registry target config. Phase 3.4 provides the first narrow adapter for member personal image generation and should be used as the reference shape for later music/video migrations, with route-specific storage and replay constraints reviewed separately.

Future implementation details should also define:

- `requestFingerprintFields`
- `modelResolver`
- `costResolver`
- `entitlementResolver`
- `creditResolver`
- `providerCallKind`: sync, async-job-create, async-poll, background
- `replayPolicy`
- `reservationTtlSeconds`
- `resultRetentionPolicy`
- `observabilityFields`

## Member Music Gateway Flow

Phase 3.6 migrates member `/api/ai/generate-music` to the AI Cost Gateway. Phase 3.7 hardens the already migrated member image/music gateway paths using the existing additive `0048` member attempt table and does not add a new migration. Phase 3.8 migrates member `/api/ai/generate-video` to the same member attempt foundation. Phase 3.9 adds an enforcement guard plus known-gap baseline so new provider-cost routes cannot appear silently without registry metadata or baseline classification. Phase 4.1 maps remaining admin/platform/internal/OpenClaw gaps to target budget scopes. Phase 4.2 adds pure helper contracts for future budget-scope, kill-switch, audit, fingerprint, and plan classification work. Admin video jobs, admin AI, platform/background AI, OpenClaw/News Pulse, and internal AI Worker routes remain unmigrated at runtime.

Target operation structure:

- Parent operation: `member.music.generate`
- Lyrics sub-operation: `member.music.lyrics.generate`
- Audio sub-operation: `member.music.audio.generate`
- Cover sub-operation: `member.music.cover.generate`

The music adapter uses one parent request idempotency key and one parent reservation for the full bundled music credit amount. Sub-operations are recorded under the parent attempt as safe metadata rather than independently debiting member credits. This matches the current product charge model: one fixed music debit after successful audio generation and local save, with the separate lyrics option represented by the current pricing schedule.

Implemented sequence:

1. Require `Idempotency-Key` before lyrics, audio, storage, or cover provider work.
2. Build a parent fingerprint from route id, operation id, member id, member credit account, pricing version, prompt hash/length, lyrics hash/length or generated-lyrics flag, instrumental mode, model id, and stable request options.
3. Reject same key with a different fingerprint before provider execution.
4. Apply the daily member top-up/check behavior already required by member credit policy.
5. Reserve the full parent cost before optional lyrics generation or audio generation.
6. Mark the parent as provider-running before the first provider-cost sub-operation.
7. Run optional lyrics generation under `member.music.lyrics.generate`; store only safe status, model id, elapsed time, lyrics hash/length, and error class in gateway metadata.
8. Run required audio generation under `member.music.audio.generate`; store safe provider status and a replay pointer only after audio is persisted safely.
9. Persist the music asset before final debit. If storage fails after provider success, mark a no-charge failure or terminal safe state and do not return an uncharged paid result.
10. Finalize exactly one member debit after audio provider success and successful local save.
11. Schedule cover generation only after final music success. Phase 3.6 policy includes cover generation in the parent music bundle with no separate visible charge; Phase 3.7 records safe `pending`/`succeeded`/`failed`/`skipped` cover status on the parent attempt.
12. Replay a completed same-key request from safe asset/result metadata when available. If replay is expired, missing, or unavailable, return a safe replay-unavailable response, do not call providers again, do not debit again, and require a new key for fresh provider work.

Failure and replay policy:

- Lyrics success plus music failure releases the parent reservation and charges nothing. Raw generated lyrics are intentionally not stored in member attempt metadata; future work may add a safer lyrics replay pointer if needed.
- Music audio failure releases the parent reservation and charges nothing.
- Music audio success plus storage failure should not debit and should not return the paid output as user-owned media.
- Billing finalization failure is terminal; do not replay unpaid output.
- Duplicate in-progress same-key requests should return in-progress/conflict without additional provider calls.
- Duplicate completed same-key requests should not debit again and should not call lyrics/audio providers again when replay metadata is valid or unavailable.
- Cover failure is non-fatal to the finalized music debit. Phase 3.7 writes safe cover status to the parent attempt without storing poster R2 keys or temporary cover keys in attempt metadata.
- Scheduled cleanup releases expired/stuck member reservations without debits and expires/deletes only approved-prefix temporary replay objects linked to `member_ai_usage_attempts`; it must not delete saved media, ledger rows, usage events, attempt rows, or unrelated R2 objects.

Safe music gateway metadata may include operation ids, model ids, pricing version, credit amount, prompt hash/length, lyrics hash/length, generated lyrics flag, instrumental flag, asset id, provider status, replay availability, cover status, and correlation id. It must not include secret values, cookies, raw auth tokens, provider credentials, raw request fingerprints, unbounded prompts, or unbounded lyrics in gateway state.

## Member Video Gateway Flow

Phase 3.8 migrates member `/api/ai/generate-video` only. The route remains synchronous and still calls the existing PixVerse V6 / HappyHorse T2V provider path, then fetches and persists the returned video/poster into the member's private `ai_text_assets` storage. The migration changes cost-control behavior around that existing flow without migrating admin video jobs or internal AI Worker video task routes.

Implemented sequence:

1. Require a valid `Idempotency-Key` before provider execution or remote output fetch.
2. Build a parent fingerprint from route id, operation id `member.video.generate`, member id, member credit account, model/pricing version, prompt hash/length, image-input hash, duration, quality/resolution/ratio, seed, audio/watermark flags, and stable request options.
3. Reject same key with a different fingerprint before provider execution.
4. Apply the existing daily member top-up/check behavior and reserve the full dynamic video credit cost in `member_ai_usage_attempts` before provider work.
5. Mark the parent attempt provider-running before `env.AI.run`.
6. On provider failure, release/no-charge the reservation.
7. On provider success, fetch and validate the remote video/poster under existing media limits, then persist the video asset to R2/D1 before debit.
8. If remote output fetch or storage fails before debit, mark a terminal no-charge state and do not return a paid output.
9. Finalize exactly one member debit after durable video asset persistence.
10. Store safe durable-asset replay metadata on the parent attempt. It may include model id, pricing dimensions, prompt length/hash-derived fingerprint, asset id, public member asset URLs, poster availability, and size/duration fields. It must not include raw prompt text, raw image input, cookies, auth tokens, secrets, provider credentials, signed provider URLs, or internal R2 keys.
11. Replay a completed same-key request from safe saved-asset metadata when available. If the saved asset row or object is missing, return replay-unavailable, do not call providers again, do not debit again, and require a new key for fresh provider work.

Failure and replay policy:

- Duplicate in-progress same-key requests return `member_ai_usage_attempt_in_progress` and do not call the provider again.
- Duplicate completed same-key requests with valid saved asset metadata return a bounded replay response with `prompt: null`, `promptLength`, safe model/pricing fields, asset id, and member asset URLs.
- Completed attempts with missing replay metadata or missing saved objects are terminal replay-unavailable for that idempotency key.
- Billing finalization failure after provider success is terminal and must not silently return success.
- The implementation intentionally does not migrate admin async video jobs, admin debug video, platform budget enforcement, OpenClaw/News Pulse visuals, or internal AI Worker video task routes.

## Phase 3.9 Enforcement Guard

Phase 3.9 is check/tooling only. It adds `config/ai-cost-policy-baseline.json` and strengthens `scripts/check-ai-cost-policy.mjs` so local validation fails on:

- duplicate AI cost operation ids
- duplicate known-gap baseline ids
- missing baseline route/file references, unless a gap is explicitly marked external/internal-only
- provider-call source files not represented by the operation registry or known-gap baseline
- unbaselined route-policy gaps
- member image, music, or video gateway regression from implemented idempotency/reservation/replay/credit/provider-suppression metadata

The default guard passes with the current accepted admin/platform/internal/OpenClaw baseline. `--strict` remains deterministic and fails while any allowed baseline gaps remain, which makes it useful for a future phase after those gaps are closed.

This phase does not change request handling, provider execution, credit debits, replay behavior, pricing, route policies at runtime, migrations, deploys, or live billing readiness.

## Phase 4.1 Admin/Platform Budget Policy

Phase 4.1 is design, metadata, and check output only. It converts the Phase 3.9 known-gap baseline into a target budget model for non-member-credit AI provider spend.

Target budget scopes:

- `admin_org_credit_account`: selected organization pays for admin-initiated charged tests, such as priced BFL admin image tests.
- `platform_admin_lab_budget`: platform-owned spend for admin text/image/music/compare/live-agent/debug testing.
- `platform_background_budget`: platform-owned spend for background jobs if a future provider-cost backfill is introduced.
- `openclaw_news_pulse_budget`: platform-owned visual budget for OpenClaw/News Pulse generated thumbnails and scheduled visual backfill.
- `internal_ai_worker_caller_enforced`: service-only AI Worker routes that must inherit operation/budget metadata from the Auth Worker caller or queue job.
- `explicit_unmetered_admin`: temporary reviewed exception, not a default runtime mode.
- `external_provider_only`: external provider involvement where BITBI does not debit credits but still needs safe caller policy.

Target behavior for future admin/platform migrations:

- require deterministic idempotency or an explicit reviewed unmetered exception before provider execution
- deny before provider execution when platform/admin budgets, daily/monthly caps, or kill switches block the operation
- keep charged admin BFL image tests on selected organization credits while adding explicit admin budget metadata
- bind admin async video task create/poll to a parent job budget reservation before provider task creation
- keep internal AI Worker routes service-only and reject unknown callers in a future caller-policy guard
- use deterministic item/job keys for OpenClaw/News Pulse visuals
- emit only safe telemetry: operation id, budget scope, actor id, provider/model id, estimate, status, replay status, and safe error codes
- never store raw prompts, lyrics, cookies, auth tokens, provider secrets, Stripe data, raw provider payloads, payment details, or internal R2 keys in budget metadata

Phase 4.1 does not enforce these scopes at runtime, add budget tables, add Admin UI, call providers, change credit debits, or make production/live billing ready.

## Phase 4.2 Admin/Platform Budget Helper Contract

Phase 4.2 is contract/helper/test only. It adds the future route-migration contract for non-member-credit provider spend without importing the helper from runtime routes.

Helper contract:

- Budget scopes validated: `admin_org_credit_account`, `platform_admin_lab_budget`, `platform_background_budget`, `openclaw_news_pulse_budget`, `internal_ai_worker_caller_enforced`, `explicit_unmetered_admin`, `external_provider_only`, plus shared compatibility recognition for `member_credit_account` and `organization_credit_account`.
- Kill-switch metadata shape: `flagName`, `defaultState`, `requiredForProviderCall`, `disabledBehavior`, `operatorCanOverride`, `scope`, and notes.
- High-risk scopes default to safe/off unless a future migration explicitly documents why not.
- Explicit unmetered admin operations require justification.
- Internal/caller-enforced and external-provider-only scopes require explicit exemption text rather than silent missing kill switches.
- Audit fields are allowlisted and safe: policy version, operation id, actor id/role, budget scope, owner domain, provider/model ids, estimate, idempotency policy, kill-switch flag name, plan status, reason, and correlation id.
- Fingerprints are deterministic, omit sensitive fields, and hash prompt-like fields inside the fingerprint payload.
- Plan statuses are `ready_for_budget_check`, `requires_kill_switch`, `blocked_by_policy`, `caller_enforced`, `explicit_unmetered`, `platform_budget_review`, `admin_org_credit_required`, and `invalid_config`.

Phase 4.2 does not add D1 schema, budget ledgers, env reads, route guards, Admin UI, provider calls, credit mutations, or live readiness evidence. The next implementation phase should migrate exactly one narrow admin/provider-cost flow or add a report-only budget evidence collector.

## Route Adapter Responsibilities

Route adapters remain responsible for:

- auth/session/admin checks already owned by the route
- body parsing and validation
- model-specific provider payload construction
- provider call execution
- provider response parsing and safe result shaping
- route-specific storage, such as temporary save references, text replay metadata, R2 asset ingest, or job output
- user-facing HTTP response text and status

Route adapters should not independently decide credit debit semantics once migrated.

## Model Catalog / Cost Resolver Responsibilities

The resolver should:

- map route input to a canonical model id
- reject unsupported model ids before provider execution
- calculate provider cost and BITBI credit cost from central pricing modules
- return pricing version and normalized cost dimensions
- flag unpriced/admin-only models explicitly
- record whether pricing is verified, estimated, or pending dashboard verification

## Storage / Replay Responsibilities

Replay storage should:

- store only safe, scoped result pointers or bounded metadata
- avoid raw secret/provider headers
- validate R2 key prefixes before replay or cleanup
- expire temporary replay objects
- return `replay_available=false` when objects are gone rather than re-calling providers automatically

## Member, Org, Admin, And Platform Differences

- Member operations charge personal member credit buckets and should require idempotency.
- Org operations charge organization credits and already fit the `ai_usage_attempts` pattern.
- Admin operations may remain uncharged only if explicitly classified as `admin_unmetered`; high-cost admin operations should still require idempotency/job rows and record platform cost telemetry.
- Platform background operations such as News Pulse visuals should use deterministic item/job keys and platform budget caps rather than member credits.
- Internal AI Worker operations should remain service-only and inherit caller-side budget metadata; direct internal route budget ownership should not replace caller enforcement.

## Safety Invariants

- No provider call after failed entitlement, auth, role, body-size, model, idempotency, or credit check.
- No duplicate provider execution for same idempotency key and same request fingerprint once an operation is reserved/running/succeeded.
- No charge on provider failure.
- No uncharged paid result returned after billing finalization failure.
- No raw provider payload, prompt corpus, secret, cookie, Authorization header, webhook signature, or payment method data in gateway state or admin output.
- No destructive cleanup outside approved temp/replay prefixes.
- Every cost-bearing operation has tests for duplicate same-key, same-key mismatch, provider failure, billing failure, and replay/expired replay.

## Observability Fields

Minimum safe fields:

- `operation_key`
- `route`
- `actor_type`
- `actor_id_hash` or safe actor id where already used internally
- `billing_scope_type`
- `billing_scope_id`
- `feature_key`
- `model_id`
- `provider`
- `credit_cost`
- `pricing_version`
- `idempotency_state`
- `attempt_id`
- `attempt_status`
- `provider_status`
- `billing_status`
- `result_status`
- `duration_ms`
- `correlation_id`

## Test Strategy

For each migrated route:

- rejects missing idempotency before provider call
- rejects same key with different body before provider call
- suppresses same-key concurrent duplicate provider call
- replays or safely reports completed same-key retry
- checks credits before provider call
- reserves before provider call
- releases/no-charges on provider failure
- handles billing finalization failure as terminal and safe
- does not leak raw provider payloads or secrets
- records safe admin/observability metadata
- preserves existing frontend response shape where possible

For the gateway module:

- pure unit tests for fingerprint, idempotency state, reservation state, and error mapping
- Phase 3.2 deterministic test harness in `scripts/test-ai-cost-gateway.mjs`
- Worker tests for D1 concurrency/idempotency behavior
- static route-policy/check tests that block new cost-bearing routes without gateway metadata after enforcement begins
