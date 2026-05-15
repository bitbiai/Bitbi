# Main-Only Release Runbook

Last updated: 2026-05-15

Status: **operator-run release discipline only**. This runbook does not deploy, approve production readiness, approve live billing, run remote migrations, call Stripe APIs, mutate Cloudflare, mutate GitHub settings, change secrets, or perform rollback actions.

## Purpose

The project owner deploys directly from `main` and does not use a separate staging environment. That is riskier than a staging-first release model because the first deployed environment is live. Direct-main deployment is allowed only with strict preflight, clean-commit discipline, migration evidence, live smoke evidence, and rollback readiness.

Production readiness remains **BLOCKED** unless all evidence gates are satisfied and reviewed by a human operator. Live billing readiness remains **BLOCKED**. Phase 2.1-2.4 billing lifecycle review/reconciliation work is review/reporting infrastructure only; it does not automate refunds, disputes, chargebacks, credit clawbacks, reconciliation, subscription cancellation, or Stripe remediation.

## Scope

This runbook covers direct-main release evidence for:

- Phase 2.1 Stripe live lifecycle review classification.
- Phase 2.2 Admin Billing Review Queue API and manual resolution metadata.
- Phase 2.3 Admin Control Plane Billing Review UI.
- Phase 2.4 read-only local Billing Reconciliation API and UI.

For those runtime changes to be visible live, the expected deploy units are:

1. auth Worker
2. static/pages

Phase 2.1-2.5 added no new D1 migration, but the current release contract now requires production D1 to be verified through:

```text
0048_add_member_ai_usage_attempts.sql
```

## Non-Negotiable Safety Rules

- Do not paste secret values, raw cookies, bearer tokens, API keys, webhook secrets, Stripe signatures, private keys, or raw provider payloads.
- Do not run remote migrations from this runbook.
- Do not enable live billing flags from this runbook.
- Do not call Stripe APIs from this runbook.
- Do not mutate billing event records, credit ledgers, subscription state, checkout records, D1, R2, Queues, Cloudflare settings, GitHub settings, DNS, WAF, or secrets.
- Do not delete billing evidence during rollback.

## Main-Only Deploy Order

1. Verify clean commit/worktree.
2. Run local preflight.
3. Verify production D1 migration status through `0048_add_member_ai_usage_attempts.sql`.
4. Deploy auth Worker by the approved operator process.
5. Deploy static/pages by the approved operator process.
6. Run the live readiness evidence collector against explicit live URLs.
7. Perform manual admin smoke checks.
8. Record evidence in `docs/production-readiness/EVIDENCE_TEMPLATE.md`.
9. Keep final verdict `BLOCKED`, `MAIN DEPLOYED - EVIDENCE INCOMPLETE`, or `MAIN DEPLOYED - OPERATOR VERIFIED`; never automatically mark production-ready.

## 1. Verify Clean Commit and Worktree

```bash
git branch --show-current
git rev-parse HEAD
git status --short
npm run check:main-release-readiness
```

If the worktree is dirty, stop before release. `--allow-dirty` is only for local planning evidence, not for approving a direct-main deployment:

```bash
npm run check:main-release-readiness -- --allow-dirty --markdown
```

## 2. Run Local Preflight

```bash
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:readiness-evidence
npm run test:main-release-readiness
npm run release:preflight
npm run release:plan
git diff --check
git status --short
```

Record pass/fail output with branch, commit, operator, and date. Do not paste secret values.

## 3. Verify Production D1 Migration Status

The production auth D1 database must be verified through `0048_add_member_ai_usage_attempts.sql` before live smoke checks. Record migration names/status only.

This runbook does not provide or authorize a remote migration command. If production is not verified through `0048`, stop and record final verdict `BLOCKED`.

## 4. Deploy Auth Worker

Operator action only. Deploy the reviewed `main` commit using the existing approved auth Worker release process. Record:

- operator
- date/time
- deployed commit
- auth Worker version/deployment id if available
- rollback target
- whether live billing flags remained disabled

Do not change secrets, bindings, dashboard settings, or live billing flags as part of this checklist unless a separate approved change exists.

## 5. Deploy Static/Pages

Operator action only. Deploy the reviewed `main` commit using the existing static/pages process. Record:

- operator
- date/time
- deployed commit
- Pages build/deployment id if available
- rollback target
- Admin Control Plane asset version or cache evidence if available

## 6. Run Live Readiness Evidence Collector

Use explicit URLs only. Do not include credentials in URLs.

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://bitbi.ai/ \
  --auth-worker-url https://bitbi.ai/ \
  --ai-worker-url https://<live-ai-worker-origin>/ \
  --contact-worker-url https://contact.bitbi.ai/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-main-readiness.md
```

The helper performs read-only GET checks only and keeps the verdict `BLOCKED`. Passing this command does not prove production readiness or live billing readiness.

## 7. Manual Admin Smoke Checks

Use a live admin account only after the operator has approved the direct-main smoke window. Redact all user data and never paste cookies or tokens.

Required live smoke areas:

- Admin login and MFA.
- Billing Review Queue list/filter.
- Billing Review Detail.
- Billing Review Resolution on approved test review data only.
- Billing Reconciliation report.
- Admin Control Plane Billing Review UI.
- Admin Control Plane Billing Reconciliation UI.
- No raw payload/signature/secret/card/payment method rendering.
- No Stripe action.
- No credit mutation.

## 8. Evidence Recording

Use:

- `docs/production-readiness/EVIDENCE_TEMPLATE.md`
- `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`
- generated readiness evidence under `docs/production-readiness/evidence/`

Acceptable evidence records names, statuses, ids when safe, timestamps, pass/fail outcomes, and redacted screenshots. Unacceptable evidence includes raw secrets, full raw webhook payloads, unredacted customer data, raw cookies, or Stripe secret/signature values.

## 9. Rollback Strategy

Prepare rollback before deploying:

- Hide or revert the static Admin Control Plane UI if the UI breaks or renders unsafe data.
- Redeploy the previous auth Worker version if an API issue appears.
- Keep live billing flags disabled.
- Do not delete billing provider events, billing reviews, checkout records, credit ledgers, member subscriptions, or reconciliation evidence.
- Do not mutate credit ledgers as rollback.
- Do not call Stripe as rollback.
- Document whether rollback was required and which artifact/version was restored.

## 10. Final Verdict

Allowed direct-main release verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

Do not use `PRODUCTION READY` as an automatic result. Production/live billing readiness remains blocked until all production, Stripe, restore, alert, WAF/RUM, legal/accounting, and remediation evidence gates are complete and reviewed.
