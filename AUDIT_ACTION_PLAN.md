# AUDIT_ACTION_PLAN.md

Date: 2026-04-24

Last updated: 2026-04-26 after Phase 0-A, Phase 0-A+, Phase 0-B, Phase 1-A, Phase 1-B, Phase 1-C, Phase 1-D purpose-specific secret hardening, Phase 1-E route policy registry hardening, Phase 1-F operational readiness foundations, Phase 1-G audit/activity search scalability hardening, Phase 1-H data lifecycle foundation work, Phase 1-I export archive/delete-executor foundation work, Phase 1-J retention/executor pilot work, Phase 2-A organization/RBAC foundation work, Phase 2-B billing/entitlement foundation work, Phase 2-C org-scoped AI image usage enforcement, Phase 2-D org-scoped AI usage reservation hardening, Phase 2-E AI usage attempt cleanup/admin inspection, Phase 2-F AI replay object retention cleanup, Phase 2-H org-scoped member text generation API work, Phase 2-I billing event ingestion foundation work, Phase 2-J Stripe Testmode credit-pack checkout foundation work, and the Admin Control Plane UI phase.

Scope: top 20 highest-impact fixes for `/Users/btc2020/Bitbi/Bitbi`, preserved in exact original priority order. This file is now a status-tracked action plan. Historical audit findings are not deleted; each item records current status, evidence, remaining risk, and the next action.

Source documents:

- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- `PHASE0B_REMEDIATION_REPORT.md`
- `AI_VIDEO_ASYNC_JOB_DESIGN.md`
- `PHASE1A_REMEDIATION_REPORT.md`
- `PHASE1B_REMEDIATION_REPORT.md`
- `PHASE1C_REMEDIATION_REPORT.md`
- `PHASE1D_SECRET_ROTATION_REPORT.md`
- `PHASE1E_ROUTE_POLICY_REPORT.md`
- `PHASE1F_OPERATIONAL_READINESS_REPORT.md`
- `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md`
- `PHASE1H_DATA_LIFECYCLE_REPORT.md`
- `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md`
- `PHASE1J_RETENTION_EXECUTOR_REPORT.md`
- `PHASE2A_ORG_RBAC_REPORT.md`
- `PHASE2B_BILLING_ENTITLEMENTS_REPORT.md`
- `PHASE2C_AI_USAGE_ENTITLEMENTS_REPORT.md`
- `PHASE2D_AI_USAGE_RESERVATION_REPORT.md`
- `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md`
- `PHASE2F_AI_REPLAY_OBJECT_RETENTION_REPORT.md`
- `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md`
- `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md`
- `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`
- `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`
- `PHASE1_COMPLETION_HANDOFF.md`
- `PHASE2A_ENTRYPOINT.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`
- `docs/DATA_DELETION_EXECUTOR_DESIGN.md`
- `PHASE1_OBSERVABILITY_BASELINE.md`
- Current git status and diff as of this update
- Phase 0-A/0-A+/0-B changed application, config, CI, and test files

## Current Readiness Summary

| Area | Status | Evidence | Remaining risk | Next action |
| --- | --- | --- | --- | --- |
| Merge readiness | Pending final pre-merge review after validation | Phase 2-J is committed. The Admin Control Plane UI phase adds a frontend-only operator surface in the existing admin area for implemented security, organization/RBAC, billing, billing events, AI usage attempts, data lifecycle, operations, readiness, and settings capabilities. It reuses existing sanitized admin APIs and adds no backend route, migration, dependency, or live billing activation. Validation is recorded in `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`. | Production deploy still requires migrations through `0038`, Stripe Testmode secrets/URLs/webhook endpoint, live Cloudflare verification, and staging verification for org, billing, AI usage, lifecycle, billing-event, and control-plane UI flows. | Run focused Staff frontend/security/privacy/SRE review of the Admin Control Plane diff, then commit the complete UI/test/report set together if approved. |
| Production deploy readiness | Blocked | Repo config declares required auth/AI secrets, optional synthetic `BILLING_WEBHOOK_TEST_SECRET`, optional Stripe Testmode config, `SERVICE_AUTH_REPLAY`, auth migrations through `0038`, AI/video queues, `USER_IMAGES`, `AUDIT_ARCHIVE`, and `AI_LAB`. `ALLOW_SYNC_VIDEO_DEBUG` must remain absent/false unless a controlled emergency debug rollback is approved. | Live Cloudflare secrets/bindings/queues/R2/D1 migrations and Stripe Testmode endpoint/secrets were not verified by this implementation pass. Missing migration `0038` breaks Stripe checkout session tracking; missing migration `0037` breaks billing event ingestion; missing migration `0036` breaks Phase 2-D org-scoped image retry/reservation behavior and Phase 2-H text replay/attempt behavior; missing migration `0035` breaks billing APIs. Organization and billing tables do not mean full tenant isolation or production billing readiness. | Provision/verify all Phase 0/1/2 secrets/resources, apply migrations `0028`-`0038`, verify organization, billing/entitlement/credit grant, image/text usage, usage cleanup, replay cleanup, synthetic billing webhook, and Stripe Testmode checkout/webhook flows in staging, keep `ALLOW_SYNC_VIDEO_DEBUG` disabled, and run staging verification before production. |
| Phase 0-A through 2-J security/operations posture | Reduced immediate risk | HMAC service auth, nonce replay protection, fail-closed limiters, body-size limits, durable MFA failed-attempt state, config validation, async admin video jobs, route-policy checks, operational readiness docs/checks, signed activity cursors, indexed/redacted activity search, data lifecycle foundations, organization/RBAC foundation, billing/entitlement/credit-ledger foundation, org-scoped image/text credit enforcement with usage attempts/replay/cleanup, provider-neutral billing event ingestion, Stripe Testmode checkout foundation, and a frontend-only Admin Control Plane surface are present. | This is not full SaaS maturity. Legacy `SESSION_SECRET` fallback remains during migration, route policy is metadata/checking rather than full centralized enforcement, live checks skip by default in CI, Cloudflare dashboard controls/alerts are not editable from the admin UI, restore drills are not executed, user self-service privacy flow and irreversible deletion execution remain deferred, existing assets remain user-owned, no live payments/subscriptions/invoices/customer portal exist, video AI is not credit-enforced, and compliance/load-testing work remains open. | Complete Cloudflare staging verification, live health/header checks with `--require-live`, staging restore drill, alert/drift automation, Phase 2-A through 2-J and Admin Control Plane staging verification, self-service privacy policy, provider hardening, tenant migration plan, and broader SaaS platform gaps. |

Phase 2-J is implemented as a Stripe Testmode credit-pack checkout foundation. Future changes must keep checkout creation, Stripe raw-body signature verification, billing event storage, exactly-once credit grant behavior, tests, route policy metadata, release compatibility, and documentation files together to avoid stale validation or route-policy drift.

## Status Legend

| Status | Meaning |
| --- | --- |
| Resolved | The original action is implemented in code/config/tests for the reviewed scope. Residual operational work may still be listed if deployment is not complete. |
| Resolved for current scope | Implemented for the currently defined hardening scope; broader SaaS maturity may still require later work. |
| Reduced | Immediate risk is materially lower, but the original finding is not fully closed. |
| Partially addressed | Some deliverables are complete, but important required pieces remain. |
| Still open | The finding remains substantially unimplemented. |
| Deferred to Phase 0-B | Not completed in Phase 0-A/0-A+ and should be handled in the next hardening phase. |
| Deferred to Phase 1 | Important SaaS maturity work, but not an immediate Phase 0 hardening blocker. |
| Deferred to Phase 2 | Explicitly left for the Phase 2 SaaS platform roadmap. |
| Deferred to later | Important, but not the next immediate platform phase. |

## Top 20 Fixes With Current Status

| Priority | Fix | Status | Evidence from current files/tests | Remaining risk | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix failing static smoke tests | Resolved | `index.html`, `js/shared/wallet/wallet-controller.js`, and `js/shared/wallet/wallet-ui.js` are modified. `PHASE0_REMEDIATION_REPORT.md` records final `npm run test:static` as PASS, 155/155, after the three original smoke failures were fixed. | One earlier favorites-related static full-suite flake was noted but did not reproduce in final static/preflight runs. | Keep `npm run test:static` and `npm run release:preflight` blocking before merge/deploy; monitor for flake recurrence. |
| 2 | Add admin MFA rate limiting and lockout | Resolved for current scope | `workers/auth/src/routes/admin-mfa.js` applies fail-closed operation throttles. `workers/auth/migrations/0028_add_admin_mfa_failed_attempts.sql` and `workers/auth/src/lib/admin-mfa.js` add durable failed-attempt count, lockout expiration, and reset-on-success behavior. `tests/workers.spec.js` covers repeated invalid attempts, lockout, valid/recovery rejection during lockout, success reset, and missing backend fail-closed behavior. | This is still TOTP/recovery-code MFA, not WebAuthn/passkey step-up. Thresholds may need tuning after real abuse data. | Apply migration `0028` before auth deploy; consider WebAuthn/passkeys and admin step-up policy later. |
| 3 | Make sensitive route rate limits fail closed | Resolved for current scope | Phase 0-A+ converted priority routes. Phase 0-B added `workers/auth/src/lib/sensitive-write-limit.js` and converted profile update, favorites delete, avatar delete, wallet unlink, AI folder/bulk/publication/text/audio/image writes, and contact submit fail-closed behavior. Phase 1-E adds `workers/auth/src/app/route-policy.js` and `scripts/check-route-policies.mjs`, which record limiter policy IDs/fail-closed expectations for high-risk auth-worker routes and block unregistered mutating dispatch branches. Phase 2-A registers org routes and applies fail-closed limiters to org creation, member add, and admin org inspection. Phase 2-B registers org/admin billing routes and applies fail-closed limiters to admin billing reads and credit grants. | Abuse controls remain route-specific metadata/checks, not a centralized plan/tenant/quota platform. Some expensive reads and dashboard/WAF controls remain outside app-layer throttling. | Keep route-policy checks blocking; extend to tenant/plan-aware limits as AI routes are wired to entitlements and credits. |
| 4 | Add signed service authentication between auth and AI workers | Resolved | `js/shared/service-auth.mjs` implements HMAC-SHA256 signing/verification over method, path, timestamp, nonce, and body hash. `workers/auth/src/lib/admin-ai-proxy.js` signs Auth-to-AI calls. `workers/ai/src/index.js` verifies every `/internal/ai/*` request before dispatch. `tests/workers.spec.js` covers valid, missing, invalid, expired, replayed, and tampered requests. | Live secret parity is still a deploy prerequisite. The value must exist and match exactly in both `workers/auth` and `workers/ai`; otherwise internal AI access fails closed. | Before production: provision matching `AI_SERVICE_AUTH_SECRET` in both Worker environments and verify in staging without printing the value. |
| 5 | Add `workers/ai/package-lock.json` and worker package CI install/audit | Resolved | `workers/ai/package-lock.json` exists. `.github/workflows/static.yml` now runs `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` for `workers/auth`, `workers/contact`, and `workers/ai`. `PHASE0_REMEDIATION_REPORT.md` records root and worker installs/audits as PASS. | CI still depends on npm registry availability and does not yet include dependency review/SBOM/license gates. | Keep worker package checks blocking; add broader CI security gates under item 10. |
| 6 | Add fail-closed Worker config validation | Resolved for current critical paths | `workers/auth/src/lib/config.js` validates auth critical config including `SESSION_HASH_SECRET`, `PAGINATION_SIGNING_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, `ADMIN_MFA_RECOVERY_HASH_SECRET`, `AI_SAVE_REFERENCE_SIGNING_SECRET`, legacy `SESSION_SECRET` while fallback is enabled, `DB`, and `AI_SERVICE_AUTH_SECRET` where needed. `workers/ai/src/lib/config.js` validates `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY`. `scripts/validate-cloudflare-deploy-prereqs.mjs` validates repo config for critical secrets/bindings and marks production blocked when live validation is skipped. Release compatibility now tracks migrations through `0038`. | Live Cloudflare config was not verified. Static headers, WAF, RUM, and some dashboard-managed resources are still not fully repo-enforced. Legacy fallback remains until operators disable it. | Provision all Phase 1-D and Phase 2-J Stripe Testmode secrets/config, apply migrations through `0038`, run `npm run validate:cloudflare-prereqs -- --live` in staging where credentials are available, then add IaC/live drift checks later. |
| 7 | Replace synchronous AI video polling with async jobs | Resolved for default admin path | Phase 1-B makes the admin UI default to `/api/admin/ai/video-jobs`, requires `Idempotency-Key`, moves queue processing to `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`, ingests completed video/poster output into `USER_IMAGES`, and returns protected output routes. Phase 1-C makes `/api/admin/ai/test-video` default-disabled unless `ALLOW_SYNC_VIDEO_DEBUG=true`. `tests/workers.spec.js` and `tests/auth-admin.spec.js` cover default async UI, no default sync route call, debug route gating, duplicate queue messages, R2 ingest, and protected status/output behavior. | The legacy sync route still exists behind an explicit debug flag for emergency rollback. Full provider-specific production behavior still needs staging validation. | Keep `ALLOW_SYNC_VIDEO_DEBUG` disabled in production; retire the compatibility route after a confidence window. |
| 8 | Add request body size limited parsers | Resolved for prioritized routes | `js/shared/request-body.mjs` adds content-length and streaming limits. `workers/auth/src/lib/request.js`, `workers/contact/src/index.js`, and `workers/ai/src/lib/validate.js` use limited parsers. Prioritized auth/admin/MFA/profile/favorites/avatar/wallet/AI/contact/internal AI routes now enforce route-specific caps. `tests/workers.spec.js` covers oversized header, oversized stream, malformed JSON, wrong content type, avatar multipart, AI save, and contact body failures. `npm run check:worker-body-parsers` remains in preflight. | This is byte-limit hardening, not full schema validation or a complete SaaS abuse/cost platform. Large save routes intentionally still allow MB-scale payloads. | Keep body limits under test; add org/plan-aware cost policy after tenant/billing foundations. |
| 9 | Move Cloudflare dashboard controls into IaC or drift checks | Partially addressed | `scripts/validate-cloudflare-deploy-prereqs.mjs` validates repo declarations for required secrets including the Phase 1-D purpose-specific auth secrets, `SERVICE_AUTH_REPLAY`, migration `v1-service-auth-replay`, and critical auth bindings. Phase 1-F adds skipped-by-default live health/header checks in `scripts/check-live-health.mjs` and `scripts/check-live-security-headers.mjs`, plus operational docs/runbooks. `.github/workflows/static.yml` runs the repo-side prereq and operational checks. | Live resource verification is optional and was not run locally. WAF/static headers/RUM and alert rules remain dashboard-managed and not repo-enforced. | Before deploy, run live/staging verification with `--require-live`; later move dashboard controls and alerts to IaC or add Cloudflare API drift checks. |
| 10 | Add CI security gates | Partially addressed | `.github/workflows/static.yml` includes root/worker installs/audits, Cloudflare prereq tests/validation, body-parser guard, route-policy guard, toolchain check, scanner tests, secret scan, DOM sink baseline, and targeted JS syntax check. `scripts/lib/release-plan.mjs` includes the stable gates in `release:preflight`. | CodeQL/SAST, dependency review, SBOM, license checks, and provider-side secret scanning are still missing as repo-defined blocking gates. Route policy is currently metadata/coverage checking, not full centralized enforcement. | Add CodeQL/Semgrep, dependency review, SBOM, and license policy once the lightweight gates remain stable. |
| 11 | Add lint/typecheck/checkJs and safe DOM rules | Reduced | Phase 1-C adds `.nvmrc`, `package.json` engines, `scripts/check-js.mjs`, `scripts/check-dom-sinks.mjs`, `config/dom-sink-baseline.json`, `scripts/check-secrets.mjs`, `scripts/check-toolchain.mjs`, and `scripts/test-quality-gates.mjs`. Phase 1-E adds syntax coverage for the route-policy script/module and a dedicated route-policy guard. Preflight/CI now run stable gates. | This is not a full TypeScript/checkJs or semantic lint migration. The DOM gate is a count baseline, so legacy sinks still require incremental remediation. | Add ESLint/Biome or TypeScript `checkJs` in report mode, then enforce on selected directories and changed files. |
| 12 | Split the largest admin/frontend modules | Still open | Phase 0/1 intentionally avoided broad frontend/module refactors. The large admin, wallet, frontend, and test modules remain outside the hardening scope. | Large modules remain difficult to review and regression-test surgically. | Defer until after the current Phase 2 backend foundations unless a scoped route/API change requires local extraction. |
| 13 | Add signed cursors and scalable indexes to activity endpoints | Resolved for current admin/activity endpoints | `workers/auth/migrations/0031_add_activity_search_index.sql` adds the `activity_search_index` projection and indexes. `workers/auth/src/lib/activity-search.js` normalizes searchable fields and sanitizes returned metadata. `workers/auth/src/routes/admin.js` now uses signed `PAGINATION_SIGNING_SECRET` cursors and projection-backed prefix search for `/api/admin/activity` and `/api/admin/user-activity`. `scripts/check-admin-activity-query-shape.mjs` blocks raw `meta_json` search, raw cursor, and unbounded admin count regressions. `tests/workers.spec.js` covers signed cursors, tampering, expired cursor rejection, search/filter binding, redaction, projection writes, and bounded counts. | Historical rows are not automatically backfilled; search is now safe prefix/exact-field search rather than arbitrary metadata substring search; counts are hot-window bounded rather than all-history analytics; no large production-cardinality load test has run. | Apply migration `0031` in staging, verify new projection rows/search, then decide whether historical backfill is needed. |
| 14 | Add queue message schemas and DLQ behavior | Reduced | Phase 1-B adds `ai_video_job_poison_messages` in migration `0030`, records malformed video queue payloads with redacted body summaries, and records exhausted attempts. Phase 1-C adds admin-only APIs for sanitized poison-message and failed-job inspection. `tests/workers.spec.js` covers persistence, listing, detail views, sanitization, non-admin rejection, and fail-closed limiter behavior. | This is still video-job-specific; activity ingest and derivative queues do not share a uniform schema/DLQ abstraction, and the new inspection tooling is API-only rather than a full admin UI. | Add a small admin/support UI if needed, then standardize queue schema/DLQ patterns across remaining queues. |
| 15 | Introduce organization/team/tenant schema | Partially addressed | Phase 2-A adds migration `0034_add_organizations.sql`, `workers/auth/src/lib/orgs.js`, `workers/auth/src/routes/orgs.js`, `workers/auth/src/routes/admin-orgs.js`, route-policy entries, release compatibility updates, and Worker tests for org creation/list/detail, member add/list, role enforcement, cross-org denial, admin inspection, CSRF, body-size limits, idempotency, limiter `429`, and limiter fail-closed `503`. Phase 2-B builds on organization ids for billing state without migrating existing assets. | This is an additive foundation, not full tenant isolation. Existing profiles/media/AI/activity/lifecycle records remain user-owned; invitations, membership removal/update flows, tenant-aware asset migration, tenant-scoped audit/lifecycle exports, and full tenant-aware billing usage enforcement remain open. | Stage and verify migration `0034`, then plan domain-by-domain tenant ownership migration after Phase 2-B billing foundation validation. |
| 16 | Add billing, plans, entitlements, and quota enforcement | Reduced | Phase 2-B adds migration `0035_add_billing_entitlements.sql`, seeded free plan/entitlements, `workers/auth/src/lib/billing.js`, user org entitlement/billing/usage reads, admin plan/org billing inspection, admin manual credit grants, route-policy/release updates, and Worker tests for membership checks, admin credit grants, idempotent credit grants/consumption, insufficient-credit denial, no negative balances, CSRF, body-size, limiter `429`, and limiter fail-closed `503`. Phase 2-C wires `/api/ai/generate-image` to opt-in org-scoped entitlement and credit checks. Phase 2-D adds migration `0036_add_ai_usage_attempts.sql` and `workers/auth/src/lib/ai-usage-attempts.js` so org-scoped image requests reserve credits, suppress duplicate provider execution, replay temporary successful results, release reservations on provider failure, and fail safely on billing finalization failure. Phase 2-E/F add cleanup/admin inspection and temporary replay object cleanup. Phase 2-H adds org-scoped backend-only `/api/ai/generate-text` with `ai.text.generate` entitlement, credit reservation/finalization, same-key text replay, provider-failure no-charge behavior, and no admin/text-asset charging. Phase 2-I adds migration `0037_add_billing_event_ingestion.sql`, synthetic raw-body billing webhook verification, idempotent billing event storage, duplicate/mismatch handling, dry-run action planning, and sanitized admin billing event inspection. Phase 2-J adds migration `0038_add_stripe_credit_pack_checkout.sql`, Stripe Testmode credit-pack checkout creation for org owners/admins, Stripe raw-body signature verification, and exactly-once Testmode checkout credit grants. | This is still not full SaaS billing. No live payments, subscriptions, invoices, customer portal, taxes, production-trusted live webhooks, automatic subscription updates, monthly grant scheduler, production billing activation, broad AI route credit enforcement, video credit enforcement, or full tenant-owned asset model exists. Existing assets are not fully tenant-owned. | Stage and verify migrations `0035` through `0038`; verify org-scoped image/text charge and retry behavior, synthetic billing webhook verification, Stripe Testmode checkout creation, Stripe webhook signature verification, duplicate/mismatch handling, and exactly-once credit grant behavior in staging; then choose live-provider hardening, subscription design, or video route credit enforcement. |
| 17 | Add data export/deletion and retention jobs | Partially addressed | `DATA_INVENTORY.md` inventories D1/R2/contact data classes and now includes Phase 2-B billing tables. `docs/DATA_RETENTION_POLICY.md` records an engineering retention baseline including billing/ledger/usage retention placeholders. `workers/auth/migrations/0032_add_data_lifecycle_requests.sql` adds lifecycle request/item/archive tables. `workers/auth/migrations/0033_harden_data_export_archives.sql` adds archive status/manifest/download/error metadata and expiration indexes. `workers/auth/src/lib/data-lifecycle.js`, `workers/auth/src/lib/data-export-archive.js`, `workers/auth/src/lib/data-export-cleanup.js`, and `workers/auth/src/routes/admin-data-lifecycle.js` add admin lifecycle planning, bounded export archive generation, bounded expired-archive cleanup, admin archive visibility, and a safe reversible-action executor pilot. `docs/DATA_DELETION_EXECUTOR_DESIGN.md` documents irreversible-action gates. `tests/workers.spec.js` covers lifecycle idempotency, redaction, subject scoping, dry-run deletion planning, only-active-admin block, admin/CSRF/rate-limit enforcement, export archive generation, secret exclusion, cross-user isolation, expiration, cleanup prefix scope, scheduled cleanup isolation, safe executor dry-run/execute behavior, and R2 failure behavior. `npm run check:data-lifecycle` verifies migration/policy/archive/destructive-operation guardrails. | This is not full compliance. User self-service export/delete, irreversible deletion/anonymization execution, contact-processor workflow, legal retention approval, live cleanup verification, historical R2 owner-map/backfill, and billing lifecycle export/delete policy remain open. | Verify Phase 1-J cleanup and safe executor in staging; define billing lifecycle policy before live payment-provider data; keep destructive deletion disabled until legal/product approval and owner-map dry runs. |
| 18 | Add observability, SLOs, and alert definitions | Reduced | Phase 1-B expands async video lifecycle events for provider task creation, polling, ingest success/failure, retry scheduling, poison recording, and duplicate/no-op behavior. Phase 1-C adds safe sync-debug warning events and admin inspection APIs for poison/failed video jobs. Phase 1-F adds `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md`, `docs/BACKUP_RESTORE_DRILL.md`, required incident runbooks under `docs/runbooks/`, public-safe AI/contact health endpoints, and operational readiness checks. | Cloudflare dashboards, alert rules, burn-rate alerts, restore-drill evidence, and load baselines are still not repo-enforced or live-proven. | Configure/verify Cloudflare alerts from the SLO baseline, execute a staging restore drill, and add dashboard/IaC drift checks. |
| 19 | Add load/performance and frontend budget tests | Still open | No k6/Artillery/Lighthouse/WebPageTest budgets were added. Phase 1-G added query-shape checks, but not runtime load budgets. | Capacity limits and frontend performance regressions remain unmeasured. | Add API load tests and frontend budgets after tenant ownership and billing enforcement paths are defined. |
| 20 | Pin runtime/toolchain versions consistently | Resolved for current scope | Phase 1-C adds `.nvmrc` with Node 20, `package.json`/`package-lock.json` engines for Node 20/npm 10+, and `scripts/check-toolchain.mjs`. `.github/workflows/static.yml` continues to use Node 20 and now runs the toolchain check. | This does not pin every transitive tool binary outside npm, and local developers can still ignore engines unless they opt into enforcement. | Keep `check:toolchain` blocking; consider Volta/asdf or stricter engine enforcement only after team agreement. |

## Immediate Pre-Deploy / Admin Control Plane Backlog

These are the highest-priority follow-ups after the Phase 2-J implementation and Admin Control Plane UI phase. They are deployment/staging prerequisites plus the next roadmap entrypoint; they are not reasons to redo Phase 0, Phase 1, Phase 2-A, Phase 2-B, Phase 2-C, Phase 2-D, Phase 2-E, Phase 2-F, Phase 2-G, Phase 2-H, Phase 2-I, Phase 2-J, or Admin Control Plane work.

1. Keep validation green; re-run `npm run release:preflight` after any further application/config/test changes.
2. Commit the Admin Control Plane UI, test, and documentation updates together after review.
3. Provision and verify the six new `workers/auth` purpose-specific secrets without printing values.
4. Keep legacy `SESSION_SECRET` present while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` remains enabled.
5. Provision and verify matching `AI_SERVICE_AUTH_SECRET` in both `workers/auth` and `workers/ai`.
6. Deploy and verify the `SERVICE_AUTH_REPLAY` Durable Object binding and `v1-service-auth-replay` migration in staging.
7. Apply auth migrations `0028` through `0038` before deploying auth Worker code that depends on them.
8. Run `npm run validate:cloudflare-prereqs -- --live` or equivalent staging verification without printing secret values.
9. Verify dashboard-managed WAF/static security headers/RUM controls manually or move them to IaC.
10. Verify async video create/status/queue/R2 output processing plus poison/failed-job inspection in staging.
11. Keep `ALLOW_SYNC_VIDEO_DEBUG` absent/false in production except during controlled emergency debugging.
12. Provision `VIDU_API_KEY` in `workers/ai` if Vidu Q3 Pro async jobs are enabled.
13. Define the date and criteria for disabling `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK`.
14. Keep `npm run check:route-policies` blocking and extend route policy coverage after one stable release.
15. Run `npm run check:live-health -- --require-live` with staging/production Worker URLs.
16. Run `npm run check:live-security-headers -- --require-live` with the staging/production static URL.
17. Configure Cloudflare alerts from `docs/SLO_ALERT_BASELINE.md` or document dashboard evidence.
18. Verify Phase 1-G activity projection writes, signed cursor pagination, and indexed prefix search in staging.
19. Verify Phase 1-H/1-I/1-J lifecycle create/list/detail/plan/approve/generate-export/download/list-archives/cleanup-expired/execute-safe APIs in staging and confirm no destructive execution occurs.
20. Verify Phase 2-A organization create/list/detail/member-add/admin-inspection APIs in staging after migration `0034`.
21. Verify Phase 2-B org entitlement read, org billing/usage reads, admin plan listing, admin org billing inspection, admin credit grant idempotency, and helper-level credit consumption behavior in staging after migration `0035`.
22. Verify Phase 2-D org-scoped `/api/ai/generate-image` success charge, insufficient-credit denial, idempotency conflict, pending duplicate suppression, same-key replay, provider-failure retry/no-charge behavior, billing-failure terminal behavior, active reservation accounting, and legacy no-org compatibility in staging after migration `0036`.
23. Verify Phase 2-E usage-attempt list/detail sanitization, cleanup dry-run, cleanup execution, scheduled cleanup, no completed-attempt corruption, no debit creation during cleanup, and stale reservation release behavior in staging after migration `0036`.
24. Verify Phase 2-F replay object cleanup dry-run/execution, scheduled cleanup, prefix allowlist safety, R2 delete failure handling, no unrelated object deletion, no ledger/usage deletion, no debit creation during cleanup, and legacy no-org AI generation compatibility in staging after migration `0036`.
25. Verify Phase 2-H org-scoped `/api/ai/generate-text` success, same-key replay, entitlement denial, insufficient-credit denial, viewer/non-member denial, no duplicate provider execution, no duplicate debit, provider-failure no-charge behavior, billing-failure safety, and admin AI/text-asset compatibility in staging after migration `0036`.
26. Verify Phase 2-I synthetic billing webhook missing/invalid/stale signature failures, valid event ingestion, duplicate delivery handling, payload mismatch handling, live-mode rejection, sanitized admin inspection, and no real credit/subscription side effects in staging after migration `0037`.
27. Verify Phase 2-J Stripe Testmode checkout creation, missing/live Stripe config failure modes, raw-body Stripe signature verification, valid Testmode `checkout.session.completed`, duplicate delivery no-double-grant behavior, payload mismatch conflict, failed/unpaid no-credit behavior, sanitized admin inspection, and no live billing side effects in staging after migration `0038`.
28. Verify the Admin Control Plane in staging with real admin APIs, including unavailable-state handling, sanitized billing event detail, AI usage cleanup dry-run/execute controls, lifecycle read-only metadata, and existing Users/Activity/AI Lab regressions.
29. Decide whether historical audit/activity records need a controlled projection backfill and whether user-facing self-service privacy flows are required before production launch.
30. Execute and record a staging D1/R2 restore drill.
31. Choose the next Phase 2 track: Stripe live-readiness hardening, video AI entitlement wiring, or domain-by-domain tenant ownership migration. Do not combine all tracks into one large rewrite.

## Next Phase: Stripe Hardening, Video AI Route, Or Tenant Migration Track

Phase 2-J has implemented Stripe Testmode credit-pack checkout and verified Testmode webhook credit grants without enabling live payment side effects. The next phase should be chosen deliberately:

- Option A: harden Stripe Testmode/staging operations toward a later live-readiness review while keeping live payments disabled until explicit approval.
- Option B: wire the existing async/member-safe video route family to organization entitlements and credits while preserving admin/debug boundaries.
- Option C: continue tenant migration by adding nullable `organization_id` to one low-risk domain and proving dual-read/backfill behavior.

Do not redo completed Phase 0, Phase 1, Phase 2-A, Phase 2-B, Phase 2-C, Phase 2-D, Phase 2-E, Phase 2-F, Phase 2-G, Phase 2-H, Phase 2-I, Phase 2-J, or Admin Control Plane work. Treat the following as baseline capabilities unless a focused regression is found:

- Service-to-service HMAC, nonce replay protection, fail-closed sensitive limits, request body limits, admin MFA failed-attempt state, and purpose-specific auth secrets.
- Async admin video jobs with R2 output handling, poison persistence, sync debug gating, and admin operational inspection.
- Route policy registry/checks, quality gates, operational checks/runbooks, signed activity cursors, indexed activity search, and data lifecycle planning/export/archive cleanup foundations.
- Phase 2-A organizations, memberships, basic roles, minimal user/admin org APIs, and additive migration `0034`.
- Phase 2-B plans, entitlements, organization billing summaries, admin credit grants, credit ledger/usage helpers, and additive migration `0035`.
- Phase 2-C opt-in org-scoped AI image usage enforcement on `/api/ai/generate-image` with legacy no-org compatibility.
- Phase 2-D org-scoped image usage attempts/reservations, no-duplicate-provider retry behavior, temporary result replay, billing-failure terminal state, and additive migration `0036`.
- Phase 2-E bounded usage-attempt cleanup, stale reservation release, replay metadata expiry, scheduled cleanup integration, and sanitized admin usage-attempt inspection.
- Phase 2-F bounded temporary replay object cleanup with strict prefix/user/attempt linkage and no ledger/usage/saved-media deletion.
- Phase 2-H backend-only org-scoped `/api/ai/generate-text` with text entitlement/credit enforcement, attempt reservation/finalization, same-key text replay, and admin/text-asset route compatibility.
- Phase 2-I provider-neutral billing event ingestion with synthetic raw-body verification, idempotent event storage, duplicate/mismatch handling, dry-run action planning, and sanitized admin inspection.
- Phase 2-J Stripe Testmode credit-pack checkout, Stripe raw-body signature verification, verified Testmode checkout credit grants, duplicate no-double-grant behavior, live-mode rejection, and additive migration `0038`.
- Admin Control Plane frontend surfaces for implemented admin APIs, with no backend rewrite, no secret editing, no live billing controls, and safe unavailable states.

Read these documents before the next Phase 2 pass:

- `PHASE2A_ORG_RBAC_REPORT.md`
- `PHASE2B_BILLING_ENTITLEMENTS_REPORT.md`
- `PHASE2C_AI_USAGE_ENTITLEMENTS_REPORT.md`
- `PHASE2D_AI_USAGE_RESERVATION_REPORT.md`
- `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md`
- `PHASE2F_AI_REPLAY_OBJECT_RETENTION_REPORT.md`
- `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md`
- `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md`
- `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`
- `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`
- `AUDIT_NEXT_LEVEL.md`
- `AUDIT_ACTION_PLAN.md`
- `PHASE1_COMPLETION_HANDOFF.md`
- `PHASE2A_ENTRYPOINT.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`

Next Phase 2 prerequisites:

- `git status --short` is clean.
- Admin Control Plane changes are committed together after full validation and review.
- `npm run release:preflight` passes on the starting commit.
- Latest auth migration number is documented as `0038`.
- Production deploy is not assumed; live Cloudflare secret/binding/migration verification remains a separate deployment task.

## Production Deploy Blockers

Do not deploy Phase 0-A/0-A+/0-B/1-A/1-B/1-C/1-D/1-E/1-F/1-G/1-H/1-I/1-J/2-A/2-B/2-C/2-D/2-E/2-F/2-H/2-I/2-J/Admin Control Plane changes to production until all of these are complete:

- `SESSION_HASH_SECRET` exists in `workers/auth`.
- `PAGINATION_SIGNING_SECRET` exists in `workers/auth`.
- `ADMIN_MFA_ENCRYPTION_KEY` exists in `workers/auth`.
- `ADMIN_MFA_PROOF_SECRET` exists in `workers/auth`.
- `ADMIN_MFA_RECOVERY_HASH_SECRET` exists in `workers/auth`.
- `AI_SAVE_REFERENCE_SIGNING_SECRET` exists in `workers/auth`.
- `SESSION_SECRET` remains present while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` is enabled.
- `AI_SERVICE_AUTH_SECRET` exists in `workers/auth`.
- `AI_SERVICE_AUTH_SECRET` exists in `workers/ai`.
- The two `AI_SERVICE_AUTH_SECRET` values match exactly.
- Secret values are never printed in logs, CI, docs, terminal output, diagnostics, or error messages.
- `SERVICE_AUTH_REPLAY` exists as a `workers/ai` Durable Object binding.
- The `v1-service-auth-replay` Durable Object migration is deployed.
- Auth D1 migration `0028_add_admin_mfa_failed_attempts.sql` is applied before the auth Worker deploy.
- Auth D1 migration `0029_add_ai_video_jobs.sql` is applied before deploying async video job APIs/consumer code.
- Auth D1 migration `0030_harden_ai_video_jobs_phase1b.sql` is applied before deploying Phase 1-B queue-safe polling, R2 output, and poison-message code.
- Auth D1 migration `0031_add_activity_search_index.sql` is applied before deploying Phase 1-G activity projection writes and indexed activity search.
- Auth D1 migration `0032_add_data_lifecycle_requests.sql` is applied before deploying Phase 1-H data lifecycle request planning APIs.
- Auth D1 migration `0033_harden_data_export_archives.sql` is applied before deploying Phase 1-I export archive generation/download APIs.
- Auth D1 migration `0034_add_organizations.sql` is applied before deploying Phase 2-A organization and membership APIs.
- Auth D1 migration `0035_add_billing_entitlements.sql` is applied before deploying Phase 2-B billing, entitlement, credit ledger, usage, and admin credit-grant APIs.
- Auth D1 migration `0036_add_ai_usage_attempts.sql` is applied before deploying Phase 2-D org-scoped image usage retry/reservation behavior, Phase 2-E usage-attempt cleanup/admin inspection, Phase 2-F replay object cleanup, and Phase 2-H org-scoped text replay/attempt behavior.
- Auth D1 migration `0037_add_billing_event_ingestion.sql` is applied before deploying Phase 2-I billing event ingestion routes.
- Auth D1 migration `0038_add_stripe_credit_pack_checkout.sql` is applied before deploying Phase 2-J Stripe Testmode checkout/session tracking and webhook credit grants.
- Cloudflare Queue `bitbi-ai-video-jobs` exists and is bound to `workers/auth` as `AI_VIDEO_JOBS_QUEUE`.
- `USER_IMAGES` R2 binding is present and can store async video output/poster objects.
- `AUDIT_ARCHIVE` R2 binding is present and can store private lifecycle export archive JSON under `data-exports/`.
- `VIDU_API_KEY` exists in `workers/ai` if Vidu Q3 Pro async jobs are enabled.
- `ALLOW_SYNC_VIDEO_DEBUG` remains absent/false unless an explicit temporary admin/debug rollback is approved.
- The auth Worker queue consumer for `bitbi-ai-video-jobs` is configured and verified in staging.
- Staging verifies valid Auth-to-AI calls, replay rejection, missing secret failure, missing replay backend failure, and no unsigned internal AI access.
- Staging verifies async admin video job create/status/queue processing before exposing it beyond controlled admin use.
- Staging verifies admin MFA failed-attempt lockout and reset-on-success behavior.
- Staging verifies new session creation, legacy session fallback/upgrade, admin MFA legacy decrypt/proof/recovery fallback, pagination cursor compatibility, and generated-image save-reference compatibility.
- Staging verifies new admin audit/user activity events create `activity_search_index` rows and that `/api/admin/activity` plus `/api/admin/user-activity` signed cursor pagination and indexed prefix search work.
- Staging verifies admin data lifecycle request create/list/detail/plan/approve APIs, export planning redaction, dry-run deletion/anonymization planning, and only-active-admin block behavior.
- Staging verifies admin export archive generation/download, archive list/cleanup, safe executor dry-run/execute-safe behavior, archive expiration behavior, absence of internal R2 key leakage in metadata/responses, secret exclusion in archive JSON, and non-admin denial.
- Staging verifies organization create/list/detail/member-add/member-list/admin-inspection APIs, CSRF denial, idempotency, role enforcement, and fail-closed limiter behavior after migration `0034`.
- Staging verifies organization entitlement read, organization billing/usage reads, admin plan list, admin organization billing inspection, admin credit grant idempotency, insufficient-credit denial, and credit consumption helper behavior after migration `0035`.
- Staging verifies org-scoped `/api/ai/generate-image` success charge, insufficient-credit denial, viewer/non-member denial, idempotency conflict, pending duplicate suppression, same-key replay, provider-failure retry/no-charge behavior, billing-failure terminal behavior, active reservation accounting, and legacy no-org compatibility after migration `0036`.
- Staging verifies admin usage-attempt list/detail sanitization, cleanup dry-run, cleanup execution, scheduled cleanup, no completed-attempt corruption, no debit creation during cleanup, replay metadata expiry, and stale reservation release after migration `0036`.
- Staging verifies replay object cleanup dry-run/execution, scheduled cleanup, prefix allowlist safety, R2 delete failure handling, no unrelated object deletion, no ledger/usage deletion, no debit creation during cleanup, and legacy no-org compatibility after migration `0036`.
- Staging verifies org-scoped `POST /api/ai/generate-text` success, same-key text replay, entitlement denial, insufficient-credit denial, viewer/non-member denial, no duplicate provider execution, no duplicate debit, provider-failure no-charge behavior, billing-failure safety, and admin AI/text-asset compatibility after migration `0036`.
- Staging verifies synthetic billing webhook missing/invalid/stale signature failures, valid event ingestion, duplicate delivery handling, payload mismatch handling, live-mode rejection, sanitized admin inspection, and no real credit/subscription side effects after migration `0037`.
- Staging verifies Stripe Testmode checkout creation, Stripe Testmode config failure modes, raw-body Stripe signature verification, valid Testmode checkout completion, duplicate event no-double-grant behavior, payload mismatch conflict, failed/unpaid checkout no-credit behavior, sanitized admin inspection, and no live billing side effects after migration `0038`.
- Staging verifies `GET /api/health`, AI `GET /health`, and contact `GET /health` through `npm run check:live-health -- --require-live` with explicit URLs.
- Staging verifies live static security headers through `npm run check:live-security-headers -- --require-live` or records manual dashboard evidence for dashboard-managed headers.
- `npm run release:preflight` passes for the final commit set.

## Validation Evidence Snapshot

The latest Phase 2-J validation evidence is recorded in `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md`.

| Command/check | Result | What it proves |
| --- | --- | --- |
| `npm run check:toolchain` | PASS | Toolchain files are pinned consistently to Node 20/npm 10+ expectations. |
| `npm run test:quality-gates` | PASS | Secret, DOM sink, and toolchain scanner tests pass. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns found. |
| `npm run check:dom-sinks` | PASS | No new unreviewed DOM sinks above baseline. |
| `npm run check:route-policies` | PASS | Route-policy metadata covers Phase 2-J `POST /api/orgs/:id/billing/checkout/credit-pack` and `POST /api/billing/webhooks/stripe` plus prior protected routes; 121 registered policies validated. |
| `npm run check:admin-activity-query-shape` | PASS | Raw activity `meta_json` search, raw activity cursors, and unbounded admin action counts are blocked from the request path. |
| `npm run check:data-lifecycle` | PASS | Lifecycle migration, route policies, forbidden secret selects, and no destructive delete guardrails pass. |
| `npm run test:operational-readiness` | PASS | New operational readiness helper tests pass. |
| `npm run check:operational-readiness` | PASS | Required operational docs and runbooks exist. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured in normal CI; skipped mode is explicit and non-flaky. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No live URL configured in normal CI; skipped mode is explicit and non-flaky. |
| `npm run check:js` | PASS | Targeted syntax checks pass for high-risk/new JS modules and scripts, including `workers/auth/src/lib/stripe-billing.js`. |
| `npm run check:worker-body-parsers` | PASS | Worker body parser guard remains green. |
| `npm run test:workers` | PASS, 346/346 | Full Worker route/security regression suite passed after Phase 2-J changes, including Stripe Testmode checkout/webhook/credit-grant cases and existing billing/AI compatibility. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI suite remained green; Phase 2-J does not add frontend UI or intentionally change frontend behavior. |
| `npm run test:release-compat` | PASS | Release compatibility validates migration `0038`. |
| `npm run test:release-plan` | PASS | Release planner remains consistent with the auth Worker route/check surface. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq validator coverage. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production blocked | Repo config is valid, live Cloudflare validation was skipped, and production deploy is correctly not marked ready. |
| `npm run validate:release` | PASS | Release compatibility configuration validates. |
| `npm run build:static` | PASS | Static build succeeds. |
| `npm run release:preflight` | PASS | Aggregated preflight passed after Phase 2-J changes. |
| `git diff --check` | PASS | No whitespace errors remain in the final diff. |

Checks not performed in the Phase 2-J implementation pass:

- Live Cloudflare secret/binding verification.
- Live health/header checks with `--require-live`, because no staging/production URLs were configured in this local run.
- Production deploy.
- `npm run release:apply`.
- Remote D1 migrations, including migrations through `0038`.
- Root `npm ci`, root `npm ls --depth=0`, root `npm audit --audit-level=low`, and Worker package install/audit checks, because package dependencies, worker package manifests, and lockfiles were not changed and `npm run release:preflight` passed.
- Markdown lint, because no repo markdown lint script is defined.
