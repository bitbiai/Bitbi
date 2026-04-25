# AUDIT_ACTION_PLAN.md

Date: 2026-04-24

Last updated: 2026-04-25 after Phase 0-A, Phase 0-A+, Phase 0-B, Phase 1-A, and Phase 1-B async video hardening.

Scope: top 20 highest-impact fixes for `/Users/btc2020/Bitbi/Bitbi`, preserved in exact original priority order. This file is now a status-tracked action plan. Historical audit findings are not deleted; each item records current status, evidence, remaining risk, and the next action.

Source documents:

- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- `PHASE0B_REMEDIATION_REPORT.md`
- `AI_VIDEO_ASYNC_JOB_DESIGN.md`
- `PHASE1A_REMEDIATION_REPORT.md`
- `PHASE1B_REMEDIATION_REPORT.md`
- `PHASE1_OBSERVABILITY_BASELINE.md`
- Current git status and diff as of this update
- Phase 0-A/0-A+/0-B changed application, config, CI, and test files

## Current Readiness Summary

| Area | Status | Evidence | Remaining risk | Next action |
| --- | --- | --- | --- | --- |
| Merge readiness | Conditional pass after Phase 1-B validation | `npm run test:workers` PASS 283/283, `npm run test:static` PASS 155/155, `npm run test:release-compat` PASS, `npm run test:release-plan` PASS, `npm run test:cloudflare-prereqs` PASS, `npm run test:asset-version` PASS, `npm run build:static` PASS, `npm run release:preflight` PASS, and `git diff --check` PASS for the current Phase 1-B diff. | A partial commit would break async task routes, migration `0030`, R2 output routes, UI polling, or release contracts. Production deploy still requires live Cloudflare verification. | Track and commit every Phase 1-B file listed below with the related tracked modifications. |
| Production deploy readiness | Blocked | Repo config declares `AI_SERVICE_AUTH_SECRET`, `SERVICE_AUTH_REPLAY`, auth migrations through `0030`, `AI_VIDEO_JOBS_QUEUE`, and the existing `USER_IMAGES` R2 binding. Phase 1-B adds optional Vidu direct-provider secret documentation for `VIDU_API_KEY`. | Live Cloudflare secrets/bindings/queues/R2/D1 migrations were not verified by this implementation pass. Missing/mismatched secrets, missing replay DO, missing queue, missing R2 binding, or unapplied migrations will fail closed or break async jobs. | Provision/verify matching `AI_SERVICE_AUTH_SECRET`, deploy `SERVICE_AUTH_REPLAY`, apply migrations `0028`-`0030`, verify `USER_IMAGES` and `bitbi-ai-video-jobs`, provision `VIDU_API_KEY` if Vidu async jobs are enabled, and run staging verification before production. |
| Phase 0-A/0-A+/0-B/1-A/1-B security posture | Reduced immediate risk | HMAC service auth, nonce replay protection, fail-closed limiters, body-size limits, durable MFA failed-attempt state, config validation, async admin video jobs, queue-safe provider task create/poll, R2 output ingest, poison-message persistence, and regression tests are present. | This is not full SaaS maturity. The legacy synchronous video compatibility route still exists, dashboard controls are not fully repo-enforced, and tenant/billing/compliance/SLO work remains open. | Complete final validation and Cloudflare staging verification, then restrict/retire the synchronous compatibility route and continue broader SaaS platform gaps. |

Current untracked Phase 1-B files that must be included before merge:

- `PHASE1B_REMEDIATION_REPORT.md`
- `workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql`
- `workers/ai/src/routes/video-task.js`

## Status Legend

| Status | Meaning |
| --- | --- |
| Resolved | The original action is implemented in code/config/tests for the reviewed scope. Residual operational work may still be listed if deployment is not complete. |
| Reduced | Immediate risk is materially lower, but the original finding is not fully closed. |
| Partially addressed | Some deliverables are complete, but important required pieces remain. |
| Still open | The finding remains substantially unimplemented. |
| Deferred to Phase 0-B | Not completed in Phase 0-A/0-A+ and should be handled in the next hardening phase. |
| Deferred to Phase 1 | Important SaaS maturity work, but not an immediate Phase 0 hardening blocker. |

## Top 20 Fixes With Current Status

| Priority | Fix | Status | Evidence from current files/tests | Remaining risk | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix failing static smoke tests | Resolved | `index.html`, `js/shared/wallet/wallet-controller.js`, and `js/shared/wallet/wallet-ui.js` are modified. `PHASE0_REMEDIATION_REPORT.md` records final `npm run test:static` as PASS, 155/155, after the three original smoke failures were fixed. | One earlier favorites-related static full-suite flake was noted but did not reproduce in final static/preflight runs. | Keep `npm run test:static` and `npm run release:preflight` blocking before merge/deploy; monitor for flake recurrence. |
| 2 | Add admin MFA rate limiting and lockout | Resolved for Phase 0 hardening | `workers/auth/src/routes/admin-mfa.js` applies fail-closed operation throttles. `workers/auth/migrations/0028_add_admin_mfa_failed_attempts.sql` and `workers/auth/src/lib/admin-mfa.js` add durable failed-attempt count, lockout expiration, and reset-on-success behavior. `tests/workers.spec.js` covers repeated invalid attempts, lockout, valid/recovery rejection during lockout, success reset, and missing backend fail-closed behavior. | This is still TOTP/recovery-code MFA, not WebAuthn/passkey step-up. Thresholds may need tuning after real abuse data. | Apply migration 0028 before auth deploy; consider WebAuthn/passkeys and admin step-up policy in Phase 1. |
| 3 | Make sensitive route rate limits fail closed | Reduced | Phase 0-A+ converted priority routes. Phase 0-B added `workers/auth/src/lib/sensitive-write-limit.js` and converted profile update, favorites delete, avatar delete, wallet unlink, AI folder/bulk/publication/text/audio/image writes, and contact submit fail-closed behavior. `tests/workers.spec.js` covers allowed, exhausted, and unavailable limiter behavior for representative routes. | Abuse controls remain route-specific, not plan/tenant/quota aware. Some expensive reads and dashboard/WAF controls remain outside app-layer throttling. | Continue Phase 1 abuse platform work: quotas, plan limits, expensive-read review, WAF/IaC, and observability. |
| 4 | Add signed service authentication between auth and AI workers | Resolved in code; production provisioning still open | `js/shared/service-auth.mjs` implements HMAC-SHA256 signing/verification over method, path, timestamp, nonce, and body hash. `workers/auth/src/lib/admin-ai-proxy.js` signs Auth-to-AI calls. `workers/ai/src/index.js` verifies every `/internal/ai/*` request before dispatch. `tests/workers.spec.js` covers valid, missing, invalid, expired, replayed, and tampered requests. | `AI_SERVICE_AUTH_SECRET` was not live-verified in Cloudflare. The value must exist and match exactly in both `workers/auth` and `workers/ai`; otherwise internal AI access fails closed. | Before production: provision matching `AI_SERVICE_AUTH_SECRET` in both Worker environments and verify in staging without printing the value. |
| 5 | Add `workers/ai/package-lock.json` and worker package CI install/audit | Resolved | `workers/ai/package-lock.json` exists. `.github/workflows/static.yml` now runs `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` for `workers/auth`, `workers/contact`, and `workers/ai`. `PHASE0_REMEDIATION_REPORT.md` records root and worker installs/audits as PASS. | CI still depends on npm registry availability and does not yet include dependency review/SBOM/license gates. | Keep worker package checks blocking; add broader CI security gates under item 10. |
| 6 | Add fail-closed Worker config validation | Reduced | `workers/auth/src/lib/config.js` validates auth critical config including `SESSION_SECRET`, `DB`, and `AI_SERVICE_AUTH_SECRET` where needed. `workers/ai/src/lib/config.js` validates `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY`. `scripts/validate-cloudflare-deploy-prereqs.mjs` validates repo config for critical secrets/bindings and marks production blocked when live validation is skipped. | Live Cloudflare config was not verified. Static headers, WAF, RUM, and some dashboard-managed resources are still not fully repo-enforced. | Run `npm run validate:cloudflare-prereqs -- --live` in staging where credentials are available, then add IaC/live drift checks in Phase 1. |
| 7 | Replace synchronous AI video polling with async jobs | Reduced | Phase 1-B makes the admin UI default to `/api/admin/ai/video-jobs`, requires `Idempotency-Key`, moves queue processing to `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`, ingests completed video/poster output into `USER_IMAGES`, and returns protected output routes. `tests/workers.spec.js` and `tests/auth-admin.spec.js` cover default async UI, no default sync route call, duplicate queue messages, R2 ingest, and protected status/output behavior. | The legacy `/api/admin/ai/test-video` compatibility route still exists for admin/debug rollback and can still run the old synchronous provider path if used directly. Full provider-specific production behavior still needs staging validation. | After staging verification, restrict or retire the synchronous compatibility route and add operational admin tooling for queued/failed video jobs. |
| 8 | Add request body size limited parsers | Resolved for Phase 0-B scope | `js/shared/request-body.mjs` adds content-length and streaming limits. `workers/auth/src/lib/request.js`, `workers/contact/src/index.js`, and `workers/ai/src/lib/validate.js` use limited parsers. Prioritized auth/admin/MFA/profile/favorites/avatar/wallet/AI/contact/internal AI routes now enforce route-specific caps. `tests/workers.spec.js` covers oversized header, oversized stream, malformed JSON, wrong content type, avatar multipart, AI save, and contact body failures. | This is byte-limit hardening, not full schema validation or a complete SaaS abuse/cost platform. Large save routes intentionally still allow MB-scale payloads. | Keep body limits under test; add schema validation and cost-aware payload policies in Phase 1. |
| 9 | Move Cloudflare dashboard controls into IaC or drift checks | Reduced | `scripts/validate-cloudflare-deploy-prereqs.mjs` validates repo declarations for required secrets, `SERVICE_AUTH_REPLAY`, migration `v1-service-auth-replay`, and critical auth bindings. `.github/workflows/static.yml` runs the prereq tests/validation. | Live resource verification is optional and was not run locally. WAF/static headers/RUM remain dashboard-managed and not repo-enforced. | Before deploy, run live/staging verification. Phase 1: move dashboard controls to IaC or add Cloudflare API drift checks. |
| 10 | Add CI security gates | Reduced | `.github/workflows/static.yml` includes root/worker installs/audits plus Cloudflare prereq tests/validation. Local Phase 0-B Worker and prereq tests passed. | CodeQL/SAST, secret scanning, dependency review, SBOM, and license checks are still missing as repo-defined blocking gates. | Phase 1: add a dedicated security workflow or extend CI with CodeQL/Semgrep, dependency review, secret scanning, SBOM, and license policy. |
| 11 | Add lint/typecheck/checkJs and safe DOM rules | Reduced | Phase 1-A added `scripts/check-worker-body-parsers.mjs`, `npm run check:worker-body-parsers`, release preflight integration, and CI coverage to prevent new direct Worker `request.json()`, `request.formData()`, `request.text()`, or `request.arrayBuffer()` calls. | This is not a full lint/typecheck/checkJs or safe DOM policy. XSS-prone frontend patterns and JavaScript contract drift remain harder to catch automatically. | Add ESLint/Biome or TypeScript `checkJs` in warning/report mode, then enforce on security-sensitive directories and changed files. |
| 12 | Split the largest admin/frontend modules | Deferred to Phase 1 | Phase 0-A/0-A+ intentionally avoided broad frontend refactors. The large admin and wallet/frontend modules remain outside the hardening scope. | Large modules remain difficult to review and regression-test surgically. | Phase 1: extract pure helpers first, add tests, then split admin AI, wallet, and asset browser modules by domain. |
| 13 | Add signed cursors and scalable indexes to activity endpoints | Deferred to Phase 1 | Phase 0-A/0-A+ did not change admin/user activity pagination or metadata search design. | Activity endpoints can degrade as logs grow; raw cursor/search patterns remain future scaling risk. | Phase 1: add signed cursors, normalized indexed search fields, aggregate tables, and high-row-count tests. |
| 14 | Add queue message schemas and DLQ behavior | Reduced | Phase 1-B adds `ai_video_job_poison_messages` in migration `0030`, records malformed video queue payloads with redacted body summaries, records exhausted attempts, and tests poison persistence in `tests/workers.spec.js`. | This is still video-job-specific; activity ingest and derivative queues do not share a uniform schema/DLQ abstraction, and there is no admin UI for poison inspection. | Phase 1-C: add support/admin inspection for poison messages and then standardize queue schema/DLQ patterns across remaining queues. |
| 15 | Introduce organization/team/tenant schema | Deferred to Phase 1 | No org/team/tenant schema was added. Current auth/media/AI flows remain user-centric by design for this hardening sprint. | B2B SaaS tenant isolation and enterprise account modeling remain absent. | Phase 1: design organizations, memberships, scoped roles, org-owned assets, and migration/backfill strategy. |
| 16 | Add billing, plans, entitlements, and quota enforcement | Deferred to Phase 1 | Phase 0-A/0-A+ did not introduce billing or subscription models. Existing AI quotas remain product-specific limits rather than plan entitlements. | Monetization, plan limits, webhook idempotency, and cost governance remain incomplete. | Phase 1: select billing provider, design webhook idempotency, create entitlement tables, and map current AI limits to plans. |
| 17 | Add data export/deletion and retention jobs | Deferred to Phase 1 | No compliance-grade export/deletion workflow was added. Existing cleanup jobs do not constitute user data lifecycle tooling. | GDPR/compliance readiness, support operations, and user data deletion/export remain incomplete. | Phase 1: inventory PII/assets, define retention policy, implement export jobs, then deletion with recovery-safe grace period. |
| 18 | Add observability, SLOs, and alert definitions | Reduced | Phase 1-B expands async video lifecycle events for provider task creation, polling, ingest success/failure, retry scheduling, poison recording, and duplicate/no-op behavior. `PHASE1_OBSERVABILITY_BASELINE.md` now includes Phase 1-B queue/R2/poison indicators. | Dashboards, alert rules, runbooks, and SLO burn-rate alerts are still not repo-enforced. Coverage is focused on async video jobs, not the whole SaaS surface. | Phase 1-C: define concrete Cloudflare dashboards/alerts and incident runbooks for auth, AI, media, contact, queues, and rate-limit degradation. |
| 19 | Add load/performance and frontend budget tests | Deferred to Phase 1 | No k6/Artillery/Lighthouse/WebPageTest budgets were added. Phase 0 validation focused on static, Worker, release, dependency, and build checks. | Capacity limits and frontend performance regressions remain unmeasured. | Phase 1: add API load tests for auth/admin/activity/AI/media and frontend budgets for homepage/account/admin. |
| 20 | Pin runtime/toolchain versions consistently | Still open | `.github/workflows/static.yml` uses Node 20, but no `.nvmrc`, `.node-version`, `.tool-versions`, Volta config, or `package.json` `engines` entry exists in the repo. Phase 1-A did not change runtime pinning. | Local/CI drift remains possible, especially because the audit/remediation work observed different local Node versions. | Choose Node 20 or another target intentionally, add the repo-local version pin, document npm expectations, and rerun full validation. |

## Immediate Pre-Deploy / Phase 1 Backlog

These are the highest-priority follow-ups after Phase 0-B and before broader Phase 1 SaaS work:

1. Track and commit all untracked Phase 1-B files with the related tracked modifications.
2. Keep validation green; re-run `npm run release:preflight` after any further application/config/test changes.
3. Provision matching `AI_SERVICE_AUTH_SECRET` in both `workers/auth` and `workers/ai`.
4. Deploy and verify the `SERVICE_AUTH_REPLAY` Durable Object binding and `v1-service-auth-replay` migration in staging.
5. Apply auth migration `0028_add_admin_mfa_failed_attempts.sql` before deploying auth Worker code.
6. Run `npm run validate:cloudflare-prereqs -- --live` or equivalent staging verification without printing secret values.
7. Verify dashboard-managed WAF/static security headers/RUM controls manually or move them to IaC.
8. Provision `bitbi-ai-video-jobs`, apply auth migrations `0029_add_ai_video_jobs.sql` and `0030_harden_ai_video_jobs_phase1b.sql`, and verify async video create/status/queue/R2 output processing in staging.
9. Provision `VIDU_API_KEY` in `workers/ai` if Vidu Q3 Pro async jobs are enabled.
10. Restrict or retire `/api/admin/ai/test-video` after staged async parity is proven.

## Production Deploy Blockers

Do not deploy Phase 0-A/0-A+/0-B/1-A/1-B to production until all of these are complete:

- `AI_SERVICE_AUTH_SECRET` exists in `workers/auth`.
- `AI_SERVICE_AUTH_SECRET` exists in `workers/ai`.
- The two `AI_SERVICE_AUTH_SECRET` values match exactly.
- Secret values are never printed in logs, CI, docs, terminal output, diagnostics, or error messages.
- `SERVICE_AUTH_REPLAY` exists as a `workers/ai` Durable Object binding.
- The `v1-service-auth-replay` Durable Object migration is deployed.
- Auth D1 migration `0028_add_admin_mfa_failed_attempts.sql` is applied before the auth Worker deploy.
- Auth D1 migration `0029_add_ai_video_jobs.sql` is applied before deploying async video job APIs/consumer code.
- Auth D1 migration `0030_harden_ai_video_jobs_phase1b.sql` is applied before deploying Phase 1-B queue-safe polling, R2 output, and poison-message code.
- Cloudflare Queue `bitbi-ai-video-jobs` exists and is bound to `workers/auth` as `AI_VIDEO_JOBS_QUEUE`.
- `USER_IMAGES` R2 binding is present and can store async video output/poster objects.
- `VIDU_API_KEY` exists in `workers/ai` if Vidu Q3 Pro async jobs are enabled.
- The auth Worker queue consumer for `bitbi-ai-video-jobs` is configured and verified in staging.
- Staging verifies valid Auth-to-AI calls, replay rejection, missing secret failure, missing replay backend failure, and no unsigned internal AI access.
- Staging verifies async admin video job create/status/queue processing before exposing it beyond controlled admin use.
- Staging verifies admin MFA failed-attempt lockout and reset-on-success behavior.
- `npm run release:preflight` passes for the final commit set.

## Validation Evidence Snapshot

The latest Phase 1-B validation evidence is recorded in `PHASE1B_REMEDIATION_REPORT.md`. Relevant results from this update:

| Command/check | Result | What it proves |
| --- | --- | --- |
| `npm run test:workers` | PASS, 283/283 | Worker route/security regressions pass, including Phase 0 controls and Phase 1-B async video create/poll/R2/poison tests. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI suite is green after switching default video flow to async jobs. |
| `npm run test:release-compat` | PASS | Release compatibility contract includes the new auth D1 migration, queue binding, and route contract. |
| `npm run test:release-plan` | PASS | Release planner accepts Phase 1-B docs, migration, and guardrail classifications. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq validator covers present/missing config, live validation states, and `AI_VIDEO_JOBS_QUEUE`. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production blocked | Repo config is valid, live Cloudflare validation was skipped, and production deploy is correctly not marked ready. |
| `npm run test:asset-version` | PASS | Asset-version contract remains valid. |
| `npm run validate:release` | PASS | Release compatibility configuration validates. |
| `npm run validate:asset-version` | PASS | Asset version references validate. |
| `npm run build:static` | PASS | Static build succeeds. |
| `npm run release:preflight` | PASS | Aggregated preflight passed after Phase 1-B changes, including Worker/static tests and release plan. |
| Root and Worker `npm ls --depth=0` | PASS | Root, auth, contact, and AI package graphs resolve. |
| Root and Worker `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Current lockfiles have no low-or-higher npm audit findings. |

Checks not performed:

- Live Cloudflare secret/binding verification.
- Production deploy.
- `npm run release:apply`.
- Remote D1 migrations.
- Root and Worker `npm ci` for this Phase 1-B pass, because dependency manifests and lockfiles did not change; package graph and audit checks were rerun instead.
- Markdown lint, because no repo markdown lint script is defined.
