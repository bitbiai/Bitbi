# 5000 Credit Pack Pre-Purchase Baseline

Baseline created: 2026-06-13T05:27:32Z  
Scope: pre-purchase baseline only for a future live 5000 Credit Pack evidence run.

This file summarizes only the local staging artifacts in this folder. It does not prove a new purchase and does not include raw Stripe payloads, webhook signatures, secrets, cookies, tokens, card data, full Checkout Session URLs, full Customer Portal URLs, or private API keys.

## Source Artifacts Reviewed

| Artifact | Used for | Notes |
| --- | --- | --- |
| `01-before-member-credits.png` | Member Credits page baseline | Screenshot includes user-facing account details; this file summarizes values only and does not duplicate the screenshot. |
| `live-billing-readiness-evidence.json` | Admin Live Billing status baseline | Redacted export. No raw secrets or raw payloads are summarized here. |
| `live-billing-readiness-evidence.md` | Human-readable Admin status baseline | Redacted export. |

## Member Credits Before Purchase

| Field | Baseline value | Source |
| --- | --- | --- |
| Total available credits | `2580 Credits` | `01-before-member-credits.png` |
| Subscription / Abo credits | `0 Credits` | `01-before-member-credits.png` |
| Purchased credits | `64 Credits` | `01-before-member-credits.png` |
| Legacy / bonus credits | `2516 Credits` | `01-before-member-credits.png` |
| BITBI Pro subscription status | `active` | `01-before-member-credits.png` |
| Next subscription renewal shown | `2026-06-14 19:39` | `01-before-member-credits.png` |
| Live checkout section | `live-checkout active` | `01-before-member-credits.png` |

## Visible Credit History Before Purchase

The member Credits page showed one prior purchase row before this evidence run:

| Date/time | Package | Status | Amount | Scope |
| --- | --- | --- | --- | --- |
| `2026-05-24 20:22` | `live_credits_5000` | `completed` | `9,99 EUR` | `member` |

This is historical purchase visibility before the planned new 5000 Credit Pack purchase. It is not post-purchase evidence for the next run.

## Admin Live Billing Before Purchase

| Field | Baseline value | Source |
| --- | --- | --- |
| Export generated at | `2026-06-13T05:11:53.562Z` | `live-billing-readiness-evidence.json` |
| Live Billing Readiness | `operator_approved_live` | Admin export |
| Production Readiness label | `operator_go_live_approved` | Admin export |
| Evidence status | `partial_evidence_operator_approved` | Admin export |
| Canary status | `operator_confirmed_manual_live_validation` | Admin export |
| Final verdict | `operator_approved_live_with_evidence_waivers` | Admin export |
| Config shape | `configured_shapes_present` | Admin export |
| Credit Packs status badge | `configured_enabled_operator_live` | Admin export |
| BITBI Pro Subscription status badge | `configured_enabled_operator_live` | Admin export |
| Webhook status badge | `configured_operator_live` | Admin export |
| Customer Portal status badge | `configured_operator_confirmed_pay_bitbi_ai` | Admin export |
| Reconciliation status badge | `no_critical_items_operator_accepted` | Admin export |
| Billing Reviews status badge | `0 blocking_or_needs_review` | Admin export |

## 5000 Credit Pack Configuration Before Purchase

| Field | Baseline value | Source |
| --- | --- | --- |
| Credit pack catalog status | `configured_shape_present` | Admin export |
| Active configured packs | `2` | Admin export |
| 5000 Credit Pack ID | `live_credits_5000` | Admin export |
| 5000 Credit Pack credits | `5000` | Admin export |
| 5000 Credit Pack amount | `9,99 EUR` | Admin export |
| 5000 Credit Pack active | `true` | Admin export |
| Credit-pack checkout canary | `pending_operator_evidence` | Admin export catalog field |
| No credit before webhook rule | `true` | Admin export catalog field |

## Billing Events Before Purchase

The Admin export showed historical live Stripe event metadata before the planned new purchase:

| Event type | Count |
| --- | ---: |
| `customer.subscription.updated` | 6 |
| `checkout.session.completed` | 3 |
| `checkout.session.expired` | 15 |
| `invoice.paid` | 1 |

| Processing status | Count |
| --- | ---: |
| `failed` | 8 |
| `planned` | 2 |
| `ignored` | 15 |

Additional baseline facts:

- Provider mode count: `live` = 25.
- Signature verification label: `verified_live_signature`.
- Recent events in the export were historical and pre-date this 5000 Credit Pack run.
- No new purchase event has been captured in this baseline.

## Billing Reconciliation Before Purchase

| Field | Baseline value |
| --- | --- |
| Reconciliation verdict | `blocked` |
| Operator approval status | `no_critical_items_operator_accepted` |
| Critical items | `0` |
| Warning items | `1` |
| Recent live Stripe provider events | `27` |
| Failed provider events | `8` |
| Duplicate provider event IDs | `0` |
| Provider event conflicts | `0` |
| Ignored wrong-price/wrong-mode events | `0` |
| Member live credit-pack checkouts completed | `2` |
| Member live credit-pack checkouts created | `10` |
| Completed checkout without ledger | `0` |
| Ledger linked without billing event | `0` |
| Checkout webhook events without ledger | `0` |
| Provider grants without checkout link | `0` |
| Negative member credit balances | `0` |
| Provider grant rows | `3` |
| Active subscriptions | `1` |
| Active subscriptions without top-up marker | `0` |
| Active subscriptions without bucket | `0` |

## Billing Reviews Before Purchase

| Field | Baseline value |
| --- | --- |
| Total review rows shown | `4` |
| Unresolved rows | `2` |
| Blocking / needs-review rows | `0` |
| Resolved rows | `1` |
| Dismissed rows | `1` |
| Informational rows | `2` |

## Warnings And Pending Evidence Before Purchase

| Item | Baseline status |
| --- | --- |
| Historical live events include failed/planned/ignored states | present in Admin export |
| Reconciliation warning count | `1` |
| Duplicate webhook/idempotency artifact | `operator_waived_pending_artifact` |
| No-credit-before-webhook artifact | `operator_waived_pending_artifact` |
| Wrong Price ID live rejection artifact | `repo_tests_operator_waived_pending_live_artifact` |
| Refund/dispute/failure live review-only artifact | `repo_tests_operator_waived_pending_live_artifact` |
| Tax/invoice configuration review | `disabled_by_default_operator_review_pending` |

## Missing From Pre-Purchase Artifacts

| Item | Status |
| --- | --- |
| Stripe Dashboard payment succeeded evidence for the future purchase | `missing_from_pre_purchase_artifacts` |
| New `checkout.session.completed` event for the future purchase | `missing_from_pre_purchase_artifacts` |
| Stripe webhook 2xx delivery for the future purchase | `missing_from_pre_purchase_artifacts` |
| Post-purchase Admin Live Billing export | `missing_from_pre_purchase_artifacts` |
| Post-purchase Billing Events evidence | `missing_from_pre_purchase_artifacts` |
| Post-purchase Reconciliation evidence | `missing_from_pre_purchase_artifacts` |
| Post-purchase Billing Reviews evidence | `missing_from_pre_purchase_artifacts` |
| Exactly-once grant proof for the future 5000-credit purchase | `missing_from_pre_purchase_artifacts` |

