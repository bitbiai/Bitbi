# Phase 2-I Billing Event Ingestion Report

Date: 2026-04-26

## Executive Summary

Phase 2-I adds a provider-neutral billing event ingestion foundation for future payment-provider integration. It introduces D1 event/action tables, a raw-body webhook verification boundary, a synthetic test-only webhook provider, sanitized admin billing-event inspection, route-policy coverage, release compatibility tracking, and Worker tests.

No live payment provider is active. No checkout, invoices, payment webhooks, subscription upgrades, or real credit grants from provider events are enabled. The synthetic webhook exists to prove raw-body verification, deduplication, payload mismatch detection, classification, and admin inspection before a real provider is selected.

## Scope

Implemented:

- Additive migration `0037_add_billing_event_ingestion.sql`.
- Provider-neutral event storage in `billing_provider_events`.
- Dry-run/no-side-effect action planning in `billing_event_actions`.
- Raw-body, byte-limited webhook parsing for `POST /api/billing/webhooks/test`.
- Synthetic HMAC verification with timestamp freshness for the test provider.
- Idempotent event ingestion keyed by provider and provider event id.
- Duplicate event replay handling and payload-hash mismatch rejection.
- Admin-only sanitized event list/detail routes.
- Route-policy, release compatibility, syntax, body-parser, and Worker test coverage.

Not implemented:

- Stripe, Paddle, PayPal, or any provider SDK.
- Live checkout, invoices, customer portal, or provider API calls.
- Production-trusted provider webhook processing.
- Subscription activation, plan upgrade, or automatic credit grants from external events.
- Frontend UI.
- Full SaaS billing readiness or full tenant isolation.

## Provider Strategy

No payment provider is selected in the repository. Phase 2-I therefore remains provider-neutral and adds only a synthetic test provider named `test`.

The synthetic provider uses:

- Header `x-bitbi-billing-timestamp`.
- Header `x-bitbi-billing-signature`.
- HMAC-SHA256 signature version `v1`.
- Secret `BILLING_WEBHOOK_TEST_SECRET`.
- A five-minute timestamp freshness window.

If `BILLING_WEBHOOK_TEST_SECRET` is missing or too short, the webhook route fails closed with `503`. Live-mode payloads are rejected with `403`.

## New Migration

`workers/auth/migrations/0037_add_billing_event_ingestion.sql` adds:

- `billing_provider_events`
  - Stores provider name, provider event id, provider mode, event type, verification status, processing status, payload hash, sanitized payload summary, optional organization/user/customer references, error code/message, attempt count, and timestamps.
  - Adds uniqueness on `(provider, provider_event_id)` and `dedupe_key`.
  - Adds indexes for provider/type, status/received time, organization lookup, customer lookup, provider mode/status, processed time, and provider event created time.

- `billing_event_actions`
  - Stores dry-run/deferred action plans derived from supported event types.
  - Enforces uniqueness per `(event_id, action_type)`.
  - Does not execute billing side effects.

The migration is additive and does not alter or rebuild existing billing, usage, ledger, organization, or AI usage attempt tables.

## Routes Added

- `POST /api/billing/webhooks/test`
  - Public non-browser provider webhook route.
  - Does not use user session auth or browser CSRF.
  - Uses raw-body byte limit before parsing.
  - Verifies synthetic HMAC before JSON parsing.
  - Uses fail-closed shared rate limiting.
  - Stores only sanitized event metadata.

- `GET /api/admin/billing/events`
  - Platform admin/MFA protected.
  - Fail-closed rate limited.
  - Supports bounded filters for provider, status, event type, organization id, and limit.
  - Returns sanitized event summaries only.

- `GET /api/admin/billing/events/:id`
  - Platform admin/MFA protected.
  - Fail-closed rate limited.
  - Returns sanitized event detail and dry-run action summaries.

## Raw Body Handling

The webhook route uses `readTextBodyLimited()` with `BODY_LIMITS.billingWebhookRaw` before signature verification and never calls `request.json()` directly. JSON parsing happens only after signature verification succeeds.

Unsupported content types and oversized bodies are rejected before payload processing. Raw webhook bodies are not stored or returned.

## Signature Verification

The synthetic signature payload is:

```text
v1
provider
timestamp
sha256(rawBody)
```

The expected signature is `v1=<hex hmac-sha256>`. Invalid, missing, malformed, stale, or misconfigured signatures fail closed. The implementation stores only the verification status, not the raw signature header.

## Event Idempotency

Event deduplication uses provider plus provider event id. Existing events with the same payload hash are treated as duplicate delivery and return the existing sanitized event. Existing events with the same provider event id but a different payload hash fail with `409 billing_event_payload_conflict`.

No duplicate event delivery creates duplicate action records or billing side effects.

## Event Processing

Phase 2-I processing is intentionally limited to classification and inspection:

- Supported future event types create a deferred dry-run action row.
- Unsupported event types are stored as ignored and inspectable.
- Live-mode events are rejected.
- Provider customer or organization references are sanitized and optional.
- No subscriptions, plans, credits, ledger entries, usage events, or invoices are modified.

Supported normalized event names for dry-run action planning:

- `checkout.completed`
- `subscription.created`
- `subscription.updated`
- `subscription.cancelled`
- `invoice.paid`
- `invoice.payment_failed`
- `credit_pack.purchased`

## Admin Inspection

Admin responses include:

- Event id.
- Provider.
- Provider event id.
- Provider mode.
- Event type.
- Verification and processing status.
- Optional organization/user/customer ids.
- Sanitized payload summary.
- Error category/message where applicable.
- Dry-run action summaries on detail reads.

Admin responses do not include:

- Raw webhook body.
- Raw provider payload.
- Raw signature headers.
- Payment method or card/bank details.
- Provider secrets.
- Idempotency hashes.
- SQL/debug metadata.

## Route Policy And Release Compatibility

Updated:

- `workers/auth/src/app/route-policy.js`
- `scripts/check-route-policies.mjs`
- `config/release-compat.json`
- `scripts/test-release-compat.mjs`
- `scripts/check-js.mjs`
- `tests/workers.spec.js`

Release compatibility now tracks latest auth migration `0037_add_billing_event_ingestion.sql` and the new webhook/admin event routes. `BILLING_WEBHOOK_TEST_SECRET` is recorded as an optional manual prerequisite: if absent, the synthetic webhook route fails closed and live billing remains disabled.

## Tests Added

Worker tests cover:

- Missing verification config fails closed.
- Missing, invalid, and stale signatures are rejected.
- Oversized raw body is rejected before parsing.
- Malformed payload is rejected safely.
- Unsupported provider is rejected.
- Valid synthetic event is stored.
- Duplicate delivery does not duplicate side effects.
- Same provider event id with different payload hash is rejected.
- Unsupported event type is stored/ignored safely.
- Live-mode event is rejected.
- No credit ledger, usage event, or subscription side effects occur.
- Non-admin cannot inspect billing events.
- Admin list/detail inspection is sanitized.
- Route-policy entries resolve for webhook and admin event routes.

## Validation Results

Final validation:

- `npm run check:route-policies` passed.
- `npm run check:js` passed.
- `npm run test:workers` passed, 342/342.
- `npm run test:static` passed, 155/155.
- `npm run test:release-compat` passed.
- `npm run test:release-plan` passed.
- `npm run test:cloudflare-prereqs` passed.
- `npm run validate:cloudflare-prereqs` passed repo config validation; live validation skipped and production deploy remains blocked.
- `npm run validate:release` passed.
- `npm run check:worker-body-parsers` passed.
- `npm run check:data-lifecycle` passed.
- `npm run check:admin-activity-query-shape` passed.
- `npm run test:operational-readiness` passed.
- `npm run check:operational-readiness` passed.
- `npm run build:static` passed.
- `npm run release:preflight` passed.
- `git diff --check` passed.

Validation notes:

- `npm run test:release-compat` and `npm run test:release-plan` initially failed while the Phase 2-I report and release fixture route entries were incomplete; those release-contract gaps were fixed and both commands passed.
- One `npm run release:preflight` run initially failed because the Phase 2-I sanitization test searched for card suffix `4242` across the entire JSON response and a random event id happened to contain that substring. The test now asserts redaction through structured payload-summary fields instead; `npm run test:workers` and `npm run release:preflight` both passed after the fix.

## Merge Readiness

Ready for review/merge from a repository validation standpoint. Release preflight is green, route policy coverage is green, release compatibility tracks migration `0037`, and Worker/static suites pass.

## Production Deploy Readiness

Blocked. Production deployment must wait for:

- Migration `0037_add_billing_event_ingestion.sql` applied in staging/production.
- Staging verification of valid synthetic event ingestion.
- Staging verification of missing/invalid/stale signature failures.
- Staging verification of duplicate delivery and payload mismatch behavior.
- Staging verification of sanitized admin inspection.
- Confirmation that no live provider events grant credits, modify subscriptions, or activate plans.

## Required Staging Steps

1. Apply auth migration `0037_add_billing_event_ingestion.sql` in staging.
2. Provision `BILLING_WEBHOOK_TEST_SECRET` only in staging/test if synthetic webhook verification is needed.
3. Verify missing secret returns `503`.
4. Verify invalid and stale signatures return `401`.
5. Verify a signed synthetic event stores one event and one deferred dry-run action for supported types.
6. Verify duplicate delivery returns the existing event without duplicate actions.
7. Verify same provider event id with different payload hash returns `409`.
8. Verify live-mode payload is rejected.
9. Verify admin event list/detail are admin/MFA protected and sanitized.
10. Verify existing org billing, admin credit grants, image/text credit enforcement, attempt cleanup, and replay object cleanup remain green.

## Rollback Plan

If Phase 2-I causes issues before production data depends on it:

- Revert the auth Worker route/lib/policy/test/docs changes.
- Leave migration `0037` applied; it is additive and safe to leave unused.
- Remove or leave `BILLING_WEBHOOK_TEST_SECRET`; without route code it is inert.
- Confirm no subscriptions, ledger entries, usage events, or plans were modified by billing event ingestion.

## Remaining Risks

- No real provider signature adapter exists yet.
- No checkout or invoice flow exists.
- No live subscription or credit side effects exist.
- Admin inspection is API-only, not a full operational UI.
- Billing event retention has an engineering baseline but not legal approval.
- Provider customer mapping remains a placeholder until provider selection.
- Full tenant isolation remains incomplete.

## Next Recommended Actions

1. Complete Staff Security/SRE review of the webhook raw-body/signature boundary.
2. Apply migration `0037` and run synthetic webhook verification in staging.
3. Choose a payment provider and design its raw-body signature adapter without SDK/API calls first.
4. Add dry-run reprocess planning only after event state transitions are stable.
5. Define legal/product retention for billing events before storing real provider payload summaries.
