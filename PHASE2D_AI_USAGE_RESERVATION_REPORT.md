# Phase 2-D AI Usage Reservation Report

Date: 2026-04-26

Scope: Phase 2-D hardens only org-scoped `/api/ai/generate-image` credit usage. It does not add a live payment provider, checkout, invoices, payment webhooks, global AI paywall, text/video credit enforcement, admin AI billing, full tenant isolation, or a production deploy.

## Executive Summary

Phase 2-D adds a durable AI usage-attempt/reservation layer for organization-scoped image generation. Requests without organization context remain legacy user-scoped and uncharged. Requests with `organization_id` still require `Idempotency-Key`, active org membership with at least `member` role, the `ai.image.generate` entitlement, and available credits.

The new `ai_usage_attempts` table reserves credits before provider execution, prevents same-key duplicate provider calls while an attempt is pending, replays the stored temporary image result for same-key/same-body successful retries when available, releases reservations on provider failure, and marks billing-finalization failures as terminal for that idempotency key so uncharged paid results are not persisted or leaked.

## Baseline Confirmed

- Branch: `main`.
- Baseline git status before edits: clean.
- Latest commit before Phase 2-D: `c82e9b0 Phase 2-C Add org-scoped AI credit enforcement`.
- Latest auth migration before Phase 2-D: `0035_add_billing_entitlements.sql`.
- Baseline `npm run release:preflight`: PASS before Phase 2-D edits.

## What Changed

- Added migration `workers/auth/migrations/0036_add_ai_usage_attempts.sql`.
- Added `workers/auth/src/lib/ai-usage-attempts.js`.
- Updated `workers/auth/src/lib/ai-usage-policy.js` to create and classify org-scoped usage attempts before provider execution.
- Updated `workers/auth/src/routes/ai/images-write.js` to handle completed replay, pending duplicates, retryable provider failure, billing failure, and success result storage for org-scoped image generation.
- Updated route-policy metadata for `/api/ai/generate-image`.
- Updated release compatibility latest auth migration to `0036_add_ai_usage_attempts.sql`.
- Updated Worker harness/tests for attempt/reservation behavior.
- Updated data inventory, retention policy, and auth Worker handoff docs.

## New Migration

`0036_add_ai_usage_attempts.sql` adds `ai_usage_attempts`.

Important fields:

- `organization_id`, `user_id`, `feature_key`, `operation_key`, `route`.
- `idempotency_key` and `request_fingerprint`.
- `credit_cost`, `quantity`.
- `status`, `provider_status`, `billing_status`, `result_status`.
- `result_temp_key`, `result_save_reference`, `result_mime_type`, `result_model`, `result_steps`, `result_seed`.
- `balance_after`, safe `error_code` / `error_message`.
- `created_at`, `updated_at`, `completed_at`, `expires_at`.

Indexes:

- Unique `(organization_id, idempotency_key)`.
- Organization/user/feature created-at lookups.
- Status expiration lookup.
- Active reservation lookup on `(organization_id, billing_status, status, expires_at)`.

No secrets, raw prompts, provider credentials, raw provider payloads, generated image bytes, or raw request bodies are stored.

## AI Usage Attempt Behavior

For org-scoped image generation:

- New same-key/same-body requests create one reserved attempt before provider execution.
- Same key with a different meaningful request body returns `409 idempotency_conflict` before provider execution.
- Same key while provider execution is pending returns `409 ai_usage_attempt_in_progress` and does not call the provider.
- Same key after success replays the stored temporary image result when available and does not call the provider again.
- Same key after provider failure can retry safely because the reservation is released and the attempt is re-reserved.
- Same key after billing finalization failure returns `503 ai_usage_billing_failed` and does not call the provider again.

## Credit Reservation And Finalization

The reservation check uses current credit balance minus active unexpired reserved attempts for the organization. This prevents supported concurrent org-scoped image requests from overspending the current credit balance.

Provider success does not immediately persist a result. The route first finalizes billing through the existing `usage_events` / `credit_ledger` debit path, then records the attempt as finalized and stores a temporary replay object in `USER_IMAGES`.

Provider failure marks the attempt `provider_failed` / `billing_status=released` and records no debit.

Billing finalization failure marks the attempt `billing_failed` / `billing_status=failed`, records no debit, does not persist a temporary generated image result, and returns a safe `503`.

Stuck reservations are bounded by `expires_at`. No cleanup job was added in Phase 2-D; retention/cleanup policy remains a follow-up.

## Provider-Result Idempotency

Successful org-scoped retries avoid duplicate provider execution and duplicate charges. When the first successful response stored the temporary generated image object, a same-key/same-body retry returns the same generated image bytes and save reference with:

```json
{
  "billing": {
    "organization_id": "org_...",
    "feature": "ai.image.generate",
    "credits_charged": 1,
    "balance_after": 123,
    "idempotent_replay": true
  }
}
```

If the temporary result is unavailable or expired, the retry does not call the provider again. It returns a safe unavailable/expired response. This is intentionally not a permanent provider-result cache.

## Backward Compatibility

- Legacy `/api/ai/generate-image` requests without `organization_id` / `organizationId` are unchanged and uncharged.
- Admin AI Lab routes are not charged or blocked.
- Text and video AI routes are not wired in Phase 2-D.
- Existing response fields are preserved. Org-scoped replay responses add `billing.idempotent_replay: true`.

## Routes Wired

- `POST /api/ai/generate-image` only when organization context is supplied.

Routes intentionally not wired:

- Legacy no-org image generation.
- Admin AI Lab routes.
- Text AI routes.
- Video AI routes.
- Save/publish/storage flows.
- Payment provider flows.

## Security Behavior

- Existing same-origin, byte-limited JSON parsing, user auth, fail-closed rate limiting, org membership/RBAC, entitlement checks, and credit checks remain in place.
- Viewer/non-member/cross-org requests are denied before provider execution.
- Insufficient credit is denied before provider execution and before attempt creation.
- Response bodies do not expose raw idempotency hashes, request fingerprints, temp R2 keys, SQL internals, provider secrets, or raw provider metadata.

## Release Compatibility

- `config/release-compat.json` latest auth migration is now `0036_add_ai_usage_attempts.sql`.
- `scripts/test-release-compat.mjs` is updated for the new migration checkpoint.
- No new Cloudflare binding, secret, queue, Durable Object, R2 bucket, cron trigger, or live payment-provider prerequisite was added.

## Tests Added/Updated

Worker tests cover:

- Legacy no-org image generation remains uncharged.
- Existing org-scoped success still charges one credit.
- Same-key/same-body retry replays without another provider call or debit.
- Same-key/different-body conflict occurs before provider execution.
- Pending duplicate request returns in-progress and does not call the provider.
- Provider failure releases reservation and same-key retry charges exactly once.
- Billing finalization failure is terminal for that idempotency key and does not persist an uncharged temp image.
- Active reservations reduce available credit for concurrent org-scoped requests.
- Viewer/non-member/missing idempotency/insufficient credit remain denied before provider execution.
- Response metadata does not expose raw hashes, fingerprints, temp keys, or internal fields.

## Validation

Validation completed during implementation:

| Command | Result |
| --- | --- |
| `npm run release:preflight` | PASS on clean Phase 2-C baseline before edits |
| `npm run check:route-policies` | PASS, 112 registered policies |
| `npm run check:js` | PASS, 37 targeted files |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-D|Phase 2-C"` | PASS, 11/11 |
| `npm run test:workers` | PASS, 331/331 |
| `npm run test:static` | PASS, 155/155 |
| `npm run test:release-compat` | PASS |
| `npm run test:release-plan` | PASS |
| `npm run test:cloudflare-prereqs` | PASS |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; live validation skipped; production blocked |
| `npm run validate:release` | PASS |
| `npm run check:worker-body-parsers` | PASS |
| `npm run check:data-lifecycle` | PASS |
| `npm run check:admin-activity-query-shape` | PASS |
| `npm run test:operational-readiness` | PASS |
| `npm run check:operational-readiness` | PASS |
| `npm run build:static` | PASS |
| `npm run release:preflight` | PASS after Phase 2-D changes |
| `git diff --check` | PASS |

Not run in this implementation pass:

- Live Cloudflare secret/binding verification.
- Live health/header checks with `--require-live`, because no staging/production URLs were configured.
- Production deploy, `npm run release:apply`, or remote D1 migrations.
- Root/Worker package install/audit checks, because package dependencies, package manifests, and lockfiles were not changed and `npm run release:preflight` passed.

## Merge Readiness

Pass for review/merge after the Phase 2-D files are committed together.

## Production Deploy Readiness

Blocked.

Production deploy requires:

- Apply auth migrations through `0036_add_ai_usage_attempts.sql` in staging/production.
- Live Cloudflare secret/binding/resource validation.
- Staging verification of org-scoped image generation success, retry replay, no duplicate provider execution, no duplicate charge, provider-failure no-charge behavior, insufficient-credit denial, final balance correctness, and legacy no-org compatibility.

## Rollback Plan

- Roll back auth Worker code that imports `ai-usage-attempts.js` and uses attempt state in `images-write.js`.
- Do not drop `ai_usage_attempts` in production without an audited cleanup decision.
- Existing legacy no-org image generation does not depend on the new table.
- Existing Phase 2-B `credit_ledger` and `usage_events` remain the source of truth for finalized charges.

## Remaining Risks

- Only org-scoped image generation is hardened.
- The replay store uses the existing temporary generated-image object and save-reference TTL; it is not a permanent provider-result cache.
- No cleanup job for expired/stuck `ai_usage_attempts` was added yet.
- Direct helper-level credit consumption outside the attempt path does not reserve credits.
- Text/video/admin AI routes are not credit-enforced.
- No live payment provider or production billing activation exists.
- Full tenant isolation remains incomplete.

## Next Recommended Actions

1. Run full Phase 2-D validation and update this report.
2. Staff Engineer/Security review the attempt/reservation state machine and failure cases.
3. Apply migration `0036` in staging and verify org-scoped image replay/no-duplicate-provider behavior.
4. Add bounded cleanup for expired `ai_usage_attempts` after retention policy is agreed.
5. Decide whether Phase 2-E should wire text/video routes, add payment-provider design, or continue tenant-owned asset migration.
