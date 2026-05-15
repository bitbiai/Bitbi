# Production/Staging Evidence Framework

Last updated: 2026-05-15

Current status: **production readiness is BLOCKED**. Live billing readiness is also **BLOCKED**.

The latest auth D1 migration declared by `config/release-compat.json` is `0047_add_member_subscriptions_and_credit_buckets.sql`. This document defines the evidence required before any staging-ready, canary-ready, production-ready, or live-billing-ready claim. It does not authorize deployment, remote migrations, Cloudflare changes, Stripe changes, DNS/WAF edits, secret changes, or dashboard mutations.

## Evidence Rule

Production readiness requires evidence, not assumptions. Acceptable evidence is dated, tied to a branch and commit, names the environment, identifies who ran the check, records pass/fail output, and redacts all secret values.

Do not paste secret values, private keys, bearer tokens, webhook secrets, API keys, session tokens, raw cookies, raw Stripe signatures, raw webhook bodies, raw provider payloads, or dashboard screenshots that expose values. It is acceptable to record variable names and `present` / `missing`.

Use `docs/production-readiness/EVIDENCE_TEMPLATE.md` for the evidence pack. The default verdict is `BLOCKED` until the operator has filled the required evidence sections.

## Required Before Production

| Evidence | Who Runs It | Where | Credential Requirement | Secret Output Rule |
| --- | --- | --- | --- | --- |
| Repo baseline: branch, commit, worktree, release latest migration | Repo maintainer | Local repo | None | No secrets involved. |
| Local release checks | Repo maintainer | Local repo / CI | None | Commands must not print secrets. |
| Auth D1 migration status through `0047_add_member_subscriptions_and_credit_buckets.sql` | Cloudflare operator | Staging/production Cloudflare account | Cloudflare access required | Record migration names/status only. Do not print credentials. |
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
| Refund/dispute/chargeback/failed-payment handling | Billing owner | Staging/Testmode before live | Stripe Testmode access | Redact payloads; record expected state transitions. |
| Billing reconciliation/admin needs-review workflow | Billing/admin operator | Staging | Admin access | Redact customer data; record action ids/status only. |

Live billing remains blocked until failure, refund, dispute, chargeback, expired-session, reconciliation, invoice/customer-portal/tax/legal, and support workflow evidence is complete or explicitly scoped out by product/legal with documented risk acceptance.

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

## Live/Staging Credential Checks

These are not run automatically by this framework:

- Remote D1 migration status in staging/production.
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
- Local-only validation presented as production readiness.

## Explicitly Unproven

Until filled evidence proves otherwise, these remain unproven:

- Production Cloudflare resource, binding, secret, route, WAF, header, RUM, and alert state.
- Remote D1 migration status through `0047_add_member_subscriptions_and_credit_buckets.sql`.
- Stripe Testmode checkout/webhook behavior in staging.
- Live credit-pack canary behavior.
- BITBI Pro subscription lifecycle behavior.
- Failed payment, refund, dispute, chargeback, expired-session, and reconciliation workflows.
- Restore drill success and rollback readiness.
- Full SaaS maturity, full tenant isolation, full privacy/legal compliance, and full live billing readiness.
