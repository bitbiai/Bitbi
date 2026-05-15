# AI Cost Gateway

Date: 2026-05-15

Status: Phase 3.1 design and inventory only. This folder does not change runtime AI charging behavior, provider routing, credit debits, reservations, replay, billing, migrations, deployment, or public pricing.

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

## Phase 3.1 Non-Goals

This phase does not:

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

## Local Check

`npm run check:ai-cost-policy` is a report-only local inventory guard. It scans route-policy metadata, known AI provider-call source files, and the Phase 3.1 inventory document. It does not call providers, read secrets, deploy, migrate, or mutate local/remote state.

The check intentionally reports current gaps without failing by default. A future enforcement phase can move selected rules to strict mode after the gateway contract exists and routes are migrated.
