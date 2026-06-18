# Main-Only Release Checklist

Last updated: 2026-05-20

Default verdict: **BLOCKED**

Allowed final verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

This checklist is for direct deployment from `main`. It is not staging. It is not production-readiness approval. It is not live-billing approval. Use `npm run release:plan` and the production execution dossier for the current deploy-unit truth.

## 1. Pre-Commit Checks

| Check | Evidence | Result |
| --- | --- | --- |
| Branch is `main` or approved release branch before merge to `main` |  | BLOCKED |
| Commit SHA recorded |  | BLOCKED |
| Worktree clean before direct-main release |  | BLOCKED |
| PR/review evidence recorded, if used |  | BLOCKED |
| `npm run check:main-release-readiness` passed without `--allow-dirty` |  | BLOCKED |

## 2. Pre-Deploy Checks

| Check | Evidence | Result |
| --- | --- | --- |
| `npm run check:js` |  | BLOCKED |
| `npm run check:secrets` |  | BLOCKED |
| `npm run check:doc-currentness` |  | BLOCKED |
| `npm run validate:release` |  | BLOCKED |
| `npm run test:release-compat` |  | BLOCKED |
| `npm run test:release-plan` |  | BLOCKED |
| `npm run test:static-deploy-safety` |  | BLOCKED |
| `npm run check:static-deploy-safety` |  | BLOCKED |
| `npm run test:readiness-evidence` |  | BLOCKED |
| `npm run test:cloudflare-resource-model` |  | BLOCKED |
| `npm run test:readiness-dossier` |  | BLOCKED |
| `npm run test:rollback-drill` |  | BLOCKED |
| `npm run test:release-rc` |  | BLOCKED |
| `npm run test:rc-check` |  | BLOCKED |
| `npm run test:main-release-readiness` |  | BLOCKED |
| `npm run rc:check` final matrix reviewed |  | BLOCKED |
| `npm run release:rc` generated |  | BLOCKED |
| `npm run release:rc:markdown` generated |  | BLOCKED |
| `npm run cloudflare:resource-model` |  | BLOCKED |
| `npm run readiness:dossier` |  | BLOCKED |
| `npm run release:rollback-drill` |  | BLOCKED |
| `npm run release:preflight` |  | BLOCKED |
| `npm run release:plan` |  | BLOCKED |
| `git diff --check` |  | BLOCKED |
| `git status --short` clean |  | BLOCKED |

## 3. Expected Deploy Units

| Deploy Unit | Required? | Evidence |
| --- | --- | --- |
| Auth Worker | if `release:plan` reports runtime Auth changes |  |
| AI Worker | if `release:plan` reports AI Worker changes or Auth/AI caller-policy pairing |  |
| Contact Worker | if `release:plan` reports Contact Worker changes |  |
| Homepage ffmpeg processor | if `release:plan` reports `homepage-ffmpeg-processor` service changes |  |
| Static/pages | if `release:plan` reports static/Admin UI changes |  |
| Auth schema checkpoint from `config/release-compat.json` | required before dependent Auth Worker code |  |
| Stripe dashboard/API change | no, unless separately approved operator canary evidence exists |  |
| Cloudflare dashboard/settings/secrets change | no, unless separately approved and recorded |  |

If `npm run release:plan` for the reviewed runtime diff reports unexpected deploy units, stop and reconcile before deploying.

Static Pages auto-deploy is guarded by release-plan safety. The Pages workflow may continue automatically only for validation-only or static/pages-only release plans. Push runs compare `github.event.before` to `github.sha`; manual runs compare `release_plan_base_ref` to the workflow SHA. On push, mixed releases with Worker deploys, auth D1 schema applies, required manual prerequisites, binding/config/runtime-coupled changes, or other classified non-static deploy steps are intentionally skipped before Pages artifact upload, not deployed. Malformed release-plan output, uncategorized files, or ambiguous base/head context still fail closed.

Manual `workflow_dispatch` acknowledgement, if used, must be exactly `I_CONFIRM_RELEASE_PLAN_DEPENDENCIES_HANDLED`, must happen only after the operator handles the release-plan deploy order, is ignored on push, and does not prove production readiness, live billing readiness, deploy approval, or live evidence.

## 4. Production Execution Framework Evidence

| Check | Evidence | Result |
| --- | --- | --- |
| Release Candidate Go/No-Go manifest generated and final verdict remains production-blocked |  | BLOCKED |
| Final RC validation matrix reviewed; deploy/migration/live commands absent |  | BLOCKED |
| Readiness dossier generated locally and final verdict remains blocked |  | BLOCKED |
| Cloudflare resource model generated locally and repo-vs-live distinction reviewed |  | BLOCKED |
| Rollback drill generated and placeholders completed |  | BLOCKED |
| Live-read-only plan reviewed as opt-in and GET-only by default |  | BLOCKED |
| No deploy/migration/Cloudflare mutation/rollback execution command was run by these tools |  | BLOCKED |

## 5. Required Production D1 Migration Evidence Through Latest Release Contract

Required latest auth migration: read `release.schemaCheckpoints.auth.latest` from `config/release-compat.json` and confirm the same checkpoint in `npm run release:plan`.

| Check | Evidence | Result |
| --- | --- | --- |
| Production auth D1 migration status checked by operator |  | BLOCKED |
| Latest release-contract migration present/applied |  | BLOCKED |
| Evidence records migration names/status only |  | BLOCKED |
| No remote migration was run by Codex or automation from this checklist |  | BLOCKED |
| Release-contract latest migration verified before auth Worker deploy |  | BLOCKED |

## 6. Auth Worker Deploy Verification

Operator action only. Do not deploy from this checklist automatically.

| Check | Evidence | Result |
| --- | --- | --- |
| Auth Worker deployed from reviewed main commit |  | BLOCKED |
| Auth Worker deployment id/version recorded if available |  | BLOCKED |
| Member AI usage routes see required usage-attempt tables before Worker deploy |  | BLOCKED |
| Admin AI/budget routes see required budget metadata/switch/cap tables before Worker deploy |  | BLOCKED |
| Tenant asset/manual-review/reset/data-lifecycle routes see migrations `0056`, `0057`, `0058`, and `0059` before Worker deploy |  | BLOCKED |
| `/api/admin/billing/reviews` available to admin only |  | BLOCKED |
| `/api/admin/billing/reviews/:id` available to admin only |  | BLOCKED |
| `/api/admin/billing/reviews/:id/resolution` write route remains admin/MFA/same-origin/idempotency guarded |  | BLOCKED |
| `/api/admin/billing/reconciliation` available to admin only |  | BLOCKED |
| Live billing flags remain disabled unless separately approved |  | BLOCKED |

## 7. Static/Pages Deploy Verification

Operator action only. Do not deploy from this checklist automatically.

| Check | Evidence | Result |
| --- | --- | --- |
| Static/pages deployed from reviewed main commit |  | BLOCKED |
| Release-plan static deploy guard allowed validation-only/static-only deploy, skipped push deploy until dependencies were handled, or blocked unsafe manual dispatch |  | BLOCKED |
| If workflow_dispatch acknowledgement was used, exact acknowledgement and dependency evidence were recorded |  | BLOCKED |
| Pages deployment/build id recorded if available |  | BLOCKED |
| Admin Control Plane loads |  | BLOCKED |
| Production execution local evidence commands are run and outputs recorded |  | BLOCKED |
| Billing Review Queue UI appears |  | BLOCKED |
| Billing Reconciliation UI appears |  | BLOCKED |
| AI Budget Switches panel shows safe master/app/effective status and does not expose Cloudflare values |  | BLOCKED |
| AI Budget Switch update requires confirmation, bounded reason, and `Idempotency-Key` |  | BLOCKED |
| Safety copy says review/reconciliation is operator-only and read-only where applicable |  | BLOCKED |

## 8. Admin Login/MFA Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Admin login works for approved operator account |  | BLOCKED |
| Admin MFA is enforced where required |  | BLOCKED |
| Non-admin cannot access admin billing review/reconciliation endpoints |  | BLOCKED |
| Evidence redacts user data, cookies, tokens, and MFA material |  | BLOCKED |

## 9. Billing Review Queue Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Admin list request | 200 sanitized list |  | BLOCKED |
| Non-admin list request | 401/403 |  | BLOCKED |
| `review_state=needs_review` filter | filtered list |  | BLOCKED |
| `review_state=blocked` filter | filtered list |  | BLOCKED |
| `provider=stripe&provider_mode=live` filter | filtered list |  | BLOCKED |
| Response excludes raw payload/signature/secret/card/payment method data | none rendered |  | BLOCKED |

## 10. Billing Review Detail Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Admin detail request | 200 sanitized detail |  | BLOCKED |
| Non-admin detail request | 401/403 |  | BLOCKED |
| Safe identifiers visible | provider event/charge/refund/dispute/session ids only when safe |  | BLOCKED |
| Blocked dispute warning visible when applicable | warning present |  | BLOCKED |
| Side effects disabled represented | false/safe status |  | BLOCKED |
| No raw payload/signature/secret/card/payment method data | none rendered |  | BLOCKED |

## 11. Billing Review Resolution Smoke Checks

Run only on approved test review data. This route writes review metadata only.

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Missing `Idempotency-Key` rejected | 400/409 style failure |  | BLOCKED |
| Missing note rejected | 400 style failure |  | BLOCKED |
| Approved admin can mark `resolved` | 200 |  | BLOCKED |
| Approved admin can mark `dismissed` | 200 |  | BLOCKED |
| Duplicate same-key request is idempotent | same safe result |  | BLOCKED |
| Conflicting same-key request rejected | conflict |  | BLOCKED |
| No credit ledger change | unchanged |  | BLOCKED |
| No subscription state change | unchanged |  | BLOCKED |
| No Stripe action | none |  | BLOCKED |

## 12. Billing Reconciliation Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Admin reconciliation request | 200 |  | BLOCKED |
| Non-admin reconciliation request | 401/403 |  | BLOCKED |
| `source` is local D1 only | `local_d1_only` |  | BLOCKED |
| `verdict` remains blocked | `blocked` |  | BLOCKED |
| `productionReadiness` remains blocked | `blocked` |  | BLOCKED |
| `liveBillingReadiness` remains blocked | `blocked` |  | BLOCKED |
| Sections include billing reviews/checkouts/ledger/subscriptions when data exists | bounded summaries |  | BLOCKED |
| No raw payload/signature/secret/card/payment method data | none rendered |  | BLOCKED |
| No Stripe API call | none |  | BLOCKED |

## 13. Admin Control Plane UI Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Billing Review Queue section renders | visible |  | BLOCKED |
| Filters are usable | no overlap or broken layout |  | BLOCKED |
| Detail panel renders safe metadata | sanitized only |  | BLOCKED |
| Resolve/dismiss requires note and confirmation | enforced |  | BLOCKED |
| Billing Reconciliation panel renders | generated timestamp, summaries, sections |  | BLOCKED |
| Readiness Production Execution Framework renders | dossier/resource model/post-deploy/rollback sections |  | BLOCKED |
| Blocked/live billing warning visible | visible |  | BLOCKED |
| Read-only/no-Stripe/no-remediation copy visible | visible |  | BLOCKED |
| Error/unavailable states are safe | readable, no fake success |  | BLOCKED |
| Mobile layout has no overlapping badges/text | verified |  | BLOCKED |

## 14. Member AI Gateway Smoke Checks

Run only for member AI routes in scope for the reviewed release plan. These checks must not be used to claim admin AI, platform/background AI, internal AI Worker routes, or org-scoped routes unless those surfaces are explicitly in scope.

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Missing `Idempotency-Key` | rejected before provider call |  | BLOCKED |
| Malformed `Idempotency-Key` | rejected before provider call |  | BLOCKED |
| Valid key with sufficient credits | success or safe provider error |  | BLOCKED |
| Same key and same request | no duplicate debit; replay/suppression when temp result is available |  | BLOCKED |
| Same key and different request | idempotency conflict before provider call |  | BLOCKED |
| Insufficient credits, if safely testable | rejected before provider call |  | BLOCKED |
| Provider failure no-charge, if tested only with approved mocks/non-live controls | no member credit debit |  | BLOCKED |
| Org-scoped image behavior | unchanged existing org attempt path |  | BLOCKED |
| Admin legacy/no-org image behavior | unchanged/exempt as documented |  | BLOCKED |

## 15. No Raw Payload/Signature/Secret/Card Rendering Checks

Record `not observed` or a redacted field-name issue only. Do not paste forbidden values.

| Forbidden Output | API Result | UI Result | Result |
| --- | --- | --- | --- |
| Raw webhook payload |  |  | BLOCKED |
| Raw Stripe signature |  |  | BLOCKED |
| Webhook/API secret |  |  | BLOCKED |
| Cookie/session token |  |  | BLOCKED |
| Card number/fingerprint |  |  | BLOCKED |
| Payment method detail |  |  | BLOCKED |
| Unredacted customer PII |  |  | BLOCKED |

## 16. No Stripe Action Checks

| Check | Evidence | Result |
| --- | --- | --- |
| No Stripe refund API call |  | BLOCKED |
| No Stripe dispute action |  | BLOCKED |
| No Stripe chargeback remediation |  | BLOCKED |
| No Stripe payment retry |  | BLOCKED |
| No subscription cancellation call |  | BLOCKED |
| UI has no Stripe/remediation action buttons |  | BLOCKED |

## 17. No Credit Mutation Checks

| Check | Evidence | Result |
| --- | --- | --- |
| Billing review list/detail does not mutate member credits |  | BLOCKED |
| Billing reconciliation report does not mutate member credits |  | BLOCKED |
| Billing reconciliation report does not mutate org credits |  | BLOCKED |
| Review resolution does not create credit ledger entries |  | BLOCKED |
| Review resolution does not alter subscription state |  | BLOCKED |
| Rollback plan does not include credit ledger mutation |  | BLOCKED |
| Rollback plan does not edit production D1 tables or delete AI attempt rows |  | BLOCKED |

## 18. Evidence Collection Command

Local main-release gate:

```bash
npm run check:main-release-readiness -- --markdown
```

Local production execution framework:

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

Live read-only evidence collector:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://bitbi.ai/ \
  --auth-worker-url https://bitbi.ai/ \
  --ai-worker-url https://<live-ai-worker-origin>/ \
  --contact-worker-url https://contact.bitbi.ai/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-main-readiness.md
```

These commands do not deploy, run remote migrations, call Stripe/providers, mutate Cloudflare, execute rollback, or prove production/live billing readiness.

## 19. Rollback Notes

| Rollback Item | Evidence | Result |
| --- | --- | --- |
| Previous auth Worker version identified |  | BLOCKED |
| Previous AI/contact Worker versions identified if affected |  | BLOCKED |
| Previous static/pages deployment identified |  | BLOCKED |
| `npm run release:rollback-drill` completed as a non-executing artifact |  | BLOCKED |
| Live billing flags remain disabled |  | BLOCKED |
| Billing provider/review/ledger/subscription records will not be deleted |  | BLOCKED |
| Member AI attempt rows will not be deleted |  | BLOCKED |
| Migrations through `0059` remain additive/forward-only |  | BLOCKED |
| Rollback owner and communication channel recorded |  | BLOCKED |

## 20. Final Operator Verdict

Final verdict:

Rationale:

Operator:

Date:

Commit:

Evidence links:

Remaining blockers:
