# 01 - Local Validation Summary

Date: 2026-05-21

Operator: pending human review; local repo evidence refreshed by Codex

Reviewed commit: `e68b51d2bfa86933833dee026f4be62dbe6b24c9`

This file records repo-local validation only. It does not prove production readiness, live billing readiness, tenant isolation, deploy completion, or legal compliance.

## Baseline

- Branch: `main`
- Commit: `e68b51d2bfa86933833dee026f4be62dbe6b24c9`
- Working tree state: clean before evidence file updates
- Latest auth D1 migration from `config/release-compat.json`: `0060_add_app_settings.sql`
- Evidence index `ok`: `true`
- Evidence index `unsafeCount`: `0`

## Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:toolchain` | pass | Toolchain consistency guard passed. |
| `npm run test:quality-gates` | pass | Quality gate tests passed. |
| `npm run check:secrets` | pass | No secret patterns detected in the local tree during sprint refresh. |
| `npm run check:dom-sinks` | pass | DOM sink baseline guard passed. |
| `npm run check:route-policies` | pass | Route policy guard passed for 207 registered auth-worker route policies. |
| `npm run test:operational-readiness` | pass | Operational readiness tests passed. |
| `npm run check:operational-readiness` | pass | Required docs/runbooks exist. |
| `npm run check:live-health` | pass / skipped-safe and pass / approved-live | No-URL safe mode skipped; approved public live run returned 200 for Auth and Contact health. |
| `npm run check:live-security-headers` | pass / skipped-safe and pass / approved-live-with-manual-items | No-URL safe mode skipped; approved live run returned static 200, `x-content-type-options`, and `referrer-policy`; `permissions-policy` and `content-security-policy` remain manual. |
| `npm run test:live-canary` | pass | Local safe-mode tests only. |
| `npm run check:js` |  |  |
| `npm run test:release-compat` | pass | Step 1 local refresh. |
| `npm run test:release-plan` | pass | Release-plan unit coverage passed. |
| `npm run test:static-deploy-safety` | pass | Static deploy safety unit coverage passed. |
| `npm run validate:release` | pass | Release compatibility validation passed. |
| `npm run validate:cloudflare-prereqs` | pass / production deploy blocked | Repo config passed; live Cloudflare validation skipped, so production deploy readiness remains blocked. |
| `npm run test:cloudflare-prereqs` | pass | Cloudflare prerequisite tests passed. |
| `npm run test:cloudflare-resource-model` | pass | Cloudflare resource model tests passed. |
| `npm run test:readiness-dossier` | pass | Readiness dossier tests passed. |
| `npm run test:rollback-drill` | pass | Rollback drill tests passed. |
| `npm run test:release-rc` | pass | Release Candidate manifest tests passed. |
| `npm run test:rc-check` | pass | RC check tests passed. |
| `npm run rc:check` | pass | Plan-only RC matrix generated; no commands executed by default. |
| `npm run release:rc` | pass | Local-only release candidate manifest; no external calls. |
| `npm run check:worker-body-parsers` | pass | Worker body parser guard passed. |
| `npm run check:admin-activity-query-shape` | pass | Admin activity query-shape guard passed. |
| `npm run check:data-lifecycle` | pass | Data lifecycle policy guard passed. |
| `npm run test:doc-currentness` | pass | Step 1 local refresh. |
| `npm run check:doc-currentness` | pass | Latest auth migration `0060_add_app_settings.sql`; 153 first-party Markdown files inventoried. |
| `npm run test:readiness-evidence` |  |  |
| `npm run test:main-release-readiness` |  |  |
| `npm run test:ai-cost-gateway` | pass | AI cost gateway tests passed. |
| `npm run test:ai-cost-operations` | pass | AI cost operation registry tests passed. |
| `npm run test:admin-platform-budget-policy` | pass | Admin/platform budget policy tests passed. |
| `npm run test:admin-platform-budget-evidence` | pass | Admin/platform budget evidence tests passed. |
| `npm run check:ai-cost-policy` | pass | Baseline-enforced AI cost policy check passed; accepted baseline gaps remain documented. |
| `npm run test:ai-cost-policy` | pass | AI cost policy tests passed. |
| `npm run test:asset-version` | pass | Asset version tests passed. |
| `npm run validate:asset-version` | pass | Asset version validation passed. |
| `npm run test:static` | pass | 293 Playwright static tests passed. |
| `npm run test:workers` | pass | 615 Worker tests passed. |
| `npm run test:tenant-assets` | pass | Tenant-assets test command passed. |
| `npm run evidence:index` | pass | `ok:true`; `unsafeCount:0`; local filesystem only; no external calls. |
| `git diff --check` | pass | No whitespace errors before evidence file updates. |

## Step 1 Release Gate Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run release:plan` | pass | Changed files `0`; impacted deploy units none; worker deploys none; schema applies none; static required no; required manual prerequisites none. |
| `npm run check:static-deploy-safety -- --event-name push --acknowledgement ""` | pass | Status `allowed`; mode `validation_only`; push-based Pages safety guard would pass for the clean tree. |
| `npm run validate:release` | pass | Release compatibility validation passed. |

## Failed Or Skipped Commands

For each skipped or failed command, record:

- Command:
- Result:
- Reason:
- Remediation:
- Does this block production readiness? yes/no
- Does this block live billing readiness? yes/no

No Step 1 local refresh command failed. Live/manual evidence remains pending outside this local summary.

## Sprint Evidence Commands

| Command | Result | Notes |
| --- | --- | --- |
| `npm run release:rc:markdown` | pass | Local-only Markdown RC manifest; final status remains NO_GO for production readiness claim. |
| `npm run readiness:evidence` | pass / blocked verdict | Local redacted evidence pack; final verdict `BLOCKED`; no live checks or mutations. |
| `npm run readiness:evidence:markdown` | pass / blocked verdict | Markdown output; final verdict `BLOCKED`. |
| `npm run cloudflare:resource-model` | pass | Repo-config-only model; no Cloudflare API calls; issueCount `0`; live verification still required. |
| `npm run cloudflare:resource-model:markdown` | pass | Markdown output; total resources `74`, issueCount `0`, live evidence required. |
| `npm run readiness:dossier` | pass | Local-only dossier; production readiness, live billing readiness, and tenant isolation remain blocked/unclaimed. |
| `npm run readiness:dossier:markdown` | pass | Markdown dossier; production readiness and live billing readiness remain blocked. |
| `npm run release:cutover-evidence` | pass | Local-only cutover evidence; no deploy, no remote migration, no live checks. |
| `npm run release:cutover-evidence:markdown` | pass | Markdown cutover manifest; no runtime deploy steps required by current diff. |
| `npm run release:rollback-drill` | pass | Local rollback drill output only; no rollback executed. |
| `npm run billing:canary-evidence` | pass / blocked verdict | Local template generation only; Stripe calls false; live billing readiness remains blocked. |
