# Next Audit Baseline

Date: 2026-05-18

Purpose: single current-state restart point for the next deep audit. This file records what exists now, what still needs operator verification, and which claims remain blocked. It is not phase history; detailed historical context is preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and tenant evidence files.

The old root audit docs were retired to `docs/audits/archive/retired-audit-root-docs/`. The next audit should start here and should not continue old audit phase numbering.

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0058_add_legacy_media_reset_actions.sql`.

## Current System State

- Frontend remains a static vanilla HTML/CSS/ES module site deployed separately from Workers.
- Backend behavior is implemented in Cloudflare Workers: `workers/auth`, `workers/ai`, and `workers/contact`.
- Auth Worker uses Cloudflare D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, service bindings, and route-policy checks.
- Admin Control Plane exists for implemented admin operations, including users, billing review/reconciliation, lifecycle, AI Lab, AI usage, budget controls, platform-budget evidence, tenant manual-review visibility, and related exports.
- This baseline does not claim production readiness, live billing readiness, tenant isolation, access-switch readiness, ownership backfill readiness, or confirmed legacy media reset readiness.

## Current Deployment State To Verify

- The repository contains code and docs through the reset action-tracking/executor work and the current DOC-2 consolidation.
- Live deployment state is not proven by repository files. The operator must verify which Workers/static assets are deployed.
- Auth Worker deploy is required for any runtime endpoints not yet deployed from the current branch.
- Static/Pages deploy is required only if unshipped static/Admin UI changes are present.
- Cloudflare dashboard-managed WAF, static security headers, RUM, alerts, and resource bindings still require manual or live verification.

## Current Migration State

- Latest auth D1 migration in repo/release contract: `0058_add_legacy_media_reset_actions.sql`.
- Migration `0056_add_ai_folder_image_ownership_metadata.sql` adds nullable ownership metadata to `ai_folders` and `ai_images`.
- Migration `0057_add_ai_asset_manual_review_state.sql` adds manual-review item/event tables.
- Migration `0058_add_legacy_media_reset_actions.sql` adds legacy media reset action/event tracking.
- Remote migrations `0056`, `0057`, and `0058` must be applied before deploying Auth Worker code that depends on those columns/tables.
- No migration was added or applied by DOC-2.

## Current Admin / Platform Budget State

- Admin/platform AI budget classification, runtime kill switches, D1 app switches, selected `platform_admin_lab_budget` caps, reconciliation, repair, report/export, archive flows, and Admin Control Plane visibility exist in repo.
- Member image/music/video AI Cost Gateway paths are implemented with idempotency and duplicate-provider-call protections.
- Some broader platform/internal AI Worker caller-policy and budget-cap scopes remain future work.
- Live production readiness for budget controls still requires operator evidence and Cloudflare validation.

## Current Tenant Asset Ownership State

- `ai_folders` and `ai_images` have nullable ownership metadata columns.
- New personal folder/image writes assign high-confidence personal ownership metadata.
- Existing legacy rows remain mixed/null/unclassified unless evidence proves otherwise.
- Main owner-map evidence exists and required manual review.
- Runtime access checks still rely on existing behavior; reads have not switched to ownership metadata.
- Ownership backfill remains blocked.
- Tenant isolation remains unclaimed.

## Current Manual Review Queue State

- Manual-review item/event tables exist.
- Admin import, queue read/detail/events/evidence/export, status workflow, and Admin visibility exist for review-state rows.
- Manual-review operator evidence exists for import/queue/status workflow.
- Current decision: `operator_evidence_collected_needs_more_idempotency`.
- Idempotency completion status: `operator_evidence_pending_manual_review_idempotency_completion`.
- Remaining gap: import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence are incomplete.
- Manual-review status changes do not backfill ownership or switch runtime access behavior.

## Current Legacy Media Reset State

- Read-only legacy media reset dry-run/reporting exists.
- Legacy media reset executor design exists.
- Reset action/event tracking and a dry-run-default executor path exist for first-pass domains only: `ai_images`, `ai_folders`, `ai_image_derivatives`, and `public_gallery_references`.
- Confirmed reset execution is hard-disabled by default unless optional operator env gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved confirmation phase.
- Video, music, text assets, profile avatars, data lifecycle exports, audit archives, unknown media tables, and manual-review supersession remain deferred.
- The reset dry-run decision references prior live/main evidence at `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`; that raw JSON is not present in the current checkout, no sanitized replacement is present, and the current decision remains `legacy_media_reset_dry_run_rejected_unsafe` because the evidence exposed a raw idempotency key.
- Confirmed reset/deletion remains blocked.

## Current Production Readiness State

- Local release tooling and readiness checks exist.
- Production readiness remains blocked until live/manual evidence verifies migrations, Worker deploys, secrets, bindings, D1/R2/Queue/DO resources, health checks, security headers, alerts, restore drill, rollback path, Stripe configuration, and operational canaries.
- Live billing readiness remains blocked.

## Blocked Claims

- Do not claim full tenant isolation.
- Do not claim access-switch readiness.
- Do not claim ownership backfill readiness.
- Do not claim confirmed legacy media reset readiness.
- Do not claim live billing readiness.
- Do not claim production readiness.
- Do not claim media deletion/reset occurred unless separately approved evidence proves it.

## Pending Operator Actions

- Verify live deployment state for Auth Worker, Static/Pages, AI Worker, and Contact Worker.
- Apply/verify remote auth migrations through `0058` before dependent Auth Worker deploys.
- Provide a sanitized legacy media reset dry-run evidence package using `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` before any confirmation review.
- Complete manual-review idempotency evidence gaps.
- Collect production-readiness evidence with no secret exposure.
- Keep live billing flags disabled except for explicit bounded operator canaries.

## Recommended Starting Points For Next Audit

1. Reconcile this baseline against `config/release-compat.json`, `npm run release:plan`, and live deployment evidence.
2. Review `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` and decide whether to sanitize/recollect reset dry-run evidence.
3. Review manual-review evidence gaps before any ownership backfill or access-switch planning.
4. Review AI budget scope gaps and decide the next bounded budget/caller-policy target.
5. Review production-readiness evidence and live/manual Cloudflare prerequisites.

## Historical Archive Pointers

- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- `docs/audits/archive/root-phase-reports/`
- `docs/audits/archive/retired-audit-root-docs/`
- `docs/tenant-assets/evidence/`
- `docs/audits/README.md`
