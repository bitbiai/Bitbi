# BITBI Live Billing Operator Evidence Review

Date reviewed: 2026-06-12

Reviewed branch: `main`

Reviewed HEAD: `d5c0bf068b8682e2f0d3db0857d7beee2669c0c9`

Review status: **SUPERSEDED BY OPERATOR GO-LIVE APPROVAL**

Supplement recorded: 2026-06-13

The 2026-06-12 artifact review below remains accurate: artifact-backed evidence was partial and did not independently prove every readiness item. On 2026-06-13, the operator explicitly approved live billing go-live anyway after manually validating production behavior and accepting the remaining evidence risk.

Second supplement recorded: 2026-06-13

The live `live_credits_5000` fulfillment incident for checkout
`bcs_28816cfe9f76e56339a9dbe5a105b565` is now repaired in the sanitized
canary package at `credit-pack-5000-canary/`. The repair evidence proves exactly
one +5000 purchased-credit grant, a completed and ledger-linked checkout, and a
repeat repair/no-op result of `already_completed` with 0 credits granted. A real
duplicate Stripe webhook replay artifact is still pending.

Current Live Billing readiness status: **operator_approved_live**

See:

- `LIVE_BILLING_OPERATOR_GO_LIVE_APPROVAL.md`
- `live-billing-operator-go-live-approval.json`

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

Those statements are useful operational context, and the new artifacts show meaningful live-billing progress. They still do not prove every required live-billing evidence item. The later operator go-live approval records that the operator accepted this evidence risk and authorized the Live Billing UI to show an operator-approved live state.

## Evidence Matrix

| Evidence item | Review status | Artifact-backed review result | Notes |
| --- | --- | --- | --- |
| Customer Portal canary status | operator-reported working; artifact incomplete | pending_artifact_review | The operator reported successful portal access through `pay.bitbi.ai`; the Credits screenshot shows the manage-billing button. No committed artifact proves an opened portal session on `pay.bitbi.ai`, and no full portal session URL is committed. |
| Stripe webhook delivery status | not proven by committed artifact | pending_artifact_review | Admin evidence shows live events reached BITBI, but no sanitized Stripe Dashboard delivery summary proving successful live 2xx webhook deliveries is present. |
| BITBI Admin Billing Events status | live sanitized events visible | partial_pass | Admin export shows 25 live Stripe events, live provider mode, `verified_live_signature`, and no raw payload/signature rendering. It also shows failed/planned/ignored statuses, so this is not a final readiness pass. |
| Subscription state active for member | active state visible | partial_pass | Credits screenshot and reconciliation summary show 1 active subscription. Full invoice-paid top-up ledger proof is not present. |
| `invoice.paid` or `invoice.payment_succeeded` evidence | invoice event count present | partial_pass | Admin export counts 1 `invoice.paid`, but does not attach a complete top-up/ledger proof. |
| 5000 credit-pack repair | repaired | pass_repaired | The sanitized canary package records repair result `applied`, +5000 credits granted, balance after repair 7580, checkout `completed`, payment `paid`, and ledger entry `cl_5f0f971241b265f255405bc5fede1e86`. |
| Credit-pack exactly-once grant | proven for repaired checkout | pass_exactly_once_repair | Repeat/no-op verification returned `already_completed`, `creditsGranted: 0`, `reused: true`, and the existing ledger entry remained linked. |
| Duplicate credit-pack grant prevention | no-op repair proven; Stripe replay pending | partial_pass_repair_noop_not_stripe_replay | The repair no-op proves the admin repair path does not double-grant this checkout. A real duplicate Stripe webhook replay/idempotency artifact is still pending. |
| Reconciliation critical mismatch status | no critical mismatch, verdict still blocked | partial_pass_blocked_verdict | Reconciliation shows 0 critical items and 1 warning; verdict remains `blocked`. |
| Billing Reviews blocked/critical status | no blocked or needs-review rows | partial_pass | Export shows 4 rows: 1 resolved, 1 dismissed, 2 informational, 0 blocked, 0 needs-review. Informational rows remain visible. |
| Admin Live Billing redacted JSON/Markdown evidence | redacted export summarized | partial_pass_blocked_export | The supplied export is redacted, but the export itself reports `liveBillingReadiness: blocked`, `evidenceStatus: pending_operator_evidence`, and `canaryStatus: pending_operator_evidence`. |
| Secret/raw data redaction | repo scan passed after summary package | pass_repo_scan | `npm run check:secrets` passed after the sanitized summary package was added. This package intentionally includes no raw secrets or raw Stripe data. |

## Final Operator Decision

| Decision | Status | Reason |
| --- | --- | --- |
| Code support for live billing canary | ready_for_operator_canary | Prior repo validation and source review support a controlled operator canary path. |
| Live Billing Readiness | operator_approved_live | Operator manually validated production behavior and accepted remaining artifact evidence risk. |
| Production Readiness | operator_go_live_approved_billing_scope_not_full_evidence_proven_production_maturity | This review covers billing only. Full evidence-proven production maturity is not claimed. |
| Tax/invoice readiness | disabled_pending_review | Optional Stripe Tax, tax ID collection, and invoice creation flags remain disabled unless explicitly approved later. |

## Required Evidence To Transition Live Billing Green

Attach sanitized artifacts under this dated package or another classified evidence package showing all of the following:

1. Customer Portal canary opened from the member Credits page, with no raw portal session URL committed.
2. Stripe live webhook deliveries show successful 2xx delivery for relevant events.
3. Admin Billing Events show the corresponding live Stripe events.
4. Member subscription state is active.
5. `invoice.paid` or `invoice.payment_succeeded` exists for the BITBI Pro canary and the subscription top-up is exactly-once.
6. Additional credit-pack webhook replay evidence exists showing duplicate delivery does not double-grant.
7. Reconciliation has no critical live-billing mismatch.
8. Billing Reviews has no unresolved blocked or critical item.
9. Admin Live Billing JSON and Markdown exports are redacted.
10. `npm run check:secrets` passes after attaching the evidence package.

The operator has now approved going live despite these remaining artifact gaps. Future evidence should still be attached here when available.

## Current Readiness Statement

Allowed claim:

- Live billing is operator-approved live with partial artifact-backed evidence and accepted evidence risk.

Blocked claims:

- Full evidence-proven production maturity is not claimed.
- Stripe live completion is not claimed.
- Tax, invoice, accounting, and legal compliance completion are not claimed.
