# SaaS Progress And Current State Report

Date: 2026-05-21

Purpose: compact current-state summary for restarting future audit work. Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the only active audit baseline.

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

This report is not production readiness, live billing readiness, legal compliance certification, full tenant isolation, or full SaaS maturity evidence.

## Current Maturity Snapshot

| Dimension | Current state |
| --- | --- |
| Security | Stronger foundation: service auth, replay protection, admin MFA, route policies, limiter/body guards, and purpose-specific secrets. |
| Operations | Release plan/preflight, final RC matrix/Go-No-Go manifest, Auth/AI compatibility checks, readiness checks, production execution dossier, Cloudflare resource model, rollback drill, incident runbooks, Operator Timeline/Triage, evidence index tooling, restore guidance, and evidence templates exist; live evidence remains incomplete. |
| Billing | Credit ledgers, guarded Stripe scaffolding, read-only billing evidence status, canary skeleton tooling, review queue, and reconciliation exist; live billing readiness remains blocked. |
| AI cost | Member image/music/video and selected admin/platform routes have gateway, idempotency, switch, cap, repair, report, and archive foundations. |
| Tenant assets | Folder/image ownership metadata exists for new personal writes only; legacy rows remain unresolved. Manual-review workflows exist, including post-cleanup dry-run classification, evidence export, and guarded review-state supersession. Admin Tenant Isolation Execution exposes warning-gated Backfill dry-run/execution controls, Access-Switch shadow diagnostics, and Legacy Reset status/evidence controls. Post-cleanup evidence shows one exact safe `ai_images` ownership candidate prepared for operator execution; Access-Switch and Reset remain blocked. |
| Privacy/data lifecycle | Inventory, retention baseline, export/archive cleanup, safe executor foundations, final completion, close/reject, retained-category evidence, and JSON/Markdown/HTML evidence exports exist; completion remains evidence/policy-controlled and is not automatic legal advice. |
| Admin UX | Admin Control Plane is modularized and exposes implemented operator panels, readiness/evidence status, production execution command copy, clearer high-risk-flow guardrails, and improved accessibility/focus/modal/keyboard behavior without proving production readiness. |

## Current Implemented Capabilities

- Static site and Cloudflare Worker architecture remain intentionally lightweight and Cloudflare-native.
- Auth/session/MFA/security guardrails and route-policy checks are in place.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, and BITBI Pro scaffolding exist.
- Documentation currentness and release-truth guardrails align active current docs to `config/release-compat.json`.
- Static Pages deploy safety is release-plan-aware and fails closed for Worker/schema/manual dependency ranges that are not acknowledged through the guarded workflow path.
- Admin Control Plane implementation is split across focused modules instead of a single large Admin entrypoint.
- Billing control-plane evidence reports live Stripe prerequisite presence/shape only; it does not expose secrets, call Stripe, create checkouts, grant credits, issue refunds, or mutate subscriptions.
- Operator Timeline/Triage provides an Admin-only read model for audit/activity, billing, AI budget, lifecycle, tenant, readiness, and archive metadata. Evidence index tooling classifies repo evidence as accepted, pending, rejected/unsafe, template, historical, or stale/superseded without live R2 listing or raw unsafe value output.
- Current evidence index state is `ok:true` with `unsafeCount:0` from repo-local evidence indexing.
- Production execution tooling can generate a local readiness dossier, Cloudflare resource model, and rollback drill. These validate repo declarations and organize operator evidence, but they do not call Cloudflare/GitHub/Stripe/providers, deploy, migrate, mutate resources, execute rollback, or convert repo-supported state into live readiness.
- Release Candidate tooling can generate `npm run release:rc` / `npm run release:rc:markdown` and the plan-only `npm run rc:check` final validation matrix. It supports code-merge/deploy preparation only and keeps production readiness blocked.
- Admin/platform AI budget controls include classified-route metadata, caller-policy compatibility checks, Cloudflare master switches, D1 app switches, selected platform caps, read-only reconciliation, explicit repair actions, evidence reports, and archive tooling.
- Tenant asset tooling includes folder/image owner-map evidence, nullable ownership metadata, manual-review import/read/status/Admin visibility, post-cleanup manual-review dry-run/export/supersession support, reset dry-run/reporting, reset action tracking/executor endpoints, and a post-cleanup rebaseline packet that marks old counts stale after manual media cleanup.
- Tenant Isolation Execution tooling adds visible danger explainers, redacted evidence export, exact confirmation guidance, and disabled reasons for Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset. It does not list/mutate live R2, change runtime access decisions, execute reset, or claim tenant isolation.

## Current Blockers

- Production readiness is blocked until live/manual Cloudflare, Worker, D1/R2/Queue/DO, health, header, alert, restore, rollback, and Stripe evidence is recorded.
- Cloudflare resource model output is repo-declared evidence only until operator live evidence is attached for resources, secrets by presence, dashboard-managed WAF/static headers/RUM/alerts/custom domains, and deployment state.
- Live billing readiness is blocked until bounded canaries, Stripe dashboard/webhook evidence, verified no-credit-before-webhook behavior, invoice/payment evidence, and approved remediation/accounting/legal workflows exist.
- Tenant isolation is not claimed; current post-cleanup asset rows are not globally backfilled and access checks have not switched to ownership metadata. Exact-candidate backfill is supported for the single safe `ai_images` candidate only after fresh authenticated preflight, while Access-Switch enforcement remains blocked pending post-backfill shadow evidence and durable switch policy.
- Confirmed legacy media reset is blocked because the dry-run decision is rejected unsafe due raw idempotency key exposure; the raw JSON is not present in the current checkout, no sanitized replacement evidence is present, and old candidate counts are stale after manual media cleanup.
- Manual-review evidence still needs operator-reviewed post-cleanup supersession dry-run/export output plus import replay, import conflict, standalone successful status-update, status replay, and status conflict evidence. Evidence files do not automatically remove D1 review rows, and supersession is not asset deletion.
- Operator timeline/evidence index output is triage support only. It does not approve live billing, production readiness, tenant isolation, ownership backfill, access switching, or confirmed reset.

## Current Deployment Requirements

- Verify whether the current branch is deployed; repo files alone do not prove live state.
- Apply remote auth migrations through the latest auth schema checkpoint in `config/release-compat.json` before dependent Auth Worker deployment.
- Admin Users now includes a registration availability switch backed by `app_settings`. It affects new account creation only; existing login, sessions, admin access, password reset, MFA, and profile/account access remain unaffected.
- Tenant isolation remains unclaimed. The Ownership Backfill executor can now target exact safe candidate IDs, but Access-Switch enforced mode and Legacy Media Reset remain blocked.
- Deploy paired Auth/AI caller-policy changes in the release-planned order: AI Worker before Auth Worker.
- Deploy Auth Worker only when runtime code changes need shipping and migrations are present.
- Deploy Static/Pages only when unshipped static/Admin UI changes exist.
- Keep live/billing flags disabled unless an operator intentionally runs a bounded evidence canary. Use local billing evidence tooling first and do not paste raw Stripe payloads, signatures, secrets, payment methods, cookies, or session tokens into evidence.
- Generate the RC manifest, readiness dossier, Cloudflare resource model, rollback drill, and evidence index before any cutover review; deploy units still come from `npm run release:plan`, and no remote migration should be assumed applied.

## Recommended Next Step

Start the next audit from `docs/audits/NEXT_AUDIT_BASELINE.md`.

Recommended track: Fresh Deep Audit From Current Baseline.

## Historical Evidence

Historical detail is preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and tenant evidence documents. Treat those files as archive/background only, not active backlog, and do not expand this report with chronological logs.
