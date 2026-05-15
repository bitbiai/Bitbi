# Main-Only Release Checklist

Last updated: 2026-05-15

Default verdict: **BLOCKED**

Allowed final verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

This checklist is for direct deployment from `main`. It is not staging. It is not production-readiness approval. It is not live-billing approval. For the Phase 3.4 member personal image AI Cost Gateway pilot, also use `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md`.

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
| `npm run test:readiness-evidence` |  | BLOCKED |
| `npm run test:main-release-readiness` |  | BLOCKED |
| `npm run release:preflight` |  | BLOCKED |
| `npm run release:plan` |  | BLOCKED |
| `git diff --check` |  | BLOCKED |
| `git status --short` clean |  | BLOCKED |

## 3. Expected Deploy Units

For the existing Phase 2.1-2.4 runtime changes to be visible live:

| Deploy Unit | Required? | Evidence |
| --- | --- | --- |
| Auth Worker | yes |  |
| Static/pages | yes |  |
| New D1 migration from Phase 2.1-2.5 | no | No new migration was added by these phases. |
| Stripe dashboard/API change | no |  |
| Cloudflare dashboard/settings/secrets change | no, unless separately approved |  |

For the Phase 3.4 member personal image gateway pilot:

| Deploy Unit | Required? | Evidence |
| --- | --- | --- |
| Auth schema checkpoint `0048_add_member_ai_usage_attempts.sql` | yes |  |
| Auth Worker | yes |  |
| Static/pages | no, unless `release:plan` reports other reviewed static changes |  |
| AI Worker/contact Worker | no |  |
| Stripe dashboard/API change | no |  |
| Cloudflare dashboard/settings/secrets change | no, unless separately approved |  |

If `npm run release:plan` for the reviewed runtime diff reports unexpected deploy units, stop and reconcile before deploying.

## 4. Required Production D1 Migration Evidence Through 0048

Required latest auth migration:

```text
0048_add_member_ai_usage_attempts.sql
```

| Check | Evidence | Result |
| --- | --- | --- |
| Production auth D1 migration status checked by operator |  | BLOCKED |
| `0048_add_member_ai_usage_attempts.sql` present/applied |  | BLOCKED |
| Evidence records migration names/status only |  | BLOCKED |
| No remote migration was run by Codex or automation from this checklist |  | BLOCKED |
| Migration `0048` verified before auth Worker deploy |  | BLOCKED |

## 5. Auth Worker Deploy Verification

Operator action only. Do not deploy from this checklist automatically.

| Check | Evidence | Result |
| --- | --- | --- |
| Auth Worker deployed from reviewed main commit |  | BLOCKED |
| Auth Worker deployment id/version recorded if available |  | BLOCKED |
| Phase 3.4 member personal image route sees migration `0048` table before Worker deploy |  | BLOCKED |
| `/api/admin/billing/reviews` available to admin only |  | BLOCKED |
| `/api/admin/billing/reviews/:id` available to admin only |  | BLOCKED |
| `/api/admin/billing/reviews/:id/resolution` write route remains admin/MFA/same-origin/idempotency guarded |  | BLOCKED |
| `/api/admin/billing/reconciliation` available to admin only |  | BLOCKED |
| Live billing flags remain disabled unless separately approved |  | BLOCKED |

## 6. Static/Pages Deploy Verification

Operator action only. Do not deploy from this checklist automatically.

| Check | Evidence | Result |
| --- | --- | --- |
| Static/pages deployed from reviewed main commit |  | BLOCKED |
| Pages deployment/build id recorded if available |  | BLOCKED |
| Admin Control Plane loads |  | BLOCKED |
| Billing Review Queue UI appears |  | BLOCKED |
| Billing Reconciliation UI appears |  | BLOCKED |
| Safety copy says review/reconciliation is operator-only and read-only where applicable |  | BLOCKED |

## 7. Admin Login/MFA Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Admin login works for approved operator account |  | BLOCKED |
| Admin MFA is enforced where required |  | BLOCKED |
| Non-admin cannot access admin billing review/reconciliation endpoints |  | BLOCKED |
| Evidence redacts user data, cookies, tokens, and MFA material |  | BLOCKED |

## 8. Billing Review Queue Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Admin list request | 200 sanitized list |  | BLOCKED |
| Non-admin list request | 401/403 |  | BLOCKED |
| `review_state=needs_review` filter | filtered list |  | BLOCKED |
| `review_state=blocked` filter | filtered list |  | BLOCKED |
| `provider=stripe&provider_mode=live` filter | filtered list |  | BLOCKED |
| Response excludes raw payload/signature/secret/card/payment method data | none rendered |  | BLOCKED |

## 9. Billing Review Detail Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Admin detail request | 200 sanitized detail |  | BLOCKED |
| Non-admin detail request | 401/403 |  | BLOCKED |
| Safe identifiers visible | provider event/charge/refund/dispute/session ids only when safe |  | BLOCKED |
| Blocked dispute warning visible when applicable | warning present |  | BLOCKED |
| Side effects disabled represented | false/safe status |  | BLOCKED |
| No raw payload/signature/secret/card/payment method data | none rendered |  | BLOCKED |

## 10. Billing Review Resolution Smoke Checks

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

## 11. Billing Reconciliation Smoke Checks

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

## 12. Admin Control Plane UI Smoke Checks

| Check | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Billing Review Queue section renders | visible |  | BLOCKED |
| Filters are usable | no overlap or broken layout |  | BLOCKED |
| Detail panel renders safe metadata | sanitized only |  | BLOCKED |
| Resolve/dismiss requires note and confirmation | enforced |  | BLOCKED |
| Billing Reconciliation panel renders | generated timestamp, summaries, sections |  | BLOCKED |
| Blocked/live billing warning visible | visible |  | BLOCKED |
| Read-only/no-Stripe/no-remediation copy visible | visible |  | BLOCKED |
| Error/unavailable states are safe | readable, no fake success |  | BLOCKED |
| Mobile layout has no overlapping badges/text | verified |  | BLOCKED |

## 13. Phase 3.4 Member Personal Image Gateway Smoke Checks

These checks are for `POST /api/ai/generate-image` without organization context only. They must not be used to claim music, video, admin AI, platform/background AI, internal AI Worker routes, or org-scoped routes are migrated.

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

## 14. No Raw Payload/Signature/Secret/Card Rendering Checks

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

## 15. No Stripe Action Checks

| Check | Evidence | Result |
| --- | --- | --- |
| No Stripe refund API call |  | BLOCKED |
| No Stripe dispute action |  | BLOCKED |
| No Stripe chargeback remediation |  | BLOCKED |
| No Stripe payment retry |  | BLOCKED |
| No subscription cancellation call |  | BLOCKED |
| UI has no Stripe/remediation action buttons |  | BLOCKED |

## 16. No Credit Mutation Checks

| Check | Evidence | Result |
| --- | --- | --- |
| Billing review list/detail does not mutate member credits |  | BLOCKED |
| Billing reconciliation report does not mutate member credits |  | BLOCKED |
| Billing reconciliation report does not mutate org credits |  | BLOCKED |
| Review resolution does not create credit ledger entries |  | BLOCKED |
| Review resolution does not alter subscription state |  | BLOCKED |
| Rollback plan does not include credit ledger mutation |  | BLOCKED |
| Phase 3.4 rollback plan does not delete `member_ai_usage_attempts` rows |  | BLOCKED |

## 17. Evidence Collection Command

Local main-release gate:

```bash
npm run check:main-release-readiness -- --markdown
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

These commands do not deploy, migrate, call Stripe, mutate Cloudflare, or prove production/live billing readiness.

## 18. Rollback Notes

| Rollback Item | Evidence | Result |
| --- | --- | --- |
| Previous auth Worker version identified |  | BLOCKED |
| Previous static/pages deployment identified |  | BLOCKED |
| Live billing flags remain disabled |  | BLOCKED |
| Billing provider/review/ledger/subscription records will not be deleted |  | BLOCKED |
| Member AI attempt rows will not be deleted |  | BLOCKED |
| Migration `0048` remains additive/forward-only |  | BLOCKED |
| Rollback owner and communication channel recorded |  | BLOCKED |

## 19. Final Operator Verdict

Final verdict:

Rationale:

Operator:

Date:

Commit:

Evidence links:

Remaining blockers:
