# AI Cost Gateway Roadmap

Date: 2026-06-21

Status: domain candidate roadmap only. This is not a historical audit plan, not an active audit backlog, and does not approve production readiness or live billing readiness. Future audits must reconfirm any item from current repo state before treating it as active work.

## Current Baseline

- Member image/music/video routes use the AI Cost Gateway pattern for implemented personal-credit scopes.
- Organization image/text routes retain their established organization-credit attempt policy.
- Charged admin image tests use selected-organization credits and admin budget metadata.
- Admin text, embeddings, music, compare, live-agent, and async video jobs use `platform_admin_lab_budget` metadata, idempotency, caller-policy propagation where applicable, switches, D1 app switches, and the first cap foundation.
- OpenClaw/News Pulse visuals use `openclaw_news_pulse_budget` metadata/status, runtime switch control, daily/monthly platform cap checks, and bounded usage events for provider-cost thumbnail work.
- Platform budget reconciliation, explicit repair, report/export, and sanitized archives exist for `platform_admin_lab_budget`.
- Production readiness and live billing readiness remain blocked.

## Current Non-Goals

- Do not broaden customer billing, refunds, Stripe automation, tax handling, or live billing claims through AI budget work.
- Do not enable real provider calls in tests.
- Do not turn metadata-only admin replay into full output replay without a separate safety design.
- Do not migrate every internal AI Worker route at once.
- Do not combine platform budget caps, billing readiness, and tenant asset ownership work into one large change.

## Safety / Truth Work

| ID | Goal | Scope | Required evidence |
| --- | --- | --- | --- |
| AI-SAFETY-01 | Keep release/readiness docs aligned with `config/release-compat.json`. | Docs/check tooling only. | Doc-currentness and release readiness checks pass. |
| AI-SAFETY-02 | Keep provider-cost route inventory current. | Registry, route-policy metadata, AI cost inventory docs, local tests. | `check:ai-cost-policy` and related tests detect route drift. |
| AI-SAFETY-03 | Collect live/operator evidence for current budget switches/caps/archive flows. | Operator evidence only; no new provider path. | Sanitized evidence archives, switch/cap state, no secret/provider payload leakage. |

## Budget Coverage Work

| ID | Goal | Candidate files | Notes |
| --- | --- | --- | --- |
| AI-COVERAGE-01 | Monitor `openclaw_news_pulse_budget` cap evidence after aggregate cap implementation. | `news-pulse-visuals`, cap helpers, evidence report, Worker tests. | A1 Wave 2 implemented provider-preflight caps for News Pulse visuals; live/operator evidence and repair/reconciliation are still limited. |
| AI-COVERAGE-02 | Harden remaining internal AI Worker caller-policy gaps. | Auth callers, `workers/ai/src/lib/caller-policy.js`, route-policy, tests. | Migrate one caller family at a time and keep service auth as the first gate. |
| AI-COVERAGE-03 | Add durable usage accounting for explicit-unmetered admin exceptions before any broader use. | Admin AI route, budget usage helpers, tests. | Keep exceptions disabled unless operator explicitly accepts bounded risk. |
| AI-COVERAGE-04 | Review admin metadata-only replay policy route by route. | Admin idempotency helper, routes, evidence docs. | Full result replay should be added only where raw output storage is safe and useful. |

## Billing / Product Quality Work

| ID | Goal | Scope | Notes |
| --- | --- | --- | --- |
| AI-BILLING-01 | Separate platform budget evidence from customer billing evidence in admin UX and docs. | Admin copy/docs/tests. | Avoid implying platform caps are Stripe/customer billing readiness. |
| AI-BILLING-02 | Strengthen live canary runbooks for member AI debits. | Production-readiness docs/evidence templates. | No live billing claim without operator canaries and rollback proof. |
| AI-BILLING-03 | Improve storage/transform cost visibility for derivatives and generated asset saves. | Storage quota/evidence docs, admin reports. | Keep separate from provider AI gateway unless provider calls are involved. |

## Maintainability Work

| ID | Goal | Scope | Notes |
| --- | --- | --- | --- |
| AI-MAINT-01 | Reduce duplicated admin budget response shaping. | Admin AI helpers/tests. | Preserve response shapes consumed by Admin UI. |
| AI-MAINT-02 | Keep AI cost docs current-state oriented. | `docs/ai-cost-gateway/`. | Historical implementation detail belongs in archived audit docs. |
| AI-MAINT-03 | Add focused performance checks for evidence/report scans. | Script/report tests. | Avoid unbounded D1 scans and oversized archive payloads. |

## Safe Implementation Sequence

1. Keep local policy checks green: `npm run check:ai-cost-policy`, `npm run test:ai-cost-policy`, `npm run test:ai-cost-operations`.
2. Pick one route family or budget scope.
3. Add or update registry metadata first.
4. Add route-policy metadata and tests.
5. Add runtime guard only after dry-run/evidence behavior is clear.
6. Preserve existing idempotency and duplicate-provider suppression.
7. Add sanitized evidence/report output.
8. Update docs without phase history.
9. Run release compatibility and readiness checks.
10. Collect live/operator evidence separately before any readiness claim.

## Validation Commands

```bash
npm run check:ai-cost-policy
npm run test:ai-cost-policy
npm run test:ai-cost-operations
npm run test:ai-cost-gateway
npm run test:admin-platform-budget-policy
npm run test:admin-platform-budget-evidence
npm run validate:release
npm run test:release-plan
```

## Blocked Claims

- Production readiness remains BLOCKED.
- Live billing readiness remains BLOCKED.
- Platform budget controls are not customer billing.
- Operator/live evidence remains required.
- Remote migrations are not assumed applied.
