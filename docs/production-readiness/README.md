# Production Readiness

Date: 2026-05-21

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

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
- Treat `homepage-ffmpeg-processor` as a separate non-static deploy unit when `npm run release:plan` reports service changes; Static Pages does not deploy it.
- Verify Worker secrets and bindings without printing values.
- Verify Cloudflare D1, R2, Queues, Durable Objects, Images, service bindings, dashboard WAF/static headers/RUM, alerts, and routes.
- Verify static Pages deploy requirements separately from Worker deploys.
- Static Pages push runs skip, rather than deploy, when the release plan requires migrations, Workers, processor services, or other classified non-static dependencies first; uncategorized files and malformed plans still fail closed.

## Current Migration Preconditions

Latest auth migration: read `release.schemaCheckpoints.auth.latest` from `config/release-compat.json`.

Important current dependencies:

- `0056_add_ai_folder_image_ownership_metadata.sql` for folder/image ownership metadata.
- `0057_add_ai_asset_manual_review_state.sql` for manual-review queue/status tables.
- `0058_add_legacy_media_reset_actions.sql` for reset action/event tracking.
- `0059_add_data_lifecycle_completion_state.sql` for Data Lifecycle final completion, evidence status, retained-category, close/reject, and completion-note metadata.
- `0060_add_app_settings.sql` for the Admin registration availability switch.
- `0061_add_homepage_hero_video_slots.sql` for Admin-managed public homepage hero video slots and optimized derivative job metadata.
- `0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql` for signed homepage hero external_ffmpeg processing, private Admin hero-source uploads, and Memvid Cloudflare Stream hover-preview metadata/telemetry.
- Later migrations are listed by the release contract; do not duplicate future current-latest migration filenames here.

If Auth Worker code uses these tables/columns, remote migrations must be applied before deploying that Worker code.

## Current Evidence Required

- Release Candidate Go/No-Go manifest from `npm run release:rc` or `npm run release:rc:markdown`. This is a local handoff packet for code-merge/deploy preparation only; it does not claim production readiness.
- Final RC validation matrix from `npm run rc:check`. By default it prints the exact local command matrix and does not run deploys, remote migrations, live checks, or secret-dependent commands.
- Pre-deploy expected-state manifest from `npm run release:cutover-evidence` or `npm run release:cutover-evidence:markdown`.
- Production readiness dossier from `npm run readiness:dossier` or `npm run readiness:dossier:markdown`; this is a local evidence packet and keeps production readiness blocked by default.
- Cloudflare resource prerequisite model from `npm run cloudflare:resource-model` or `npm run cloudflare:resource-model:markdown`; repo-declared resources are not live Cloudflare proof.
- Rollback drill artifact from `npm run release:rollback-drill`; this records placeholders and smoke checks only and does not execute rollback.
- Operator-owned live evidence package templates under `docs/production-readiness/evidence/operator-live-evidence-*/`; these are redaction-first templates only and must not contain raw live secrets, cookies, Stripe signatures, raw idempotency keys, private object keys, or private media URLs.
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
- Live Billing Command Center status from `GET /api/admin/billing/live-readiness/status`, with bounded local D1 billing summaries, redacted config facts, Customer Portal/tax evidence status, and no Stripe calls or mutations.
- Stripe Testmode/live canary evidence where billing is in scope, using `npm run billing:canary-evidence` or `node scripts/billing-canary-evidence.mjs --format json|markdown --output docs/production-readiness/evidence/<file>` as the blocked/pending skeleton before any live operator canary.
- Operator timeline/triage evidence from `GET /api/admin/operations/timeline`, with bounded redacted local D1 metadata only and no external calls, R2 listing, or mutations.
- Evidence archive/index coverage from `npm run evidence:index` or `npm run evidence:index:markdown`; unsafe markers must remain classified, not pasted into readiness evidence.
- Admin/platform budget switch/cap/reconciliation/repair/report/archive evidence where AI cost controls are in scope.
- Fetch Metadata/same-origin CSRF hardening evidence for browser state-changing routes and documented webhook/ingest/link exemptions.
- Fresh post-cleanup tenant asset/manual-review/reset evidence decisions before any ownership/backfill/access-switch/reset claim. Pre-cleanup counts are historical after the operator manually deleted most old images/videos.
- Admin mutation guardrail checks from `npm run check:route-policies`, including high-risk route notes for MFA, same-origin/Fetch Metadata coverage, fail-closed rate limits, confirmation/idempotency rationale, and audit logging.
- Data lifecycle guardrail evidence from `npm run check:data-lifecycle`: lifecycle approve/export/archive cleanup require `Idempotency-Key` plus `confirm=true`, and `execute-safe` requires `confirm=true` before `dryRun:false`.

## Admin Readiness Dashboard

The Admin Control Plane includes a Readiness & Evidence dashboard at `/admin/#readiness`, backed by read-only `GET /api/admin/readiness/status` when the current Auth Worker is deployed. It shows blocked claims, release checkpoint labels, safety gates, evidence status, safe exports, and copy-only local commands. It does not run shell commands, enable reset execution, execute reset/delete, backfill ownership, switch access checks, call Stripe/providers/Cloudflare APIs, apply migrations, deploy, or prove live readiness.

The Admin Users delete dialog has two guarded modes: operational delete only, and operational delete plus Data Erasure/GDPR workflow initiation. The workflow option creates a dry-run, approval-required Data Lifecycle delete request for privacy/legal review before operational deletion; it does not immediately complete legal erasure or automatically destroy billing, audit, provider, legal, or compliance records.

The Data Lifecycle area includes a request detail overlay for reviewing Data Erasure/export/anonymization workflows. It can open request details, generate a plan, approve eligible planned requests, execute only backend-supported safe actions, record guarded final completion/close/reject state where eligible, and export sanitized evidence as JSON, Markdown, or printable HTML for browser Save as PDF. Completion states distinguish `completed`, `completed_with_retention`, `rejected`, `closed`, and `blocked_requires_legal_review`; evidence packets document lifecycle state and are not legal advice or production-readiness proof.

The Billing Events area includes a Billing Evidence Center backed by read-only `GET /api/admin/billing/evidence/status`. It reports live billing prerequisite presence/shape, static credit-pack catalog facts, BITBI Pro subscription metadata, webhook readiness facts, and blocked canary evidence without showing Stripe secrets, raw payloads, signatures, webhook secrets, checkout sessions, refunds, subscription mutations, or credit mutations.

The Admin Finance navigation also includes a Live Billing Command Center backed by read-only `GET /api/admin/billing/live-readiness/status`. It aggregates redacted configuration presence, public catalog facts, webhook/reconciliation/review summaries, Customer Portal readiness, optional Stripe Tax/invoice flags, evidence checklist rows, a blocked final verdict, a short operator next-action path, and copy/download-only operator aids. Repository support can be ready for an operator canary while production readiness and live billing readiness stay blocked. It does not activate live payments, call Stripe, create checkout sessions, issue refunds, mutate credits, mutate subscriptions, resolve reviews, deploy, apply migrations, or edit Cloudflare/Stripe settings.

The Operations area includes Operator Timeline / Triage backed by read-only `GET /api/admin/operations/timeline`. It normalizes recent admin audit/activity, billing review/reconciliation, AI budget, lifecycle, tenant review/reset, readiness, and archive metadata into bounded redacted event summaries. It does not call Stripe/providers, list R2, mutate D1/R2/Queues, issue refunds, create checkout sessions, mutate subscriptions, mutate credits, deploy, migrate, backfill ownership, switch access checks, or execute reset.

The dashboard now includes a Live Evidence State panel. It distinguishes repo-supported controls from deploy-pending and live-evidence-pending state, links operators to the cutover evidence command, and keeps all commands copy-only.

The dashboard also includes a Production Execution Framework panel. It surfaces repo-supported/deploy-pending/live-evidence-pending state, the Cloudflare resource model, the readiness dossier, post-deploy read-only verification, and rollback drill commands. These are copy-only operator aids; the browser does not deploy, run migrations, mutate Cloudflare, execute rollback, activate live billing, call providers, backfill ownership, switch tenant access checks, or enable reset execution.

The dashboard also includes a Release Candidate / Go-No-Go panel. It shows RC status, CI unknown/pending state, a local validation matrix, copy-only RC commands, and a Go/No-Go checklist. It does not execute commands in the browser and does not offer deploy, migration, rollback, live billing, reset, backfill, access-switch, Stripe, provider, or Cloudflare mutation actions.

## Release Candidate Framework

Use the local RC framework before merge or cutover review:

```bash
npm run rc:check
npm run release:rc
npm run release:rc:markdown
```

`rc:check` is plan-only by default and prints the final local validation matrix. The RC manifest composes git state, release plan, latest migration checkpoint, Cloudflare resource model, readiness dossier, evidence index triage, blocked claims, remaining evidence blockers, rollback drill data, and operator next actions. Its Go/No-Go model allows code-merge/deploy preparation only when checks and review permit; production readiness and live billing readiness remain blocked.

## Production Readiness Execution Framework

Use this local-only framework before deployment:

```bash
npm run readiness:dossier
npm run readiness:dossier:markdown
npm run cloudflare:resource-model
npm run cloudflare:resource-model:markdown
npm run release:rollback-drill
```

The dossier combines release plan, deploy order, latest migration checkpoint, Cloudflare resource model summary, evidence index counts, cutover evidence summary, billing and tenant blockers, rollback placeholders, and a final blocked verdict. The Cloudflare model validates repo declarations against `config/release-compat.json` and Wrangler config, then marks secrets, dashboard settings, custom domains, WAF/rate limits, security headers, RUM, alerts, and live resource presence as operator live-verification-required. The rollback drill records previous-version placeholders and post-rollback smoke checks only; it does not call Cloudflare or GitHub and does not roll anything back.

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

Add `--ai-worker-url`, `--contact-worker-url`, or `--admin-readiness-url` only when the operator intends those read-only checks. The post-deploy path is opt-in and GET-only by default for live runtime evidence. Admin readiness, billing evidence, operations timeline, and tenant domain evidence checks remain skipped/pending unless `BITBI_READINESS_ADMIN_COOKIE` is supplied in the environment; cookie values are not printed.

## Current Blockers

- Live/manual Cloudflare validation is not recorded in repo.
- Live billing canaries remain incomplete. Checkout creation does not grant credits; verified webhook/payment/invoice events are required. Refund, dispute, and payment-failure handling remains review-only unless a later approved workflow explicitly changes that.
- Stripe dashboard configuration, Customer Portal setup, live webhook receipt, duplicate-event idempotency, wrong Price ID rejection, missing-webhook-secret fail-closed behavior, no-credit-before-webhook, invoice.paid subscription top-up, refund/dispute review-only behavior, optional tax/invoice review, and no-raw-payload/signature rendering still require operator evidence before live billing readiness can be claimed.
- Internal AI Worker caller policy is enforced for provider-cost routes, but live provider/cap/operator evidence is still required before readiness claims.
- Canary/readiness tooling includes local-only safety contract checks and skipped-by-default live checks; missing live URLs or credentials must remain pending/blocked, not treated as success.
- Tenant ownership backfill and access-switch readiness are blocked; current post-cleanup evidence is pending.
- Legacy media reset dry-run evidence is rejected unsafe until sanitized evidence is provided, and old reset candidate counts are stale after manual media cleanup. No sanitized replacement is currently accepted. Confirmed reset execution is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved operator change.
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
npm run test:cloudflare-resource-model
npm run test:readiness-dossier
npm run test:rollback-drill
npm run test:release-rc
npm run test:rc-check
npm run rc:check
npm run release:rc
npm run release:rc:markdown
npm run test:release-cutover-evidence
npm run test:main-release-readiness
npm run billing:canary-evidence
npm run evidence:index
npm run evidence:index:markdown
npm run test:evidence-index
npm run cloudflare:resource-model
npm run cloudflare:resource-model:markdown
npm run readiness:dossier
npm run readiness:dossier:markdown
npm run release:rollback-drill
npm run release:cutover-evidence
npm run release:plan
npm run release:preflight
```

These commands are repository/local checks. They do not prove live production readiness without operator evidence.

## Current Baseline

Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the starting point for any future production-readiness audit.
