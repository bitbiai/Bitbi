# AI Cost Gateway

Date: 2026-05-15

Status: Phase 3.5 member music cost decomposition and gateway prep. Phase 3.1 added design and inventory. Phase 3.2 added the gateway contract/helper module and deterministic tests. Phase 3.3 added a central operation registry for known AI provider-cost operations and strengthened the report-only policy check. Phase 3.4 uses that foundation only for member personal image generation. Phase 3.4.1 adds main-only release/evidence guidance for the image pilot. Phase 3.5 decomposes member music into parent, lyrics, audio, and cover operations for future migration. It does not migrate music, video, admin AI, platform/background AI, internal AI Worker routes, org-scoped routes, Stripe, deployment, or public pricing.

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
- Member personal image generation now requires `Idempotency-Key`, reserves member credits before provider execution, suppresses same-key duplicate provider calls, replays safe stored temporary image metadata when available, debits once after provider success, and releases/no-charges on provider failure.
- Member music/video routes check credits before provider execution and charge after success, but member idempotency is not mandatory and provider execution is not uniformly suppressed on retries.
- Admin AI Lab text/music/video/compare/live-agent routes are admin-only but generally uncharged and do not use a shared cost lifecycle.
- News Pulse visual generation and generated music cover creation can call AI providers outside the member billing lifecycle.

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

The registry is now imported by the Phase 3.4 member personal image pilot only.

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

## Current Non-Goals

Phase 3.5 does not:

- migrate music routes
- migrate video routes
- migrate admin AI routes
- migrate platform/background AI routes
- migrate internal AI Worker routes
- change org-scoped image/text behavior
- change model routing
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
- `workers/auth/src/lib/ai-cost-operations.js` records the Phase 3.3 operation registry and the Phase 3.4 member-image pilot status.

## Local Check

`npm run check:ai-cost-policy` is a report-only local inventory guard. It validates the Phase 3.3 operation registry, scans route-policy metadata, checks known AI provider-call source files, and compares against the inventory document. It does not call providers, read secrets, deploy, migrate, or mutate local/remote state.

`npm run test:ai-cost-gateway` runs deterministic unit tests for the Phase 3.2 contract helpers. It does not call providers, read secrets, deploy, migrate, use D1/R2, or mutate local/remote state.

`npm run test:ai-cost-operations` validates the Phase 3.3 registry baseline, uniqueness, target config normalization, deterministic summary counts, source-file coverage, duplicate detection, and no external calls.

The check intentionally reports current gaps without failing by default. It now treats member personal image generation as pilot-covered, decomposes member music gaps by sub-operation, and continues to report member music/video, admin, platform/background, and internal AI Worker gaps.

Next implementation phase: Phase 3.6 should migrate member music generation in a narrow PR, accounting for parent reservation, lyrics/audio sub-operation suppression, durable result replay, cover budget policy, and billing finalization safety. Do not begin Phase 3.6 until Phase 3.4 deploy/evidence is recorded, or the owner explicitly accepts skipping that evidence in writing.
