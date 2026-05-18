# Phase 1-F Operational Readiness Report

Date: 2026-04-26

## Executive Summary

Phase 1-F adds the first repo-owned operational readiness baseline after the Phase 0 and Phase 1 security hardening work. It does not deploy infrastructure, configure Cloudflare dashboards, or prove backup restore by executing a live drill. It makes the expected operational posture explicit, adds public-safe health probes for Workers that lacked them, adds skipped-by-default live checks, adds SLO and runbook documentation, and adds deterministic CI/preflight checks so these operational artifacts do not disappear.

Merge readiness is conditional on the validation commands in this report passing and all changed files being committed. Production deploy readiness remains blocked until the existing Cloudflare live prerequisite checks, dashboard-managed header/rate-limit controls, and required Worker resources are verified in staging and production.

## Scope

Implemented:

- Public-safe health endpoints for `workers/ai` and `workers/contact`.
- Safe live health and static security-header check scripts with skipped-by-default CI behavior.
- Repo-owned operational readiness document/runbook existence check.
- Operational event taxonomy, SLO/alert baseline, and backup/restore drill plan.
- Critical incident runbooks under `docs/runbooks/`.
- CI/release-preflight integration for deterministic operational readiness checks.

Not implemented:

- Cloudflare alert creation.
- Live dashboard drift enforcement through IaC.
- Production backup or restore execution.
- Load/performance benchmark automation.
- Compliance-grade data export/deletion.

## Operational Inventory

| Area | Current repo evidence | Operational notes |
|---|---|---|
| Static site | `.github/workflows/static.yml`, root HTML/CSS/JS | GitHub Pages deploy only. Worker deploys remain separate. |
| Auth Worker | `workers/auth/src/index.js`, `workers/auth/wrangler.jsonc` | Primary API/admin/media Worker. Existing `GET /api/health` validates core config before route handling. |
| AI Worker | `workers/ai/src/index.js`, `workers/ai/wrangler.jsonc` | Internal AI service Worker with HMAC-protected `/internal/ai/*` routes and `GET /health` health probe added in Phase 1-F. |
| Contact Worker | `workers/contact/src/index.js`, `workers/contact/wrangler.jsonc` | Contact endpoint with fail-closed DO rate limiting and `GET /health` health probe added in Phase 1-F. |
| D1 | `workers/auth/migrations`, `config/release-compat.json` | `bitbi-auth-db`; latest checkpoint `0030_harden_ai_video_jobs_phase1b.sql`. |
| R2 | `PRIVATE_MEDIA`, `USER_IMAGES`, `AUDIT_ARCHIVE` | Declared in auth wrangler and release contract. Restore procedure remains manual/staging-first. |
| Queues | `ACTIVITY_INGEST_QUEUE`, `AI_IMAGE_DERIVATIVES_QUEUE`, `AI_VIDEO_JOBS_QUEUE` | Producers/consumers declared in auth wrangler and release contract. Async video poison persistence exists from Phase 1-B. |
| Durable Objects | `PUBLIC_RATE_LIMITER`, `SERVICE_AUTH_REPLAY` | Auth/contact shared rate limits and AI service-auth replay protection. |
| Cloudflare Images | `IMAGES` binding | Manual prerequisite in release contract. |
| Required secrets | `config/release-compat.json`, `workers/auth/src/lib/config.js`, `workers/ai/src/lib/config.js` | Production deploy remains blocked without live/manual secret verification. Values must never be printed. |

## Health and Readiness

| Worker | Endpoint | Audience | Behavior |
|---|---|---|---|
| Auth | `GET /api/health` | Public-safe uptime/config probe | Returns `200` when core auth config is valid. Missing critical config fails closed with generic `503`. |
| AI | `GET /health` | Public-safe Worker liveness probe | Returns service/status only. Does not expose HMAC secret names, DO names, model config, or provider config. Internal AI routes remain HMAC-protected. |
| Contact | `GET /health` | Public-safe Worker liveness probe | Returns service/status only. Does not require `Origin`, does not expose Resend or rate-limit binding names. |

Deeper readiness for secrets, bindings, D1, R2, queues, DO migrations, and manual Cloudflare prerequisites remains in `npm run validate:cloudflare-prereqs`. The live health scripts do not call authenticated or mutating endpoints.

## Scripts Added

| Script | Purpose | Normal CI behavior |
|---|---|---|
| `npm run test:operational-readiness` | Unit-tests operational readiness helper behavior. | Blocking. |
| `npm run check:operational-readiness` | Verifies required operational docs/runbooks exist. | Blocking. |
| `npm run check:live-health` | Checks configured live health endpoints. | Skips with pass when no URL is configured. |
| `npm run check:live-security-headers` | Checks configured live public static headers. | Skips with pass when no URL is configured. |

Use `--require-live` only for staging/production release verification when URLs are intentionally configured.
`--base-url` and `BITBI_BASE_URL` check only the public/auth origin at `/api/health`.
AI and contact Worker health checks require explicit `--ai-base-url` / `AI_BASE_URL` and `--contact-base-url` / `CONTACT_BASE_URL` values because those Workers may be deployed on separate origins.

## Queue and Backlog Coverage

| Queue | Producer | Consumer | Current recovery signal | Runbook |
|---|---|---|---|---|
| `bitbi-auth-activity-ingest` | Auth admin/activity paths | Auth Worker queue handler | Queue retry rate, consumer failures, backlog age from Cloudflare dashboard | `docs/runbooks/queue-backlog-incident.md` |
| `bitbi-ai-image-derivatives` | Saved asset image save/backfill | Auth Worker queue handler | Derivative retry/failure logs and scheduled recovery logs | `docs/runbooks/queue-backlog-incident.md` |
| `bitbi-ai-video-jobs` | Admin async video create route | Auth Worker queue handler | Job status counts, poison-message rows, queue retry/exhaustion logs | `docs/runbooks/async-video-jobs-incident.md` |

Phase 1-F documents queue backlog signals but does not add a Cloudflare Metrics API integration. Operators must verify backlog/oldest-message signals in Cloudflare until repo-controlled dashboard/drift automation exists.

## Files Changed

| Purpose | Files |
|---|---|
| Health endpoints | `workers/ai/src/index.js`, `workers/contact/src/index.js` |
| Operational scripts | `scripts/lib/operational-readiness.mjs`, `scripts/check-live-health.mjs`, `scripts/check-live-security-headers.mjs`, `scripts/check-operational-readiness.mjs`, `scripts/test-operational-readiness.mjs` |
| CI/preflight | `package.json`, `.github/workflows/static.yml`, `scripts/lib/release-plan.mjs`, `scripts/lib/release-compat.mjs`, `scripts/test-release-plan.mjs`, `scripts/test-release-compat.mjs`, `scripts/check-js.mjs` |
| Tests | `tests/workers.spec.js`, `scripts/test-operational-readiness.mjs` |
| Operational docs | `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md`, `docs/BACKUP_RESTORE_DRILL.md`, `docs/runbooks/*`, this report |
| Audit/action docs | `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `PHASE1_OBSERVABILITY_BASELINE.md` |

### New files that must be tracked before merge

- `PHASE1F_OPERATIONAL_READINESS_REPORT.md`
- `docs/OBSERVABILITY_EVENTS.md`
- `docs/SLO_ALERT_BASELINE.md`
- `docs/BACKUP_RESTORE_DRILL.md`
- `docs/runbooks/auth-worker-incident.md`
- `docs/runbooks/ai-worker-incident.md`
- `docs/runbooks/async-video-jobs-incident.md`
- `docs/runbooks/d1-incident.md`
- `docs/runbooks/r2-media-incident.md`
- `docs/runbooks/queue-backlog-incident.md`
- `docs/runbooks/cloudflare-secret-mismatch.md`
- `docs/runbooks/admin-mfa-lockout.md`
- `docs/runbooks/contact-worker-incident.md`
- `docs/runbooks/release-rollback.md`
- `scripts/check-live-health.mjs`
- `scripts/check-live-security-headers.mjs`
- `scripts/check-operational-readiness.mjs`
- `scripts/lib/operational-readiness.mjs`
- `scripts/test-operational-readiness.mjs`

## Validation Evidence

| Command | Result | Notes |
|---|---:|---|
| `npm run release:preflight` before Phase 1-F changes | PASS | Baseline was green before implementation. |
| `npm run test:workers` | PASS, 303/303 | Covers Worker route/security regressions, including new AI/contact health endpoint tests. |
| `npm run test:static` | PASS, 155/155 after rerun | First review run had one transient homepage carousel failure; the exact failed test and the full static suite both passed on rerun. |
| `npm run test:release-compat` | PASS | Release compatibility tests include new operational CI workflow checks. |
| `npm run test:release-plan` | PASS | Release planner tests include the new operational preflight commands. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq validator tests remain green. |
| `npm run validate:cloudflare-prereqs` | PASS repo config, production BLOCKED | Live Cloudflare validation was skipped, correctly blocking production deploy readiness. |
| `npm run check:toolchain` | PASS | Node/npm toolchain guard remains green. |
| `npm run test:quality-gates` | PASS | Existing quality-gate tests remain green. |
| `npm run check:secrets` | PASS | New docs/scripts do not trigger committed-secret patterns. |
| `npm run check:dom-sinks` | PASS | No new DOM sink baseline drift. |
| `npm run check:route-policies` | PASS | Route policy registry still validates 88 auth-worker policies. |
| `npm run check:js` | PASS | Targeted syntax guard covers new operational scripts. |
| `npm run check:worker-body-parsers` | PASS | Body parser guard remains green. |
| `npm run test:asset-version` | PASS | Asset version tests remain green. |
| `npm run validate:asset-version` | PASS | Asset version validation remains green. |
| `npm run validate:release` | PASS | Release compatibility validation passes. |
| `npm run build:static` | PASS | Static site builds successfully. |
| `npm run test:operational-readiness` | PASS | Unit-tests skipped/live modes, health/header evaluation, URL redaction, and file validation helper behavior. |
| `npm run check:operational-readiness` | PASS | Required operational docs/runbooks exist. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured; normal CI skipped mode works. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No public URL configured; normal CI skipped mode works. |
| `npm run release:preflight` after Phase 1-F changes | PASS | Aggregate preflight ran operational checks, release checks, Cloudflare repo validation, body-parser guard, and Worker tests. |
| `git diff --check` | PASS | No whitespace errors. |

## Staff SRE/Security Pre-Merge Review

Review date: 2026-04-26.

Findings:

- Fixed: `scripts/lib/operational-readiness.mjs` previously applied shared `--base-url` / `BITBI_BASE_URL` to auth, AI, and contact health targets. That could make a single public/static origin incorrectly stand in for separate Worker origins, causing false failures or false confidence. The helper now applies shared/public base URL only to auth `/api/health`; AI and contact require explicit per-service URLs.
- Not found: no production-mutating commands are default runbook actions. Deploy, migration, queue purge, backup/restore, and dashboard changes remain marked approval-required/manual.
- Not found: health endpoints expose only generic service/status fields and do not return secret values, binding names, provider config, queue names, or internal readiness details.
- Not found: normal CI does not require production URLs or Cloudflare credentials. Live checks still skip safely unless URLs are configured or `--require-live` is passed.
- Not found: dashboard-managed security headers are not claimed as repo-enforced. Header checks report optional/dashboard controls as manual verification unless present.
- Observed: one first-pass static smoke failure in `tests/smoke.spec.js` for the homepage category carousel. The exact failed test passed on targeted rerun, and the full `npm run test:static` suite passed afterward; no Phase 1-F code path or test was weakened.

Fixes made during review:

- Tightened live-health target resolution in `scripts/lib/operational-readiness.mjs`.
- Added regression coverage in `scripts/test-operational-readiness.mjs` for shared auth-only URL behavior and explicit AI/contact URLs.
- Updated this report to document the per-service live-check requirement.

## Merge Readiness

Status: PASS for merge, conditional on committing all files in this report.

Merge requires:

- All files in this report committed, including currently untracked Phase 1-F docs/runbooks and operational scripts.
- `npm run release:preflight` passing.
- Worker/static tests passing.
- Operational readiness scripts passing in deterministic mode.
- Documentation accurately stating live Cloudflare checks are not production proof unless run with configured URLs and manual resource verification.

## Production Deploy Readiness

Status: FAIL until live/manual verification is complete.

Required before production deploy:

- Existing Cloudflare secret and binding prerequisites from `config/release-compat.json` live-verified.
- `AI_SERVICE_AUTH_SECRET` matching in auth and AI Workers.
- `SERVICE_AUTH_REPLAY` binding/migration live-verified.
- Purpose-specific auth secrets live-verified in auth Worker.
- `AI_VIDEO_JOBS_QUEUE`, R2 buckets, D1 schema, and DO bindings verified in staging.
- Static security headers and WAF/rate-limit dashboard controls verified manually or through future IaC/drift tooling.
- `npm run check:live-health -- --require-live` run with staging/production URLs. Use `--auth-base-url`, `--ai-base-url`, and `--contact-base-url` or the matching environment variables when validating all Workers.
- `npm run check:live-security-headers -- --require-live` run with staging/production static URL.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
|---|---|---:|---:|---|
| Cloudflare alerts are documented but not repo-created. | Alert drift and missed incident signals remain possible. | No | Yes for fully automated ops posture | Add dashboard/IaC-backed alert verification in a later phase. |
| Restore drill is documented but not executed. | Recovery assumptions remain unproven. | No | Yes for enterprise readiness | Run a staging D1/R2 restore drill and record evidence. |
| Live checks skip by default. | CI remains deterministic but cannot prove production health. | No | Yes unless run manually with URLs | Run with `--require-live` during staging/prod release. |
| Static security headers remain dashboard-managed. | Header drift is possible outside repo review. | No | Yes until manually verified | Move headers into repo-controlled Pages/Worker config or IaC. |
| No automated load/performance baseline yet. | Capacity regressions may not be caught before scale. | No | No for merge, yes for serious scale readiness | Add safe k6/Workers synthetic baselines in Phase 1-G/2. |

## Next Recommended Actions

1. Run and commit all Phase 1-F validation output, especially `npm run release:preflight`.
2. Run live health/header checks against staging with `--require-live`.
3. Configure or verify Cloudflare dashboard alerts for the SLO candidates in `docs/SLO_ALERT_BASELINE.md`.
4. Execute a staging D1/R2 restore drill and record evidence in `docs/BACKUP_RESTORE_DRILL.md` or a dated drill record.
5. Add repo-controlled dashboard drift/IaC verification for WAF, headers, queues, DOs, and alerts.
