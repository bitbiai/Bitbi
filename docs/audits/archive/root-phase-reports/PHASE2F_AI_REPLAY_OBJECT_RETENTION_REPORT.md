# Phase 2-F AI Replay Object Retention Report

Date: 2026-04-26

## Executive Summary

Phase 2-F adds bounded, prefix-scoped lifecycle handling for temporary replay objects created by the Phase 2-D org-scoped AI image idempotency/replay system.

The implementation is intentionally narrow:

- It only affects temporary replay objects linked from `ai_usage_attempts` for org-scoped `/api/ai/generate-image`.
- It does not add a live payment provider, checkout, invoices, billing webhooks, production billing activation, or a global AI paywall.
- It does not change legacy no-org `/api/ai/generate-image` behavior.
- It does not wire text, video, admin AI Lab, or other AI routes to credits.
- It does not delete `credit_ledger`, `usage_events`, `ai_usage_attempts`, saved user media, private media, audit archives, export archives, video outputs, posters, derivatives, text assets, or unrelated R2 objects.

Phase 2-F makes expired temporary replay objects operable by deleting only objects under the approved `tmp/ai-generated/{userId}/{tempId}` prefix after validating the linked attempt row, owner segment, expiry, and terminal status. Unsafe keys are skipped, and cleanup responses/logs remain sanitized.

## Scope

In scope:

- Inspect Phase 2-D replay object storage and Phase 2-E cleanup behavior.
- Add strict replay object key validation and prefix allowlisting.
- Prevent the generic generated-temp cleanup from deleting objects still linked from `ai_usage_attempts`.
- Extend existing usage-attempt cleanup so expired finalized attempts can delete their temporary replay object before clearing replay metadata.
- Keep cleanup bounded, idempotent, dry-run capable, and safe on partial R2 failures.
- Extend sanitized cleanup counts for admin-triggered and scheduled cleanup.
- Add Worker tests for prefix safety, dry-run, execution, R2 failure, missing objects, scheduled cleanup, and no ledger/usage mutation.

Out of scope:

- New payment-provider integration.
- New AI route wiring.
- Global billing enforcement.
- Tenant migration of existing assets.
- Permanent provider-result caching.
- Broad R2 bucket cleanup.
- Hard deletion of database rows.

## Baseline Confirmed

- Branch: `main`
- Starting working tree: clean before Phase 2-F edits.
- Latest baseline commit before Phase 2-F edits: `378aeb1 Phase 2-E Add AI usage attempt cleanup and inspec`
- Phase 2-E report present: `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md`
- Latest auth migration before Phase 2-F: `0036_add_ai_usage_attempts.sql`
- Baseline `npm run release:preflight`: passed before Phase 2-F edits.

## Replay Object Storage and Prefix Findings

Replay objects are created by `workers/auth/src/routes/ai/generated-image-save-reference.js`.

- R2 binding: `USER_IMAGES`
- Prefix: `tmp/ai-generated/`
- Key shape: `tmp/ai-generated/{userId}/{tempId}`
- The generated save reference signs only the temp id and user binding; the raw R2 key is not returned in admin responses.
- Phase 2-D stores the temp key and save reference in `ai_usage_attempts.result_temp_key` and `ai_usage_attempts.result_save_reference` after provider success and billing finalization.
- Phase 2-E already had an expiry timestamp (`expires_at`) and status fields sufficient for bounded cleanup.

No new migration was required because `0036_add_ai_usage_attempts.sql` already has:

- `result_temp_key`
- `result_save_reference`
- `result_status`
- `status`
- `billing_status`
- `expires_at`
- status/expiry indexes for bounded cleanup lookup

## Replay Object Cleanup Behavior

Cleanup logic is in `workers/auth/src/lib/ai-usage-attempts.js`.

Cleanup deletes a replay object only when all of these are true:

- The attempt is `status='succeeded'`.
- The attempt is `billing_status='finalized'`.
- The attempt is `result_status='stored'`.
- The attempt `expires_at` is at or before cleanup time.
- `result_temp_key` is present.
- The key is under exactly `tmp/ai-generated/`.
- The key shape is exactly `tmp/ai-generated/{userId}/{tempId}`.
- The key user segment matches `ai_usage_attempts.user_id`.
- The temp id contains only bounded safe characters.
- The object exists or is safely missing.

If the object exists and deletion succeeds, cleanup clears replay metadata and marks `result_status='expired'`. If the object is already missing, cleanup clears expired replay metadata idempotently. If deletion fails, cleanup records a sanitized failure count and leaves metadata intact for retry.

## Prefix Safety Behavior

The validator rejects:

- empty or oversized keys
- keys outside `tmp/ai-generated/`
- keys with path traversal, backslashes, control characters, double slashes, or leading slashes
- keys with an invalid path shape
- keys whose user segment does not match the attempt user
- keys under known unrelated prefixes such as `users/`, `data-exports/`, `avatars/`, `video-jobs/`, and cleanup prefixes

Unsafe keys are skipped and are not deleted. Admin responses return counts and safe error codes only, not raw keys.

## Metadata Cleanup Behavior

Successful replay cleanup updates only the replay metadata fields:

- `result_status='expired'`
- `result_temp_key=NULL`
- `result_save_reference=NULL`
- `updated_at=<cleanup time>`

It does not alter provider success, billing finalization, credit ledger rows, usage events, attempt rows, balances, or successful billing evidence.

## R2 Deletion Behavior

R2 deletion uses `USER_IMAGES.delete(key)` only after key validation and attempt eligibility checks pass.

Cleanup never deletes:

- `users/{userId}/...` saved media
- private media
- avatars
- audit archives
- lifecycle export archives
- async video output/poster objects
- derivatives
- text assets
- arbitrary R2 keys

R2 delete failures are counted as `replayObjectFailedCount` / `failedCount` and do not clear metadata. Missing objects are handled as idempotent cleanup and metadata is cleared if the attempt is expired and eligible.

## Scheduled Cleanup Behavior

The existing auth Worker scheduled handler is extended without adding a new cron trigger.

Two safeguards are now in place:

- The generic `tmp/ai-generated/` cleanup skips objects that are still linked from `ai_usage_attempts`.
- The AI usage-attempt cleanup owns deletion for expired attempt-linked replay objects.

Scheduled cleanup remains bounded and best-effort. Replay object cleanup failure does not delete unrelated objects and is reported through sanitized counts in `ai_usage_attempt_cleanup_completed` / `ai_usage_attempt_cleanup_failed` events.

## Admin Cleanup and Inspection Behavior

No new admin route was added.

The existing route remains:

- `POST /api/admin/ai/usage-attempts/cleanup-expired`

It still requires:

- platform admin authorization
- production MFA through existing admin policy
- same-origin mutation guard
- `Idempotency-Key`
- byte-limited JSON parsing
- fail-closed admin rate limiting
- route-policy registration

The cleanup response now includes sanitized replay-object counts:

- `replayObjectsEligibleCount`
- `replayObjectsDeletedCount`
- `replayObjectMetadataClearedCount`
- `replayObjectsSkippedActiveCount`
- `replayObjectsSkippedUnsafeKeyCount`
- `replayObjectsSkippedMissingObjectCount`
- `replayObjectFailedCount`

No raw R2 keys, save references, prompts, request fingerprints, idempotency hashes, provider payloads, image bytes, SQL/debug metadata, or secrets are returned.

## Backward Compatibility Behavior

- Legacy no-org `/api/ai/generate-image` remains unchanged and uncharged.
- Org-scoped Phase 2-D replay still works before replay expiry.
- Phase 2-E cleanup behavior still releases stale reservations without debits.
- Admin AI Lab, text AI routes, and video AI routes are not charged or changed.
- No new migration or Cloudflare binding is required.

## Route Policy and Release Compatibility

Route policy metadata for `admin.ai.usage-attempts.cleanup-expired` was updated to document that the route may delete only expired, attempt-linked temporary replay objects under the approved prefix.

No new route was added. No release compatibility resource change was required. Latest auth migration remains `0036_add_ai_usage_attempts.sql`.

## Tests Added/Updated

Worker tests were added or updated for:

- Dry-run identifying expired replay objects without deleting them.
- Execute deleting only eligible expired temporary replay objects.
- Metadata clearing after successful deletion.
- Missing replay object idempotency.
- R2 delete failure being reported without clearing metadata.
- Unsafe object key being skipped.
- Unrelated `users/` saved-media prefix being skipped.
- Active/fresh attempt replay object not being deleted.
- Scheduled cleanup deleting unlinked stale temp objects through the generic cleanup while preserving linked active replay objects.
- Scheduled cleanup deleting expired linked replay objects only through usage-attempt cleanup.
- Admin cleanup responses not exposing raw keys or save references.
- No `credit_ledger` or `usage_events` mutation during cleanup.
- Existing Phase 2-E reservation cleanup and fail-closed admin cleanup route behavior.

The auth Worker test harness was updated with R2 `head()` support and the new D1 lookup/update shapes.

## Commands Run and Results

| Command | Result |
| --- | --- |
| `npm run release:preflight` before Phase 2-F edits | PASS. |
| `npx playwright test -c playwright.workers.config.js -g "Phase 2-F\|Phase 2-E admin usage attempt\|Phase 2-E scheduled cleanup"` | PASS, 5/5. |
| `npm run check:route-policies` | PASS; 115 registered auth-worker route policies validated. |
| `npm run check:js` | PASS; 37 targeted files validated. |
| `npm run test:workers` | PASS, 336/336. |
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

## Merge Readiness

Pass for review/merge after commit.

## Production Deploy Readiness

Blocked.

Production readiness remains blocked until staging verifies:

- migration `0036` is applied
- replay object cleanup dry-run and execution
- scheduled replay object cleanup
- prefix allowlist safety
- R2 deletion failure handling
- no unrelated object deletion
- no ledger/usage row deletion
- no debit creation during cleanup
- legacy no-org image generation compatibility

## Required Staging Verification Steps

1. Apply auth migrations through `0036` in staging.
2. Deploy auth Worker code with Phase 2-F changes.
3. Generate an org-scoped image with an idempotency key and verify normal replay works before expiry.
4. Let or seed a replay attempt pass `expires_at`.
5. Run admin cleanup dry-run and verify no R2 object is deleted.
6. Run admin cleanup execution and verify only the linked `tmp/ai-generated/{userId}/{tempId}` object is deleted.
7. Verify unsafe/unrelated prefixes are skipped.
8. Verify R2 delete failure leaves metadata for retry.
9. Verify scheduled cleanup performs the same bounded behavior.
10. Verify no `credit_ledger` or `usage_events` rows are deleted or created by cleanup.
11. Verify legacy no-org `/api/ai/generate-image` still works and is not charged.

## Rollback Plan

- Revert the Phase 2-F code and documentation changes if replay object cleanup causes regressions.
- No database rollback is required because no migration was added.
- If scheduled cleanup misbehaves, revert the generic temp cleanup skip and usage-attempt replay object deletion changes together.
- Existing Phase 2-D/2-E attempts remain readable because schema `0036` is unchanged.
- Keep payment-provider integration disabled; no external billing state is affected.

## Remaining Risks

- Cleanup is bounded and best-effort; operators still need staging/live monitoring of replay cleanup failure counts.
- Temporary replay is still not a permanent provider-result cache.
- Only org-scoped image generation uses attempts/reservations; text/video/admin AI routes remain intentionally unwired.
- No live payment provider, invoices, checkout, or billing webhooks exist.
- Existing assets are still not fully tenant-owned.
- Production deploy still requires live Cloudflare and staging verification.

## Next Recommended Actions

1. Perform Staff Security/SRE pre-merge review focused on prefix safety, R2 deletion scope, sanitization, and no billing mutation during cleanup.
2. Commit the Phase 2-F code, tests, and docs together if review passes.
3. Verify Phase 2-F behavior in staging after migration `0036`.
4. Monitor replay cleanup failure and unsafe-key counts after staging deploy.
5. Choose the next Phase 2 track: additional AI route credit enforcement, payment-provider integration design, or domain-by-domain tenant ownership migration.
