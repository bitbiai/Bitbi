# AI Cost Route Inventory

Date: 2026-05-18

Status: current provider-cost route inventory. This document summarizes current route classes and known gaps; detailed historical phase narrative belongs in the audit archive/changelog.

Production readiness remains BLOCKED. Live billing readiness remains BLOCKED.

## Inventory Legend

- Idempotency: required, delegated, metadata-only, not applicable, or gap.
- Reservation: pre-provider durable reservation/attempt or equivalent duplicate-provider suppression.
- Replay: full result replay, safe metadata replay, replay-unavailable terminal response, or gap.
- Billing scope: member credits, organization credits, selected-organization admin debit, platform budget, explicit unmetered, or caller-enforced.

## Current Route Classes

| Route class | Main routes / triggers | Billing scope | Current controls | Current gaps |
| --- | --- | --- | --- | --- |
| Member image generation | `POST /api/ai/generate-image` without organization context | `member_credit_account` | Required `Idempotency-Key`, member reservation, duplicate-provider suppression, safe replay/replay-unavailable, exactly-once success debit, provider-failure no-charge. | Live billing/operator evidence remains required. |
| Organization image/text generation | `POST /api/ai/generate-image`, `POST /api/ai/generate-text` with org context | `organization_credit_account` | Organization entitlement/credit checks and `ai_usage_attempts` reservation/replay. | Gateway adapter parity can be improved later. |
| Member music generation | `POST /api/ai/generate-music` | `member_credit_account` | Parent reservation covers lyrics/audio/cover bundle, duplicate-provider suppression, safe persisted-asset replay, no-charge provider failure, success debit after durable save. | Cover cost policy remains bundled; repeated cover failures need ongoing review. |
| Member video generation | `POST /api/ai/generate-video` | `member_credit_account` | Parent reservation, duplicate-provider suppression, durable saved-asset replay, replay-unavailable terminal response, success debit after durable persistence. | Live canary and provider-output ingestion evidence remain required. |
| Charged admin image tests | `POST /api/admin/ai/test-image` for priced models | `admin_org_credit_account` | Admin-only/MFA route, selected organization required, idempotency required, org credit debit path, safe budget/caller metadata, switch controls. | Not live billing readiness; operator evidence required. |
| Explicit unmetered admin image exception | Narrow allowlisted admin model branch | `explicit_unmetered_admin` | Classified, sanitized metadata, switch-controlled, no credit debit. | Keep disabled unless bounded operator testing is approved; aggregate cap accounting remains limited. |
| Admin text/embeddings/music/compare/live-agent | `POST /api/admin/ai/test-*`, `/compare`, `/live-agent` | `platform_admin_lab_budget` | Required idempotency, metadata-only durable attempts, caller-policy propagation, switches, D1 app switches, cap foundation, sanitized response metadata. | Full result replay is not claimed; live evidence required. |
| Admin async video jobs | `POST /api/admin/ai/video-jobs` plus queue consumer | `platform_admin_lab_budget` | Required idempotency for job creation, safe job/queue budget metadata, caller-policy validation, duplicate task suppression, switches, cap foundation, usage evidence. | Live provider/job canary evidence required. |
| Admin sync video debug | `POST /api/admin/ai/test-video` | emergency/debug only | Disabled by default before provider/proxy work. | Not a supported budgeted path; avoid use outside approved emergency debugging. |
| OpenClaw/News Pulse visuals | signed ingest waitUntil and scheduled visual backfill | `openclaw_news_pulse_budget` | Safe budget metadata/status, duplicate suppression through item status/attempt caps, runtime switch before provider visual work. | Aggregate cap enforcement remains future work. |
| Internal AI Worker service routes | `/internal/ai/*` provider-cost routes | caller-dependent | Service auth first; caller-policy metadata required before provider execution; reserved metadata stripped before provider payloads; Auth/AI route compatibility is modeled in `config/release-compat.json`. | Aggregate cap accounting for `internal_ai_worker_caller_enforced` remains future work. |
| Generated asset save/derivatives | image/audio/text save, poster/derivative queue | not AI provider cost | Storage quota/derivative policy, R2/D1 lifecycle, queue leases. | Track storage/transform cost separately from provider AI gateway. |

Current route-policy IDs covered here include `admin.ai.test-text`, `admin.ai.test-embeddings`, `admin.ai.test-music`, `admin.ai.compare`, `admin.ai.live-agent`, `admin.ai.video-jobs`, `admin.ai.video-job-read`, `admin.ai.video-job-cancel`, `admin.ai.test-video`, `openclaw.news_pulse.ingest`, and the member AI generation routes.

## Current Registry State

`workers/auth/src/lib/ai-cost-operations.js` is the current operation registry. It is used by:

- member gateway routes,
- admin/platform budget evidence,
- admin async video job code,
- News Pulse visual code,
- admin lab routes,
- `npm run check:ai-cost-policy`,
- `npm run test:ai-cost-operations`.

The registry separates current enforcement status from target policy. Do not mark a provider-cost route as complete unless the registry, route-policy metadata, tests, and operator evidence all support the claim.

## Current Cross-Cutting Evidence

- `workers/auth/src/app/route-policy.js` records billing/budget metadata for relevant member/admin/platform routes.
- `workers/auth/src/lib/ai-usage-policy.js` and attempt helpers enforce organization and member reservations.
- `workers/auth/src/lib/admin-ai-idempotency.js` supports metadata-only admin attempt idempotency.
- `workers/auth/src/lib/admin-platform-budget-policy.js` builds safe budget plan/audit metadata.
- `workers/auth/src/lib/admin-platform-budget-switches.js` and `workers/auth/src/lib/platform-budget-caps.js` enforce covered admin/platform controls.
- `workers/auth/src/lib/admin-platform-budget-evidence.js`, reconciliation, repair, report, and archive helpers provide admin-only sanitized evidence.
- `workers/ai/src/lib/caller-policy.js` validates internal caller-policy metadata after service auth.

Evidence/report/archive layers must remain bounded and sanitized. They must not call providers or Stripe, mutate credits, mutate billing, run repairs automatically, or prove live readiness by themselves.

## Current Highest-Risk Gaps

- Internal AI Worker caller-policy enforcement is fail-closed for provider-cost routes; aggregate cap accounting for `internal_ai_worker_caller_enforced` remains future work.
- Platform budget scopes outside `platform_admin_lab_budget`, especially OpenClaw/News Pulse aggregate caps.
- Admin explicit-unmetered branches without durable aggregate accounting.
- Live/manual evidence for provider behavior, cap behavior, and billing/canary behavior.
- Legal/accounting/operator readiness for customer billing remains outside the AI cost gateway itself.

## Verification Commands

```bash
npm run check:ai-cost-policy
npm run test:ai-cost-policy
npm run test:ai-cost-operations
npm run test:ai-cost-gateway
npm run test:admin-platform-budget-policy
npm run test:admin-platform-budget-evidence
```
