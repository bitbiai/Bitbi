# 05 - Billing / Stripe Canary Evidence

Date:

Operator:

This template does not call Stripe, create checkout sessions, grant credits, refund payments, cancel/reactivate subscriptions, or enable live billing. Local repo evidence is not live billing readiness.

## Billing Gate State

| Check | Evidence reference | Result |
| --- | --- | --- |
| Stripe mode reviewed by operator |  | pending |
| Live credit-pack checkout gate state reviewed |  | pending |
| Subscription gate state reviewed |  | pending |
| Webhook endpoint configured |  | pending |
| Webhook secret present by presence only |  | pending |
| Live billing flags remain intentionally disabled unless separately approved |  | pending |

## Safety Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Checkout creation grants no credits before verified webhook |  | pending |
| Verified webhook/payment event grants expected credit pack |  | pending |
| Duplicate webhook event is idempotent |  | pending |
| Wrong Price ID is rejected safely |  | pending |
| Missing webhook secret fails closed |  | pending |
| Raw Stripe payload/signature/secret not rendered |  | pending |
| Invoice/subscription credit policy reviewed |  | pending |
| Failed payment/refund/dispute policy reviewed |  | pending |
| Accounting/legal review completed if live billing is in scope |  | pending |

## Canary Plan

- Canary operator:
- Canary scope:
- Stripe dashboard evidence reference:
- Admin billing evidence status reference:
- Rollback/kill-switch plan:
- Customer impact allowed: none / bounded test only

## Hard Stops

- Stop if any raw Stripe secret, webhook signature, payment method, customer personal data, session token, or raw payload appears in evidence.
- Stop if a credit is granted before verified webhook evidence.
- Stop if local evidence is being treated as live billing approval.

