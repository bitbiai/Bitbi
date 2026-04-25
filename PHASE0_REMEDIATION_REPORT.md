# Phase 0-A / 0-A+ Remediation Report

## Executive Summary

This document covers the Phase 0-A remediation sprint and the Phase 0-A+ Staff Security Engineer pre-merge hardening pass performed after the SaaS-readiness audit in `AUDIT_NEXT_LEVEL.md` and `AUDIT_ACTION_PLAN.md`.

The work reduced immediate release, security, and CI risk without changing the repository architecture. It fixed the failing static smoke tests, added HMAC service authentication for Auth-to-AI Worker calls, added nonce-backed replay protection, made priority sensitive rate limits fail closed, added admin MFA throttling/lockout coverage, added Worker config validation, added `workers/ai` dependency reproducibility, and expanded security regression tests.

Merge readiness and deploy readiness are intentionally separate:

| Area | Status | Evidence |
| --- | --- | --- |
| Merge readiness | CONDITIONAL PASS | Test and release checks pass, but all untracked security/audit files listed in this report must be committed. |
| Production deploy readiness | FAIL | Cloudflare secrets/bindings were not live-verified. `AI_SERVICE_AUTH_SECRET` must exist with the same value in both `workers/auth` and `workers/ai`, and `SERVICE_AUTH_REPLAY` must be deployed for `workers/ai`. |
| Phase 0-A+ security review | PASS for reviewed scope | HMAC, nonce replay, fail-closed limiters, config validation, MFA throttle tests, and CSRF mutation tests are present and passing. |

Production must not deploy Phase 0-A/0-A+ until the deployment checklist below is complete in staging and then production.

Phase 0-B update:

- Phase 0-B follow-up work is recorded in `PHASE0B_REMEDIATION_REPORT.md`.
- Phase 0-B added repo-side Cloudflare deploy prerequisite validation, request body-size limited parsers, additional fail-closed route throttles, durable admin MFA failed-attempt state, expanded CSRF regression coverage, and `AI_VIDEO_ASYNC_JOB_DESIGN.md`.
- This Phase 0-A/0-A+ report remains historically accurate for the earlier hardening pass; use `PHASE0B_REMEDIATION_REPORT.md` and the updated `AUDIT_ACTION_PLAN.md` for current merge/deploy status.

## Scope And Source Documents

Documents reviewed:

| Document | Status |
| --- | --- |
| `AUDIT_NEXT_LEVEL.md` | Present; audit source of truth for Phase 0 priorities. |
| `AUDIT_ACTION_PLAN.md` | Present; top 20 remediation priorities. |
| `PHASE0_REMEDIATION_REPORT.md` | This file; updated to reflect current code/config/tests. |
| `AI_VIDEO_ASYNC_JOB_DESIGN.md` | Present after Phase 0-B. Async AI video jobs remain a later implementation item, not Phase 0-A/0-A+ runtime behavior. |

Current git state reviewed:

- `git status --short` shows application/config/test changes from Phase 0-A/0-A+ plus untracked new security/audit files.
- `git diff --name-only` shows tracked-file modifications only; new untracked files must still be included in the final commit.

## Current Working Tree Snapshot

This snapshot matters because merge readiness depends on committing both tracked modifications and currently untracked security files.

Tracked files currently modified:

- `.github/workflows/static.yml`
- `config/release-compat.json`
- `index.html`
- `js/shared/durable-rate-limit-do.mjs`
- `js/shared/wallet/wallet-controller.js`
- `js/shared/wallet/wallet-ui.js`
- `scripts/lib/release-plan.mjs`
- `scripts/test-release-compat.mjs`
- `scripts/test-release-plan.mjs`
- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`
- `workers/ai/src/index.js`
- `workers/ai/wrangler.jsonc`
- `workers/auth/CLAUDE.md`
- `workers/auth/src/index.js`
- `workers/auth/src/lib/admin-ai-proxy.js`
- `workers/auth/src/lib/rate-limit.js`
- `workers/auth/src/routes/admin-mfa.js`
- `workers/auth/src/routes/admin.js`
- `workers/auth/src/routes/ai/images-write.js`
- `workers/auth/src/routes/auth.js`
- `workers/auth/src/routes/avatar.js`
- `workers/auth/src/routes/favorites.js`
- `workers/auth/src/routes/password.js`
- `workers/auth/src/routes/verification.js`
- `workers/auth/src/routes/wallet.js`

Untracked files currently present and required for merge:

- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- `js/shared/service-auth.mjs`
- `workers/ai/package-lock.json`
- `workers/ai/src/lib/config.js`
- `workers/ai/src/lib/service-auth-replay-do.js`
- `workers/ai/src/lib/service-auth-replay.js`
- `workers/auth/src/lib/config.js`

## Security Review Result

| Control | Status | Current behavior | Remaining limitation |
| --- | --- | --- | --- |
| HMAC service auth | PASS | All `/internal/ai/*` routes in `workers/ai/src/index.js` call `assertValidServiceRequest()` before dispatch. Auth-to-AI proxy calls sign requests in `workers/auth/src/lib/admin-ai-proxy.js`. | Live Cloudflare secret parity has not been verified. |
| Nonce replay protection | PASS | `x-bitbi-service-nonce` is required, included in the HMAC payload, validated, stored in `SERVICE_AUTH_REPLAY`, and rejected on reuse inside the replay window. | Replay state depends on the new AI Durable Object binding and migration being deployed. |
| Admin MFA throttling/lockout | PASS for Phase 0-A+ | MFA setup, enable, verify, disable, and recovery-code regeneration use fail-closed Durable Object backed per-admin and per-IP throttles. | This is fixed-window throttling, not a separate failed-attempt table with reset-on-success semantics. |
| Fail-closed sensitive limits | PASS for priority routes | Admin mutations, admin AI, admin MFA, auth/password/verification, wallet SIWE, member AI generation, avatar upload, and favorites add use fail-closed limiter behavior. | Lower-priority write routes still need Phase 0-B abuse review. |
| Worker config validation | PASS for Phase 0 scope | Auth validates `SESSION_SECRET` and `DB`; auth-to-AI signing validates `AI_SERVICE_AUTH_SECRET`; AI validates `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY`. | Route-specific R2/Queue/Images binding validation remains Phase 0-B/Phase 1 work. |
| Internal AI route protection | PASS | Missing, malformed, expired, invalid, replayed, and body-tampered signed requests are rejected before expensive AI handlers. | New AI verifier is incompatible with an old auth worker that does not sign requests. Use a coordinated rollout. |
| CSRF mutation coverage | PASS for added regression scope | Foreign `Origin` is tested against auth login, admin role mutation, MFA setup, AI generation, and avatar mutation before side effects. | Coverage should continue for remaining authenticated mutation routes in Phase 0-B. |
| CI/reproducibility | PASS | Root and Worker package installs/audits pass; CI workflow validates worker packages; `workers/ai/package-lock.json` exists. | CI still depends on npm registry availability. |

## Operational Security Contracts

### `AI_SERVICE_AUTH_SECRET`

| Requirement | Status | Notes |
| --- | --- | --- |
| Must exist in `workers/auth` | Not live-verified | Required for signing Auth-to-AI internal requests. Missing or short values fail closed before proxying. |
| Must exist in `workers/ai` | Not live-verified | Required for verifying `/internal/ai/*` requests. Missing or short values fail closed before route dispatch. |
| Values must match exactly | Not live-verified | Mismatch causes all signed internal AI requests to fail. |
| Secret values must not be printed | Required operational rule | Do not print in logs, CI, docs, shell history, diagnostics, or error responses. |
| Minimum value accepted by code | Enforced locally | Shared service-auth validation rejects missing/short values. |

Relevant files:

- `js/shared/service-auth.mjs`
- `workers/auth/src/lib/admin-ai-proxy.js`
- `workers/auth/src/lib/config.js`
- `workers/ai/src/lib/config.js`
- `config/release-compat.json`

### `SERVICE_AUTH_REPLAY`

| Requirement | Status | Notes |
| --- | --- | --- |
| Durable Object binding exists in repo config | PASS | `workers/ai/wrangler.jsonc` declares `SERVICE_AUTH_REPLAY` with class `AiServiceAuthReplayDurableObject`. |
| Migration exists in repo config | PASS | `workers/ai/wrangler.jsonc` declares migration tag `v1-service-auth-replay`. |
| Release contract validates binding/migration | PASS | `config/release-compat.json` and `scripts/test-release-compat.mjs` include the binding and migration. |
| Live Cloudflare binding exists | Not verified | Must be verified in staging before production. |
| Missing/unavailable binding fails closed | PASS in tests | AI internal routes return safe `503` when nonce state cannot be reached. |

Relevant files:

- `workers/ai/wrangler.jsonc`
- `workers/ai/src/lib/service-auth-replay.js`
- `workers/ai/src/lib/service-auth-replay-do.js`
- `js/shared/durable-rate-limit-do.mjs`
- `tests/workers.spec.js`

### Nonce Replay Behavior

| Behavior | Implementation |
| --- | --- |
| Header | `x-bitbi-service-nonce` |
| Format | `^[A-Za-z0-9_-]{16,128}$` |
| Signed payload fields | version, method, path, timestamp, nonce, body hash |
| Replay window | 5 minutes (`SERVICE_AUTH_REPLAY_WINDOW_MS`) |
| Fresh signed request | Accepted after HMAC verification and nonce recording. |
| Same signed request replayed | Rejected as replay. |
| Same nonce with different body and valid signature | Rejected as replay because nonce reuse is blocked. |
| Missing/malformed nonce | Rejected before handler dispatch. |
| Nonce backend unavailable | Fails closed with generic service-unavailable response. |

## Security Behavior Before Vs After

### HMAC Service-To-Service Authentication

Previous behavior:

- The AI worker accepted `/internal/ai/*` requests based on topology and service-binding assumptions.
- `workers_dev:false` and `preview_urls:false` reduced exposure, but the AI worker did not verify a cryptographic caller proof.

New behavior:

- `js/shared/service-auth.mjs` signs method, path, timestamp, nonce, and body hash with HMAC-SHA256.
- `workers/auth/src/lib/admin-ai-proxy.js` signs Auth-to-AI requests with `AI_SERVICE_AUTH_SECRET`.
- `workers/ai/src/index.js` rejects unsigned or invalid `/internal/ai/*` requests before route dispatch.

Why safer:

- A future routing, preview, or service-binding mistake cannot call expensive AI routes without the shared secret and valid signed request.

Remaining limitations:

- The secret value was not live-verified in Cloudflare.
- Old auth code cannot call new AI verifier. Staging must verify rollout order before production.

Relevant files:

- `js/shared/service-auth.mjs`
- `workers/auth/src/lib/admin-ai-proxy.js`
- `workers/ai/src/index.js`
- `workers/auth/src/lib/config.js`
- `workers/ai/src/lib/config.js`

### Nonce-Backed Replay Protection

Previous behavior:

- Phase 0-A HMAC used a timestamp replay window and body-bound signatures, but no centralized nonce store.

New behavior:

- `x-bitbi-service-nonce` is mandatory and must match `/^[A-Za-z0-9_-]{16,128}$/`.
- The nonce is part of the canonical signed payload.
- `workers/ai/src/lib/service-auth-replay.js` records accepted nonces in the `SERVICE_AUTH_REPLAY` Durable Object.
- Reusing a nonce within the replay window returns an auth failure.
- Missing nonce state fails closed with a generic `503`.

Why safer:

- Captured signed requests cannot be replayed inside the timestamp window.
- Replay protection is centralized and Cloudflare-compatible, not isolate-local memory.

Remaining limitations:

- `SERVICE_AUTH_REPLAY` must be deployed and verified in staging and production.
- TTL cleanup depends on Durable Object storage/alarm behavior.

Relevant files:

- `js/shared/service-auth.mjs`
- `js/shared/durable-rate-limit-do.mjs`
- `workers/ai/src/lib/service-auth-replay.js`
- `workers/ai/src/lib/service-auth-replay-do.js`
- `workers/ai/wrangler.jsonc`

### Fail-Closed Rate Limiting

Previous behavior:

- Several privileged or expensive routes could fall back to isolate-local memory when shared limiter state was unavailable.
- Some auth helper wrappers only failed closed in production, which could hide regressions in test/dev.
- Favorites add still used the older shared limiter path.

New behavior:

- `workers/auth/src/lib/rate-limit.js` supports explicit `failClosed: true` and `sensitiveRateLimitOptions()`.
- Admin mutations, admin AI, MFA, auth/password/verification, wallet SIWE, member AI generation, avatar upload, and favorites add use fail-closed Durable Object backed limits.
- If the limiter binding/backend is unavailable, sensitive routes return a safe `503` rather than allowing unbounded attempts.

Why safer:

- Abuse controls do not silently degrade to per-isolate counters for sensitive routes.
- Tests now exercise missing limiter state before production.

Remaining limitations:

- Lower-priority authenticated write routes still need Phase 0-B route-specific review.
- Contact worker still uses production fail-closed behavior for its public submit limiter; this is outside the auth/admin Phase 0-A+ conversion scope.

Relevant files:

- `workers/auth/src/lib/rate-limit.js`
- `workers/auth/src/routes/auth.js`
- `workers/auth/src/routes/password.js`
- `workers/auth/src/routes/verification.js`
- `workers/auth/src/routes/wallet.js`
- `workers/auth/src/routes/admin.js`
- `workers/auth/src/routes/admin-mfa.js`
- `workers/auth/src/lib/admin-ai-proxy.js`
- `workers/auth/src/routes/ai/images-write.js`
- `workers/auth/src/routes/avatar.js`
- `workers/auth/src/routes/favorites.js`

Phase 0-A+ fail-closed route coverage:

| Area | Representative routes/operations | Backend | Failure behavior |
| --- | --- | --- | --- |
| Auth register/login | `/api/register`, `/api/login` | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; exhausted limiter returns `429`. |
| Password reset | `/api/forgot-password`, `/api/reset-password/validate`, `/api/reset-password` | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; exhausted limiter returns route-appropriate generic or `429` response. |
| Email verification | `/api/verify-email`, resend/request verification paths | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; exhausted limiter returns `429`. |
| Wallet SIWE | `/api/wallet/siwe/nonce`, `/api/wallet/siwe/verify` | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; no challenge is created when nonce limiter fails closed. |
| Admin mutations | role/status/revoke/delete user operations | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503` before mutation. |
| Admin MFA | setup/enable/verify/disable/recovery-code regeneration | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; repeated attempts produce `429`. |
| Admin AI proxy | `/api/admin/ai/*` proxy operations | `PUBLIC_RATE_LIMITER` Durable Object plus HMAC to AI worker | Missing limiter returns `503` before proxying; missing service secret returns `503` before proxying. |
| Member AI generation | `/api/ai/generate-image` | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503` before generation. |
| Avatar upload/write | `/api/profile/avatar` upload/write path | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503` before upload/write work. |
| Favorites add | `POST /api/favorites` | `PUBLIC_RATE_LIMITER` Durable Object | Missing/unavailable limiter returns `503`; exhausted limiter returns `429`. |

Not claimed:

- This does not mean every authenticated mutation route in the repository has route-specific fail-closed throttling.
- Lower-priority write routes and body-size hardening are Phase 0-B work.

### Admin MFA Throttling And Lockout

Previous behavior:

- Admin MFA setup/enable/verify/disable/recovery-code endpoints did not have explicit app-layer throttling.
- Repeated failed MFA verification depended on external controls or route logic rather than a deterministic app-layer limiter.

New behavior:

- MFA operations enforce per-admin and per-IP fail-closed Durable Object limits.
- Repeated failed TOTP attempts lock out subsequent valid TOTP and recovery-code verification until the limiter window expires.
- Limiter backend failure blocks MFA operations with `503`.

Why safer:

- A compromised admin session/password cannot make unlimited MFA attempts if central limiter state is unavailable or exhausted.

Remaining limitations:

- The lockout is fixed-window operation throttling. A dedicated failed-attempt model with success reset is still a Phase 0-B option.

Relevant files:

- `workers/auth/src/routes/admin-mfa.js`
- `workers/auth/src/lib/admin-mfa.js`
- `tests/workers.spec.js`

### Worker Config Validation

Previous behavior:

- Missing critical bindings/secrets could fail late or inconsistently.
- Missing internal service-auth config was not explicitly validated before internal AI route use.

New behavior:

- `workers/auth/src/lib/config.js` validates auth core config at request entry.
- `workers/auth/src/lib/config.js` validates auth-to-AI service signing config before proxy calls.
- `workers/ai/src/lib/config.js` validates `AI_SERVICE_AUTH_SECRET` and `SERVICE_AUTH_REPLAY` before internal AI route dispatch.
- Errors return generic `503` responses and log safe reason codes, not secret values.

Why safer:

- Missing security-critical config fails closed instead of degrading to weak or undefined behavior.

Remaining limitations:

- Broader route-specific config validation for all R2 buckets, Queues, Images, and AI bindings remains incomplete.

Relevant files:

- `workers/auth/src/index.js`
- `workers/auth/src/lib/config.js`
- `workers/ai/src/index.js`
- `workers/ai/src/lib/config.js`

### CSRF And Authenticated Mutation Regression Coverage

Previous behavior:

- Central same-origin checks existed, but Phase 0-A+ did not yet have focused regression tests for several sensitive mutation families.

New behavior:

- Tests verify foreign-origin mutation requests are rejected before side effects for login, admin role changes, MFA setup, AI generation, and avatar mutation.

Why safer:

- Future changes to central origin/referrer checks are more likely to be caught before merge.

Remaining limitations:

- More authenticated mutation endpoints should be added to the regression matrix in Phase 0-B.

Relevant files:

- `workers/auth/src/index.js`
- `tests/workers.spec.js`

## Deployment Checklist

Do not deploy Phase 0-A/0-A+ to production until every required item is complete.

### Required Before Staging Deploy

- [ ] Commit all untracked files listed in the merge-readiness section.
- [ ] Run `npm run release:plan` and confirm worker/static impact and manual prerequisites.
- [ ] Run `npm run release:preflight` locally or in CI.
- [ ] Provision `AI_SERVICE_AUTH_SECRET` in `workers/auth`.
- [ ] Provision `AI_SERVICE_AUTH_SECRET` in `workers/ai`.
- [ ] Confirm the two `AI_SERVICE_AUTH_SECRET` values match exactly without printing the secret value in logs, CI, docs, terminal history, or error output.
- [ ] Confirm `workers/ai/wrangler.jsonc` includes the `SERVICE_AUTH_REPLAY` Durable Object binding.
- [ ] Confirm the `v1-service-auth-replay` Durable Object migration is included for `workers/ai`.
- [ ] Confirm required existing secrets still exist: auth `SESSION_SECRET`, auth `RESEND_API_KEY`, and contact `RESEND_API_KEY`.

### Required Staging Verification

- [ ] Deploy to staging or an equivalent non-production Worker environment first.
- [ ] Verify unsigned direct `/internal/ai/*` requests are rejected.
- [ ] Verify a signed auth-to-AI request succeeds.
- [ ] Verify replaying the same signed request with the same nonce is rejected.
- [ ] Verify missing `AI_SERVICE_AUTH_SECRET` blocks internal AI access in both workers.
- [ ] Verify missing or unavailable `SERVICE_AUTH_REPLAY` blocks internal AI access.
- [ ] Verify admin MFA repeated failures produce throttling/lockout behavior.
- [ ] Verify admin AI, member AI generation, avatar upload, favorites add, and auth mutation limits fail closed when limiter state is unavailable.
- [ ] Verify static Pages still deploys separately from Worker deploys.

### Production Deploy Caveats

- [ ] Production is not deploy-ready until staging verification passes.
- [ ] Missing critical secrets/bindings are expected to fail closed and may block internal AI access.
- [ ] The new AI verifier is incompatible with an old auth worker that does not sign internal AI requests.
- [ ] Prefer a coordinated rollout where auth signing is available before or at the same time as AI verification.
- [ ] Do not print, echo, commit, or paste secret values while provisioning.

### Rollback Considerations

- If internal AI access fails immediately after deploy, first verify `AI_SERVICE_AUTH_SECRET` parity and `SERVICE_AUTH_REPLAY` availability.
- Rolling back only the auth worker while leaving the new AI worker in place can break internal AI calls because old auth code does not sign requests.
- New auth signing headers are compatible with the older AI worker because the older AI worker ignores unknown headers.
- A safer rollback path for service-auth failures is to roll back AI verification first or roll back both auth and AI workers together.
- Static Pages rollback does not roll back Workers; Workers deploy separately.

## Merge Readiness

Merge status: CONDITIONAL PASS.

This work is merge-ready only if the full file set below is tracked and committed together. The current working tree still has untracked files.

Untracked files that must be included:

- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE0_REMEDIATION_REPORT.md`
- `js/shared/service-auth.mjs`
- `workers/ai/package-lock.json`
- `workers/ai/src/lib/config.js`
- `workers/ai/src/lib/service-auth-replay-do.js`
- `workers/ai/src/lib/service-auth-replay.js`
- `workers/auth/src/lib/config.js`

Checks that support merge readiness:

| Check | Result |
| --- | --- |
| Worker security tests | `npm run test:workers` passed, 260/260. |
| Static smoke tests | `npm run test:static` passed, 155/155. |
| Release compatibility | `npm run test:release-compat` and `npm run validate:release` passed. |
| Release planning | `npm run test:release-plan` passed. |
| Asset validation | `npm run test:asset-version` and `npm run validate:asset-version` passed. |
| Full preflight | `npm run release:preflight` passed. |
| Dependency reproducibility | Root and Worker `npm ci`, `npm ls --depth=0`, and `npm audit --audit-level=low` passed. |

Commit inclusion checklist:

- [ ] Include all tracked modified files from the working-tree snapshot.
- [ ] Include all untracked files from the working-tree snapshot.
- [ ] Re-run `git status --short` before merge and confirm no Phase 0-A/0-A+ security file is left untracked.
- [ ] Re-run `npm run release:preflight` if any application/config/test file changes after the validation evidence recorded here.

Risks that block merge:

- Untracked files not included in the commit.
- Any regenerated diff that changes application/config behavior without rerunning relevant tests.

Risks that do not block merge but block production deploy:

- Cloudflare `AI_SERVICE_AUTH_SECRET` parity has not been live-verified.
- Cloudflare `SERVICE_AUTH_REPLAY` binding/migration has not been live-verified.
- Staging verification has not been performed.

## Production Deploy Readiness

Production deploy status: FAIL.

This status is intentional. The repository-side implementation and checks pass, but required live Cloudflare state was not verified.

Production deploy is blocked by:

| Blocker | Impact | Required action |
| --- | --- | --- |
| `AI_SERVICE_AUTH_SECRET` not live-verified in `workers/auth` | Auth worker cannot sign internal AI requests; missing/short secret fails closed. | Provision and verify the secret without exposing its value. |
| `AI_SERVICE_AUTH_SECRET` not live-verified in `workers/ai` | AI worker rejects internal AI access when the secret is missing/short. | Provision the same value as auth. |
| Secret parity not live-verified | Mismatched secrets make all signed internal AI calls fail. | Verify values match using a non-printing operational process. |
| `SERVICE_AUTH_REPLAY` not live-verified | AI worker returns safe `503` for internal AI routes when nonce state cannot be accessed. | Deploy and verify the Durable Object binding. |
| `v1-service-auth-replay` not live-verified | Replay DO class may not exist in the target environment. | Apply/deploy the AI worker migration. |
| Staging checks not completed | Production may experience internal AI outage or limiter failure. | Complete staging verification checklist before production. |

Recommended post-deploy verification:

- Call the admin AI model list path through the auth worker and confirm success.
- Confirm AI worker direct unsigned internal route access is rejected.
- Confirm replaying the same signed internal request fails in staging or controlled diagnostics.
- Confirm admin MFA lockout behavior remains intact.
- Confirm rate-limit backend unavailable tests remain represented in CI, not production.
- Confirm logs contain safe reason codes only and no secret/signature/body leakage.

## Files Changed By Purpose

| Purpose | Files | Why they changed |
| --- | --- | --- |
| Service authentication | `js/shared/service-auth.mjs`, `workers/auth/src/lib/admin-ai-proxy.js`, `workers/ai/src/index.js` | Add HMAC signing and verification for Auth-to-AI internal requests. |
| Replay protection | `js/shared/durable-rate-limit-do.mjs`, `workers/ai/src/lib/service-auth-replay.js`, `workers/ai/src/lib/service-auth-replay-do.js`, `workers/ai/wrangler.jsonc` | Add centralized nonce storage and AI Durable Object binding/migration. |
| Worker config validation | `workers/auth/src/lib/config.js`, `workers/auth/src/index.js`, `workers/ai/src/lib/config.js` | Fail closed on missing core auth config, service-auth secret, or AI replay binding. |
| Rate limiting | `workers/auth/src/lib/rate-limit.js`, `workers/auth/src/routes/auth.js`, `workers/auth/src/routes/password.js`, `workers/auth/src/routes/verification.js`, `workers/auth/src/routes/wallet.js`, `workers/auth/src/routes/favorites.js` | Convert priority sensitive auth and favorites paths to fail-closed Durable Object behavior. |
| Admin/MFA security | `workers/auth/src/routes/admin-mfa.js`, `workers/auth/src/routes/admin.js` | Add MFA throttling and fail-closed admin mutation limits. |
| AI/internal route protection | `workers/auth/src/routes/ai/images-write.js`, `workers/auth/src/routes/avatar.js`, `workers/auth/src/lib/admin-ai-proxy.js`, `workers/ai/src/index.js` | Protect expensive internal/member/admin AI and avatar paths before expensive work. |
| Tests | `tests/workers.spec.js`, `tests/helpers/auth-worker-harness.js`, `scripts/test-release-compat.mjs`, `scripts/test-release-plan.mjs` | Add service-auth, nonce replay, fail-closed limiter, MFA, CSRF, config, release fixture, and planner coverage. |
| CI/release tooling | `.github/workflows/static.yml`, `config/release-compat.json`, `scripts/lib/release-plan.mjs`, `workers/ai/package-lock.json` | Add worker package reproducibility checks, release prerequisites, AI replay binding contract, and AI lockfile. |
| Static smoke fixes from Phase 0-A | `index.html`, `js/shared/wallet/wallet-controller.js`, `js/shared/wallet/wallet-ui.js` | Fix the three failing static smoke tests without layout/style rewrites. |
| Documentation | `AUDIT_NEXT_LEVEL.md`, `AUDIT_ACTION_PLAN.md`, `PHASE0_REMEDIATION_REPORT.md`, `workers/auth/CLAUDE.md` | Record audit/remediation evidence and deployment caveats. |

## Validation Evidence

Current Phase 0-A+ validation:

| Command | Result | What it proves |
| --- | --- | --- |
| `npm run test:workers` | PASS, 260/260 | Worker route/security regression tests pass, including HMAC, nonce replay, fail-closed limiters, config validation, MFA throttle/lockout, and CSRF mutation coverage. |
| `npm run test:static` | PASS, 155/155 | Static smoke suite is green, including the previously failing homepage scroll, wallet discovery, and mobile Video swipe-deck behavior. |
| `npm run test:release-compat` | PASS after fixture fix | Release compatibility tests include the new AI `SERVICE_AUTH_REPLAY` binding/migration contract. |
| `npm run test:release-plan` | PASS | Release planner categorizes current changed files and recommends the expected checks/deploy units. |
| `npm run test:asset-version` | PASS | Asset-version tests remain green. |
| `npm run validate:release` | PASS | `config/release-compat.json` validates against current repo state. |
| `npm run validate:asset-version` | PASS | Asset version references validate. |
| `npm run build:static` | PASS | Static site builds to `_site`; observed asset version was `local-20260424222111`. |
| `npm run release:preflight` | PASS | Aggregated release compatibility, release validation, Worker tests, asset tests, asset validation, static tests, and release planning pass. |
| Root `npm ci` | PASS | Root install is reproducible from lockfile. |
| Root `npm ls --depth=0` | PASS | Root dependency tree resolves. |
| Root `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Root package audit has no low-or-higher findings at current lockfile. |
| `workers/auth` `npm ci` | PASS | Auth worker install is reproducible. |
| `workers/auth` `npm ls --depth=0` | PASS | Auth worker dependency tree resolves with `wrangler@4.81.1`. |
| `workers/auth` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Auth worker audit has no low-or-higher findings at current lockfile. |
| `workers/contact` `npm ci` | PASS | Contact worker install is reproducible. |
| `workers/contact` `npm ls --depth=0` | PASS | Contact worker dependency tree resolves with `wrangler@4.76.0`. |
| `workers/contact` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Contact worker audit has no low-or-higher findings at current lockfile. |
| `workers/ai` `npm ci` | PASS | AI worker install is reproducible from the new lockfile. |
| `workers/ai` `npm ls --depth=0` | PASS | AI worker dependency tree resolves with `wrangler@4.85.0`. |
| `workers/ai` `npm audit --audit-level=low` | PASS, 0 vulnerabilities | AI worker audit has no low-or-higher findings at current lockfile. |
| `git diff --check` | PASS | Current diff has no whitespace errors. |
| Documentation recheck: `git diff --check` | PASS | Documentation edit introduced no whitespace errors. |
| Documentation recheck: `npm run test:release-plan` | PASS | Release planner still accepts the current documentation/test/config file classification. |

Intermediate failures and resolution:

| Failure | Cause | Resolution |
| --- | --- | --- |
| Initial Phase 0-A `npm run test:static` | Three real static smoke failures. | Fixed homepage scroll restoration and wallet EIP-6963 discovery state; final static suite passed. |
| `workers/ai` package audit/install before lockfile | No `workers/ai/package-lock.json`. | Generated lockfile with npm and added worker package CI checks. |
| Phase 0-A+ `npm run test:release-compat` | Unit fixture lacked new AI `SERVICE_AUTH_REPLAY` binding/migration. | Updated `scripts/test-release-compat.mjs`; test passed. |
| Earlier sandboxed `npm run release:preflight` | Local sandbox blocked static web server bind with `listen EPERM`. | Reran with approved execution path during Phase 0-A; current Phase 0-A+ `npm run release:preflight` passed. |
| One earlier static favorites full-suite flake | Passed in isolation and passed in later full static/preflight runs. | Monitor as CI flake candidate; not reproduced in final validation. |

Checks not run:

| Check | Reason |
| --- | --- |
| Live Cloudflare secret/binding verification | This workspace cannot verify dashboard/runtime secret values safely. |
| Production deploy | Out of scope; production is explicitly blocked until prerequisites are satisfied. |
| `npm run release:apply` | Production-affecting release command; not appropriate for this review. |
| Remote D1 migrations | Production-affecting; not needed for this documentation-only pass. |
| Markdown lint | No repo markdown lint/check script is defined in `package.json`. |

## Remaining Risks

| Risk | Impact | Blocks merge? | Blocks production deploy? | Next action |
| --- | --- | --- | --- | --- |
| Untracked security/audit files | Merge could omit required helpers, lockfile, config validation, or reports. | Yes | Yes | Track and commit all files listed in Merge Readiness. |
| `AI_SERVICE_AUTH_SECRET` not live-verified in both workers | Internal AI access fails closed or signatures never validate. | No | Yes | Provision matching secrets in `workers/auth` and `workers/ai`; verify without printing values. |
| `SERVICE_AUTH_REPLAY` not live-verified | AI worker rejects internal routes with safe `503` when nonce state is unavailable. | No | Yes | Deploy/verify Durable Object binding and migration in staging. |
| HMAC rollout order can break old auth to new AI | Internal AI outage during partial deploy. | No | Yes | Coordinate rollout; ensure auth signer is deployed before or with AI verifier. |
| MFA lockout was fixed-window only in Phase 0-A+ | Phase 0-B added durable failed-attempt state and reset-on-success behavior. | No | Requires migration 0028 before deploy | See `PHASE0B_REMEDIATION_REPORT.md`. |
| Lower-priority write routes needed review after Phase 0-A+ | Phase 0-B converted additional write routes and added body-size limits. | No | No for merge; staging still required | See `PHASE0B_REMEDIATION_REPORT.md`. |
| Dashboard-managed controls are not repo-enforced | WAF, static security headers, RUM, and some Cloudflare resources can drift. | No | Partially | Phase 0-B added repo-side prereq validation; full IaC/live drift checks remain. |
| No live deployment verification happened | Runtime could differ from local tests/config. | No | Yes | Complete staging checks before production. |
| Static favorites test had one earlier flake | Possible CI instability. | No | No | Monitor and add repeat-on-failure diagnostics if it recurs. |

## Recommended Next Actions

1. Track and commit all untracked security, lockfile, and audit files listed in Merge Readiness.
2. Provision matching `AI_SERVICE_AUTH_SECRET` in both `workers/auth` and `workers/ai`; do not expose the value in logs, CI, docs, shell history, or error messages.
3. Deploy and verify `SERVICE_AUTH_REPLAY` plus `v1-service-auth-replay` in staging before production.
4. Keep `npm run release:preflight` green after any further application/config/test changes; Phase 0-B final preflight passed and is recorded in `PHASE0B_REMEDIATION_REPORT.md`.
5. Apply auth migration `0028_add_admin_mfa_failed_attempts.sql` before auth Worker deploy.
6. Use `PHASE0B_REMEDIATION_REPORT.md` for current body-size, throttling, and MFA state evidence.
7. Verify dashboard-managed WAF/static security headers/RUM controls in staging or move them to IaC.
8. Implement async AI video jobs from `AI_VIDEO_ASYNC_JOB_DESIGN.md` in Phase 1.

## Final Status

| Area | Status | Notes |
| --- | --- | --- |
| Documentation status | PASS | Report now separates merge/deploy readiness and lists operational prerequisites. |
| Phase 0-A+ security review | PASS | HMAC, nonce replay, fail-closed priority limits, MFA throttling, config validation, and CSRF tests are covered for reviewed scope. |
| Merge readiness | CONDITIONAL PASS | Safe to merge only if all tracked and untracked files listed in this report are committed together. |
| Production deploy readiness | FAIL | Blocked until live Cloudflare secrets, secret parity, AI replay Durable Object binding/migration, auth migration 0028, and staging verification are complete. |
| Required secrets | FAIL | `AI_SERVICE_AUTH_SECRET` must exist with matching value in `workers/auth` and `workers/ai`; live verification was not performed. |
| Required bindings | FAIL | `SERVICE_AUTH_REPLAY` and migration `v1-service-auth-replay` must be deployed and verified for `workers/ai`. |
| Test validation | PASS | `test:workers`, `test:static`, release checks, asset checks, package installs, package audits, build, and preflight passed. |
| Remaining blockers | MERGE AND DEPLOY | Untracked Phase 0-B files block merge; Cloudflare provisioning, migration 0028, and staging verification block production deploy. |
| Next recommended phase | Pre-deploy verification, then Phase 1 | Keep validation green, complete Cloudflare staging verification, then implement async video and broader SaaS platform work. |
