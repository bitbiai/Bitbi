# BITBI Live Billing Operator Evidence Review

Date reviewed: 2026-06-12

Reviewed branch: `main`

Reviewed HEAD: `d5c0bf068b8682e2f0d3db0857d7beee2669c0c9`

Review status: **LIVE BILLING READINESS NOT TRANSITIONED**

This review records the final repo-side evidence assessment for the live billing operator canary. It does not contain raw Stripe payloads, webhook signatures, portal session URLs, card data, cookies, bearer tokens, Cloudflare secrets, Stripe secrets, or customer identifiers.

## Review Scope

The operator provided the following artifacts in `docs/production-readiness/evidence/bitbi-live-billing-evidence/`:

- Admin Live Billing JSON export.
- Admin Live Billing Markdown export.
- Four screenshots covering Admin Billing Events, Billing Reviews, Billing Reconciliation, and the member Credits/BITBI Pro view.

The safe extracted facts are recorded in:

- `admin-live-billing-export-redacted-summary.md`
- `live-billing-artifact-summary.md`
- `live-billing-artifact-summary.json`

The raw screenshots were not committed into the final package because they show user-facing names/avatars. The raw Admin JSON export was summarized instead of committed verbatim so full provider/internal event identifiers stay out of the final package.

The operator also reported that:

- The Stripe Customer Portal opens from the member Credits page through the configured `pay.bitbi.ai` Stripe portal domain.
- Stripe subscription/payment and BITBI member billing state appear operational.

Those statements are useful operational context, and the new artifacts show meaningful live-billing progress. They still do not prove every required live-billing evidence item. Under the repo readiness policy, operator statements plus partial screenshots are not enough to mark Live Billing Readiness green.

## Evidence Matrix

| Evidence item | Review status | Artifact-backed review result | Notes |
| --- | --- | --- | --- |
| Customer Portal canary status | operator-reported working; artifact incomplete | pending_artifact_review | The operator reported successful portal access through `pay.bitbi.ai`; the Credits screenshot shows the manage-billing button. No committed artifact proves an opened portal session on `pay.bitbi.ai`, and no full portal session URL is committed. |
| Stripe webhook delivery status | not proven by committed artifact | pending_artifact_review | Admin evidence shows live events reached BITBI, but no sanitized Stripe Dashboard delivery summary proving successful live 2xx webhook deliveries is present. |
| BITBI Admin Billing Events status | live sanitized events visible | partial_pass | Admin export shows 25 live Stripe events, live provider mode, `verified_live_signature`, and no raw payload/signature rendering. It also shows failed/planned/ignored statuses, so this is not a final readiness pass. |
| Subscription state active for member | active state visible | partial_pass | Credits screenshot and reconciliation summary show 1 active subscription. Full invoice-paid top-up ledger proof is not present. |
| `invoice.paid` or `invoice.payment_succeeded` evidence | invoice event count present | partial_pass | Admin export counts 1 `invoice.paid`, but does not attach a complete top-up/ledger proof. |
| Credit-pack canary status | completed purchase row visible | pending_artifact_review | Credits screenshot shows a completed `live_credits_5000` member purchase row. It does not prove no-credit-before-webhook or exactly-once grant. |
| Duplicate credit-pack grant prevention | no duplicate event IDs in reconciliation | partial_pass_not_replay_proof | Reconciliation shows duplicate event IDs 0, but no duplicate webhook replay/idempotency canary artifact is present. |
| Reconciliation critical mismatch status | no critical mismatch, verdict still blocked | partial_pass_blocked_verdict | Reconciliation shows 0 critical items and 1 warning; verdict remains `blocked`. |
| Billing Reviews blocked/critical status | no blocked or needs-review rows | partial_pass | Export shows 4 rows: 1 resolved, 1 dismissed, 2 informational, 0 blocked, 0 needs-review. Informational rows remain visible. |
| Admin Live Billing redacted JSON/Markdown evidence | redacted export summarized | partial_pass_blocked_export | The supplied export is redacted, but the export itself reports `liveBillingReadiness: blocked`, `evidenceStatus: pending_operator_evidence`, and `canaryStatus: pending_operator_evidence`. |
| Secret/raw data redaction | repo scan passed after summary package | pass_repo_scan | `npm run check:secrets` passed after the sanitized summary package was added. This package intentionally includes no raw secrets or raw Stripe data. |

## Final Operator Decision

| Decision | Status | Reason |
| --- | --- | --- |
| Code support for live billing canary | ready_for_operator_canary | Prior repo validation and source review support a controlled operator canary path. |
| Live Billing Readiness | blocked_pending_complete_artifact_backed_evidence | Required live evidence is partially attached, but not complete enough to turn the status green. |
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
