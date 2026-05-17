# Production/Staging Evidence Framework

Last updated: 2026-05-16

Current status: **production readiness is BLOCKED**. Live billing readiness is also **BLOCKED**.

The latest auth D1 migration declared by `config/release-compat.json` is `0055_add_platform_budget_evidence_archives.sql`. This document defines the evidence required before any staging-ready, canary-ready, production-ready, or live-billing-ready claim. It does not authorize deployment, remote migrations, Cloudflare changes, Stripe changes, DNS/WAF edits, secret changes, or dashboard mutations.

Phase 4.18 adds read-only platform budget usage reconciliation evidence for `platform_admin_lab_budget`. Phase 4.19 adds explicit admin-approved repair actions for missing usage evidence plus review-only repair notes. Phase 4.20 adds bounded read-only repair evidence reports/exports for operator review. Phase 4.21 adds admin-approved sanitized evidence archives in `AUDIT_ARCHIVE` under `platform-budget-evidence/`, with retention metadata, download, expire, and bounded approved-prefix-only cleanup. Operators must record the reconciliation verdict, repair candidate count, repair action status, report/export evidence, archive id/status/retention, and not-checkable count before enabling admin/platform provider-cost flags for a canary. Phase 4.21 archives do not apply repairs, run automatic repairs, mutate source attempts/jobs or usage rows, call providers, call Stripe, change member/org billing, or make production/live billing ready.

## Evidence Rule

Production readiness requires evidence, not assumptions. Acceptable evidence is dated, tied to a branch and commit, names the environment, identifies who ran the check, records pass/fail output, and redacts all secret values.

Do not paste secret values, private keys, bearer tokens, webhook secrets, API keys, session tokens, raw cookies, raw Stripe signatures, raw webhook bodies, raw provider payloads, or dashboard screenshots that expose values. It is acceptable to record variable names and `present` / `missing`.

Use `docs/production-readiness/EVIDENCE_TEMPLATE.md` for the evidence pack. The default verdict is `BLOCKED` until the operator has filled the required evidence sections.

## Required Before Production

| Evidence | Who Runs It | Where | Credential Requirement | Secret Output Rule |
| --- | --- | --- | --- | --- |
| Repo baseline: branch, commit, worktree, release latest migration | Repo maintainer | Local repo | None | No secrets involved. |
| Local release checks | Repo maintainer | Local repo / CI | None | Commands must not print secrets. |
| Auth D1 migration status through `0055_add_platform_budget_evidence_archives.sql` | Cloudflare operator | Staging/production Cloudflare account | Cloudflare access required | Record migration names/status only. Do not print credentials. |
| Auth Worker bindings: D1, R2, Queues, Durable Object, AI, Images, service bindings | Cloudflare operator | Cloudflare dashboard/API | Cloudflare access required | Record binding names and present/missing only. |
| AI Worker bindings and Durable Object migration | Cloudflare operator | Cloudflare dashboard/API | Cloudflare access required | Record binding/migration names and present/missing only. |
| Contact Worker Durable Object binding | Cloudflare operator | Cloudflare dashboard/API | Cloudflare access required | Record binding names only. |
| Required secret presence | Cloudflare operator | Cloudflare dashboard/API | Cloudflare access required | Record secret names and present/missing only. |
| Live health checks | Release operator | Staging/live URLs | URL access; no mutation | Store status code and pass/fail. |
| Static security headers | Release operator | Staging/live URLs | URL access; no mutation | Store header names/results, not cookies/tokens. |
| Admin Control Plane smoke evidence | Admin operator | Staging/canary | Admin account and MFA | Redact user emails/IDs where possible; no cookies/tokens. |
| Pricing/Credits/Organization smoke evidence | Product/release operator | Staging/canary | Test accounts; Stripe Testmode where relevant | Redact checkout URLs, session ids if not needed, and all secrets. |
| Restore drill evidence | Operations owner | Staging or documented drill environment | Cloudflare/storage access may be required | No credentials or data dumps. |
| Alert/WAF/static header/RUM evidence | Cloudflare/security operator | Dashboard/read-only evidence | Cloudflare access required | Screenshots must hide values and private account data. |

## Required Before Live Billing

Live billing requires all production readiness evidence plus billing-specific evidence:

| Evidence | Who Runs It | Where | Credential Requirement | Secret Output Rule |
| --- | --- | --- | --- | --- |
| Stripe Testmode config presence | Stripe/release operator | Staging/Testmode | Stripe Testmode access | Variable names and present/missing only. |
| Stripe Testmode checkout creation smoke | Stripe/release operator | Staging/Testmode | Stripe Testmode access | Redact keys and webhook secrets; checkout/session ids may be recorded if not sensitive. |
| Stripe Testmode webhook signature verification | Stripe/release operator | Staging/Testmode | Stripe Testmode access | Do not paste webhook secret or raw signature. |
| Exactly-once credit grant evidence | Release operator | Staging/Testmode | Test account and DB/admin read access | Redact personal data; record ledger ids only if safe. |
| Failed/unpaid/expired checkout behavior | Stripe/release operator | Staging/Testmode | Stripe Testmode access | Redact provider payloads. |
| Live Stripe config presence | Stripe/release operator | Live canary | Stripe live access | Names and present/missing only; never print live key or webhook secret. |
| Live credit-pack canary, if intentionally enabled | Release owner plus Stripe operator | Bounded live canary | Approved live canary window | Record enable flag timing and rollback; never paste live secrets. |
| BITBI Pro subscription checkout/invoice/cancel/reactivate evidence | Release owner plus Stripe operator | Staging/Testmode first; live only after approval | Stripe and test account access | Redact secrets and raw payloads. |
| Refund/dispute/chargeback/failed-payment/expired-checkout review handling | Billing owner | Staging/Testmode before live | Stripe Testmode access | Redact payloads; record expected review states and action ids only. |
| Billing review queue/resolution workflow | Billing/admin operator | Staging | Admin access | Redact customer data; record review ids/status/note presence only. |
| Admin Control Plane billing review UI | Billing/admin operator | Staging | Admin access and MFA | Record screenshots/notes with ids redacted; no raw payloads, signatures, card data, or secret values. |
| Read-only billing reconciliation report | Billing/admin operator | Staging | Admin access and MFA | Record generated timestamp, local-only source, blocked verdict, and critical/warning item ids; no raw payloads, secrets, card data, or remediation actions. |
| Billing remediation workflow | Billing/admin/accounting/legal operator | Staging | Admin access and approved support/accounting process | Not implemented in Phase 2.4; redact customer data and record approved action ids/status only if a future workflow exists. |

Phase 2.1 adds repository-local code for operator-review-only live Stripe event classification. It records `invoice.payment_failed`, `invoice.payment_action_required`, `checkout.session.expired`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed` as billing event actions with sanitized safe identifiers and `needs_review`, `blocked`, or `informational` review state. Phase 2.2 adds admin-only list/detail/resolution metadata APIs for these records. Phase 2.3 adds Admin Control Plane UI for the review queue, including filters, safe detail, blocked-event warnings, and note/confirmation-gated `resolved` / `dismissed` actions. Phase 2.4 adds a read-only local D1 reconciliation report and Admin Control Plane panel for billing events, checkout sessions, ledgers, subscriptions, and review-state risk signals. Operators can mark a review `resolved` or `dismissed` with a bounded note and `Idempotency-Key`; the write route is same-origin/admin/MFA/rate-limit guarded and audited. The reconciliation report is read-only and local-only. These phases do not automatically grant, reverse, subtract, delete, cancel, refund, call Stripe, claw back credits, reconcile, remediate, or resolve credits/accounts beyond manual metadata.

Live billing remains blocked until failure, refund, dispute, chargeback, expired-session, review queue/resolution, read-only reconciliation, approved remediation, invoice/customer-portal/tax/legal, and support workflow evidence is complete or explicitly scoped out by product/legal with documented risk acceptance.

Phase 4.8.2 adds admin-only sanitized inspection and bounded non-destructive cleanup for `admin_ai_usage_attempts` created by admin text/embeddings idempotency. Phase 4.9 adds no migration and extends that metadata-only idempotency foundation only to Admin Music test generation. Phase 4.10 adds no migration and extends it only to Admin Compare. Phase 4.11 adds no migration and audits/designs Admin Live-Agent budget enforcement only. Phase 4.12 adds no migration and extends the metadata-only attempt foundation only to Admin Live-Agent stream sessions with required `Idempotency-Key`, caller-policy propagation, duplicate stream suppression, and observable stream completion/failure tracking. Phase 4.13 adds no migration and retires the synchronous Admin Video Debug route from normal provider-cost operations as disabled-by-default/emergency-only; async admin video jobs remain the supported budgeted admin video path. Phase 4.14 adds no migration and classifies Admin Image branches. Phase 4.15 adds no migration and enforces Cloudflare master runtime budget kill switches. Phase 4.15.1 adds additive migration `0052` and D1 app-level switch state/history. Phase 4.16 remains completed and documents/reports live platform budget cap design and countability. Phase 4.17 adds additive migration `0053`, D1 daily/monthly cap limits and usage events, admin-only cap APIs, and a compact Admin Control Plane cap panel for `platform_admin_lab_budget` only. Phase 4.19 adds additive migration `0054`, admin-only repair APIs/UI, and `platform_budget_repair_actions` audit rows. Phase 4.20 adds no migration and adds read-only repair evidence report/export APIs/UI. Phase 4.21 adds additive migration `0055`, `platform_budget_evidence_archives`, admin-only archive APIs/UI, and sanitized `AUDIT_ARCHIVE` objects under `platform-budget-evidence/`; cleanup is bounded and approved-prefix-only. These phases do not call providers in tests, call Stripe, enable live billing, implement customer billing, or make production/live billing ready.

Phase 4.15 budget-switch operator checklist records intended state only; do not paste values or secrets:

- `ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET`
- `ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET`
- `ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS`
- `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`
- `ENABLE_NEWS_PULSE_VISUAL_BUDGET`
- `ENABLE_ADMIN_AI_TEXT_BUDGET`
- `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`
- `ENABLE_ADMIN_AI_MUSIC_BUDGET`
- `ENABLE_ADMIN_AI_COMPARE_BUDGET`
- `ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET`

Phase 4.15.1 Admin AI Budget Switch Control Plane checklist records app-level D1 state only:

- Remote migration `0052_add_admin_runtime_budget_switches.sql` is applied before the Phase 4.15.1 switch-control auth Worker deploy.
- `GET /api/admin/ai/budget-switches` shows safe master/app/effective status without Cloudflare values.
- `PATCH /api/admin/ai/budget-switches/:switchKey` requires admin MFA, same-origin, bounded reason, and `Idempotency-Key`.
- Disabled or missing Cloudflare master flags cannot be overridden by the Admin UI.
- Missing D1 app rows and D1-unavailable states fail closed before provider/internal AI/queue/credit/durable-attempt work.
- No Cloudflare API token is stored and no Cloudflare variable is mutated from the app.
- Phase 4.17 cap migration `0053_add_platform_budget_caps.sql` is applied before auth Worker deploys that depend on cap tables.
- Phase 4.19 repair migration `0054_add_platform_budget_repair_actions.sql` is applied before auth Worker deploys that record repair action audit rows.
- Phase 4.20 repair evidence reports/exports are reviewed as bounded, sanitized, read-only operator evidence; no repair is applied by report/export endpoints.
- Phase 4.21 archive migration `0055_add_platform_budget_evidence_archives.sql` is applied before auth Worker deploys that create/list/expire/cleanup platform budget evidence archives.

Phase 4.16 and Phase 4.17 live platform budget-cap evidence checklist records status only; do not paste secret values:

- Evidence report preserves Phase 4.16 design/countability fields and shows `liveBudgetCapsStatus: platform_admin_lab_budget_foundation`.
- Evidence report distinguishes runtime switch enforcement, Phase 4.17 cap enforcement, and non-cap-enforced future scopes.
- `platform_admin_lab_budget` daily/monthly caps are configured intentionally before enabling related provider-cost paths.
- Cap usage evidence is bounded/sanitized and records only successful covered provider-cost completions.
- Operator decision is recorded before enabling admin/platform AI flags: keep flags off, enable a targeted flag for bounded testing, or accept risk without live caps.
- Production/live billing remains BLOCKED while other scopes, live evidence, and customer-billing evidence remain incomplete.

## Repo-Local Checks

These checks are safe local/repo checks:

```bash
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run validate:release
npm run test:release-plan
npm run readiness:evidence
npm run test:readiness-evidence
npm run release:preflight
git diff --check
git status --short
```

`npm run readiness:evidence` is local-only and redacted by default. It prints branch, commit, worktree summary, release latest migration, binding declarations from repo config, known env var presence as present/missing, skipped live checks, blockers, and final verdict `BLOCKED`.

Local-only markdown output:

```bash
npm run readiness:evidence -- --markdown
```

To run a tiny deterministic local subset from the helper, an operator may run:

```bash
npm run readiness:evidence -- --run-local-checks
```

This still does not deploy, migrate, call Stripe, mutate Cloudflare, or run live checks.

To write a redacted evidence file, use only the approved evidence directory:

```bash
npm run readiness:evidence -- \
  --output docs/production-readiness/evidence/2026-05-15-local-readiness.md
```

The helper refuses to write outside `docs/production-readiness/evidence/` and refuses to overwrite existing files unless `--force` is passed.

## Phase 2.5 Billing Review/Reconciliation Staging Plan

Use `docs/production-readiness/PHASE2_BILLING_REVIEW_STAGING_CHECKLIST.md` before any staging verification of the Phase 2.1-2.4 billing lifecycle review/reconciliation workflow. Phase 2.5 is a checklist and evidence-plan phase only. It does not approve production deploy, live billing, Stripe remediation, credit clawback, subscription cancellation, or automatic reconciliation.

Local preflight examples:

```bash
npm run release:preflight
npm run release:plan
npm run readiness:evidence
npm run readiness:evidence -- --markdown
```

Expected current deploy units from `npm run release:plan` are the auth schema migration, auth Worker, and static/pages if the Admin UI changed. Current staging/auth D1 evidence must now be through `0055_add_platform_budget_evidence_archives.sql` before deploying current auth Worker code or running API smoke checks.

Staging read-only evidence example with explicit URLs:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://<staging-static-origin>/ \
  --auth-worker-url https://<staging-auth-origin>/ \
  --ai-worker-url https://<staging-ai-origin>/ \
  --contact-worker-url https://<staging-contact-origin>/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-staging-readiness.md
```

Manual API smoke examples should use a staging admin session and a local cookie file path. Do not paste cookie values, bearer tokens, raw signatures, raw payloads, or secrets into commands, shell history, issue comments, screenshots, or evidence files.

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reviews?provider=stripe&provider_mode=live&review_state=needs_review&limit=20" \
  | jq '{ok, count: (.events | length), reviewStates: [.events[]?.reviewState], eventTypes: [.events[]?.eventType]}'
```

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reviews/<review-event-id>" \
  | jq '{ok, eventType, reviewState, reviewReason, recommendedAction, safeIdentifiers, sideEffectsEnabled}'
```

```bash
curl --fail --silent --show-error \
  --request POST \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: <operator-generated-review-resolution-key>" \
  --data '{"resolution_status":"dismissed","resolution_note":"Staging smoke: no customer action taken."}' \
  "https://<staging-auth-origin>/api/admin/billing/reviews/<review-event-id>/resolution" \
  | jq '{ok, reviewState, resolutionStatus, resolvedAt}'
```

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reconciliation" \
  | jq '{ok, source, verdict, productionReadiness, liveBillingReadiness, generatedAt, sectionIds: [.sections[]?.id], notes}'
```

These smoke checks must verify admin-only access, MFA expectations, sanitized output, blocked/live-billing warnings, read-only reconciliation, no raw payload/signature/secret/card rendering, no credit mutation, and no Stripe action. They must remain staging-only unless a human operator separately approves a canary/production evidence window.

Any production deploy or canary mention in this repository is **not approved by this document**. Production requires human operator approval, complete evidence review, migration/resource/secret verification, rollback readiness, and explicit legal/product/billing acceptance. Live billing remains `BLOCKED`.

## Main-Only Direct Release Gate

The owner deploys directly from `main` and does not use a separate staging environment. This is riskier than staging because the first deployed environment is live. Use `docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md` and `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md` for any direct-main release. For the Phase 3.4 member personal image AI Cost Gateway pilot, also use `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md`.

Local main-release gate:

```bash
npm run check:main-release-readiness
```

The check reads the current branch, commit, worktree status, and latest auth migration from `config/release-compat.json`. It rejects dirty worktrees by default, verifies the latest auth migration is `0055_add_platform_budget_evidence_archives.sql`, and warns that direct-main release is risky, production/live billing remains blocked, migration `0055` must be verified before auth Worker deploy, and production D1 migration status must be verified manually.

For local planning evidence only:

```bash
npm run check:main-release-readiness -- --allow-dirty --markdown
```

The gate never deploys, runs remote migrations, calls Stripe APIs, mutates Cloudflare/GitHub settings, changes secrets, or enables live billing. Do not run it as proof of production readiness. Direct-main production deploy steps are not approved by this documentation; they require human operator approval, evidence review, rollback readiness, and final operator verdict.

Allowed direct-main checklist verdicts are:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

`PRODUCTION READY` is not an automatic checklist outcome. Main-only evidence does not prove external Stripe truth, live billing readiness, refund/dispute/chargeback remediation, or legal/accounting readiness.

## Phase 3.4 Member Image Gateway Main-Only Evidence

Phase 3.4 adds the member personal image gateway pilot and additive auth migration `0048_add_member_ai_usage_attempts.sql`. The reviewed release plan for this scope should report:

- auth schema checkpoint `0048_add_member_ai_usage_attempts.sql`
- auth Worker
- no static/pages deploy for Phase 3.4 itself
- no AI Worker/contact Worker deploy

The mandatory operator order is migration `0048` first, then auth Worker deploy from the reviewed commit. Do not deploy auth Worker code that depends on `member_ai_usage_attempts` before remote migration `0048` is applied and verified. Use `PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md` to record member personal image smoke evidence, including missing/malformed idempotency rejection, same-key duplicate behavior, conflict behavior, and no-charge failure evidence when safely testable.

This evidence does not prove later admin video job controls, OpenClaw/News Pulse visual controls, broad admin AI, platform/background AI outside News Pulse visuals, internal AI Worker routes, or all provider-result replay paths are migrated. Production readiness and live billing readiness remain `BLOCKED`.

## Live/Staging Credential Checks

These are not run automatically by this framework:

- Remote D1 migration status in staging/production through `0055_add_platform_budget_evidence_archives.sql`.
- Cloudflare Worker binding/resource presence in staging/production.
- Cloudflare secret presence in staging/production.
- Live health/security-header checks against staging/production URLs.
- Stripe Testmode/live checkout/webhook/canary flows.
- Dashboard-managed WAF, Transform Rules, RUM, and alert verification.
- Restore drill execution.

Operators must run these explicitly, redact evidence, and paste results into `docs/production-readiness/EVIDENCE_TEMPLATE.md`.

## Operator-Run Read-Only HTTP Evidence

The helper can collect a narrow read-only HTTP evidence slice only when an operator explicitly passes `--include-live` and one or more URLs. It never guesses production URLs and never sends credentials, cookies, Authorization headers, Stripe secrets, or Cloudflare tokens.

Staging example:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://staging.example.invalid/ \
  --auth-worker-url https://staging.example.invalid/ \
  --ai-worker-url https://ai-staging.example.invalid/ \
  --contact-worker-url https://contact-staging.example.invalid/ \
  --output docs/production-readiness/evidence/2026-05-15-staging-readiness.md
```

Production/canary example:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://bitbi.ai/ \
  --auth-worker-url https://bitbi.ai/ \
  --ai-worker-url https://ai.example.invalid/ \
  --contact-worker-url https://contact.bitbi.ai/ \
  --output docs/production-readiness/evidence/2026-05-15-canary-readiness.md
```

Read-only HTTP evidence currently covers:

- Static site GET status, final origin, and selected safe headers only.
- Auth Worker `GET /api/health`, status, JSON parse success/failure, public-safe `ok` / `service` / `status` fields, and selected safe headers.
- AI Worker `GET /health`, status, JSON parse success/failure, public-safe fields, and selected safe headers.
- Contact Worker `GET /health`, status, JSON parse success/failure, public-safe fields, and selected safe headers.

The helper does not dump response bodies. It strips query strings and fragments from supplied URLs before requests and prints origins rather than full URLs.

This command does not prove production readiness or live billing readiness. Even if all read-only HTTP checks pass, the generated verdict remains `BLOCKED`, with `evidenceCollected: true` and `operatorReviewRequired: true`. A human operator must attach the evidence file to the release/operator review and verify all remaining gates in the template.

## Acceptable Evidence

Acceptable evidence includes:

- Command output copied with date, actor, environment, branch, and commit.
- Redacted screenshots showing resource names and pass/fail status without values.
- Tables listing binding/secret/env var names with `present` or `missing`.
- Stripe Testmode event ids, checkout session ids, ledger/action ids, and timestamps when needed for reconciliation, with customer data redacted.
- Runbook links or ticket links for restore drills, alert tests, WAF/header/RUM verification, and rollback rehearsal.

Unacceptable evidence includes:

- Claims without commands, screenshots, or traceable operator notes.
- Secret values, raw webhook secrets/signatures, API keys, raw cookies, session tokens, private keys, or unredacted customer data.
- Live billing success alone without failure/refund/dispute/reconciliation evidence.
- Phase 2.3 review queue UI/resolution records or Phase 2.4 read-only reconciliation reports presented as automated refund, chargeback, failed-payment remediation, accounting reconciliation, or live billing readiness.
- Local-only validation presented as production readiness.

## Explicitly Unproven

Until filled evidence proves otherwise, these remain unproven:

- Production Cloudflare resource, binding, secret, route, WAF, header, RUM, and alert state.
- Remote D1 migration status through `0055_add_platform_budget_evidence_archives.sql`.
- Stripe Testmode checkout/webhook behavior in staging.
- Live credit-pack canary behavior.
- BITBI Pro subscription lifecycle behavior.
- Staging/live evidence for Phase 2.3 failed-payment, refund, dispute, chargeback, and expired-checkout review queue UI/resolution handling.
- Staging/live evidence for Phase 2.4 local-only billing reconciliation reporting against real migrated billing data.
- Automated failed-payment remediation, refund/chargeback credit adjustment, and approved billing admin remediation workflow.
- Restore drill success and rollback readiness.
- Full SaaS maturity, full tenant isolation, full privacy/legal compliance, and full live billing readiness.
