# Admin And Platform AI Budget Policy

Date: 2026-05-16

Status: Phase 4.15 runtime budget kill-switch enforcement on top of the Phase 4.2 contract/helper foundation, Phase 4.3 charged Admin BFL image-test hardening, Phase 4.4 read-only budget evidence reporting, Phase 4.5 admin async video job budget enforcement, Phase 4.6 OpenClaw/News Pulse visual budget controls, Phase 4.7 internal AI Worker caller-policy guard, Phase 4.8 admin text/embeddings budget metadata, Phase 4.8.1 durable idempotency, Phase 4.8.2 admin text/embeddings usage-attempt cleanup/inspection, Phase 4.9 Admin Music budget enforcement, Phase 4.10 Admin Compare budget enforcement, Phase 4.11 Admin Live-Agent audit/design prep, Phase 4.12 Admin Live-Agent budget enforcement, Phase 4.13 Sync Video Debug retirement, and Phase 4.14 Admin Image branch handling. Phase 4.15 adds no migration and enforces runtime budget switches only for already budget-classified admin/platform provider-cost paths: charged Admin Image, explicit-unmetered FLUX.2 Dev, admin async video jobs, News Pulse visuals, admin text, embeddings, music, compare, and live-agent. Missing/false switches block before provider, queue, credit, or durable-attempt work where applicable. This is not live budget cap enforcement and not production readiness. Admin video beyond Phase 4.5, Admin text/embeddings beyond Phase 4.8/4.8.1/4.8.2, Admin Music beyond Phase 4.9, Admin Compare beyond Phase 4.10, Admin Live-Agent beyond Phase 4.12, OpenClaw/News Pulse beyond Phase 4.6, platform/background AI outside News Pulse visuals, and broad internal AI Worker routes remain unmigrated or baseline-allowed. No real provider calls, Stripe calls, live billing enablement, public billing changes, credit mutations, deploys, remote migrations, Cloudflare changes, GitHub settings changes, or runtime route migrations outside this scope were performed.

## Scope

Covered provider-cost classes:

- Admin AI text, image, embeddings, music, compare, live-agent, sync video debug, and async video jobs.
- Charged admin Black Forest Labs image tests that already debit selected organization credits.
- Platform/background AI jobs, including OpenClaw/News Pulse visual generation and scheduled visual backfill.
- Internal AI Worker routes that are service-only and rely on caller-side enforcement.
- Generated music cover/background cover policy when it is discussed outside the member music bundle.

Non-goals:

- No live platform budget cap enforcement and no broad runtime migration beyond the already budget-classified paths protected by Phase 4.15 runtime switches: charged Admin Image, explicit-unmetered FLUX.2 Dev, admin async video jobs, News Pulse visuals, and admin text/embeddings/music/compare/live-agent.
- No broad admin route migration beyond the charged Admin BFL image-test branch, admin async video job path, and admin text/embeddings/music/compare/live-agent routes.
- No D1 schema except additive migrations `0049_add_admin_video_job_budget_metadata.sql` for sanitized job budget metadata, `0050_add_news_pulse_visual_budget_metadata.sql` for sanitized News Pulse visual budget metadata, and `0051_add_admin_ai_usage_attempts.sql` for admin text/embeddings/music/compare/live-agent idempotency attempts. Phase 4.7, Phase 4.8, Phase 4.8.2, Phase 4.9, Phase 4.10, Phase 4.11, and Phase 4.12 add no migration; Phase 4.8.1 adds `0051`.
- No Admin UI.
- No provider, Stripe, Cloudflare, GitHub, DNS, WAF, secret, deployment, remote migration, or live-billing action.

## Phase 4.4 Evidence Collector

Phase 4.4 adds `workers/auth/src/lib/admin-platform-budget-evidence.js`, `scripts/report-ai-budget-evidence.mjs`, `npm run test:admin-platform-budget-evidence`, `npm run report:ai-budget-evidence`, and `GET /api/admin/ai/budget-evidence`.

The report is read-only and bounded. It returns a blocked verdict while known admin/platform/internal/OpenClaw gaps remain, groups evidence by `admin_org_credit_account`, `platform_admin_lab_budget`, `platform_background_budget`, `openclaw_news_pulse_budget`, `internal_ai_worker_caller_enforced`, `explicit_unmetered_admin`, and `external_provider_only`, and includes sanitized evidence for:

- member image, music, and video as migrated member AI Cost Gateway routes
- charged Admin BFL image-test as implemented/hardened with `admin_org_credit_account` metadata
- admin async video jobs as Phase 4.5 `platform_admin_lab_budget` job/queue metadata coverage
- OpenClaw/News Pulse visual generation as Phase 4.6 `openclaw_news_pulse_budget` visual metadata and duplicate-suppression coverage
- Phase 4.7 internal AI Worker caller-policy guard coverage for async video task create/poll, including the reserved signed JSON body key transport
- admin text/embeddings/music/compare as `platform_admin_lab_budget` metadata-only coverage with required `Idempotency-Key`, durable duplicate suppression/conflict detection, and signed caller-policy propagation
- Phase 4.8.2 admin AI usage-attempt operations as bounded, non-destructive cleanup plus admin-only sanitized list/detail inspection
- Admin live-agent as Phase 4.12 metadata-only stream-session coverage with required idempotency and caller-policy propagation
- Sync video debug as Phase 4.13 retired/disabled-by-default evidence
- Admin Image branches as Phase 4.14 classified evidence: charged priced models covered, FLUX.2 Dev explicit-unmetered metadata, and unclassified models blocked before AI Worker/provider execution; platform/background AI outside News Pulse visuals and baseline-allowed internal AI Worker routes beyond covered caller paths remain baselined gaps
- Runtime budget switch evidence as Phase 4.15 coverage: boolean configured/enabled state only, no secret values, default-disabled semantics, and no live cap claim

The report does not include raw prompts, provider request bodies, cookies, tokens, secrets, private keys, Stripe data, or raw R2 keys. The endpoint is admin-only, production-MFA-classified through route-policy, fail-closed rate limited, and returns the same sanitized local evidence. It performs no provider calls and no billing, credit, D1, R2, Stripe, Cloudflare, GitHub, DNS, WAF, secret, deployment, or remediation mutation.

## Phase 4.5 Admin Async Video Jobs

Phase 4.5 migrates exactly one remaining admin/platform provider-cost path: admin async video jobs. The route remains admin-only with production MFA classification through route policy, same-origin mutation protection, fail-closed rate limiting, and required `Idempotency-Key`.

Runtime behavior changed only for admin async video jobs:

- `POST /api/admin/ai/video-jobs` builds a Phase 4.2 budget plan before inserting or queueing a new job.
- The job row stores sanitized `budget_policy_json`, `budget_policy_status`, `budget_policy_fingerprint`, and `budget_policy_version`.
- The queue message includes only bounded budget summary fields: operation id, budget scope, plan status, kill-switch target, no live budget enforcement marker, no credit debit marker, and fingerprint.
- The auth Worker queue consumer verifies valid job budget metadata before calling `/internal/ai/video-task/create` or `/internal/ai/video-task/poll`.
- Duplicate same-key same-body requests return the existing job without queueing again; same-key different-body requests conflict before queueing.
- Duplicate queue delivery does not create a second provider task after a provider task id is recorded.
- If task creation was already attempted but no provider task id was recorded, a later retry fails closed with safe operator-review state instead of making another provider create call.

The kill-switch target is `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`; Phase 4.15 enforces it before job row creation and queueing. Live platform budget caps remain future work. Phase 4.7 keeps service-auth as the first AI Worker gate and adds caller-policy validation for the internal video task create/poll routes. No member image/music/video billing behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, or Admin UI changed.

## Phase 4.6 OpenClaw/News Pulse Visuals

Phase 4.6 migrates exactly one platform/background provider-cost domain: OpenClaw/News Pulse visual generation. Signed OpenClaw ingest and public News Pulse read routes keep their existing auth/read behavior; only the visual generation/backfill helper records and validates budget metadata before provider-cost thumbnail generation.

Runtime behavior changed only for News Pulse generated thumbnails:

- Ingest-triggered waitUntil visual backfill uses operation id `platform.news_pulse.visual.ingest`; scheduled visual backfill uses `platform.news_pulse.visual.scheduled`.
- Visual generation builds a Phase 4.2 budget plan with budget scope `openclaw_news_pulse_budget` before `env.AI.run`.
- The `news_pulse_items` row stores sanitized `visual_budget_policy_json`, `visual_budget_policy_status`, `visual_budget_policy_fingerprint`, and `visual_budget_policy_version`.
- Invalid budget policy config blocks provider execution and records safe failure metadata.
- Existing status/attempt guards still suppress provider calls when a visual is already ready, pending/in progress, exhausted, or outside retry policy.
- Provider failure and storage failure do not mark the visual ready; public News Pulse reads continue to fall back safely without exposing internal R2 keys.
- The kill-switch target is `ENABLE_NEWS_PULSE_VISUAL_BUDGET`; Phase 4.15 enforces it before provider visual generation/backfill. Public News Pulse reads remain unaffected, existing ready visuals are not deleted, and live budget caps remain future work.

Phase 4.6 does not change member image/music/video, org-scoped member image/text, public pricing, Stripe behavior, credit debit behavior, Admin UI, public News Pulse response shape, OpenClaw signed ingest authorization, Admin video beyond Phase 4.5, or internal AI Worker service-auth semantics.

## Phase 4.7 Internal AI Worker Caller-Policy Guard

Phase 4.7 adds a narrow metadata guard for internal Auth Worker -> AI Worker provider-cost calls. The chosen transport is a reserved JSON body key, `__bitbi_ai_caller_policy`, inside the already service-auth-signed request body. The AI Worker validates service-auth first, then validates caller-policy metadata, then strips the reserved key through the shared internal JSON parser before route validators and provider payload construction. Dedicated headers were avoided so the existing body hash covers the metadata without weakening service-auth.

Implemented behavior:

- `workers/shared/ai-caller-policy.mjs` defines the caller-policy version, allowed enforcement statuses, budget scopes, caller classes, sanitization, validation, and audit summary helpers.
- Auth Worker proxy calls can attach safe caller-policy metadata without changing user-visible request or response shapes.
- The charged Admin BFL image-test path propagates `budget_policy_enforced` metadata for `admin.image.test.charged`.
- Admin async video task create/poll propagates `caller_enforced` metadata tied to the Phase 4.5 job budget fingerprint and kill-switch target `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`.
- Member music lyrics/audio internal AI calls propagate `gateway_enforced` metadata for compatibility with the migrated member music gateway; this does not change member billing or debit behavior.
- The AI Worker rejects missing or malformed caller-policy metadata for `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`.
- Known broad internal routes (`test-image`, `test-music`, `test-video`, and compare) still allow missing policy only as explicit `baseline_allowed` gaps for compatibility callers; admin text/embeddings now supply Phase 4.8.1 policy metadata, admin music supplies Phase 4.9 metadata, admin compare supplies Phase 4.10 metadata, and Admin Live-Agent supplies Phase 4.12 metadata. The Auth Worker sync video debug caller is retired/disabled-by-default by Phase 4.13, and `/internal/ai/live-agent` now requires valid caller-policy metadata after service-auth. Malformed supplied metadata is rejected.

Limits:

- Phase 4.7 does not migrate broad Admin AI, Admin music/text/compare/live-agent, sync video debug, OpenClaw/News Pulse beyond Phase 4.6 compatibility, or platform/background AI globally. Phase 4.8/4.8.1 narrow that by covering only admin text/embeddings, Phase 4.9 narrows it further only for admin music, Phase 4.10 narrows it further only for Admin Compare, Phase 4.12 covers only Admin Live-Agent, and Phase 4.13 retires the Auth Worker sync video debug caller as disabled-by-default. Unmetered admin image, OpenClaw/News Pulse beyond Phase 4.6, and platform/background AI remain unmigrated.
- News Pulse visuals do not call the AI Worker in this flow; they remain direct Auth Worker provider calls covered by Phase 4.6 caller-side budget metadata.
- No new D1 migration, credit debit change, credit clawback, Stripe call, real provider call in tests, live billing enablement, or production readiness claim is introduced.

## Phase 4.8 Admin Text / Embeddings

Phase 4.8 migrates exactly one narrow broad-Admin-AI provider-cost area: admin text and embeddings test routes. The routes remain admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for admin text/embeddings:

- `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings` now require a valid `Idempotency-Key` before proxying to the AI Worker.
- Each route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget`.
- Admin responses include sanitized `budget_policy` and `caller_policy` summaries. They include operation id, budget scope, provider family/model, plan status, runtime switch target, safe fingerprint, and a hash of the idempotency key only.
- The Auth Worker propagates safe caller-policy metadata under `__bitbi_ai_caller_policy` with `budget_metadata_only` status before service-auth body signing.
- The AI Worker validates supplied caller-policy metadata after service-auth and strips the reserved key before provider payload construction.
- Future kill-switch targets are recorded as `ENABLE_ADMIN_AI_TEXT_BUDGET` and `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`; Phase 4.8 does not enforce new runtime env flags or live platform budget caps.
- Phase 4.8.1 adds `admin_ai_usage_attempts` durable metadata-only attempts before provider calls. Same-key/same-request pending, completed, or failed attempts do not make another provider call; same-key/different-request retries return conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; generated text and embedding vectors are intentionally not persisted or replayed.
- Phase 4.8.2 adds `GET /api/admin/ai/admin-usage-attempts`, `GET /api/admin/ai/admin-usage-attempts/:id`, and `POST /api/admin/ai/admin-usage-attempts/cleanup-expired`. These endpoints return sanitized fields only and the cleanup path is bounded, dry-run by default, non-destructive, same-origin protected, admin/MFA-classified, fail-closed rate limited, and audited.

Phase 4.8.2 does not change Admin music, Admin video beyond Phase 4.5, Admin compare, Admin live-agent, OpenClaw/News Pulse beyond Phase 4.6, platform/background AI, unrelated internal AI Worker routes, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, provider behavior, billing behavior, or live billing readiness.

## Phase 4.13 Sync Video Debug Retirement

Phase 4.13 audits `POST /api/admin/ai/test-video` and chooses Path A: retire the synchronous Admin Video Debug route from normal provider-cost operations and keep it disabled by default.

Current behavior remains intentionally narrow:

- Disabled requests return before body parsing, rate limiting, AI Worker calls, queue calls, provider calls, credit mutation, or billing mutation.
- `ALLOW_SYNC_VIDEO_DEBUG=true` is retained only for emergency/debug compatibility with the existing admin, same-origin, production-MFA-classified, fail-closed-limiter controls.
- Emergency compatibility execution is not a supported budgeted path and does not get new durable idempotency or budget enforcement in this phase.
- `POST /api/admin/ai/video-jobs` remains the supported budgeted admin video path from Phase 4.5.
- `check:ai-cost-policy` and the budget evidence report now classify sync video debug as retired/disabled-by-default rather than a normal unresolved provider-cost migration.

Phase 4.13 does not change Admin Async Video Job behavior, Admin Text/Embeddings/Music/Compare/Live-Agent behavior, unmetered Admin Image behavior, OpenClaw/News Pulse behavior, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, provider behavior, billing behavior, or live billing readiness. No real provider calls, Stripe calls, live billing enablement, deploys, remote migrations, Cloudflare changes, GitHub settings changes, DNS/WAF changes, or secret changes were performed.

## Phase 4.14 Admin Image Branch Handling

Phase 4.14 handles only the remaining non-BFL/non-priced Admin Image branch ambiguity in `POST /api/admin/ai/test-image`.

Runtime behavior changed only for Admin Image branch classification:

- Charged priced Admin Image models keep the existing selected-organization `admin_org_credit_account` path from Phase 4.3, including required `organization_id`, required `Idempotency-Key`, org credit check/debit, provider-failure no-charge behavior, exactly-once debit behavior, and safe budget/caller metadata.
- `@cf/black-forest-labs/flux-2-dev` remains available only as an intentional `explicit_unmetered_admin` admin lab exception. It emits sanitized `budget_policy` and `caller_policy` metadata, uses runtime switch target `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS`, does not debit credits, does not add durable idempotency/replay, and does not store raw prompts or provider bodies in metadata.
- Unknown or unclassified Admin Image models are blocked before AI Worker/provider execution. They do not debit credits, enqueue work, call Stripe, or call real providers.
- Caller-policy metadata is propagated only for Admin Image branches that still call the AI Worker; blocked branches make no AI Worker call. The AI Worker continues to strip `__bitbi_ai_caller_policy` before provider payload construction.

Phase 4.14 does not change Admin Text/Embeddings/Music/Compare/Live-Agent, Admin async video jobs, sync video debug, OpenClaw/News Pulse, member image/music/video, org-scoped member image/text, public pricing, Stripe behavior, live billing, credit clawbacks, or broad internal AI Worker route behavior. Production/live billing remains BLOCKED.

## Phase 4.15 Runtime Budget Kill-Switch Enforcement

Phase 4.15 turns prior metadata-only kill-switch targets into runtime guards for already budget-classified admin/platform provider-cost paths only. The shared helper accepts `1`, `true`, `yes`, and `on` as enabled values; absent, empty, `0`, `false`, `no`, `off`, and unrecognized values are disabled. Disabled admin routes return `admin_ai_budget_disabled` before provider/proxy/queue/credit/durable-attempt work. Disabled News Pulse visual generation records a safe `skipped_by_budget_switch` status before provider execution while public News Pulse reads remain unaffected.

Switch-enforced targets:

- `ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET` and `ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET` for charged Admin Image tests before provider calls and selected-organization credit debits.
- `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS` for the explicit-unmetered FLUX.2 Dev admin image branch.
- `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET` before admin async video job row creation and queueing.
- `ENABLE_NEWS_PULSE_VISUAL_BUDGET` before OpenClaw/News Pulse visual provider generation/backfill.
- `ENABLE_ADMIN_AI_TEXT_BUDGET`, `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`, `ENABLE_ADMIN_AI_MUSIC_BUDGET`, `ENABLE_ADMIN_AI_COMPARE_BUDGET`, and `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET` before their internal AI Worker/provider calls and before durable admin AI usage attempts are created.

Phase 4.15 does not add live daily/monthly budget caps, migrate new provider-cost routes, mutate credits, add credit clawbacks, call real providers in tests, call Stripe, deploy, run remote migrations, change member image/music/video behavior, change org-scoped member image/text behavior, change public pricing, or enable live billing. Operators must intentionally configure these flags before using the corresponding admin/platform provider-cost paths. Production/live billing remains BLOCKED.

## Phase 4.9 Admin Music

Phase 4.9 migrates exactly one narrow admin provider-cost route: `POST /api/admin/ai/test-music`. The route remains admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for Admin Music test generation:

- `POST /api/admin/ai/test-music` now requires a valid `Idempotency-Key` before proxying to the AI Worker.
- The route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget` before provider-cost work.
- The route records sanitized `budget_policy` and `caller_policy` summaries with operation id `admin.music.test`, provider family/model, plan status, runtime switch target `ENABLE_ADMIN_AI_MUSIC_BUDGET`, safe fingerprint, and only a hash of the idempotency key.
- The Auth Worker creates a durable `admin_ai_usage_attempts` row before the internal AI call. Same-key/same-request pending, completed, or failed attempts do not make another provider call; same-key/different-request retries conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; raw prompts, lyrics, audio bytes/URLs, and provider response bodies are not stored or replayed.
- The Auth Worker propagates `budget_metadata_only` caller-policy metadata under `__bitbi_ai_caller_policy`; the AI Worker validates supplied metadata after service-auth and strips the reserved key before provider payload construction.
- Phase 4.15 enforces `ENABLE_ADMIN_AI_MUSIC_BUDGET` before durable attempt creation or provider work. Live platform budget caps remain future work.

Phase 4.9 adds no migration and does not change Admin Compare, Admin Live-Agent, sync video debug, Admin Video beyond Phase 4.5, Admin Text/Embeddings beyond Phase 4.8/4.8.1/4.8.2, unmetered admin image branches beyond Phase 4.3 charged BFL behavior, OpenClaw/News Pulse beyond Phase 4.6, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, provider behavior outside this route, billing behavior, or live billing readiness.

## Phase 4.10 Admin Compare

Phase 4.10 migrates exactly one narrow admin provider-cost route: `POST /api/admin/ai/compare`. The route remains admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for Admin Compare:

- `POST /api/admin/ai/compare` now requires a valid `Idempotency-Key` before proxying to the AI Worker.
- The route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget` before multi-model provider fanout.
- The route records sanitized `budget_policy` and `caller_policy` summaries with operation id `admin.compare`, model summary `admin.compare.multi_model`, runtime switch target `ENABLE_ADMIN_AI_COMPARE_BUDGET`, safe fingerprint, and only a hash of the idempotency key.
- The Auth Worker creates a durable `admin_ai_usage_attempts` row before the internal AI call. Same-key/same-request pending, completed, or failed attempts do not make another provider fanout; same-key/different-request retries conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; raw prompts, provider request bodies, compare outputs, and provider response bodies are not stored or replayed.
- The Auth Worker propagates `budget_metadata_only` caller-policy metadata under `__bitbi_ai_caller_policy`; the AI Worker validates supplied metadata after service-auth and strips the reserved key before provider payload construction.
- Phase 4.15 enforces `ENABLE_ADMIN_AI_COMPARE_BUDGET` before durable attempt creation or provider fanout. Live platform budget caps remain future work.

Phase 4.10 adds no migration and does not change Admin Live-Agent, sync video debug, Admin Video beyond Phase 4.5, Admin Text/Embeddings beyond Phase 4.8/4.8.1/4.8.2, Admin Music beyond Phase 4.9, unmetered admin image branches beyond Phase 4.3 charged BFL behavior, OpenClaw/News Pulse beyond Phase 4.6, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, billing behavior, or live billing readiness.

## Phase 4.11 Admin Live-Agent Audit

Phase 4.11 was audit/design/prep only for Admin Live-Agent. It did not migrate `POST /api/admin/ai/live-agent`, require `Idempotency-Key`, add durable `admin_ai_usage_attempts` rows for Live-Agent, change caller-policy behavior, or enforce a platform budget.

Current Live-Agent findings:

- Auth route: `POST /api/admin/ai/live-agent` in `workers/auth/src/routes/admin-ai.js`, admin-only through `requireAdmin`, production-MFA-classified through route policy, same-origin JSON write route, fail-closed rate limited, and currently no request idempotency requirement.
- Internal route: `/internal/ai/live-agent` through `proxyLiveAgentToAiLab`, service-auth verified first by the AI Worker.
- Caller-policy state at Phase 4.11: Auth sent baseline-style metadata when available, but `/internal/ai/live-agent` remained `baseline_allowed` if policy was missing. The AI Worker stripped `__bitbi_ai_caller_policy` before provider payload construction. Phase 4.12 supersedes this for the Live-Agent route by requiring valid caller-policy metadata after service-auth.
- Provider behavior: one current streaming Workers AI call to `@cf/google/gemma-4-26b-a4b-it` with `{ messages, stream: true }`; no tool loop, retrieval, persisted memory, D1/R2 state, or multi-step execution exists today.
- Request limits: up to 40 messages, at least one user message, system messages up to 1200 characters, user/assistant messages up to 4000 characters; there is no route-level output token or stream-duration budget cap.

Phase 4.12 target design:

- Budget scope `platform_admin_lab_budget`, operation id `admin.live_agent`, and runtime switch target `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`.
- Require request-level `Idempotency-Key` before internal provider work.
- Use a durable parent stream-session attempt for the current single-call flow; add parent plus sub-step metadata only if Live-Agent becomes multi-call/tool-like.
- Replay policy should remain metadata-only unless full replay is proven safe; raw messages, prompts, streamed output, provider bodies, secrets, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, raw idempotency keys, and private R2 keys must not be stored or returned.
- Propagate signed caller-policy metadata to `/internal/ai/live-agent` and make the covered admin caller fail closed only after the Auth Worker supplies valid policy.
- Add explicit timeout/turn/token or duration limits where provider/runtime support makes them deterministic.

See `docs/ai-cost-gateway/ADMIN_LIVE_AGENT_BUDGET_FLOW_AUDIT.md` for the full current-flow audit, risk classification, target enforcement model, replay policy, failure policy, and Phase 4.12 test plan. Admin Compare remains covered by Phase 4.10, Admin Music by Phase 4.9, Admin Text/Embeddings by Phase 4.8/4.8.1/4.8.2, Admin Video Jobs by Phase 4.5, OpenClaw/News Pulse visuals by Phase 4.6, and member image/music/video behavior is unchanged. Production/live billing remains BLOCKED.

## Phase 4.12 Admin Live-Agent

Phase 4.12 migrates exactly one narrow admin provider-cost route: `POST /api/admin/ai/live-agent`. The route remains admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for Admin Live-Agent:

- `POST /api/admin/ai/live-agent` now requires a valid `Idempotency-Key` before proxying to the AI Worker.
- The route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget`, operation id `admin.live_agent`, fixed model `@cf/google/gemma-4-26b-a4b-it`, and runtime switch target `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`.
- The Auth Worker creates a durable metadata-only `admin_ai_usage_attempts` stream-session row before the internal AI call. Same-key/same-request pending, running, completed, or failed attempts do not start another provider stream; same-key/different-request retries conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; raw messages, streamed output, provider request bodies, and provider response bodies are not stored or replayed.
- The Auth Worker propagates `budget_metadata_only` caller-policy metadata under `__bitbi_ai_caller_policy`; the AI Worker validates supplied metadata after service-auth, now requires it for `/internal/ai/live-agent`, and strips the reserved key before provider payload construction.
- Stream finalization marks success after the returned SSE stream is consumed to completion. Provider setup failure and observable stream errors/cancelation are marked failed with safe metadata. If a stream is never consumed and no cancel/error is observed, bounded cleanup can expire the stale active row later.
- Existing input caps remain enforced: at most 40 messages, at least one user message, system messages up to 1200 characters, and user/assistant messages up to 4000 characters. Output-token and stream-duration caps are recorded as unsupported/null targets because the current streaming Workers AI path does not expose a safe route-level cap contract.

Phase 4.12 adds no migration and does not add full stream replay, live platform budget caps, credit debit behavior, credit clawback behavior, public billing/pricing changes, Admin UI, sync video debug migration, unmetered admin image branch migration, Admin Video changes beyond Phase 4.5, Admin Text/Embeddings changes beyond Phase 4.8/4.8.1/4.8.2, Admin Music changes beyond Phase 4.9, Admin Compare changes beyond Phase 4.10, OpenClaw/News Pulse changes beyond Phase 4.6, platform/background AI migration, unrelated internal AI Worker migration, member image/music/video changes, org-scoped route changes, Stripe calls, real provider calls in tests, deploys, remote migrations, or live billing readiness. Phase 4.15 separately enforces the Live-Agent switch before stream attempts/provider setup.

## Phase 4.2 Helper Contract

`workers/auth/src/lib/admin-platform-budget-policy.js` is the reusable target contract for admin/platform AI budget migrations. It remains pure. Phase 4.3 imports it only from the charged Admin image-test branch to build safe plan/audit metadata; the helper still does not call D1, R2, providers, Stripe, Cloudflare APIs, network fetch, or live environment variables.

Exports:

- `ADMIN_PLATFORM_BUDGET_POLICY_VERSION`
- budget scope constants matching the taxonomy below
- budget action/status constants
- `AdminPlatformBudgetPolicyError`
- `normalizeAdminPlatformBudgetOperation(input)`
- `buildAdminPlatformBudgetFingerprint(input)`
- `buildAdminPlatformBudgetAuditFields(input)`
- `classifyAdminPlatformBudgetPlan(input)`
- `validateAdminPlatformKillSwitchConfig(input)`

The helper validates budget scope, actor/domain ownership, provider-cost idempotency targets, kill-switch metadata, explicit unmetered-admin justification, and caller-enforced exemptions. It builds deterministic fingerprints with sensitive fields omitted and prompt-like fields hashed inside the fingerprint payload. It builds allowlisted audit fields only and never includes raw prompts, lyrics, provider request bodies, cookies, auth headers, tokens, Stripe data, Cloudflare tokens, or private R2 keys.

Plan statuses are target planning states only: `ready_for_budget_check`, `requires_kill_switch`, `blocked_by_policy`, `caller_enforced`, `explicit_unmetered`, `platform_budget_review`, `admin_org_credit_required`, and `invalid_config`. A later runtime phase must still add route-level auth, MFA, CSRF, rate limits, body limits, D1 state, queue safety, provider-call suppression, and budget finalization before any provider-cost route is considered migrated.

## Budget Scope Taxonomy

| Scope | Spend owner | Credits debited | Admin-visible budget required | Kill switch required | Idempotency target | Replay target | Operator review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `member_credit_account` | Member | Yes | No | Yes | Mandatory | Expected | No |
| `organization_credit_account` | Organization | Yes | No | Yes | Mandatory | Expected | No |
| `admin_org_credit_account` | Selected organization for admin-initiated paid tests | Yes | Yes | Yes | Mandatory | Metadata replay at minimum | Yes |
| `platform_admin_lab_budget` | Platform admin lab / internal testing budget | No member credits | Yes | Yes | Mandatory unless an explicit unmetered exception is recorded | Operation-dependent | Yes |
| `platform_background_budget` | Platform background jobs | No member credits | Yes | Yes | Deterministic job key | Durable result/status replay | Yes |
| `openclaw_news_pulse_budget` | OpenClaw / News Pulse platform budget | No member credits | Yes | Yes | Deterministic item/job key | Durable thumbnail/status replay | Yes |
| `internal_ai_worker_caller_enforced` | Caller route or queue job | Delegated | Yes at caller | Service route delegates to caller | Delegated to caller | Delegated to caller | Yes |
| `explicit_unmetered_admin` | Explicit temporary admin exception | No | Yes | Yes | Optional only with documented exception | Usually disabled | Yes |
| `external_provider_only` | External provider / not billed by BITBI | No | Usually no | Yes | Caller-dependent | Caller-dependent | Yes if BITBI initiates calls |

Policy rule: new provider-cost routes must use one of these scopes in the operation registry and either be gateway-enforced or be explicitly listed in `config/ai-cost-policy-baseline.json` with a temporary allowance reason, kill-switch target or exemption, future enforcement path, severity, and owner/domain.

## Flow Policy Matrix

| Flow class | Budget owner | Current cost behavior | Current idempotency | Target behavior | Failure/replay policy | Limits and kill switch | Future tests | Rollout phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin text test | `platform_admin_lab_budget` | Phase 4.8.1 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; Phase 4.8.2 adds bounded cleanup and admin-only sanitized inspection; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Phase 4.15 enforces `ENABLE_ADMIN_AI_TEXT_BUDGET` before durable attempts or provider execution; live platform budget caps remain future. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no generated text; cleanup marks only expired active attempts and does not delete rows. | Runtime switch `ENABLE_ADMIN_AI_TEXT_BUDGET`; no live cap. | Missing/malformed key, disabled switch, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, sanitized list/detail, dry-run cleanup, scheduled cleanup. | Phase 4.15 completed for runtime switch enforcement. |
| Charged admin BFL/priced image tests | `admin_org_credit_account` | Existing selected-org credit debit for priced Admin Image tests. | Required. | Phase 4.15 enforces model-specific runtime switches before provider calls or credit debits while preserving Phase 4.3/4.14 budget metadata and branch classification. | No charge on provider failure; metadata-only replay remains acceptable until full output replay is designed. | `ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET` for BFL and `ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET` for GPT Image 2; no live cap. | Existing charge tests plus disabled-switch/no-debit tests, policy metadata, and no unmetered fallback. | Phase 4.15 completed for runtime switch enforcement. |
| Explicit unmetered admin image branch | `explicit_unmetered_admin` | FLUX.2 Dev admin-only provider call, no debit. | Optional by documented exception. | Phase 4.15 enforces `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS` before provider execution while preserving the Phase 4.14 explicit-unmetered classification. | No credit debit; replay remains disabled and metadata-only. | Runtime switch `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS`; no live cap. | Explicit-unmetered metadata, disabled-switch/no-provider test, caller-policy stripping, and no raw prompt/provider body in metadata. | Phase 4.15 completed for runtime switch enforcement. |
| Unsupported/unclassified admin image branch | none | Unknown or unclassified Admin Image model. | Not applicable. | Phase 4.14 blocks before AI Worker/provider execution. | No credit debit, no provider call, no replay. | Classification guard in `admin-ai-image-credit-pricing.js`. | Unsupported model returns safe error before provider/AI Worker/credit work. | Phase 4.14 completed for blocked guard. |
| Admin embeddings | `platform_admin_lab_budget` | Phase 4.8.1 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; Phase 4.8.2 adds bounded cleanup and admin-only sanitized inspection; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Phase 4.15 enforces `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET` before durable attempts or provider execution; live platform budget caps remain future. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no raw input or embedding vectors; cleanup marks only expired active attempts and does not delete rows. | Runtime switch `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`; no live cap. | Missing/malformed key, disabled switch, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, sanitized list/detail, dry-run cleanup, scheduled cleanup. | Phase 4.15 completed for runtime switch enforcement. |
| Admin music test | `platform_admin_lab_budget` | Phase 4.9 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Phase 4.15 enforces `ENABLE_ADMIN_AI_MUSIC_BUDGET` before durable attempts or provider execution; live platform budget caps remain future. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no audio, lyrics, prompts, or provider body; cleanup marks only expired active attempts and does not delete rows. | Runtime switch `ENABLE_ADMIN_AI_MUSIC_BUDGET`; no live cap. | Missing/malformed key, disabled switch, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, no audio/lyrics/provider body storage. | Phase 4.15 completed for runtime switch enforcement. |
| Admin compare | `platform_admin_lab_budget` | Phase 4.10 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts before multi-model fanout; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Phase 4.15 enforces `ENABLE_ADMIN_AI_COMPARE_BUDGET` before durable attempts or provider fanout; live platform budget caps remain future. | Partial model failure can still return successful compare output when at least one model succeeds; all-model provider failure marks the attempt failed. Completed duplicate replay is metadata-only with no compare results. | Runtime switch `ENABLE_ADMIN_AI_COMPARE_BUDGET`; no live cap. | Missing/malformed key, disabled switch, conflict, in-progress duplicate, provider failure terminal retry, partial success metadata, caller-policy stripping, no prompt/result/provider body storage. | Phase 4.15 completed for runtime switch enforcement. |
| Admin live-agent | `platform_admin_lab_budget` | Phase 4.12 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only stream-session attempts before the streaming provider call; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate stream suppression through `admin_ai_usage_attempts`. | Phase 4.15 enforces `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET` before durable stream-session attempts or provider stream setup; live platform caps and explicit output-token/duration caps remain future. | Completed duplicate replay is metadata-only with no raw messages or streamed output; observable stream completion marks success, observable setup/stream errors mark failure, and unobserved stale active rows rely on bounded cleanup. | Runtime switch `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`; no live cap. | Missing/malformed key, disabled switch, conflict, in-progress duplicate, provider setup failure, stream finalization, caller-policy stripping, no message/output/provider body storage. | Phase 4.15 completed for runtime switch enforcement. |
| Admin sync video debug | `platform_admin_lab_budget` | Phase 4.13 retired/disabled-by-default debug path. Emergency compatibility execution remains behind `ALLOW_SYNC_VIDEO_DEBUG=true` only and is not a normal supported provider-cost route. | Not required while disabled. | Use async admin video jobs for supported budgeted video generation; if sync debug is ever retained as normal behavior, add required idempotency, durable budget metadata, and explicit budget controls first. | No replay; disabled path performs no provider, queue, credit, or billing work. | `ALLOW_SYNC_VIDEO_DEBUG` emergency compatibility flag only. | Disabled default returns before AI Worker/provider work; evidence/check output classifies route as retired. | Phase 4.13 retired/disabled-by-default. |
| Admin async video jobs | `platform_admin_lab_budget` with internal caller-enforced subroutes | Phase 4.5 stores sanitized job/queue budget metadata before provider-cost processing; no credits are debited. | Job create requires `Idempotency-Key`; internal tasks inherit the job budget state. | Phase 4.15 enforces `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET` before job row creation or queueing; live budget caps remain future. | Polling is tied to persisted task id; output/poster success is preserved; output persistence failure does not mark budget state successful. | Runtime switch `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`; no live cap. | Missing/invalid metadata, disabled switch, duplicate delivery, response-loss retry suppression, provider/output failures, sanitized telemetry. | Phase 4.15 completed for runtime switch enforcement. |
| News Pulse/OpenClaw visuals | `openclaw_news_pulse_budget` | Phase 4.6 records safe visual budget metadata before provider calls and preserves status/attempt duplicate suppression; no credits are debited. | HMAC ingest nonce plus deterministic item/content hash and visual status/attempt guards. | Phase 4.15 enforces `ENABLE_NEWS_PULSE_VISUAL_BUDGET` before provider visual generation/backfill; live platform budget caps remain future. | Ready thumbnail is durable replay; failed rows retry only within attempt cap and budget-policy validity; disabled-switch rows are skipped and not marked ready. | Runtime switch `ENABLE_NEWS_PULSE_VISUAL_BUDGET`; no live cap. | Invalid policy, disabled switch, ready/pending duplicate suppression, provider/storage failure, sanitized telemetry. | Phase 4.15 completed for runtime switch enforcement. |
| Scheduled/backfill visual jobs | `openclaw_news_pulse_budget` | Phase 4.6 records safe scheduled visual budget metadata before provider calls and respects existing bounded batch/status/attempt guards. | Deterministic item/content hash plus status/attempt caps. | Phase 4.15 enforces `ENABLE_NEWS_PULSE_VISUAL_BUDGET` before scheduled/backfill provider calls; live scheduled budget windows remain future. | Existing ready thumbnails prevent regeneration; failed rows are bounded by attempt caps. | Runtime switch `ENABLE_NEWS_PULSE_VISUAL_BUDGET`; no live cap. | Scheduled metadata, disabled switch, ready/pending duplicate suppression, no provider on invalid policy. | Phase 4.15 completed for runtime switch enforcement. |
| Generated music cover/background cover | `member_credit_account` today; `platform_background_budget` only if future policy changes | Phase 3.7 includes cover in parent member music bundle. | Parent member music idempotency. | Keep inside parent member music bundle unless product explicitly changes it; if split, use platform/background or member sub-budget with separate evidence. | Cover failure after audio success must not double debit. | Parent music caps today. | Preserve no separate charge and safe cover status. | No Phase 4.2 runtime work. |
| Internal AI Worker routes | `internal_ai_worker_caller_enforced` | Service-only routes call providers and rely on auth-worker callers. Phase 4.7 validates signed caller-policy metadata, requires it for async video task create/poll, and Phase 4.8.1 supplies metadata for admin text/embeddings while keeping broader shared routes baseline-allowed for other callers. | Inherited/delegated; video task create/poll require caller-policy metadata; admin text/embeddings supply metadata but the shared route still allows known baseline callers. | Internal routes remain service-only; covered callers pass operation id/budget metadata before internal worker executes provider work. | Replay/failure policy belongs to caller; internal route returns safe provider result/status only. | Service binding only, caller kill switch metadata, no public exposure. | Service-auth-first rejection, malformed policy rejection, metadata stripping before provider payloads. | Phase 4.7 guard completed; Phase 4.8.1 added admin text/embeddings caller metadata and caller-side durable idempotency; remaining callers future. |
| Derivative/backfill flows | Not AI provider-cost today unless future route calls provider | Current image derivatives use transforms/R2, not AI provider calls. | Queue/job leases. | Keep outside AI provider budget guard unless provider-call patterns appear; storage/transform cost should be tracked separately. | No AI provider replay needed. | Queue limits and transform/storage budgets. | Guard catches any future provider call. | Outside Phase 4.2. |

## Operation Mapping

Admin and platform operation metadata is now explicit in `workers/auth/src/lib/ai-cost-operations.js`; known temporary gaps are mirrored in `config/ai-cost-policy-baseline.json`. Phase 4.3 marks `admin.image.test.charged` as implemented/hardened for the existing selected-organization credit branch. Phase 4.5 marks admin async video job operations as covered by job/queue budget metadata. Phase 4.6 marks OpenClaw/News Pulse visual operations as covered by visual budget metadata and status/attempt duplicate suppression. Phase 4.7 marks internal async video task create/poll as caller-policy guarded. Phase 4.8.1 marks admin text/embeddings as partial metadata-only coverage with durable idempotency attempts under `platform_admin_lab_budget`, Phase 4.8.2 adds bounded non-destructive cleanup plus admin-only sanitized inspection for those attempt rows, Phase 4.9 extends that same metadata-only durable attempt foundation to Admin Music only, Phase 4.10 extends it to Admin Compare only, Phase 4.12 extends it to Admin Live-Agent stream sessions only, and Phase 4.13 marks `admin.video.sync_debug` as retired/disabled-by-default rather than a normal baseline gap. Other admin/platform/internal entries remain policy metadata and known gaps unless a later phase migrates them.

| Operation / route | Target budget scope | Current status | Target phase |
| --- | --- | --- | --- |
| `/api/admin/ai/test-text` / `admin.text.test` | `platform_admin_lab_budget` | Phase 4.8.2 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, bounded cleanup, and admin-only sanitized inspection; no full result replay/live caps | Completed for admin text cleanup/inspection foundation |
| `/api/admin/ai/test-image` priced branch / `admin.image.test.charged` | `admin_org_credit_account` | Phase 4.3 hardened selected-org credit debit with safe budget policy metadata; result replay remains metadata-only. Phase 4.14 preserves charged branch behavior. | Completed for charged branch hardening |
| `/api/admin/ai/test-image` FLUX.2 Dev branch / `admin.image.test.unmetered` | `explicit_unmetered_admin` | Phase 4.14 explicit-unmetered admin exception with safe budget/caller metadata, no credit debit, no durable idempotency/replay, and runtime switch target `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS`; Phase 4.15 enforces it before provider work | Completed for explicit unmetered Admin Image branch classification plus runtime switch enforcement |
| `/api/admin/ai/test-image` unknown/unclassified model | none | Phase 4.14 blocks before AI Worker/provider execution | Completed for unsupported Admin Image guard |
| `/api/admin/ai/test-embeddings` / `admin.embeddings.test` | `platform_admin_lab_budget` | Phase 4.8.2 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, bounded cleanup, and admin-only sanitized inspection; no vectors/full result replay/live caps | Completed for admin embeddings cleanup/inspection foundation |
| `/api/admin/ai/test-music` / `admin.music.test` | `platform_admin_lab_budget` | Phase 4.9 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, no audio/lyrics/provider body replay, and no credit debit | Completed for Admin Music metadata-only budget/idempotency coverage |
| `/api/admin/ai/test-video` sync debug / `admin.video.sync_debug` | `platform_admin_lab_budget` | Phase 4.13 retired/disabled-by-default; emergency compatibility remains only behind `ALLOW_SYNC_VIDEO_DEBUG=true`; async video jobs are the supported path | Retired by Phase 4.13; future work only if emergency path is reintroduced as normal behavior |
| `/api/admin/ai/video-jobs` / `admin.video.job.create` | `platform_admin_lab_budget` | Phase 4.5 implemented sanitized job/queue budget metadata, required idempotency, and queue consumer budget-state checks | Completed for admin async video jobs only |
| `/api/admin/ai/compare` / `admin.compare` | `platform_admin_lab_budget` | Phase 4.10 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, no compare result/provider body replay, and no credit debit | Completed for Admin Compare metadata-only budget/idempotency coverage |
| `/api/admin/ai/live-agent` / `admin.live_agent` | `platform_admin_lab_budget` | Phase 4.12 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only stream-session duplicate suppression/conflict detection, no full stream replay, and no credit debit | Completed for Admin Live-Agent metadata-only budget/idempotency coverage |
| OpenClaw/News Pulse ingest and scheduled visuals / `platform.news_pulse.visual.*` | `openclaw_news_pulse_budget` | Phase 4.6 implemented sanitized visual budget metadata, invalid-policy provider blocking, and existing status/attempt duplicate suppression; runtime env kill switch and live caps remain future | Completed for News Pulse visuals only |
| Generated music cover/background cover | `member_credit_account` today; future `platform_background_budget` only if product changes | included in parent music bundle | No Phase 4.2 runtime work |
| Future AI provider backfills | `platform_background_budget` | not currently baselined as AI provider-cost unless a provider call appears | future targeted phase |

Internal AI Worker routes remain service-bound provider execution surfaces. Phase 4.7 validates caller-policy metadata after service-auth and before provider route handling. It requires metadata for async video task create/poll, validates supplied metadata on all known provider-cost routes, strips the reserved key before provider payload construction, and leaves broad routes baseline-allowed until targeted migrations.

| Internal AI Worker route | Operation ids | Target budget scope | Current policy owner |
| --- | --- | --- | --- |
| `/internal/ai/test-text` | `admin.text.test`, `internal.text.generate` | `internal_ai_worker_caller_enforced` | Admin text now supplies Phase 4.8 caller-policy metadata; org/member callers remain baseline-compatible |
| `/internal/ai/test-image` | `internal.image.generate` | `internal_ai_worker_caller_enforced` | Auth Worker caller such as admin image or member/org image route |
| `/internal/ai/test-embeddings` | `admin.embeddings.test`, `internal.embeddings.generate` | `internal_ai_worker_caller_enforced` | Admin embeddings now supplies Phase 4.8 caller-policy metadata; shared route still permits known baseline callers |
| `/internal/ai/test-music` | `internal.music.generate` | `internal_ai_worker_caller_enforced` | Member music gateway and Phase 4.9 admin music caller supply metadata; other known callers remain baseline-compatible |
| `/internal/ai/test-video` | `internal.video.generate` | `internal_ai_worker_caller_enforced` | Member video gateway or retired/disabled-by-default admin debug compatibility caller |
| `/internal/ai/video-task/create` | `admin.video.task.create`, `internal.video_task.create` | `internal_ai_worker_caller_enforced` | Phase 4.7 requires signed caller-policy metadata tied to the Phase 4.5 admin video job budget state |
| `/internal/ai/video-task/poll` | `admin.video.task.poll`, `internal.video_task.poll` | `internal_ai_worker_caller_enforced` | Phase 4.7 requires signed caller-policy metadata tied to the persisted Phase 4.5 provider task id |
| `/internal/ai/compare` | `internal.compare` | `internal_ai_worker_caller_enforced` | Phase 4.10 Admin Compare caller supplies signed policy; route remains baseline-compatible for other known callers |
| `/internal/ai/live-agent` | `internal.live_agent` | `internal_ai_worker_caller_enforced` | Phase 4.12 Admin Live-Agent caller supplies signed policy; the route now requires caller-policy after service-auth |

## Observability Fields

Future budget events should be safe and bounded:

- `operation_id`
- `budget_scope`
- `budget_owner_id` when safe and not PII-heavy
- `actor_user_id`
- `actor_role`
- `route_id`
- `provider_family`
- `model_id` or resolver key
- `estimated_units`
- `estimated_credits_or_budget_units`
- `reservation_id` or job id
- `idempotency_status`
- `provider_status`
- `finalization_status`
- `kill_switch_state`
- `budget_window`
- `replay_status`
- `safe_error_code`

Do not store raw prompts, lyrics, auth headers, cookies, tokens, Stripe data, provider secrets, raw provider payloads, card/payment method data, or internal R2 keys in budget telemetry.

## Target Invariants

- Provider-cost admin/platform routes must be registered before runtime migration.
- Member image/music/video must not regress from mandatory idempotency, reservation, replay/suppression, and exactly-once debit.
- Admin/platform budgeted routes must deny before provider execution when limits or kill switches block the request.
- Internal AI Worker routes must stay service-only and rely on caller-side operation metadata.
- OpenClaw/News Pulse visual generation must be deterministic by item/job key and bounded by batch/window budgets.
- Explicit unmetered admin behavior must be a reviewed exception, not a silent default.
- Strict mode for `check:ai-cost-policy` should remain failing until all temporary baseline gaps are closed or explicitly removed.

## Recommended Implementation Order

1. Phase 4.2: Add admin/platform budget policy contract/helpers and tests only; no route migration. Completed for helper/test scope.
2. Phase 4.3: Harden charged admin BFL image test budget metadata while preserving current organization-credit debit behavior. Completed for the charged branch only; broad Admin AI remains unmigrated.
3. Phase 4.4: Add read-only Admin/Platform AI budget evidence reporting. Completed for helper/script/admin endpoint/test scope only; no runtime enforcement changed.
4. Phase 4.5: Add admin async video job budget reservation metadata and internal task create/poll caller linkage. Completed only for admin async video jobs; broad Admin AI remains unmigrated.
5. Phase 4.6: Add OpenClaw/News Pulse visual budget metadata, invalid-policy provider blocking, and duplicate provider-call suppression. Completed only for News Pulse visuals; Phase 4.15 now enforces the runtime switch, while live caps remain future work.
6. Phase 4.7: Add internal AI Worker caller-policy guard for service-bound routes. Completed for caller-policy validation/metadata handling only.
7. Phase 4.8: Add admin text/embeddings budget metadata, required idempotency, and caller-policy propagation. Completed only for those two routes.
8. Phase 4.8.1: Add admin text/embeddings durable metadata-only idempotency attempts and same-key conflict/duplicate suppression. Completed only for those two routes; full result replay/live platform caps remain future work.
9. Phase 4.8.2: Add admin-only sanitized inspection and bounded non-destructive cleanup for `admin_ai_usage_attempts`. Completed only for admin text/embeddings attempt operability; no new route migration, provider behavior, credit behavior, or billing behavior changed.
10. Phase 4.9: Add Admin Music budget metadata, required idempotency, durable metadata-only duplicate suppression, and caller-policy propagation. Completed only for `POST /api/admin/ai/test-music`; no migration added.
11. Phase 4.10: Add Admin Compare budget metadata, required idempotency, durable metadata-only duplicate suppression, and caller-policy propagation. Completed only for `POST /api/admin/ai/compare`; no migration added.
12. Phase 4.11: Audit and design the Admin Live-Agent budget flow without runtime changes. Completed for Admin Live-Agent flow audit/prep only.
13. Phase 4.12: Implement the Admin Live-Agent budget migration using the Phase 4.11 target design. Completed only for Admin Live-Agent: required idempotency, metadata-only durable stream-session attempts, signed caller-policy propagation, safe observable stream/failure finalization, and no broad Admin AI rewrite.
14. Phase 4.13: Retire/classify sync video debug as disabled-by-default/emergency-only. Completed with no migration and no normal provider-cost budget migration.
15. Phase 4.14: Classify Admin Image branches, keep FLUX.2 Dev as an explicit unmetered admin exception, and block unclassified Admin Image models before provider execution. Completed with no migration and no unrelated route migration.
16. Phase 4.15: Enforce runtime budget switches for already budget-classified admin/platform provider-cost paths. Completed; live platform budget caps and broader internal caller-policy gaps remain future work.
17. Phase 4.16: Address live platform budget caps or broader internal caller-policy gaps as the next narrow provider-cost gap.

Each phase must be small, tested, reversible, and independently deployable. None of these phases should claim production readiness or live billing readiness without operator evidence.
