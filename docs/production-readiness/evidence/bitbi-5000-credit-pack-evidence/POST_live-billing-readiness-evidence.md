# Live Billing Readiness Evidence

Generated: 13/06/2026, 07:41

Production readiness: **operator_go_live_approved**
Live billing readiness: **operator_approved_live**

## Status

- Repository support: ready_for_operator_canary
- Production readiness: operator_go_live_approved
- Live billing readiness: operator_approved_live
- Config shape: configured_shapes_present
- Credit packs: configured_enabled_operator_live
- BITBI Pro subscription: configured_enabled_operator_live
- Webhook: configured_operator_live
- Customer Portal: configured_operator_confirmed_pay_bitbi_ai
- Reconciliation: no_critical_items_operator_accepted
- Billing reviews: 0 blocking_or_needs_review
- Evidence status: partial_evidence_operator_approved
- Canary status: operator_confirmed_manual_live_validation
- Final verdict: operator_approved_live_with_evidence_waivers

## Next Operator Actions

1. Monitor Billing Events, Billing Reviews, and Reconciliation during live operation.
2. Attach remaining waived or pending artifact-backed evidence when it is available.
3. Keep Stripe Tax, tax ID collection, and invoice creation flags disabled until separate approval.
4. Confirm live credit-pack and subscription enablement in Cloudflare without exposing values.
5. If issues appear, disable live credit packs and subscriptions while keeping the webhook endpoint available.

## Required Evidence

| Evidence | Status | Why it matters | Where to inspect |
| --- | --- | --- | --- |
| live_credit_pack_checkout_canary | operator_confirmed_purchase_history_visible | Proves the configured live credit-pack checkout can be created safely by an operator. | Credits page checkout response and Stripe Dashboard checkout session. |
| live_subscription_checkout_canary | operator_confirmed_bitbi_pro_active | Proves the configured BITBI Pro checkout can be created safely by an operator. | Pricing/Credits subscription checkout response and Stripe Dashboard checkout session. |
| verified_webhook_receipt | operator_confirmed_admin_events_visible | Proves Stripe live events reach the verified webhook endpoint. | Billing Events provider log for /api/billing/webhooks/stripe/live. |
| duplicate_webhook_idempotency | operator_waived_pending_artifact | Proves repeated provider events cannot double-grant credits. | Billing Reconciliation duplicate/idempotency section. |
| wrong_price_id_rejection | repo_tests_operator_waived_pending_live_artifact | Proves unrelated Stripe prices do not grant BITBI Pro credits. | Billing Events ignored/review rows with wrong Price ID. |
| missing_webhook_secret_fail_closed | repo_tests_operator_waived | Proves checkout stays disabled without webhook-credit readiness. | Worker response from checkout with webhook secret absent. |
| no_credit_before_webhook | operator_waived_pending_artifact | Proves checkout creation alone never grants credits. | Member credit ledger remains unchanged after checkout creation. |
| invoice_paid_subscription_credit_grant | operator_confirmed_bitbi_pro_payment_active | Proves subscription credits are topped up only after a paid invoice event. | Member subscription bucket ledger after verified invoice.paid. |
| refund_dispute_failure_review_only | repo_tests_operator_waived_pending_live_artifact | Proves refunds, disputes, and failures create review records only. | Billing Reviews queue. |
| raw_payload_signature_secret_redaction | secret_scan_and_redacted_export_passed | Proves Admin never renders raw payloads, signatures, or secrets. | Admin Live Billing and Billing Evidence payloads. |
| customer_portal_session_canary | operator_confirmed_pay_bitbi_ai | Proves a signed-in member can open Stripe Customer Portal without Admin customer mutation. | Member Credits page portal button and Stripe Portal session. |
| tax_invoice_configuration_review | disabled_by_default_operator_review_pending | Confirms Stripe Tax/invoice flags and dashboard accounting setup were reviewed by an operator. | Stripe Dashboard tax/invoice settings and redacted env checklist. |

## Safety

- Stripe calls made by this Admin status read: no
- D1 mutation performed by this Admin status read: no
- Credit mutation performed by this Admin status read: no
- Raw payloads, signatures, payment methods, cookies, tokens, and secrets are not included.
