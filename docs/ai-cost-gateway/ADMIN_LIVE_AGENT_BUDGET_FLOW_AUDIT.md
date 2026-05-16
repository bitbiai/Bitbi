# Admin Live-Agent Budget Flow Audit

Status: Phase 4.11 completed the audit/design/prep work. Phase 4.12 implements the narrow Admin Live-Agent budget enforcement path only: `POST /api/admin/ai/live-agent` now requires `Idempotency-Key`, creates a durable metadata-only stream-session attempt in `admin_ai_usage_attempts`, propagates signed caller-policy metadata to `/internal/ai/live-agent`, and finalizes observable stream completion/failure without storing raw messages or streamed output. No real provider calls were made by Codex/tests, no Stripe calls were made, no live billing was enabled, and production/live billing remains BLOCKED.

## Current Flow

Current Auth Worker route:
- Route: `POST /api/admin/ai/live-agent`
- Handler: `workers/auth/src/routes/admin-ai.js` inside `handleAdminAI`
- Route policy id: `admin.ai.live-agent`
- Authorization: `requireAdmin` gates all `/api/admin/ai/*` routes before the Live-Agent branch.
- MFA classification: route policy uses `adminJsonWrite`, so production MFA is classified as `admin-production-required`.
- CSRF/body/rate-limit classification: same-origin JSON route, `adminJson` body limit, fail-closed shared limiter scope `admin-ai-liveagent-ip`.
- Runtime limiter in handler: 20 requests per 600 seconds per IP.
- Current idempotency: Phase 4.12 requires `Idempotency-Key`, hashes the key, builds a stable request fingerprint from safe message counts/lengths/content hashes, and creates a metadata-only parent stream-session attempt before proxying to the AI Worker.
- Current budget behavior: Phase 4.12 builds a `platform_admin_lab_budget` plan with operation id `admin.live_agent` and future kill-switch target `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`. It does not debit credits, enforce a runtime env kill switch, or enforce live platform budget caps.

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
- The route does not persist streamed output. Completed duplicate requests return metadata-only replay with `result: null`; in-progress duplicates and same-key/different-request retries return safe conflict responses before provider execution.

Current internal AI Worker route:
- Route: `/internal/ai/live-agent`
- Handler: `workers/ai/src/routes/live-agent.js`
- Auth Worker proxy: `proxyLiveAgentToAiLab` in `workers/auth/src/lib/admin-ai-proxy.js`
- Service auth: HMAC service-auth is verified first in `workers/ai/src/index.js`.
- Caller-policy rule: Phase 4.12 marks `/internal/ai/live-agent` as requiring valid caller-policy metadata after service-auth.
- Current caller-policy propagation: the Auth Worker sends signed `budget_metadata_only` caller-policy metadata with operation id `admin.live_agent`, budget scope `platform_admin_lab_budget`, idempotency policy `required`, and kill-switch target `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`.
- Caller-policy stripping: the AI Worker reads and strips `__bitbi_ai_caller_policy` in `workers/ai/src/lib/validate.js` before route validators build provider payloads.

Current provider/model behavior:
- Provider surface: Cloudflare Workers AI binding (`env.AI.run`).
- Model: `@cf/google/gemma-4-26b-a4b-it` from `ADMIN_AI_LIVE_AGENT_MODEL`.
- Provider call shape: one current `env.AI.run(modelId, { messages, stream: true })` call.
- Streaming: yes, the AI Worker returns the provider stream as SSE.
- Tool calls/retrieval/memory: no tool-call, retrieval, external provider, or persisted memory code path is present today.
- Multi-step execution: no multi-step loop is present today, but the route name and streaming shape make future agentic behavior more likely than Admin Compare.
- Output limits: the route has deterministic input limits. Phase 4.12 records output-token and duration cap targets as unsupported/null metadata because the current streaming Workers AI call does not expose a safe per-route token/duration cap contract.
- Persistence: Phase 4.12 writes metadata-only `admin_ai_usage_attempts` state. It writes no D1/R2 conversation state, no raw messages, no streamed output, and no provider bodies.

Current tests:
- Worker tests cover successful streaming response, missing user message rejection, unauthenticated rejection, empty messages rejection, required idempotency, duplicate suppression, metadata-only replay, same-key conflict, missing table fail-closed behavior, provider setup failure, Live-Agent caller-policy requirement, malformed policy rejection, service-auth ordering, and metadata stripping before provider payload construction.

## Risk Classification

Provider-cost risk: P2.

Reasons:
- A single admin request can hold a streaming provider call open until the model completes or the client disconnects.
- Phase 4.12 adds durable request idempotency and duplicate suppression before provider execution.
- Phase 4.12 records per-request stream-session budget metadata.
- There is still no explicit route-level output token or stream duration cap because the current provider/runtime path does not expose a safe deterministic contract for those values.
- Admin prompts/messages may contain sensitive operator context and should never be stored raw in idempotency, budget, caller-policy, logs, or evidence surfaces.

Privacy and sensitive-data risks:
- Raw `messages[*].content` can include private prompts, credentials accidentally pasted by an operator, internal planning, customer data, or generated model output.
- Future durable metadata must store only counts, lengths, role summary, hashes, model id, budget scope, safe status, and bounded error/result summaries.
- Full stream replay should be considered unsafe by default.

Failure modes:
- Invalid JSON or invalid messages return validation errors before provider execution.
- Missing AI binding or provider failure returns a sanitized error from the AI Worker/proxy path.
- If a stream succeeds but finalization metadata cannot be written, the already-streamed response remains a stream response, but durable metadata must not claim full output replay. Phase 4.12 only stores metadata-only success when finalization write succeeds.
- If the client disconnects during streaming, Phase 4.12 attempts to mark the stream attempt failed/canceled when cancellation is observed. If a stream is never consumed and no cancel/error is observed, bounded cleanup can expire the stale active row later.

## Phase 4.12 Implemented Enforcement Model

Operation:
- Operation id: `admin.live_agent`
- Budget scope: `platform_admin_lab_budget`
- Owner/domain: `admin-ai`
- Provider family: `ai_worker`
- Model resolver key: `admin.live_agent.model`
- Kill-switch metadata target: `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`

Idempotency behavior:
- Require `Idempotency-Key` at the Auth Worker route before any internal AI Worker call.
- Build a stable request fingerprint from safe fields: model resolver key, role sequence, message lengths, message-content hashes, and bounded config fields if any are added later.
- Store only the idempotency key hash and request fingerprint.
- Same key + same request in progress should return a safe in-progress/conflict response without provider execution.
- Same key + same completed request should return metadata-only replay with no stream/result body.
- Same key + different request should conflict before provider execution.
- Missing `admin_ai_usage_attempts` table fails closed before provider execution.

Attempt model:
- The current single streaming provider call uses a durable parent attempt in `admin_ai_usage_attempts`.
- If future Live-Agent adds tool calls, retrieval, chained prompts, or multiple provider calls, use a parent stream-session attempt plus bounded sub-step metadata. If the existing table cannot represent sub-steps safely, a later phase should stop and add a separate additive schema design rather than overloading result metadata.
- Store metadata-only result summaries: status, elapsed time, stream started/completed flags, chunk/byte counts, provider status, safe error code, model id, and optional token counts if available without provider-body storage.

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
- `/internal/ai/live-agent` fails closed when caller-policy metadata is missing or malformed, after service-auth succeeds.

Budget/kill-switch target:
- Build the Phase 4.2 admin/platform budget plan before proxying.
- Include `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET` in metadata.
- Prefer metadata-only in the first implementation unless route-specific runtime env enforcement is intentionally added and fully tested.
- Future live platform caps remain separate from this migration and must not be claimed production-ready without staging/live evidence.

Limit targets:
- Preserve current body/message limits.
- Record stream-session targets before provider execution: max messages, max input characters, model id, max output token target, and max duration target where supported.
- Provider token usage and route-level duration caps are not available safely for the current streaming call, so Phase 4.12 records those cap targets as unsupported/null metadata and keeps input caps enforced.

Failure policy:
- Provider setup failure: mark failed/terminal without success metadata and do not replay.
- Stream starts but terminates with provider error: mark provider failed or terminal according to observable stream state.
- Stream completes but final metadata write fails: do not claim full output replay; return the already-streamed response if the streaming contract has begun and log safe finalization failure.
- Client disconnect: mark failed/canceled when cancellation is observable; do not re-run provider work automatically for the same key.

Phase 4.12 tests cover:
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

## Phase 4.12 Explicit Scope

- No D1 migration.
- No full stream-output replay.
- No raw message, prompt, provider request body, or provider response body storage.
- No runtime env kill-switch enforcement or live platform budget cap.
- No sync video debug migration.
- No unmetered admin image branch migration.
- No Admin Text/Embeddings, Admin Music, Admin Compare, Admin Video Jobs, OpenClaw/News Pulse, member route, org-scoped route, public pricing, credit debit, or billing behavior change.
- No real provider calls by Codex/tests.
- No Stripe calls.
- No credit mutation or credit clawback.
- No public billing or pricing change.
- No production/live billing readiness claim.
