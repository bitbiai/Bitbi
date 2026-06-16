# Tenant Asset Center Live Cleanup Final Summary

Generated: 2026-06-16T20:48:37.842Z

## Result

This run produced a live D1 inventory, full S3-compatible R2 object inventory when credentials were available, D1/R2 relationship comparisons, classifications, and a cleanup dry-run plan.

No cleanup was executed.

## Full R2 Listing Status

Full R2 listing available: **no**.

The Codex command environment did not expose the required R2 S3-compatible credential variables. Values were never printed. The run failed closed and did not perform object deletion or D1 mutation.

## Why Execution Was Blocked

This package is currently a read-only full-inventory pass. Deletion/apply mode remains intentionally blocked until a separate explicit cleanup task validates backup and apply behavior.

## Counts

- D1 tables inventoried: 76
- D1 R2 references collected: 583
- Unique D1-referenced R2 objects: 453
- Full R2 inventory objects listed: 0
- Full R2 inventory bytes listed: 0 B
- D1 references missing from full R2 inventory: 0
- R2 objects without D1 references: 0
- Later delete candidates from full inventory: 0
- R2 objects checked by bounded get: 0
- Missing checked objects: 0
- D1 mutations executed: 0
- R2 deletes executed: 0

## Next Safe Step

Run the same dry-run from a shell/process where `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are visible to Node. Do not paste the values into the repo or reports. This run made no D1 or R2 mutations.
