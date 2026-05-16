# AI Cost Gateway

Date: 2026-05-16

Status: Phase 4.8.1 admin text/embeddings durable idempotency foundation. Phase 3.1 added design and inventory. Phase 3.2 added the member AI Cost Gateway contract/helper module and deterministic tests. Phase 3.3 added a central operation registry for known AI provider-cost operations and strengthened the policy check. Phase 3.4 uses that foundation for member personal image generation. Phase 3.5/3.6 migrated member music, Phase 3.7 hardened migrated member image/music replay/finalization/cleanup, Phase 3.8 migrated member video, and Phase 3.9 added the known-gap baseline guard. Phase 4.1 added the budget policy design and taxonomy. Phase 4.2 added `workers/auth/src/lib/admin-platform-budget-policy.js`. Phase 4.3 hardened only the existing charged Admin BFL image-test branch with safe `admin_org_credit_account` metadata. Phase 4.4 added read-only evidence reporting. Phase 4.5 covers only admin async video jobs with sanitized `platform_admin_lab_budget` job/queue metadata and queue consumer budget-state checks. Phase 4.6 covers only OpenClaw/News Pulse visual generation with sanitized `openclaw_news_pulse_budget` visual metadata, invalid-policy provider blocking, and existing status/attempt duplicate suppression. Phase 4.7 adds a reserved signed JSON body caller-policy contract for internal Auth Worker -> AI Worker provider-cost calls, requires it for async video task create/poll, validates malformed supplied policy on known routes, and strips metadata before provider payloads. Phase 4.8 covers only admin text and embeddings budget metadata/caller-policy. Phase 4.8.1 adds additive migration `0051_add_admin_ai_usage_attempts.sql` and uses `admin_ai_usage_attempts` for metadata-only duplicate suppression and same-key/different-request conflict detection on those two routes. It does not migrate admin music/compare/live-agent, sync video debug, unmetered admin image, Admin video beyond Phase 4.5 compatibility, OpenClaw/News Pulse beyond Phase 4.6 compatibility, platform/background AI outside News Pulse visuals, broad internal AI Worker routes, org-scoped/member billing behavior, Stripe/providers, deployments, live billing, public pricing, or credit debit behavior.

Production readiness remains BLOCKED. Live billing readiness remains BLOCKED.

## Why BITBI Needs This

BITBI has several AI provider entry points across member generation, organization-scoped generation, Admin AI Lab tests, background jobs, OpenClaw News Pulse visuals, and internal AI Worker routes. The current implementation has strong patterns in some places, especially org-scoped image/text usage attempts, but the behavior is not uniform across every cost-bearing route.

A unified AI Cost Gateway is needed so every route that can create provider cost has one consistent lifecycle:

- identify the operation and actor
- resolve billing scope and model cost
- require idempotency for cost-bearing calls
- reserve or authorize credits before provider execution
- suppress duplicate provider execution
- finalize debit only after a successful provider result
- release reservation or charge nothing on provider failure
- persist safe replay metadata when possible
- emit consistent audit and cost telemetry

## Current Status

The current code already has important foundations:

- `workers/auth/src/lib/ai-usage-policy.js` centralizes some org/member AI usage checks.
- `workers/auth/src/lib/ai-usage-attempts.js` implements reservation, provider-running, provider-failed, finalizing, billing-failed, succeeded, expiry, and replay metadata states for org-scoped usage attempts.
- Org-scoped `/api/ai/generate-image` and `/api/ai/generate-text` require idempotency and use usage-attempt reservation/replay behavior.
- Chargeable Admin AI image tests use org credits and `ai_usage_attempts`; Phase 4.3 adds safe admin/platform budget-policy plan/audit metadata for the charged Admin BFL image-test branch without changing unpriced admin image behavior.
- Member personal image generation now requires `Idempotency-Key`, reserves member credits before provider execution, suppresses same-key duplicate provider calls, replays safe stored temporary image metadata when available, returns safe replay-unavailable responses without re-executing providers or double-debiting when the temp result is missing/expired, debits once after provider success, and releases/no-charges on provider failure.
- Member music generation now requires `Idempotency-Key`, reserves one parent `member_ai_usage_attempts` row before lyrics/audio/cover provider-cost work, suppresses same-key duplicate provider execution, debits exactly once after audio persistence, returns safe replay metadata for duplicate completed requests, records pending/succeeded/failed/skipped cover status, and releases/no-charges on lyrics/audio provider failure.
- Member video generation now requires `Idempotency-Key`, reserves one parent `member_ai_usage_attempts` row before PixVerse/HappyHorse provider work, suppresses same-key duplicate provider execution, debits exactly once after durable video asset persistence, returns safe durable-asset replay metadata when available, and returns replay-unavailable without provider re-execution or double debit when the saved result is missing.
- Admin AI Lab text and embeddings routes now use Phase 4.8.1 metadata-only budget controls, caller-policy propagation, and durable `admin_ai_usage_attempts` duplicate suppression/conflict detection. Admin music/video debug/compare/live-agent and unmetered image routes remain admin-only, generally uncharged, and not fully migrated to a shared cost lifecycle.
- News Pulse visual generation now records Phase 4.6 `openclaw_news_pulse_budget` metadata and blocks invalid budget policy before provider execution, while generated music cover creation remains inside the member music bundle.
- `config/ai-cost-policy-baseline.json` explicitly lists the remaining accepted-for-now admin, platform/background outside News Pulse visuals, and internal AI Worker provider-cost gaps. New provider-cost source files, unregistered operations, duplicate registry/baseline ids, and member image/music/video regressions now fail the local policy check by default.
- Phase 4.1 defines budget scopes for admin/org-charged admin tests, platform admin lab budget, platform background budget, OpenClaw/News Pulse budget, internal caller-enforced AI Worker routes, explicit unmetered admin exceptions, and external-provider-only cases.
- Phase 4.2 adds pure helper contracts for those scopes: budget operation normalization, deterministic fingerprinting, safe audit field construction, kill-switch metadata validation, and plan classification.
- Phase 4.3 uses that helper only for the existing charged Admin image-test branch and records safe budget metadata in the admin response, usage event metadata, and admin AI usage attempt metadata. It does not enforce a new runtime env kill switch; the recorded kill-switch field is a future target.
- Phase 4.4 adds read-only Admin/Platform AI budget evidence reporting. The local script and admin-only endpoint summarize covered, baselined, unmetered, caller-enforced, and missing-runtime-enforcement flows from registry, baseline, route-policy, and Phase 4.3 metadata. The verdict remains blocked while baselined gaps remain.
- Phase 4.5 covers only admin async video jobs. Job creation builds a Phase 4.2 budget plan before queueing, stores sanitized budget metadata in `ai_video_jobs`, includes a bounded queue summary, verifies job budget state before internal video task create/poll calls, suppresses duplicate same-key queueing, and fails closed rather than creating a second provider task after an unresolved create attempt. The kill-switch target is `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET` metadata only; runtime env enforcement and live platform budget caps remain future work.
- Phase 4.6 covers only OpenClaw/News Pulse visual generation. Visual backfill builds a Phase 4.2 budget plan before `env.AI.run`, stores sanitized visual budget metadata in `news_pulse_items`, blocks invalid policy before provider execution, preserves ready/pending/status/attempt duplicate suppression, and records future kill-switch target `ENABLE_NEWS_PULSE_VISUAL_BUDGET` as metadata only. Runtime env enforcement and live platform budget caps remain future work.
- Phase 4.7 covers only the internal AI Worker caller-policy guard. Auth Worker callers attach safe `__bitbi_ai_caller_policy` metadata where policy state is already available, the AI Worker validates service-auth first, then validates caller policy, requires it for `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`, allows known broader internal routes only as explicit baseline gaps, and strips metadata before provider payload construction.
- Phase 4.8 covers only admin text/embeddings tests. Both routes require `Idempotency-Key`, build safe `platform_admin_lab_budget` plan/fingerprint metadata, propagate `budget_metadata_only` caller-policy metadata to the AI Worker, and return sanitized admin-only budget summaries.
- Phase 4.8.1 adds `admin_ai_usage_attempts` for those same two routes. Same-key/same-request pending, completed, or failed attempts do not make another provider call; same-key/different-request retries conflict before provider execution. Completed duplicate replay is metadata-only with `result: null`; raw prompts, raw embedding input, generated text, and embedding vectors are not stored. Runtime env kill-switch enforcement, live platform budget caps, Stripe calls, credit mutation, and live billing remain absent.

Phase 3.2 adds:

- `workers/auth/src/lib/ai-cost-gateway.js`
- `npm run test:ai-cost-gateway`
- operation config normalization
- stable request fingerprinting
- scoped idempotency key building
- pure gateway plan/state classification

The module is not imported by any live route yet.

Phase 3.3 adds:

- `workers/auth/src/lib/ai-cost-operations.js`
- `npm run test:ai-cost-operations`
- normalized target operation configs for known AI cost operations
- current enforcement metadata for idempotency, reservation, replay, credit checks, and provider-call suppression
- route-policy and provider-call source baselines for the report-only checker

The registry is now imported by the migrated member personal image, member music, and member video gateway routes. Phase 4.1/4.2 admin/platform budget metadata and helpers remain design/check-only until a later route imports them.

Phase 3.4 adds:

- `workers/auth/src/lib/member-ai-usage-attempts.js`
- `workers/auth/migrations/0048_add_member_ai_usage_attempts.sql`
- member personal image gateway wiring in `workers/auth/src/lib/ai-usage-policy.js` and `workers/auth/src/routes/ai/images-write.js`
- focused Worker tests for required idempotency, insufficient-credit fail-before-provider, provider-failure no-charge, same-key replay/no duplicate provider call, conflict behavior, safe metadata, and org/admin compatibility

The migration is additive and must be applied by an operator before deploying auth Worker code that depends on the member image pilot.

Phase 3.4.1 adds:

- `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md`
- main-only runbook/checklist evidence updates for migration-before-worker deploy order
- evidence template updates for member image gateway smoke results

It is documentation/checklist guidance only. It does not deploy, apply remote migrations, call providers, change route behavior, change credit behavior, or prove production readiness.

Phase 3.5 adds:

- `docs/ai-cost-gateway/MEMBER_MUSIC_COST_DECOMPOSITION.md`
- explicit registry entries for `member.music.generate`, `member.music.lyrics.generate`, `member.music.audio.generate`, and `member.music.cover.generate`
- report-only `check:ai-cost-policy` output that calls out member music sub-operation gaps
- deterministic tests proving the music registry decomposition and report-only gap output

It is design/check/test-only. It does not change `/api/ai/generate-music`, require `Idempotency-Key`, reserve credits, change debits, add replay, call providers, or mutate billing.

Phase 3.6 adds:

- member music gateway wiring in `workers/auth/src/routes/ai/music-generate.js`
- shared member gateway policy support in `workers/auth/src/lib/ai-usage-policy.js`
- safe replay metadata from `member_ai_usage_attempts.metadata_json` for completed music attempts
- mandatory `Idempotency-Key` for `POST /api/ai/generate-music`
- one parent member-credit reservation for bundled lyrics/audio/cover work
- no-charge release on lyrics/audio provider failure and terminal no-charge handling on storage/billing finalization failure
- report-only registry/check updates marking member music parent/lyrics/audio as gateway-covered and cover as bundled/partial
- focused Worker tests for idempotency, insufficient credits, provider/storage/billing failures, duplicate in-progress suppression, completed replay, conflict behavior, and safe metadata

It changes only the member music route behavior. It does not call real providers in tests, add a migration, change public pricing, migrate video/admin/platform/internal routes, call Stripe, deploy, or prove production/live billing readiness.

Phase 3.7 adds:

- replay-unavailable handling for completed member image/music attempts without automatic provider re-execution or double debit
- safe image replay metadata that stores prompt length/model/pricing details without raw prompt, secrets, cookies, auth tokens, Stripe data, or internal object keys
- music cover status writeback on the parent member attempt with `pending`, `succeeded`, `failed`, and `skipped` states
- terminal finalization behavior for member music metadata writeback failures after debit
- scheduled cleanup for expired/stuck `member_ai_usage_attempts` reservations and expired member replay metadata/temporary objects
- generic temp-object cleanup protection so member-linked replay objects are not deleted before attempt-aware cleanup processes them
- focused Worker tests for replay unavailable, cover success/failure metadata, cleanup/expiry, and no double debit

It changes only already migrated member image/music gateway behavior. It does not call real providers in tests, add a migration, change public pricing, migrate video/admin/platform/internal routes, call Stripe, deploy, or prove production/live billing readiness.

Phase 3.8 adds:

- member video gateway wiring in `workers/auth/src/routes/ai/video-generate.js`
- mandatory `Idempotency-Key` for member `POST /api/ai/generate-video`
- one parent member-credit reservation before PixVerse/HappyHorse provider execution and remote output ingest
- no-charge release on provider failure and terminal no-charge handling on output/storage failure before debit
- exactly-once member debit after durable video asset persistence
- safe durable-asset replay metadata that omits raw prompt and internal R2 keys
- replay-unavailable behavior for completed same-key video attempts without provider re-execution or double debit
- report-only registry/check updates marking member video as gateway-covered while preserving admin/platform/internal gaps
- focused Worker tests for idempotency, insufficient credits, provider/storage/billing failures, duplicate in-progress suppression, completed replay, conflict behavior, and safe metadata

It changes only member video generation behavior. It does not call real providers in tests, add a migration, change public pricing, migrate admin video jobs/admin/platform/internal/OpenClaw routes, call Stripe, deploy, or prove production/live billing readiness.

Phase 3.9 adds:

- `config/ai-cost-policy-baseline.json`
- baseline validation for duplicate ids, missing route/file references, registry coverage, and invalid known-gap metadata
- default `check:ai-cost-policy` enforcement that passes only when current gaps match the known baseline
- unregistered provider-call source detection that fails in default mode
- migrated member route regression checks for member image, member music, and member video
- release preflight integration for the default local guard

It is validation/check/tooling/documentation only. It does not change route behavior, debit behavior, provider routing, pricing, migrations, deploys, admin/platform/internal route behavior, or live billing readiness.

Phase 4.1 adds:

- `docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md`
- `AI_COST_BUDGET_SCOPES` and `AI_COST_BUDGET_SCOPE_POLICIES` metadata in `workers/auth/src/lib/ai-cost-operations.js`
- `budgetPolicy` metadata for admin, platform/background, OpenClaw/News Pulse, and internal AI Worker registry entries
- `targetBudgetScope` and `temporaryAllowanceReason` fields in the known-gap baseline
- `check:ai-cost-policy` report grouping for admin gaps, platform/background gaps, and internal caller-enforced gaps
- deterministic tests that keep member image/music/video out of the known-gap baseline while admin/platform/internal/OpenClaw gaps remain explicit

It is design/check/tooling/documentation only. It does not change runtime route behavior, debit behavior, provider routing, pricing, migrations, deploys, admin/platform/internal route behavior, or live billing readiness.

Phase 4.2 adds:

- `workers/auth/src/lib/admin-platform-budget-policy.js`
- `scripts/test-admin-platform-budget-policy.mjs`
- `npm run test:admin-platform-budget-policy`
- release-preflight coverage for the deterministic helper test
- baseline validation that every admin/platform/internal/OpenClaw known gap has a kill-switch target or explicit exemption plus a future enforcement path
- pure contract helpers for budget scope validation, kill-switch metadata validation, safe audit fields, deterministic fingerprints, and budget plan status classification

It is contract/helper/test/documentation only. It does not change runtime route behavior, debit behavior, provider routing, pricing, migrations, deploys, Admin UI, admin/platform/internal/OpenClaw route behavior, or live billing readiness.

Phase 4.3 adds:

- `admin_org_credit_account` budget plan/audit metadata to the existing charged Admin AI image-test branch in `workers/auth/src/routes/admin-ai.js`
- deterministic budget policy fingerprints built by `workers/auth/src/lib/admin-platform-budget-policy.js`
- safe `budget_policy` metadata in the admin image-test success response, usage event metadata, and admin AI usage attempt metadata
- registry/check output that marks `admin.image.test.charged` as implemented/hardened while keeping unmetered admin image, admin music/video/compare/live-agent, OpenClaw, platform/background, and internal AI Worker gaps baselined
- focused Worker tests for the charged BFL branch covering required organization/idempotency, malformed idempotency rejection, insufficient credits before provider call, no-charge provider failure, exactly-once debit, conflict handling, billing-finalization failure, and sanitized budget metadata

It changes only the existing charged Admin image-test path. It does not call real providers in tests, add a migration, enforce a new env kill switch, change member/org routes, migrate broad Admin AI, call Stripe, deploy, or prove production/live billing readiness.

Phase 4.4 adds:

- `workers/auth/src/lib/admin-platform-budget-evidence.js`
- `GET /api/admin/ai/budget-evidence`
- `scripts/report-ai-budget-evidence.mjs`
- `npm run report:ai-budget-evidence`
- `scripts/test-admin-platform-budget-evidence.mjs`
- `npm run test:admin-platform-budget-evidence`

It is read-only evidence/reporting only. It reports member image/music/video as gateway-migrated, reports charged Admin BFL image-test as implemented/hardened, after Phase 4.5 reports admin async video jobs as `platform_admin_lab_budget` metadata-covered, after Phase 4.6 reports OpenClaw/News Pulse visuals as `openclaw_news_pulse_budget` metadata-covered, after Phase 4.7 reports async video task create/poll as caller-policy guarded, and after Phase 4.8.1 reports admin text/embeddings as metadata-only `platform_admin_lab_budget` coverage with durable idempotency attempts. Admin music/compare/live-agent, sync video debug, unmetered admin image, platform/background AI outside News Pulse visuals, and baseline-allowed internal AI Worker routes beyond covered caller paths remain baselined gaps. The report itself does not call real providers, call Stripe, mutate billing/credits/D1/R2, deploy, enable live billing, change member/org route behavior, change credit debit behavior, add public billing changes, add Admin UI, or prove production/live billing readiness.

Phase 4.5 adds:

- `workers/auth/migrations/0049_add_admin_video_job_budget_metadata.sql`
- sanitized admin async video job budget metadata in `workers/auth/src/lib/ai-video-jobs.js`
- bounded queue budget summaries for `AI_VIDEO_JOBS_QUEUE`
- queue consumer validation before `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`
- registry/baseline updates that remove the specific admin async video job gap while leaving broad Admin AI, OpenClaw/News Pulse, platform/background, and internal global gaps blocked
- focused Worker tests for idempotency, invalid budget config, sanitized metadata, missing metadata fail-closed behavior, duplicate queue delivery, duplicate provider-create suppression, provider/output failures, and no credit mutation

It changes only admin async video job behavior. It does not call real providers in tests, call Stripe, deploy, run remote migrations, enable live billing, change public pricing, mutate credits, add Admin UI, migrate broad Admin AI, migrate OpenClaw/News Pulse, migrate platform/background AI, migrate internal AI Worker routes globally, or change member/org route behavior.

Phase 4.6 adds:

- `workers/auth/migrations/0050_add_news_pulse_visual_budget_metadata.sql`
- sanitized OpenClaw/News Pulse visual budget metadata in `workers/auth/src/lib/news-pulse-visuals.js`
- caller-side budget plan validation before generated thumbnail provider execution
- registry/baseline updates that remove the specific OpenClaw/News Pulse visual gap while leaving broad Admin AI, Admin music/text/compare/live-agent, platform/background outside News Pulse visuals, and internal global gaps blocked
- evidence report updates that mark News Pulse visual operations as implemented for metadata/status controls
- focused Worker tests for invalid budget policy blocking, ready/pending duplicate suppression, provider/storage failures, sanitized metadata, OpenClaw ingest compatibility, public read fallback, and no credit mutation

It changes only OpenClaw/News Pulse generated visual behavior. It does not call real providers in tests, call Stripe, deploy, run remote migrations, enable live billing, change public pricing, mutate credits, add Admin UI, migrate broad Admin AI, migrate Admin video beyond Phase 4.5, migrate platform/background AI globally, migrate internal AI Worker routes globally, or change member/org route behavior.

Phase 4.7 adds:

- `workers/shared/ai-caller-policy.mjs`
- AI Worker caller-policy validation in `workers/ai/src/lib/caller-policy.js` and service-auth-first dispatch in `workers/ai/src/index.js`
- reserved signed JSON body key transport: `__bitbi_ai_caller_policy`
- Auth Worker propagation for charged Admin BFL image, admin async video task create/poll, baseline Admin AI proxy calls, and member music internal lyrics/audio compatibility
- metadata stripping in the AI Worker shared body parser before provider route validation and provider payload construction
- registry/baseline/evidence updates that mark async video task create/poll as caller-policy guarded while keeping broad Admin AI and broader internal routes tracked as baseline gaps

It changes only internal caller-policy metadata handling. It does not call real providers in tests, call Stripe, deploy, run remote migrations, enable live billing, change public pricing, mutate credits, add Admin UI, migrate broad Admin AI, migrate Admin music/text/compare/live-agent, migrate OpenClaw/News Pulse beyond Phase 4.6 compatibility, migrate platform/background AI globally, or change member image/music/video billing behavior.

Phase 4.8.1 adds:

- `workers/auth/migrations/0051_add_admin_ai_usage_attempts.sql`
- `workers/auth/src/lib/admin-ai-idempotency.js`
- durable metadata-only idempotency attempts for admin text and embeddings
- same-key/same-request duplicate suppression for pending, completed, and failed attempts
- same-key/different-request conflict detection before internal AI/provider calls
- metadata-only replay for completed duplicates, with no generated text or embedding vectors stored
- route-policy, registry, baseline, evidence, and tests updated to remove the durable-idempotency gap while preserving remaining admin/platform/internal gaps

It changes only admin text/embeddings idempotency behavior. It does not debit credits, call real providers in tests, call Stripe, deploy, run remote migrations, enable live billing, change public pricing, add Admin UI, migrate Admin music/video/compare/live-agent, migrate OpenClaw/News Pulse, migrate platform/background AI, migrate unrelated internal AI Worker routes, or change member image/music/video or org-scoped member route behavior.

## Current Non-Goals

Phase 4.8/4.8.1 add:

- required `Idempotency-Key` validation for `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings`
- metadata-only `platform_admin_lab_budget` budget plans for admin text and embeddings
- future kill-switch metadata targets `ENABLE_ADMIN_AI_TEXT_BUDGET` and `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`
- signed `budget_metadata_only` caller-policy propagation to `/internal/ai/test-text` and `/internal/ai/test-embeddings`
- durable metadata-only attempts in `admin_ai_usage_attempts` for duplicate suppression and conflict detection
- sanitized admin response budget/caller summaries that omit raw prompts, raw embedding inputs, provider payloads, secrets, cookies, auth headers, Stripe data, Cloudflare tokens, and private keys
- registry/baseline/evidence updates that mark admin text/embeddings as partial metadata-only durable-idempotency coverage while preserving remaining admin/platform/internal gaps

It changes only admin text/embeddings test behavior. It does not add full result replay, debit credits, call real providers in tests, call Stripe, deploy, run remote migrations, enable live billing, change public pricing, add Admin UI, migrate Admin music/video/compare/live-agent, migrate OpenClaw/News Pulse, migrate platform/background AI, migrate unrelated internal AI Worker routes, or change member image/music/video or org-scoped member route behavior.

Current Phase 4.8.1 non-goals:

- migrate broad admin AI routes beyond the already charged Admin image-test branch
- migrate admin music/compare/live-agent or sync video debug
- migrate admin video beyond the Phase 4.5 job-budget path
- migrate OpenClaw/News Pulse beyond Phase 4.6 visual controls
- migrate platform/background AI routes outside News Pulse visuals
- migrate internal AI Worker routes directly or globally beyond caller-policy validation and async video task create/poll fail-closed requirements
- change org-scoped image/text behavior
- change member image/music/video billing behavior
- change model routing
- enforce live admin/platform budget caps or a new runtime env kill switch
- add admin budget UI or dashboards
- enforce a new runtime admin/platform budget env flag
- change public pricing
- call real AI providers in tests
- call Stripe APIs
- deploy anything
- approve production, full AI cost readiness, or live billing readiness

## Documents

- `AI_COST_ROUTE_INVENTORY.md` records known provider-cost routes and current idempotency/reservation/replay/credit behavior.
- `AI_COST_GATEWAY_DESIGN.md` defines the target gateway lifecycle and route adapter contract.
- `AI_COST_GATEWAY_ROADMAP.md` splits future implementation into small, reviewable phases.
- `MEMBER_MUSIC_COST_DECOMPOSITION.md` decomposes member music provider-cost sub-operations and target failure/replay semantics.
- `ADMIN_PLATFORM_BUDGET_POLICY.md` defines the Phase 4.1 budget-scope taxonomy and Phase 4.2 helper contract for the future admin/platform/internal budget policy model.
- `workers/auth/src/lib/admin-platform-budget-policy.js` provides pure helper contracts; Phase 4.3 uses it only to produce safe metadata for charged Admin image tests.
- `workers/auth/src/lib/admin-platform-budget-evidence.js` builds the Phase 4.4 read-only local evidence report and now reflects Phase 4.5 admin video job coverage, Phase 4.6 News Pulse coverage, Phase 4.7 internal caller-policy guard coverage, and Phase 4.8.1 admin text/embeddings metadata-only durable-idempotency coverage.
- `ADMIN_TEXT_EMBEDDINGS_IDEMPOTENCY_DESIGN.md` documents the Phase 4.8.1 implemented schema, fingerprinting, replay, privacy, and failure policy.
- `workers/auth/src/lib/ai-video-jobs.js` owns Phase 4.5 admin async video job budget metadata and queue enforcement.
- `workers/auth/src/lib/ai-cost-operations.js` records the Phase 3.3 operation registry and the member image/music/video gateway status.
- `config/ai-cost-policy-baseline.json` records the Phase 3.9 accepted-for-now admin/platform/internal/OpenClaw known gaps plus Phase 4.1 target budget scopes and Phase 4.2 kill-switch/future-enforcement metadata.

## Local Check

`npm run check:ai-cost-policy` is now a local enforcement guard. It validates the Phase 3.3 operation registry, validates the Phase 3.9 known-gap baseline, scans route-policy metadata, checks AI provider-call source files, compares against the inventory document, and fails on unbaselined provider-cost drift or migrated member-route regressions. It does not call providers, read secrets, deploy, migrate, or mutate local/remote state.

`npm run test:ai-cost-gateway` runs deterministic unit tests for the Phase 3.2 contract helpers. It does not call providers, read secrets, deploy, migrate, use D1/R2, or mutate local/remote state.

`npm run test:ai-cost-operations` validates the Phase 3.3 registry baseline, uniqueness, target config normalization, deterministic summary counts, source-file coverage, duplicate detection, and no external calls.

`npm run test:admin-platform-budget-policy` validates the pure helper contract: valid budget scopes, kill-switch defaults, explicit unmetered justification, internal caller-enforced exemptions, deterministic fingerprints, safe audit fields, plan statuses, and no provider calls.

`npm run test:admin-platform-budget-evidence` validates the read-only evidence helper, local script, report bounds, sanitization, blocked verdict, member gateway coverage, Admin BFL hardening evidence, admin video job coverage, News Pulse coverage, internal caller-policy guard evidence, admin text/embeddings metadata-only coverage, remaining baseline gaps, and no provider calls.

`npm run report:ai-budget-evidence` prints the local evidence report as JSON by default, with `--markdown` available for operator-readable summaries. It never requires live env and does not call providers, Stripe, Cloudflare, GitHub, D1, R2, or mutate credits.

The check intentionally allows current admin, platform/background, OpenClaw, and internal AI Worker gaps only when they match `config/ai-cost-policy-baseline.json` and its Phase 4.1/4.2 metadata. Member personal image generation, member music generation, and member video generation are gateway-covered and must not regress to missing idempotency, reservation, replay, credit check, or provider suppression.

Next implementation phase: Phase 4.9 should target one remaining baselined Admin AI or internal caller path without changing member/org billing behavior or broad platform/background AI. Production/live billing remains blocked until operator evidence is complete and reviewed.
