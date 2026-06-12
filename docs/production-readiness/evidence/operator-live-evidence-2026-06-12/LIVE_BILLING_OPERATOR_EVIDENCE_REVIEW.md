# BITBI Live Billing Operator Evidence Review

Date reviewed: 2026-06-12

Reviewed branch: `main`

Reviewed HEAD: `d5c0bf068b8682e2f0d3db0857d7beee2669c0c9`

Review status: **LIVE BILLING READINESS NOT TRANSITIONED**

This review records the final repo-side evidence assessment for the live billing operator canary. It does not contain raw Stripe payloads, webhook signatures, portal session URLs, card data, cookies, bearer tokens, Cloudflare secrets, Stripe secrets, or customer identifiers.

## Review Scope

The operator reported that:

- The Stripe Customer Portal opens from the member Credits page through the configured `pay.bitbi.ai` Stripe portal domain.
- Stripe subscription/payment and BITBI member billing state appear operational.

Those statements are useful operational context, but this repository does not currently include sanitized artifacts proving every required live-billing evidence item. Under the repo readiness policy, operator statements alone are not enough to mark Live Billing Readiness green.

## Evidence Matrix

| Evidence item | Review status | Artifact-backed review result | Notes |
| --- | --- | --- | --- |
| Customer Portal canary status | operator-reported working; artifact incomplete | pending_artifact_review | The operator reported successful portal access through `pay.bitbi.ai`. No committed sanitized Admin export, screenshot summary, or portal canary artifact is present in this package. |
| Stripe webhook delivery status | not proven by committed artifact | pending_artifact_review | No sanitized Stripe Dashboard delivery summary or Admin Billing Events export proving successful live 2xx webhook deliveries is present. |
| BITBI Admin Billing Events status | not proven by committed artifact | pending_artifact_review | No sanitized Admin Billing Events export proving the relevant live Stripe events is present. |
| Subscription state active for member | operator-reported operational; artifact incomplete | pending_artifact_review | No sanitized member billing/admin evidence proving active subscription state is present. |
| `invoice.paid` or `invoice.payment_succeeded` evidence | not proven by committed artifact | pending_artifact_review | No sanitized invoice event/top-up evidence is present. |
| Credit-pack canary status | not proven by committed artifact | pending_artifact_review | No sanitized credit-pack purchase and exactly-once grant evidence is present. |
| Duplicate credit-pack grant prevention | not proven by committed artifact | pending_artifact_review | No duplicate webhook/idempotency replay evidence is present. |
| Reconciliation critical mismatch status | not proven by committed artifact | pending_artifact_review | No sanitized reconciliation export proving no critical live-billing mismatch is present. |
| Billing Reviews blocked/critical status | not proven by committed artifact | pending_artifact_review | No sanitized Billing Reviews export proving no unresolved blocked/critical item is present. |
| Admin Live Billing redacted JSON/Markdown evidence | not present in this package | pending_artifact_review | Existing package contains a go-live plan and validation matrix, not a post-canary Admin export. |
| Secret/raw data redaction | repo scan passed before this review package | pass_repo_scan | `npm run check:secrets` is part of the validation matrix for this review. This package intentionally includes no raw secrets or raw Stripe data. |

## Final Operator Decision

| Decision | Status | Reason |
| --- | --- | --- |
| Code support for live billing canary | ready_for_operator_canary | Prior repo validation and source review support a controlled operator canary path. |
| Live Billing Readiness | blocked_pending_artifact_backed_evidence | Required live evidence is not fully attached as sanitized artifacts in this package. |
| Production Readiness | blocked | This review covers billing only. Non-billing production evidence is outside this package and remains blocked unless separately proven. |
| Tax/invoice readiness | disabled_pending_review | Optional Stripe Tax, tax ID collection, and invoice creation flags remain disabled unless explicitly approved later. |

## Required Evidence To Transition Live Billing Green

Attach sanitized artifacts under this dated package or another classified evidence package showing all of the following:

1. Customer Portal canary opened from the member Credits page, with no raw portal session URL committed.
2. Stripe live webhook deliveries show successful 2xx delivery for relevant events.
3. Admin Billing Events show the corresponding live Stripe events.
4. Member subscription state is active.
5. `invoice.paid` or `invoice.payment_succeeded` exists for the BITBI Pro canary and the subscription top-up is exactly-once.
6. Credit-pack purchase evidence exists, credits were granted only after verified webhook handling, and duplicate delivery did not double-grant.
7. Reconciliation has no critical live-billing mismatch.
8. Billing Reviews has no unresolved blocked or critical item.
9. Admin Live Billing JSON and Markdown exports are redacted.
10. `npm run check:secrets` passes after attaching the evidence package.

Only after those artifacts are present and reviewed should Admin Live Billing wording/status move Live Billing Readiness to operator-reviewed/green.

## Current Readiness Statement

Allowed claim:

- Repository support is ready for operator live-billing canary.

Blocked claims:

- Live Billing Readiness is not green from this review.
- Production Readiness remains blocked.
- Stripe live completion is not claimed.
- Tax, invoice, accounting, and legal compliance completion are not claimed.

