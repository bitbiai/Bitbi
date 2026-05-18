# Phase 2-C AI Usage Entitlements Report

Date: 2026-04-26

Scope: Phase 2-C wires the Phase 2-B billing, entitlement, and credit-ledger foundation into a single low-risk member-facing AI usage path: `/api/ai/generate-image` when the request explicitly supplies organization context. It does not enable live payments, checkout, invoices, provider webhooks, broad paywalls, full tenant isolation, or a global asset migration.

## Executive Summary

Phase 2-C adds opt-in organization-scoped AI image usage enforcement. Existing legacy user-scoped image generation requests without `organization_id` continue to behave as before and are not charged through the credit ledger.

When `/api/ai/generate-image` includes `organization_id`, the auth Worker now verifies active organization membership, requires at least `member` role, checks the `ai.image.generate` entitlement, checks available organization credits, requires a valid `Idempotency-Key`, and records one credit of usage only after the AI provider returns a successful image and the existing generation finalization succeeds. Failed provider calls and insufficient-credit rejections do not create usage debit records.

## Baseline

- Phase 2-B is committed as `f9099d9 Phase 2-B`.
- Latest auth migration remains `0035_add_billing_entitlements.sql`.
- Baseline `npm run release:preflight` passed before Phase 2-C edits.
- Production deploy remains blocked until live Cloudflare validation, migrations through `0035`, and staging org billing/AI usage verification complete.

## What Changed

- Added `workers/auth/src/lib/ai-usage-policy.js`.
- Updated `workers/auth/src/lib/billing.js` with pre-provider usage idempotency conflict checking and optional request fingerprints for usage consumption.
- Updated `workers/auth/src/routes/ai/images-write.js` to enforce org-scoped billing policy only when organization context is supplied.
- Updated `workers/auth/src/app/route-policy.js` metadata for `/api/ai/generate-image`.
- Updated `scripts/check-js.mjs` to include the new AI usage policy helper.
- Added Worker tests for org-scoped image usage enforcement and compatibility.

## AI Usage Policy

Central operation map:

| Operation | Feature | Initial credit cost | Wired in Phase 2-C |
| --- | --- | ---: | --- |
| `member.image.generate` | `ai.image.generate` | 1 | Yes, opt-in with `organization_id` |
| `member.text.generate` | `ai.text.generate` | 1 | No |
| `member.video.generate` | `ai.video.generate` | 5 | No |

The video mapping is defined for future consistency only. Phase 2-C does not wire member video generation.

## Organization Context Behavior

- Canonical request field: `organization_id`.
- Compatibility alias accepted: `organizationId`.
- Requests without either field remain legacy user-scoped requests.
- Org-scoped requests require active membership.
- Roles `owner`, `admin`, and `member` may consume credits.
- Role `viewer` is denied.
- Non-members receive the same safe organization access denial used by Phase 2-A.

## Idempotency Behavior

Org-scoped charged requests require `Idempotency-Key`.

The helper stores a scoped internal idempotency key derived from:

- client idempotency key,
- user id,
- organization id,
- route,
- operation.

The usage request hash also includes a stable fingerprint of the meaningful request body excluding `organization_id` / `organizationId`. This means:

- same key plus same body returns the same usage record and does not double-charge;
- same key plus different prompt/model/steps/seed conflicts before provider execution;
- insufficient-credit requests do not create debit records;
- failed provider calls do not create debit records.

Phase 2-C does not cache generated image payloads for idempotent retries. A repeated same-key/same-body request may call the AI provider again, but it does not double-consume credits. Provider-result caching/reservation is deferred.

## Route Behavior

Changed route:

| Method | Route | Phase 2-C behavior |
| --- | --- | --- |
| `POST` | `/api/ai/generate-image` | Legacy requests unchanged. Org-scoped requests enforce membership, role, entitlement, credits, and idempotent post-success debit. |

No admin AI Lab route is charged in Phase 2-C.

No text/video route is charged in Phase 2-C.

## Response Compatibility

Existing response fields are preserved.

Org-scoped successful responses include a sanitized top-level `billing` object:

```json
{
  "organization_id": "org_...",
  "feature": "ai.image.generate",
  "credits_charged": 1,
  "balance_after": 123
}
```

The response does not expose internal idempotency keys, request hashes, ledger hashes, provider credentials, or hidden billing metadata.

## Failure Behavior

- Missing or invalid `Idempotency-Key` on org-scoped generation returns `428`.
- Viewer membership returns `403`.
- Non-members return safe organization access denial.
- Missing credits returns `402` before provider execution.
- Provider failure returns the existing sanitized `502` and does not charge.
- Usage-recording failure after provider success returns a safe `503` and does not persist a temporary generated image save reference.

## Schema And Config

- No new D1 migration.
- No new Cloudflare binding.
- No live payment-provider dependency.
- Latest required auth migration remains `0035_add_billing_entitlements.sql`.

## Tests Added

Worker tests cover:

- legacy user-scoped image generation remains uncharged;
- owner/admin/member org roles can generate and consume one credit;
- repeated same-key/same-body org generation does not double-charge;
- same key with different body conflicts before provider execution;
- viewer denied before provider execution;
- non-member denied before provider execution;
- missing idempotency key denied before provider execution;
- insufficient credits denied before provider execution and no debit is recorded;
- provider failure does not record a debit;
- usage-recording failure after provider success fails safe and does not persist a generated temp asset.

## Validation

Initial targeted validation:

| Command | Result |
| --- | --- |
| `npm run check:js` | PASS |
| `npm run check:route-policies` | PASS, 112 registered route policies |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-C"` | PASS, 6/6 |

Final validation:

| Command | Result |
| --- | --- |
| `npm run check:route-policies` | PASS, 112 registered route policies |
| `npm run check:js` | PASS, 36 targeted files |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-C"` | PASS, 6/6 |
| `npm run test:workers` | PASS, 326/326 |
| `npm run test:static` | PASS, 155/155 |
| `npm run test:release-compat` | PASS |
| `npm run test:release-plan` | PASS |
| `npm run test:cloudflare-prereqs` | PASS |
| `npm run validate:cloudflare-prereqs` | PASS repo config, live validation skipped, production deploy BLOCKED |
| `npm run validate:release` | PASS |
| `npm run check:worker-body-parsers` | PASS |
| `npm run check:data-lifecycle` | PASS |
| `npm run check:admin-activity-query-shape` | PASS |
| `npm run test:operational-readiness` | PASS |
| `npm run check:operational-readiness` | PASS |
| `npm run build:static` | PASS |
| `npm run release:preflight` | PASS |
| `git diff --check` | PASS |

## Merge Readiness

Pass for merge after full local validation.

## Production Deploy Readiness

Blocked.

Production deploy still requires:

- auth migrations through `0035_add_billing_entitlements.sql` applied in staging/production;
- live Cloudflare secret/binding/resource validation;
- staging verification of org-scoped image generation with entitlement and credit debits;
- confirmation that existing legacy user-scoped AI generation remains compatible;
- no live payment-provider activation.

## Rollback Plan

- If org-scoped AI usage enforcement misbehaves, roll back the auth Worker code that imports `ai-usage-policy.js`.
- Existing legacy image generation clients do not depend on org-scoped billing fields and should continue to work after rollback.
- Do not delete billing ledger or usage rows without an audited cleanup plan.
- No Cloudflare binding rollback is required because Phase 2-C adds no new resources.

## Remaining Risks

- Idempotent retries are no-double-charge but not no-provider-call; provider-result caching or reservations remain future work.
- Only image generation is wired; text/video and save/publish flows remain legacy.
- Existing assets remain user-owned; this is not full tenant isolation.
- No monthly credit grant scheduler exists.
- No live payment provider exists.
- Billing lifecycle export/delete policy remains deferred.

## Next Recommended Actions

1. Run full release validation and update this report.
2. Staff Engineer/Security review Phase 2-C billing enforcement.
3. Verify migration `0035` and org billing state in staging.
4. Stage-test org-scoped image generation success, insufficient credits, idempotency conflict, and legacy compatibility.
5. Decide Phase 2-D: provider-result idempotency/reservations, text/video route wiring, or payment-provider integration design.
