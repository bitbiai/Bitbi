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
- Phase 6.1 tenant asset ownership design/inventory/risk docs exist; Phase 6.2 adds the focused `ai_folders`/`ai_images` owner-map dry run; Phase 6.3 adds the schema/access plan; Phase 6.4 adds nullable ownership metadata schema; Phase 6.5 assigns metadata only on new personal folder/image writes; Phase 6.6 adds read-only dual-read diagnostics; Phase 6.7 adds admin-only evidence report/export; Phase 6.8 adds evidence collection runbook/template/checklist only; Phase 6.9 adds the main-only evidence package; Phase 6.10 reviews real main evidence, records `needs_manual_review`, and keeps access-check switching/backfill blocked; Phase 6.11 adds manual-review workflow design only; Phase 6.12 adds manual-review state schema design only, with no migration, review rows, old-row backfill, or access behavior change.
- Historical phase reports and pre-DOC-1 long-form docs are archived/indexed instead of expanded in active docs.

## Current Open Blockers

- Remote migrations through `0056` must be applied before dependent auth Worker deploys.
- Live Cloudflare resources, Worker secrets, D1/R2/Queue/DO bindings, WAF/static headers/RUM/alerts, restore drills, and rollback evidence are not recorded here.
- Live Stripe credit packs and BITBI Pro remain gated canary scaffolding, not live billing readiness.
- Billing remediation, refund/dispute/accounting/legal workflows remain incomplete.
- Tenant-owned asset migration implementation and self-service privacy flows remain incomplete; Phase 6.7 evidence reports, Phase 6.8 collection docs, Phase 6.9 evidence package, Phase 6.10 main evidence decision, Phase 6.11 manual-review workflow, and Phase 6.12 review-state schema design are read-only/evidence/design-only and did not add review-state migration/review rows, migrate old rows, assign organization ownership, change access checks, or move/list/delete R2 objects.
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

Use `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` as the current Phase 6.10 decision, `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md` for the Phase 6.11 review design, and `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md` for the Phase 6.12 schema design. The next tenant-asset step should be Phase 6.13 additive manual-review state schema, with no review-row import, broad backfill, or access behavior change.

## Historical Evidence Links

- `docs/audits/README.md`
- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- root `PHASE*.md` reports
- `ALPHA_AUDIT_2026_05_15.md`
