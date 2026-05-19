# Production Readiness

Date: 2026-05-19

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

- Pre-deploy expected-state manifest from `npm run release:cutover-evidence` or `npm run release:cutover-evidence:markdown`.
- Release/preflight output.
- Applied migration evidence.
- Worker deploy evidence for affected workers.
- Static Pages deploy evidence if static files changed.
- Secret/binding verification evidence without values.
- Live read-only health/security evidence from `npm run readiness:live-readonly -- --static-url <url> --auth-worker-url <url>` and any explicitly supplied Worker URLs.
- Admin readiness status evidence only when an operator supplies authenticated context safely; absence remains pending.
- Safe canary evidence from `npm run test:live-canary` and, when explicitly enabled by an operator, `npm run validate:live`; live canaries remain read-only/negative unless credentials are intentionally provided.
- R2/D1/Queue/DO/service binding evidence.
- Restore drill and rollback evidence.
- Billing evidence status from `GET /api/admin/billing/evidence/status`, with secret values redacted and `stripeCallsMade:false`.
- Stripe Testmode/live canary evidence where billing is in scope, using `npm run billing:canary-evidence` as the blocked/pending skeleton before any live operator canary.
- Admin/platform budget switch/cap/reconciliation/repair/report/archive evidence where AI cost controls are in scope.
- Fetch Metadata/same-origin CSRF hardening evidence for browser state-changing routes and documented webhook/ingest/link exemptions.
- Tenant asset/manual-review/reset evidence decisions before any ownership/backfill/reset claim.
- Admin mutation guardrail checks from `npm run check:route-policies`, including high-risk route notes for MFA, same-origin/Fetch Metadata coverage, fail-closed rate limits, confirmation/idempotency rationale, and audit logging.
- Data lifecycle guardrail evidence from `npm run check:data-lifecycle`: lifecycle approve/export/archive cleanup require `Idempotency-Key` plus `confirm=true`, and `execute-safe` requires `confirm=true` before `dryRun:false`.

## Admin Readiness Dashboard

The Admin Control Plane includes a Readiness & Evidence dashboard at `/admin/#readiness`, backed by read-only `GET /api/admin/readiness/status` when the current Auth Worker is deployed. It shows blocked claims, release checkpoint labels, safety gates, evidence status, safe exports, and copy-only local commands. It does not run shell commands, enable reset execution, execute reset/delete, backfill ownership, switch access checks, call Stripe/providers/Cloudflare APIs, apply migrations, deploy, or prove live readiness.

The Billing Events area includes a Billing Evidence Center backed by read-only `GET /api/admin/billing/evidence/status`. It reports live billing prerequisite presence/shape, static credit-pack catalog facts, BITBI Pro subscription metadata, webhook readiness facts, and blocked canary evidence without showing Stripe secrets, raw payloads, signatures, webhook secrets, checkout sessions, refunds, subscription mutations, or credit mutations.

The dashboard now includes a Live Evidence State panel. It distinguishes repo-supported controls from deploy-pending and live-evidence-pending state, links operators to the cutover evidence command, and keeps all commands copy-only.

## Release Cutover Evidence

Use this before deployment to snapshot expected repository state without deploying:

```bash
npm run release:cutover-evidence
npm run release:cutover-evidence:markdown
```

The manifest includes timestamp, branch, commit SHA, dirty-worktree classification, latest auth migration, deploy units from `release:plan`, expected deploy order, Auth/AI rollout warnings, blocked claims, operator checklist, and rollback placeholders. Dirty worktrees are marked as local planning evidence unless cleaned before actual cutover evidence.

Use this after deployment only for explicit live-read-only checks:

```bash
npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai
```

Add `--ai-worker-url`, `--contact-worker-url`, or `--admin-readiness-url` only when the operator intends those read-only checks. The admin readiness check is skipped unless `BITBI_READINESS_ADMIN_COOKIE` is supplied in the environment; cookie values are not printed.

## Current Blockers

- Live/manual Cloudflare validation is not recorded in repo.
- Live billing canaries remain incomplete. Checkout creation does not grant credits; verified webhook/payment/invoice events are required. Refund, dispute, and payment-failure handling remains review-only unless a later approved workflow explicitly changes that.
- Stripe dashboard configuration, live webhook receipt, duplicate-event idempotency, wrong Price ID rejection, missing-webhook-secret fail-closed behavior, and no-raw-payload/signature rendering still require operator evidence before live billing readiness can be claimed.
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
npm run test:release-cutover-evidence
npm run test:main-release-readiness
npm run billing:canary-evidence
npm run release:cutover-evidence
npm run release:plan
npm run release:preflight
```

These commands are repository/local checks. They do not prove live production readiness without operator evidence.

## Current Baseline

Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the starting point for any future production-readiness audit.
