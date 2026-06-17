# Tenant Asset Center Live Cleanup Final Summary

Generated: 2026-06-17T03:43:20.319Z

## Result

This run produced a live D1 inventory, full S3-compatible R2 object inventory when credentials were available, D1/R2 relationship comparisons, classifications, and a cleanup dry-run plan.

The run also attempted the narrow exact-key zero-byte unknown R2 marker cleanup: 0 marker object(s) deleted, 10 failed, 0 D1 rows changed.

## Full R2 Listing Status

Full R2 listing available: **yes**.

- bitbi-user-images: 516 objects / 980.8 MB
- bitbi-private-media: 7 objects / 132.5 KB
- bitbi-audit-archive: 7 objects / 12.2 KB
- bitbi-public-media: 6 objects / 0 B

## Why Execution Was Blocked

The broad deletion/apply mode remains intentionally blocked. Only the explicit zero-byte marker cleanup mode was used for this run.

## Counts

- D1 tables inventoried: 76
- D1 R2 references collected: 585
- Unique D1-referenced R2 objects: 455
- Full R2 inventory objects listed: 536
- Full R2 inventory bytes listed: 981.0 MB
- D1 references missing from full R2 inventory: 0
- R2 objects without D1 references: 81
- Later delete candidates from full inventory: 0
- R2 objects checked by bounded get: 0
- Missing checked objects: 0
- D1 mutations executed: 0
- R2 deletes executed: 0

## Next Safe Step

Review the post-cleanup reports and local raw evidence. Remaining unreferenced objects are retained categories or blockers; broad deletion remains disabled.
