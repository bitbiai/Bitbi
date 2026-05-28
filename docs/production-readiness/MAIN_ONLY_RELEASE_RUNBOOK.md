# Main-Only Release Runbook

Last updated: 2026-05-20

Status: **operator-run release discipline only**. This runbook does not deploy, approve production readiness, approve live billing, run remote migrations, call Stripe APIs, mutate Cloudflare, mutate GitHub settings, change secrets, or perform rollback actions.

## Purpose

The project owner deploys directly from `main` and does not use a separate staging environment. That is riskier than a staging-first release model because the first deployed environment is live. Direct-main deployment is allowed only with strict preflight, clean-commit discipline, migration evidence, live smoke evidence, and rollback readiness.

Production readiness remains **BLOCKED** unless all evidence gates are satisfied and reviewed by a human operator. Live billing readiness remains **BLOCKED**. Current readiness tooling includes a final RC validation matrix, Release Candidate Go/No-Go manifest, local-only production execution dossier, Cloudflare resource model, live-read-only verification plan, and rollback drill. These artifacts help collect evidence; they do not deploy, run remote migrations, call Cloudflare/Stripe/providers, change secrets, execute rollback, or approve readiness.

## Scope

This runbook covers current direct-main release evidence for the static site, Auth Worker, AI Worker, Contact Worker, auth D1 migration checkpoint, Cloudflare bindings/resources, Admin readiness/evidence panels, billing review/reconciliation/evidence controls, AI budget controls, tenant asset evidence, operator timeline, production execution dossier, live-read-only verification, and rollback drill.

Use `npm run release:plan` and `config/release-compat.json` as the current deploy-unit and auth migration checkpoint source.

Static/pages, Auth Worker, AI Worker, Contact Worker, and remote auth migration requirements are release-plan dependent. Repo-supported readiness is not live readiness; Cloudflare resource declarations and Wrangler parity still require operator live evidence.

The GitHub Pages static workflow is release-plan guarded. Automatic static deploy is allowed only when the release plan is validation-only or static/pages-only. Push runs compare `github.event.before` to `github.sha`; manual `workflow_dispatch` runs compare the supplied `release_plan_base_ref` to the current workflow SHA. If the base/head range is missing, unavailable in checkout, or has no merge base, the workflow fails closed before artifact upload unless a manual `workflow_dispatch` acknowledgement is supplied after the operator has handled dependencies. The workflow never deploys Workers or runs migrations.

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
3. Apply and verify production D1 migration status through the latest auth schema checkpoint reported by `config/release-compat.json` and `npm run release:plan`.
4. Deploy auth Worker by the approved operator process.
5. Deploy static/pages by the approved operator process only when the reviewed release plan requires it.
6. Run the live readiness evidence collector against explicit live URLs.
7. Perform manual admin and member smoke checks required by the reviewed release plan.
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
npm run test:static-deploy-safety
npm run check:static-deploy-safety
npm run test:readiness-evidence
npm run test:cloudflare-resource-model
npm run test:readiness-dossier
npm run test:rollback-drill
npm run test:release-rc
npm run test:rc-check
npm run test:main-release-readiness
npm run rc:check
npm run release:rc
npm run release:rc:markdown
npm run cloudflare:resource-model
npm run readiness:dossier
npm run release:rollback-drill
npm run release:preflight
npm run release:plan
git diff --check
git status --short
```

Record pass/fail output with branch, commit, operator, and date. Do not paste secret values.

## 3. Build Production Execution Evidence

Generate the RC packet, local evidence packet, and resource model before deployment:

```bash
npm run rc:check
npm run release:rc
npm run release:rc:markdown
npm run readiness:dossier
npm run readiness:dossier:markdown
npm run cloudflare:resource-model
npm run cloudflare:resource-model:markdown
npm run release:rollback-drill
```

These commands are local-only and non-mutating. `rc:check` prints the final local validation matrix by default. The RC manifest supports code-merge/deploy preparation only. The Cloudflare model is repo-declared evidence unless the operator attaches separate live evidence. The rollback drill records placeholders and smoke checks; it does not execute rollback.

## 4. Verify Production D1 Migration Status

The production auth D1 database must be verified through the latest auth migration reported by `config/release-compat.json` before deploying current auth Worker code and before live smoke checks. Record migration names/status only.

This runbook does not provide or authorize a remote migration command. If production is not verified through the release-contract latest migration, stop and record final verdict `BLOCKED`.

## 5. Deploy Auth Worker

Operator action only. Deploy the reviewed `main` commit using the existing approved auth Worker release process. Record:

- operator
- date/time
- deployed commit
- auth Worker version/deployment id if available
- rollback target
- whether live billing flags remained disabled

Do not change secrets, bindings, dashboard settings, or live billing flags as part of this checklist unless a separate approved change exists.

## 6. Deploy Static/Pages, If Required

Operator action only. Deploy the reviewed `main` commit using the existing static/pages process only if `npm run release:plan` requires static/pages. On push to `main`, the GitHub Pages workflow checks the release plan before upload/deploy:

- validation-only changes: static workflow may continue;
- static/pages-only changes: static workflow may continue;
- push with Worker, schema, migration, binding/config, required manual prerequisite, or other classified non-static deploy steps: static workflow skips Pages artifact upload/deploy cleanly and records the required deploy order;
- manual `workflow_dispatch` with those same dependencies but without exact acknowledgement: static workflow blocks/fails before Pages artifact upload;
- malformed or unparseable release-plan state: static workflow fails closed.

If static deploy skips or blocks, inspect the guard output, run `npm run release:plan`, deploy affected units in the reported order through the approved operator process, and record evidence. A manual `workflow_dispatch` rerun may acknowledge handled dependencies only with the exact phrase `I_CONFIRM_RELEASE_PLAN_DEPENDENCIES_HANDLED`; that acknowledgement is accepted only on `workflow_dispatch`, is ignored on push, is operator-owned, and is not production readiness, live billing readiness, deploy approval, or proof that live evidence exists.

The workflow uses `npm run check:static-deploy-safety:github -- ...` so push runs can emit `allowed`, `skipped`, or `blocked` outputs. Local `npm run check:static-deploy-safety` remains strict and may exit non-zero for mixed release plans that the GitHub push workflow would report as a clean skip.

Record:

- operator
- date/time
- deployed commit
- Pages build/deployment id if available
- rollback target
- Admin Control Plane asset version or cache evidence if available
- release-plan guard result and whether any manual acknowledgement was used

## 7. Run Live Readiness Evidence Collector

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

The helper performs opt-in read-only checks and keeps the verdict `BLOCKED`. The post-deploy path is GET-only by default; admin readiness, billing evidence, operations timeline, and tenant evidence checks remain skipped/pending unless an admin cookie is supplied through the environment and redacted from output. Passing this command does not prove production readiness or live billing readiness.

## 8. Manual Admin Smoke Checks

Use a live admin account only after the operator has approved the direct-main smoke window. Redact all user data and never paste cookies or tokens.

Required live smoke areas:

- Admin login and MFA.
- Member AI generation paths in scope for the release: missing/malformed `Idempotency-Key` rejection before provider call.
- Member AI generation paths in scope for the release: valid-key success or safe provider error with no secret/raw prompt evidence.
- Member AI generation paths in scope for the release: same-key duplicate no double debit / replay or suppression when result is available.
- Member AI generation paths in scope for the release: same-key different-body conflict.
- Billing Review Queue list/filter.
- Billing Review Detail.
- Billing Review Resolution on approved test review data only.
- Billing Reconciliation report.
- Admin Control Plane Billing Review UI.
- Admin Control Plane Billing Reconciliation UI.
- No raw payload/signature/secret/card/payment method rendering.
- No Stripe action.
- No credit mutation.

## 9. Evidence Recording

Use:

- `docs/production-readiness/EVIDENCE_TEMPLATE.md`
- `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`
- generated readiness evidence under `docs/production-readiness/evidence/`

Acceptable evidence records names, statuses, ids when safe, timestamps, pass/fail outcomes, and redacted screenshots. Unacceptable evidence includes raw secrets, full raw webhook payloads, unredacted customer data, raw cookies, or Stripe secret/signature values.

## 10. Rollback Strategy

Prepare rollback before deploying:

- Generate `npm run release:rollback-drill` and complete the placeholders before the deployment window.
- Hide or revert the static Admin Control Plane UI if the UI breaks or renders unsafe data.
- Redeploy the previous auth Worker version if an API issue appears.
- Keep live billing flags disabled.
- Do not delete billing provider events, billing reviews, checkout records, credit ledgers, member subscriptions, or reconciliation evidence.
- Do not mutate credit ledgers as rollback.
- Do not delete `member_ai_usage_attempts` rows as rollback.
- Keep migrations additive/forward-only; do not roll back by editing production D1.
- Do not call Stripe as rollback.
- Document whether rollback was required and which artifact/version was restored.

## 11. Final Verdict

Allowed direct-main release verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

Do not use `PRODUCTION READY` as an automatic result. Production/live billing readiness remains blocked until all production, Stripe, restore, alert, WAF/RUM, legal/accounting, and remediation evidence gates are complete and reviewed.
