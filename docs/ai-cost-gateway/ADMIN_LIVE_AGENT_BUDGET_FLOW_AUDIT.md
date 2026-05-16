# Admin Live-Agent Budget Flow Audit

Status: Phase 4.11 audit/design/prep only. No Admin Live-Agent runtime behavior changed, no `Idempotency-Key` requirement was added, no durable Live-Agent attempt rows were added, no provider calls were made by Codex/tests, no Stripe calls were made, no live billing was enabled, and production/live billing remains BLOCKED.

## Current Flow

Current Auth Worker route:
- Route: `POST /api/admin/ai/live-agent`
- Handler: `workers/auth/src/routes/admin-ai.js` inside `handleAdminAI`
- Route policy id: `admin.ai.live-agent`
- Authorization: `requireAdmin` gates all `/api/admin/ai/*` routes before the Live-Agent branch.
- MFA classification: route policy uses `adminJsonWrite`, so production MFA is classified as `admin-production-required`.
- CSRF/body/rate-limit classification: same-origin JSON route, `adminJson` body limit, fail-closed shared limiter scope `admin-ai-liveagent-ip`.
- Runtime limiter in handler: 20 requests per 600 seconds per IP.
- Current idempotency: no `Idempotency-Key` requirement and no durable duplicate suppression.
- Current budget behavior: no budget plan, no durable budget metadata, no credit debit, no platform budget cap, and no runtime budget kill switch.

Current request shape:
- Body contains `messages`.
- `messages` must be a non-empty array.
- Each message must be an object with `role` of `system`, `user`, or `assistant` and a non-empty string `content`.
- At least one `user` message is required.
- Limits from `js/shared/admin-ai-contract.mjs`: at most 40 messages, system messages at most 1200 characters, user/assistant messages at most 4000 characters each.
- No model selector is accepted by the validator; the AI Worker uses the fixed Live-Agent model.

Current response shape:
- Successful calls return `text/event-stream; charset=utf-8`.
- The Auth Worker proxies the AI Worker stream directly when the upstream content type is `text/event-stream`.
- Non-stream upstream errors are normalized through the admin AI response helper.
- The route does not persist the response and does not expose a replay response.

Current internal AI Worker route:
- Route: `/internal/ai/live-agent`
- Handler: `workers/ai/src/routes/live-agent.js`
- Auth Worker proxy: `proxyLiveAgentToAiLab` in `workers/auth/src/lib/admin-ai-proxy.js`
- Service auth: HMAC service-auth is verified first in `workers/ai/src/index.js`.
- Caller-policy rule: `workers/ai/src/lib/caller-policy.js` marks `/internal/ai/live-agent` as `required: false` and `baselineAllowed: true`.
- Current caller-policy propagation: the Auth Worker sends baseline-style caller-policy metadata with operation id `admin.live_agent`, but the route remains allowed if caller-policy is missing. Phase 4.11 does not change that.
- Caller-policy stripping: the AI Worker reads and strips `__bitbi_ai_caller_policy` in `workers/ai/src/lib/validate.js` before route validators build provider payloads.

Current provider/model behavior:
- Provider surface: Cloudflare Workers AI binding (`env.AI.run`).
- Model: `@cf/google/gemma-4-26b-a4b-it` from `ADMIN_AI_LIVE_AGENT_MODEL`.
- Provider call shape: one current `env.AI.run(modelId, { messages, stream: true })` call.
- Streaming: yes, the AI Worker returns the provider stream as SSE.
- Tool calls/retrieval/memory: no tool-call, retrieval, external provider, or persisted memory code path is present today.
- Multi-step execution: no multi-step loop is present today, but the route name and streaming shape make future agentic behavior more likely than Admin Compare.
- Output limits: the route has input message limits but no explicit route-level token, output, stream duration, or turn budget enforcement.
- Persistence: no D1/R2 write is performed by the current Live-Agent route.

Current tests:
- Worker tests cover successful streaming response, missing user message rejection, unauthenticated rejection, and empty messages rejection.
- Caller-policy tests cover malformed policy rejection and stripping for other internal routes; Live-Agent is covered by the shared AI Worker caller-policy rule as a baseline-allowed route but is not fail-closed for missing policy.

## Risk Classification

Provider-cost risk: P2.

Reasons:
- A single admin request can hold a streaming provider call open until the model completes or the client disconnects.
- There is no durable request idempotency or duplicate suppression.
- There is no per-request stream-session budget metadata.
- There is no explicit route-level output token or stream duration cap.
- Admin prompts/messages may contain sensitive operator context and should never be stored raw in idempotency, budget, caller-policy, logs, or evidence surfaces.

Privacy and sensitive-data risks:
- Raw `messages[*].content` can include private prompts, credentials accidentally pasted by an operator, internal planning, customer data, or generated model output.
- Future durable metadata must store only counts, lengths, role summary, hashes, model id, budget scope, safe status, and bounded error/result summaries.
- Full stream replay should be considered unsafe by default.

Failure modes:
- Invalid JSON or invalid messages return validation errors before provider execution.
- Missing AI binding or provider failure returns a sanitized error from the AI Worker/proxy path.
- If a future stream succeeds but finalization metadata cannot be written, the attempt must not be marked successfully replayable.
- If the client disconnects during streaming, future enforcement should decide whether the parent attempt is terminal, expired, or retryable without replaying provider output.

## Phase 4.12 Target Enforcement Model

Operation:
- Operation id: `admin.live_agent`
- Budget scope: `platform_admin_lab_budget`
- Owner/domain: `admin-ai`
- Provider family: `ai_worker`
- Model resolver key: `admin.live_agent.model`
- Future kill-switch target: `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`

Idempotency target:
- Require `Idempotency-Key` at the Auth Worker route before any internal AI Worker call.
- Build a stable request fingerprint from safe fields: model resolver key, role sequence, message lengths, message-content hashes, and bounded config fields if any are added later.
- Store only the idempotency key hash and request fingerprint.
- Same key + same request in progress should return a safe in-progress/conflict response without provider execution.
- Same key + same completed request should return metadata-only replay with no stream/result body.
- Same key + different request should conflict before provider execution.
- Missing `admin_ai_usage_attempts` table should fail closed before provider execution if Phase 4.12 uses that table.

Attempt model:
- Current single streaming provider call can use a durable parent attempt in `admin_ai_usage_attempts` if stream lifecycle finalization can be made reliable.
- If future Live-Agent adds tool calls, retrieval, chained prompts, or multiple provider calls, use a parent stream-session attempt plus bounded sub-step metadata. If the existing table cannot represent sub-steps safely, Phase 4.12 should stop and add a separate additive schema design rather than overloading result metadata.
- Store metadata-only result summaries: status, elapsed time bucket, output stream started/completed flags, provider status, safe error code, model id, and optional token counts if available without provider-body storage.

Replay policy:
- Metadata-only by default.
- Do not persist or replay raw streamed output.
- Do not store raw prompts/messages, raw provider request bodies, raw provider response bodies, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, private R2 keys, or raw idempotency keys.

Caller-policy target:
- Auth Worker should propagate signed `__bitbi_ai_caller_policy` with:
  - `operation_id`: `admin.live_agent`
  - `budget_scope`: `platform_admin_lab_budget`
  - `enforcement_status`: `budget_metadata_only` or stronger if Phase 4.12 adds actual budget checks
  - `caller_class`: `admin`
  - `idempotency_policy`: `required`
  - `source_route`: `/api/admin/ai/live-agent`
  - `kill_switch_target`: `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`
- AI Worker should continue service-auth first, then validate supplied caller-policy metadata, then strip it before provider execution.
- `/internal/ai/live-agent` should fail closed for the covered admin caller once Auth Worker propagation is implemented, while unrelated baseline compatibility should be changed only through a targeted caller migration.

Budget/kill-switch target:
- Build the Phase 4.2 admin/platform budget plan before proxying.
- Include `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET` in metadata.
- Prefer metadata-only in the first implementation unless route-specific runtime env enforcement is intentionally added and fully tested.
- Future live platform caps should be separate from this audit and must not be claimed production-ready without staging/live evidence.

Limit targets:
- Preserve current body/message limits.
- Add explicit stream-session targets before provider execution: max messages, max input characters, model id, stream timeout, and max output/token budget where the provider supports it.
- If provider token usage is not available for streams, record that limitation and use conservative duration/output caps.

Failure policy:
- Provider setup failure: mark failed/terminal without success metadata and do not replay.
- Stream starts but terminates with provider error: mark provider failed or terminal according to observable stream state.
- Stream completes but final metadata write fails: do not claim durable success/replay; return the already-streamed response only if the streaming contract requires it and record safe failure where possible.
- Client disconnect: classify explicitly in Phase 4.12 tests; do not re-run provider work automatically for the same key.

Tests required for Phase 4.12:
- Admin-only and production MFA behavior remains covered.
- Missing/malformed `Idempotency-Key` rejected before internal/provider call.
- Same-key/same-request completed and in-progress duplicates do not create another provider stream.
- Same-key/different-request conflicts before provider execution.
- Missing attempts table fails closed before provider execution if durable attempts are required.
- Safe budget metadata includes operation id, budget scope, provider/model, kill-switch target, and plan status.
- Caller-policy metadata is sent to `/internal/ai/live-agent`, malformed metadata rejects, and metadata is stripped before provider payloads.
- No raw messages, prompts, streamed output, provider body, secrets, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, private R2 keys, raw idempotency keys, or request fingerprints are stored or returned.
- Streaming success, provider failure, stream interruption/client disconnect, and finalization failure are deterministic and safe.
- Admin Text/Embeddings/Music/Compare, Admin Video Jobs, OpenClaw/News Pulse, and member image/music/video behavior remain unchanged.

## Phase 4.11 Explicit Non-Changes

- No Admin Live-Agent runtime migration.
- No `Idempotency-Key` requirement added for Admin Live-Agent.
- No durable Admin Live-Agent attempts added.
- No caller-policy behavior change for Live-Agent.
- No budget enforcement for Live-Agent.
- No route behavior change.
- No D1 migration.
- No provider calls.
- No Stripe calls.
- No credit mutation or credit clawback.
- No public billing or pricing change.
- No production/live billing readiness claim.
