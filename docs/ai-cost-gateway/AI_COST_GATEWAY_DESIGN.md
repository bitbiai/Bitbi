# AI Cost Gateway Design

Date: 2026-05-16

Status: target design plus Phase 4.20 read-only `platform_admin_lab_budget` repair evidence report/export on top of Phase 4.19 explicit admin-approved repair execution, Phase 4.18 read-only reconciliation evidence, Phase 4.17's first narrow cap foundation, completed Phase 4.16 design/evidence, and Phase 4.15/4.15.1 switch controls. Phase 4.19 adds additive migration `0054_add_platform_budget_repair_actions.sql`; Phase 4.20 adds no migration and exports bounded sanitized repair evidence only. It does not add repair execution, automatic repair, provider calls, route behavior changes, Stripe behavior, Cloudflare mutation, member/org billing changes, credit clawback, or live billing readiness. Platform/background AI outside News Pulse visuals and other budget scopes remain outside this report scope.

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
   - Phase 4.2 adds pure helper validation and plan classification for those scopes.
   - Phase 4.3 uses the helper only for charged Admin image-test metadata; Phase 4.15 now enforces the charged model-specific env switches without migrating broad Admin AI.
   - Phase 4.5 uses the helper only for admin async video jobs; Phase 4.15 enforces `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET` before job row creation and queueing.
   - Phase 4.6 uses the helper only for OpenClaw/News Pulse visuals; Phase 4.15 enforces `ENABLE_NEWS_PULSE_VISUAL_BUDGET` before provider visual generation/backfill while public reads remain unaffected.
   - Phase 4.7 uses reserved signed JSON body caller-policy metadata (`__bitbi_ai_caller_policy`) for internal Auth Worker -> AI Worker provider-cost calls; it validates and strips the metadata before provider payloads.
   - Phase 4.8.1 uses the helper only for admin text/embeddings; Phase 4.15 enforces `ENABLE_ADMIN_AI_TEXT_BUDGET` and `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET` before durable attempts or provider work.
   - Phase 4.8.2 keeps provider and billing behavior unchanged while adding bounded cleanup and sanitized operator inspection for those admin text/embeddings attempts.
   - Phase 4.9 uses the helper only for Admin Music; Phase 4.15 enforces `ENABLE_ADMIN_AI_MUSIC_BUDGET` before durable attempts or provider work.
   - Phase 4.10 uses the helper only for Admin Compare; Phase 4.15 enforces `ENABLE_ADMIN_AI_COMPARE_BUDGET` before durable attempts or multi-model provider fanout.
   - Phase 4.11 audits Admin Live-Agent only and records the Phase 4.12 target. Phase 4.12 implements that target narrowly for `POST /api/admin/ai/live-agent`: `platform_admin_lab_budget`, `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET` metadata, request-level idempotency, metadata-only stream-session attempts, signed caller-policy propagation, observable stream finalization, and no raw message/output persistence.
   - Phase 4.13 audits and retires sync video debug as disabled-by-default/emergency-only. It does not add budget enforcement because async admin video jobs are the supported budgeted admin video path.
   - Phase 4.14 resolves Admin Image branch ambiguity: FLUX.2 Dev is the only explicit `explicit_unmetered_admin` admin image exception, charged priced models remain `admin_org_credit_account`, and unclassified Admin Image models are blocked before provider execution. Phase 4.15 enforces model-specific charged image switches and `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS` before provider work.
   - Other platform/admin-unmetered operations still need explicit cost telemetry and a budget exception before runtime migration.

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
    - Cleanup must not delete ledger rows, final usage rows, saved user media, audit archives, or unrelated R2 objects. Phase 4.8.2 follows this pattern for `admin_ai_usage_attempts` by marking only expired pending/running rows and retaining completed/failed records for operator review.

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

The registry stores target gateway operation configs plus current enforcement metadata. Member image, member music, and member video use it at runtime. Phase 4.1 extends registry metadata for admin/platform/internal operations with target budget scopes and future enforcement notes. Phase 4.2 adds a separate pure budget helper contract. Phase 4.3 marks `admin.image.test.charged` as implemented/hardened because the existing selected-organization credit branch now records safe budget-policy metadata. Phase 4.5 marks admin async video jobs as implemented for job/queue budget metadata. Phase 4.6 marks OpenClaw/News Pulse visual generation as implemented for caller-side visual budget metadata and duplicate suppression. Phase 4.8.1 marks admin text/embeddings as partial metadata-only durable-idempotency coverage; Phase 4.8.2 adds operational cleanup/inspection evidence for the same rows. Phase 4.9 marks admin music as partial metadata-only durable-idempotency coverage without adding a migration. Phase 4.10 marks admin compare as partial metadata-only durable-idempotency coverage without adding a migration. Phase 4.12 marks Admin Live-Agent as partial metadata-only stream-session durable-idempotency coverage without adding a migration. Phase 4.13 marks sync video debug as retired/disabled-by-default rather than a normal baseline gap. Phase 4.14 marks `admin.image.test.unmetered` as an explicit `explicit_unmetered_admin` exception and blocks unclassified Admin Image models before AI Worker/provider execution. Other admin/platform/internal gaps remain baselined.

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

The helper implementation is pure and deterministic. It does not call D1, R2, Cloudflare AI, the AI Worker, Stripe, Cloudflare APIs, network fetch, or live environment variables. It validates target budget-scope contracts, kill-switch metadata, explicit unmetered-admin justification, caller-enforced exemptions, safe audit field shape, and plan status. Phase 4.3 uses it in the charged Admin image-test route only to produce safe plan/audit metadata and a deterministic policy fingerprint.

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

Phase 3.6 migrates member `/api/ai/generate-music` to the AI Cost Gateway. Phase 3.7 hardens the already migrated member image/music gateway paths using the existing additive `0048` member attempt table and does not add a new migration. Phase 3.8 migrates member `/api/ai/generate-video` to the same member attempt foundation. Phase 3.9 adds an enforcement guard plus known-gap baseline so new provider-cost routes cannot appear silently without registry metadata or baseline classification. Phase 4.1 maps remaining admin/platform/internal/OpenClaw gaps to target budget scopes. Phase 4.2 adds pure helper contracts for budget-scope, kill-switch, audit, fingerprint, and plan classification work. Phase 4.3 uses that helper only for the existing charged Admin image-test branch. Phase 4.5 uses it only for admin async video jobs. Phase 4.6 uses it only for OpenClaw/News Pulse visual generation. Phase 4.8.1 uses it only for admin text/embeddings metadata-only durable idempotency coverage. Phase 4.9 uses it only for Admin Music metadata-only durable idempotency coverage. Phase 4.10 uses it only for Admin Compare metadata-only durable idempotency coverage. Phase 4.12 uses it only for Admin Live-Agent metadata-only stream-session durable idempotency coverage. Phase 4.13 retires sync video debug as disabled-by-default/emergency-only rather than adding a normal budget migration. Phase 4.14 classifies Admin Image branches and blocks unclassified models before provider execution. Platform/background AI outside News Pulse visuals and broader internal AI Worker callers remain unmigrated at runtime.

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
- The implementation intentionally does not migrate sync admin debug video into a normal provider-cost path, broad platform budget enforcement, OpenClaw/News Pulse visuals before Phase 4.6, or internal AI Worker video task routes globally. Phase 4.13 retires sync debug as disabled-by-default/emergency-only; admin async video jobs are covered separately by Phase 4.5 and News Pulse visuals by Phase 4.6.

## Phase 3.9 Enforcement Guard

Phase 3.9 is check/tooling only. It adds `config/ai-cost-policy-baseline.json` and strengthens `scripts/check-ai-cost-policy.mjs` so local validation fails on:

- duplicate AI cost operation ids
- duplicate known-gap baseline ids
- missing baseline route/file references, unless a gap is explicitly marked external/internal-only
- provider-call source files not represented by the operation registry or known-gap baseline
- unbaselined route-policy gaps
- member image, music, or video gateway regression from implemented idempotency/reservation/replay/credit/provider-suppression metadata

The default guard passes with the current accepted admin/platform/internal baseline. The specific OpenClaw/News Pulse visual gap is removed after Phase 4.6, while broader platform/background and internal gaps remain. `--strict` remains deterministic and fails while any allowed baseline gaps remain, which makes it useful for a future phase after those gaps are closed.

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
- bind admin async video task create/poll to a parent job budget state before provider task creation; Phase 4.5 implements this only for the auth Worker admin video queue caller
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

Phase 4.2 does not add D1 schema, budget ledgers, env reads, route guards, Admin UI, provider calls, credit mutations, or live readiness evidence. Phase 4.3 adds no schema; it records metadata only for the already charged Admin image-test branch and preserves selected-organization credit debits, required idempotency, provider-failure no-charge behavior, and metadata-only replay. Phase 4.4 adds read-only evidence reporting only; it does not add runtime enforcement, migrate routes, call providers, mutate billing, or prove live readiness. Phase 4.5 adds additive migration `0049_add_admin_video_job_budget_metadata.sql` and changes only admin async video job budget metadata/queue checks. Phase 4.6 adds additive migration `0050_add_news_pulse_visual_budget_metadata.sql` and changes only OpenClaw/News Pulse visual budget metadata/status controls. Phase 4.7 adds no schema; it changes only internal caller-policy validation/metadata handling. Phase 4.8 adds no schema; it changes only admin text/embeddings required idempotency, safe budget metadata, and caller-policy propagation. Phase 4.8.1 adds additive migration `0051_add_admin_ai_usage_attempts.sql` and changes only admin text/embeddings durable metadata-only idempotency. Phase 4.8.2 adds no migration and changes only admin text/embeddings attempt operability: admin-only sanitized list/detail, dry-run-default bounded cleanup, and scheduled non-destructive expiry marking for pending/running rows. Phase 4.9 adds no migration and changes only Admin Music required idempotency, safe budget metadata, caller-policy propagation, and metadata-only duplicate suppression. Phase 4.10 adds no migration and changes only Admin Compare required idempotency, safe budget metadata, caller-policy propagation, and metadata-only duplicate provider-fanout suppression. Phase 4.11 audits Live-Agent only, Phase 4.12 migrates Live-Agent narrowly, Phase 4.13 retires sync video debug as disabled-by-default, Phase 4.14 classifies Admin Image branches, Phase 4.15 enforces Cloudflare master runtime budget switches for already budget-classified admin/platform paths before provider/queue/credit/durable-attempt work, and Phase 4.15.1 adds D1 app-level switch state/history plus admin-only switch APIs/UI. Phase 4.16 adds design/evidence/check metadata for live platform budget caps only and remains preserved. Phase 4.16 does not enforce live platform caps, add cap schema, change provider route behavior, migrate new provider-cost routes, mutate member/org billing behavior, call Stripe, call real providers, or prove live billing readiness.

## Phase 4.5 Admin Async Video Job Budget Enforcement

Phase 4.5 covers only `POST /api/admin/ai/video-jobs` and the auth Worker queue consumer for those jobs.

Implemented behavior:

- requires the existing `Idempotency-Key` for job creation and preserves same-key replay/conflict behavior
- builds a Phase 4.2 budget plan with scope `platform_admin_lab_budget` before inserting or queueing a new job
- stores sanitized budget metadata on the job row: operation id, actor/admin id, actor class, budget scope, owner domain, provider family, model resolver key, estimated credits when available, idempotency policy, plan status, runtime switch target, and fingerprint
- includes a bounded budget summary in `AI_VIDEO_JOBS_QUEUE` messages without prompts, provider request bodies, tokens, cookies, Stripe data, Cloudflare tokens, or raw R2 keys
- verifies job budget metadata before the queue consumer calls `/internal/ai/video-task/create` or `/internal/ai/video-task/poll`
- suppresses duplicate provider task creation after a prior unresolved create attempt with no provider task id
- preserves output/poster persistence behavior and does not mark budget state successful when output persistence fails

Limits:

- Phase 4.15 enforces `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET` before job row creation/queueing; Phase 4.15.1 requires the D1 app switch; Phase 4.17 checks `platform_admin_lab_budget` daily/monthly caps before queueing and records bounded usage when a job succeeds.
- Internal AI Worker service-auth remains the first gate. Phase 4.7 adds caller-policy validation after service-auth and before provider route handling for async video task create/poll; broader internal routes are still baseline-allowed.
- No credits are debited, no credit clawback is added, no Stripe APIs are called, no real providers are called in tests, and production/live billing remains blocked.

## Phase 4.7 Internal AI Worker Caller-Policy Guard

Phase 4.7 covers only internal caller-policy validation and metadata transport for service-auth-protected AI Worker routes.

Implemented behavior:

- caller-policy metadata is transported in the signed JSON body under `__bitbi_ai_caller_policy`
- service-auth verification still runs before caller-policy evaluation
- the AI Worker validates supplied caller-policy metadata against allowed statuses, budget scopes, caller classes, and route operation ids
- `/internal/ai/video-task/create` and `/internal/ai/video-task/poll` reject missing or malformed caller policy
- known broad internal routes still allow missing policy only as explicit `baseline_allowed` gaps, but reject malformed supplied policy
- the shared AI Worker body parser strips the reserved metadata key before validators and provider payload builders run
- Auth Worker propagation covers charged Admin BFL image metadata, admin async video task create/poll metadata, and member music internal lyrics/audio compatibility; News Pulse remains a direct Auth Worker provider path covered by Phase 4.6 metadata

Limits:

- Phase 4.7 does not add a new migration, live budget caps, credit debits, credit clawbacks, Stripe calls, real provider calls in tests, Admin UI, or production/live billing readiness.
- Sync video debug is retired/disabled-by-default by Phase 4.13 and tracked as a retired debug path rather than a normal baseline gap. Admin Image branches are classified by Phase 4.14: charged priced models are covered by the selected-organization path, FLUX.2 Dev is an explicit unmetered admin exception, and unclassified models block before provider execution. Phase 4.15 adds runtime switch enforcement for already budget-classified admin/platform paths. Platform/background AI outside News Pulse visuals and broader internal routes remain tracked baseline gaps. Full stream/result replay and live platform caps remain future work.

## Phase 4.8 Admin Text / Embeddings Budget Enforcement

Phase 4.8 covers only `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings`.

Implemented behavior:

- both routes remain admin-only and require a valid `Idempotency-Key`
- both routes build a Phase 4.2 `platform_admin_lab_budget` plan before proxying to the AI Worker
- sanitized admin responses include `budget_policy` and `caller_policy` summaries with operation id, budget scope, provider family/model, plan status, safe fingerprint, and runtime switch target
- Auth Worker proxy bodies include signed `__bitbi_ai_caller_policy` metadata with `budget_metadata_only` status
- AI Worker service-auth remains first, supplied caller-policy metadata is validated, and the reserved key is stripped before provider payload construction
- raw prompt/input, provider request bodies, auth headers, cookies, Stripe data, Cloudflare tokens, private keys, and R2 keys are not included in budget/caller metadata

Limits:

- Phase 4.15 enforces `ENABLE_ADMIN_AI_TEXT_BUDGET` and `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET` before durable attempt creation or internal AI Worker/provider work.
- Phase 4.8.1 supersedes the original Phase 4.8 duplicate-suppression gap with durable metadata-only attempt rows. Full result replay is still not claimed.
- No credits are debited, no credit clawback is added, no Stripe APIs are called, no real providers are called in tests, Phase 4.17 caps are not customer billing, and production/live billing remains blocked.

## Phase 4.8.1 Admin Text / Embeddings Durable Idempotency

Phase 4.8.1 covers only the durable idempotency gap for `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings`.

Implemented behavior:

- `0051_add_admin_ai_usage_attempts.sql` adds the narrow `admin_ai_usage_attempts` table.
- `0052_add_admin_runtime_budget_switches.sql` adds D1 app-level Admin AI budget switch state/history. It stores only switch key, boolean app state, bounded reason/metadata, safe updater summary, idempotency key, and request hash. It does not store Cloudflare values, Cloudflare API tokens, provider payloads, prompts, billing secrets, or cap-counter values.
- `0053_add_platform_budget_caps.sql` adds Phase 4.17 platform budget cap limits, cap update events, and bounded usage events for `platform_admin_lab_budget`. It stores safe operation/source/actor summaries, estimated units, daily/monthly window keys, idempotency/source de-duplication keys, and sanitized metadata only.
- `0054_add_platform_budget_repair_actions.sql` adds Phase 4.19 platform budget repair action audit rows for explicit admin-approved repair requests. It stores safe candidate/action/status/source summaries, idempotency key/request hash, reason, sanitized evidence/result JSON, and any created usage event id; it does not store raw prompts, provider bodies, Stripe data, Cloudflare values, secrets, or credit/customer billing data.
- Phase 4.20 adds no schema. It reads `platform_budget_repair_actions` and sanitized related local D1 evidence through admin-only report/export endpoints and returns JSON or Markdown evidence without applying repairs or mutating usage/source rows.
- attempts store hashed idempotency keys, stable request fingerprints, model/budget/caller-policy metadata, statuses, and sanitized result metadata.
- raw prompts, raw embedding input, generated text, embedding vectors, provider request bodies, secrets, cookies, auth headers, Stripe data, Cloudflare tokens, and private keys are not stored.
- same-key/same-request pending, completed, or failed attempts do not make another internal AI/provider call.
- same-key/different-request retries return `idempotency_conflict` before provider execution.
- completed duplicates return metadata-only replay with `result: null`; failed duplicates are terminal and require a new key.

Limits:

- full generated text replay and embedding-vector replay are intentionally not implemented.
- full result replay, other budget scopes, credit debits, Stripe calls, unrelated Admin AI migration, and production/live billing readiness remain future work.

## Phase 4.8.2 Admin AI Usage Attempts Cleanup And Inspection

Phase 4.8.2 covers only operational safety for the `admin_ai_usage_attempts`
rows created by Phase 4.8.1. It adds no schema and does not migrate another
provider-cost route.

Implemented behavior:

- admin-only sanitized list/detail endpoints expose attempt state without raw
  prompts, raw embedding input, generated text, embedding vectors, raw provider
  bodies, raw idempotency keys, key hashes, request fingerprints, cookies,
  auth headers, Stripe data, Cloudflare tokens, secrets, private keys, or
  private R2 keys
- `POST /api/admin/ai/admin-usage-attempts/cleanup-expired` is same-origin
  protected, production-MFA-classified, fail-closed rate limited, audited,
  bounded by limit, and dry-run by default
- cleanup marks only expired active `pending` / `provider_running` rows as
  `expired`; completed/succeeded/failed rows are retained by default
- scheduled cleanup runs the same bounded non-destructive helper with count-only
  safe logs and does not block unrelated scheduled work on missing tables or
  cleanup failure

Limits:

- cleanup does not delete rows or R2 objects, call providers, call Stripe,
  mutate credits, mutate billing ledgers, replay generated text, replay
  embeddings/music/compare, migrate Admin live-agent, or prove production/live
  billing readiness.

## Phase 4.6 OpenClaw/News Pulse Visual Budget Controls

Phase 4.6 covers only OpenClaw/News Pulse generated thumbnail creation from signed ingest waitUntil work and scheduled visual backfill.

Implemented behavior:

- builds a Phase 4.2 budget plan with scope `openclaw_news_pulse_budget` before the direct FLUX visual provider call
- records operation ids `platform.news_pulse.visual.ingest` and `platform.news_pulse.visual.scheduled` for ingest-triggered and scheduled paths
- stores sanitized visual budget metadata on `news_pulse_items`: operation id, actor class/id, budget scope, owner domain, provider family, model resolver key, idempotency policy, plan status, runtime switch target, fingerprint, trigger, item id, locale, content hash, attempt count, and safe runtime status
- blocks provider execution when budget policy config is invalid
- preserves existing ready/pending/status/attempt duplicate suppression so ready visuals and active attempts do not call the provider again
- keeps public News Pulse read routes compatible; visuals fall back safely when unavailable
- records provider/storage failures without marking visuals ready or exposing internal R2 keys

Limits:

- Phase 4.15 enforces `ENABLE_NEWS_PULSE_VISUAL_BUDGET` before visual provider generation/backfill; `openclaw_news_pulse_budget` caps remain future work outside the Phase 4.17 `platform_admin_lab_budget` foundation.
- Signed OpenClaw ingest authorization, public read route behavior, and internal AI Worker service-auth semantics are unchanged.
- Broad platform/background AI outside this domain remains unmigrated.
- No credits are debited, no credit clawback is added, no Stripe APIs are called, no real providers are called in tests, and production/live billing remains blocked.

## Phase 4.3 Charged Admin BFL Image-Test Hardening

Phase 4.3 is a narrow runtime hardening for `POST /api/admin/ai/test-image` when the requested image model is already in the charged admin image-test catalog. It does not change unpriced admin image tests, admin text/music/video/compare/live-agent routes, member routes, org-scoped routes, public pricing, Stripe, or live billing.

Implemented behavior:

- requires selected organization context and a valid `Idempotency-Key` before provider execution, preserving the existing charged path
- keeps selected organization credits as the spend source and uses `ai_usage_attempts` for reservation/provider-running/finalization/replay-unavailable state
- creates an `admin_org_credit_account` budget policy plan through `classifyAdminPlatformBudgetPlan`
- computes a deterministic budget policy fingerprint through `buildAdminPlatformBudgetFingerprint`, hashing prompt-like fields and excluding organization aliases
- records safe `budget_policy` metadata in the Admin AI response, `usage_events.metadata_json`, and `ai_usage_attempts.metadata_json`
- records kill-switch target metadata such as `ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET` for BFL models; Phase 4.15 enforces the relevant model-specific switch before provider work or credit debit
- preserves no charge on provider failure, exactly-once debit on provider success, conflict handling for same-key/different-body retries, and metadata-only duplicate-completed replay

Safe metadata can include policy version, operation id, actor user id, actor role/class, budget scope, owner domain, provider family, model id, estimated credits, idempotency policy, plan status, required next action, kill-switch flag name, correlation id, and the budget fingerprint. It must not include raw prompts, provider request bodies, cookies, auth headers, tokens, Stripe data, Cloudflare tokens, secrets, or internal R2 keys.

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
