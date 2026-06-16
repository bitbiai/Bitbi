# Tenant Asset Center Live Cleanup Final Summary

Generated: 2026-06-16T20:54:54.217Z

## Result

This run produced a live D1 inventory, full S3-compatible R2 object inventory when credentials were available, D1/R2 relationship comparisons, classifications, and a cleanup dry-run plan.

No cleanup was executed.

## Full R2 Listing Status

Full R2 listing available: **yes**.

- bitbi-user-images: 514 objects / 980.8 MB
- bitbi-private-media: 7 objects / 132.5 KB
- bitbi-audit-archive: 7 objects / 12.2 KB
- bitbi-public-media: 6 objects / 0 B

## Why Execution Was Blocked

This package is currently a read-only full-inventory pass. Deletion/apply mode remains intentionally blocked until a separate explicit cleanup task validates backup and apply behavior.

## Counts

- D1 tables inventoried: 76
- D1 R2 references collected: 583
- Unique D1-referenced R2 objects: 453
- Full R2 inventory objects listed: 534
- Full R2 inventory bytes listed: 981.0 MB
- D1 references missing from full R2 inventory: 0
- R2 objects without D1 references: 81
- Later delete candidates from full inventory: 0
- R2 objects checked by bounded get: 0
- Missing checked objects: 0
- D1 mutations executed: 0
- R2 deletes executed: 0

## Next Safe Step

Review the full-inventory reports and local raw evidence. A later cleanup task may implement backup/apply behavior for candidates that remain proven unassignable, but this run made no D1 or R2 mutations.
