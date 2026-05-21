# 05 - Billing / Stripe Canary Evidence

Date: 2026-05-21

Operator: pending human review; local billing evidence filled by Codex

This template does not call Stripe, create checkout sessions, grant credits, refund payments, cancel/reactivate subscriptions, or enable live billing. Local repo evidence is not live billing readiness.

Local sprint command: `npm run billing:canary-evidence` passed as a local template/evidence command and returned final verdict `BLOCKED`. It made no Stripe calls, created no checkout sessions, processed no webhooks, granted no credits, changed no subscriptions, and issued no refunds.

Local environment presence snapshot from the command showed live billing config values as missing in the local shell by name only. This is not a production secret audit and does not prove Cloudflare secret state.

Required operator evidence remains pending for:

- live credit-pack checkout canary
- live subscription checkout canary
- verified webhook receipt
- duplicate webhook idempotency
- wrong Price ID rejection
- missing webhook secret fail-closed behavior
- no-credit-before-webhook evidence
- invoice/subscription grant evidence
- refund/dispute/payment-failure policy review
- redaction proof for raw Stripe payload/signature/secret material

## Billing Gate State

| Check | Evidence reference | Result |
| --- | --- | --- |
| Stripe mode reviewed by operator | Operator dashboard/manual evidence required | pending |
| Live credit-pack checkout gate state reviewed | Operator dashboard/manual evidence required | pending |
| Subscription gate state reviewed | Operator dashboard/manual evidence required | pending |
| Webhook endpoint configured | Operator dashboard/manual evidence required | pending |
| Webhook secret present by presence only | Operator dashboard/manual evidence required; never record value | pending |
| Live billing flags remain intentionally disabled unless separately approved | Local command verdict `BLOCKED`; operator Cloudflare/Stripe verification pending | blocked / pending operator verification |

## Safety Evidence

| Check | Evidence reference | Result |
| --- | --- | --- |
| Checkout creation grants no credits before verified webhook | Local Worker tests and billing canary template support this as a repo guard; live canary pending | repo-local only / live pending |
| Verified webhook/payment event grants expected credit pack | Requires testmode/live canary evidence | pending |
| Duplicate webhook event is idempotent | Local Worker tests cover duplicate/idempotency paths; live Stripe event evidence pending | repo-local only / live pending |
| Wrong Price ID is rejected safely | Local Worker tests cover rejection paths; live evidence pending if in scope | repo-local only / live pending |
| Missing webhook secret fails closed | Local tests/guard evidence only; production secret presence pending | repo-local only / live pending |
| Raw Stripe payload/signature/secret not rendered | No raw Stripe data added to this package; operator canary evidence still requires redaction review | local package clean / live pending |
| Invoice/subscription credit policy reviewed | Operator/accounting review required | pending |
| Failed payment/refund/dispute policy reviewed | Operator/accounting review required | pending |
| Accounting/legal review completed if live billing is in scope | Operator/legal/accounting review required | pending |

## Canary Plan

- Canary operator:
- Canary scope:
- Stripe dashboard evidence reference:
- Admin billing evidence status reference:
- Rollback/kill-switch plan: keep live billing disabled unless separately approved; disable live billing flags if canary fails; do not grant manual credits without verified event evidence.
- Customer impact allowed: none / bounded test only

## Hard Stops

- Stop if any raw Stripe secret, webhook signature, payment method, customer personal data, session token, or raw payload appears in evidence.
- Stop if a credit is granted before verified webhook evidence.
- Stop if local evidence is being treated as live billing approval.
