# Phase 1-E Route Policy Report

Date: 2026-04-25

Scope: `workers/auth` route policy registry, coverage checks, CI/preflight integration, and documentation updates.

## Executive Summary

Phase 1-E introduces a lightweight route policy registry for high-risk `workers/auth` API routes without replacing the existing manual router. The change makes route security expectations explicit for auth, admin, MFA, CSRF/origin, body-size limits, fail-closed rate limits, required bindings/secrets, audit events, sensitivity, and domain ownership.

This is a registry and guardrail foundation, not a full centralized enforcement framework. Existing route handlers still perform the actual security checks. The new guard prevents new mutating auth-worker dispatch branches from being added without a `route-policy` marker tied to registered metadata, and it validates that high-risk route metadata is internally consistent.

Merge readiness is conditional on committing the full Phase 1-E change set and keeping validation green. Production deploy readiness remains blocked until the normal live Cloudflare secret/binding/migration prerequisites from prior phases are verified.

## Scope

Implemented:

- Added `workers/auth/src/app/route-policy.js` with declarative policy metadata and `getRoutePolicy(method, pathname)`.
- Registered high-risk auth-worker route families first: auth/session, wallet SIWE, profile/avatar, favorites, admin users, admin MFA, admin AI, async video jobs, and member AI writes.
- Added `scripts/check-route-policies.mjs` to validate registry fields, mutating dispatch markers, admin/MFA declarations, body policies, fail-closed high-sensitivity limits, and route matching edge cases.
- Added `ctx.routePolicy` lookup in `workers/auth/src/index.js` for future low-risk instrumentation/enforcement without changing public behavior.
- Added route-policy markers beside existing mutating dispatch branches in auth route dispatch files.
- Integrated `npm run check:route-policies` into package scripts, release planning, release compatibility checks, CI workflow, and targeted JS syntax checks.
- Added Worker test coverage for registry validation and dynamic/literal admin video route matching.

Not implemented:

- No full router rewrite.
- No centralized authorization middleware replacement.
- No RBAC/tenant/org model.
- No production traffic blocking based solely on registry lookup.
- No claim that every auth-worker route is centrally enforced.

## Baseline Before Phase 1-E

Route security policy was scattered across handler files:

- Same-origin mutation protection lived in `workers/auth/src/index.js`.
- Auth/admin/MFA checks lived inside route handlers such as `workers/auth/src/routes/admin.js`, `admin-mfa.js`, and `admin-ai.js`.
- Body-size limits lived near individual request parsers.
- Fail-closed limiter IDs were manually applied route by route.
- Config requirements were validated in helper modules and route-specific code.
- Reviewers had to inspect each handler to know whether a route was authenticated, MFA-gated, CSRF-protected, byte-limited, rate-limited, and audited.

That design worked for the current repository size but created review risk as the SaaS grows.

## Route Inventory Summary

The registry currently contains 99 auth-worker policies after later Phase 1-F through Phase 1-J route additions.

| Route family | Representative paths | Security posture recorded |
| --- | --- | --- |
| Core auth/session | `/api/register`, `/api/login`, `/api/logout`, `/api/me` | Anonymous/user auth policy, same-origin mutations, auth JSON limits, fail-closed auth limits where applicable. |
| Wallet SIWE | `/api/wallet/siwe/nonce`, `/api/wallet/siwe/verify`, `/api/wallet/unlink` | Anonymous SIWE mutations or authenticated unlink, same-origin policy, auth JSON/no-body policy, fail-closed wallet limits. |
| Profile/avatar | `/api/profile`, `/api/profile/avatar` | User auth, same-origin writes, small JSON/avatar multipart limits, private-media config where needed. |
| Favorites | `/api/favorites` | User auth, same-origin add/delete, small JSON body limits, fail-closed write limits. |
| Password/email verification | `/api/forgot-password`, `/api/reset-password`, `/api/resend-verification`, `/api/request-reverification` | Same-origin mutation policy, auth JSON limits, fail-closed public limiter requirements, explicit email-link GET exemption. |
| Admin users/dashboard | `/api/admin/users`, `/api/admin/users/:id/role`, `/status`, `/revoke-sessions`, `/api/admin/stats` | Admin auth, production MFA policy, admin action rate limits for mutations, small/no-body policy, audit events for privileged mutations. |
| Admin MFA | `/api/admin/mfa/*` | Admin auth with bootstrap-aware MFA policy where needed, fail-closed MFA operation limits, small/no-body policies, MFA audit events. |
| Admin AI | `/api/admin/ai/*` | Admin auth, production MFA policy, fail-closed admin AI limits, admin JSON limits, AI service/config requirements, debug gate recorded for `/api/admin/ai/test-video`. |
| Async admin video jobs | `/api/admin/ai/video-jobs`, `/poison`, `/failed`, `/:id`, `/:id/output`, `/:id/poster` | Admin auth, production MFA policy, fail-closed create/status/output/ops limits, queue/R2/AI service config requirements. Literal `poison` and `failed` routes are registered before dynamic `:id` matches. |
| Member AI studio writes | `/api/ai/generate-image`, folders, image/audio save, bulk operations, publication/rename/delete | User auth, same-origin writes, explicit body limit names, fail-closed route-specific write limits. |
| Admin data lifecycle | `/api/admin/data-lifecycle/requests`, `/:id/plan`, `/:id/approve`, `/:id/generate-export`, `/:id/export`, `/:id/execute-safe`, `/exports`, `/exports/:id`, `/exports/cleanup-expired` | Admin auth, production MFA policy, same-origin mutations, fail-closed admin lifecycle limits, lifecycle/archive config requirements, and audit events for privileged lifecycle operations. |

## Registry Design

`workers/auth/src/app/route-policy.js` exports:

- `ROUTE_POLICIES`: frozen policy objects.
- `getRoutePolicy(method, pathname)`: exact/path-pattern lookup used in request context and tests.
- `validateRoutePolicies(policies)`: structural and security consistency validation.

Policy fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable route policy identifier used by source markers and tests. |
| `method` / `path` | HTTP method and literal or `:param` path pattern. |
| `auth` | `anonymous`, `optional-user`, `user`, or `admin`. |
| `mfa` | `none`, `admin-production-required`, or `admin-bootstrap-allowed`. |
| `csrf` | `same-origin-required`, `safe-method`, `exempt-with-reason`, or `not-browser-facing`. |
| `body` | Body parser expectation, max byte limit name, and content type expectation or explicit no-body reason. |
| `rateLimit` | Limiter policy id with `failClosed: true`, or explicit no-limit reason for read-only/exempt routes. |
| `config` | Required bindings/secrets/config categories by name. |
| `audit` | Audit/security event name or explicit no-audit reason. |
| `sensitivity` | `low`, `medium`, or `high`. |
| `owner` | Domain area responsible for the route. |
| `debugGate` | Optional explicit debug/config gate, currently used for the sync video compatibility route. |

The registry intentionally does not replace route handlers yet. It is now available on `ctx.routePolicy` for future low-risk instrumentation or enforcement.

## Checks Added

`scripts/check-route-policies.mjs` validates:

- All registered policies pass `validateRoutePolicies()`.
- Every mutating branch in selected auth-worker dispatcher files has a nearby `// route-policy: <id>` marker.
- Every marker points to a registered policy with the same HTTP method.
- Every registered mutating policy is tied to a source marker.
- Mutating browser-facing policies require same-origin CSRF or are explicitly non-browser-facing.
- Body-parsing policies declare a named max byte limit.
- Admin routes declare admin auth and an MFA policy.
- High-sensitivity route limits are fail-closed when a limiter id is present.
- Debug-gated routes still declare rate limits.
- Literal async-video operation routes such as `/api/admin/ai/video-jobs/poison` and `/failed` resolve before dynamic `/api/admin/ai/video-jobs/:id`.

The check scans:

- `workers/auth/src/index.js`
- `workers/auth/src/routes/admin.js`
- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/routes/admin-mfa.js`
- `workers/auth/src/routes/ai.js`
- `workers/auth/src/routes/favorites.js`

## Routes Deferred

The registry covers high-risk route families first. Deferred or intentionally lower-priority areas:

- Public gallery/video-gallery read routes, because they are read-only public content APIs and lower immediate security risk.
- Some lower-risk read-only admin/media list paths are recorded as metadata but not centrally enforced.
- Non-auth Worker route policy registries for `workers/ai` and `workers/contact` are not implemented in Phase 1-E.
- A full dispatcher-level enforcement wrapper is deferred until route-policy metadata has remained stable.
- API versioning, RBAC, tenant scoping, billing entitlement checks, and org/team policy metadata remain out of scope.

## Files Changed

| File | Purpose |
| --- | --- |
| `workers/auth/src/app/route-policy.js` | New registry, route lookup, and metadata validation. |
| `workers/auth/src/index.js` | Adds `ctx.routePolicy`; adds markers for core auth/profile/avatar/wallet/password/verification mutating dispatch branches. |
| `workers/auth/src/routes/admin.js` | Adds policy markers for admin user mutations. |
| `workers/auth/src/routes/admin-ai.js` | Adds policy markers for admin AI mutations. |
| `workers/auth/src/routes/admin-mfa.js` | Adds policy markers for admin MFA mutations. |
| `workers/auth/src/routes/ai.js` | Adds policy markers for member AI writes. |
| `workers/auth/src/routes/favorites.js` | Adds policy markers for favorites add/remove. |
| `scripts/check-route-policies.mjs` | New static guard for policy registry and route-marker coverage. |
| `package.json` | Adds `check:route-policies`. |
| `scripts/check-js.mjs` | Adds syntax checking for the new route policy script/module. |
| `scripts/lib/release-plan.mjs` | Adds route policy guard to always-recommended release checks. |
| `scripts/lib/release-compat.mjs` | Requires CI workflow to run the route policy guard. |
| `scripts/test-release-plan.mjs` | Updates release planner expectations. |
| `scripts/test-release-compat.mjs` | Updates release compatibility fixture expectations. |
| `.github/workflows/static.yml` | Adds CI step for `npm run check:route-policies`. |
| `tests/workers.spec.js` | Adds registry validation and route resolution tests. |
| `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `workers/auth/CLAUDE.md` | Documentation/status updates. |
| `PHASE1E_ROUTE_POLICY_REPORT.md` | This report. |

## Validation

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:route-policies` | PASS | 99 registered auth-worker policies validated after Phase 1-J route additions. |
| `npm run check:js` | PASS | Targeted syntax guard includes the new script and registry module. |
| `npm run test:release-compat` | PASS | Release compatibility tests accept the new CI check requirement. |
| `npm run test:release-plan` | PASS | Release plan includes route-policy guard in always-recommended checks. |
| `npm run test:workers` | PASS, 301/301 | Worker suite includes the Phase 1-E registry matching test and existing Phase 0/1 security regressions. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI suite remains green; no frontend behavior was changed. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prerequisite tests still pass after release/preflight wiring. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; production BLOCKED | Live Cloudflare validation was skipped, so production deploy remains blocked as intended. |
| `npm run validate:release` | PASS | Release compatibility manifest validates. |
| `npm run build:static` | PASS | Static build succeeds. |
| `npm run release:preflight` | PASS | Aggregate preflight includes route-policy guard, release checks, Cloudflare prereq repo validation, body-parser guard, Worker tests, and release plan. |
| `git diff --check` | PASS | No whitespace errors. |

## Merge Readiness

Status: conditional pass.

This work is merge-ready if all changed/new files listed above are committed together. A partial commit would create false negatives/positives in release planning, CI workflow compatibility, route policy coverage, or documentation.

Untracked files that must be included before merge:

- `PHASE1E_ROUTE_POLICY_REPORT.md`
- `scripts/check-route-policies.mjs`
- `workers/auth/src/app/route-policy.js`

## Production Deploy Readiness

Status: blocked until live Cloudflare prerequisites are verified.

Phase 1-E itself adds no new Cloudflare secrets, bindings, queues, Durable Objects, R2 buckets, or D1 migrations. Production deploy remains blocked by the existing requirements from Phases 0 through 1-D:

- Purpose-specific auth secrets in `workers/auth`.
- Legacy `SESSION_SECRET` present while compatibility fallback is enabled.
- Matching `AI_SERVICE_AUTH_SECRET` in `workers/auth` and `workers/ai`.
- `SERVICE_AUTH_REPLAY` Durable Object binding and migration.
- Auth migrations through `0030`.
- `AI_VIDEO_JOBS_QUEUE` and `USER_IMAGES`.
- `VIDU_API_KEY` if Vidu async jobs are enabled.
- `ALLOW_SYNC_VIDEO_DEBUG` absent/false unless explicitly approved.
- Staging validation of auth, MFA, AI service-auth, async video jobs, R2 output, and legacy secret compatibility.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
| --- | --- | ---: | ---: | --- |
| Registry is not yet central enforcement middleware. | Existing route handlers must still apply checks correctly. | No, if tests/preflight pass. | No new blocker, but route review discipline remains required. | Gradually enforce policy lookup at dispatcher boundaries after metadata stabilizes. |
| Registry coverage is high-risk-first, not every route in every Worker. | Lower-risk public read routes and other Workers do not have equivalent registry coverage. | No. | No. | Extend registry/checking to remaining auth read routes, then AI/contact Workers. |
| Source markers are comments. | Incorrect marker placement could theoretically drift, though the scanner checks method and registered ID. | No, while scanner passes. | No. | Move from marker comments to dispatcher metadata only if/when the router is refactored. |
| No RBAC/tenant policy model. | Enterprise authorization policy remains user/admin scoped. | No. | No. | Phase 2 org/team/tenant work should extend route policies with scopes/permissions. |
| Live Cloudflare state not verified by Phase 1-E. | Production can still fail closed if required prior-phase secrets/bindings are absent. | No. | Yes. | Run staging/live Cloudflare prerequisite validation before deploy. |

## Next Recommended Actions

1. Keep validation green; rerun `npm run release:preflight` after any further application/config/test changes.
2. Commit all Phase 1-E files together after validation passes.
3. Keep `npm run check:route-policies` blocking in CI and release preflight.
4. Extend policy registry coverage to remaining low-risk auth read routes after one stable release.
5. Add route-policy metadata to `workers/ai` and `workers/contact` in a later phase.
6. Evaluate a safe dispatcher-level assertion for mutating routes once the registry has proven stable.
7. Extend policy metadata with future tenant/org/permission fields during the SaaS account model phase.
