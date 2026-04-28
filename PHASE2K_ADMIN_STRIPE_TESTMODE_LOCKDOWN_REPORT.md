# Phase 2-K Admin Stripe Testmode Lockdown Report

Date: 2026-04-28

## Scope

Phase 2-K hardens the existing Stripe Testmode credit-pack checkout foundation by making checkout creation server-side platform-admin-only and operator-disabled by default. This is a narrow backend hardening phase for the existing `POST /api/orgs/:id/billing/checkout/credit-pack` route and verified Stripe Testmode webhook credit grants.

This phase does not enable live billing. It does not add live checkout, subscriptions, invoices, customer portal, Stripe Tax, Stripe Connect, coupons, public pricing, production payment processing, or production-trusted live webhooks.

## Files Changed

- `workers/auth/src/routes/orgs.js`
- `workers/auth/src/lib/stripe-billing.js`
- `workers/auth/src/app/route-policy.js`
- `config/release-compat.json`
- `scripts/test-release-compat.mjs`
- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`
- `js/pages/pricing/main.js`
- `workers/auth/CLAUDE.md`
- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md`
- `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md`

## Security Boundary Change

Before Phase 2-K, the backend checkout route allowed active organization `owner` or `admin` members to create Stripe Testmode Checkout Sessions if Stripe Testmode config was present.

After Phase 2-K:

- Unauthenticated callers are rejected with the existing unauthenticated response.
- Authenticated normal users are rejected.
- Organization members and viewers are rejected.
- Organization owners/admins who are not platform admins are rejected.
- Platform admins are allowed only when they are also active org owner/admin members and all Testmode/config/idempotency/body/rate-limit checks pass.
- The route uses the existing `requireAdmin` session/MFA/security boundary.
- Same-origin protection, byte-limited JSON parsing, fail-closed limiter behavior, `Idempotency-Key` handling, fixed server-side credit-pack catalog, and safe Stripe diagnostics remain intact.

## Checkout Kill Switch

Checkout creation now requires:

```text
ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true
```

Any missing, empty, false, `0`, or non-`true` value fails closed before any Stripe API call. The failure response may include the variable name `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT`, but never prints secret/config values.

This flag gates checkout creation only. The Stripe webhook remains able to verify and process already-created valid Testmode sessions when its own config is present and all server-side validation passes.

## Webhook Credit Grant Hardening

The Stripe Testmode webhook still verifies the raw body and `Stripe-Signature` before JSON parsing. It still rejects live-mode events, mismatched pack/amount/currency/org/user/payment state, duplicate event id payload mismatches, and unsupported event types.

Additional Phase 2-K requirement:

- Credit grants now require an existing persisted `billing_checkout_sessions` row.
- That row must match the Stripe session id, organization id, user id, pack id, credits, amount, and currency.
- The persisted checkout row creator user id is checked against the local `users` table.
- The creator must currently be an active platform admin.
- Stripe metadata alone is not trusted for admin authorization.
- Legacy rows or webhook-only sessions without an admin-created persisted row are not credit-grantable.
- Non-admin-created rows fail safely and are inspectable as failed billing events/actions.

No new migration was required because migration `0038_add_stripe_credit_pack_checkout.sql` already stores the checkout creator `user_id`.

## Behavior Before And After

| Flow | Before | After |
| --- | --- | --- |
| Normal authenticated user calls checkout API | Rejected unless org owner/admin | Rejected before Stripe call |
| Org member/viewer calls checkout API | Rejected | Rejected before Stripe call |
| Org owner/admin, not platform admin | Could create Testmode checkout | Rejected before Stripe call |
| Platform admin without flag | Could create if Stripe config present | Rejected before Stripe call |
| Platform admin with flag and valid config | Allowed if active org owner/admin | Allowed if active org owner/admin |
| Verified webhook for non-admin-created checkout | Could grant if metadata/session validation passed | Rejected with no credit grant |
| Verified webhook for admin-created checkout | Granted once | Granted once |
| Duplicate webhook delivery | No duplicate grant | No duplicate grant |
| Live Stripe mode/event | Rejected/disabled | Rejected/disabled |

## Validation Commands And Results

Validation completed during implementation:

- `npm run release:preflight` before edits: PASS
- `git diff --check`: PASS
- `npm run check:js`: PASS
- `npm run check:route-policies`: PASS
- `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "Phase 2-J"`: PASS, 5/5 after updating expectations for platform-admin-only checkout
- `npm run test:workers`: PASS, 347/347
- `npm run test:release-compat`: PASS
- `npm run test:release-plan`: PASS
- `npm run validate:release`: PASS
- `npm run test:cloudflare-prereqs`: PASS
- `npm run validate:cloudflare-prereqs`: PASS for repo config; live validation skipped and production deploy remains blocked
- `npm run check:worker-body-parsers`: PASS
- `npm run check:data-lifecycle`: PASS
- `npm run check:admin-activity-query-shape`: PASS
- `npm run test:operational-readiness`: PASS
- `npm run check:operational-readiness`: PASS
- `npm run test:static`: PASS, 163/163 when rerun serially
- `npm run test:asset-version`: PASS
- `npm run validate:asset-version`: PASS
- `npm run build:static`: PASS
- `npm run release:preflight`: PASS when rerun serially

Note: an earlier parallel run of `npm run test:static` and `npm run release:preflight` caused browser-runner contention and static timeouts. Both commands passed when rerun serially.

## Remaining Risks

- Stripe remains Testmode-only and is not production billing.
- The Pricing page is still a controlled admin-only rollout and does not prove production readiness.
- Platform admin checkout also requires org owner/admin membership; operator must ensure canary admins are members of the intended canary organization.
- Staging was not performed by Codex.
- If staging is skipped, production canary risk remains higher and must be bounded by the operator-controlled checkout flag and immediate rollback plan.

## Deployment / Canary Notes

Codex did not deploy, apply remote migrations, configure Cloudflare, or run live Stripe setup.

Production readiness is not claimed. If the operator intentionally skips staging, the only acceptable path is a tightly controlled Testmode-only production canary:

1. Confirm final commit, clean working tree, and full validation pass.
2. Apply required auth migrations through `0039_raise_credit_balance_cap_for_pricing_packs.sql`.
3. Keep `STRIPE_MODE=test`.
4. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CHECKOUT_SUCCESS_URL`, and `STRIPE_CHECKOUT_CANCEL_URL` with Testmode values only.
5. Set `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT=true` only for the canary window.
6. Verify `AI_SERVICE_AUTH_SECRET` parity between auth and AI Workers.
7. Verify `SERVICE_AUTH_REPLAY`, D1, R2, Queue, service binding, and Durable Object bindings.
8. Confirm normal users, members, viewers, org owners, and org admins who are not platform admins cannot access pricing/checkout.
9. Perform exactly one platform-admin Testmode checkout for the canary organization.
10. Verify Stripe webhook signature validation.
11. Verify exactly one credit ledger grant.
12. Replay the duplicate webhook and verify no double grant.
13. Test failed/unpaid/no-credit webhook behavior.
14. Confirm no live billing side effects.
15. Immediately disable `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` or remove Stripe Testmode config if anything unexpected happens.
16. Record health/header checks and restore-drill evidence later; skipping staging does not remove those production-readiness gaps.

## Explicit Non-Readiness Statement

Phase 2-K does not enable live billing and does not make BITBI production-ready. Live Stripe, live checkout, subscriptions, invoices, customer portal, tax, coupons, Connect, public pricing, and production payment operations remain unimplemented and disabled.
