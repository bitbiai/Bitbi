# Alpha Audit 2026-05-15

Date: 2026-05-15

Scope: Alpha Audit hardening status. Phase 0 reconciled audit/documentation currentness. Phase 2.1 added Stripe live billing lifecycle operator-review ingestion for failed-payment, refund, dispute, and expired-checkout events; Phase 2.2 added an admin-only billing review queue/detail/resolution API for those events; Phase 2.3 exposes that API in the Admin Control Plane UI; Phase 2.4 adds a read-only local D1 billing reconciliation report for admins/operators. This report is based on repository files and local release metadata. It does not approve production deploy, remote migrations, Cloudflare changes, Stripe changes, live billing readiness, full SaaS maturity, full tenant isolation, or legal compliance.

Current release truth: `config/release-compat.json` declares the latest auth D1 migration as `0047_add_member_subscriptions_and_credit_buckets.sql`.

## Executive Summary

BITBI has a substantial Cloudflare-native SaaS foundation: static frontend, Auth/AI/Contact Workers, D1 migrations, R2 storage, Queues, Durable Objects, route policy checks, release compatibility metadata, admin MFA, data lifecycle foundations, organization/RBAC scaffolding, credit ledgers, billing event ingestion, live one-time credit-pack scaffolding, and BITBI Pro member subscription/credit-bucket scaffolding.

The weakest current area is evidence integrity. Several current-state docs lagged the release contract and still implied older auth migrations (`0040` or `0046`) were latest/current. That creates a direct production-readiness risk because operators could apply the wrong migration boundary before deploying code that expects `0047`.

Production readiness verdict: BLOCKED. The repo contains local validation and release metadata, but no verified live/staging Cloudflare, Stripe, D1/R2/Queue, webhook, billing lifecycle, restore, alert, or canary evidence is recorded here.

SaaS maturity verdict: partial foundation. Organizations, billing, member subscriptions, credits, review-only Stripe lifecycle event capture, an admin-only review queue/resolution metadata API, Admin Control Plane UI for that queue, and a read-only local billing reconciliation report exist as scaffolding and selected working paths, but full tenant ownership, automated billing remediation, legal policy, customer portal/invoice/tax handling, and broad AI cost enforcement are incomplete or need verification.

Elite-readiness score: 54/100. The architecture and guardrails are stronger than a prototype, but currentness, billing operations, tenant migration, AI cost control, observability evidence, and quality gates are not yet world-class.

## Scorecard

| Area | Score |
| --- | ---: |
| Security | 68 |
| Production readiness | 42 |
| SaaS/product maturity | 51 |
| Code maintainability | 57 |
| AI/LLM cost efficiency | 45 |
| Billing correctness | 49 |
| Tenant isolation | 38 |
| Privacy/data lifecycle | 55 |
| Observability/ops | 50 |
| Performance | 56 |
| Documentation integrity | 46 before this Phase 0 guardrail, 66 after reconciliation |

## Confirmed Findings

| ID | Severity | Category | Evidence | Why It Matters | Recommended Fix | Effort | Risk | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-001 | P0 | Documentation integrity / release safety | Current release config declares `0047_add_member_subscriptions_and_credit_buckets.sql`, while current-state docs still referenced `0040`/`0046` as current/latest before this reconciliation. Files: `README.md`, `CURRENT_IMPLEMENTATION_HANDOFF.md`, `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, `docs/privacy-data-flow-audit.md`, `workers/auth/CLAUDE.md`. | Operators can deploy code that depends on missing tables or falsely claim readiness from stale docs. | Reconcile current docs to `0047`; preserve historical phase reports; add `check:doc-currentness`. | S | Low | `npm run check:doc-currentness`, `npm run test:doc-currentness`, `npm run release:preflight`. |
| A-002 | P0 | Production readiness | Current docs repeatedly mark production deploy blocked; live validation commands require credentials and were not run in this phase. | Production claims need evidence, not local config. | Keep production readiness BLOCKED until staging/live migrations, resources, headers, health, Stripe, webhooks, queues, and rollback are verified. | M | Medium | Live/staging runbook evidence, not Codex local-only commands. |
| A-003a | P1 | Billing lifecycle | Phase 2.1 adds review-only live Stripe handling in `workers/auth/src/lib/stripe-billing.js` for `invoice.payment_failed`, `invoice.payment_action_required`, `checkout.session.expired`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`. Phase 2.2 keeps those events operator-review-only and exposes sanitized review metadata through `workers/auth/src/lib/billing-events.js` and `workers/auth/src/routes/admin-billing.js`. | This reduces blind spots but still does not automatically reverse credits, cancel accounts, reconcile balances, issue refunds, or prove live billing readiness. | Keep review-only handling; add explicit automated remediation policy only after product/legal/accounting approval. | M | High | Focused worker tests for duplicate/mismatch/no-mutation/admin sanitization/review resolution, plus future staging/live Stripe evidence. |
| A-003b | P1 | Billing reconciliation | Phase 2.2 adds admin-only review list/detail/resolution metadata for selected live Stripe failure/refund/dispute/expired events. Phase 2.3 exposes those records in the Admin Control Plane with filters, safe detail, and manual `resolved` / `dismissed` controls that require a note, confirmation, and generated `Idempotency-Key`. Phase 2.4 adds `GET /api/admin/billing/reconciliation` plus Admin Control Plane UI to compute a read-only local D1 report across provider events, checkout sessions, credit ledgers, member subscriptions, and review states. No Stripe API call, assignment queue, credit clawback, replay/remediation action, support runbook, or accounting/legal process is complete. | Operators can now inspect review state and local mismatches, but the system still does not fix balances, apply approved remediations, call Stripe, or close accounting/legal support obligations. | Build the support/accounting reconciliation process, approved remediation actions, runbook evidence, and live/staging evidence without broad rewrites. | M | High | Worker tests plus admin UI/static tests and reconciliation runbook dry run. |
| A-004 | P1 | Tenant isolation | `DATA_INVENTORY.md` and current reports state existing assets remain user-owned and are not fully migrated to tenant ownership. | Enterprise SaaS claims require org-owned asset boundaries, transfer behavior, and export/delete policy. | Migrate asset domains incrementally with owner-map backfill and tests. | L | High | Ownership tests for every media/public/private route and lifecycle export/delete planning. |
| A-005 | P1 | AI cost control | Current reports identify no single AI Cost Gateway across image/text/video/music/admin flows. | Provider calls and credit debits can diverge across flows, increasing cost and abuse risk. | Create a shared AI cost/reservation gateway after route inventory and keep route-specific adapters thin. | L | High | Route-level provider-call suppression, reservation release, replay, and cost telemetry tests. |
| A-006 | P1 | AI idempotency/replay | Some image/text/admin BFL paths have reservation/replay behavior; broad video/music/text-asset/admin routes are not uniformly covered. | Expensive retries can duplicate provider spend or charge users inconsistently. | Extend idempotency/reservation/finalization to each provider-calling route before broad paid rollout. | L | High | Provider failure/retry/replay tests per route. |
| A-007 | P1 | Privacy/data lifecycle | Data inventory states organization, billing, member subscription, buckets, storage quota, News Pulse, and OpenClaw data are not fully integrated into export/delete plans. | Legal/privacy promises cannot exceed implemented lifecycle coverage. | Update lifecycle planning/export/delete for new tables after policy approval. | M | Medium | Lifecycle planning tests and export archive fixture tests. |
| A-008 | P1 | Documentation integrity | Historical and current docs were mixed in root, and some historical reports look authoritative without an index. | Future agents/operators can use obsolete evidence. | Maintain `docs/audits/README.md`; keep historical reports immutable; add currentness check. | S | Low | `npm run check:doc-currentness`. |
| A-009 | P2 | Route policy architecture | Route-policy registry and guard exist, but current docs still describe it as metadata/checking rather than full central enforcement. | Policy drift remains possible when handlers enforce checks locally. | Plan route-policy enforcement architecture without broad rewrites. | L | Medium | Static policy guard plus route behavior tests. |
| A-010 | P2 | Quality gates | Current docs still list full type/lint/SAST/SBOM/dependency-review gaps. | Untyped large modules and missing SAST/SBOM reduce review confidence. | Add staged type/lint/SAST/SBOM gates with baselines and no broad rewrite. | M | Medium | CI quality-gate tests. |
| A-011 | P2 | Ops evidence | SLO/runbook docs exist, but live alerts, restore drills, and dashboard drift evidence remain unproven. | Operational maturity requires verified drills and alerts. | Record restore drill, alert, and drift-check evidence. | M | Medium | Runbook execution evidence and live validation logs. |
| A-012 | P2 | Frontend maintainability/performance | Current reports call out monolithic admin/frontend modules and remaining performance/accessibility review needs. | Large static modules become risky as product flows grow. | Refactor only hot spots after tests; keep vanilla architecture. | M | Medium | Static tests, accessibility/responsive/performance QA. |
| A-013 | P2 | Secret rotation | Purpose-specific secrets exist, but legacy `SESSION_SECRET` fallback remains during migration window. | Long compatibility windows increase blast radius. | Verify new secrets, allow old sessions/material to expire, then disable fallback intentionally. | M | Medium | Config validation, session/MFA/cursor/save-reference compatibility tests. |
| A-014 | P2 | Storage ownership | R2 deletion remains conservative; historical/legacy objects need owner-map evidence before destructive cleanup. | Unsafe deletion can remove cross-user or audit data. | Build owner-map/backfill dry-run and keep destructive deletion disabled until proven. | L | High | Dry-run owner-map diff and deletion executor tests. |
| A-015 | P2 | Release guardrails | Before this phase, release preflight did not check documentation currentness against `config/release-compat.json`. | Stale docs can recur after future migration changes. | Add `scripts/check-doc-currentness.mjs`, tests, package scripts, CI, and preflight integration. | S | Low | `npm run test:doc-currentness`, `npm run check:doc-currentness`, `npm run release:preflight`. |

## Immediate P0 Actions

1. Keep production deploy and live billing claims blocked.
2. Reconcile current-state docs to latest auth D1 migration `0047_add_member_subscriptions_and_credit_buckets.sql`.
3. Preserve historical phase reports exactly as historical evidence.
4. Run the doc-currentness guard in CI/preflight.
5. Before any live claim, verify migrations through `0047`, live Cloudflare bindings/secrets/resources, Stripe Testmode/live webhooks, BITBI Pro subscription behavior, failure/refund/dispute/chargeback operator-review UI and resolution evidence, Phase 2.4 read-only reconciliation report evidence, approved remediation workflow, and rollback.

## Implementation Roadmap

| Phase | Scope | Notes |
| --- | --- | --- |
| Phase 0: audit reconciliation | Currentness docs, audit index, Alpha report, doc-currentness guard. | This report covers only Phase 0. |
| Phase 1: production readiness evidence | Staging/live validation evidence, health/header checks, restore drill, alert verification. | No code readiness claim without evidence. |
| Phase 2: route-policy enforcement architecture | Move from registry/guardrails toward central enforcement where practical. | Avoid broad rewrites; migrate high-risk routes first. |
| Phase 3: billing/credit invariants | Build on Phase 2.3 review queue/resolution UI and Phase 2.4 read-only reconciliation reporting with a real reconciliation process and approved remediation policy. | Tests for duplicate/mismatch/replay/concurrency and no unintended credit mutation. |
| Phase 4: full AI cost gateway and LLM efficiency | Unified reservations, provider-call suppression, telemetry, model/cost policy. | Cover image/text/video/music/admin paths. |
| Phase 5: tenant-owned asset migration | Domain-by-domain org ownership and lifecycle coverage. | Forward-only migrations and owner-map dry runs. |
| Phase 6: quality gates and type/lint/SAST/SBOM | Incremental baselines and CI gates. | Avoid all-at-once type rewrites. |
| Phase 7: product/pricing/legal readiness | Pricing, terms, privacy, invoices, portal, tax, customer support workflows. | Requires legal/product approval. |
| Phase 8: performance/ops elite maturity | Load budgets, canaries, observability, dashboard/IaC drift controls. | Requires live evidence and rollback drills. |

## Documentation Cleanup Plan

| Category | Action |
| --- | --- |
| Current source of truth | Keep and keep reconciled: `README.md`, `CURRENT_IMPLEMENTATION_HANDOFF.md`, `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, `docs/privacy-data-flow-audit.md`, `workers/auth/CLAUDE.md`, this report. |
| Current runbook/policy | Keep and periodically verify: `SECURITY.md`, `CONTRIBUTING.md`, `docs/runbooks/*.md`, `docs/ops/*.md`, operational baselines, agent instructions. |
| Historical phase report | Keep as historical evidence: all `PHASE*.md` reports, including `PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md`. Do not rewrite migration history. |
| Historical handoff | Keep as historical context: `PHASE1_COMPLETION_HANDOFF.md`, `PHASE2A_ENTRYPOINT.md`. |
| Superseded/currently stale | Archive/update candidate: older privacy follow-up/compliance notes, proposal backlogs, and cleanup notes. Do not delete in this phase. |
| Remove-candidate | No first-party Markdown is approved for removal in this phase. Future archive/remove candidate means archive/remove candidate - do not delete in this phase until approved. |

See `docs/audits/README.md` for the living audit/documentation index.

## Validation Commands

Safe local commands for Alpha hardening implementation:

```bash
npm run check:js
npm run check:secrets
npm run check:route-policies
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run check:doc-currentness
npm run release:preflight
git diff --check
git status --short
```

Additional doc-currentness and Phase 2.1/2.2/2.3 billing lifecycle validation:

```bash
npm run test:doc-currentness
npx playwright test -c playwright.workers.config.js -g "Stripe live billing lifecycle review"
npx playwright test -c playwright.workers.config.js -g "billing review"
npx playwright test tests/auth-admin.spec.js -g "billing review queue"
npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "billing reconciliation"
npx playwright test tests/auth-admin.spec.js -g "billing reconciliation"
```

Commands requiring live credentials or remote mutation remain out of scope for this phase.
