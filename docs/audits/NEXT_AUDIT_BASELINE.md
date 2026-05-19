# Next Audit Baseline

Date: 2026-05-19

Purpose: single current-state restart point for the next deep audit. This file records what exists now, what still needs operator verification, and which claims remain blocked. It is not phase history; detailed historical context is preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and tenant evidence files.

The old root audit docs were retired to `docs/audits/archive/retired-audit-root-docs/`. The next audit should start here and should not continue old audit phase numbering.

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0059_add_data_lifecycle_completion_state.sql`.

## Current System State

- Frontend remains a static vanilla HTML/CSS/ES module site deployed separately from Workers.
- Backend behavior is implemented in Cloudflare Workers: `workers/auth`, `workers/ai`, and `workers/contact`.
- Auth Worker uses Cloudflare D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, service bindings, and route-policy checks.
- Browser state-changing requests require trusted Origin/Referer context, and protected writes with `Sec-Fetch-Site: cross-site` fail closed except for explicit webhook/ingest/link exemptions.
- High-risk evidence/log surfaces should expose private storage keys only as bounded classes/hashes/counts, not raw internal R2 keys.
- Admin Control Plane exists for implemented admin operations, including users, Operator Timeline/Triage, billing evidence status, billing review/reconciliation, lifecycle, readiness/evidence status, AI Lab, AI usage, budget controls, platform-budget evidence, tenant manual-review visibility, and related exports.
- Admin user delete now has two safe modes: operational anonymized deletion, and operational anonymized deletion plus a dry-run/approval-required Data Erasure workflow request. Both require Admin auth/MFA, rate limiting, explicit confirmation, self-delete prevention, dependency preflight, labeled cleanup diagnostics, login/session disablement, and guarded cleanup of operational user-owned data. The optional Data Erasure/GDPR workflow is not executed immediately and does not claim full legal erasure while retention-governed audit/billing/lifecycle/legal evidence remains policy-controlled.
- Admin Data Lifecycle request review now has a large detail overlay plus sanitized evidence packet export. The overlay wires guarded request detail, plan generation, approval, safe execution, final completion, reject/close, private archive metadata, and JSON/Markdown/HTML evidence packet actions. Final states distinguish `completed`, `completed_with_retention`, `rejected`, `closed`, and `blocked_requires_legal_review`; printable HTML is PDF-friendly through browser Save as PDF, not binary PDF generation or legal advice.
- Admin Tenant Isolation Execution now surfaces Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset together. Each high-risk card has a warning/exclamation explainer, dry-run or shadow diagnostics, redacted evidence export, exact confirmation guidance, and disabled reasons. The panel does not execute reset, switch runtime access, list/mutate live R2, or claim tenant isolation.
- This baseline does not claim production readiness, live billing readiness, tenant isolation, access-switch readiness, ownership backfill readiness, or confirmed legacy media reset readiness.

## Current Deployment State To Verify

- The repository contains code and docs through P0/P1 hardening, including Wave 10 Release Candidate consolidation.
- Live deployment state is not proven by repository files. The operator must verify which Workers/static assets are deployed.
- Auth Worker deploy is required for any runtime endpoints not yet deployed from the current branch.
- Auth/AI caller-policy changes are paired release work; `config/release-compat.json` models AI Worker before Auth Worker for provider-cost internal AI route compatibility.
- Static/Pages deploy is required only if unshipped static/Admin UI changes are present.
- Cloudflare dashboard-managed WAF, static security headers, RUM, alerts, and resource bindings still require manual or live verification.

## Current Migration State

- Latest auth D1 migration in repo/release contract: `0059_add_data_lifecycle_completion_state.sql`.
- Migration `0056_add_ai_folder_image_ownership_metadata.sql` adds nullable ownership metadata to `ai_folders` and `ai_images`.
- Migration `0057_add_ai_asset_manual_review_state.sql` adds manual-review item/event tables.
- Migration `0058_add_legacy_media_reset_actions.sql` adds legacy media reset action/event tracking.
- Migration `0059_add_data_lifecycle_completion_state.sql` adds Data Lifecycle final completion, evidence, retained-category, close/reject, and completion-note metadata.
- Remote migrations `0056`, `0057`, `0058`, and `0059` must be applied before deploying Auth Worker code that depends on those columns/tables.

## Current Admin / Platform Budget State

- Admin/platform AI budget classification, runtime kill switches, D1 app switches, selected `platform_admin_lab_budget` caps, reconciliation, repair, report/export, archive flows, and Admin Control Plane visibility exist in repo.
- Member image/music/video AI Cost Gateway paths are implemented with idempotency and duplicate-provider-call protections.
- Internal AI Worker provider-cost routes require caller-policy metadata before provider execution; budget-cap coverage outside `platform_admin_lab_budget` remains future work.
- Release tooling validates Auth-to-AI caller-policy mappings for current provider-cost routes.
- Live production readiness for budget controls still requires operator evidence and Cloudflare validation.

## Current Tenant Asset Ownership State

- `ai_folders` and `ai_images` have nullable ownership metadata columns.
- New personal folder/image writes assign high-confidence personal ownership metadata.
- Existing legacy rows remain mixed/null/unclassified unless evidence proves otherwise.
- Main owner-map evidence exists and required manual review.
- Runtime access checks still rely on existing behavior; reads have not switched to ownership metadata.
- Ownership Backfill dry-run/evidence and a strictly gated executor exist for locally classified safe folder/image rows. Non-dry-run backfill requires Admin/MFA, `Idempotency-Key`, reason, explicit supported domain scope, bounded batch limit, and exact typed confirmation `BACKFILL OWNERSHIP`; unsafe/manual-review/public/missing-evidence/deferred rows remain blocked.
- Access-Switch status and shadow diagnostics exist as read-only evidence surfaces. Enforced mode remains blocked because durable switch state and reviewed shadow evidence are not approved.
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
- Confirmed reset also requires exact typed confirmation `CONFIRMED LEGACY MEDIA RESET`, `Idempotency-Key`, reason, scope/evidence acknowledgements, and reviewed Backfill/Access-Switch evidence in any future approved phase.
- Video, music, text assets, profile avatars, data lifecycle exports, audit archives, unknown media tables, and manual-review supersession remain deferred.
- The reset dry-run decision references prior live/main evidence at `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`; that raw JSON is not present in the current checkout, no sanitized replacement is present, and the current decision remains `legacy_media_reset_dry_run_rejected_unsafe` because the evidence exposed a raw idempotency key.
- Confirmed reset/deletion remains blocked.

## Current Production Readiness State

- Local release tooling and readiness checks exist.
- Readiness tooling includes local-only safety contract checks and skipped-by-default live canaries, including negative Fetch Metadata and caller-policy evidence surfaces; operator live evidence is still required.
- Production readiness execution tooling exists. `npm run readiness:dossier` / `npm run readiness:dossier:markdown` assemble a local blocked evidence packet from release plan, deploy order, latest migration checkpoint, Cloudflare resource model, evidence index, cutover summary, billing/tenant blockers, rollback placeholders, and redaction guarantees.
- Cloudflare resource model tooling exists. `npm run cloudflare:resource-model` / `npm run cloudflare:resource-model:markdown` validates repo declarations against `config/release-compat.json` and Wrangler config, while marking live resource presence, secret values, dashboard-managed WAF/static headers/RUM/alerts/custom domains, and production settings as operator live-verification-required.
- Rollback drill tooling exists. `npm run release:rollback-drill` records current commit, previous-version placeholders, affected deploy units, rollback owner placeholder, decision criteria, smoke checks, and blocked claims without executing rollback or calling Cloudflare/GitHub APIs.
- Release Candidate tooling exists. `npm run rc:check` prints the final local validation matrix by default, and `npm run release:rc` / `npm run release:rc:markdown` generate a local Go/No-Go manifest that composes git state, release plan, Cloudflare resource model, readiness dossier, evidence index triage, rollback drill data, P0/P1 matrix, blocked claims, and operator next actions.
- Billing evidence status and canary skeleton tooling exist. Admin-only `GET /api/admin/billing/evidence/status` is read-only, redacted, and reports live billing prerequisite presence/shape without Stripe calls or credit mutation. `npm run billing:canary-evidence` generates a blocked/pending operator evidence skeleton only.
- Operator timeline/triage exists. Admin-only `GET /api/admin/operations/timeline` is read-only and aggregates bounded redacted local D1 metadata from audit/activity, billing, AI budget, lifecycle, tenant, readiness, and archive sources without external calls, live R2 listing, or mutations.
- Evidence index tooling exists. `npm run evidence:index` and `npm run evidence:index:markdown` classify current repo evidence files as accepted, pending, rejected/unsafe, template, or historical and report unsafe marker IDs without printing raw values. Unsafe candidates are triaged as active-current blockers, historical archive candidates, template/example candidates, accepted redacted markers, or manual-review cases.
- Billing local tests and reconciliation cover no-credit-before-webhook, idempotency, review-only refund/dispute/failure workflows, subscription credit buckets, and additional local mismatch categories. These are repo evidence only, not live billing readiness.
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
- Apply/verify remote auth migrations through `0059` before dependent Auth Worker deploys.
- Provide a sanitized legacy media reset dry-run evidence package using `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` before any confirmation review.
- Complete manual-review idempotency evidence gaps.
- Use the Admin Tenant Isolation Execution dry-runs/diagnostics and exports to review Backfill, Access-Switch, and Reset in that order. Do not execute Reset before Backfill and Access-Switch evidence is reviewed.
- Collect production-readiness evidence with no secret exposure.
- Generate the production execution dossier, Cloudflare resource model, and rollback drill before any deploy window; keep their verdicts blocked until live/manual evidence is attached and reviewed.
- Generate the RC validation matrix and RC Go/No-Go manifest before any merge/cutover handoff; treat them as code-merge/deploy-preparation evidence only.
- Use `/admin/#operations`, `docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md`, and `npm run evidence:index` during incident/readiness review.
- Keep live billing flags disabled except for explicit bounded operator canaries, and collect Stripe dashboard/webhook/canary evidence without raw payloads, signatures, secrets, payment methods, cookies, or session tokens.

## Recommended Starting Points For Next Audit

1. Reconcile this baseline against `config/release-compat.json`, `npm run release:plan`, and live deployment evidence.
2. Review `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md` and decide whether to sanitize/recollect reset dry-run evidence.
3. Review manual-review evidence gaps before any ownership backfill or access-switch planning.
4. Review AI budget cap/evidence gaps and decide the next bounded platform-budget scope target.
5. Review production-readiness dossier output, Cloudflare resource model classifications, rollback drill placeholders, and live/manual Cloudflare prerequisites.
6. Review Operator Timeline/Triage classifications and evidence index unsafe-marker output before attaching any evidence to readiness packets.

## Historical Archive Pointers

- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- `docs/audits/archive/root-phase-reports/`
- `docs/audits/archive/retired-audit-root-docs/`
- `docs/tenant-assets/evidence/`
- `docs/audits/README.md`
