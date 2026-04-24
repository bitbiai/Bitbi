# AUDIT_ACTION_PLAN.md

Date: 2026-04-24

Last updated: 2026-04-25 after Phase 0-A and Phase 0-A+ hardening.

Scope: top 20 highest-impact fixes for `/Users/btc2020/Bitbi/Bitbi`, preserved in exact original priority order. This file is now a status-tracked action plan. Historical audit findings are not deleted; each item records current status, evidence, remaining risk, and the next action.

Source documents:

- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- Current git status and diff as of this update
- Phase 0-A/0-A+ changed application, config, CI, and test files

## Current Readiness Summary

| Area | Status | Evidence | Remaining risk | Next action |
| --- | --- | --- | --- | --- |
| Merge readiness | Conditional | `PHASE0_REMEDIATION_REPORT.md` records passing `test:workers`, `test:static`, release checks, asset checks, package installs/audits, build, and preflight. | Required security/audit files are still untracked in the working tree. A partial commit would break service auth, config validation, or documentation traceability. | Track and commit every untracked file listed below with the related tracked modifications. |
| Production deploy readiness | Blocked | Repo config declares `AI_SERVICE_AUTH_SECRET` manual prerequisites and `SERVICE_AUTH_REPLAY` Durable Object binding/migration. | Live Cloudflare secrets/bindings were not verified. Missing or mismatched secrets will fail closed and block internal AI access. | Provision matching `AI_SERVICE_AUTH_SECRET` in `workers/auth` and `workers/ai`; deploy and verify `SERVICE_AUTH_REPLAY` in staging before production. |
| Phase 0-A/0-A+ security posture | Reduced immediate risk | HMAC service auth, nonce replay protection, priority fail-closed limiters, MFA throttling, config validation, and regression tests are present. | This is not full SaaS maturity. MFA lockout remains fixed-window throttling, remaining write routes need review, body-size hardening is incomplete, and async AI video jobs are not designed. | Execute Phase 0-B before broader Phase 1 SaaS platform work. |

Untracked files that must be included before merge:

- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- `js/shared/service-auth.mjs`
- `workers/ai/package-lock.json`
- `workers/ai/src/lib/config.js`
- `workers/ai/src/lib/service-auth-replay-do.js`
- `workers/ai/src/lib/service-auth-replay.js`
- `workers/auth/src/lib/config.js`

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
| 2 | Add admin MFA rate limiting and lockout | Reduced | `workers/auth/src/routes/admin-mfa.js` applies `sensitiveRateLimitOptions()` to setup, enable, verify, disable, and recovery-code regeneration operations. `tests/workers.spec.js` includes Phase 0-A+ security regression coverage; `npm run test:workers` passed, 260/260. | The current control is fail-closed fixed-window throttling, not a dedicated failed-attempt state machine with explicit reset-on-success semantics. | Phase 0-B: add a dedicated durable failed-attempt counter/state model if product/security policy requires stronger lockout accounting. |
| 3 | Make sensitive route rate limits fail closed | Reduced | `workers/auth/src/lib/rate-limit.js` exposes `sensitiveRateLimitOptions()` and fail-closed behavior. Priority call sites were converted in `workers/auth/src/routes/admin.js`, `admin-mfa.js`, `auth.js`, `password.js`, `verification.js`, `wallet.js`, `avatar.js`, `favorites.js`, `workers/auth/src/routes/ai/images-write.js`, and `workers/auth/src/lib/admin-ai-proxy.js`. Worker tests passed. | Lower-priority authenticated write routes still need route-by-route abuse review, and request body-size limits remain incomplete. | Phase 0-B: review remaining authenticated mutation routes, add missing route-specific throttles, and ensure expensive work happens after authorization and limits. |
| 4 | Add signed service authentication between auth and AI workers | Resolved in code; production provisioning still open | `js/shared/service-auth.mjs` implements HMAC-SHA256 signing/verification over method, path, timestamp, nonce, and body hash. `workers/auth/src/lib/admin-ai-proxy.js` signs Auth-to-AI calls. `workers/ai/src/index.js` verifies every `/internal/ai/*` request before dispatch. `tests/workers.spec.js` covers valid, missing, invalid, expired, replayed, and tampered requests. | `AI_SERVICE_AUTH_SECRET` was not live-verified in Cloudflare. The value must exist and match exactly in both `workers/auth` and `workers/ai`; otherwise internal AI access fails closed. | Before production: provision matching `AI_SERVICE_AUTH_SECRET` in both Worker environments and verify in staging without printing the value. |
| 5 | Add `workers/ai/package-lock.json` and worker package CI install/audit | Resolved | `workers/ai/package-lock.json` exists. `.github/workflows/static.yml` now runs `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` for `workers/auth`, `workers/contact`, and `workers/ai`. `PHASE0_REMEDIATION_REPORT.md` records root and worker installs/audits as PASS. | CI still depends on npm registry availability and does not yet include dependency review/SBOM/license gates. | Keep worker package checks blocking; add broader CI security gates under item 10. |
| 6 | Add fail-closed Worker config validation | Reduced | `workers/auth/src/lib/config.js` validates auth critical config including `SESSION_SECRET`, `DB`, and `AI_SERVICE_AUTH_SECRET` where needed. `workers/ai/src/lib/config.js` validates `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY`. `workers/ai/src/index.js` fails closed before internal AI route dispatch when config is missing. Worker tests passed. | Config validation is not yet exhaustive for every R2, Queue, Images, D1, contact, dashboard, and environment-specific binding. Live Cloudflare config was not verified. | Phase 0-B: add dashboard-aware preflight and expand route-specific binding validation without leaking secret values. |
| 7 | Replace synchronous AI video polling with async jobs | Deferred to Phase 0-B | `workers/ai/src/lib/invoke-ai-video.js` still defines `VIDU_PROVIDER_DEFAULT_TIMEOUT_MS = 450_000` and polls provider status in-request. `AI_VIDEO_ASYNC_JOB_DESIGN.md` is not present in this working tree. | Long-running video requests can still create high tail latency, duplicated provider work, and Worker runtime risk. | Phase 0-B: create the async AI video job design document and migration plan; implementation can follow once the job schema, queue flow, callback/polling model, and UI contract are agreed. |
| 8 | Add request body size limited parsers | Deferred to Phase 0-B | `workers/auth/src/lib/request.js` and `workers/ai/src/lib/validate.js` still use `request.json()` wrappers without byte limits. `workers/contact/src/index.js` uses `request.json()`. `workers/auth/src/routes/avatar.js` still reaches `request.formData()` for avatar upload, although it now has fail-closed rate limiting. Some image save paths have payload-specific size checks, but there is no uniform parser limit. | Oversized JSON/multipart bodies can still consume memory/CPU before validation on several routes. | Phase 0-B: add `readJsonBodyLimited`, content-length/stream guards, multipart limits, endpoint-specific caps, and oversized-body tests. |
| 9 | Move Cloudflare dashboard controls into IaC or drift checks | Partially addressed | `config/release-compat.json` now records `AI_SERVICE_AUTH_SECRET` manual prerequisites and `SERVICE_AUTH_REPLAY` requirements, and release compatibility tests validate repo-side config. | Dashboard-managed WAF/static headers/RUM/resources/secrets are still not live-verified or fully repo-enforced. | Phase 0-B/Phase 1: add dashboard-aware preflight or IaC for required Worker secrets, DO bindings, routes, queues, buckets, D1, WAF, headers, and RUM. |
| 10 | Add CI security gates | Reduced | `.github/workflows/static.yml` now includes root `npm audit --audit-level=low` and worker `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low`. Local Phase 0-A+ package installs/audits passed for root and all workers. | CodeQL/SAST, secret scanning, dependency review, SBOM, and license checks are still missing as repo-defined blocking gates. | Phase 1: add a dedicated security workflow or extend CI with CodeQL/Semgrep, dependency review, secret scanning, SBOM, and license policy. |
| 11 | Add lint/typecheck/checkJs and safe DOM rules | Still open | No lint/typecheck/checkJs script is defined in `package.json`, and this update did not add static DOM safety rules. | XSS-prone patterns and JavaScript contract drift remain harder to catch automatically. | Phase 1: add ESLint/Biome or equivalent, start warning-only, then enforce on security-sensitive directories and changed files. |
| 12 | Split the largest admin/frontend modules | Deferred to Phase 1 | Phase 0-A/0-A+ intentionally avoided broad frontend refactors. The large admin and wallet/frontend modules remain outside the hardening scope. | Large modules remain difficult to review and regression-test surgically. | Phase 1: extract pure helpers first, add tests, then split admin AI, wallet, and asset browser modules by domain. |
| 13 | Add signed cursors and scalable indexes to activity endpoints | Deferred to Phase 1 | Phase 0-A/0-A+ did not change admin/user activity pagination or metadata search design. | Activity endpoints can degrade as logs grow; raw cursor/search patterns remain future scaling risk. | Phase 1: add signed cursors, normalized indexed search fields, aggregate tables, and high-row-count tests. |
| 14 | Add queue message schemas and DLQ behavior | Deferred to Phase 1 | Phase 0-A/0-A+ did not introduce generic queue payload schemas or dead-letter handling. Some existing cleanup/derivative logic has retries, but there is no uniform queue contract. | Unknown or malformed queue messages can still be mishandled outside paths with explicit retry logic. | Phase 1: version queue payloads, validate schemas at consumers, persist poison messages, and test retry exhaustion. |
| 15 | Introduce organization/team/tenant schema | Deferred to Phase 1 | No org/team/tenant schema was added. Current auth/media/AI flows remain user-centric by design for this hardening sprint. | B2B SaaS tenant isolation and enterprise account modeling remain absent. | Phase 1: design organizations, memberships, scoped roles, org-owned assets, and migration/backfill strategy. |
| 16 | Add billing, plans, entitlements, and quota enforcement | Deferred to Phase 1 | Phase 0-A/0-A+ did not introduce billing or subscription models. Existing AI quotas remain product-specific limits rather than plan entitlements. | Monetization, plan limits, webhook idempotency, and cost governance remain incomplete. | Phase 1: select billing provider, design webhook idempotency, create entitlement tables, and map current AI limits to plans. |
| 17 | Add data export/deletion and retention jobs | Deferred to Phase 1 | No compliance-grade export/deletion workflow was added. Existing cleanup jobs do not constitute user data lifecycle tooling. | GDPR/compliance readiness, support operations, and user data deletion/export remain incomplete. | Phase 1: inventory PII/assets, define retention policy, implement export jobs, then deletion with recovery-safe grace period. |
| 18 | Add observability, SLOs, and alert definitions | Deferred to Phase 1 | Phase 0-A/0-A+ added or preserved structured security events in specific controls, but did not define SLOs, metrics, alerts, or incident runbooks. | Production incidents would still depend heavily on dashboard/manual observability. | Phase 1: define SLOs, metrics, alert thresholds, dashboard expectations, and runbooks for auth, AI, media, contact, queues, and rate-limit degradation. |
| 19 | Add load/performance and frontend budget tests | Deferred to Phase 1 | No k6/Artillery/Lighthouse/WebPageTest budgets were added. Phase 0 validation focused on static, Worker, release, dependency, and build checks. | Capacity limits and frontend performance regressions remain unmeasured. | Phase 1: add API load tests for auth/admin/activity/AI/media and frontend budgets for homepage/account/admin. |
| 20 | Pin runtime/toolchain versions consistently | Still open | `.github/workflows/static.yml` uses Node 20, but no `.nvmrc`, `.node-version`, `.tool-versions`, Volta config, or `package.json` `engines` entry exists in the repo. | Local/CI drift remains possible, especially because the audit/remediation work observed different local Node versions. | Choose Node 20 or another target intentionally, add the repo-local version pin, document npm expectations, and rerun full validation. |

## Immediate Phase 0-B Operational Backlog

These are the highest-priority follow-ups after Phase 0-A/0-A+ and before broader Phase 1 SaaS work:

1. Track and commit all untracked security, lockfile, config, and audit files.
2. Provision matching `AI_SERVICE_AUTH_SECRET` in both `workers/auth` and `workers/ai`.
3. Deploy and verify the `SERVICE_AUTH_REPLAY` Durable Object binding and `v1-service-auth-replay` migration in staging.
4. Add dashboard-aware secret/binding/resource preflight that fails production deploy when critical Cloudflare state is missing.
5. Add limited JSON/multipart body parsers and oversized-body tests for contact, avatar, AI, and remaining write routes.
6. Continue fail-closed route throttling review for lower-priority authenticated mutation routes.
7. Decide whether admin MFA needs a dedicated durable failed-attempt state with reset-on-success semantics.
8. Write `AI_VIDEO_ASYNC_JOB_DESIGN.md` covering job schema, queue flow, provider polling/callbacks, status API, admin UI migration, idempotency, retries, and cleanup.

## Production Deploy Blockers

Do not deploy Phase 0-A/0-A+ to production until all of these are complete:

- `AI_SERVICE_AUTH_SECRET` exists in `workers/auth`.
- `AI_SERVICE_AUTH_SECRET` exists in `workers/ai`.
- The two `AI_SERVICE_AUTH_SECRET` values match exactly.
- Secret values are never printed in logs, CI, docs, terminal output, diagnostics, or error messages.
- `SERVICE_AUTH_REPLAY` exists as a `workers/ai` Durable Object binding.
- The `v1-service-auth-replay` Durable Object migration is deployed.
- Staging verifies valid Auth-to-AI calls, replay rejection, missing secret failure, missing replay backend failure, and no unsigned internal AI access.
- `npm run release:preflight` passes after the final commit set.

## Validation Evidence Snapshot

The latest full validation evidence is recorded in `PHASE0_REMEDIATION_REPORT.md`. Relevant results:

| Command/check | Result | What it proves |
| --- | --- | --- |
| `npm run test:workers` | PASS, 260/260 | Worker route/security regressions pass, including HMAC, nonce replay, fail-closed limiter, config validation, MFA, and CSRF coverage. |
| `npm run test:static` | PASS, 155/155 | Static smoke suite is green after the original three failures were fixed. |
| `npm run test:release-compat` | PASS | Release compatibility contract includes the new Worker config and Durable Object requirements. |
| `npm run test:release-plan` | PASS | Release planner accepts the current file classifications. |
| `npm run test:asset-version` | PASS | Asset-version contract remains valid. |
| `npm run validate:release` | PASS | Release compatibility configuration validates. |
| `npm run validate:asset-version` | PASS | Asset version references validate. |
| `npm run build:static` | PASS | Static build succeeds. |
| `npm run release:preflight` | PASS | Aggregated preflight passed after Phase 0-A/0-A+ changes. |
| Root and worker `npm ci` | PASS | Dependency installs are reproducible from lockfiles. |
| Root and worker `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Current lockfiles have no low-or-higher npm audit findings. |

Checks not performed:

- Live Cloudflare secret/binding verification.
- Production deploy.
- `npm run release:apply`.
- Remote D1 migrations.
- Markdown lint, because no repo markdown lint script is defined.
