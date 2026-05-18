# Audit Action Plan

Date: 2026-05-18

Purpose: current remediation priorities only. Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the clean baseline for the next deep audit.

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

This plan is not production approval, live billing readiness, legal compliance certification, full tenant-isolation evidence, access-switch readiness, ownership backfill readiness, or confirmed reset approval.

## Current Priorities

| Priority | Area | Current status | Next action |
| --- | --- | --- | --- |
| P0 | Production readiness | Blocked | Verify migrations, Worker deploy state, secrets, bindings, D1/R2/Queue/DO resources, health, headers, alerts, restore drill, rollback path, and release evidence. |
| P0 | Live billing readiness | Blocked | Keep live flags off except bounded operator canaries; collect Stripe/Testmode/live evidence and define remediation/accounting/legal workflow. |
| P0 | Documentation baseline | Consolidated | Keep active docs current-state focused; archive history separately; run doc-currentness checks. |
| P1 | Admin/platform AI budgets | Scoped foundation exists | Verify current live evidence and choose one next budget/caller-policy scope deliberately. |
| P1 | Tenant ownership | Partial folder/image evidence and review tooling exists | Complete manual-review idempotency evidence; do not backfill or switch access until separately approved evidence supports it. |
| P1 | Legacy media reset | Dry-run/executor foundation exists; confirmed reset blocked | Review unsafe dry-run evidence and keep confirmation gate closed until sanitized evidence and explicit approval exist. |
| P1 | Privacy/data lifecycle | Engineering foundation exists | Complete legal-approved retention/delete/export policy and self-service flows. |
| P2 | Ops maturity | Partial | Record restore drill, live alerts, dashboard drift, load/canary, and rollback evidence. |
| P2 | Quality gates | Partial | Add staged type/lint/SAST/SBOM/dependency checks without broad rewrites. |

## Current Tenant Asset Decisions

- Owner-map evidence requires manual review.
- Manual-review operator decision: `operator_evidence_collected_needs_more_idempotency`.
- Legacy media reset dry-run decision: `legacy_media_reset_dry_run_rejected_unsafe`.
- Confirmed deletion/reset, ownership backfill, access-switching, and tenant-isolation claims remain blocked.

## Release Checklist Before Any Readiness Claim

1. `npm run release:preflight` passes.
2. `npm run check:doc-currentness` passes.
3. Release plan matches changed files and expected deploy units.
4. Required remote migrations are applied before dependent Worker deploys.
5. Secrets and bindings are verified without printing values.
6. Operator evidence is recorded for live health, security headers, resources, Stripe canaries, and rollback.

## Source Links

- Current baseline: `docs/audits/NEXT_AUDIT_BASELINE.md`
- Current summary: `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`
- Documentation index: `docs/audits/README.md`
- Historical changelog: `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- Pre-consolidation snapshots: `docs/audits/archive/`

## Documentation Rule

Do not append chronological implementation history here. Update only priorities, current blockers, and current source links.
