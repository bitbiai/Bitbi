# Unknown R2 Blocker Cleanup Report

Generated: 2026-06-17T13:31:34.822Z

## Scope

This report covers only exact-key zero-byte marker cleanup for unreferenced R2 objects previously classified as `unknown_blocker_keep`.

Raw keys, ETags, HEAD metadata, and deletion manifests are stored only in local evidence.

## Cleanup Result

- Source evidence: `not run`
- Cleanup evidence: `not run`
- Pre-cleanup unknown blocker count: not run
- Eligible exact zero-byte marker count: 0
- Deleted exact zero-byte marker count: 0
- Blocked investigation count: 0
- Failed delete count: 0
- Failure warning: -
- D1 rows changed: 0
- Exact-key only: not run
- Every deleted object was zero-byte slash marker: not applicable (0 deleted)

| Bucket | Deleted marker objects |
| --- | --- |
| - | - |

| Bucket | Failed marker delete attempts |
| --- | --- |
| - | - |

## Post-Cleanup Full R2 Inventory

- Full R2 listing available: yes
- Full R2 listing complete: yes
- Full R2 object count: 526
- R2 objects without D1 references: 71
- D1 references missing from full R2 inventory: 0
- Later delete candidates from full inventory: 0

## Current Unreferenced Classification Counts

| Classification | Object count |
| --- | --- |
| audit_or_legal_retention_keep | 7 |
| news_pulse_asset | 64 |

## Safety Notes

- No D1 mutation was executed.
- No prefix-wide or wildcard R2 deletion was executed.
- `news_pulse_asset` and `audit_or_legal_retention_keep` objects were not targeted.
- Protected-account prefixes and D1-referenced objects were excluded by manifest checks.
