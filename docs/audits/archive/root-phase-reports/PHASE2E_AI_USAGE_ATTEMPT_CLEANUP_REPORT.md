# Phase 2-E AI Usage Attempt Cleanup Report

Date: 2026-04-26

## Executive Summary

Phase 2-E adds bounded operational cleanup and sanitized admin inspection for the Phase 2-D `ai_usage_attempts` reservation/replay system.

The implementation is intentionally narrow:

- It only affects org-scoped AI image usage attempts created by `/api/ai/generate-image` when an organization context is supplied.
- It does not add a live payment provider, checkout, invoices, billing webhooks, production billing activation, or a global AI paywall.
- It does not change legacy no-org `/api/ai/generate-image` behavior.
- It does not wire text, video, admin AI Lab, or other AI routes to credits.
- It does not hard-delete usage attempts, credit ledger rows, usage events, or temporary replay objects.

Phase 2-E makes expired/stuck attempts operable by releasing stale reservations, expiring replay metadata after its replay window, integrating bounded cleanup into the existing auth Worker scheduled handler, and exposing admin-only sanitized inspection and cleanup APIs.

## Scope

In scope:

- Inspect Phase 2-D `ai_usage_attempts` schema and decide whether a migration is required.
- Add bounded cleanup/expiry logic for stale reservations and expired replay metadata.
- Integrate cleanup into existing auth Worker scheduled cleanup without adding a new cron trigger.
- Add admin-only sanitized list/detail/cleanup APIs.
- Register new routes in route-policy metadata and release compatibility.
- Add Worker tests for cleanup, scheduled behavior, admin inspection, sanitization, and fail-closed guards.

Out of scope:

- Payment-provider integration.
- Global billing activation.
- Tenant migration of existing assets.
- Hard deletion of attempts, ledgers, usage events, media, or replay objects.
- Broad AI route credit enforcement.
- User-facing billing or privacy UI.

## Baseline Confirmed

- Branch: `main`
- Starting working tree: clean before Phase 2-E edits.
- Latest baseline commit before Phase 2-E edits: `7076ead Phase 2-D AI usage reservations and replay safety`
- Phase 2-D report present: `PHASE2D_AI_USAGE_RESERVATION_REPORT.md`
- Latest auth migration before Phase 2-E: `0036_add_ai_usage_attempts.sql`
- Baseline `npm run release:preflight`: passed before Phase 2-E edits.

## Migration Decision

No new D1 migration was added.

`workers/auth/migrations/0036_add_ai_usage_attempts.sql` already provides the fields and indexes needed for Phase 2-E:

- `status`
- `provider_status`
- `billing_status`
- `result_status`
- `expires_at`
- `updated_at`
- organization/user/status/expiry lookup indexes

Phase 2-E keeps the latest auth migration at `0036_add_ai_usage_attempts.sql`.

## Cleanup and Expiry Behavior

New cleanup logic lives in `workers/auth/src/lib/ai-usage-attempts.js`.

Cleanup behavior:

- Processes a bounded batch with a default limit of 25 and max limit of 50.
- Selects only attempts with `expires_at <= now` and eligible stale states.
- Releases stale reserved/provider-running/provider-failed reservations without creating debits.
- Marks expired finalizing attempts as terminal `billing_failed` / `billing_status=failed`.
- Expires replay metadata for completed finalized attempts after the replay window.
- Never modifies completed/finalized attempts that are still within their replay window.
- Never deletes `credit_ledger`, `usage_events`, or `ai_usage_attempts` rows.
- Never creates a debit during cleanup.
- Returns sanitized counts: scanned, expired, reservations released, replay metadata expired, skipped, failed.
- Supports dry-run mode; admin-triggered cleanup defaults to `dry_run: true`.

## Reservation Release Behavior

Expired reserved or provider-running attempts are marked:

- `status='expired'`
- `billing_status='released'`
- `result_status='none'`

Provider-failed attempts with held reservations are also released. Active reservations are no longer counted after cleanup release because their `billing_status` is no longer `reserved`.

## Replay Metadata Cleanup Behavior

Completed/finalized attempts with stored replay metadata are not deleted. When their `expires_at` has passed, cleanup clears temporary replay references and marks:

- `result_status='expired'`

Phase 2-E does not delete temporary replay objects from R2 or other storage. Only metadata is expired. Object deletion remains future retention work unless a safe prefix/ownership rule is added and tested.

## Scheduled Cleanup Behavior

The auth Worker already has a scheduled cleanup path. Phase 2-E integrates usage-attempt cleanup there with:

- No new cron trigger.
- A bounded batch limit.
- Best-effort execution.
- Error isolation so usage-attempt cleanup failures do not permanently block other scheduled cleanup work.
- Sanitized structured events:
  - `ai_usage_attempt_cleanup_completed`
  - `ai_usage_attempt_cleanup_failed`

## Admin Inspection APIs

New admin-only APIs in `workers/auth/src/routes/admin-ai.js`:

- `GET /api/admin/ai/usage-attempts`
- `GET /api/admin/ai/usage-attempts/:id`
- `POST /api/admin/ai/usage-attempts/cleanup-expired`

All routes require the existing admin authorization path. Production MFA policy remains enforced by `requireAdmin`.

List behavior:

- Supports small bounded pagination.
- Supports safe filters for `status`, `organization_id`, `user_id`, and `feature`.
- Uses signed admin pagination cursors.

Cleanup mutation behavior:

- Requires same-origin mutation guard.
- Requires `Idempotency-Key`.
- Uses byte-limited JSON parsing.
- Uses fail-closed admin rate limiting.
- Defaults to dry-run unless `dry_run: false` is explicitly supplied.

## Sanitization Behavior

Admin responses intentionally omit:

- raw prompt
- generated image bytes
- raw provider response
- provider secrets
- raw `Idempotency-Key`
- idempotency key hash
- request fingerprint hash
- temporary replay object key
- generated-image save reference
- internal SQL/debug metadata
- secret names or values

Responses include only operational fields needed for support/debugging: attempt id, org/user ids, feature, route/operation, statuses, credit cost, replay-state summary, safe error code, timestamps, and sanitized cleanup counts.

## Backward Compatibility Behavior

- Legacy no-org `/api/ai/generate-image` remains unchanged and uncharged.
- Org-scoped Phase 2-D success/replay behavior remains intact.
- Admin AI Lab routes remain uncharged.
- Text and video AI routes remain intentionally unwired to credit enforcement.
- No live payment provider or production billing activation was added.

## Route Policy and Release Compatibility

Updated route-policy metadata covers:

- `admin.ai.usage-attempts.list`
- `admin.ai.usage-attempts.read`
- `admin.ai.usage-attempts.cleanup-expired`

Release compatibility now includes:

- `/api/admin/ai/usage-attempts`
- `/api/admin/ai/usage-attempts/:id`
- `/api/admin/ai/usage-attempts/cleanup-expired`

Latest auth migration remains `0036_add_ai_usage_attempts.sql`.

## Tests Added/Updated

Worker tests were added for:

- Admin-only list/detail access.
- Sanitized usage-attempt responses.
- Cleanup dry-run with no side effects.
- Cleanup execution for expired reserved/provider-running/finalizing attempts.
- Replay metadata expiry for completed attempts past replay window.
- Completed/finalized attempts inside the replay window not being modified.
- Idempotent repeated cleanup.
- No debit or usage-event creation during cleanup.
- Foreign-origin mutation rejection before side effects.
- Oversized cleanup body returning 413 before parsing.
- Limiter exhaustion returning 429.
- Missing limiter backend returning 503 fail-closed.
- Scheduled cleanup releasing expired attempts without corrupting completed attempts.

The auth Worker test harness was updated to model the new D1 select/update shapes.

## Commands Run and Results

| Command | Result |
| --- | --- |
| `npm run check:route-policies` | PASS; 115 registered auth-worker route policies validated. |
| `npm run check:js` | PASS; 37 targeted files validated. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 2-E\|Phase 2-D\|Phase 2-C"` | PASS, 14/14. |
| `npm run test:workers` | PASS, 334/334. |
| `npm run test:static` | PASS, 155/155. |
| `npm run test:release-compat` | PASS. |
| `npm run test:release-plan` | PASS. |
| `npm run test:cloudflare-prereqs` | PASS. |
| `npm run validate:cloudflare-prereqs` | PASS for repo config; live validation skipped; production deploy remains blocked. |
| `npm run validate:release` | PASS. |
| `npm run check:worker-body-parsers` | PASS. |
| `npm run check:data-lifecycle` | PASS. |
| `npm run check:admin-activity-query-shape` | PASS. |
| `npm run test:operational-readiness` | PASS. |
| `npm run check:operational-readiness` | PASS. |
| `npm run build:static` | PASS. |
| `npm run release:preflight` | PASS. |
| `git diff --check` | PASS. |

The first Phase 2-E release compatibility attempt failed because `/admin/ai/usage-attempts` was incorrectly added to the static Admin AI contract even though no static frontend caller was added. The contract was corrected to register only the real auth-worker admin API routes, and `npm run test:release-compat`, `npm run test:release-plan`, and `npm run test:cloudflare-prereqs` passed afterward.

## Merge Readiness

Pass for review/merge after commit.

## Production Deploy Readiness

Blocked.

Production readiness remains blocked until staging verifies:

- migration `0036` is applied
- org-scoped image attempt cleanup behavior
- admin inspection routes
- admin cleanup dry-run and execution
- scheduled cleanup integration
- no completed-attempt corruption
- no debit creation during cleanup
- legacy no-org image generation compatibility

## Required Staging Verification Steps

1. Apply auth migrations through `0036` in staging.
2. Deploy auth Worker code with Phase 2-E changes.
3. Create an org-scoped image generation success attempt and verify normal replay behavior still works.
4. Create or seed expired reserved/provider-running/finalizing attempts and verify cleanup releases or fails them safely.
5. Verify completed/finalized attempts inside the replay window are not modified.
6. Verify replay metadata expires after `expires_at`.
7. Verify admin list/detail responses are sanitized.
8. Verify cleanup dry-run has no side effects.
9. Verify cleanup execution does not create ledger debits or usage events.
10. Verify scheduled cleanup runs without breaking other scheduled tasks.
11. Verify legacy no-org `/api/ai/generate-image` still works and is not charged.

## Rollback Plan

- Revert the Phase 2-E code changes if cleanup or admin inspection causes regressions.
- No database rollback is required because no migration was added.
- If scheduled cleanup misbehaves, revert the auth Worker scheduled cleanup integration first.
- Existing Phase 2-D attempts/reservations remain readable because schema `0036` is unchanged.
- Keep payment-provider integration disabled; no external billing state is affected.

## Remaining Risks

- Temporary replay object deletion is not implemented; Phase 2-E expires metadata only.
- Cleanup is bounded and best-effort; operators still need staging/live monitoring of stale attempt counts.
- Only org-scoped image generation uses attempts/reservations; text/video/admin AI routes remain intentionally unwired.
- No live payment provider, invoices, checkout, or billing webhooks exist.
- Existing assets are still not fully tenant-owned.
- Production deploy still requires live Cloudflare and staging verification.

## Next Recommended Actions

1. Perform Staff Security/SRE pre-merge review focused on cleanup safety and response sanitization.
2. Commit the Phase 2-E code, tests, release contract, and docs together if review passes.
3. Verify Phase 2-E behavior in staging after migration `0036`.
4. Decide whether to add safe temp replay object deletion with explicit prefix/ownership rules.
5. Choose the next Phase 2 track: additional AI route credit enforcement, payment-provider integration design, or domain-by-domain tenant ownership migration.
