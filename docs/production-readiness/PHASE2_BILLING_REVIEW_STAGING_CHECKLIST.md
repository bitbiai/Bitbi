# Phase 2 Billing Review/Reconciliation Staging Checklist

Last updated: 2026-05-15

Status: **planning and evidence capture only**. This checklist does not approve production deployment, live billing, Stripe remediation, credit clawback, or automatic reconciliation.

Scope covered:

- Phase 2.1 Stripe live lifecycle review classification.
- Phase 2.2 Admin Billing Review Queue API and manual resolution metadata.
- Phase 2.3 Admin Control Plane Billing Review Queue UI.
- Phase 2.4 read-only Billing Reconciliation API and UI.

The checklist is operator-run and staging-first. Do not run production deploys, remote migrations, Stripe API actions, Cloudflare mutations, GitHub settings changes, DNS/WAF changes, D1/R2/Queue writes, Worker mutations, or secret changes from this document.

## 1. Pre-Deploy Local Checks

Run these locally before requesting any staging deploy window:

```bash
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run check:route-policies
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:readiness-evidence
npm run test:static
npm run test:workers
npm run release:preflight
npm run release:plan
git diff --check
git status --short
```

Record the command output in the evidence pack with:

- date and time
- operator
- branch
- commit
- dirty/clean worktree summary
- pass/fail result

Do not paste secret values or raw cookies.

## 2. Required Commit Evidence

Record the exact commit intended for staging:

| Item | Evidence |
| --- | --- |
| Branch |  |
| Commit SHA |  |
| `git status --short` before deploy request |  |
| Required PR/review link |  |
| Release-plan output attached | yes / no |
| Evidence pack path/link |  |

Do not deploy uncommitted local-only work unless the staging process explicitly supports a reviewed artifact. If the worktree is dirty, document why and list file categories only.

## 3. Expected Release Plan

For Phase 2.1-2.4 billing review/reconciliation work, the expected impacted deploy units are:

| Deploy Unit | Expected? | Reason |
| --- | --- | --- |
| Auth Worker | yes | Billing review/reconciliation API and route policy live in `workers/auth`. |
| Static/Pages | yes | Admin Control Plane billing review/reconciliation UI lives in static assets. |
| Auth D1 schema apply | no new Phase 2.4 schema apply | Phase 2.4 added a computed read-only report and no migration. Existing environments must still be migrated through `0047_add_member_subscriptions_and_credit_buckets.sql`. |
| AI Worker | no | No Phase 2.1-2.4 AI Worker runtime change. |
| Contact Worker | no | No Phase 2.1-2.4 Contact Worker runtime change. |
| Stripe dashboard/API | no | No Stripe action is required or approved by this checklist. |

If `npm run release:plan` reports different deploy units, stop and reconcile the difference before staging.

## 4. Required Migration Baseline

Before staging API/UI smoke checks, the staging auth D1 database must already have migrations applied through:

```text
0047_add_member_subscriptions_and_credit_buckets.sql
```

Evidence requirements:

- Record migration names/status only.
- Do not run remote migrations from this checklist.
- Do not paste Cloudflare credentials.
- If staging is not migrated through `0047`, mark the checklist `BLOCKED`.

## 5. Auth Worker Staging Deploy Verification

Operator-run, after an approved staging deploy by the normal release process:

| Check | Evidence | Result |
| --- | --- | --- |
| Auth Worker deployed commit matches requested commit |  | BLOCKED |
| Worker route includes `/api/admin/billing/reviews` |  | BLOCKED |
| Worker route includes `/api/admin/billing/reviews/:id` |  | BLOCKED |
| Worker route includes `/api/admin/billing/reviews/:id/resolution` |  | BLOCKED |
| Worker route includes `/api/admin/billing/reconciliation` |  | BLOCKED |
| Admin/MFA protections still enforced |  | BLOCKED |
| Same-origin/write protections still enforced for resolution route |  | BLOCKED |
| No Stripe action endpoint was added for remediation |  | BLOCKED |

Do not verify by changing production. Use staging URLs and staging admin accounts only.

## 6. Static/Pages Staging Deploy Verification

Operator-run, after the approved static staging deploy:

| Check | Evidence | Result |
| --- | --- | --- |
| Static deployed commit matches requested commit |  | BLOCKED |
| Admin Control Plane loads |  | BLOCKED |
| Billing Review Queue section appears |  | BLOCKED |
| Billing Reconciliation panel appears |  | BLOCKED |
| Static assets load without console errors related to billing review/reconciliation |  | BLOCKED |
| UI displays production/live billing blocked safety copy |  | BLOCKED |
| UI displays read-only/local-only reconciliation copy |  | BLOCKED |

Screenshots may be attached only after redacting user data, cookies, tokens, and sensitive account details.

## 7. Admin Authentication and MFA Prerequisites

| Prerequisite | Evidence | Result |
| --- | --- | --- |
| Staging admin user exists |  | BLOCKED |
| Admin MFA is enrolled/enforced where required |  | BLOCKED |
| Non-admin staging user exists for denial checks |  | BLOCKED |
| Test data can be inspected without exposing customer data |  | BLOCKED |

Never paste session cookies, bearer tokens, recovery codes, MFA seeds, or raw user PII in evidence.

## 8. Billing Review Queue API Smoke Checks

Use a staging admin session. Prefer browser DevTools or a local cookie file that is not committed. Do not paste cookie values.

Example shape, with a local cookie file path only:

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reviews?provider=stripe&provider_mode=live&review_state=needs_review&limit=20" \
  | jq '{ok, total, count: (.events | length), eventTypes: [.events[]?.eventType], reviewStates: [.events[]?.reviewState]}'
```

Evidence to record:

| Check | Expected | Result |
| --- | --- | --- |
| Non-admin cannot list reviews | 403/401 | BLOCKED |
| Admin can list reviews | 200 with sanitized event list | BLOCKED |
| `needs_review` filter works | only matching states | BLOCKED |
| `blocked` filter works | blocked disputes visible if present | BLOCKED |
| Response has no raw payload/signature/secret/card/payment method fields | none present | BLOCKED |

## 9. Billing Review Detail API Smoke Checks

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reviews/<review-event-id>" \
  | jq '{ok, eventType, reviewState, reviewReason, recommendedAction, safeIdentifiers, sideEffectsEnabled}'
```

Evidence to record:

| Check | Expected | Result |
| --- | --- | --- |
| Detail is admin-only | non-admin denied | BLOCKED |
| Detail returns sanitized metadata | no raw payloads or signatures | BLOCKED |
| Blocked dispute warning is represented | warning/blocked metadata present | BLOCKED |
| Side effects remain disabled | `false` or equivalent safe value | BLOCKED |

## 10. Billing Review Resolution API Smoke Checks

The resolution route writes only review metadata. It must not mutate credits, subscriptions, Stripe, checkout sessions, or provider events.

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

Evidence to record:

| Check | Expected | Result |
| --- | --- | --- |
| Missing `Idempotency-Key` rejected | 400/409 style failure | BLOCKED |
| Missing note rejected | 400 style failure | BLOCKED |
| Admin can mark `resolved` or `dismissed` with a bounded note | 200 | BLOCKED |
| Duplicate request with same key is idempotent | same safe result | BLOCKED |
| Conflicting request with same key is rejected | conflict | BLOCKED |
| Credit balances unchanged | before/after report unchanged | BLOCKED |
| No Stripe call occurs | no Stripe evidence/action | BLOCKED |

Use only staging data created for smoke tests. Do not resolve real customer billing reviews during this staging checklist unless an approved billing owner explicitly instructs it.

## 11. Billing Reconciliation API Smoke Checks

```bash
curl --fail --silent --show-error \
  --cookie "$BITBI_STAGING_ADMIN_COOKIE_FILE" \
  "https://<staging-auth-origin>/api/admin/billing/reconciliation" \
  | jq '{ok, source, verdict, productionReadiness, liveBillingReadiness, generatedAt, sectionIds: [.sections[]?.id], notes}'
```

Evidence to record:

| Check | Expected | Result |
| --- | --- | --- |
| Non-admin cannot access report | 403/401 | BLOCKED |
| Admin can access report | 200 | BLOCKED |
| Source is local D1 only | `local_d1_only` | BLOCKED |
| Verdict remains blocked | `blocked` | BLOCKED |
| Production/live billing readiness remains blocked | `blocked` | BLOCKED |
| Critical/warning sections render when local data indicates risk | severity present | BLOCKED |
| Response has no raw payload/signature/secret/card/payment method fields | none present | BLOCKED |
| Report does not call Stripe | no Stripe request/action evidence | BLOCKED |

## 12. Admin Control Plane UI Smoke Checks

| Check | Expected | Result |
| --- | --- | --- |
| Billing Review Queue renders | visible section | BLOCKED |
| Review-state filter works | all/needs_review/blocked/informational/resolved/dismissed | BLOCKED |
| Review detail panel loads sanitized fields only | no raw payload/signature/secret/card fields | BLOCKED |
| Resolve/dismiss requires note and confirmation | enforced | BLOCKED |
| Duplicate submit is prevented | button/loading state or idempotent result | BLOCKED |
| Billing Reconciliation panel renders | generated timestamp and summaries visible | BLOCKED |
| Reconciliation critical/warning items are readable | severity visible | BLOCKED |
| Error/unavailable states are safe | readable, no fake success | BLOCKED |
| Mobile layout has no overlapping badges/text | verified viewport | BLOCKED |

## 13. Raw Payload, Secret, Card, and Signature Rendering Checks

Search API responses and UI screens for forbidden fields/values:

- raw webhook payloads
- raw Stripe signatures
- webhook secrets
- API keys
- cookies/session tokens
- card numbers
- card fingerprints
- payment method details
- unredacted customer PII

Record only `not observed` or the safe field name that needs investigation. Do not paste the forbidden value.

## 14. No Credit Mutation Checks

Before and after review resolution smoke tests, collect safe local/admin evidence that balances did not change:

| Check | Expected | Result |
| --- | --- | --- |
| Member credit balance unchanged by review list/detail/reconciliation | unchanged | BLOCKED |
| Organization credit balance unchanged by review list/detail/reconciliation | unchanged | BLOCKED |
| Review resolution does not create credit ledger entries | unchanged ledger count for tested account/org | BLOCKED |
| Review resolution does not alter subscription state | unchanged for tested subscription | BLOCKED |

Do not run credit grant, reversal, clawback, or subscription cancellation actions.

## 15. No Stripe Action Checks

Evidence must show the staging workflow did not perform Stripe remediation:

| Check | Expected | Result |
| --- | --- | --- |
| No Stripe refund API call | none | BLOCKED |
| No Stripe dispute action | none | BLOCKED |
| No Stripe chargeback remediation | none | BLOCKED |
| No Stripe payment retry action | none | BLOCKED |
| No subscription cancellation call | none | BLOCKED |
| UI has no remediation action buttons | none visible | BLOCKED |

If Stripe dashboard evidence is used, redact all customer data and secret/account values.

## 16. Evidence Collection Command

Local-only evidence:

```bash
npm run readiness:evidence -- --markdown
```

Staging read-only HTTP evidence, using explicit URLs only:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://<staging-static-origin>/ \
  --auth-worker-url https://<staging-auth-origin>/ \
  --ai-worker-url https://<staging-ai-origin>/ \
  --contact-worker-url https://<staging-contact-origin>/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-staging-readiness.md
```

The helper must keep the verdict `BLOCKED`. Passing read-only health/header checks does not prove live billing readiness.

## 17. Rollback Notes

Rollback planning must be ready before staging:

| Rollback Item | Owner | Evidence |
| --- | --- | --- |
| Auth Worker previous staging version identified |  |  |
| Static/Pages previous staging artifact/commit identified |  |  |
| No Phase 2.4 migration rollback needed |  |  |
| Feature flags/live billing remain disabled |  |  |
| Operator contact for admin/billing smoke rollback |  |  |

Rollback must not delete billing events, review records, ledgers, subscriptions, or checkout records.

## 18. Final Verdict Template

Final staging verdict: **BLOCKED**

Allowed staging checklist outcomes:

- **BLOCKED**: missing evidence, failed smoke, missing migration baseline, unsafe output, unexpected mutation, or unresolved operator concern.
- **STAGING EVIDENCE COLLECTED**: all staging smoke evidence attached, no forbidden output observed, no credit/Stripe mutation observed. This is not production readiness.

Production readiness: **BLOCKED**

Live billing readiness: **BLOCKED**

Operator:

Date:

Commit:

Evidence links:

Remaining blockers:
