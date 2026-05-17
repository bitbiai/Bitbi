# Audit Action Plan

Date: 2026-04-24

Last reconciled: 2026-05-17 for Phase 6.22 tenant asset legacy personal media reset executor design.

Purpose: current remediation tracker. Historical long-form action history is preserved in `docs/audits/archive/AUDIT_ACTION_PLAN_PRE_DOC1.md` and root phase reports.

Current release truth: latest auth D1 migration is `0057_add_ai_asset_manual_review_state.sql`.

This plan is not production approval, live billing readiness, legal compliance certification, or full tenant-isolation evidence.

## Current Priorities

| Priority | Area | Status | Next action |
| --- | --- | --- | --- |
| P0 | Production readiness | BLOCKED | Verify migrations through `0057`, Worker secrets/bindings, D1/R2/Queues/DOs, health, headers, alerts, restore, and rollback evidence. |
| P0 | Live billing readiness | BLOCKED | Keep live flags off except bounded canaries; collect Stripe Testmode/live evidence and define approved remediation workflow. |
| P0 | Documentation currentness | Guarded | Keep active docs short, update `docs/audits/README.md`, and run `check:doc-currentness`. |
| P1 | Admin/platform AI budgets | Partial scoped foundation | Verify Phase 4.15.1 through 4.21 evidence; choose next budget scope or internal caller-policy gap deliberately. |
| P1 | Billing operations | Partial | Move from review metadata/read-only reconciliation to approved operator remediation only after product/legal/accounting approval. |
| P1 | Tenant ownership | New personal folder/image writes assigned; read diagnostics, admin evidence report, evidence collection docs, Phase 6.10 real main evidence decision, Phase 6.11 manual-review workflow, Phase 6.12 review-state schema design, Phase 6.13 empty review-state tables, Phase 6.14 import dry-run planning, Phase 6.15 admin-approved review-item import executor, Phase 6.16 read-only review queue/evidence APIs, Phase 6.17 admin-approved review-status workflow, Phase 6.18 Admin queue/status visibility, Phase 6.19 operator evidence package, Phase 6.20 operator evidence decision update, Phase 6.21 legacy media reset dry-run/export, and Phase 6.22 reset executor design added; old rows unbackfilled | Use `docs/tenant-assets/`, `npm run dry-run:tenant-assets:images`, `/api/admin/tenant-assets/folders-images/evidence`, `docs/tenant-assets/evidence/`, `npm run tenant-assets:dry-run-review-import`, `POST /api/admin/tenant-assets/folders-images/manual-review/import`, read-only `/manual-review/items` plus `/manual-review/evidence`, `POST /manual-review/items/:id/status`, Admin Control Plane queue/status evidence, `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`, `/api/admin/tenant-assets/legacy-media-reset/dry-run`, and `LEGACY_PERSONAL_MEDIA_RESET_EXECUTOR_DESIGN.md`; current decision is `operator_evidence_collected_needs_more_idempotency`; no ownership backfill, ownership metadata update, source asset row update, review row/status change by Codex/tests, media deletion, R2 action, reset executor, or access change. |
| P1 | Privacy/data lifecycle | Partial | Complete legal-approved retention/delete/export policy and self-service flows. |
| P2 | Ops maturity | Partial | Record restore drill, live alert, Cloudflare dashboard drift, load, and canary evidence. |
| P2 | Quality gates | Partial | Add staged type/lint/SAST/SBOM/dependency gates without broad rewrites. |

## Completed Foundation To Preserve

- Phase 0/1 auth, service-auth, route-policy, limiter, body parsing, admin MFA, operational readiness, audit search, lifecycle, export/archive, and cleanup foundations.
- Phase 2 organization/RBAC, billing/credits/entitlements, provider-neutral billing events, guarded Stripe Testmode/live scaffolding, member credit buckets, BITBI Pro scaffolding, billing review/reconciliation, and main-only evidence planning.
- Phase 3 member image/music/video AI Cost Gateway coverage and AI cost policy baseline guard.
- Phase 4 admin/platform AI budget metadata, idempotency, switches, first `platform_admin_lab_budget` cap foundation, reconciliation, explicit repair, report/export, and evidence archive workflows.
- Phase 5.1 Admin Control Plane navigation/discoverability consolidation.
- Phase 6.1 tenant asset ownership design, inventory, risk matrix, Phase 6.2 `ai_folders`/`ai_images` owner-map dry-run/test scripts, Phase 6.3 schema/access impact plan, Phase 6.4 nullable ownership metadata schema, Phase 6.5 new personal folder/image write metadata assignment, Phase 6.6 read-only dual-read diagnostics, Phase 6.7 admin-only evidence report/export, Phase 6.8 evidence collection docs, Phase 6.9 main-only evidence package, Phase 6.10 real main evidence decision, Phase 6.11 manual-review workflow design, Phase 6.12 review-state schema design, Phase 6.13 empty review-state tables, Phase 6.14 import dry-run planning, Phase 6.15 review-item import executor, Phase 6.16 read-only queue/evidence APIs, Phase 6.17 review-status workflow, Phase 6.18 Admin queue/status visibility, Phase 6.19 operator evidence collection docs, Phase 6.20 operator evidence decision update, Phase 6.21 legacy media reset dry-run/export, and Phase 6.22 reset executor design with no old-row backfill, source asset row update, ownership metadata update, review row/status change by Codex/tests, media deletion, R2 listing/mutation, reset executor, endpoint, UI, migration, access-check, gallery, quota, lifecycle, or billing behavior mutation.

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
