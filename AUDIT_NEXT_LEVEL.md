# AUDIT_NEXT_LEVEL.md

Date: 2026-04-24

Scope: repository-wide audit of `/Users/btc2020/Bitbi/Bitbi`.

Constraint honored: no application code was changed. This report is based on local repository inspection and safe validation commands only.

## Current Remediation Status After Phase 2-I

This section is the current implementation checkpoint. The original audit findings, risk ratings, score estimates, and command output below remain a historical pre-remediation baseline from 2026-04-24. They are intentionally preserved and must not be read as the current state after Phase 0-A through Phase 2-I.

Current repository state at checkpoint:

- Branch: `main`
- Latest commit observed before Phase 2-I edits: `dff506d Phase 2-H`
- Working tree: Phase 2-I implementation adds provider-neutral billing event ingestion, route-policy/release updates, tests, and documentation until committed.
- Latest auth D1 migration: `0037_add_billing_event_ingestion.sql`
- Latest AI Worker Durable Object migration: `v1-service-auth-replay`
- Current aggregate validation during Phase 2-I: `npm run test:workers` passed 342/342 during implementation. Final full validation is recorded in `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md` and the Phase 2-I response. Live Cloudflare validation and production deploy were not run.
- Production deploy status: blocked until live Cloudflare secret/binding/resource validation, auth migrations through `0037`, staging Worker verification, staging data lifecycle cleanup/executor verification, staging organization-flow verification, staging billing/entitlement/credit verification, staging org-scoped AI image/text usage retry/reservation verification, staging AI usage attempt cleanup/admin inspection verification, staging replay object cleanup verification, and staging synthetic billing webhook verification/admin inspection/no-side-effect verification are complete.

Completed remediation phases:

| Phase | Status | Main deliverables | Validation summary | Remaining deploy/staging blockers | Report |
| --- | --- | --- | --- | --- | --- |
| Phase 0-A | Completed | Static smoke fixes, priority fail-closed throttles, Auth-to-AI HMAC, critical config validation, AI worker lockfile. | Static 155/155, Worker 260/260, release preflight passed in report. | Matching `AI_SERVICE_AUTH_SECRET` and live Worker resource verification. | `PHASE0_REMEDIATION_REPORT.md` |
| Phase 0-A+ | Completed | Nonce-backed HMAC replay protection with `SERVICE_AUTH_REPLAY`, expanded fail-closed route coverage, CSRF/security regressions. | HMAC/replay/MFA/limiter/config tests passed in Phase 0 report. | `SERVICE_AUTH_REPLAY` binding/migration and secret parity must be live-verified. | `PHASE0_REMEDIATION_REPORT.md` |
| Phase 0-B | Completed | Cloudflare prereq validator, byte-limited parsers, more fail-closed write limits, durable admin MFA failed-attempt state, async video design. | Worker 272/272, static 155/155, release preflight passed. | Migrations from `0028` onward and live Cloudflare prereqs must be verified before deploy. | `PHASE0B_REMEDIATION_REPORT.md` |
| Phase 1-A | Completed | Async video D1 table, queue binding, admin video job create/status APIs, idempotency foundation, body-parser guard. | Worker 280/280, static 155/155, release preflight passed. | `AI_VIDEO_JOBS_QUEUE` and migration `0029` must be staged/live-verified. | `PHASE1A_REMEDIATION_REPORT.md` |
| Phase 1-B | Completed | Queue-safe video task create/poll, R2 output/poster ingest, poison-message persistence, async admin UI default path. | Worker 285/285, static 155/155, release preflight passed. | Staging provider/R2 validation; keep sync debug route disabled. | `PHASE1B_REMEDIATION_REPORT.md` |
| Phase 1-C | Completed | Sync video debug gate, admin poison/failed-job inspection APIs, low-risk quality gates, toolchain pinning. | Worker 289/289, static 155/155, release preflight passed. | Alerts/IaC and broader type/lint migration remain later work. | `PHASE1C_REMEDIATION_REPORT.md` |
| Phase 1-D | Completed | Purpose-specific auth secrets, dual-read/single-write compatibility, config/prereq validation. | Worker 300/300, static 155/155, release preflight passed. | Provision new secrets and keep legacy `SESSION_SECRET` until fallback is intentionally disabled. | `PHASE1D_SECRET_ROTATION_REPORT.md` |
| Phase 1-E | Completed | High-risk auth Worker route policy registry and route-policy static guard. | Route-policy guard passed; Worker/static/release checks passed in report. | Registry is metadata/checking, not full central enforcement. | `PHASE1E_ROUTE_POLICY_REPORT.md` |
| Phase 1-F | Completed | Health probes, operational readiness checks, SLO/event docs, backup/restore drill plan, runbooks, live-check scripts. | Worker 303/303, static 155/155, release preflight passed. | Live alerts, restore drills, dashboard drift checks remain manual/unproven. | `PHASE1F_OPERATIONAL_READINESS_REPORT.md` |
| Phase 1-G | Completed | Indexed/redacted activity search projection, signed activity cursors, query-shape guard. | Worker 306/306, static 155/155, release preflight passed. | Migration `0031`, staging projection verification, optional historical backfill. | `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md` |
| Phase 1-H | Completed | Data inventory, retention baseline, lifecycle request schema, admin planning APIs, dry-run export/delete plans. | Worker 309/309, static 155/155, release preflight passed. | Migration `0032`, legal/product policy, no irreversible deletion. | `PHASE1H_DATA_LIFECYCLE_REPORT.md` |
| Phase 1-I | Completed | Bounded sanitized export archive generation, private `AUDIT_ARCHIVE` storage, archive authorization, deletion executor design. | Worker 311/311, static 155/155, release preflight passed. | Migration `0033`, archive generation/download staging verification. | `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md` |
| Phase 1-J | Completed | Bounded expired archive cleanup, scheduled cleanup integration, admin cleanup visibility, safe reversible-action executor pilot. | Worker 313/313, static 155/155, release preflight passed. | Live `AUDIT_ARCHIVE` cleanup verification and safe executor staging verification. | `PHASE1J_RETENTION_EXECUTOR_REPORT.md` |
| Phase 2-A | Completed for current scope | Additive organizations/memberships schema, basic roles, org/RBAC helper, minimal user org APIs, admin org inspection, backfill plan, route-policy/release updates. | Worker 317/317, static 155/155, release preflight passed. | Migration `0034`, staging org-flow verification, and later domain-by-domain tenant migration. | `PHASE2A_ORG_RBAC_REPORT.md` |
| Phase 2-B | Completed for current scope | Additive plans/subscriptions/entitlements/credit-ledger/usage schema, billing helper, org billing/entitlement reads, admin plan/org billing inspection, admin credit grants, route-policy/release updates. | Worker 320/320, static 155/155, release preflight passed after ledger ordering fix. | Migration `0035`, staging billing/entitlement/credit verification, later AI route wiring, and future payment-provider integration. | `PHASE2B_BILLING_ENTITLEMENTS_REPORT.md` |
| Phase 2-C | Completed for current scope | Opt-in org-scoped `/api/ai/generate-image` entitlement and credit enforcement, AI usage policy helper, usage idempotency request fingerprinting, legacy no-org compatibility, route-policy/check-js/doc updates. | Worker 326/326, static 155/155, release preflight passed. | Staging org-scoped image charge/idempotency/insufficient-credit verification, and future provider-result idempotency/text-video wiring. | `PHASE2C_AI_USAGE_ENTITLEMENTS_REPORT.md` |
| Phase 2-D | Completed for current scope | Org-scoped image usage attempts/reservations, duplicate provider-call suppression, temporary result replay, provider-failure reservation release, billing-failure terminal state, migration `0036`, release/doc/test updates. | Worker 331/331, static 155/155, release preflight passed. | Migration `0036` and staging retry/replay/no-duplicate-provider/no-duplicate-charge verification; expired-attempt cleanup is handled by Phase 2-E. | `PHASE2D_AI_USAGE_RESERVATION_REPORT.md` |
| Phase 2-E | Completed for current scope | Bounded AI usage attempt cleanup, stale reservation release without debits, replay metadata expiry, scheduled cleanup integration, admin usage-attempt list/detail/cleanup APIs, route-policy/release/doc/test updates. | Worker 334/334, static 155/155, release preflight passed. | Migration `0036`, staging cleanup/admin inspection/dry-run/execution/scheduled cleanup verification, and later temporary replay object deletion policy. | `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md` |
| Phase 2-F | Completed for current scope | Prefix-scoped deletion of expired temporary replay objects, generic temp cleanup skip for attempt-linked objects, sanitized cleanup counts/logs, route-policy note updates, docs/tests. | Worker 336/336, static 155/155, release preflight passed. | Migration `0036`, staging replay cleanup dry-run/execution, scheduled cleanup, R2 delete failure handling, no unrelated object deletion, no debit/ledger/usage mutation. | `PHASE2F_AI_REPLAY_OBJECT_RETENTION_REPORT.md` |
| Phase 2-H | Completed for current scope | Backend-only org-scoped `POST /api/ai/generate-text`, HMAC Auth-to-AI text proxying, `ai.text.generate` entitlement/credit enforcement, attempt reservation/finalization, bounded text replay metadata, route-policy/release/doc/test updates. | Worker 339/339, static 155/155, release preflight passed, `git diff --check` passed. | Migration `0036`, staging org-scoped text success/replay/denial/provider-failure/billing-failure verification, and live Auth-to-AI secret/binding verification. | `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md` |
| Phase 2-I | Completed for current scope | Provider-neutral billing event ingestion, migration `0037`, synthetic raw-body HMAC verification, idempotent event storage, duplicate/mismatch handling, dry-run action planning, sanitized admin billing-event inspection, route-policy/release/doc/test updates. | Worker 342/342 passed during implementation; final full validation is in `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md` and the Phase 2-I response. | Migration `0037`, staging synthetic webhook signature failure/success/dedup/mismatch/admin-inspection/no-side-effect verification; no live provider enabled. | `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md` |

Current status estimate:

- The repository has completed the Phase 0/1 hardening roadmap through Phase 1-J, Phase 2-A organization/RBAC foundation, Phase 2-B billing/entitlement foundation, targeted Phase 2-C org-scoped AI image usage enforcement, Phase 2-D org-scoped image usage retry/reservation hardening, Phase 2-E usage-attempt cleanup/admin inspection, Phase 2-F temporary replay object cleanup, Phase 2-H backend-only org-scoped member text generation, and Phase 2-I provider-neutral billing event ingestion for the documented scope.
- It is substantially safer and more operable than the original audit baseline, but it is not full enterprise SaaS maturity.
- Existing assets remain user-owned; full tenant isolation, live payment-provider integration, checkout/invoices, production-trusted payment webhooks, broad AI route credit enforcement, permanent provider-result cache, full IaC/dashboard drift enforcement, full type/lint migration, full user self-service privacy flows, irreversible deletion execution, formal load budgets, and live SLO/alert evidence remain open.
- The next implementation phase should be chosen between provider-specific billing adapter design, video AI entitlement wiring, and domain-by-domain tenant ownership migration. Do not redo Phase 0/1/2-A/2-B/2-C/2-D/2-E/2-F/2-G/2-H/2-I foundations.

## Remediation Progress

This section records remediation progress after the original 2026-04-24 audit. The findings, risk ratings, command output, and maturity assessment below remain historically accurate for the repository state at audit time; they should not be read as the current status of every Phase 0 item.

Reference documents:

- `PHASE0_REMEDIATION_REPORT.md` contains the detailed Phase 0-A/0-A+ implementation evidence, validation results, merge readiness, deploy blockers, and remaining risks.
- `PHASE0B_REMEDIATION_REPORT.md` contains the Phase 0-B implementation evidence for deploy preflight, body-size limits, route throttling expansion, admin MFA failed-attempt state, CSRF coverage, and async video design.
- `PHASE1A_REMEDIATION_REPORT.md` contains the Phase 1-A async admin video job foundation evidence, validation results, deploy requirements, and remaining risks.
- `PHASE1B_REMEDIATION_REPORT.md` contains the Phase 1-B async admin video production-usability hardening evidence, validation results, deploy requirements, and remaining risks.
- `PHASE1C_REMEDIATION_REPORT.md` contains the Phase 1-C sync-route restriction, admin poison/failed-job inspection, quality-gate, validation, and deploy-readiness evidence.
- `PHASE1D_SECRET_ROTATION_REPORT.md` contains the Phase 1-D purpose-specific security secret inventory, dual-read/single-write compatibility behavior, validation evidence, rollout plan, and rollback guidance.
- `PHASE1E_ROUTE_POLICY_REPORT.md` contains the Phase 1-E auth-worker route policy registry, coverage guard, CI/preflight integration, validation evidence, and remaining route-policy migration risks.
- `PHASE1F_OPERATIONAL_READINESS_REPORT.md` contains the Phase 1-F health/readiness, live-check, SLO, runbook, backup/restore drill, queue/backlog, validation, and remaining operational-readiness evidence.
- `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md` contains the Phase 1-G indexed audit/activity search projection, signed activity cursor behavior, query-shape guard, validation evidence, migration requirements, and remaining historical-backfill risks.
- `PHASE1H_DATA_LIFECYCLE_REPORT.md` contains the Phase 1-H data lifecycle request schema, admin lifecycle APIs, export/deletion/anonymization planning behavior, validation evidence, deploy requirements, and remaining privacy-operation risks.
- `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md` contains the Phase 1-I bounded export archive generation, private R2 archive storage, archive authorization, deletion executor design, validation evidence, deploy requirements, and remaining privacy-operation risks.
- `PHASE1J_RETENTION_EXECUTOR_REPORT.md` contains the Phase 1-J expired export archive cleanup, safe deletion/anonymization executor pilot, admin retention visibility, validation evidence, deploy requirements, and remaining privacy-operation risks.
- `PHASE2A_ORG_RBAC_REPORT.md` contains the Phase 2-A organization/membership schema, RBAC helper, minimal user/admin org APIs, route-policy/release updates, backfill plan, validation evidence, and remaining tenant-isolation risks.
- `PHASE2B_BILLING_ENTITLEMENTS_REPORT.md` contains the Phase 2-B plan/entitlement/credit-ledger schema, billing helper, org/admin billing APIs, route-policy/release updates, validation evidence, deploy requirements, and remaining monetization risks.
- `PHASE2C_AI_USAGE_ENTITLEMENTS_REPORT.md` contains the Phase 2-C org-scoped AI image usage policy, entitlement/credit enforcement behavior, idempotency rules, validation evidence, deploy requirements, and remaining monetization risks.
- `PHASE2D_AI_USAGE_RESERVATION_REPORT.md` contains the Phase 2-D AI usage attempt/reservation schema, provider-result idempotency behavior, credit reservation/finalization behavior, validation evidence, deploy requirements, and remaining monetization risks.
- `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md` contains the Phase 2-E AI usage attempt cleanup/admin inspection behavior, scheduled cleanup behavior, validation evidence, deploy requirements, and remaining monetization/retention risks.
- `PHASE2F_AI_REPLAY_OBJECT_RETENTION_REPORT.md` contains the Phase 2-F temporary replay object cleanup behavior, prefix/attempt-linkage safety rules, scheduled/admin cleanup behavior, validation evidence, deploy requirements, and remaining monetization/retention risks.
- `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md` contains the Phase 2-H backend-only org-scoped member text generation API behavior, entitlement/credit enforcement, text replay behavior, validation evidence, deploy requirements, and remaining monetization/tenant risks.
- `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md` contains the Phase 2-I provider-neutral billing event ingestion schema, raw-body verification boundary, idempotency behavior, sanitized admin inspection, validation evidence, deploy requirements, and remaining payment-provider risks.
- `DATA_INVENTORY.md` and `docs/DATA_RETENTION_POLICY.md` contain the Phase 1-H/1-I/1-J data inventory and engineering retention-policy baseline.
- `docs/DATA_DELETION_EXECUTOR_DESIGN.md` contains the Phase 1-I/1-J deletion/anonymization executor state model, approval gates, safe reversible-action pilot, disabled irreversible-action policy, rollback limitations, and future test plan.
- `PHASE1_OBSERVABILITY_BASELINE.md` contains the initial async video job observability baseline.
- `AUDIT_ACTION_PLAN.md` tracks the top 20 findings in original priority order with current status, evidence, remaining risk, and next action.

Phase 0-A completed summary:

- Fixed the three failing static smoke tests from the original audit; final `npm run test:static` is recorded as passing 155/155.
- Added fail-closed app-layer throttling for priority admin/MFA/auth/AI/avatar routes.
- Added HMAC service authentication for Auth-to-AI Worker requests using `AI_SERVICE_AUTH_SECRET`.
- Added fail-closed Worker config validation for Phase 0 critical auth and AI service-auth configuration.
- Added `workers/ai/package-lock.json` and CI/package checks for root and Worker packages.
- Expanded Worker security tests and release/preflight checks.

Phase 0-A+ completed summary:

- Added nonce-backed replay protection for internal AI service auth using `x-bitbi-service-nonce` and the `SERVICE_AUTH_REPLAY` Durable Object.
- Required every `/internal/ai/*` route to verify signed service-auth requests before dispatch.
- Converted additional priority routes to fail-closed limiter behavior, including auth/session mutations, wallet SIWE, favorites add, admin mutations, admin AI, MFA operations, member AI generation, and avatar write paths.
- Added regression coverage for service-auth replay rejection, missing/malformed/expired/invalid signatures, body tampering, unavailable nonce backend, fail-closed limiter behavior, admin MFA throttling, and selected CSRF-sensitive mutations.
- Updated release compatibility/config evidence for `AI_SERVICE_AUTH_SECRET` prerequisites and the `SERVICE_AUTH_REPLAY` Durable Object binding/migration.

Phase 0-B completed summary:

- Added `scripts/validate-cloudflare-deploy-prereqs.mjs` plus tests for repo-side Cloudflare secret/binding/migration prerequisites and explicit live-validation skipped/blocked status.
- Added limited request body readers in `js/shared/request-body.mjs` and routed auth, admin, MFA, profile, favorites, avatar, wallet, AI, contact, and internal AI JSON/multipart parsing through byte-limited helpers.
- Converted additional authenticated/write routes to fail-closed Durable Object backed limits, including profile update, favorites delete, avatar delete, wallet unlink, AI folder/bulk/publication/text/audio/image writes, and contact submit.
- Added D1 migration `0028_add_admin_mfa_failed_attempts.sql` and durable admin MFA failed-attempt lockout/reset-on-success behavior.
- Expanded CSRF regression coverage for profile update, favorites delete, wallet unlink, and AI folder create.
- Created `AI_VIDEO_ASYNC_JOB_DESIGN.md` with a concrete D1/Queue/R2 migration plan for async video jobs.

Phase 1-A completed summary:

- Added auth D1 migration `0029_add_ai_video_jobs.sql` for durable admin async video job state.
- Added auth Worker queue binding/consumer contract `AI_VIDEO_JOBS_QUEUE` / `bitbi-ai-video-jobs`.
- Added `/api/admin/ai/video-jobs` create and `/api/admin/ai/video-jobs/:id` owner-scoped status APIs.
- Added idempotency-key handling, fail-closed queue/config behavior, queue lease/retry/exhaustion handling, and focused Worker tests.
- Added `scripts/check-worker-body-parsers.mjs` plus package/CI/release-preflight integration as a low-risk guardrail against new unsafe direct body parsing.
- Added `PHASE1_OBSERVABILITY_BASELINE.md` for async video lifecycle logs, safe fields, alert candidates, and SLO candidates.

Phase 1-B completed summary:

- Added bounded internal AI task routes `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`.
- Updated the auth queue consumer so async video jobs no longer call `/internal/ai/test-video`.
- Added D1 migration `0030_harden_ai_video_jobs_phase1b.sql` for polling/ingest statuses, output/poster metadata, and `ai_video_job_poison_messages`.
- Added R2 ingest into the existing `USER_IMAGES` bucket with content-type and byte limits for video output and optional posters.
- Made the admin AI Lab use async video job create/status polling by default and kept the synchronous route only as an explicit debug compatibility path.
- Required `Idempotency-Key` for async video job creation.
- Added Worker/static tests for duplicate queue messages, no duplicate provider task creation, R2 ingest, protected output routes, poison-message recording, and default UI avoidance of `/api/admin/ai/test-video`.

Phase 1-C completed summary:

- Made `/api/admin/ai/test-video` default-disabled unless `ALLOW_SYNC_VIDEO_DEBUG=true`, while preserving admin auth, MFA boundary, same-origin checks, fail-closed rate limiting, body limits, and safe warning logs when explicitly used.
- Added admin-only operational APIs for sanitized video poison messages and failed video job diagnostics: `/api/admin/ai/video-jobs/poison`, `/poison/:id`, `/failed`, and `/failed/:id`.
- Added low-risk quality gates: `.nvmrc`, `package.json` engines, toolchain check, secret scan, DOM sink baseline, targeted JS syntax check, quality-gate tests, and preflight/CI integration.
- Updated release compatibility contracts to mark the sync route as debug-only and include the new operational routes.
- Final Phase 1-C validation passed: `npm run test:workers` 289/289, `npm run test:static` 155/155, `npm run release:preflight`, and `git diff --check`.

Phase 1-D completed summary:

- Added `workers/auth/src/lib/security-secrets.js` to centralize purpose-specific auth secret lookup and explicit legacy `SESSION_SECRET` fallback.
- New session hashes use `SESSION_HASH_SECRET`; legacy `SESSION_SECRET` hashes are accepted during fallback and opportunistically upgraded after successful validation.
- New admin MFA TOTP encryption, proof cookies, and recovery-code hashes use `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, and `ADMIN_MFA_RECOVERY_HASH_SECRET`; legacy decrypt/proof/hash fallback remains explicit and tested.
- New pagination cursors use `PAGINATION_SIGNING_SECRET`, and generated-image save references use `AI_SAVE_REFERENCE_SIGNING_SECRET`.
- Auth config validation, release compatibility, and Cloudflare prerequisite checks now require the new purpose-specific auth secret names.
- `PHASE1D_SECRET_ROTATION_REPORT.md` documents the inventory, rollout plan, rollback plan, remaining risks, and validation evidence.

Phase 1-E completed summary:

- Added `workers/auth/src/app/route-policy.js` with explicit route metadata for high-risk auth-worker routes across auth/session, wallet SIWE, profile/avatar, favorites, admin users, admin MFA, admin AI, async video jobs, member AI writes, and protected media reads.
- Added `scripts/check-route-policies.mjs` to prevent new mutating branches in selected auth-worker dispatcher files from existing without a registered policy marker.
- Added `ctx.routePolicy` lookup in `workers/auth/src/index.js` for future low-risk instrumentation/enforcement without changing route behavior.
- Integrated `npm run check:route-policies` into package scripts, release planning, release compatibility workflow checks, CI, targeted JS syntax checks, and Worker tests.
- `PHASE1E_ROUTE_POLICY_REPORT.md` documents route inventory coverage, deferred routes, registry design, checks, validation, and remaining central-enforcement risks.

Phase 1-F completed summary:

- Added public-safe liveness probes for the AI and contact Workers: `GET /health` in `workers/ai/src/index.js` and `workers/contact/src/index.js`.
- Added skipped-by-default live checks: `scripts/check-live-health.mjs` and `scripts/check-live-security-headers.mjs`, with `--require-live` for staging/production evidence.
- Added repo-owned operational readiness checks through `scripts/check-operational-readiness.mjs` and `scripts/test-operational-readiness.mjs`.
- Added `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md`, `docs/BACKUP_RESTORE_DRILL.md`, and service/failure-mode runbooks under `docs/runbooks/`.
- Integrated the operational readiness checks into package scripts, release planning, release compatibility workflow checks, CI, and targeted JS syntax checks.
- `PHASE1F_OPERATIONAL_READINESS_REPORT.md` documents the inventory, health/readiness behavior, scripts, runbooks, SLO/alert baseline, validation evidence, and remaining live-verification gaps.

Phase 1-G completed summary:

- Added D1 migration `0031_add_activity_search_index.sql` for a normalized `activity_search_index` projection table with indexes for source/time, action, actor email, target email, and entity lookup.
- Added `workers/auth/src/lib/activity-search.js` to normalize searchable fields and sanitize returned activity metadata.
- Updated activity write paths and queue ingestion so new admin audit/user activity events populate the projection table.
- Updated `/api/admin/activity` and `/api/admin/user-activity` to use signed cursors backed by `PAGINATION_SIGNING_SECRET`, route/filter-bound cursor payloads, and projection-backed prefix search instead of raw `meta_json` search.
- Bounded admin action counts to the hot retention window.
- Added `scripts/check-admin-activity-query-shape.mjs` plus CI/preflight integration to block raw metadata search, raw activity cursors, and unbounded admin action count regressions.
- `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md` documents the baseline inventory, migration, search behavior change, backfill strategy, validation, deploy requirements, and remaining risks.

Phase 1-H completed summary:

- Added `DATA_INVENTORY.md` and `docs/DATA_RETENTION_POLICY.md` to document D1/R2/contact data classes, exportability, deletion/anonymization behavior, and open legal/product decisions.
- Added D1 migration `0032_add_data_lifecycle_requests.sql` for `data_lifecycle_requests`, `data_lifecycle_request_items`, and `data_export_archives`.
- Added `workers/auth/src/lib/data-lifecycle.js` and `workers/auth/src/routes/admin-data-lifecycle.js` for admin-only lifecycle request create/list/detail/plan/approve APIs.
- Added export planning that records sanitized D1 summaries and R2 references while excluding password hashes, session/token hashes, MFA secrets/recovery codes, service signatures, and provider credentials.
- Added deletion/anonymization planning that is dry-run by default, records revoke/delete/anonymize/retain actions, and blocks only-active-admin deletion/anonymization.
- Added route policies, release compatibility updates, lifecycle static guardrails, CI/preflight wiring, Worker tests, and auth Worker operational documentation for the new lifecycle routes.

Phase 1-I completed summary:

- Added D1 migration `0033_harden_data_export_archives.sql` for export archive manifest/status/download/error metadata and expiration indexes.
- Added `workers/auth/src/lib/data-export-archive.js` for bounded sanitized JSON archive generation from approved export plans.
- Stores export archives in the existing private `AUDIT_ARCHIVE` bucket under deterministic `data-exports/{subjectUserId}/{requestId}/{archiveId}.json` keys without raw email/user text in object paths.
- Added admin-only archive generation, metadata, and authorized download routes while keeping user-facing self-service deferred.
- Enforces archive item-count and byte-size bounds, SHA-256 metadata, no binary media inlining, no internal R2 key exposure in metadata, and 14-day archive access expiration.
- Added `docs/DATA_DELETION_EXECUTOR_DESIGN.md` to document the safe deletion/anonymization executor model while leaving irreversible hard deletion disabled by default.
- Added route policies, release compatibility updates, lifecycle static guardrails, Worker tests, and documentation updates for Phase 1-I.

Phase 1-J completed summary:

- Added `workers/auth/src/lib/data-export-cleanup.js` for bounded expired export archive cleanup scoped to private `AUDIT_ARCHIVE` objects under `data-exports/`.
- Integrated export archive cleanup into the existing auth Worker scheduled cleanup path without adding a new cron trigger.
- Added admin-only archive retention visibility and cleanup routes: `GET /api/admin/data-lifecycle/exports` and `POST /api/admin/data-lifecycle/exports/cleanup-expired`.
- Added `POST /api/admin/data-lifecycle/requests/:id/execute-safe` as a safe executor pilot for approved delete/anonymize requests. It supports dry-run by default and can only revoke sessions, expire reset/verification/SIWE tokens, and expire export archive metadata.
- Kept irreversible hard deletion, R2 media deletion, audit-log deletion, primary identity anonymization, and user self-service delete disabled by default.
- Added route policies, release compatibility updates, lifecycle static guards, Worker tests, and documentation updates for Phase 1-J.

Phase 2-A completed summary:

- Added D1 migration `0034_add_organizations.sql` for organizations and memberships.
- Added `workers/auth/src/lib/orgs.js`, `workers/auth/src/routes/orgs.js`, and `workers/auth/src/routes/admin-orgs.js` for basic organization roles, membership checks, user org APIs, and admin org inspection.
- Added idempotent organization creation, member add/list, role enforcement, cross-org denial, fail-closed limiter behavior, route-policy coverage, release compatibility updates, and Worker tests.
- Preserved existing user-owned assets and documented that Phase 2-A is an additive foundation rather than full tenant isolation.

Phase 2-B completed summary:

- Added D1 migration `0035_add_billing_entitlements.sql` for plans, organization subscriptions, entitlements, future billing-customer mappings, credit ledger entries, and usage events.
- Added `workers/auth/src/lib/billing.js` for default free plan resolution, entitlement checks, credit balance checks, idempotent credit grants, and idempotent credit consumption without negative balances.
- Added organization billing/entitlement/usage read APIs and admin plan/org billing/credit grant APIs with route-policy coverage, fail-closed admin limiters, same-origin mutation protection, byte-limited JSON parsing, and idempotency.
- Updated release compatibility, route-policy checks, Worker harness/tests, data inventory, retention policy, and auth Worker operational documentation.
- No live payment provider, checkout, invoice, webhook, pricing, or production billing activation is enabled.

Phase 2-C completed summary:

- Added `workers/auth/src/lib/ai-usage-policy.js` for centralized AI operation-to-entitlement/credit mapping and org-scoped usage policy checks.
- Updated `workers/auth/src/lib/billing.js` so usage consumption can include a request fingerprint and idempotency conflicts can be rejected before provider execution.
- Wired `/api/ai/generate-image` to enforce active org membership, `owner`/`admin`/`member` role, `ai.image.generate` entitlement, available credits, and `Idempotency-Key` only when `organization_id` / `organizationId` is supplied.
- Preserved legacy user-scoped image generation when no organization context is supplied; no global paywall is enabled.
- No live payment provider, checkout, invoice, webhook, production billing activation, text/video route charging, or full tenant isolation is enabled.

Phase 2-D completed summary:

- Added D1 migration `0036_add_ai_usage_attempts.sql` for durable org-scoped AI image usage attempts, credit reservations, provider/billing/result status, safe temporary result replay metadata, and expiration.
- Added `workers/auth/src/lib/ai-usage-attempts.js` and updated `workers/auth/src/lib/ai-usage-policy.js` to reserve credits before provider execution and classify same-key retries.
- Updated `/api/ai/generate-image` org-scoped mode to suppress duplicate provider calls for pending/succeeded idempotency keys, replay stored temporary results when available, release reservations on provider failure, and fail safely on billing finalization failure without persisting uncharged paid results.
- Preserved legacy no-org image generation, admin AI routes, text routes, video routes, live payment-provider flows, and full tenant migration as out of scope.

Phase 2-E completed summary:

- Added bounded `ai_usage_attempts` cleanup in `workers/auth/src/lib/ai-usage-attempts.js` for expired/stuck reservations and expired replay metadata.
- Integrated cleanup into the existing auth Worker scheduled cleanup path without adding a new cron trigger.
- Added admin-only sanitized APIs for usage-attempt list/detail and cleanup: `GET /api/admin/ai/usage-attempts`, `GET /api/admin/ai/usage-attempts/:id`, and `POST /api/admin/ai/usage-attempts/cleanup-expired`.
- Cleanup releases stale reservations without debits, marks expired finalizing attempts terminal, expires replay metadata, and does not delete attempts, ledger rows, usage events, or temporary replay objects.
- No new migration was required; Phase 2-E uses the existing `0036_add_ai_usage_attempts.sql` schema and indexes.
- Preserved legacy no-org image generation, admin AI routes, text routes, video routes, payment-provider flows, and full tenant migration as out of scope.

Phase 2-F completed summary:

- Added strict temporary replay object key validation for `tmp/ai-generated/{userId}/{tempId}` and explicit skips for unsafe or unrelated keys.
- Updated `workers/auth/src/lib/ai-usage-attempts.js` so expired, finalized, attempt-linked replay objects are deleted from `USER_IMAGES` only after prefix/user/attempt linkage checks pass.
- Updated the generic scheduled generated-temp cleanup in `workers/auth/src/index.js` to skip objects that are still linked from `ai_usage_attempts`; linked objects are handled by the usage-attempt cleanup path instead.
- Extended sanitized admin/scheduled cleanup counts without returning raw R2 keys, save references, hashes, prompts, provider payloads, or internal SQL/debug details.
- No new migration or route was required; Phase 2-F uses the existing `0036_add_ai_usage_attempts.sql` schema and the existing admin cleanup route.
- Preserved legacy no-org image generation, admin AI routes, text routes, video routes, payment-provider flows, and full tenant migration as out of scope.

Phase 2-H completed summary:

- Added backend-only `POST /api/ai/generate-text` for member-facing text generation with explicit organization context required.
- Reused the existing HMAC-authenticated `AI_LAB` service binding to call `/internal/ai/test-text`; no admin route handler is bypassed or charged.
- Enforced active org membership, `owner`/`admin`/`member` role, `ai.text.generate` entitlement, sufficient credits, and `Idempotency-Key`.
- Reused `ai_usage_attempts` for credit reservation, provider-call suppression, billing finalization, same-key conflict detection, and bounded text replay metadata.
- No new migration was required; Phase 2-H uses existing `0036_add_ai_usage_attempts.sql` metadata/status/expiry fields.
- Preserved legacy no-org image generation, org-scoped image behavior, admin AI Lab text generation, text asset storage routes, video routes, payment-provider flows, frontend UI, and full tenant migration as out of scope.

Findings resolved:

| Original finding | Current status | Evidence |
| --- | --- | --- |
| Failing static smoke tests | Resolved | `PHASE0_REMEDIATION_REPORT.md` records `npm run test:static` PASS, 155/155. |
| Missing `workers/ai/package-lock.json` and unreproducible AI worker package checks | Resolved | `workers/ai/package-lock.json` exists; `.github/workflows/static.yml` runs worker `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low`. |
| Unsigned internal Auth-to-AI Worker requests | Resolved in code | `js/shared/service-auth.mjs`, `workers/auth/src/lib/admin-ai-proxy.js`, and `workers/ai/src/index.js` implement and enforce HMAC service auth. |
| Timestamp-only service-auth replay window | Resolved in code | `workers/ai/src/lib/service-auth-replay.js`, `workers/ai/src/lib/service-auth-replay-do.js`, and `workers/ai/wrangler.jsonc` implement nonce-backed replay protection via `SERVICE_AUTH_REPLAY`. |
| Request body-size limited parsers for prioritized Worker routes | Resolved for Phase 0-B scope | `js/shared/request-body.mjs`, `workers/auth/src/lib/request.js`, `workers/contact/src/index.js`, and `workers/ai/src/lib/validate.js` enforce route-specific limits before parsing. |
| Admin MFA fixed-window-only lockout | Resolved for Phase 0 hardening | `workers/auth/migrations/0028_add_admin_mfa_failed_attempts.sql` and `workers/auth/src/lib/admin-mfa.js` add durable failed-attempt state and reset-on-success behavior. |
| Async video poison-message persistence for malformed/exhausted messages | Resolved for video jobs | `workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql` adds `ai_video_job_poison_messages`; `workers/auth/src/lib/ai-video-jobs.js` records redacted poison entries. |
| Runtime/toolchain pinning baseline | Resolved for Node/npm baseline | `.nvmrc`, `package.json` engines, and `scripts/check-toolchain.mjs` pin and validate Node 20/npm 10+ expectations. |
| `SESSION_SECRET` overused across independent security boundaries | Reduced | `workers/auth/src/lib/security-secrets.js`, `session.js`, `admin-mfa.js`, `pagination.js`, and `generated-image-save-reference.js` now use purpose-specific secrets for new writes with explicit legacy fallback. |

Findings reduced but not fully resolved:

| Original finding | Current status | Remaining risk |
| --- | --- | --- |
| Sensitive route rate limits fail open or degrade to isolate-local memory | Reduced | Priority and several lower-priority write routes now fail closed, but this remains route-specific rather than a full SaaS abuse/entitlement platform. |
| Missing fail-closed Worker config validation | Reduced | Phase 0 critical auth/AI service-auth config fails closed, and repo-side Cloudflare prereq validation exists, but live Cloudflare resources and dashboard controls are not fully verified. |
| Cloudflare dashboard drift | Partially addressed | Release config and prereq validator now record service-auth/replay requirements, but live Cloudflare WAF/header/RUM/secrets/bindings are not fully repo-enforced or verified. |
| CI security gates | Reduced | Root/Worker npm checks, Cloudflare prereq tests, body-parser guard, toolchain check, scanner tests, secret scan, DOM sink baseline, and targeted JS syntax check are now in CI/preflight. CodeQL/SAST, dependency review, SBOM, and license gates remain open. |
| Async admin video job foundation | Reduced | Phase 1-B adds default admin UI async create/status polling, queue-safe provider task create/poll, R2 output ingest, and poison-message persistence. Phase 1-C adds sanitized poison/failed-job inspection APIs. Full operational maturity still needs staging verification and dashboards. |
| Synchronous AI video provider polling | Reduced | The default admin UI and async queue path no longer call the old long synchronous provider route. Phase 1-C default-disables `/api/admin/ai/test-video` unless `ALLOW_SYNC_VIDEO_DEBUG=true`, but the route still exists for controlled admin/debug fallback. |
| Purpose-specific security secrets | Reduced | Phase 1-D separates new session, pagination, admin MFA encryption/proof/recovery, and AI save-reference material from `SESSION_SECRET`; legacy fallback remains during the migration window. |
| Route security policy scattered across handlers | Reduced | `workers/auth/src/app/route-policy.js`, `scripts/check-route-policies.mjs`, source route-policy markers, CI/preflight integration, and `tests/workers.spec.js` now provide explicit high-risk auth-worker route metadata and coverage checks. |
| Missing operational runbooks/SLO baseline | Reduced | `docs/SLO_ALERT_BASELINE.md`, `docs/OBSERVABILITY_EVENTS.md`, `docs/BACKUP_RESTORE_DRILL.md`, `docs/runbooks/*`, and `PHASE1F_OPERATIONAL_READINESS_REPORT.md` define repo-owned operational expectations and incident procedures, but Cloudflare alerts and restore drills remain unproven. |
| Scan-prone admin audit/activity search and raw activity cursors | Reduced | `0031_add_activity_search_index.sql`, `workers/auth/src/lib/activity-search.js`, updated `workers/auth/src/routes/admin.js`, and `scripts/check-admin-activity-query-shape.mjs` replace raw metadata search and raw cursors with indexed projection search and signed cursors for the admin audit/activity endpoints. |
| Compliance-grade data lifecycle | Reduced | `0032_add_data_lifecycle_requests.sql`, `0033_harden_data_export_archives.sql`, `workers/auth/src/lib/data-lifecycle.js`, `workers/auth/src/lib/data-export-archive.js`, `workers/auth/src/lib/data-export-cleanup.js`, `workers/auth/src/routes/admin-data-lifecycle.js`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md`, and `docs/DATA_DELETION_EXECUTOR_DESIGN.md` add admin/support planning foundations, bounded export archive generation, private archive metadata, bounded expired archive cleanup, safe reversible-action execution, deletion executor design, and retention documentation. User self-service, contact processor workflow, legal policy approval, irreversible deletion execution, and historical R2 owner backfill remain open. |
| Billing/plans/entitlements foundation | Reduced | `0035_add_billing_entitlements.sql`, `0036_add_ai_usage_attempts.sql`, `workers/auth/src/lib/billing.js`, `workers/auth/src/lib/ai-usage-policy.js`, `workers/auth/src/lib/ai-usage-attempts.js`, `workers/auth/src/routes/orgs.js`, `workers/auth/src/routes/admin-billing.js`, `workers/auth/src/routes/ai/text-generate.js`, route-policy/release updates, and Worker tests add default free plan resolution, org billing/entitlement reads, admin plan/org billing inspection, idempotent credit grants, idempotent credit consumption helpers, org-scoped image and text generation credit enforcement, credit reservations, duplicate provider-call suppression, temporary result replay, bounded stale reservation cleanup, temporary replay object cleanup, and sanitized admin usage-attempt inspection. Live payment provider integration and broad route-level credit enforcement remain open. |

Findings still open:

- Synchronous AI video provider polling is reduced but not eliminated because the legacy compatibility route still exists behind `ALLOW_SYNC_VIDEO_DEBUG=true` and should be retired after async staging confidence.
- Full lint/typecheck/checkJs and safe DOM remediation remain incomplete; Phase 1-C added low-risk baseline gates, and Phase 1-E added route policy guardrails for high-risk auth-worker route review.
- Legacy `SESSION_SECRET` fallback remains enabled until operators provision new secrets, deploy Phase 1-D safely, verify compatibility, and explicitly disable fallback after the migration window.
- Large admin/frontend/test modules remain monolithic.
- Historical audit/activity backfill, non-video queue schemas/DLQ, full tenant isolation, live payment-provider integration, permanent provider-result caching beyond temporary replay, text/video route credit enforcement, user self-service privacy flows, irreversible deletion execution, full observability/SLOs, and load/performance budgets remain open or deferred.

Current merge/deploy status:

| Area | Status | Notes |
| --- | --- | --- |
| Merge readiness | Pass for review/merge after commit | `npm run test:workers` passed 339/339, `npm run test:static` passed 155/155, `npm run release:preflight` passed, and `git diff --check` passed. All changed/new Phase 2-H files must be committed together. |
| Production deploy readiness | Blocked | Do not deploy until all required Worker secrets/bindings are live-verified, auth migrations `0028`-`0036` are applied, `SERVICE_AUTH_REPLAY`, `bitbi-ai-video-jobs`, `USER_IMAGES`, `AUDIT_ARCHIVE`, and `AI_LAB` are verified, `VIDU_API_KEY` is provisioned if Vidu async jobs are enabled, `ALLOW_SYNC_VIDEO_DEBUG` is absent/false unless explicitly approved, live health/header checks run with `--require-live`, dashboard-managed WAF/header/RUM/alert controls are verified, Phase 1-G activity projection writes/search are verified in staging, Phase 1-H/1-I/1-J data lifecycle planning/archive generation/archive cleanup/safe executor behavior is verified in staging, Phase 2-A organization flows are verified in staging after migration `0034`, Phase 2-B billing/entitlement/credit flows are verified in staging after migration `0035`, Phase 2-D org-scoped image usage retry/replay/reservation behavior is verified in staging after migration `0036`, Phase 2-E usage-attempt cleanup/admin inspection/scheduled cleanup behavior is verified in staging, Phase 2-F replay object cleanup dry-run/execution/scheduled behavior is verified in staging, and Phase 2-H org-scoped text generation success/replay/denial/failure compatibility is verified in staging. |
| Current recommended next phase | Tenant/payment or additional AI route track | Choose one narrow track: wire another AI route family to entitlements/credits, design payment-provider integration, or continue domain-by-domain tenant ownership migration. Do not combine all tracks into one broad rewrite. |

## Executive Summary

This repository is a real product codebase, not a toy prototype. It has meaningful Cloudflare Worker route tests, release compatibility checks, D1 migrations, admin MFA, private media handling, R2 cleanup flows, queue consumers, signed pagination in some places, and deliberate static asset versioning. Those are serious foundations.

It is not yet state-of-the-art SaaS production standard. The main blockers are not one-off bugs. They are systemic gaps: failing static smoke tests, inconsistent rate-limit fail-closed behavior on privileged and expensive paths, no defense-in-depth authentication on the internal AI worker, synchronous long-running AI video work, no enforced Cloudflare infrastructure-as-code for dashboard-managed security behavior, weak supply-chain reproducibility for `workers/ai`, no static type system, large monolithic modules, and missing enterprise SaaS primitives such as organizations, tenant isolation, billing enforcement, compliance-grade data lifecycle, SLOs, structured alerting, and disaster recovery evidence.

Current maturity estimate: functional single-product SaaS foundation, approximately 4.5 out of 10 for enterprise SaaS readiness. The repository can likely support a controlled launch if the failing tests are fixed and operational runbooks are followed. It should not be treated as enterprise-ready or investor/security-review-ready without the Phase 0 and Phase 1 work in this document.

## Repository Map

Observed architecture:

| Area | Evidence | Assessment |
| --- | --- | --- |
| Static frontend | `index.html`, `account/`, `admin/`, `legal/`, `js/`, `css/` | Plain HTML/CSS/vanilla ES modules. Intentional according to `AGENTS.md`. |
| Auth/API worker | `workers/auth/src/index.js`, `workers/auth/src/routes/`, `workers/auth/src/lib/` | Primary API surface for auth, account, admin, private media, member AI assets, admin AI proxy, queues, cron. |
| AI service worker | `workers/ai/src/index.js`, `workers/ai/src/routes/`, `workers/ai/src/lib/` | Internal AI lab service behind service binding. Handles Cloudflare AI, AI Gateway, Vidu fallback, live agent. |
| Contact worker | `workers/contact/src/index.js` | Contact form endpoint on `contact.bitbi.ai` using Resend and Durable Object rate limiting. |
| Database | `workers/auth/migrations/*.sql` | Cloudflare D1 schema with users, sessions, reset/verification tokens, profiles, favorites, AI folders/images/assets, quota usage, wallet SIWE, admin MFA. |
| Object storage | `workers/auth/wrangler.jsonc:81-97` | R2 buckets for private media, user images, audit archive. |
| Queues | `workers/auth/wrangler.jsonc:23-47` | AI image derivatives and activity ingest queues. |
| Durable Objects | `workers/auth/wrangler.jsonc:67-80`, `workers/contact/wrangler.jsonc` | Public rate limiter DOs. |
| Cloudflare Images | `workers/auth/wrangler.jsonc:58-60` | Image derivative pipeline depends on Images binding. |
| Release contract | `config/release-compat.json` | Strong repo-enforced release compatibility model, but manual dashboard prerequisites remain. |
| CI/CD | `.github/workflows/static.yml` | GitHub Pages deploy only. Workers deploy separately. Runs release checks, worker tests, static smoke tests, build. |
| Tests | `tests/*.spec.js`, `playwright.config.js`, `playwright.workers.config.js` | Playwright static and worker tests. Worker suite is broad; static suite currently fails locally. |
| Tooling | `package.json`, worker package files | No TypeScript, no lint script, no formatter script, no coverage script. `workers/ai` lacks package lock. |

Main execution flows:

| Flow | Path evidence | Notes |
| --- | --- | --- |
| Register/login/session | `workers/auth/src/routes/auth.js`, `workers/auth/src/lib/session.js`, `workers/auth/src/lib/cookies.js` | D1 user/session model, new session tokens hashed with `SESSION_HASH_SECRET`, legacy `SESSION_SECRET` fallback during Phase 1-D compatibility, cookies are `HttpOnly`, production admin secure-session policy exists. |
| Password reset/email verification | `workers/auth/src/routes/password.js`, `workers/auth/src/routes/verification.js`, `workers/auth/src/lib/email.js` | Token-hash model, Resend email, some best-effort behavior if email send fails. |
| Admin protection | `workers/auth/src/lib/session.js:187-257`, `workers/auth/src/routes/admin-mfa.js` | Role check plus production MFA enforcement. MFA endpoints lack route-level rate limiting. |
| Admin AI | `workers/auth/src/routes/admin-ai.js`, `workers/auth/src/lib/admin-ai-proxy.js`, `workers/ai/src/index.js` | Auth worker proxies admin requests to AI worker via service binding. AI worker itself does not verify a signed service credential. |
| Member AI image generation | `workers/auth/src/routes/ai/images-write.js` | Per-user generation limiter and daily quota slots. Generated image payloads are returned to client and later saved. |
| Private media | `workers/auth/src/routes/media.js`, `workers/auth/src/routes/avatar.js`, `workers/auth/src/routes/ai/files-read.js` | Authenticated ownership checks for private images/music/text assets. |
| Favorites and galleries | `workers/auth/src/routes/favorites.js`, static modules under `js/pages/index/` | Static catalog plus authenticated favorite state. |
| Wallet/SIWE | `workers/auth/src/routes/wallet.js`, `js/shared/wallet/` | Nonce/challenge flow, address checks, local wallet UI state. |
| Background work | `workers/auth/src/index.js:300-459` | Cron R2 cleanup and derivative re-enqueue; queue consumer processes activity and derivatives. |

Product domain:

The codebase appears to power BITBI, a media and AI creative SaaS with public galleries, Sound Lab, video/gallery decks, user accounts, saved AI images/assets, favorites, profile/avatar features, admin user management, admin AI lab tooling, wallet sign-in/linking, and contact form.

Missing production context that matters:

| Missing evidence | Why it matters | How to verify |
| --- | --- | --- |
| Cloudflare dashboard WAF/rate-limit rules | Repo explicitly says some security behavior is dashboard-managed. | Export Cloudflare rules or codify with Terraform/OpenTofu/Cloudflare API validation. |
| Static security headers transform rules | Static Pages headers depend on dashboard state. | Verify live response headers and encode rules in IaC or deployment checks. |
| Secret inventory and rotation policy | Phase 1-D separates auth purpose secrets, but Resend, Vidu, AI Gateway and future billing secrets still need lifecycle control. | Document secret owners, rotation cadence, break-glass, and validation tests. |
| Backup/restore evidence for D1/R2 | SaaS data durability cannot be inferred from code alone. | Run restore drills and add runbooks with RPO/RTO. |
| Production observability dashboards/alerts | Logs are enabled but traces, alerts, SLOs are not repo-defined. | Link dashboards, alert rules, on-call policy, and SLO burn alerts. |
| Load/performance baselines | No load tests or capacity targets were found. | Add k6/Artillery/Workers load tests and set budgets. |
| Legal/compliance operating procedures | App handles accounts, email, IPs, generated assets and audit logs. | Document retention, deletion, export, DPA/privacy flows, subprocessors. |

## Command Results

All commands below were non-destructive. Deployment, production mutation, destructive git commands, D1 remote migrations, and `release:apply` were not run.

| Command | Result | Interpretation |
| --- | --- | --- |
| `git status --short` | Clean before audit documentation work | Baseline was clean before report files were added. |
| `npm run test:release-compat` | Passed | Release compatibility contract is currently internally consistent. |
| `npm run test:release-plan` | Passed | Release planner tests pass. |
| `npm run test:asset-version` | Passed | Static asset-version placeholders and references pass current validation. |
| `npm run validate:release` | Passed | Release contract validates against repo state. |
| `npm run validate:asset-version` | Passed | Asset version validation passes. |
| `npm run test:workers` | Passed, 245 tests | Worker route tests are a relative strength. |
| `npm run test:static` | Failed, 152 passed and 3 failed | Main static smoke suite is not green locally. This is release-blocking because `.github/workflows/static.yml:190-191` runs it before deploy. |
| `npm audit --audit-level=low` at repo root | Initial sandbox DNS failure, rerun with approved network succeeded, 0 vulnerabilities | Root dependency audit is clean at current lockfile. |
| `npm audit --audit-level=low` in `workers/auth` | Initial sandbox DNS failure, rerun with approved network succeeded, 0 vulnerabilities | Auth worker dependency audit is clean at current lockfile. |
| `npm audit --audit-level=low` in `workers/contact` | Initial sandbox DNS failure, rerun with approved network succeeded, 0 vulnerabilities | Contact worker dependency audit is clean at current lockfile. |
| `npm audit --audit-level=low` in `workers/ai` | Failed with `ENOLOCK` | Real repo issue: `workers/ai` has no lockfile, so it cannot be audited reproducibly. |
| `npm ls --depth=0` at root | Passed | Root installed packages resolve. |
| `npm ls --depth=0` in `workers/auth` | Passed | Auth worker installed packages resolve. |
| `npm ls --depth=0` in `workers/contact` | Passed | Contact worker installed packages resolve. |
| `npm ls --depth=0` in `workers/ai` | Failed, `UNMET DEPENDENCY wrangler@^4.81.0` | Real repo issue: AI worker install state is incomplete and no lockfile exists. |
| `node --version` | `v24.14.0` | Local runtime differs from CI Node 20 in `.github/workflows/static.yml:33-39`, `57-63`, `181-187`. |
| `npm --version` | `11.9.0` | Local npm likely differs from CI. Pinning via `engines` or toolchain file is absent. |
| `npm run release:plan` | Passed, no file changes | Release plan script reports manual prerequisites and deploy order. |
| `npm run release:preflight` | Passed | Aggregated release checks passed, but note static smoke failure was run separately and failed. |
| `npm run build:static` | Not run by design | It rewrites `_site`; audit scope allowed documentation files only. |
| `npx wrangler deploy`, D1 remote migrations, `npm run release:apply` | Not run | Production-affecting commands were intentionally avoided. |
| Typecheck/lint/format/coverage | Not available as repo scripts | Tooling maturity gap. `package.json:4-20` has no lint, typecheck, format, or coverage script. |

Static test failures observed:

| Test | Evidence | Failure meaning |
| --- | --- | --- |
| `refreshing mid-page preserves the current scroll position` | `tests/smoke.spec.js:369-383`, source candidate `index.html:44` | Reload scroll restoration regressed by 793 px locally. |
| `refreshing near the category stage does not auto-jump the stage under the header` | `tests/smoke.spec.js:386-414`, source candidate `index.html:44` and `js/pages/index/category-carousel.js` | Reload near home category stage regressed by 237 px locally. |
| `Sign In with Ethereum shows a discovery state...` | `tests/wallet-nav.spec.js:369-383`, source candidate `js/shared/wallet/wallet-controller.js` | Wallet discovery UI state regressed; modal skips the expected discovery text when injected wallet announcement is delayed. |

## Top Critical Findings

| ID | Severity | Category | Evidence | Summary |
| --- | --- | --- | --- | --- |
| C1 | High | Release quality | `npm run test:static` failed; `.github/workflows/static.yml:190-191` | Static smoke suite is failing. The repo is not in a releasable state until this is fixed or explained as an environment-specific false positive. |
| C2 | High | Security | `workers/auth/src/routes/admin-mfa.js:52-240` | Admin MFA setup/enable/verify/disable/recovery endpoints lack route-level rate limiting and lockout/backoff. |
| C3 | High | Security/abuse | `workers/auth/src/lib/rate-limit.js:300-360`, `workers/auth/src/lib/admin-ai-proxy.js:37-41`, `workers/auth/src/routes/admin.js:174-176` | Privileged and expensive route rate limits fail open to per-isolate memory unless configured otherwise. |
| C4 | High | Service security | `workers/ai/src/index.js:15-72`, `workers/auth/src/lib/admin-ai-proxy.js:134-151` | Internal AI worker accepts `/internal/ai/*` requests without signed service authentication. |
| C5 | High | Reliability/scalability | `workers/ai/src/lib/invoke-ai-video.js:327-563` | Vidu video fallback can synchronously poll for up to 450 seconds in a request path. |
| C6 | High | Supply chain | `workers/ai/package.json:1-14`; no `workers/ai/package-lock.json` | AI worker dependency install/audit is not reproducible and currently fails `npm ls`. |
| C7 | Medium/High | Operations | `config/release-compat.json:224-244` | WAF, static security headers, and RUM settings remain dashboard-managed and are not repo-enforced. |
| C8 | Medium/High | Maintainability | `wc -l`: `js/pages/admin/ai-lab.js` 4613 lines, `tests/workers.spec.js` 12497 lines | Critical code and tests are monolithic, untyped, and hard to safely scale across a team. |
| C9 | Medium/High | Database/performance | `workers/auth/src/routes/admin.js:679-703`, `746-788`; `workers/auth/migrations/0012_add_user_activity_log.sql` | Admin/activity search and counts will scan large tables; cursors are raw unsigned strings in activity endpoints. |
| C10 | Medium/High | SaaS readiness | Schema and routes are user-centric only | No organization/team model, tenant isolation boundary, billing model, feature flags, compliance-grade data export/deletion, or SLO-defined operations. |

## Security Audit

### S1. Admin MFA endpoints lack route-level abuse controls

Severity: High

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/routes/admin-mfa.js` | Setup, enable, verify, disable, and recovery-code regeneration handlers parse bodies and call MFA functions without any `isSharedRateLimited` or lockout check at `52-240`. |
| `workers/auth/src/lib/admin-mfa.js` | TOTP is 6 digits with one time-step window at `16-21`; replay guard exists later, but brute-force throttling is not visible at the route boundary. |

Why it is dangerous:

Admin MFA is the final gate after password/session compromise. Without route-level throttling and account/IP backoff, a compromised admin password/session can repeatedly attempt TOTP or recovery code verification until external rate limits intervene. Dashboard WAF cannot be the only control because same-origin authenticated traffic can still be abusive.

Exploit or failure scenario:

An attacker obtains an admin password and session cookie, then scripts `/api/admin/mfa/verify` with TOTP guesses or stolen recovery code candidates. Application-layer audit logs see failures, but no deterministic per-admin/per-IP lockout stops attempts.

Recommended fix:

Add fail-closed Durable Object rate limiting and lockout for MFA verification and recovery-code attempts, keyed by admin user id plus IP. Add separate lower limits for setup/disable/regenerate. Record failed attempt counters and lockout expiration in D1 for durable account protection.

Best-practice alternative:

Use WebAuthn/passkeys for admin step-up and keep TOTP only as a fallback. Require fresh password or WebAuthn assertion for disabling MFA or regenerating recovery codes.

Estimated difficulty: Medium

Priority: P0

### S2. Privileged and expensive rate limits fail open on infrastructure failure

Severity: High

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/lib/rate-limit.js:300-360` | `isSharedRateLimited` falls back to in-memory counters unless `failClosed` is set. |
| `workers/auth/src/lib/admin-ai-proxy.js:37-41` | Admin AI rate limiting does not pass `failClosedInProduction` or Durable Object backend options. |
| `workers/auth/src/routes/admin.js:174-176` | Admin role mutation uses shared rate limiting without fail-closed options. |
| `workers/auth/src/routes/avatar.js:274-276` | Avatar upload limiter uses default behavior, then parses multipart form data. |
| `workers/auth/src/routes/ai/images-write.js:220-221` | Member AI generation limiter uses default behavior. |

Why it is dangerous:

The code has good fail-closed patterns for public auth/contact paths, but not consistently for expensive or privileged authenticated paths. If D1 rate-limit counters are unavailable, the fallback is per-isolate memory. Under Cloudflare scaling, that is not a global abuse control.

Exploit or failure scenario:

D1 has an outage or migration issue. An attacker with a valid low-privilege account sends many AI generation requests. Each isolate enforces its own memory counter, bypassing the intended global quota, increasing costs and load.

Recommended fix:

Make a default policy: privileged, auth, admin, upload, and AI-cost paths must use Durable Object rate limiting and fail closed in production. Keep fail-open only for low-risk read-only paths, and make that explicit with a named option.

Best-practice alternative:

Centralize abuse policy in a declarative route registry with per-route limiter backend, key, limits, fail behavior, and audit event names.

Estimated difficulty: Medium

Priority: P0

### S3. Internal AI worker has no signed service authentication

Severity: High

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/ai/src/index.js:15-72` | `/internal/ai/*` routes dispatch directly to handlers. No token, mTLS, HMAC, or service-auth validation is present. |
| `workers/auth/src/lib/admin-ai-proxy.js:134-151` | Auth worker sends admin id/email headers and correlation id, but no signed proof. |
| `workers/ai/wrangler.jsonc:5-6` | `workers_dev:false` and `preview_urls:false` reduce exposure, but are deployment configuration controls, not application authentication. |

Why it is dangerous:

The AI worker is protected by topology rather than by a cryptographic service boundary. A future route misconfiguration, preview exposure, custom domain, or additional service binding could expose expensive AI endpoints.

Exploit or failure scenario:

An operator adds a route for debugging or enables preview URLs. Attackers call `/internal/ai/test-video` directly and trigger AI/Vidu spend without an admin session.

Recommended fix:

Add a shared service secret for auth-to-AI calls. Sign method, path, timestamp, body hash, correlation id, and admin id with HMAC. Reject missing, expired, replayed, or invalid signatures in `workers/ai` before dispatch.

Best-practice alternative:

Use Cloudflare service binding plus application-level HMAC plus narrow per-route allowlist and structured audit logs of rejected internal calls.

Estimated difficulty: Medium

Priority: P0

### S4. Session and security material overuse `SESSION_SECRET`

Severity: Medium/High

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/lib/session.js:52,99` | Session token hashes derive from `SESSION_SECRET`. |
| `workers/auth/src/lib/admin-mfa.js:115-180` | Admin MFA proof HMAC keys and AES-GCM encryption keys derive from `SESSION_SECRET`. |
| `config/release-compat.json:158-167` | Manual prerequisite states `SESSION_SECRET` is required for sessions, signed pagination cursors, and admin MFA material. |

Why it is dangerous:

One secret compromise invalidates multiple independent security boundaries: sessions, admin MFA secret encryption, admin MFA proof signing, signed cursor material if used by pagination. It also complicates safe rotation because every use case has different blast radius and migration needs.

Exploit or failure scenario:

If `SESSION_SECRET` leaks, an attacker may not only attack sessions but also decrypt MFA secrets or mint MFA proof material depending on implementation details and available ciphertexts.

Recommended fix:

Split secrets by purpose: `SESSION_HASH_SECRET`, `PAGINATION_SIGNING_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, `AI_SERVICE_AUTH_SECRET`. Add key ids and rotation support.

Best-practice alternative:

Use a small key-management module with versioned keys, purpose labels, rotation plan, and tests proving old tokens remain valid only for defined grace periods.

Estimated difficulty: Medium/Large

Priority: P1

### S5. `getSessionUser` lacks fail-closed secret validation

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/lib/session.js:52,99` | `env.SESSION_SECRET` is interpolated directly. |
| `workers/auth/src/lib/admin-mfa.js:115-119` | MFA helper explicitly throws if missing, but session hashing does not. |

Why it is dangerous:

If `SESSION_SECRET` is absent in a non-production or misconfigured production environment, token hashing uses the string value of an undefined binding. That weakens isolation between environments and hides critical config mistakes.

Exploit or failure scenario:

A preview or staging Worker lacks `SESSION_SECRET`, silently uses predictable hash material, and sessions become transferable or forgeable within that environment.

Recommended fix:

Add environment validation on every Worker startup/fetch path before security-sensitive logic. Fail closed with a generic 503 and log a redacted config error if critical secrets are absent or too short.

Best-practice alternative:

Create `assertAuthWorkerConfig(env)` and `assertAiWorkerConfig(env)` functions with tests for missing/invalid bindings.

Estimated difficulty: Small

Priority: P0/P1

### S6. Request body size is not enforced before parsing JSON or multipart bodies

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/contact/src/index.js:133-155` | Calls `request.json()` before field slicing/length limits. |
| `workers/auth/src/routes/avatar.js:298-323` | Calls `request.formData()` before checking `file.size`. |
| `workers/auth/src/routes/ai/images-write.js:224-235` | Reads JSON prompt body through common helper; repository evidence did not show a global byte-size gate. |

Why it is dangerous:

Field-level limits after parsing do not protect CPU/memory from large request bodies. Workers have runtime limits; attackers can cause high memory or latency before validation rejects data.

Exploit or failure scenario:

An unauthenticated or low-privilege client posts an oversized JSON/multipart body to contact or avatar endpoints. The Worker spends memory parsing before applying small field limits.

Recommended fix:

Enforce `Content-Length` limits where present, stream/size-limit body reads, and reject unsupported media types before parsing. Use endpoint-specific max body sizes.

Best-practice alternative:

Centralize request parsing helpers: `readJsonBodyLimited(request, maxBytes)` and `readFormDataLimited(request, maxBytes)`.

Estimated difficulty: Small/Medium

Priority: P1

### S7. Admin and activity searches perform broad wildcard searches over sensitive logs

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/routes/admin.js:679-682` | Admin audit search uses `%search%` over admin email, target email, action, and `meta_json`. |
| `workers/auth/src/routes/admin.js:770-773` | User activity search uses `%search%` over user email, action, and `meta_json`. |

Why it is dangerous:

This is mostly performance and data-governance risk, not SQL injection because bindings are used. Searching raw JSON metadata broadens accidental sensitive-data exposure to admins and becomes expensive on large logs.

Exploit or failure scenario:

An admin searches short terms repeatedly; D1 scans large log tables and returns metadata containing fields that should not be routinely browsed.

Recommended fix:

Define an explicit searchable audit projection. Index action, created_at/id, actor, target, and normalized email prefixes. Avoid `%term%` over raw JSON.

Best-practice alternative:

Move audit search to a dedicated log/search store with field-level redaction and RBAC for support/admin roles.

Estimated difficulty: Medium

Priority: P2

### S8. Frontend has many `innerHTML` sinks without a repository-wide safe rendering policy

Severity: Medium

Confidence: Medium

Affected files:

| File | Evidence |
| --- | --- |
| `js/pages/index/soundlab.js:47` | Large template uses `${tr.artwork}` and `${tr.title}` in `innerHTML`. |
| `js/pages/index/locked-sections.js:218,326` | Templates insert media URLs/titles into HTML. |
| `js/shared/soft-nav.js:59` | Copies `newMain.innerHTML` during soft navigation. |
| `js/pages/admin/ai-lab.js` | Many `innerHTML` sinks in a 4613-line admin file. |

Why it is dangerous:

The current catalog data appears mostly local/static, and some modules escape data. But the codebase has no enforced safe DOM abstraction, no lint rule, and no CSP evidence in repo. As the product grows, one user/admin-supplied value flowing into a template becomes XSS.

Exploit or failure scenario:

A future admin-provided title or AI-generated metadata is rendered through an existing template without escaping, executing script in an authenticated user/admin context.

Recommended fix:

Create safe DOM helpers, ban raw `innerHTML` except reviewed constants, and add an ESLint/Semgrep rule. Convert data-driven templates to `textContent`, `setAttribute`, and DOM node construction.

Best-practice alternative:

Adopt a small trusted rendering layer that requires explicit `htmlTrustedConstant()` for static SVG/markup and default-escapes all dynamic values.

Estimated difficulty: Medium/Large

Priority: P1/P2

### S9. Password hashing is constrained and lacks modern adaptive password-hardening strategy

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/lib/passwords.js` | PBKDF2-SHA256 default/cap is 100,000 iterations. |
| `workers/auth/src/routes/auth.js` | Registration enforces length but not broader password-risk controls. |

Why it is dangerous:

PBKDF2 at 100k is acceptable in constrained Workers but not world-class password storage compared to Argon2id/scrypt. Length-only validation also misses compromised password checks.

Exploit or failure scenario:

If the D1 user table leaks, password cracking cost is lower than a modern Argon2id baseline.

Recommended fix:

Raise iterations if Worker latency budget allows, add password breach checks where appropriate, promote wallet/passkey login, and add admin MFA/WebAuthn requirements.

Best-practice alternative:

Use WebAuthn/passkeys for high-privilege roles and an auth provider or isolated password-hashing service if stronger memory-hard hashing is required.

Estimated difficulty: Medium

Priority: P2

### S10. Email verification and reset delivery lacks durable outbox/retry semantics

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/lib/email.js` | Verification/reset email helpers call Resend directly and return/suppress failures in places. |
| `workers/auth/src/routes/password.js` | Forgot-password response is generic, which is good, but delivery failure is logged and the request still returns generic success. |

Why it is dangerous:

Direct provider calls couple UX-critical auth flows to a third-party transient state. Generic success is correct for enumeration prevention, but without delivery status/outbox retry, users get stuck and support has poor diagnostics.

Exploit or failure scenario:

Resend has a transient failure. Reset tokens are created but emails do not arrive; users retry and create more tokens, support cannot tell whether delivery failed or the user missed the email.

Recommended fix:

Add an auth email outbox table/queue with provider status, retry/backoff, idempotency keys, and support-visible redacted delivery diagnostics.

Best-practice alternative:

Use a transactional email service abstraction with durable queue, webhook event ingestion, suppression handling, and template versioning.

Estimated difficulty: Medium

Priority: P2

### S11. Unrecognized queue batches are acknowledged

Severity: Medium

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `workers/auth/src/index.js:433-448` | If a batch is neither activity nor derivative, logs an error and `ack()`s each message. |

Why it is dangerous:

Silently acknowledging unknown messages can permanently drop messages after routing/config bugs. This protects the queue from poison loops but reduces forensic recovery.

Exploit or failure scenario:

A deploy changes message shape or queue name. Messages are misclassified, acknowledged, and lost before the issue is noticed.

Recommended fix:

Send unrecognized messages to a dead-letter queue or durable audit table instead of ack-only. Include message id, queue, sanitized body shape, and deploy version.

Best-practice alternative:

Version all queue messages with schemas and reject unknown versions to a DLQ with alerting.

Estimated difficulty: Medium

Priority: P2

### S12. Dashboard-managed security controls are outside repository enforcement

Severity: Medium/High

Confidence: High

Affected files:

| File | Evidence |
| --- | --- |
| `config/release-compat.json:224-244` | WAF rule, static security Transform Rules, and RUM setting are manual/dashboard-managed. |

Why it is dangerous:

Security controls that live only in a dashboard drift silently. The repository cannot prove production has the intended headers/rate limits/privacy settings.

Exploit or failure scenario:

A dashboard rule is edited or deleted during incident work. CI continues to pass, but production loses security headers or WAF throttling.

Recommended fix:

Move Cloudflare dashboard controls into IaC or add a CI/live validation step that fails if live settings drift.

Best-practice alternative:

Use Terraform/OpenTofu/Cloudflare API-managed infrastructure with drift detection and environment-specific plans.

Estimated difficulty: Medium/Large

Priority: P1

## Security Strengths

| Strength | Evidence |
| --- | --- |
| Same-origin guard for mutating auth worker requests | `workers/auth/src/index.js:131-143` checks `Origin` or `Referer`; email verification GET is intentionally exempt at `64-68`. |
| Admin secure-session policy | `workers/auth/src/lib/session.js:207-219` requires secure transport and secure cookie in production. |
| Admin MFA enforcement exists | `workers/auth/src/lib/session.js:221-253` rejects production admin access when MFA proof/enrollment is required. |
| Session cookies are `HttpOnly`, `SameSite=Lax`, and secure in secure contexts | `workers/auth/src/lib/cookies.js`. |
| SIWE wallet flow is relatively robust | Nonce, domain, URI, version, chain, statement, timestamp, and signature checks exist in `workers/auth/src/routes/wallet.js`; nonce/verify use fail-closed DO limits. |
| Contact form has strict origin and fail-closed Durable Object limiter | `workers/contact/src/index.js:70-131`. |
| Avatar MIME type and magic bytes are checked | `workers/auth/src/routes/avatar.js:311-327`. |
| Private media access uses authenticated route ownership | `workers/auth/src/routes/media.js`, `workers/auth/src/routes/ai/files-read.js`. |

## Performance Audit

### P1. Synchronous video polling will not scale

Evidence: `workers/ai/src/lib/invoke-ai-video.js:327-563` creates a Vidu task and polls until a URL is returned or timeout. Default timeout is 450,000 ms at `36-37`.

Why it will not scale:

Long-running Worker requests tie up runtime, increase failure probability, amplify provider latency, and create poor user/admin UX under load.

How it manifests under load:

Concurrent video tests generate many open outbound connections and long requests. Retries can duplicate provider work. Admin UI waits rather than observing job state.

How to measure:

Record p50/p95/p99 duration for `/api/admin/ai/test-video`, provider task creation latency, poll attempts, timeout rate, and Worker CPU/wall time. Add synthetic load for concurrent video requests.

Recommended fix:

Move video generation to a job model: create job row, enqueue provider work, poll/provider callback updates D1/R2, UI polls job status or uses SSE.

Expected benefit:

Lower request tail latency, safer retries, clearer cost control, better observability.

Priority: P0/P1

### P2. Admin activity search and counts are table-scan prone

Evidence: `workers/auth/src/routes/admin.js:679-703` searches joined audit logs with `%search%` and runs `GROUP BY action` over all audit rows. User activity search at `770-788` has the same pattern.

Why it will not scale:

Wildcard search over emails/actions/raw JSON prevents efficient indexing. Counts over all history become slower as logs grow.

How it manifests under load:

Admin activity pages become slow, D1 query time grows, and support dashboards compete with user traffic.

How to measure:

Seed 100k, 1M, and 10M audit rows locally or in staging. Track query duration and D1 read units for search, empty search, and counts.

Recommended fix:

Use signed cursor pagination everywhere, add indexed normalized columns, pre-aggregate counts by day/action, and avoid searching `meta_json`.

Expected benefit:

Predictable admin latency and lower D1 cost.

Priority: P1

### P3. Legacy member image list endpoint is capped but unpaginated

Evidence: `workers/auth/src/routes/ai/assets-read.js:25-59` returns `/api/ai/images` with `LIMIT 200`, while `/api/ai/assets` has signed cursor pagination at `61-120`.

Why it will not scale:

Hard-capped unpaginated endpoints create UX truncation and push clients to refetch large pages.

How it manifests under load:

Users with more than 200 images see incomplete results or repeated large payloads.

How to measure:

Create users with 50, 200, 1000 assets and measure response size, time to render, and client memory.

Recommended fix:

Deprecate `/api/ai/images` in favor of `/api/ai/assets` or add cursor pagination to the image-only endpoint.

Expected benefit:

Lower payloads and consistent asset browsing.

Priority: P2

### P4. Generated images are returned as base64 payloads

Evidence: `workers/auth/src/routes/ai/images-write.js` decodes/saves image data and returns generation results including image data in the request/response flow.

Why it will not scale:

Base64 adds approximately 33 percent payload overhead and increases Worker/client memory pressure. Large generated assets are better stored once and referenced.

How it manifests under load:

Slow generation responses, higher egress, higher memory, larger browser heap, higher chance of request failure.

How to measure:

Track response sizes, browser heap, and Worker memory/latency for each model output size.

Recommended fix:

Write generated outputs directly to R2 temporary storage and return signed references/URLs. Keep save references HMAC-signed and short-lived.

Expected benefit:

Smaller responses and safer asset lifecycle.

Priority: P1/P2

### P5. Cron cleanup jobs use small fixed batches

Evidence: temp object cleanup lists only 1000 objects at `workers/auth/src/index.js:81-85`; R2 cleanup queue processes 50 rows at `300-356`; derivative recovery enqueues 25 rows at `361-419`.

Why it will not scale:

Fixed small batches are safe, but without backlog metrics and alerts they can fall permanently behind after outages or traffic spikes.

How it manifests under load:

Expired temp objects accumulate, cleanup queues grow, derivative backlog persists, storage cost increases.

How to measure:

Emit metrics for scanned/deleted/failed counts, queue depth, oldest pending row age, derivative backlog and oldest pending derivative.

Recommended fix:

Add backlog metrics/alerts and adaptive pagination loops bounded by runtime budget.

Expected benefit:

Operational visibility and predictable cleanup.

Priority: P2

### P6. Static frontend has no bundle or performance budget

Evidence: No bundler or performance budget exists in `package.json:4-20` or CI. The frontend uses many ES modules and large files such as `js/pages/admin/ai-lab.js` with 4613 lines.

Why it will not scale:

Without bundle/perf budgets, page weight and module waterfalls can grow invisibly.

How it manifests under load:

Slow first load on mobile, more requests, worse Core Web Vitals, harder cache invalidation.

How to measure:

Add Lighthouse CI or WebPageTest scripts for homepage/account/admin with budgets for JS bytes, CSS bytes, LCP, CLS, INP.

Recommended fix:

Keep vanilla architecture if desired, but add performance budgets, module splitting discipline, and static analysis of JS/CSS sizes.

Expected benefit:

Prevents front-end degradation without requiring framework migration.

Priority: P2

### P7. D1 rate limiter writes on hot paths

Evidence: `workers/auth/src/lib/rate-limit.js:321-333` writes/updates a D1 counter for each limited request unless Durable Object backend is selected.

Why it will not scale:

D1 is not ideal as a high-frequency global counter backend for hot abuse paths.

How it manifests under load:

Write contention, increased latency, rate-limit failures during DB degradation.

How to measure:

Compare D1 limiter p95 latency and error rate against DO limiter under concurrent request load.

Recommended fix:

Use Durable Object counters for hot abuse paths; reserve D1 for durable audit snapshots or low-rate limits.

Expected benefit:

Lower DB pressure and cleaner failure modes.

Priority: P1

## Architecture Audit

### What exists today

The architecture is a Cloudflare-native, mostly serverless SaaS:

| Layer | Current design |
| --- | --- |
| Frontend | Static GitHub Pages site, vanilla JS modules, CSS, no SPA framework. |
| API gateway | `workers/auth` handles `/api/*` on `bitbi.ai`. |
| Internal AI service | `workers/ai` via Cloudflare service binding, no public route in wrangler config. |
| Contact service | Separate Worker on custom domain. |
| Data | D1 for relational account/app metadata, R2 for binary assets, Cloudflare Images for derivatives, Queues for async derivatives/activity ingest, DOs for rate limits. |
| Release | GitHub Pages workflow for static deploy; Workers deploy separately via wrangler/release scripts. |

Good architecture choices:

| Choice | Evidence | Why it is good |
| --- | --- | --- |
| Static frontend is intentionally simple | `AGENTS.md`, `package.json:4-20` | Low hosting complexity and small dependency surface. |
| Auth, AI, contact are separate Workers | `workers/*` | Clear service-level separation. |
| Release compatibility contract exists | `config/release-compat.json` | Prevents drift in critical routes/bindings/migrations. |
| Queues are used for derivatives/activity | `workers/auth/wrangler.jsonc:23-47` | Correct direction for async work. |
| D1 migrations are explicit | `workers/auth/migrations` | Better than implicit schema drift. |
| Some cursor pagination is signed | `workers/auth/src/routes/admin.js:102-156`, `workers/auth/src/routes/ai/assets-read.js:74-93` | Protects pagination state where applied. |

Dangerous or missing boundaries:

| Missing/dangerous boundary | Evidence | Risk |
| --- | --- | --- |
| No service-auth boundary for AI worker | `workers/ai/src/index.js:15-72` | Topology-only protection fails under misconfiguration. |
| No tenant/org boundary | Schema is user-centric; no organization/team tables found | Hard to add B2B, RBAC, billing, audit scoping later. |
| Manual route dispatcher is growing | `workers/auth/src/index.js:145-210` plus delegated route modules | As routes increase, policy consistency becomes harder. |
| No shared typed API contracts | No `tsconfig`, no typecheck script, no schema library | Frontend/backend contracts rely on tests and convention. |
| Admin UI is monolithic | `js/pages/admin/ai-lab.js` 4613 lines | Risky to evolve admin product safely. |
| Async model only partially applied | video remains synchronous | Expensive workflows are not uniformly job-based. |

Where current structure will break:

| Growth pressure | Failure point |
| --- | --- |
| More admins/support roles | Current `role` is effectively `user` or `admin`; no permission model for least privilege. |
| Organizations/teams | Tables and route ownership checks assume `user_id`; retrofitting `org_id` will touch most queries. |
| More AI providers/models | Admin AI lab and AI worker invocation modules are large and provider-specific logic is embedded in handlers. |
| Higher traffic/cost attacks | Rate limiting is inconsistent and some paths fail open. |
| Audit/compliance review | Dashboard-managed controls, no data retention/deletion/export proof, no restore drill evidence. |
| Team expansion | Lack of type system, linting, modular ownership and contract tests will increase review burden. |

### Proposed target architecture

Target design:

| Layer | Target state |
| --- | --- |
| Static frontend | Keep vanilla if intentional, but add safe DOM layer, route-level modules, performance budgets, and optional build step for analysis only. |
| API policy layer | Central route registry for auth level, body size, rate limit, CSRF/origin policy, response schema, audit event. |
| Domain modules | `auth`, `accounts`, `orgs`, `media`, `ai-assets`, `admin`, `billing`, `audit`, `notifications`, `wallets`. |
| Internal service auth | Signed HMAC service-to-service requests for Auth to AI. |
| Async jobs | Job table plus queues for video/music/image derivatives/email outbox/audit archive. |
| Data model | Organization/tenant tables, memberships, roles/permissions, plan/quota, audit scopes, data export/deletion jobs. |
| Observability | Structured logs plus traces, metrics, SLOs, alert definitions, correlation ids across workers and queues. |
| Infrastructure | Wrangler plus Terraform/OpenTofu or Cloudflare API validation for WAF, headers, RUM, routes, queues, buckets, D1, secrets metadata. |
| Contracts | Shared validators/schemas and contract tests for frontend/backend/admin/internal APIs. |

Suggested folder evolution:

```text
workers/auth/src/
  app/
    route-registry.js
    request-policy.js
    config.js
  domains/
    auth/
    accounts/
    orgs/
    admin/
    media/
    ai-assets/
    audit/
    billing/
    notifications/
    wallets/
  platform/
    d1/
    r2/
    queues/
    rate-limit/
    observability/
    crypto/
  contracts/
    public-api/
    admin-api/
    internal-events/
```

Migration strategy:

1. Add route policy wrappers around existing handlers without moving logic.
2. Add typed/runtime schemas for new or changed endpoints first.
3. Move one domain at a time behind interfaces.
4. Introduce org/tenant model with dual-write/compatibility views before enforcing tenancy.
5. Move long-running AI work to job model before adding more providers.

## Code Quality Audit

Major issues:

| Issue | Evidence | Why it matters | Recommended implementation style |
| --- | --- | --- | --- |
| Large monolithic modules | `js/pages/admin/ai-lab.js` 4613 lines; `js/shared/saved-assets-browser.js` 1531; `js/shared/wallet/wallet-controller.js` 1460; `workers/auth/src/lib/admin-mfa.js` 961; `workers/ai/src/lib/invoke-ai-video.js` 984 | Hard to review, test, and own. Changes become risky and conflicts increase. | Split by domain responsibility: state, API, rendering, validation, provider adapters, persistence. |
| Monolithic tests | `tests/workers.spec.js` 12497 lines; `tests/auth-admin.spec.js` 6004 lines | Hard to isolate failures and parallelize ownership. | Split by domain and route group; add test fixtures/builders. |
| No static type checking | `find` showed no root `tsconfig.json`; `package.json:4-20` has no typecheck | Runtime errors and API contract drift are caught late. | Start with `// @ts-check` plus JSDoc in Workers, then migrate contracts/domains to TypeScript if accepted. |
| No lint/format script | `package.json:4-20` | Code style and security rules cannot be enforced automatically. | Add ESLint or Biome with targeted rules for DOM sinks, no unbounded body reads, no raw service internal routes. |
| Mixed safe/unsafe rendering patterns | Some modules escape HTML, others use raw templates | Security quality depends on reviewer memory. | Provide safe rendering primitives and ban raw `innerHTML` except trusted constants. |
| Manual route dispatch | `workers/auth/src/index.js:145-210`, `workers/ai/src/index.js:23-71` | Policy is scattered across handlers. | Centralize route metadata and middleware/policy evaluation. |

What becomes expensive later:

| Current shortcut | Future cost |
| --- | --- |
| User-only data model | Adding teams/orgs later requires rewriting most ownership checks and indexes. |
| Untyped frontend/backend contracts | Every endpoint change requires manual grep/test inference. |
| Raw dashboard prerequisites | Production drift investigations become manual and incident-prone. |
| Synchronous provider calls | Hard to add retries, idempotency, cost controls, and user-facing progress. |

## Technology Maturity Audit

| Area | Rating | Evidence | Assessment |
| --- | --- | --- | --- |
| Cloudflare platform usage | Good but incomplete | Workers, D1, R2, Queues, DO, Images all used | Modern platform choices; missing IaC, traces, and consistent fail-closed policies. |
| Frontend stack | Simple and maintainable at small scale | Vanilla modules, static deploy | Not inherently bad. Needs safe DOM, performance budgets, and stronger modular discipline. |
| Type safety | Weak | No `tsconfig`, no typecheck script | Behind professional SaaS standard. |
| Dependency management | Mixed | Root/auth/contact locks exist; `workers/ai` lock missing | AI worker is below production standard. |
| CI/CD | Medium | Release checks and tests exist; no security gates | Good release-contract idea, but missing CodeQL/SAST/audit/coverage/perf gates. |
| Testing stack | Medium/Good | Broad Playwright worker tests | Strong worker route coverage, but static suite failing and no unit/load/security/contract coverage baseline. |
| Observability | Medium/Weak | Logs enabled, traces disabled | Correlation IDs/logging exist; metrics/alerts/SLOs not repo-defined. |
| Database tooling | Medium | Explicit migrations and indexes | No migration dry-run/rollback proof, no schema diagram, no load-tested query plans. |

Clear answer:

This repo is partially modern. The Cloudflare-native architecture and release compatibility checks are forward-looking. The absence of type safety, linting, reproducible AI worker dependency state, IaC for dashboard controls, SLOs, and load/security gates is behind top-tier SaaS practice.

Parts that are state-of-the-art or close:

| Part | Why |
| --- | --- |
| Release compatibility contract | Repository-specific, practical, and valuable. |
| Worker route tests | 245 passing tests is substantial. |
| Cloudflare service decomposition | Auth/AI/contact separation is sound. |
| Some signed cursor pagination | Correct pattern where applied. |
| SIWE validation detail | Good security discipline. |

Parts that are amateur-level or risky:

| Part | Why |
| --- | --- |
| `workers/ai` dependency state | No lockfile and failed install/audit checks. |
| No lint/typecheck/coverage scripts | Not acceptable for a scaling engineering team. |
| Dashboard-managed production security | Cannot prove production state from repo. |
| Long synchronous video polling | Classic pre-scale implementation pattern. |
| Huge untyped UI/admin modules | Fragile under team expansion. |

## SaaS Readiness Audit

SaaS maturity score: 4.5 out of 10.

Why:

| Capability | Status |
| --- | --- |
| User/account model | Present. |
| Sessions/password reset/email verification | Present. |
| Admin role and MFA | Present but hardening needed. |
| Private media ownership | Present. |
| Quotas | Basic member AI daily slots exist. |
| Organization/team model | Missing. |
| Tenant isolation | Missing beyond per-user ownership checks. |
| Billing/subscription | Missing. |
| Plan limits/entitlements | Missing except hardcoded AI quota. |
| Abuse prevention | Present but inconsistent. |
| Audit logs | Present for admin/user activity, but search/retention/compliance maturity is incomplete. |
| Data export/deletion | Not proven as product-grade user-facing capability. |
| Feature flags | Missing. |
| Environment separation | Some config exists; no full IaC evidence. |
| Backup/restore | Missing evidence. |
| Incident readiness | Missing SLOs, alerts, runbooks, on-call evidence. |
| Monitoring/error tracking | Logs/correlation exist, but no repo-defined alerting/tracing/metrics. |

SaaS blockers:

| Blocker | Why it blocks |
| --- | --- |
| No org/tenant model | Enterprise customers need teams, roles, invitations, audit scoping, ownership transfer. |
| No billing/entitlements | Cannot enforce paid plans, usage limits, or cost controls. |
| No compliance-grade data lifecycle | Users/customers will ask for export, deletion, retention, subprocessors, audit logs. |
| Incomplete ops posture | No evidence of backups, restore drills, SLOs, alerting, incident workflow. |
| Static tests failing | Release pipeline cannot be trusted until green. |

## Reliability and Operations Audit

Findings:

| Finding | Evidence | Risk | Recommended action |
| --- | --- | --- | --- |
| Static deploy path fails local static tests | `npm run test:static` failure; CI runs same script | Deploy blocks or flakes. | Fix failing scroll/wallet tests or isolate environment-specific cause. |
| Queue unknown messages are acked | `workers/auth/src/index.js:433-448` | Message loss on schema/config mismatch. | DLQ unknown message shapes. |
| Cron cleanup lacks backlog alerts | `workers/auth/src/index.js:81-85`, `300-419` | Backlog can grow silently. | Emit queue depth/oldest age metrics and alerts. |
| Traces disabled | `workers/auth/wrangler.jsonc:19-21`, `workers/ai/wrangler.jsonc:12-14` | Cross-service debugging is harder. | Enable traces where cost/privacy allows; propagate correlation IDs. |
| Manual Cloudflare prerequisites | `config/release-compat.json:158-244` | Production drift. | IaC or live drift checks. |
| Release deploys static only | `.github/workflows/static.yml` | Worker/static version skew possible. | Add coordinated release pipeline or enforced deploy order. |
| No disaster recovery proof | No backup/restore scripts found | Data loss or long outage risk. | D1/R2 backup and restore drill runbooks. |
| No idempotency framework for expensive operations | AI/video/provider calls are not uniformly job-idempotent | Duplicate cost under retry. | Idempotency keys and job table. |

## Testing Audit

Current state:

| Test type | Evidence | Assessment |
| --- | --- | --- |
| Static E2E/smoke | `playwright.config.js`, `tests/smoke.spec.js`, `tests/wallet-nav.spec.js` | Exists but currently failing locally. |
| Worker route tests | `playwright.workers.config.js`, `tests/workers.spec.js` | Strong. 245 passing tests. |
| Admin/auth tests | `tests/auth-admin.spec.js` | Broad but monolithic. |
| Release compatibility tests | `scripts/test-release-compat.mjs`, `scripts/validate-release-compat.mjs` | Strong custom validation. |
| Unit tests | Not clearly separated | Most tests are broad Playwright-style integration tests. |
| Contract tests | Partial through release tests, not schema-based | Needs explicit API contract validation. |
| Security tests | Partial route tests; no SAST or negative security suite baseline | Needs dedicated abuse/security tests. |
| Load/performance tests | Not found | Missing. |
| Coverage | Not found | Missing. |

Important missing tests:

| Missing test | Why it matters | Where it should live | Suggested cases |
| --- | --- | --- | --- |
| Admin MFA throttling/lockout | Protects admin boundary | `tests/auth-admin.spec.js` or split `tests/admin-mfa.spec.js` | Repeated invalid TOTP, recovery code failures, lockout expiry, fail-closed limiter outage. |
| AI service HMAC auth | Prevents internal endpoint exposure | `tests/workers.spec.js` | Missing signature, bad signature, expired timestamp, replay, valid service call. |
| Request body size limits | Prevents memory abuse | Worker tests | Oversized JSON to contact/auth/AI, oversized multipart avatar before parse. |
| Rate limiter fail-closed policy | Consistency for expensive routes | Worker tests | D1 missing/outage on admin AI/member AI/avatar/admin action. |
| Queue schema/DLQ behavior | Prevents silent message loss | Worker queue tests | Unknown message shape, bad version, partial failure, retry exhaustion. |
| Video job lifecycle | Required after async refactor | New AI job tests | create job, poll status, provider timeout, retry, duplicate idempotency key. |
| DB pagination/search at scale | Prevents future slow admin screens | Scripted integration/perf tests | 100k audit rows, cursor correctness, search latency, count aggregates. |
| Data deletion/export | Compliance | Worker tests | User delete removes/archives PII and R2 assets, export contains expected records. |
| CSP/XSS regression | Frontend security | Static tests plus lint/Semgrep | Inject generated metadata/title and verify it renders as text. |
| Backup/restore smoke | Ops | Scripts/CI manual workflow | Restore D1 export to staging/local and verify schema/checkpoints. |

## Database and Data Model Audit

Strengths:

| Strength | Evidence |
| --- | --- |
| Explicit migrations | `workers/auth/migrations/*.sql`. |
| User/session/token indexes exist | `workers/auth/migrations/0001_init.sql`, `0002_add_password_reset_tokens.sql`, `0004_add_email_verification.sql`. |
| Some cascade cleanup exists | Later migrations add `ON DELETE CASCADE` for profiles/activity-related tables and wallet tables. |
| Daily AI quota uses unique slots | `workers/auth/migrations/0014_add_ai_daily_quota_usage.sql` and reservation logic in `workers/auth/src/routes/ai/images-write.js:175-199`. |
| Cursor-support indexes exist | `workers/auth/migrations/0026_add_cursor_pagination_support.sql`. |

Risks:

| Risk | Evidence | Recommendation |
| --- | --- | --- |
| No org/tenant tables | No `organizations`, `memberships`, `tenant_id`, or plan tables found | Add org/membership/role/plan schema before enterprise growth. |
| Some early user-owned tables lack cascade and rely on manual cleanup | `ai_images` and `ai_folders` originally reference users without cascade in `0007_add_image_studio.sql` | Decide between cascade and explicit deletion services; test all paths. |
| Activity search is not index-friendly | `workers/auth/src/routes/admin.js:679-703`, `770-788` | Add searchable projection and indexes, avoid raw JSON search. |
| Table-recreate migrations for CHECK changes | `0021`, `0022`, `0025` | Acceptable for D1 constraints, but needs migration rehearsals and backups. |
| D1 batch used for related security updates | Password reset/email verification use batch-style operations | Verify D1 transactional guarantees; use explicit transactions if available or single guarded statements where possible. |
| Timestamps are plain ISO strings | Repo pattern | Standardize timezone, precision, and DB defaults. |

Target data model additions:

| Table/domain | Purpose |
| --- | --- |
| `organizations` | Tenant boundary and billing owner. |
| `organization_memberships` | User roles within orgs. |
| `roles` / `permissions` or enum policy table | Least-privilege admin/support/product roles. |
| `subscriptions` / `plans` / `entitlements` | Billing and feature enforcement. |
| `usage_events` / `usage_counters` | Billable and quota usage. |
| `jobs` | Async AI/email/export/deletion lifecycle. |
| `audit_events` normalized projection | Searchable, exportable, retention-aware audit stream. |
| `data_exports` / `deletion_requests` | Compliance operations. |

## Frontend Audit

Findings:

| Finding | Evidence | Risk | Recommended action |
| --- | --- | --- | --- |
| Static smoke failures in homepage scroll restore | `tests/smoke.spec.js:369-414`, `index.html:43-44` | UX regressions and failed CI deploy. | Fix scroll restoration logic and add stable waits/test instrumentation. |
| Wallet discovery state failure | `tests/wallet-nav.spec.js:369-383`, `js/shared/wallet/wallet-controller.js` | Authentication UX regression. | Make discovery state deterministic until announcement timeout expires. |
| Many `innerHTML` sinks | `rg innerHTML` output across `js/` | Future XSS risk. | Safe DOM helper and lint rule. |
| Large admin AI page | `js/pages/admin/ai-lab.js` 4613 lines | Hard to secure and evolve. | Split into API client, provider panels, save modal, state reducer/store, render helpers. |
| Local storage state not threat-modeled | Wallet/audio/admin AI store local state | Privacy/session confusion risk. | Define persisted keys, TTLs, clear-on-logout semantics, and tests. |
| No accessibility audit evidence | Static tests likely cover some UI, but no axe/lighthouse config found | Enterprise UX/compliance gap. | Add accessibility scans for critical flows. |
| No performance budget | No Lighthouse CI or asset budget script | Regressions hidden. | Add budgets for homepage/account/admin. |

## Backend/API Audit

Strengths:

| Strength | Evidence |
| --- | --- |
| Route-level auth helpers | `requireUser`, `requireAdmin`. |
| Same-origin mutating request guard | `workers/auth/src/index.js:131-143`. |
| Parameter binding for SQL queries | Admin/search code uses bound placeholders, reducing SQL injection risk. |
| Some signed pagination | Admin users and member assets. |
| Structured diagnostics | Shared observability module imported widely. |

Weaknesses:

| Weakness | Evidence | Recommendation |
| --- | --- | --- |
| API policy is not centralized | Each route manually applies auth, rate limit, body parsing, validation | Route registry with policy metadata. |
| Response schemas are informal | No shared schema/types | Add validators and contract tests. |
| Pagination consistency gaps | Activity endpoints use raw cursors, assets endpoint uses signed cursors | Sign all cursors. |
| Versioning strategy absent | No `/v1` or explicit contract version | Add explicit API version or compatibility policy before external integrations. |
| Admin RBAC is binary | `role` is `user` or `admin` | Introduce permissions for support/admin/security/billing roles. |
| Expensive provider calls not idempotent enough | Video path synchronous | Job/idempotency framework. |

## Infrastructure and Deployment Audit

Findings:

| Finding | Evidence | Risk | Recommended action |
| --- | --- | --- | --- |
| Static CI deploy does not deploy Workers | `.github/workflows/static.yml` deploys GitHub Pages only | Static/backend version skew. | Use release pipeline that enforces migrations, workers, static deploy order or blocks incompatible static deploys. |
| Manual prerequisites remain | `config/release-compat.json:158-244` | Drift and human error. | IaC or live validation. |
| No security scanning in CI | `.github/workflows/static.yml` lacks audit/CodeQL/SAST/secret scanning | Supply-chain/security regressions can merge. | Add security jobs. |
| `workers/ai` no lockfile | no package lock found | Non-reproducible deploy. | Add lockfile and `npm ci` validation. |
| Worker traces disabled | wrangler configs | Harder incident investigation. | Enable traces or documented alternative. |
| No health checks for all services | Auth has `/api/health`; AI/contact health not evident | Monitoring blind spots. | Add health/readiness endpoints or synthetic checks. |
| Node version mismatch | CI Node 20, local Node 24 | Reproducibility risk. | Pin engines/toolchain and use same version locally/CI. |

## Prioritized Findings

| Rank | Severity | Category | Affected area/files | What is wrong | Why it matters | If ignored | Fix | Effort | Blocks SaaS readiness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | High | Release | `npm run test:static`, `tests/smoke.spec.js`, `tests/wallet-nav.spec.js` | Static smoke suite fails. | CI deploy path is not trustworthy. | Broken UX or blocked deploys. | Fix scroll restore and wallet discovery regressions. | M | Yes |
| 2 | High | Security | `workers/auth/src/routes/admin-mfa.js` | Admin MFA attempts are not rate limited/locked. | Admin boundary can be brute-forced after password/session compromise. | Privilege escalation risk. | Add fail-closed DO limiter and lockout. | M | Yes |
| 3 | High | Abuse/cost | `rate-limit.js`, `admin-ai-proxy.js`, `admin.js`, `images-write.js` | Expensive/privileged rate limits fail open. | Cost and abuse controls degrade under DB failure. | AI spend and admin endpoints exposed to abuse. | Make fail-closed DO rate limits default for sensitive paths. | M | Yes |
| 4 | High | Service security | `workers/ai/src/index.js`, `admin-ai-proxy.js` | Internal AI endpoints lack HMAC. | Misconfiguration can expose expensive endpoints. | Direct AI abuse. | Signed service authentication. | M | Yes |
| 5 | High | Reliability | `invoke-ai-video.js` | Long synchronous video polling. | Tail latency, duplicate provider cost, Worker limits. | Unstable AI/video operations. | Async job/queue model. | L | Yes |
| 6 | High | Supply chain | `workers/ai/package.json` | No lockfile, `npm ls` fails. | Non-reproducible deploy/audit. | Hidden dependency drift. | Add lockfile, CI `npm ci` for worker packages. | S | Yes |
| 7 | Medium/High | Operations | `config/release-compat.json` | Dashboard rules outside repo. | Cannot prove production security state. | Drift, missing headers/WAF. | IaC or live drift checks. | M/L | Yes |
| 8 | Medium/High | Architecture | schema/routes | No tenant/org/billing model. | Enterprise SaaS cannot be layered cleanly. | Costly rewrite later. | Add org/membership/plan/entitlement model. | XL | Yes |
| 9 | Medium/High | Maintainability | large JS/test files | Monoliths and no typecheck. | Team velocity and safety degrade. | Regressions increase. | Split modules, add type/lint. | L | Partially |
| 10 | Medium | Database | `admin.js` activity queries | Broad scans and raw cursors. | Admin pages slow as logs grow. | D1 pressure and support pain. | Indexed projections, signed cursors, aggregates. | M | Partially |
| 11 | Medium | Security | request parsing | Body limits after parsing or not visible. | Memory/CPU abuse. | Worker exhaustion. | Byte-limited parsers. | S/M | Partially |
| 12 | Medium | Ops | queue handler | Unknown messages acked. | Silent data loss. | Lost jobs/audit. | DLQ/versioned messages. | M | Partially |
| 13 | Medium | Observability | wrangler traces disabled, no alert definitions | Logs exist but no SLOs/alerts. | Incidents discovered late. | Longer outages. | SLO/metrics/alerts/runbooks. | M/L | Yes |
| 14 | Medium | Frontend security | many `innerHTML` sinks | No enforced safe rendering policy. | Future XSS risk. | Account/admin compromise via XSS. | Safe DOM layer and lint rule. | M/L | Partially |
| 15 | Medium | Data lifecycle | no export/delete proof | Compliance gap. | Enterprise blockers. | Legal/support risk. | Export/delete jobs and tests. | L | Yes |
| 16 | Medium | Email reliability | direct Resend calls | No durable outbox/retry. | Auth emails can silently fail. | Support burden/login failure. | Email outbox/queue/webhook status. | M | Partially |
| 17 | Medium | Performance | no load/perf budgets | No capacity evidence. | Unknown scaling limits. | Surprises under traffic. | k6/Lighthouse budgets. | M | Partially |
| 18 | Medium | DX | no lint/type/format/coverage | Weak quality gates. | Review burden. | Slow team growth. | Add scripts and CI. | M | Partially |
| 19 | Low/Medium | Password security | PBKDF2 100k | Acceptable but not elite. | Lower breach resistance. | Faster offline cracking if DB leaks. | Improve hashing/passkeys/breach checks. | M | No |
| 20 | Low/Medium | Runtime reproducibility | CI Node 20, local Node 24 | Tooling drift. | Environment-specific bugs. | Flaky builds/tests. | Pin Node/npm versions. | S | No |

## Scores

| Dimension | Score | Evidence | What raises it to 9+ | Current blocker |
| --- | --- | --- | --- | --- |
| Overall code quality | 6.2 | Working product, broad tests, but large untyped modules | Modular typed domains, lint, coverage, contract tests | Monoliths, no type/lint gates |
| Security | 6.5 | Good auth/session/MFA basics, SIWE, origin checks | MFA throttling, service HMAC, body limits, IaC security, SAST | Inconsistent fail-closed controls and internal service auth |
| Architecture | 6.0 | Clean Cloudflare service split | Route policy layer, domain boundaries, org/tenant model | User-centric architecture and scattered policy |
| Performance | 5.5 | Static site and Cloudflare edge are efficient foundations | Load tests, async AI, query indexes, perf budgets | Synchronous video, scan-prone admin queries |
| Scalability | 5.2 | Queues/DOs exist | Job model, org/tenant scaling, global rate limits, capacity tests | D1 hot counters and missing tenant architecture |
| Maintainability | 5.4 | Clear file structure and tests | Smaller modules, typed contracts, owners, lint | Large files and informal contracts |
| Testing | 7.0 | 245 worker tests and many static tests | Green full suite, unit/contract/security/load/coverage gates | Static suite failing, no coverage/load/security gates |
| SaaS readiness | 4.5 | Accounts/admin/private media exist | Org/billing/compliance/ops primitives | Missing enterprise platform features |
| Operational readiness | 4.8 | Logs, release plan, queues | SLOs, alerts, restore drills, IaC, incident runbooks | Dashboard drift and no backup/alert evidence |
| Developer experience | 5.8 | Simple scripts and tests | Unified `npm ci` for all workspaces, lint/type/format, docs | Worker package inconsistency and no type/lint |
| Technology modernity | 5.6 | Cloudflare-native stack is modern | Typed JS/TS, IaC, security tooling, observability | Tooling gaps and manual dashboard controls |
| Future-proofing | 4.8 | Some release discipline | Tenant architecture, async jobs, contracts, governance | Current model will be expensive to evolve for enterprise |

## Target-State Recommendation

Target security model:

| Area | Target |
| --- | --- |
| Authentication | Sessions with purpose-specific secrets, rotation support, admin WebAuthn/passkeys, strict secure cookies. |
| Authorization | Central policy engine with roles/permissions scoped to org/team/admin/support contexts. |
| Service-to-service | HMAC-signed Auth to AI calls with timestamp/replay protection. |
| Rate limiting | Durable Object fail-closed by default for sensitive/expensive routes. |
| Input validation | Per-route body-size limits and schema validation before business logic. |
| Secrets | Purpose-specific key material with key ids and rotation runbooks. |
| Audit | Immutable append-only audit events with searchable redacted projections. |

Target performance strategy:

| Area | Target |
| --- | --- |
| AI generation | Asynchronous jobs for video/music/large images, idempotency keys, provider status tracking. |
| DB queries | Indexed pagination, precomputed aggregates, no raw JSON wildcard search on hot paths. |
| Static frontend | Performance budgets and asset-size checks in CI. |
| Media | Store binary assets in R2/Images and return references rather than base64 payloads. |
| Rate limiting | DO counters for hot paths; D1 for durable snapshots only. |

Target testing strategy:

| Layer | Target |
| --- | --- |
| Unit | Domain logic, validators, crypto helpers, pagination, rate policy. |
| Integration | Worker route tests by domain. |
| Contract | Shared request/response schemas for frontend/backend/internal APIs. |
| E2E | Static flows, wallet, auth, admin, media, AI happy paths. |
| Security | Abuse, CSRF/origin, auth bypass, BOLA, size limits, MFA lockout. |
| Load | k6/Artillery for auth, admin activity, AI jobs, media reads. |
| Ops | Backup restore, queue retry/DLQ, migration rehearsal. |

Target CI/CD:

| Gate | Target |
| --- | --- |
| Install | `npm ci` root and every worker package with lockfiles. |
| Static checks | lint, typecheck/checkJs, format, dependency audit, secret scan. |
| Tests | unit, worker, static, contract, release compatibility. |
| Security | CodeQL/Semgrep, dependency review, license/SBOM, audit. |
| Release | Plan, apply migrations, deploy workers in order, deploy static, run live canaries. |
| Drift | Validate Cloudflare route/binding/WAF/header/RUM state. |

## Roadmap

### Phase 0: Critical Blockers

Objectives:

Fix releasability, close immediate admin/AI abuse gaps, restore supply-chain reproducibility.

Tasks:

| Order | Task | Files/areas | Impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | Fix failing static smoke tests | `index.html`, `js/pages/index/category-carousel.js`, `js/shared/wallet/` | Restores deploy confidence | M |
| 2 | Add MFA rate limiting and lockout | `workers/auth/src/routes/admin-mfa.js`, `workers/auth/src/lib/admin-mfa.js`, tests | Reduces admin takeover risk | M |
| 3 | Make sensitive rate limits fail closed | `rate-limit.js`, admin, avatar, AI generation/proxy routes | Reduces abuse/cost exposure | M |
| 4 | Add Auth-to-AI HMAC service auth | `admin-ai-proxy.js`, `workers/ai/src/index.js`, tests | Protects internal AI endpoints | M |
| 5 | Add `workers/ai/package-lock.json` and CI install/audit | `workers/ai`, `.github/workflows/static.yml` | Reproducible AI worker builds | S |
| 6 | Add config validation for critical secrets/bindings | all Workers | Fail-closed misconfiguration | S/M |

Expected risk reduction:

High. These items address release failure, admin boundary, AI spend exposure, and supply-chain reproducibility.

### Phase 1: SaaS Foundation

Objectives:

Harden auth/input validation, add quality gates, make behavior observable and testable.

Tasks:

| Order | Task | Files/areas | Impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | Add request body size limited parsers | `workers/auth/src/lib/request.js`, contact/avatar/AI routes | Prevents memory abuse | S/M |
| 2 | Split security secrets by purpose | config, crypto helpers, migrations if needed | Reduces blast radius | M/L |
| 3 | Add lint/typecheck/checkJs and safe DOM rules | root tooling, `js/`, `workers/` | Improves maintainability/security | M |
| 4 | Add route policy registry | `workers/auth/src/app/` | Consistent auth/rate/body policies | M/L |
| 5 | Add CI security gates | `.github/workflows/static.yml` | Prevents supply-chain/security drift | M |
| 6 | Add alert/runbook baseline | docs, scripts, wrangler observability | Incident readiness | M |

### Phase 2: Scalability and Architecture

Objectives:

Move expensive work async, improve database/query patterns, introduce domain boundaries.

Tasks:

| Order | Task | Files/areas | Impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | Convert video generation to job/queue model | `workers/ai`, `workers/auth`, migrations, admin UI | Reliability and cost control | L |
| 2 | Add indexed audit/search projection and signed activity cursors | `workers/auth/migrations`, `routes/admin.js` | Scalable admin pages | M |
| 3 | Deprecate or paginate `/api/ai/images` | `assets-read.js`, frontend asset browser | Lower payloads | M |
| 4 | Split large admin/wallet/asset modules | `js/pages/admin/ai-lab.js`, shared modules | Team scalability | L |
| 5 | Add load/perf tests | `scripts/`, CI optional workflow | Capacity visibility | M |

### Phase 3: Enterprise Readiness

Objectives:

Add SaaS platform primitives and compliance-grade operations.

Tasks:

| Order | Task | Files/areas | Impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | Add organization/team/membership model | migrations, auth/session, routes, UI | Tenant foundation | XL |
| 2 | Add RBAC/permissions | domain policy, admin UI | Least privilege | L |
| 3 | Add billing/plan/entitlement/usage model | migrations, AI quotas, admin/account UI | Monetization and cost controls | XL |
| 4 | Add data export/deletion jobs | migrations, queues, R2/D1 services | Compliance readiness | L |
| 5 | Add audit archive/search improvements | audit domain, R2 archive, admin tools | Enterprise support | L |
| 6 | Add feature flags | config/domain | Safer rollout | M |

### Phase 4: World-Class Engineering Maturity

Objectives:

Automate quality governance and operational excellence.

Tasks:

| Order | Task | Files/areas | Impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | Full IaC/drift management | Cloudflare resources, repo CI | Production reproducibility | L/XL |
| 2 | SLOs/error budgets and alerting | dashboards/runbooks/CI docs | Incident maturity | L |
| 3 | Continuous security program | CodeQL/Semgrep/dependency review/SBOM/license | Audit readiness | M/L |
| 4 | Restore drills and chaos tests | scripts/docs/staging | Disaster recovery confidence | M/L |
| 5 | Architecture governance | ADRs, ownership, module boundaries | Long-term maintainability | M |
| 6 | Advanced test matrix | unit/contract/load/security/visual/a11y | Regression prevention | L |

## Appendices With Evidence

### A. Key file and line evidence

| Evidence | Meaning |
| --- | --- |
| `package.json:4-20` | Scripts include tests/release/build but no lint/typecheck/format/coverage. |
| `.github/workflows/static.yml:28-66` | Release compatibility and worker validation jobs. |
| `.github/workflows/static.yml:190-200` | Static tests run before static build/deploy. |
| `workers/auth/wrangler.jsonc:14-21` | Logs enabled, traces disabled. |
| `workers/auth/wrangler.jsonc:23-47` | Queue producers/consumers configured. |
| `workers/auth/wrangler.jsonc:61-65` | Auth worker binds to AI worker as `AI_LAB`. |
| `workers/ai/wrangler.jsonc:5-6` | AI worker public dev/preview exposure disabled. |
| `config/release-compat.json:158-244` | Manual prerequisites and dashboard-managed controls. |
| `workers/auth/src/lib/session.js:52,99` | Session token hash uses `SESSION_SECRET`. |
| `workers/auth/src/lib/session.js:207-253` | Admin secure session and MFA enforcement. |
| `workers/auth/src/routes/admin-mfa.js:52-240` | Admin MFA handlers lack explicit route-level limiter. |
| `workers/auth/src/lib/admin-mfa.js:20-21` | MFA proof TTL is 12 hours. |
| `workers/auth/src/lib/admin-mfa.js:140-180` | MFA secret encryption derives key from `SESSION_SECRET`. |
| `workers/auth/src/lib/rate-limit.js:300-360` | Shared limiter falls back to memory unless fail-closed. |
| `workers/auth/src/lib/admin-ai-proxy.js:37-41` | Admin AI limiter uses default behavior. |
| `workers/ai/src/index.js:15-72` | AI internal routes have no HMAC/auth check. |
| `workers/ai/src/lib/invoke-ai-video.js:327-563` | Synchronous Vidu provider create and poll loop. |
| `workers/auth/src/routes/admin.js:679-703` | Admin activity wildcard search/counts. |
| `workers/auth/src/routes/admin.js:746-788` | User activity wildcard search/raw cursor. |
| `workers/auth/src/routes/avatar.js:298-323` | `request.formData()` before file-size rejection. |
| `workers/contact/src/index.js:133-155` | `request.json()` before field size validation. |
| `workers/auth/src/index.js:433-448` | Unknown queue batches are acked. |
| `tests/smoke.spec.js:369-414` | Static scroll restoration tests that failed locally. |
| `tests/wallet-nav.spec.js:369-383` | Wallet discovery test that failed locally. |

### B. Large files observed

| File | Lines |
| --- | --- |
| `js/pages/admin/ai-lab.js` | 4613 |
| `js/shared/saved-assets-browser.js` | 1531 |
| `js/shared/wallet/wallet-controller.js` | 1460 |
| `workers/auth/src/lib/admin-mfa.js` | 961 |
| `workers/auth/src/routes/ai/images-write.js` | 761 |
| `workers/ai/src/lib/invoke-ai-video.js` | 984 |
| `tests/workers.spec.js` | 12497 |
| `tests/auth-admin.spec.js` | 6004 |

### C. What was not changed

No application code, tests, layouts, styles, configs, migrations, package files, or assets were modified during this audit. Only audit documentation files were created.
