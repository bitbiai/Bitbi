# AI Cost Gateway

Date: 2026-05-15

Status: Phase 3.3 operation registry and report-only baseline. Phase 3.1 added design and inventory. Phase 3.2 added an unused gateway contract/helper module and deterministic tests. Phase 3.3 adds a central operation registry for known AI provider-cost operations and strengthens the report-only policy check. It does not change runtime AI charging behavior, provider routing, credit debits, reservations, replay, billing, migrations, deployment, or public pricing.

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
- Member image/music/video routes check credits before provider execution and charge after success, but member idempotency is not mandatory and provider execution is not uniformly suppressed on retries.
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
- normalized target operation configs for 30 known AI cost operations
- current enforcement metadata for idempotency, reservation, replay, credit checks, and provider-call suppression
- route-policy and provider-call source baselines for the report-only checker

The registry is not imported by any live route yet.

## Phase 3.1 / 3.2 / 3.3 Non-Goals

These phases do not:

- require idempotency on any runtime route
- add new reservations
- suppress provider calls
- add replay/cache behavior
- change credit debit behavior
- change model routing
- add migrations
- call AI providers
- call Stripe APIs
- change public billing or pricing
- deploy anything
- approve production or live billing readiness

## Documents

- `AI_COST_ROUTE_INVENTORY.md` records known provider-cost routes and current idempotency/reservation/replay/credit behavior.
- `AI_COST_GATEWAY_DESIGN.md` defines the target gateway lifecycle and route adapter contract.
- `AI_COST_GATEWAY_ROADMAP.md` splits future implementation into small, reviewable phases.
- `workers/auth/src/lib/ai-cost-operations.js` records the Phase 3.3 report-only operation registry.

## Local Check

`npm run check:ai-cost-policy` is a report-only local inventory guard. It validates the Phase 3.3 operation registry, scans route-policy metadata, checks known AI provider-call source files, and compares against the inventory document. It does not call providers, read secrets, deploy, migrate, or mutate local/remote state.

`npm run test:ai-cost-gateway` runs deterministic unit tests for the Phase 3.2 contract helpers. It does not call providers, read secrets, deploy, migrate, use D1/R2, or mutate local/remote state.

`npm run test:ai-cost-operations` validates the Phase 3.3 registry baseline, uniqueness, target config normalization, deterministic summary counts, source-file coverage, duplicate detection, and no external calls.

The check intentionally reports current gaps without failing by default. A future enforcement phase can move selected rules to strict mode after the gateway contract exists and routes are migrated.

Next implementation phase: Phase 3.4 should migrate exactly one low-risk route, preferably member personal image generation, unless local evidence shows another route is safer.
