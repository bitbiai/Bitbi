# Production Readiness

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: current production-readiness gate. This file is not a phase history and does not approve deployment.

## Current Verdict

Production readiness: BLOCKED.

Live billing readiness: BLOCKED.

Tenant isolation: NOT CLAIMED.

Confirmed legacy media reset readiness: BLOCKED.

## Current Release Preconditions

- Verify repository release plan with `npm run release:plan`.
- Run `npm run release:preflight` before merge/release-sensitive work.
- Apply required remote auth D1 migrations before dependent Auth Worker deploys.
- Keep Auth/AI caller-policy changes paired: `config/release-compat.json` models the AI Worker before Auth Worker order for provider-cost internal AI route compatibility.
- Verify Worker secrets and bindings without printing values.
- Verify Cloudflare D1, R2, Queues, Durable Objects, Images, service bindings, dashboard WAF/static headers/RUM, alerts, and routes.
- Verify static Pages deploy requirements separately from Worker deploys.

## Current Migration Preconditions

Latest auth migration: `0058_add_legacy_media_reset_actions.sql`.

Important current dependencies:

- `0056_add_ai_folder_image_ownership_metadata.sql` for folder/image ownership metadata.
- `0057_add_ai_asset_manual_review_state.sql` for manual-review queue/status tables.
- `0058_add_legacy_media_reset_actions.sql` for reset action/event tracking.

If Auth Worker code uses these tables/columns, remote migrations must be applied before deploying that Worker code.

## Current Evidence Required

- Release/preflight output.
- Applied migration evidence.
- Worker deploy evidence for affected workers.
- Static Pages deploy evidence if static files changed.
- Secret/binding verification evidence without values.
- Live health check evidence.
- Security header evidence.
- Safe canary evidence from `npm run test:live-canary` and, when explicitly enabled by an operator, `npm run validate:live`; live canaries remain read-only/negative unless credentials are intentionally provided.
- R2/D1/Queue/DO/service binding evidence.
- Restore drill and rollback evidence.
- Stripe Testmode/live canary evidence where billing is in scope.
- Admin/platform budget switch/cap/reconciliation/repair/report/archive evidence where AI cost controls are in scope.
- Fetch Metadata/same-origin CSRF hardening evidence for browser state-changing routes and documented webhook/ingest/link exemptions.
- Tenant asset/manual-review/reset evidence decisions before any ownership/backfill/reset claim.
- Admin mutation guardrail checks from `npm run check:route-policies`, including high-risk route notes for MFA, same-origin/Fetch Metadata coverage, fail-closed rate limits, confirmation/idempotency rationale, and audit logging.
- Data lifecycle guardrail evidence from `npm run check:data-lifecycle`: lifecycle approve/export/archive cleanup require `Idempotency-Key` plus `confirm=true`, and `execute-safe` requires `confirm=true` before `dryRun:false`.

## Current Blockers

- Live/manual Cloudflare validation is not recorded in repo.
- Live billing canaries and remediation/legal/accounting workflows remain incomplete.
- Internal AI Worker caller policy is enforced for provider-cost routes, but live provider/cap/operator evidence is still required before readiness claims.
- Canary/readiness tooling includes local-only safety contract checks and skipped-by-default live checks; missing live URLs or credentials must remain pending/blocked, not treated as success.
- Tenant ownership backfill and access-switch readiness are blocked.
- Legacy media reset dry-run evidence is rejected unsafe until sanitized evidence is provided. No sanitized replacement is currently accepted. Confirmed reset execution is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved confirmation phase.
- Production readiness cannot be claimed from local tests alone.

## Safe Validation Commands

```bash
npm run check:js
npm run check:secrets
npm run test:doc-currentness
npm run check:doc-currentness
npm run check:route-policies
npm run check:data-lifecycle
npm run check:admin-activity-query-shape
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:live-canary
npm run test:readiness-evidence
npm run test:main-release-readiness
npm run release:plan
npm run release:preflight
```

These commands are repository/local checks. They do not prove live production readiness without operator evidence.

## Current Baseline

Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the starting point for any future production-readiness audit.
