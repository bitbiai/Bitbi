# Main-Only Release Runbook

Last updated: 2026-05-16

Status: **operator-run release discipline only**. This runbook does not deploy, approve production readiness, approve live billing, run remote migrations, call Stripe APIs, mutate Cloudflare, mutate GitHub settings, change secrets, or perform rollback actions.

## Purpose

The project owner deploys directly from `main` and does not use a separate staging environment. That is riskier than a staging-first release model because the first deployed environment is live. Direct-main deployment is allowed only with strict preflight, clean-commit discipline, migration evidence, live smoke evidence, and rollback readiness.

Production readiness remains **BLOCKED** unless all evidence gates are satisfied and reviewed by a human operator. Live billing readiness remains **BLOCKED**. Phase 2.1-2.4 billing lifecycle review/reconciliation work is review/reporting infrastructure only; it does not automate refunds, disputes, chargebacks, credit clawbacks, reconciliation, subscription cancellation, or Stripe remediation. Phase 3.4 adds only the member personal image AI Cost Gateway pilot plus additive auth migration `0048_add_member_ai_usage_attempts.sql`. Phase 4.5 adds only admin async video job budget metadata/enforcement plus additive auth migration `0049_add_admin_video_job_budget_metadata.sql`. Phase 4.6 adds only OpenClaw/News Pulse visual budget metadata/status controls plus additive auth migration `0050_add_news_pulse_visual_budget_metadata.sql`. Phase 4.15.1 adds only D1-backed app-level Admin AI budget switch state/history plus additive auth migration `0052_add_admin_runtime_budget_switches.sql`; Cloudflare master flags remain hard gates and the app does not call Cloudflare APIs, edit Worker variables, or store Cloudflare API tokens. Phase 4.16 remains preserved as live platform budget cap design/evidence. Phase 4.17 adds additive migration `0053_add_platform_budget_caps.sql` for the first `platform_admin_lab_budget` cap foundation and is not customer billing or Stripe/live billing. These phases do not migrate broad Admin AI, Admin video beyond scoped phases, platform/background AI globally, global internal AI Worker routes, pricing, Stripe, or public billing.

## Scope

This runbook covers direct-main release evidence for:

- Phase 2.1 Stripe live lifecycle review classification.
- Phase 2.2 Admin Billing Review Queue API and manual resolution metadata.
- Phase 2.3 Admin Control Plane Billing Review UI.
- Phase 2.4 read-only local Billing Reconciliation API and UI.
- Phase 3.4 member personal image AI Cost Gateway pilot.
- Phase 4.5 admin async video job budget metadata/enforcement.
- Phase 4.6 OpenClaw/News Pulse visual budget metadata/status controls.
- Phase 4.15.1 Admin AI Budget Switch Control Plane.
- Phase 4.17 Platform Budget Caps foundation for `platform_admin_lab_budget`.

For the Phase 2.1-2.4 runtime changes to be visible live, the expected deploy units are:

1. auth Worker
2. static/pages

For the Phase 3.4 member personal image gateway pilot to be visible live, the expected deploy units are:

1. auth schema checkpoint `0048_add_member_ai_usage_attempts.sql`
2. auth Worker

Static/pages, AI Worker, and contact Worker are not expected for Phase 3.4 unless `npm run release:plan` reports other reviewed changes.

For Phase 4.5 admin async video job budget metadata to be visible live, the expected deploy units are:

1. auth schema checkpoint `0049_add_admin_video_job_budget_metadata.sql`
2. auth Worker

Static/pages, AI Worker, and contact Worker are not expected for Phase 4.5 unless `npm run release:plan` reports other reviewed changes.

For Phase 4.6 OpenClaw/News Pulse visual budget metadata/status controls to be visible live, the expected deploy units are:

1. auth schema checkpoint `0050_add_news_pulse_visual_budget_metadata.sql`
2. auth Worker

Static/pages, AI Worker, and contact Worker are not expected for Phase 4.6 unless `npm run release:plan` reports other reviewed changes.

For Phase 4.15.1 Admin AI Budget Switch Control Plane to be visible live, the expected deploy units are:

1. auth schema checkpoint `0052_add_admin_runtime_budget_switches.sql`
2. auth Worker
3. static/pages

AI Worker and contact Worker are not expected for Phase 4.15.1 unless `npm run release:plan` reports other reviewed changes.

For Phase 4.17 Platform Budget Caps to be visible live, the expected deploy units are:

1. auth schema checkpoint `0053_add_platform_budget_caps.sql`
2. auth Worker
3. static/pages

AI Worker and contact Worker are not expected for Phase 4.17 unless `npm run release:plan` reports other reviewed changes.

Phase 2.1-2.5 added no new D1 migration, Phase 3.4 added `0048_add_member_ai_usage_attempts.sql`, Phase 4.5 added `0049_add_admin_video_job_budget_metadata.sql`, Phase 4.6 added `0050_add_news_pulse_visual_budget_metadata.sql`, Phase 4.8.1 added `0051_add_admin_ai_usage_attempts.sql`, Phase 4.15.1 added `0052_add_admin_runtime_budget_switches.sql`, and Phase 4.17 added the additive auth D1 migration:

```text
0053_add_platform_budget_caps.sql
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
3. Apply and verify production D1 migration status through `0053_add_platform_budget_caps.sql` when the reviewed release plan includes auth schema checkpoint `0053`.
4. Deploy auth Worker by the approved operator process.
5. Deploy static/pages by the approved operator process only when the reviewed release plan requires it.
6. Run the live readiness evidence collector against explicit live URLs.
7. Perform manual admin smoke checks and, for Phase 3.4, member personal image gateway smoke checks.
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

The production auth D1 database must be verified through `0053_add_platform_budget_caps.sql` before deploying current auth Worker code and before live smoke checks. Record migration names/status only.

This runbook does not provide or authorize a remote migration command. If production is not verified through `0053`, stop and record final verdict `BLOCKED`.

## 4. Deploy Auth Worker

Operator action only. Deploy the reviewed `main` commit using the existing approved auth Worker release process. Record:

- operator
- date/time
- deployed commit
- auth Worker version/deployment id if available
- rollback target
- whether live billing flags remained disabled

Do not change secrets, bindings, dashboard settings, or live billing flags as part of this checklist unless a separate approved change exists.

## 5. Deploy Static/Pages, If Required

Operator action only. Deploy the reviewed `main` commit using the existing static/pages process only if `npm run release:plan` requires static/pages. Phase 3.4 alone should not require static/pages. Record:

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
- Phase 3.4 member personal image: missing/malformed `Idempotency-Key` rejection before provider call.
- Phase 3.4 member personal image: valid-key success or safe provider error with no secret/raw prompt evidence.
- Phase 3.4 member personal image: same-key duplicate no double debit / replay or suppression when result is available.
- Phase 3.4 member personal image: same-key different-body conflict.
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
- Do not delete `member_ai_usage_attempts` rows as rollback.
- Keep migration `0048` additive/forward-only.
- Do not call Stripe as rollback.
- Document whether rollback was required and which artifact/version was restored.

## 10. Final Verdict

Allowed direct-main release verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

Do not use `PRODUCTION READY` as an automatic result. Production/live billing readiness remains blocked until all production, Stripe, restore, alert, WAF/RUM, legal/accounting, and remediation evidence gates are complete and reviewed.
