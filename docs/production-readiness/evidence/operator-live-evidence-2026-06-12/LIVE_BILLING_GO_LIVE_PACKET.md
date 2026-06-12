# BITBI Live Billing Go-Live Packet

Date prepared: 2026-06-12

Branch: `main`

Audited HEAD before this packet: `43d9f4c72b788fd64916e6136be65d70149a4676`

Package status: operator-approved live billing packet with partial artifact-backed evidence and accepted evidence risk. It is not full evidence-proven production maturity proof.

2026-06-13 supplement: the operator manually validated the live billing system and approved go-live despite incomplete artifact-backed evidence. See `LIVE_BILLING_OPERATOR_GO_LIVE_APPROVAL.md`.

Allowed current claim: live billing is operator-approved live with partial artifact-backed evidence and accepted evidence risk.

Blocked claims until separate evidence is collected, attached, and reviewed:

- Production ready
- Full evidence-proven production maturity
- Fully artifact-proven Stripe live completion
- Live payments proven
- Tax, invoice, accounting, or legal compliance complete

## Scope

This packet records local validation, route/config review, deployment prerequisites, canary sequence, rollback plan, and operator-owned dashboard tasks for the existing live billing implementation.

It does not call Stripe, create checkout sessions, send webhooks, run migrations, deploy Workers, deploy Static Pages, mutate Cloudflare, mutate D1/R2/Queues, refund, claw back credits, cancel subscriptions, or enable live flags.

## Validation Summary

All required local validation commands completed successfully on the audited HEAD before this packet.

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check:toolchain` | PASS | Toolchain consistency guard passed. |
| `npm run check:js` | PASS | JavaScript syntax guard passed for 60 targeted files. |
| `npm run check:dom-sinks` | PASS | DOM sink baseline guard passed. |
| `npm run check:worker-body-parsers` | PASS | Worker body parser guard passed. |
| `npm run check:secrets` | PASS | Secret leakage guard passed. |
| `npm run test:doc-currentness` | PASS | Doc currentness tests passed. |
| `npm run check:doc-currentness` | PASS | `LIVE_BILLING_RUNBOOK.md` is classified; latest auth migration is read from `config/release-compat.json`. |
| `npm run check:route-policies` | PASS | Route policy guard passed for 262 registered auth-worker route policies. |
| `npm run test:release-compat` | PASS | Release compatibility tests passed. |
| `npm run validate:release` | PASS | Release compatibility validation passed. |
| `npm run release:plan` | PASS | Before this packet, working tree had no changed files and no runtime deploy steps. |
| `npm run release:preflight` | PASS | Local preflight passed; production deploy remains blocked by live/manual Cloudflare evidence. |
| `npm run test:readiness-evidence` | PASS | Readiness evidence tests passed. |
| `npm run billing:canary-evidence` | PASS | Generated blocked, redacted, local-only evidence skeleton; no Stripe calls or mutations. |
| `npm run build:static` | PASS | Static site built successfully. |
| `npm run test:workers` | PASS | 695 worker tests passed. |
| `npm run test:static` | PASS | 372 static/Playwright tests passed. |

No broad-run flake was observed.

## Release Plan Summary

Use `config/release-compat.json` and `npm run release:plan` as release truth. This packet does not hardcode a current migration checkpoint as release truth.

For the existing live billing implementation to run in production:

- Auth Worker deploy is required if the live billing Worker changes from the prior implementation wave are not already deployed.
- Static Pages deploy is required if the Admin Live Billing and Credits UI changes from the prior implementation wave are not already deployed.
- No new D1 migration is introduced by this Wave 3 packet.
- Apply any pending Auth D1 migrations reported by `npm run release:plan` before deploying Auth Worker code that depends on them.

For this packet-only change:

- Runtime code changed: no.
- D1 migration added: no.
- Cloudflare binding or secret added: no.
- Stripe dashboard mutation added: no.

## Required Cloudflare Secret And Var Checklist

Configure values only in Cloudflare dashboard or approved secret tooling. Values are intentionally omitted.

Required for live credit packs, subscriptions, webhook verification, and portal use as applicable:

- `STRIPE_LIVE_SECRET_KEY=<configure in Cloudflare; value redacted>`
- `STRIPE_LIVE_WEBHOOK_SECRET=<configure in Cloudflare; value redacted>`
- `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID=<configure in Cloudflare; value redacted>`
- `STRIPE_LIVE_CHECKOUT_SUCCESS_URL=<configure HTTPS URL>`
- `STRIPE_LIVE_CHECKOUT_CANCEL_URL=<configure HTTPS URL>`
- `STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL=<configure HTTPS URL>`
- `STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL=<configure HTTPS URL>`
- `STRIPE_LIVE_CUSTOMER_PORTAL_RETURN_URL=<configure HTTPS URL>`
- `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false` until controlled canary enablement
- `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=false` until controlled canary enablement
- `ENABLE_STRIPE_AUTOMATIC_TAX=false` until accounting/legal review approves
- `ENABLE_STRIPE_TAX_ID_COLLECTION=false` until accounting/legal review approves
- `ENABLE_STRIPE_INVOICE_CREATION=false` until accounting/legal review approves

## Stripe Dashboard Checklist

- Configure the live webhook endpoint to `/api/billing/webhooks/stripe/live`.
- Subscribe the live webhook endpoint to:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
  - `checkout.session.expired`
  - `charge.refunded`
  - `refund.created`
  - `refund.updated`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`
- Confirm live credit-pack Prices match the public BITBI catalog.
- Confirm BITBI Pro uses the configured live monthly Price ID and 9.99 EUR/month plan terms.
- Configure Stripe Customer Portal before enabling member portal use.
- Keep Stripe Tax, tax ID collection, and invoice options disabled until operator/accounting/legal review approves them.

## Admin Live Billing Operator Sequence

1. Deploy Auth Worker and Static Pages after validation passes and any required migrations are applied.
2. Open `/admin/#live-billing`.
3. Export redacted status before enabling live flags.
4. Configure Cloudflare vars/secrets with optional tax and invoice flags false.
5. Refresh Admin Live Billing and verify configured shapes only. Do not paste or expose values.
6. Keep Admin Live Billing read-only: no checkout creation, no Stripe mutation, no refunds, no credit clawbacks, no subscription cancellation, no Cloudflare mutation, no flag enablement from Admin.

## Exact Canary Sequence

1. Deploy Auth Worker and Static Pages.
2. Open `/admin/#live-billing`.
3. Export redacted status before live flags.
4. Configure Cloudflare vars/secrets.
5. Keep optional tax/invoice flags false initially.
6. Enable live credit packs/subscriptions only for controlled canary when ready.
7. Run one credit-pack canary with a dedicated member account.
8. Confirm no credit before verified webhook.
9. Confirm exactly-once credit grant after verified live `checkout.session.completed`.
10. Replay or duplicate the webhook and verify no double grant.
11. Run BITBI Pro subscription canary with a dedicated member account.
12. Confirm subscription state and `invoice.paid` or `invoice.payment_succeeded` top-up once per period.
13. Open Stripe Customer Portal from member Credits page and verify member-only portal behavior.
14. Verify failed invoice, refund, and dispute handling is review-only.
15. Export sanitized evidence.
16. Only then review go/no-go for public release.

## Rollback Plan

1. Set `ENABLE_LIVE_STRIPE_CREDIT_PACKS=false`.
2. Set `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS=false`.
3. Keep the webhook endpoint available for already-created Stripe events unless intentionally retiring the integration.
4. Do not delete ledger, subscription, checkout, billing event, review, or evidence rows.
5. Inspect Billing Reviews and Reconciliation before changing Stripe routing.

## Operator Decision Table

| Decision Area | Current Status | Reason |
| --- | --- | --- |
| Code readiness | Ready for operator canary | Local validation matrix passed and source audit found expected safeguards. |
| Deploy readiness | Ready for controlled deployment preparation | Auth Worker and Static Pages deploys remain operator-owned; live Cloudflare evidence is still required. |
| Config readiness | Blocked pending operator configuration | Secrets, vars, webhook endpoint, portal, and Stripe Dashboard setup are external to the repo. |
| Canary readiness | Blocked pending operator canary execution | No live purchase/webhook evidence has been attached. |
| Public go-live readiness | Blocked | Sanitized live canary evidence must be collected and reviewed first. |
