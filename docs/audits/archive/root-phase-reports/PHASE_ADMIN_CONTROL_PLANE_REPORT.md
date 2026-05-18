# PHASE_ADMIN_CONTROL_PLANE_REPORT.md

Date: 2026-04-26

Last corrective update: 2026-04-27

## Executive Summary

The Admin Control Plane phase adds a frontend-only operating surface inside the existing `admin/index.html` admin area. It surfaces implemented Phase 0 through Phase 2-J capabilities through existing sanitized admin APIs, preserves existing admin sections, and avoids backend rewrites, new dependencies, migrations, live billing activation, or production-affecting changes.

This phase does not prove production readiness. It makes the implemented backend foundations easier to inspect and operate from one place while continuing to label staging verification, live Cloudflare validation, and production deploy as blocked operational tasks.

## Scope

- Added an admin command center and new control-plane sections for security posture, organizations/RBAC, billing/credits/entitlements, billing events/Stripe Testmode, AI usage attempts, data lifecycle, operations, readiness, and settings.
- Reused existing admin APIs where they exist.
- Added no backend APIs, migrations, bindings, secrets, dependencies, live payment activation, frontend framework, or production deployment.
- Preserved existing Users, Content, Media, AI Lab, Access, and Activity admin sections.

## Corrective Polish And Data Accuracy Pass

The 2026-04-27 corrective pass fixed rendering defects found during manual review and audited the data/status copy for every new section.

- Fixed card grids that could collapse into cramped columns on desktop/laptop widths.
- Fixed control-plane detail rows where labels such as `Scope`, `Required checks`, `Secrets`, and `Live verification` could wrap vertically letter-by-letter.
- Fixed badge/title layout so status badges wrap within card headers instead of overlapping titles or descriptions.
- Preserved table readability by keeping dense data inside horizontal scrollers without causing document-level mobile overflow.
- Changed ambiguous status badges from broad `Available`/`Green locally` language to narrower `API available`, `Run before merge`, `Review required`, `Production blocked`, and `Testmode only` labels.
- Clarified that security/readiness cards are repo/static checklist state unless backed by an actual admin API response.
- Expanded frontend sanitization filtering for summary fields containing secret/token/password/hash/signature/raw/payload/request-fingerprint/idempotency/R2 key/MFA/recovery/webhook/Stripe/service-auth/payment-method/card-like names.
- Added duplicate-submit guards for manual credit grant and AI usage cleanup actions.
- Kept AI cleanup dry-run as the default and expanded cleanup result counts to distinguish expired attempts, released reservations, replay metadata cleanup, replay object eligibility/deletion, skips, and failures.
- Added no backend APIs, migrations, route-policy entries, live billing controls, or production-affecting behavior.

## Admin Sections Added

| Section | Purpose | Backend APIs used | Mode |
| --- | --- | --- | --- |
| Overview / Command Center | High-level admin capability cards and readiness labels. | `GET /api/admin/stats`, plus availability probes for orgs, billing, billing events, AI attempts, lifecycle requests, and export archives. | Read-only |
| Security & Policy | Repo/CI-enforced posture checklist for route policy, limiters, MFA, service auth, and production blockers. | Static repo/status copy only. | Read-only |
| Organizations / RBAC | Organization list and member detail inspection. | `GET /api/admin/orgs`, `GET /api/admin/orgs/:id` | Read-only |
| Billing / Credits / Entitlements | Plan catalog, org billing lookup, and confirmed manual credit grant. | `GET /api/admin/billing/plans`, `GET /api/admin/orgs/:id/billing`, `POST /api/admin/orgs/:id/credits/grant` | Read + safe admin mutation |
| Stripe / Billing Events | Sanitized provider event list/detail with Testmode-only and live-disabled labels. | `GET /api/admin/billing/events`, `GET /api/admin/billing/events/:id` | Read-only |
| AI Usage / Credits / Attempts | Usage attempt list/detail and bounded cleanup dry-run/execute control. | `GET /api/admin/ai/usage-attempts`, `GET /api/admin/ai/usage-attempts/:id`, `POST /api/admin/ai/usage-attempts/cleanup-expired` | Read + dry-run-default safe cleanup |
| AI Operations / Video Diagnostics | Async video poison/failed-job diagnostics. | `GET /api/admin/ai/video-jobs/poison`, `GET /api/admin/ai/video-jobs/failed` | Read-only |
| Data Lifecycle / Privacy Operations | Lifecycle request and export archive metadata inspection. | `GET /api/admin/data-lifecycle/requests`, `GET /api/admin/data-lifecycle/exports` | Read-only |
| Release / Operational Readiness | Deployment checklist and static readiness constraints. | Static repo/status copy only. | Read-only |
| Admin Settings | Explicit boundary for deployment-owned configuration. | No settings API used. | Read-only |

## Actions Added And Safety Model

- Manual credit grant UI requires organization id, positive amount, reason, browser confirmation, and a generated `Idempotency-Key`; it uses the existing admin-only, same-origin, byte-limited, fail-closed backend route.
- AI usage cleanup UI defaults to dry-run. Execute mode requires an explicit checkbox, confirmation, bounded limit, and generated `Idempotency-Key`; it uses the existing admin-only cleanup route.
- No lifecycle archive cleanup UI was added because the backend archive cleanup endpoint is execute-only rather than dry-run.
- No irreversible deletion/anonymization UI was added.
- No live billing, checkout toggle, subscriptions, invoices, customer portal, Cloudflare secret editing, migration editing, or dashboard config editing was added.

## Security And Sanitization

- The UI only renders sanitized API fields and deliberately omits raw Stripe payloads, webhook signatures, raw provider payloads, idempotency hashes, request fingerprints, raw R2 keys, provider secrets, service-auth metadata, SQL/debug metadata, password/session/reset/verification/MFA/recovery material, and raw archive bodies.
- Existing admin auth/MFA, same-origin, rate-limit, idempotency, and body-limit controls remain backend-owned.
- Missing backend capabilities degrade to unavailable states instead of fake data.
- Billing/Stripe surfaces are labeled Testmode-only, live disabled, and no production billing active.

## Files Changed

Corrective pass files changed:

- `admin/index.html`
- `css/admin/admin.css`
- `js/pages/admin/control-plane.js`
- `tests/auth-admin.spec.js`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`

The original Admin Control Plane phase also touched admin integration/release-check files, but this corrective pass made no backend API, route-policy, release compatibility, migration, or dependency changes.

## Tests Added/Updated

- Added admin static/Playwright coverage for:
  - command center rendering
  - new nav sections and routing
  - dashboard card minimum width on desktop
  - security detail labels not collapsing into vertical one-letter columns
  - badge/title non-overlap in dashboard cards
  - tablet admin nav reachability
  - mobile document-level overflow prevention with control-plane tables
  - organization list/detail
  - billing plans/org billing/manual credit grant idempotency header
  - credit grant reason required before side effects
  - sanitized Stripe/Testmode billing event detail
  - AI usage attempt detail and cleanup dry-run
  - 503 fail-closed backend states rendering as unavailable instead of fake success
  - lifecycle request/archive read-only surfaces
  - absence of irreversible lifecycle delete/execute controls
  - absence of live billing/Stripe activation controls
  - video poison/failed-job operations visibility
  - readiness/settings boundaries
  - unavailable backend capability state
  - absence of secret-like values in rendered DOM
- Added `js/pages/admin/control-plane.js` to the targeted JS syntax guard.

## Validation Results

Initial baseline before edits:

- `git branch --show-current`: `main`
- `git status --short`: clean
- Latest committed phase: Phase 2-J (`c3b36d9 Phase 2-J`)
- Baseline `npm run release:preflight`: passed

Validation after implementation:

- `npm run check:js`: passed
- `npx playwright test tests/auth-admin.spec.js -g "Admin Control Plane"`: passed, 4 tests after the corrective pass
- `npm run check:route-policies`: passed
- `npm run test:workers`: passed, 346 tests
- `npm run test:static`: passed, 159 tests
- `npm run test:release-compat`: passed
- `npm run test:release-plan`: passed
- `npm run test:cloudflare-prereqs`: passed
- `npm run validate:cloudflare-prereqs`: passed repo config validation; live validation skipped; production deploy remains blocked
- `npm run validate:release`: passed
- `npm run check:worker-body-parsers`: passed
- `npm run check:data-lifecycle`: passed
- `npm run check:admin-activity-query-shape`: passed
- `npm run test:operational-readiness`: passed
- `npm run check:operational-readiness`: passed
- `npm run build:static`: passed
- `npm run release:preflight`: passed
- `git diff --check`: passed

Notes:

- The first full `npm run release:preflight` attempt failed in an unrelated homepage smoke test timeout. The isolated test passed immediately, and the subsequent full `npm run release:preflight` passed.
- Package manifests were not changed, so `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` were not rerun for this frontend/admin-surface-only phase.

## Merge Readiness

Ready for focused review and merge from a validation perspective. The implementation is intentionally frontend/admin-surface-only, avoids backend behavior changes, and has a green release preflight.

## Production Deploy Readiness

Blocked. This admin UI does not prove production readiness. Production remains blocked until the existing Phase 0 through Phase 2-J staging/live verification requirements are complete, including migrations through `0038`, live Cloudflare prereq validation, Stripe Testmode endpoint verification, org billing/AI/lifecycle flow checks, and no-live-billing side-effect verification.

## Staging Verification Steps

1. Deploy static admin UI to staging only after backend auth Worker and migrations through `0038` are staged.
2. Verify admin MFA access to the admin page.
3. Verify all read-only sections degrade cleanly when routes are unavailable and render data when routes are available.
4. Verify manual credit grant creates exactly one ledger entry with a generated idempotency key and audited reason.
5. Verify AI usage cleanup dry-run and execute modes return sanitized counts and do not create debits.
6. Verify billing event detail never exposes raw Stripe payloads/signatures or payment data.
7. Verify lifecycle archive/request surfaces do not expose raw archive bodies or internal R2 keys.
8. Verify mobile admin navigation and existing Users/Activity/AI Lab sections still work.

## Rollback Plan

- Revert the frontend/admin files and this report if the control-plane UI causes a regression.
- No D1 migration rollback is required because this phase adds no migrations.
- No Cloudflare dashboard/resource rollback is required because this phase adds no bindings, secrets, queues, R2 buckets, or cron triggers.
- Existing backend APIs remain unchanged.

## Remaining Risks

- The UI is an operator surface, not a compliance, live-readiness, or tenant-isolation guarantee.
- Some sections are intentionally read-only because backend mutation APIs are missing or not dry-run-safe.
- Backend APIs may return environment-specific shapes not covered by local fixtures; the UI handles missing/404/fail-closed states but staging validation is still required.
- Live Stripe, subscriptions, invoices, customer portal, and production checkout remain disabled.
- Existing assets are still not fully tenant-migrated.

## Next Recommended Actions

1. Perform a focused pre-merge review of `admin/index.html`, `js/pages/admin/control-plane.js`, `css/admin/admin.css`, and `tests/auth-admin.spec.js`.
2. Stage with backend migrations through `0038` and verify every enabled admin section against real staging data.
3. Add backend dry-run support before exposing any more lifecycle cleanup/destructive-like actions in the UI.
4. Verify the manual credit grant and AI cleanup controls with staging admin MFA, same-origin, idempotency, and limiter behavior.
5. Decide the next roadmap track: Stripe live-readiness hardening, video AI entitlement wiring, or tenant ownership migration.
