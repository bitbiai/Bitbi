# Unknown R2 Blocker Cleanup Report

Generated: 2026-06-17T03:43:20.319Z

## Scope

This report covers only exact-key zero-byte marker cleanup for unreferenced R2 objects previously classified as `unknown_blocker_keep`.

Raw keys, ETags, HEAD metadata, and deletion manifests are stored only in local evidence.

## Cleanup Result

- Source evidence: `/Users/bitbi/Bitbi/.local/operator-evidence/tenant-asset-live-cleanup-20260616T205454Z`
- Cleanup evidence: `.local/operator-evidence/unknown-r2-blocker-cleanup-20260617T034320Z`
- Pre-cleanup unknown blocker count: 10
- Eligible exact zero-byte marker count: 10
- Deleted exact zero-byte marker count: 0
- Blocked investigation count: 0
- Failed delete count: 10
- Failure warning: one_or_more_exact_key_deletes_failed_no_broad_retry_performed
- D1 rows changed: 0
- Exact-key only: yes
- Every deleted object was zero-byte slash marker: not applicable (0 deleted)

| Bucket | Deleted marker objects |
| --- | --- |
| - | - |

| Bucket | Failed marker delete attempts |
| --- | --- |
| bitbi-private-media | 4 |
| bitbi-public-media | 6 |

## Post-Cleanup Full R2 Inventory

- Full R2 listing available: yes
- Full R2 listing complete: yes
- Full R2 object count: 536
- R2 objects without D1 references: 81
- D1 references missing from full R2 inventory: 0
- Later delete candidates from full inventory: 0

## Current Unreferenced Classification Counts

| Classification | Object count |
| --- | --- |
| audit_or_legal_retention_keep | 7 |
| news_pulse_asset | 64 |
| unknown_blocker_keep | 10 |

## Safety Notes

- No D1 mutation was executed.
- No prefix-wide or wildcard R2 deletion was executed.
- `news_pulse_asset` and `audit_or_legal_retention_keep` objects were not targeted.
- Protected-account prefixes and D1-referenced objects were excluded by manifest checks.
