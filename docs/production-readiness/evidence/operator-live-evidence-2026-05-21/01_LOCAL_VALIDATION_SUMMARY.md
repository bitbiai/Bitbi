# 01 - Local Validation Summary

Date:

Operator:

Reviewed commit:

This file records repo-local validation only. It does not prove production readiness, live billing readiness, tenant isolation, deploy completion, or legal compliance.

## Baseline

- Branch:
- Commit:
- Working tree state:
- Latest auth D1 migration from `config/release-compat.json`: `0060_add_app_settings.sql`
- Evidence index `ok`:
- Evidence index `unsafeCount`:

## Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:toolchain` |  |  |
| `npm run test:quality-gates` |  |  |
| `npm run check:secrets` |  |  |
| `npm run check:dom-sinks` |  |  |
| `npm run check:route-policies` |  |  |
| `npm run test:operational-readiness` |  |  |
| `npm run check:operational-readiness` |  |  |
| `npm run check:live-health` |  | Expected skipped unless live URL is configured. |
| `npm run check:live-security-headers` |  | Expected skipped unless public base URL is configured. |
| `npm run test:live-canary` |  | Local safe-mode tests only. |
| `npm run check:js` |  |  |
| `npm run test:release-compat` |  |  |
| `npm run test:release-plan` |  |  |
| `npm run test:static-deploy-safety` |  |  |
| `npm run validate:release` |  |  |
| `npm run validate:cloudflare-prereqs` |  | Repo config only unless live validation is explicitly requested. |
| `npm run test:cloudflare-prereqs` |  |  |
| `npm run test:cloudflare-resource-model` |  |  |
| `npm run test:readiness-dossier` |  |  |
| `npm run test:rollback-drill` |  |  |
| `npm run test:release-rc` |  |  |
| `npm run test:rc-check` |  |  |
| `npm run rc:check` |  | Plan-only by default. |
| `npm run release:rc` |  | Local-only manifest. |
| `npm run check:worker-body-parsers` |  |  |
| `npm run check:admin-activity-query-shape` |  |  |
| `npm run check:data-lifecycle` |  |  |
| `npm run test:doc-currentness` |  |  |
| `npm run check:doc-currentness` |  |  |
| `npm run test:readiness-evidence` |  |  |
| `npm run test:main-release-readiness` |  |  |
| `npm run test:ai-cost-gateway` |  |  |
| `npm run test:ai-cost-operations` |  |  |
| `npm run test:admin-platform-budget-policy` |  |  |
| `npm run test:admin-platform-budget-evidence` |  |  |
| `npm run check:ai-cost-policy` |  |  |
| `npm run test:asset-version` |  |  |
| `npm run validate:asset-version` |  |  |
| `npm run test:static` |  |  |
| `npm run test:workers` |  |  |
| `npm run test:tenant-assets` |  |  |
| `npm run evidence:index` |  |  |
| `git diff --check` |  |  |

## Failed Or Skipped Commands

For each skipped or failed command, record:

- Command:
- Result:
- Reason:
- Remediation:
- Does this block production readiness? yes/no
- Does this block live billing readiness? yes/no

