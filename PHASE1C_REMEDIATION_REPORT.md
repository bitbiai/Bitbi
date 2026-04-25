# Phase 1-C Remediation Report

Date: 2026-04-25

## Executive Summary

Phase 1-C operationalizes the async admin video path delivered in Phase 1-B and adds low-risk engineering guardrails. The legacy synchronous admin video route still exists for emergency/debug compatibility, but it is no longer default-accessible: server-side access now requires the explicit `ALLOW_SYNC_VIDEO_DEBUG=true` config flag, and the normal admin UI continues to use async video jobs.

Risk reduced:

- Long synchronous video generation is no longer reachable by default through `/api/admin/ai/test-video`.
- Admin/support operators can inspect sanitized async-video poison messages and failed jobs through admin-only APIs.
- Release/preflight and CI now include low-risk checks for toolchain pinning, obvious committed secrets, new unreviewed DOM sinks, targeted JS syntax, and unsafe Worker body parser calls.

Still not solved:

- This is not a full TypeScript/checkJs migration.
- The DOM sink gate is count-baseline based; it prevents new unreviewed sinks but does not prove every legacy sink is XSS-safe.
- Cloudflare WAF/static-header/RUM controls are still not fully repo-enforced.
- There is no full admin UI for poison-message triage; Phase 1-C adds API-level operational tooling.
- Org/tenant/billing/compliance are still out of scope.

## Scope

Implemented:

- Default-disabled sync video debug route.
- Admin-only poison-message and failed-video-job inspection APIs.
- Release compatibility route contract updates for debug-only and ops routes.
- Toolchain pinning through `.nvmrc` and `package.json` engines.
- Quality gates and tests for secret scanning, DOM sink baseline, targeted JS syntax, toolchain consistency, and Worker body parser safety.
- CI/preflight integration for stable checks.

Not implemented:

- Removing the sync route entirely.
- Broad frontend/admin UI refactor.
- Full lint/typecheck migration.
- Cloudflare IaC or production deploy.

## Baseline Before Phase 1-C

Phase 1-B made async video production-usable, but:

- `/api/admin/ai/test-video` remained an admin-accessible synchronous compatibility route.
- `ai_video_job_poison_messages` existed, but operators had no admin API to inspect it.
- Quality gates were limited, with no repo-local secret scan, DOM sink guard, JS syntax gate, or toolchain pin.
- Release preflight did not run the new quality gates.

## Sync Route Restriction

Decision: keep the route as an emergency/debug fallback, but default-deny it.

Behavior now:

- `/api/admin/ai/test-video` returns `404 not_found` unless `ALLOW_SYNC_VIDEO_DEBUG=true`.
- When enabled, the route still requires admin auth and the central production MFA boundary.
- Same-origin checks remain enforced centrally for the POST mutation.
- `rateLimitAdminAi()` remains fail-closed before body parsing and provider work.
- The route logs a safe warning event when blocked or used; it does not log prompts, frame inputs, request bodies, secrets, signatures, or provider credentials.
- The admin UI only calls the route when `window.__BITBI_ADMIN_AI_SYNC_VIDEO_DEBUG === true`; default UI flow uses `/api/admin/ai/video-jobs`.

Relevant files:

- `workers/auth/src/routes/admin-ai.js`
- `js/pages/admin/ai-lab.js`
- `tests/workers.spec.js`
- `tests/auth-admin.spec.js`
- `config/release-compat.json`

## Poison And Failed-Job Inspection

Phase 1-C adds API-only operational tooling:

- `GET /api/admin/ai/video-jobs/poison`
- `GET /api/admin/ai/video-jobs/poison/:id`
- `GET /api/admin/ai/video-jobs/failed`
- `GET /api/admin/ai/video-jobs/failed/:id`

Security behavior:

- Admin-only through existing `requireAdmin()` and MFA policy.
- Fail-closed rate limiting through `rateLimitAdminAi()`.
- Safe pagination with bounded `limit` and cursor support.
- Poison responses include redacted `bodySummary`, reason code, queue name, schema version, job id when parseable, correlation id, and timestamp.
- Failed-job diagnostics include provider/model/status, owner id/email, attempts, safe error code/message, and booleans for provider task/output/poster presence.
- Responses do not expose prompts, raw `input_json`, provider raw payloads, provider state blobs, R2 keys, signatures, secrets, request bodies, or stack traces.

UI status:

- No new admin UI was added in Phase 1-C. The API gives staff/support tooling a stable backend surface first; a small UI can be added later without changing the data contract.

## Quality Gates Added

| Gate | Script | Behavior |
|---|---|---|
| Toolchain pinning | `npm run check:toolchain` | Verifies `.nvmrc`, `package.json` engines, and GitHub Actions Node 20 configuration. |
| Scanner tests | `npm run test:quality-gates` | Tests secret scanner, DOM sink baseline scanner, and toolchain validator behavior. |
| Secret leakage | `npm run check:secrets` | Scans repo text files for obvious private keys, provider keys, bearer tokens, and generic high-entropy secret assignments with safe placeholder allowances. |
| DOM sink baseline | `npm run check:dom-sinks` | Blocks new unreviewed `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `document.write` usage above `config/dom-sink-baseline.json`. |
| Targeted JS syntax | `npm run check:js` | Runs `node --check` over scripts plus high-risk/new Worker/admin/shared modules. |
| Worker body parsers | `npm run check:worker-body-parsers` | Existing Phase 1-A gate remains in preflight and blocks direct Worker `request.json()`, `formData()`, `text()`, or `arrayBuffer()` calls. |

Limitations:

- `check:js` is syntax-only, not TypeScript or full semantic checkJs.
- The DOM baseline is a pragmatic guardrail, not proof that legacy sinks are safe.
- The secret scanner is conservative and pattern-based; it complements, but does not replace, provider-side secret scanning.

## CI And Preflight Integration

Updated:

- `package.json`
- `.github/workflows/static.yml`
- `scripts/lib/release-plan.mjs`
- `scripts/lib/release-compat.mjs`
- `scripts/test-release-plan.mjs`
- `scripts/test-release-compat.mjs`

`npm run release:preflight` now includes the stable quality gates through the release planner:

- `npm run check:toolchain`
- `npm run test:quality-gates`
- `npm run check:secrets`
- `npm run check:dom-sinks`
- `npm run check:js`
- existing release, Cloudflare prereq, body parser, Worker, asset, and static checks as applicable

The static GitHub Pages workflow now runs these quality gates in the `release-compatibility` job before deploy jobs.

## Files Changed

| Area | Files |
|---|---|
| Sync route restriction | `workers/auth/src/routes/admin-ai.js`, `tests/workers.spec.js`, `workers/auth/CLAUDE.md`, `config/release-compat.json` |
| Poison/failed-job inspection | `workers/auth/src/lib/ai-video-jobs.js`, `workers/auth/src/routes/admin-ai.js`, `js/shared/auth-api.js`, `tests/helpers/auth-worker-harness.js`, `tests/workers.spec.js` |
| Quality gates | `.nvmrc`, `package.json`, `package-lock.json`, `config/dom-sink-baseline.json`, `scripts/check-toolchain.mjs`, `scripts/check-secrets.mjs`, `scripts/check-dom-sinks.mjs`, `scripts/check-js.mjs`, `scripts/lib/quality-gates.mjs`, `scripts/test-quality-gates.mjs` |
| CI/release tooling | `.github/workflows/static.yml`, `scripts/lib/release-plan.mjs`, `scripts/lib/release-compat.mjs`, `scripts/test-release-plan.mjs`, `scripts/test-release-compat.mjs` |
| Static preflight stabilization | `tests/smoke.spec.js` |
| Docs | `PHASE1C_REMEDIATION_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `PHASE1B_REMEDIATION_REPORT.md`, `PHASE1_OBSERVABILITY_BASELINE.md` |

## Tests Added Or Updated

Worker tests:

- Default sync video route rejects when `ALLOW_SYNC_VIDEO_DEBUG` is absent.
- Explicit debug flag allows admin-only sync video use.
- Non-admin sync route access is rejected.
- Foreign-origin sync route mutation is rejected before provider work.
- Missing limiter backend fails closed for the sync debug route.
- Admin can list/view sanitized video poison messages.
- Non-admin cannot list poison messages.
- Admin can list/view sanitized failed video job diagnostics.
- Operational responses do not include raw prompt, request payload, provider state, or R2 key data.
- Missing limiter backend fails closed for video ops inspection.

Quality gate tests:

- Secret scanner detects a provider-key-shaped fixture.
- Secret scanner ignores safe secret-name placeholders.
- DOM scanner allows reviewed baseline sinks and rejects new unreviewed sinks.
- Toolchain validator accepts the expected Node/npm/workflow pinning files.

Static/admin UI:

- Existing Phase 1-B admin UI tests continue to cover default async video flow and no default `/api/admin/ai/test-video` call.
- The mobile footer contact drawer smoke test now waits for the drawer's visible open transition before clicking to close. This does not weaken the assertion; it keeps the same collapsed-state checks while removing a preflight-only actionability race observed under the full release preflight load.

## Commands Run And Results

| Command | Result | Notes |
|---|---:|---|
| `npm run check:toolchain` | PASS | Toolchain files are pinned to Node 20/npm 10+ expectations. |
| `npm run test:quality-gates` | PASS | Scanner/validator unit coverage passed. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns found. |
| `npm run check:dom-sinks` | PASS | No new unreviewed DOM sinks above baseline. |
| `npm run check:js` | PASS | Targeted syntax checks passed. |
| `npm run test:workers -- --grep "legacy sync video debug route\|admin video operations"` | PASS, 4/4 | Targeted Worker coverage for Phase 1-C behavior passed. |
| `npm run test:release-compat` | PASS | Release compatibility tests passed after route/check updates. |
| `npm run test:release-plan` | PASS | Release planner tests passed after adding new preflight checks. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prerequisite validator tests passed. |
| `npm run validate:cloudflare-prereqs` | PASS repo config, production BLOCKED | Repo config is valid; live Cloudflare validation was skipped, so production deploy is still blocked. |
| `npm run check:worker-body-parsers` | PASS | Worker body parser guard passed. |
| `npm run test:asset-version` | PASS | Asset version tests passed. |
| `npm run validate:asset-version` | PASS | Asset version validation passed. |
| `npm run validate:release` | PASS | Release compatibility validation passed. |
| `npm run build:static` | PASS | Static build completed. |
| `npm run test:workers` | PASS, 289/289 | Full Worker route/security suite passed. |
| `npm run test:static` | PASS, 155/155 | Full static/admin UI suite passed. |
| `npx playwright test tests/smoke.spec.js --grep "footer contact drawer stays collapsed by default on mobile" --repeat-each=5` | PASS, 5/5 | Reproduced and stabilized the preflight-only mobile drawer actionability race. |
| `npm run release:preflight` | PASS | Full release preflight passed after the mobile drawer deterministic wait was added. |
| `npm ci` | PASS with EBADENGINE warning | Dependencies install reproducibly; warning is expected because this local shell runs Node `v24.14.0` while Phase 1-C pins project/CI expectations to Node 20. |
| `npm ls --depth=0` | PASS | Root package tree resolves to `@playwright/test`, `serve`, and `viem`. |
| `npm audit --audit-level=low` | PASS | Root audit found 0 vulnerabilities. |
| `git diff --check` | PASS | No whitespace errors in the final diff. |

## Merge Readiness

Current status: conditional pass.

Merge is safe only if all Phase 1-C changed and new files are committed together. Do not merge only the API changes without the release compatibility, tests, quality-gate scripts, smoke-test stabilization, and documentation updates.

## Production Deploy Readiness

Current status: not production-deploy-ready from this code pass alone.

Production remains blocked until live Cloudflare prerequisites and staging checks pass:

- Matching `AI_SERVICE_AUTH_SECRET` exists in both auth and AI workers.
- `SERVICE_AUTH_REPLAY` Durable Object binding/migration exists.
- Auth D1 migrations through `0030_harden_ai_video_jobs_phase1b.sql` are applied.
- `AI_VIDEO_JOBS_QUEUE` exists and is bound.
- `USER_IMAGES` R2 binding exists and accepts video/poster objects.
- `VIDU_API_KEY` is provisioned in the AI worker if Vidu async jobs are enabled.
- Staging verifies async video create, provider pending, provider success, R2 output/poster read, poison-message inspection, and failed-job inspection.

`ALLOW_SYNC_VIDEO_DEBUG` should remain absent/false in production except during controlled emergency debugging. Enabling it reopens the long synchronous path for admins and should require an explicit incident/change record.

## Rollback Plan

- If the ops endpoints misbehave, remove their use from support tooling; they are read-only and do not affect queue processing.
- If a quality gate false-positive blocks CI, fix the scanner or baseline in a dedicated review rather than bypassing the workflow.
- If async video has a staging incident, keep `ALLOW_SYNC_VIDEO_DEBUG` disabled by default and use it only as a controlled temporary debug flag.
- No new D1 migration is added in Phase 1-C.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
|---|---|---:|---:|---|
| Sync route still exists behind debug flag | Admins can re-enable long synchronous provider work if the flag is set. | No | No, if disabled in production | Keep disabled by default; retire route after confidence window. |
| Poison tooling is API-only | Operators need API/client tooling to inspect rows. | No | No | Add small admin/support UI in Phase 1-D if useful. |
| DOM gate is baseline-count based | Existing sinks remain and same-count rewrites may not be caught. | No | No | Replace risky legacy sinks incrementally and adopt stronger lint rules. |
| No full checkJs/typecheck | Semantic JS drift still possible. | No | No | Introduce TypeScript `checkJs` or ESLint/Biome incrementally. |
| Dashboard controls not IaC-managed | WAF/header/RUM drift remains possible. | No | Yes until live verification | Add Cloudflare API drift checks or IaC. |

## Next Recommended Actions

1. Commit all Phase 1-C files together.
2. Verify in staging that `/api/admin/ai/test-video` is disabled without `ALLOW_SYNC_VIDEO_DEBUG`.
3. Keep `ALLOW_SYNC_VIDEO_DEBUG` absent/false in production unless there is an explicit incident/debug change record.
4. Add a small admin/support UI for poison and failed-job APIs if operators need browser-based access.
5. Plan Phase 1-D for retiring the sync route, expanding checkJs/lint coverage, and moving dashboard controls toward IaC/drift checks.
