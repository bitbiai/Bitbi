# Phase 2-H Member Text Generation API Report

Date: 2026-04-26

## Executive Summary

Phase 2-H adds a minimal backend-only member-facing AI text generation endpoint:

- `POST /api/ai/generate-text`

The route is organization-scoped from day one. It requires an authenticated user, explicit organization context, active membership with `owner`, `admin`, or `member` role, the `ai.text.generate` entitlement, sufficient credits, and an `Idempotency-Key`. It reuses the Phase 2-D `ai_usage_attempts` reservation/finalization system and stores bounded replay-safe text output in existing `metadata_json`.

No live payment provider, checkout, invoice, webhook, frontend UI, global paywall, full tenant migration, admin AI charging, or text-asset storage charging was added.

## Scope

Implemented:

- Member route `POST /api/ai/generate-text`.
- Existing HMAC-protected Auth-to-AI service-binding call to `/internal/ai/test-text`.
- Org/RBAC/entitlement/credit enforcement for `ai.text.generate`.
- Usage attempt reservation, duplicate-provider-call suppression, billing finalization, and same-key replay.
- Focused tests for membership, entitlement, insufficient credits, idempotency, provider failure, billing failure, validation, same-origin checks, limiter fail-closed behavior, route policy, and release compatibility.

Not implemented:

- No frontend UI.
- No no-org legacy text generation mode.
- No admin AI Lab charging.
- No text asset save/update/delete charging.
- No video route credit enforcement.
- No live payment provider.
- No broad tenant migration.

## Provider/Text Route Inspection Findings

- The only existing provider-backed text generation route before Phase 2-H was admin-only: `POST /api/admin/ai/test-text`.
- The admin route proxies to the AI Worker internal route `POST /internal/ai/test-text`.
- The internal AI Worker route is protected by HMAC service authentication and nonce replay protection before dispatch.
- Existing `/api/ai/text-assets/*` routes are storage/read/update/delete routes, not provider-backed text generation.
- Phase 2-H uses the internal AI Worker text route through the same service-auth mechanism and does not call admin route handlers directly.

## New API Route

`POST /api/ai/generate-text`

Request:

```json
{
  "organization_id": "org_...",
  "prompt": "Write a short summary",
  "max_tokens": 300,
  "temperature": 0.7
}
```

Response:

```json
{
  "ok": true,
  "text": "...",
  "model": {
    "id": "@cf/meta/llama-3.1-8b-instruct-fast"
  },
  "billing": {
    "organization_id": "org_...",
    "feature": "ai.text.generate",
    "credits_charged": 1,
    "balance_after": 123,
    "idempotent_replay": false
  }
}
```

Replay response sets `credits_charged: 0` and `idempotent_replay: true`.

## Request Contract

Accepted fields:

- `organization_id` or `organizationId`.
- `prompt`.
- `max_tokens` or `maxTokens`.
- `temperature`.

Rejected:

- Missing organization context.
- Empty or too-long prompt.
- Control characters in prompt.
- Unsupported fields, including `model`, `system`, `messages`, or arbitrary provider options.
- Oversized JSON bodies before parsing.
- Malformed JSON through existing body-parser behavior.

The member route uses the fixed member text preset `fast` and does not expose broad model selection in this phase.

## Response Contract And Sanitization

Responses do not expose:

- Raw idempotency keys.
- Idempotency hashes.
- Request fingerprint hashes.
- Raw attempt ids.
- Raw ledger ids.
- Provider secrets.
- Service-auth headers.
- Raw provider payloads.
- Internal SQL/debug metadata.

Replay text is stored only as bounded metadata for the existing replay window.

## Org/RBAC Behavior

- Authenticated user required.
- Explicit organization context required.
- Active organization membership required.
- `owner`, `admin`, and `member` may consume credits.
- `viewer` is denied.
- Non-members and cross-org users are denied safely.
- The route does not silently create organizations or default to a personal org.

## Entitlement Behavior

- Required feature: `ai.text.generate`.
- Cost: 1 credit per successful org-scoped text generation.
- Entitlement-disabled organizations are denied before provider execution.
- Insufficient-credit requests are denied before provider execution.
- No real money prices are encoded.

## Credit Reservation And Finalization Behavior

- The route uses the existing `ai_usage_attempts` reservation model.
- Credits are reserved before provider execution.
- Provider success is finalized into one `usage_events` row and one credit-ledger consume row.
- Provider failure releases/fails the attempt without debit.
- Billing/usage-event failure returns a safe error and does not return a paid result.
- Active reservations continue to reduce available balance through the existing Phase 2-D logic.

## Provider-Result Idempotency Behavior

- `Idempotency-Key` is required.
- Idempotency is scoped to organization, user, route, operation, and request fingerprint.
- Same key and same body reuses the completed attempt.
- Same key and different meaningful body returns `409 idempotency_conflict` before provider execution.
- Pending duplicate attempts return `409 ai_usage_attempt_in_progress` and do not start another provider call.
- Successful retry does not call the provider again and does not debit again.

## Text Result Replay Behavior

Text result replay is implemented.

- Successful text output is stored as bounded replay metadata in `ai_usage_attempts.metadata_json`.
- Same-key/same-body retry returns the same text from metadata.
- Replay metadata expires through the existing Phase 2-E cleanup path.
- No R2 object is created for text replay.
- No schema migration was required because `0036_add_ai_usage_attempts.sql` already includes `metadata_json`, status fields, route/feature fields, and expiration indexes.

## Failure Behavior

- Missing org context: `400`.
- Missing idempotency key: `428`.
- Viewer or entitlement-denied org: `403`.
- Non-member/cross-org: safe denial.
- Insufficient credits: `402`.
- Provider failure: sanitized `502`, no debit.
- AI service/config unavailable: sanitized `503`, reservation released where possible.
- Billing finalization failure: sanitized `503`, no text result returned.
- Oversized body: `413` before parsing.
- Foreign origin: `403` before side effects.
- Missing limiter backend: `503` fail-closed.

## Backward Compatibility

- Legacy no-org `/api/ai/generate-image` behavior remains unchanged.
- Org-scoped image generation behavior remains unchanged.
- Admin AI Lab text generation remains admin-only and uncharged.
- Text asset save/update/delete routes remain storage routes and are not charged.
- Video routes remain unwired.
- Existing migration tracking remains at `0036_add_ai_usage_attempts.sql`.

## Files Added/Modified

Added:

- `workers/auth/src/routes/ai/text-generate.js`
- `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md`

Modified:

- `workers/auth/src/lib/ai-usage-attempts.js`
- `workers/auth/src/routes/ai.js`
- `workers/auth/src/app/route-policy.js`
- `scripts/check-route-policies.mjs`
- `scripts/check-js.mjs`
- `config/release-compat.json`
- `scripts/test-release-compat.mjs`
- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`
- `AUDIT_NEXT_LEVEL.md`
- `AUDIT_ACTION_PLAN.md`
- `DATA_INVENTORY.md`
- `docs/DATA_RETENTION_POLICY.md`
- `workers/auth/CLAUDE.md`

## Migration Decision

No new migration was added.

Reason: existing migration `0036_add_ai_usage_attempts.sql` already provides:

- Generic feature/operation/route fields.
- Attempt/provider/billing/result status fields.
- `metadata_json`.
- Expiration and status indexes used by cleanup/admin inspection.

Latest auth migration remains:

- `0036_add_ai_usage_attempts.sql`

## Route Policy And Release Compatibility

Updated:

- Route policy entry `ai.generate-text`.
- Route policy lookup guard.
- Release compatibility member AI literal routes.
- Release compatibility fixture route source.
- Targeted JS syntax guard.

The route policy declares:

- User auth.
- Same-origin mutation policy.
- JSON body limit `aiGenerateJson`.
- Fail-closed limiter `ai-generate-text-user`.
- Required config `DB`, `PUBLIC_RATE_LIMITER`, `AI_LAB`, and `AI_SERVICE_AUTH_SECRET`.
- Required organization-scoped billing feature `ai.text.generate`.

## Tests Added/Updated

Added Worker coverage for:

- Successful org-scoped text generation charges exactly one credit.
- Same-key/same-body retry replays text without another provider call or debit.
- Same-key/different body conflicts before provider execution.
- Missing organization context rejected.
- Viewer rejected.
- Non-member rejected.
- Disabled entitlement rejected before provider execution.
- Insufficient credits rejected before provider execution.
- Pending duplicate request does not start a second provider call.
- Provider failure does not debit and releases/fails the attempt.
- Billing finalization failure returns safe error and does not return an uncharged paid result.
- Unsupported model/provider options rejected.
- Missing `Idempotency-Key` rejected.
- Oversized body rejected before parsing.
- Foreign origin rejected before side effects.
- Missing limiter backend fails closed.
- Response sanitization does not expose idempotency or request fingerprint internals.

Existing image/admin/text-asset behavior remains covered by the broader Worker suite.

## Commands Run And Results

- `npm run release:preflight` PASS before Phase 2-H edits.
- `npm run check:route-policies` PASS, 116 registered auth-worker route policies.
- `npm run check:js` PASS, 38 targeted files.
- `npm run test:workers` PASS, 339/339. An earlier run failed one new Phase 2-H assertion because upstream provider errors were mapped to `503`; the route now returns sanitized `502` for provider failures without charging.
- `npm run test:static` PASS, 155/155.
- `npm run test:release-compat` PASS.
- `npm run test:release-plan` PASS.
- `npm run test:cloudflare-prereqs` PASS.
- `npm run validate:cloudflare-prereqs` PASS for repo config; production deploy remains BLOCKED because live Cloudflare validation was skipped.
- `npm run validate:release` PASS.
- `npm run check:worker-body-parsers` PASS.
- `npm run check:data-lifecycle` PASS.
- `npm run check:admin-activity-query-shape` PASS.
- `npm run test:operational-readiness` PASS.
- `npm run check:operational-readiness` PASS.
- `npm run build:static` PASS.
- `npm run release:preflight` PASS after Phase 2-H edits.
- `git diff --check` PASS.

## Merge Readiness

Ready for pre-merge review.

- Full Worker/static/release/preflight validation is green.
- `git diff --check` is green.
- Staff review should focus on the new member text generation route, the service-auth proxy, text replay metadata retention, and billing finalization failure behavior.

## Production Deploy Readiness

Blocked.

Production remains blocked until:

- Auth migrations through `0036` are applied.
- `AI_LAB`, `AI_SERVICE_AUTH_SECRET`, `PUBLIC_RATE_LIMITER`, and D1 bindings are live-verified.
- Staging verifies org-scoped text generation success, entitlement denial, insufficient-credit denial, same-key replay, no duplicate provider execution, no duplicate debit, provider-failure no-charge behavior, billing-failure safety, final balance correctness, and compatibility with image/admin/text-asset flows.

## Required Staging Verification

1. Apply auth migrations through `0036`.
2. Deploy Auth and AI Workers to staging with matching `AI_SERVICE_AUTH_SECRET`.
3. Verify `POST /api/ai/generate-text` requires auth, org context, membership, entitlement, and idempotency key.
4. Verify member text generation consumes exactly one credit after provider success.
5. Verify same-key retry replays text without another provider call or debit.
6. Verify same-key different prompt conflicts.
7. Verify viewer/non-member/entitlement-disabled/insufficient-credit cases do not call provider.
8. Verify provider failure does not debit.
9. Verify admin AI Lab text route remains admin-only and uncharged.
10. Verify text asset routes remain uncharged storage routes.

## Rollback Plan

If Phase 2-H causes issues:

- Revert the Auth Worker code and route-policy/release-doc changes for `POST /api/ai/generate-text`.
- No migration rollback is required because no schema migration was added.
- Existing image usage attempts, credit ledger rows, usage events, and temporary replay object cleanup behavior remain compatible.
- Disable external callers for `/api/ai/generate-text` at routing/WAF/API-client level if already exposed in staging.

## Remaining Risks

- Text generation is now credit-enforced only for this new org-scoped route; not all AI usage is credit-enforced.
- No frontend UI was added.
- No live payment provider exists.
- Full tenant isolation and asset ownership migration remain incomplete.
- Text replay stores bounded generated text in `metadata_json`; retention/legal policy still needs review before production privacy commitments.
- Provider model/preset is intentionally fixed; product-level model selection is future work.

## Next Recommended Actions

1. Run full Phase 2-H validation and fix any failures.
2. Perform Staff Security/SRE review of route auth, billing, idempotency, replay, and sanitization.
3. Verify the route in staging with real Auth-to-AI service binding and matching service-auth secret.
4. Decide whether to add frontend UX for org-scoped text generation or keep backend-only until tenant/payment plans mature.
5. Continue Phase 2 with either video credit enforcement, payment-provider integration design, or domain-by-domain tenant ownership migration.
