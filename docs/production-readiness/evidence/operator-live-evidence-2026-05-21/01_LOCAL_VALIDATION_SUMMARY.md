# 01 - Local Validation Summary

Date: 2026-05-21

Operator: pending human review; local repo evidence refreshed by Codex

Reviewed commit: `aae6992da8bcfb6a80fe09b734bf745e257e1f64`

This file records repo-local validation only. It does not prove production readiness, live billing readiness, tenant isolation, deploy completion, or legal compliance.

## Baseline

- Branch: `main`
- Commit: `aae6992da8bcfb6a80fe09b734bf745e257e1f64`
- Working tree state: clean before evidence file updates
- Latest auth D1 migration from `config/release-compat.json`: `0060_add_app_settings.sql`
- Evidence index `ok`: `true`
- Evidence index `unsafeCount`: `0`

## Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:toolchain` |  |  |
| `npm run test:quality-gates` |  |  |
| `npm run check:secrets` | pass | No secret patterns detected in the local tree during sprint refresh. |
| `npm run check:dom-sinks` |  |  |
| `npm run check:route-policies` |  |  |
| `npm run test:operational-readiness` |  |  |
| `npm run check:operational-readiness` |  |  |
| `npm run check:live-health` | pass / skipped-safe | No live health URL configured; script skipped without external requests. |
| `npm run check:live-security-headers` | pass / skipped-safe | No public base URL configured; script skipped without external requests. |
| `npm run test:live-canary` |  | Local safe-mode tests only. |
| `npm run check:js` |  |  |
| `npm run test:release-compat` | pass | Step 1 local refresh. |
| `npm run test:release-plan` | pass | Release-plan unit coverage passed. |
| `npm run test:static-deploy-safety` | pass | Static deploy safety unit coverage passed. |
| `npm run validate:release` | pass | Release compatibility validation passed. |
| `npm run validate:cloudflare-prereqs` |  | Repo config only unless live validation is explicitly requested. |
| `npm run test:cloudflare-prereqs` |  |  |
| `npm run test:cloudflare-resource-model` |  |  |
| `npm run test:readiness-dossier` | pass | Readiness dossier tests passed. |
| `npm run test:rollback-drill` |  |  |
| `npm run test:release-rc` |  |  |
| `npm run test:rc-check` |  |  |
| `npm run rc:check` |  | Plan-only by default. |
| `npm run release:rc` | not run in sprint | Local-only manifest command was covered in the previous local evidence baseline; not needed for this template-only refresh. |
| `npm run check:worker-body-parsers` |  |  |
| `npm run check:admin-activity-query-shape` |  |  |
| `npm run check:data-lifecycle` |  |  |
| `npm run test:doc-currentness` | pass | Step 1 local refresh. |
| `npm run check:doc-currentness` | pass | Latest auth migration `0060_add_app_settings.sql`; 153 first-party Markdown files inventoried. |
| `npm run test:readiness-evidence` |  |  |
| `npm run test:main-release-readiness` |  |  |
| `npm run test:ai-cost-gateway` |  |  |
| `npm run test:ai-cost-operations` |  |  |
| `npm run test:admin-platform-budget-policy` |  |  |
| `npm run test:admin-platform-budget-evidence` |  |  |
| `npm run check:ai-cost-policy` |  |  |
| `npm run test:asset-version` |  |  |
| `npm run validate:asset-version` |  |  |
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
| `npm run cloudflare:resource-model` | pass | Repo-config-only model; no Cloudflare API calls; issueCount `0`; live verification still required. |
| `npm run readiness:dossier` | pass | Local-only dossier; production readiness, live billing readiness, and tenant isolation remain blocked/unclaimed. |
| `npm run release:cutover-evidence` | pass | Local-only cutover evidence; no deploy, no remote migration, no live checks. |
| `npm run release:rollback-drill` | pass | Local rollback drill output only; no rollback executed. |
| `npm run billing:canary-evidence` | pass / blocked verdict | Local template generation only; Stripe calls false; live billing readiness remains blocked. |
