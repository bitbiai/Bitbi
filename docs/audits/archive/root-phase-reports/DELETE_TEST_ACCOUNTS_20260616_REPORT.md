# Delete Test Accounts Report - 2026-06-16

## Scope

Authorized exact test accounts:

- `ziegenbart@bk.ru` -> `86f0add4-8dbc-46a5-ac5d-0a3d8cf6ae2b`
- `sanctum@kiandex.com` -> `a0449616-f654-413f-83e0-0f401fd1ec2c`

No fuzzy matching or domain matching was used.

## Evidence

Raw backups and execution evidence are local only and gitignored:

- `.local/operator-evidence/delete-test-accounts-20260616T175158Z/`

Important local files:

- `02-full-d1-backup.sql`
- `03-schema.sql`
- `06-target-row-inventory-redacted.json`
- `08-r2-inventory-redacted.json`
- `09-dry-run-plan.json`
- `11-execution-delete.sql`
- `13-r2-deletion-results-redacted.json`
- `14-verification.json`
- `16-r2-retry-results-redacted.json`
- `17-r2-retry-summary.json`

## D1 Result

Completed. Post-delete verification reported:

- `targetUsersRemaining`: `0`
- `targetUserReferenceRowsRemaining`: `0`

D1 rows removed by table:

| Table | Rows |
| --- | ---: |
| `activity_search_index` | 3 |
| `admin_audit_log` | 5 |
| `ai_asset_manual_review_items` | 4 |
| `ai_generation_log` | 1 |
| `ai_images` | 1 |
| `data_lifecycle_requests` | 1 |
| `member_credit_buckets` | 4 |
| `member_credit_ledger` | 2 |
| `profiles` | 1 |
| `r2_cleanup_queue` | 9 |
| `user_asset_storage_usage` | 2 |
| `users` | 2 |

No live Stripe/provider/subscription rows were in the executed delete plan.

## R2 Result

Configured repo bindings verified:

- `USER_IMAGES` -> `bitbi-user-images`
- `PRIVATE_MEDIA` -> `bitbi-private-media`
- `AUDIT_ARCHIVE` -> `bitbi-audit-archive`

The dashboard-visible `bitbi-public-media` bucket exists, but it is not bound in `workers/auth/wrangler.jsonc`; it was not modified.

Five exact target-prefix R2 keys were enumerated:

- 3 `USER_IMAGES` objects under the `users/86f0add4-.../` prefix
- 2 synthetic `PRIVATE_MEDIA` avatar keys, both already missing

Wrangler R2 deletion returned success for all five keys. Verification and retry evidence still showed the three `USER_IMAGES` objects as readable:

- `deletedR2ObjectsStillReadable`: `3`
- retry `stillReadable`: `3`

The three remaining keys are redacted in the local evidence with hashes and safe prefixes. They have no remaining D1 references after the D1 cleanup. A harmless temporary R2 object was created and deleted successfully with the same Wrangler CLI, so the remaining R2 issue appears specific to those target objects or their storage state, not a general CLI failure.

## Safety Notes

- No non-target user IDs were part of the D1 delete predicates.
- No broad R2 wildcard delete was performed.
- No Stripe calls were made.
- No billing/credit/subscription code was changed.
- No Worker routes, schemas, migrations, bindings, or public/member UI were changed.

## Follow-up

Before the larger D1/R2/Web relationship audit, manually remove or re-check the three orphaned `USER_IMAGES` objects recorded in local evidence if a non-Wrangler deletion path is available. They are no longer referenced by D1 after this cleanup.
