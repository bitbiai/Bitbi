# Alpha Audit Current Summary

Last updated: 2026-05-17

Latest auth migration: `0058_add_legacy_media_reset_actions.sql`

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
- Phase 6.1-6.20 add tenant asset ownership/manual-review evidence foundations. Phase 6.21 adds legacy media reset dry-run/export planning. Phase 6.22 adds reset executor design. Phase 6.23 adds reset action/event tracking plus a dry-run-default admin-approved executor path, with no old-row ownership backfill, ownership metadata update, access switch, live/main reset execution by Codex/tests, live R2 listing/mutation, billing/credit mutation, or tenant-isolation claim.
- Historical phase reports and pre-DOC-1 long-form docs are archived/indexed instead of expanded in active docs.

## Current Open Blockers

- Remote migrations through `0058` must be applied before dependent auth Worker deploys.
- Live Cloudflare resources, Worker secrets, D1/R2/Queue/DO bindings, WAF/static headers/RUM/alerts, restore drills, and rollback evidence are not recorded here.
- Live Stripe credit packs and BITBI Pro remain gated canary scaffolding, not live billing readiness.
- Billing remediation, refund/dispute/accounting/legal workflows remain incomplete.
- Tenant-owned asset migration implementation and self-service privacy flows remain incomplete; Phase 6.23 adds only a bounded reset executor path and action tracking. It does not prove live/main reset safety, migrate old ownership rows, assign organization ownership, change access checks, update ownership metadata, backfill ownership, or approve production readiness.
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

Use `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` as the current Phase 6.10 decision, manual-review docs/endpoints for review queue evidence, `/api/admin/tenant-assets/legacy-media-reset/dry-run` for Phase 6.21 reset planning, `docs/tenant-assets/LEGACY_PERSONAL_MEDIA_RESET_EXECUTOR_DESIGN.md` for the Phase 6.22 design, and `POST /api/admin/tenant-assets/legacy-media-reset/execute` plus `/legacy-media-reset/actions` for Phase 6.23 reset action tracking/executor evidence. Current status is `operator_evidence_collected_needs_more_idempotency`; the next tenant-asset step is Phase 6.24 reset operator dry-run evidence, with no live deletion execution, broad backfill, or access behavior change.

## Historical Evidence Links

- `docs/audits/README.md`
- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- root `PHASE*.md` reports
- `ALPHA_AUDIT_2026_05_15.md`
