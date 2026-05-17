# Main AI Folders/Images Owner-Map Evidence Summary

Generated at: 2026-05-17T13:02:22.805Z
Source report generated at: 2026-05-17T12:58:02.735Z
Source file: docs/tenant-assets/evidence/tenant-asset-ownership-evidence-2026-05-17T12-58-02.735Z.json
Environment: main
Main-only evidence: yes
Synthetic fixture: no
Operator: not_recorded
Commit SHA: not_recorded
Decision status: blocked_for_access_switch_and_backfill

This summary is derived from an operator-provided read-only JSON export. It does not apply a backfill, change access checks, mutate D1/R2, list live R2, call providers, call Stripe, mutate Cloudflare, or prove full tenant isolation.

## Safety Flags

| Field | Observed |
| --- | --- |
| runtimeBehaviorChanged | false |
| accessChecksChanged | false |
| tenantIsolationClaimed | false |
| backfillPerformed | false |
| r2LiveListed | false |
| productionReadiness | blocked |

## Summary Counts

| Count | Value |
| --- | ---: |
| totalFoldersScanned | 16 |
| totalImagesScanned | 63 |
| foldersWithOwnershipMetadata | 4 |
| imagesWithOwnershipMetadata | 0 |
| foldersWithNullOwnershipMetadata | 12 |
| imagesWithNullOwnershipMetadata | 63 |
| metadataMissingTotal | 75 |
| metadataConflictCount | 0 |
| relationshipConflictCount | 0 |
| orphanFolderReferences | 0 |
| publicImagesWithMissingOrAmbiguousOwnership | 21 |
| derivativeOwnershipRisks | 63 |
| simulatedDualReadSafeCount | 4 |
| simulatedDualReadUnsafeCount | 42 |
| needsManualReviewCount | 90 |
| organizationOwnedRowsFound | 0 |

## High-Risk Counts

| Signal | Value |
| --- | ---: |
| metadataMissingTotal | 75 |
| metadataConflictCount | 0 |
| relationshipConflictCount | 0 |
| orphanFolderReferences | 0 |
| publicImagesWithMissingOrAmbiguousOwnership | 21 |
| derivativeOwnershipRisks | 63 |
| simulatedDualReadUnsafeCount | 42 |
| needsManualReviewCount | 90 |

## Decision

Access-check switching and ownership backfill remain blocked until high-risk counts are reviewed and resolved or explicitly accepted by the operator.

## Explicit No-Mutation Statement

- No ownership backfill is recorded.
- No runtime access checks are recorded as changed.
- No D1/R2 mutation or live R2 listing is recorded.
- No tenant isolation, production readiness, or live billing readiness claim is made.

