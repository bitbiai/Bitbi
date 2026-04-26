# Data Deletion / Anonymization Executor Design

Date: 2026-04-26

This is the Phase 1-I engineering design for executing approved deletion and anonymization requests. It is not legal advice, does not enable irreversible deletion by default, and does not claim GDPR/CCPA compliance.

## Current State

Phase 1-H added admin-only lifecycle request creation, planning, and approval. Phase 1-I adds bounded export archive generation. Phase 1-J adds a safe execution pilot for reversible actions only; irreversible deletion/anonymization remains disabled by default.

Current deletion/anonymization plans can identify:

- D1 rows to delete or anonymize.
- R2 object references to delete later.
- Sessions and auth tokens to revoke or expire.
- Admin MFA material to revoke after admin-continuity review.
- Admin audit records to retain or anonymize rather than hard-delete.

## Required Executor States

Recommended request states:

- `approved`: admin approved the plan, but no execution has started.
- `ready_for_execution`: operator explicitly confirmed execution prerequisites.
- `executing`: bounded executor batch is running.
- `safe_actions_completed`: reversible actions completed, irreversible actions still blocked.
- `completed`: all approved actions completed.
- `blocked`: request requires manual/security/legal review.
- `failed`: executor failed safely and can be retried or reviewed.
- `cancelled`: operator cancelled before irreversible work.

## Approval Model

Minimum requirements before irreversible execution:

- Request must be planned and approved by an admin.
- Delete/anonymize requests for an admin account must pass only-active-admin protection.
- A second approval or explicit operator confirmation should be required before hard-deleting user content or R2 objects.
- Legal/product retention exceptions must be approved before audit/security records are anonymized.
- Every execution call must be idempotent.

## Safe Phase 1-J Pilot Actions

Phase 1-J exposes `POST /api/admin/data-lifecycle/requests/:id/execute-safe` for approved delete/anonymize requests. The route defaults to dry-run and rejects destructive modes.

Implemented safe actions:

- Revoke active sessions for the subject user.
- Expire unused password reset tokens.
- Expire unused email verification tokens.
- Expire unused SIWE challenge rows.
- Mark export archives expired.
- Mark matching lifecycle request items completed.
- Mark lifecycle request status as `safe_actions_completed`.

Still deferred:

- Mark account as pending deletion. No reversible account-pending-deletion schema flag exists yet.
- Revoke admin MFA credentials. Admin-continuity rules need a dedicated pilot before enabling this.

## Irreversible Actions Disabled By Default

Do not enable these without a dedicated migration, executor tests, staging dry runs, and explicit approval:

- Hard-delete `users` rows.
- Hard-delete generated AI asset metadata.
- Hard-delete R2 media objects.
- Delete admin audit logs.
- Irreversibly anonymize admin/security records.
- Remove the only active admin.
- Delete historical R2 objects whose owner mapping is not proven.

## R2 Deletion Stages

Recommended R2 execution flow:

1. Build a dry-run plan from owner-scoped D1 rows.
2. Verify every key is under an expected owner prefix.
3. Record keys in lifecycle request items.
4. Execute bounded batches.
5. Mark each item complete or failed.
6. Retry failed keys with capped attempts.
7. Never delete keys outside the planned request item set.

## D1 Deletion / Anonymization Stages

Recommended D1 flow:

1. Re-read approved request and items.
2. Confirm request status and idempotency token.
3. Execute reversible auth-state revocations first.
4. Anonymize retained audit/security rows only according to retention policy.
5. Delete user-owned content rows only after R2 dry-run verification.
6. Mark request complete only after all required items are complete or explicitly retained.

## Failure Handling

- Every item should have independent status and error code.
- Executor batches should be small and retryable.
- A failed batch must not mark the request complete.
- Partial execution must be visible through admin/support APIs.
- Logs must include request id, item id, action, status, and safe error code only.
- Logs must not include secrets, raw request bodies, MFA material, provider credentials, service signatures, or raw archive contents.

## Rollback Limitations

Session/token revocation is reversible only by user re-authentication or token reissue.
R2 and D1 hard deletion is not reliably reversible unless a backup/restore point exists and has been tested.
Audit/security anonymization can permanently reduce investigation value.

## Test Plan

Required tests before enabling execution:

- Only approved requests can execute.
- Only-active-admin deletion is blocked.
- Repeated execution is idempotent.
- Reversible actions do not affect other users.
- R2 deletion never touches keys outside planned owner-scoped references.
- Audit logs are retained/anonymized, not hard-deleted.
- Hard deletion is disabled unless an explicit execution mode is enabled.
- Backend failures leave request/items retryable and visible.

## Open Decisions

- Legal/product retention windows.
- Whether user self-service deletion should require email confirmation and grace period.
- Whether destructive execution requires dual admin approval.
- Whether full account deletion or anonymized tombstone is the product policy.
- Staging restore-drill evidence required before enabling hard deletion.
