# Alpha Audit Current Summary

Last updated: 2026-05-17

Latest auth migration: `0056_add_ai_folder_image_ownership_metadata.sql`

Production readiness: BLOCKED

Live billing readiness: BLOCKED

This is the short operator-facing audit summary. It does not approve deploys, live billing, legal compliance, full tenant isolation, or full SaaS maturity.

## Current Done

- Static site plus Cloudflare Workers architecture is preserved and release-modeled.
- Auth, session, admin MFA, route policy, service auth, replay protection, body limits, limiter, and secret-purpose guardrails exist.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, BITBI Pro scaffolding, billing review queue, billing reconciliation, and main-only evidence tooling exist.
- Member image/music/video AI Cost Gateway flows are migrated with required idempotency and duplicate-provider suppression.
- Admin/platform AI budget controls exist for classified routes: Cloudflare master switches, D1 app switches, first `platform_admin_lab_budget` caps, read-only reconciliation, explicit admin-approved repair, report/export, and sanitized archives.
- Admin Control Plane navigation now surfaces the implemented operator panels without changing backend behavior.
- Phase 6.1 tenant asset ownership design/inventory/risk docs exist; Phase 6.2 adds the focused `ai_folders`/`ai_images` owner-map dry run; Phase 6.3 adds the schema/access plan; Phase 6.4 adds nullable ownership metadata schema; Phase 6.5 assigns metadata only on new personal folder/image writes; Phase 6.6 adds read-only dual-read diagnostics; Phase 6.7 adds admin-only evidence report/export; Phase 6.8 adds evidence collection runbook/template/checklist only, with no old-row backfill or access behavior change.
- Historical phase reports and pre-DOC-1 long-form docs are archived/indexed instead of expanded in active docs.

## Current Open Blockers

- Remote migrations through `0056` must be applied before dependent auth Worker deploys.
- Live Cloudflare resources, Worker secrets, D1/R2/Queue/DO bindings, WAF/static headers/RUM/alerts, restore drills, and rollback evidence are not recorded here.
- Live Stripe credit packs and BITBI Pro remain gated canary scaffolding, not live billing readiness.
- Billing remediation, refund/dispute/accounting/legal workflows remain incomplete.
- Tenant-owned asset migration implementation and self-service privacy flows remain incomplete; Phase 6.7 evidence reports and Phase 6.8 collection docs are read-only/evidence-only and did not migrate old rows, assign organization ownership, change access checks, or move/list/delete R2 objects.
- Remaining AI budget scopes/internal provider routes are future work.

## Deployment Requirements

1. Run release checks locally.
2. Apply required D1 migrations before auth Worker code that depends on them.
3. Verify secrets and bindings without exposing values.
4. Keep live/budget/billing flags disabled unless an operator intentionally runs a bounded canary.
5. Record evidence in production-readiness templates before any readiness claim.

## Current Admin/AI/Billing State

- Admin Control Plane is the operator surface for users, billing, lifecycle, readiness, AI Lab, AI usage, budget switches, caps, reconciliation, repair, reports, and archives.
- Budget switch execution requires Cloudflare master flag plus D1 app switch; app switches cannot mutate Cloudflare.
- `platform_admin_lab_budget` has the first daily/monthly cap foundation; other scopes remain future work.
- Repair execution is explicit admin-approved only and limited to safe usage-evidence repair/review notes.
- Reports and archives are sanitized evidence snapshots only.

## Next Recommended Step

Use `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md` to collect bounded main/live evidence from the Phase 6.7 folders/images evidence report after deployment. If implementation continues, Phase 6.9 should collect staging/main owner-map evidence for AI folders/images, with no broad backfill or access behavior change.

## Historical Evidence Links

- `docs/audits/README.md`
- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- root `PHASE*.md` reports
- `ALPHA_AUDIT_2026_05_15.md`
