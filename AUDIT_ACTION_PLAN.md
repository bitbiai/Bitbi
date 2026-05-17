# Audit Action Plan

Date: 2026-04-24

Last reconciled: 2026-05-17 for DOC-1 documentation diet.

Purpose: current remediation tracker. Historical long-form action history is preserved in `docs/audits/archive/AUDIT_ACTION_PLAN_PRE_DOC1.md` and root phase reports.

Current release truth: latest auth D1 migration is `0055_add_platform_budget_evidence_archives.sql`.

This plan is not production approval, live billing readiness, legal compliance certification, or full tenant-isolation evidence.

## Current Priorities

| Priority | Area | Status | Next action |
| --- | --- | --- | --- |
| P0 | Production readiness | BLOCKED | Verify migrations through `0055`, Worker secrets/bindings, D1/R2/Queues/DOs, health, headers, alerts, restore, and rollback evidence. |
| P0 | Live billing readiness | BLOCKED | Keep live flags off except bounded canaries; collect Stripe Testmode/live evidence and define approved remediation workflow. |
| P0 | Documentation currentness | Guarded | Keep active docs short, update `docs/audits/README.md`, and run `check:doc-currentness`. |
| P1 | Admin/platform AI budgets | Partial scoped foundation | Verify Phase 4.15.1 through 4.21 evidence; choose next budget scope or internal caller-policy gap deliberately. |
| P1 | Billing operations | Partial | Move from review metadata/read-only reconciliation to approved operator remediation only after product/legal/accounting approval. |
| P1 | Tenant ownership | Partial | Plan domain-by-domain asset ownership migration with dry-run owner maps. |
| P1 | Privacy/data lifecycle | Partial | Complete legal-approved retention/delete/export policy and self-service flows. |
| P2 | Ops maturity | Partial | Record restore drill, live alert, Cloudflare dashboard drift, load, and canary evidence. |
| P2 | Quality gates | Partial | Add staged type/lint/SAST/SBOM/dependency gates without broad rewrites. |

## Completed Foundation To Preserve

- Phase 0/1 auth, service-auth, route-policy, limiter, body parsing, admin MFA, operational readiness, audit search, lifecycle, export/archive, and cleanup foundations.
- Phase 2 organization/RBAC, billing/credits/entitlements, provider-neutral billing events, guarded Stripe Testmode/live scaffolding, member credit buckets, BITBI Pro scaffolding, billing review/reconciliation, and main-only evidence planning.
- Phase 3 member image/music/video AI Cost Gateway coverage and AI cost policy baseline guard.
- Phase 4 admin/platform AI budget metadata, idempotency, switches, first `platform_admin_lab_budget` cap foundation, reconciliation, explicit repair, report/export, and evidence archive workflows.
- Phase 5.1 Admin Control Plane navigation/discoverability consolidation.

## Immediate Checklist Before Any Release Claim

1. `npm run release:preflight` passes locally.
2. `npm run check:doc-currentness` passes.
3. Release plan matches changed files and expected deploy units.
4. Required remote migrations are applied before dependent Worker deploys.
5. Secrets/bindings are verified without printing values.
6. No production/live billing claim is made without operator evidence.

## Source Evidence

- Current summary: `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`
- Documentation index: `docs/audits/README.md`
- Historical changelog: `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- Pre-DOC-1 full action-plan snapshot: `docs/audits/archive/AUDIT_ACTION_PLAN_PRE_DOC1.md`
- Root `PHASE*.md` reports

## Documentation Rule

Do not append every future phase here. Update only active priorities, current blockers, and source links.
