# AI Cost Gateway

Date: 2026-05-15

Status: Phase 4.2 admin/platform AI budget policy contract/helper foundation. Phase 3.1 added design and inventory. Phase 3.2 added the member AI Cost Gateway contract/helper module and deterministic tests. Phase 3.3 added a central operation registry for known AI provider-cost operations and strengthened the policy check. Phase 3.4 uses that foundation for member personal image generation. Phase 3.4.1 adds main-only release/evidence guidance for the image pilot. Phase 3.5 decomposed member music into parent, lyrics, audio, and cover operations. Phase 3.6 migrates only member music generation to the AI Cost Gateway. Phase 3.7 hardens replay/result metadata, replay-unavailable behavior, cover status writeback, finalization edge cases, and scheduled cleanup for already migrated member image/music flows. Phase 3.8 migrates only member video generation to the same member gateway foundation. Phase 3.9 adds `config/ai-cost-policy-baseline.json` and makes `npm run check:ai-cost-policy` fail on unbaselined provider-cost drift while allowing explicitly documented admin/platform/internal/OpenClaw gaps. Phase 4.1 adds the budget policy design and taxonomy. Phase 4.2 adds `workers/auth/src/lib/admin-platform-budget-policy.js`, deterministic tests, kill-switch/future-enforcement baseline validation, and preflight coverage for the pure helper contract. It does not change runtime route behavior, migrate admin video jobs, migrate admin AI, migrate platform/background AI, migrate OpenClaw/News Pulse, migrate internal AI Worker routes directly, change org-scoped/member routes, call Stripe/providers, deploy, mutate billing, or change public pricing.

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
- Chargeable Admin AI image tests use org credits and `ai_usage_attempts`.
- Member personal image generation now requires `Idempotency-Key`, reserves member credits before provider execution, suppresses same-key duplicate provider calls, replays safe stored temporary image metadata when available, returns safe replay-unavailable responses without re-executing providers or double-debiting when the temp result is missing/expired, debits once after provider success, and releases/no-charges on provider failure.
- Member music generation now requires `Idempotency-Key`, reserves one parent `member_ai_usage_attempts` row before lyrics/audio/cover provider-cost work, suppresses same-key duplicate provider execution, debits exactly once after audio persistence, returns safe replay metadata for duplicate completed requests, records pending/succeeded/failed/skipped cover status, and releases/no-charges on lyrics/audio provider failure.
- Member video generation now requires `Idempotency-Key`, reserves one parent `member_ai_usage_attempts` row before PixVerse/HappyHorse provider work, suppresses same-key duplicate provider execution, debits exactly once after durable video asset persistence, returns safe durable-asset replay metadata when available, and returns replay-unavailable without provider re-execution or double debit when the saved result is missing.
- Admin AI Lab text/music/video/compare/live-agent routes are admin-only but generally uncharged and do not use a shared cost lifecycle.
- News Pulse visual generation and generated music cover creation can call AI providers outside the member billing lifecycle.
- `config/ai-cost-policy-baseline.json` explicitly lists the remaining accepted-for-now admin, platform/background, OpenClaw, and internal AI Worker provider-cost gaps. New provider-cost source files, unregistered operations, duplicate registry/baseline ids, and member image/music/video regressions now fail the local policy check by default.
- Phase 4.1 defines budget scopes for admin/org-charged admin tests, platform admin lab budget, platform background budget, OpenClaw/News Pulse budget, internal caller-enforced AI Worker routes, explicit unmetered admin exceptions, and external-provider-only cases.
- Phase 4.2 adds pure helper contracts for those scopes: budget operation normalization, deterministic fingerprinting, safe audit field construction, kill-switch metadata validation, and plan classification. This is helper/test metadata only; it does not enforce budgets at runtime.

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

## Current Non-Goals

Phase 4.2 does not:

- migrate admin video jobs
- migrate admin AI routes
- migrate platform/background AI routes
- migrate OpenClaw/News Pulse
- migrate internal AI Worker routes directly
- change org-scoped image/text behavior
- change member image/music/video behavior
- change model routing
- enforce admin/platform budget limits at runtime
- add admin budget UI or dashboards
- import the admin/platform helper from runtime routes
- change public pricing
- call AI providers
- call Stripe APIs
- deploy anything
- approve production, full AI cost readiness, or live billing readiness

## Documents

- `AI_COST_ROUTE_INVENTORY.md` records known provider-cost routes and current idempotency/reservation/replay/credit behavior.
- `AI_COST_GATEWAY_DESIGN.md` defines the target gateway lifecycle and route adapter contract.
- `AI_COST_GATEWAY_ROADMAP.md` splits future implementation into small, reviewable phases.
- `MEMBER_MUSIC_COST_DECOMPOSITION.md` decomposes member music provider-cost sub-operations and target failure/replay semantics.
- `ADMIN_PLATFORM_BUDGET_POLICY.md` defines the Phase 4.1 budget-scope taxonomy and Phase 4.2 helper contract for the future admin/platform/internal budget policy model.
- `workers/auth/src/lib/admin-platform-budget-policy.js` provides pure Phase 4.2 helper contracts for future admin/platform route migrations.
- `workers/auth/src/lib/ai-cost-operations.js` records the Phase 3.3 operation registry and the member image/music/video gateway status.
- `config/ai-cost-policy-baseline.json` records the Phase 3.9 accepted-for-now admin/platform/internal/OpenClaw known gaps plus Phase 4.1 target budget scopes and Phase 4.2 kill-switch/future-enforcement metadata.

## Local Check

`npm run check:ai-cost-policy` is now a local enforcement guard. It validates the Phase 3.3 operation registry, validates the Phase 3.9 known-gap baseline, scans route-policy metadata, checks AI provider-call source files, compares against the inventory document, and fails on unbaselined provider-cost drift or migrated member-route regressions. It does not call providers, read secrets, deploy, migrate, or mutate local/remote state.

`npm run test:ai-cost-gateway` runs deterministic unit tests for the Phase 3.2 contract helpers. It does not call providers, read secrets, deploy, migrate, use D1/R2, or mutate local/remote state.

`npm run test:ai-cost-operations` validates the Phase 3.3 registry baseline, uniqueness, target config normalization, deterministic summary counts, source-file coverage, duplicate detection, and no external calls.

`npm run test:admin-platform-budget-policy` validates the Phase 4.2 pure helper contract: valid budget scopes, kill-switch defaults, explicit unmetered justification, internal caller-enforced exemptions, deterministic fingerprints, safe audit fields, plan statuses, and no provider calls.

The check intentionally allows current admin, platform/background, OpenClaw, and internal AI Worker gaps only when they match `config/ai-cost-policy-baseline.json` and its Phase 4.1/4.2 metadata. Member personal image generation, member music generation, and member video generation are gateway-covered and must not regress to missing idempotency, reservation, replay, credit check, or provider suppression.

Next implementation phase: Phase 4.3 should migrate exactly one narrow admin/provider-cost flow, preferably charged admin BFL image test budget hardening, or add a report-only budget evidence collector. Production/live billing remains blocked until operator evidence is complete and reviewed.
