# Operator Triage Runbook

Date: 2026-05-19

Purpose: safe operator procedure for using the Admin Operator Timeline, evidence archives, and existing Admin panels during incidents or readiness reviews. This runbook does not approve production readiness, live billing readiness, tenant isolation, ownership backfill, access switching, or confirmed legacy media reset.

## Severity Classes

| Severity | Meaning | Response |
| --- | --- | --- |
| critical | Blocked safety claim, destructive-action risk, dispute/security/admin-control issue, or evidence unsafe for readiness. | Inspect the related Admin panel and collect sanitized evidence before any follow-up. |
| high | Failed billing/provider/lifecycle/archive/security event or review queue item that needs an operator decision. | Open the related panel, export safe evidence if available, and record the decision path. |
| medium | Pending review, evidence gap, stale reconciliation finding, or repair candidate. | Triage during the current review window and keep readiness claims blocked. |
| low | Completed or recorded event with no immediate action. | Retain as timeline context. |
| informational | Audit/activity/archive metadata only. | Use for reconstruction and trend review. |

## First Response

1. Open `/admin/#operations` and refresh Operator Timeline / Triage.
2. Filter by source, severity, status, or attention required.
3. Use only safe links: Billing Reviews, Billing Reconciliation, Tenant Asset Center, Manual Review Queue, Data Lifecycle, AI Budget Evidence, Readiness/Evidence Dashboard, or Activity Log.
4. Copy event IDs into the incident notes. Do not paste raw secrets, payloads, signatures, cookies, authorization headers, raw idempotency keys, raw request hashes, or private R2 keys.
5. Run local evidence inventory when repo evidence is relevant:

```bash
npm run evidence:index
npm run evidence:index:markdown
npm run test:evidence-index
npm run readiness:dossier
npm run cloudflare:resource-model
npm run release:rollback-drill
```

## Triage Flows

Billing review event:
- Open Billing Reviews and Billing Reconciliation.
- Confirm checkout creation did not grant credits and verified webhook/payment/invoice evidence exists before any grant is trusted.
- Refund, dispute, and payment-failure events are review-only unless a later approved workflow explicitly changes credit behavior.
- Do not call Stripe, issue refunds, create checkout sessions, mutate subscriptions, or claw back credits from triage.

Failed webhook or billing reconciliation finding:
- Inspect the sanitized billing event detail and reconciliation category.
- Check duplicate event idempotency, wrong Price ID rejection, wrong provider mode, webhook-without-ledger, and checkout-without-grant categories.
- Keep live billing readiness blocked until operator canary evidence is attached and reviewed.

Failed AI provider or budget event:
- Open AI Budget Evidence, caps, reconciliation, repair report, and evidence archives.
- Confirm whether the issue is review-only or an explicit existing repair workflow.
- Do not call real providers from triage and do not bypass Cloudflare master controls.

Platform budget cap breach:
- Inspect platform budget caps and usage evidence.
- Record the operator reason before any existing approved cap update.
- Confirm the action is not customer billing and does not mutate credits.

Data lifecycle request, export, or archive failure:
- Open Data Lifecycle.
- Confirm idempotency, approval, archive state, and redacted storage metadata.
- Do not manually edit production D1 data or delete/list live R2 objects.

Tenant asset manual-review blocker:
- Open Manual Review Queue and Tenant Asset Center.
- Record status changes only through the existing review workflow.
- Do not backfill ownership, switch access checks, execute reset, or claim tenant isolation.

Legacy reset evidence blocker:
- Open Readiness/Evidence Dashboard and Tenant Asset Center.
- Use sanitized dry-run evidence templates only.
- Do not enable `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` and do not execute reset/delete.

Admin destructive action or security event:
- Open Activity Log and confirm MFA/admin audit context.
- Review confirmation, idempotency, and audit evidence.
- Do not run ad hoc remote migrations, deploys, or production data edits as an emergency shortcut.

Readiness/live evidence failure:
- Open Readiness/Evidence Dashboard.
- Run local cutover, production execution, or live read-only evidence commands only when appropriate:

```bash
npm run readiness:dossier
npm run readiness:dossier:markdown
npm run cloudflare:resource-model
npm run cloudflare:resource-model:markdown
npm run release:cutover-evidence
npm run release:cutover-evidence:markdown
npm run release:rollback-drill
npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai
npm run billing:canary-evidence
```

Production execution or Cloudflare resource blocker:
- Treat `npm run readiness:dossier` and `npm run cloudflare:resource-model` as repo/local evidence only.
- Attach live Cloudflare resource, secret-presence, dashboard-managed WAF/header/RUM/alert, deployment, and migration verification evidence separately.
- Use `npm run release:rollback-drill` to document rollback readiness; do not execute rollback from triage.

## Forbidden Emergency Actions

- Do not enable legacy reset confirmed execution.
- Do not run remote migrations ad hoc.
- Do not manually edit production D1 data.
- Do not run unbounded R2 listing, deletion, copy, or rewrite.
- Do not call Stripe, issue refunds, mutate subscriptions, create checkout sessions, or mutate credits outside approved workflows.
- Do not call real AI providers from triage.
- Do not deploy from the Admin UI.
- Do not execute rollback from the Admin UI or from the rollback drill artifact.
- Do not claim production readiness, live billing readiness, tenant isolation, ownership-backfill readiness, access-switch readiness, or confirmed reset readiness without reviewed evidence.
