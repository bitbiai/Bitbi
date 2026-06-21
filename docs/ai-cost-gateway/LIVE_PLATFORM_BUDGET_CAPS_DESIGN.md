# Live Platform Budget Caps Design

Date: 2026-06-21

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

Status: current design/current-state summary for platform budget caps. This document is not a phase history and does not approve production readiness or live billing readiness.

## Current Verdict

- Runtime budget switches exist for already classified admin/platform provider-cost paths.
- D1 app switches exist as an operator-controlled second layer for those paths.
- `platform_admin_lab_budget` has the first cap foundation for selected admin lab operations.
- `openclaw_news_pulse_budget` uses the same cap foundation for News Pulse visual provider work.
- Reconciliation, admin-approved repair, report/export, and sanitized archive evidence exist for the `platform_admin_lab_budget` foundation.
- Other budget scopes remain future work.
- These controls are not customer billing, Stripe billing, credit refund logic, or production readiness proof.

## Switches Vs. Caps

| Control | Question answered | Current behavior |
| --- | --- | --- |
| Cloudflare master switch | May this provider-cost route execute at all? | Missing/false/unrecognized values fail closed for covered routes. |
| D1 app switch | Has the operator enabled this route in app state? | Missing/disabled/unavailable rows fail closed for covered routes. |
| Platform cap | Is remaining configured platform spend available in the current window? | Implemented for selected `platform_admin_lab_budget` operations and News Pulse visual operations under `openclaw_news_pulse_budget`. |

Switches are binary operator controls. Caps require durable usage events, window accounting, active limits, and deterministic exceeded behavior.

## Implemented Cap Foundation

Current `platform_admin_lab_budget` cap coverage includes:

- Admin Text.
- Admin Embeddings.
- Admin Music.
- Admin Compare.
- Admin Live-Agent.
- Admin async video jobs.

Current `openclaw_news_pulse_budget` cap coverage includes:

- OpenClaw ingest-triggered News Pulse visual generation.
- Scheduled News Pulse visual backfill.

Covered paths must pass:

1. route auth/admin/MFA/same-origin/rate-limit guards,
2. the Cloudflare master budget switch,
3. the D1 app switch,
4. the active platform cap check,
5. the existing idempotency/attempt/job safety path.

Missing active cap configuration, unavailable D1, invalid budget metadata, disabled switches, or exceeded caps block before provider/internal AI/queue/durable-attempt work.

## Current Data Model

The cap foundation uses additive local schema:

- `platform_budget_limits` for active operator limits.
- `platform_budget_limit_events` for bounded update evidence and idempotency checks.
- `platform_budget_usage_events` for sanitized successful provider-cost usage evidence.
- `platform_budget_repair_actions` for explicit repair/review actions.
- `platform_budget_evidence_archives` for sanitized archive metadata.

Relevant migrations:

- `0053_add_platform_budget_caps.sql`
- `0054_add_platform_budget_repair_actions.sql`
- `0055_add_platform_budget_evidence_archives.sql`

Remote migration application is not proven by this document.

## Countability By Scope

| Scope | Current countability | Cap status |
| --- | --- | --- |
| `platform_admin_lab_budget` | Countable for covered admin lab operations through attempts/jobs and usage events. | First foundation implemented. |
| `openclaw_news_pulse_budget` | Countable for covered News Pulse visual provider work through item metadata/status and usage events. | Cap foundation implemented; repair/reconciliation remains limited. |
| `platform_background_budget` | Not centralized. | Future schema/usage-event work. |
| `admin_org_credit_account` | Countable through org credit debit evidence. | Separate from platform caps. |
| `explicit_unmetered_admin` | Metadata only for narrow exception branches. | Keep switch disabled unless intentionally testing. |
| `internal_ai_worker_caller_enforced` | Count through caller scopes, not AI Worker globals. | Remaining caller migration work. |

Member and organization credit routes remain outside platform caps and keep their own credit policy.

## Repair And Evidence Model

- Reconciliation compares usage events against successful source attempts/jobs where local D1 evidence supports the check.
- Repair is explicit admin-approved only.
- Executable repair is limited to creating a missing safe usage event when source evidence proves success and no matching usage event exists.
- Duplicate, orphan, failed-source, window, and missing-cost issues remain review-only unless a future approved design expands scope.
- Report/export endpoints are read-only and sanitized.
- Evidence archives store JSON/Markdown snapshots under the private `AUDIT_ARCHIVE` prefix `platform-budget-evidence/`.
- Archive cleanup must refuse keys outside the approved prefix.

## Cap-Exceeded Behavior

Expected behavior for covered routes:

- fail closed before provider, internal AI, queue, credit, or durable-attempt work;
- return sanitized admin-only JSON;
- include safe budget scope, operation id, route/source summary, and correlation details;
- avoid mutating credits, Stripe, Cloudflare, provider resources, or unrelated rows;
- preserve existing idempotency semantics.

## Current Gaps

- `platform_background_budget` does not have centralized usage events.
- Explicit-unmetered admin branches need stronger aggregate accounting before broader use.
- Internal AI Worker provider-cost routes rely on caller enforcement and now fail closed without caller policy; aggregate cap accounting for `internal_ai_worker_caller_enforced` remains future work.
- Operator/live evidence is required before production or live billing claims.

## Operator Guidance

- Keep admin/platform provider-cost flags off unless intentionally collecting bounded evidence.
- Apply and verify required remote migrations before deploying dependent Auth Worker code.
- Configure daily/monthly limits before enabling covered platform-admin routes.
- Record switch, cap, reconciliation, repair, report/export, and archive evidence before making operational claims.
- Do not treat platform budget caps as customer billing readiness.

## Checks

```bash
npm run check:ai-cost-policy
npm run test:admin-platform-budget-policy
npm run test:admin-platform-budget-evidence
npm run report:ai-budget-evidence
```
