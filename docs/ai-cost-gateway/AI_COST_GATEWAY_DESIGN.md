# AI Cost Gateway Design

Date: 2026-05-15

Status: target design plus Phase 3.3 unused operation registry/report-only baseline. No live route imports the gateway module or registry yet, and no runtime behavior is changed by this document.

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
   - Platform/admin-unmetered operations still produce cost telemetry.

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
- `AI_COST_OPERATION_REGISTRY`
- `validateAiCostOperationRegistry(entries)`
- `getAiCostRoutePolicyBaselines(entries)`
- `getAiCostProviderCallSourceFiles(entries)`
- `summarizeAiCostOperationRegistry(entries)`

The registry stores target gateway operation configs plus current enforcement metadata. It is report-only and unused by live route handlers in Phase 3.3.

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

Future route adapters can use the registry target config, but Phase 3.3 does not wire it into runtime code.

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
