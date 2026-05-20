# Current Audit Summary

Last updated: 2026-05-20

Latest auth migration: `0060_add_app_settings.sql`

Primary restart baseline: `docs/audits/NEXT_AUDIT_BASELINE.md`

Production readiness: BLOCKED

Live billing readiness: BLOCKED

This is the short operator-facing audit summary. The old alpha/audit naming is historical; current audit work starts from `docs/audits/NEXT_AUDIT_BASELINE.md`. This summary does not approve deploys, live billing, legal compliance, full tenant isolation, access-check switching, ownership backfill, confirmed media reset, or full SaaS maturity.

## Current Done

- Static site plus Cloudflare Workers architecture is preserved and release-modeled.
- Auth, session, admin MFA, route policy, service auth, replay protection, body limits, limiter, and secret-purpose guardrails exist.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, guarded Stripe scaffolding, and BITBI Pro scaffolding exist.
- Member image/music/video AI Cost Gateway flows are migrated with idempotency and duplicate-provider-call suppression.
- Admin/platform AI budget controls exist for classified routes: Cloudflare master switches, D1 app switches, selected platform caps, reconciliation, repair, report/export, and sanitized archives.
- Admin Control Plane surfaces implemented operator panels, including readiness/evidence status, production execution, and Release Candidate / Go-No-Go command copy.
- Local RC tooling exists: `npm run rc:check` prints the final validation matrix by default, and `npm run release:rc` / `npm run release:rc:markdown` generate a blocked Go/No-Go manifest for code-merge/deploy preparation.
- Tenant asset folder/image metadata, owner-map evidence, manual-review import/queue/status/Admin visibility, post-cleanup manual-review classifier/supersession support, reset dry-run/reporting, reset action tracking, and reset executor endpoints exist in repo.

## Current Open Blockers

- Remote migrations through `0060` must be applied before dependent Auth Worker deploys.
- Live Cloudflare resources, Worker secrets, D1/R2/Queue/DO bindings, WAF/static headers/RUM/alerts, restore drill, rollback evidence, and Stripe canaries are not verified here.
- RC tooling is repo/local evidence only and does not prove live production readiness or live billing readiness.
- Live Stripe credit packs and BITBI Pro remain gated canary scaffolding, not live billing readiness.
- Tenant isolation remains unclaimed; legacy rows are not backfilled and access checks have not switched to ownership metadata.
- Manual-review operator evidence still needs import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence.
- Legacy media reset dry-run decision is rejected unsafe because prior live evidence exposed a raw idempotency key; the raw JSON is not present in the current checkout, no sanitized replacement is present, and confirmed reset is blocked.
- Remaining AI budget scopes/internal provider routes are future work.

## Current Admin/AI/Billing State

- Admin Control Plane is the operator surface for users, billing, lifecycle, readiness, AI Lab, AI usage, budget switches, caps, reconciliation, repair, reports, and archives.
- Budget switch execution requires Cloudflare master flag plus D1 app switch; app switches cannot mutate Cloudflare.
- `platform_admin_lab_budget` has the first daily/monthly cap foundation; other scopes remain future work.
- Repair execution is explicit admin-approved only and limited to safe usage-evidence repair/review notes.

## Current Tenant Asset State

- `ai_folders` and `ai_images` have nullable ownership metadata columns.
- New personal writes assign ownership metadata; existing rows remain mixed/null unless separately proven.
- Manual-review item/event tables, import, queue/evidence, status update, and Admin visibility exist.
- Reset action/event tables and a dry-run-default executor path exist for first-pass folders/images/derivatives/public references only.
- Confirmed reset execution is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved operator package.
- No confirmed deletion/reset, ownership backfill, access-switching, or tenant-isolation claim is approved.

## Next Recommended Step

Recommended next audit entry point: Fresh Deep Audit From Current Baseline.

If tenant reset work continues first, review `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` and resolve the unsafe evidence blocker before any confirmation review.

## Historical Evidence Links

- `docs/audits/README.md`
- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- `docs/audits/archive/root-phase-reports/`
- `docs/tenant-assets/evidence/`
