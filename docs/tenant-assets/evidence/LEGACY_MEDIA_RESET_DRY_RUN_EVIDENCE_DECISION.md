# Legacy Media Reset Dry-run Evidence Decision

Date: 2026-05-18

Decision status: `legacy_media_reset_dry_run_pending`

Dry-run topic status: not closed.

## Decision

Phase 6.25 rechecked the approved evidence locations and still found no real live/main Phase 6.23 legacy media reset executor dry-run evidence file.

Confirmed reset execution remains blocked. This document records the pending evidence state and the confirmation gate only. It does not approve deletion, public/gallery depublishing, R2 cleanup, ownership backfill, access-check switching, tenant isolation, production readiness, or live billing readiness.

## Evidence Search

Repository-controlled locations reviewed:

- `docs/tenant-assets/evidence/`
- `docs/production-readiness/evidence/` if present

Real legacy reset dry-run evidence files found: none.

Reviewed files include this pending decision plus manual-review evidence files. Synthetic fixtures, Phase 6.21 dry-run design docs, Phase 6.22 executor design docs, Phase 6.23 implementation tests, Phase 6.24 runbook/template docs, pending markers, and screenshots without JSON/Markdown executor dry-run evidence were excluded as live/main operator evidence.

## Missing Evidence

Phase 6.26 still needs a sanitized live/main dry-run export from:

- `POST /api/admin/tenant-assets/legacy-media-reset/execute`

Expected safe filenames include:

- `docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json`
- `docs/tenant-assets/evidence/2026-05-18-legacy-media-reset-dry-run-live.json`
- `docs/tenant-assets/evidence/tenant-asset-legacy-media-reset-dry-run-<timestamp>.json`

The evidence must show `dryRun: true`, no confirmed execution/deletion, selected domains, allowed/deferred domains, candidate counts, public/gallery warnings, derivative/R2 key-type counts if available, and safety flags proving no deletion, no backfill, no access switch, no source mutation, no ownership metadata update, and no R2 listing/mutation.

## Dry-run Request Summary

No real request evidence is available in the repository.

Expected selected domains for the operator dry-run are:

- `ai_images`
- `ai_folders`
- `ai_image_derivatives`
- `public_gallery_references`

Recorded selected domains: not available.

## Candidate Counts

No candidate counts are recorded because no real dry-run evidence file is present.

| Field | Evidence value |
| --- | --- |
| Images proposed for retirement | pending |
| Folders proposed for retirement | pending |
| Public/gallery references | pending |
| Derivative/thumb/medium references | pending |
| R2 key-type counts | pending |
| Storage/quota impact | pending |
| Blocked candidate count | pending |

## Deferred Or Blocked Domains

The Phase 6.23 executor design and implementation defer these domains, but no live/main dry-run evidence has confirmed current counts:

- video assets/jobs
- music/audio assets
- text assets
- profile avatars
- data lifecycle exports
- audit archive
- unknown media tables
- manual-review supersession

## Confirmation Gate

Phase 6.25 adds `docs/tenant-assets/LEGACY_MEDIA_RESET_CONFIRMATION_GATE_CHECKLIST.md`.

The gate remains closed until a later phase commits safe live/main executor dry-run evidence and updates this decision to either `legacy_media_reset_dry_run_collected_blocked` or `legacy_media_reset_dry_run_collected_ready_for_confirmation_review`. The checklist does not authorize deletion by itself.

## Safety Confirmations

For Phase 6.25 Codex/test activity:

- No confirmed reset execution occurred.
- No dry-run executor call was made by Codex/tests.
- No media rows were deleted.
- No ownership backfill was performed.
- No source asset rows were updated.
- No ownership metadata was updated.
- No review rows were mutated.
- No reset action rows were mutated.
- No access checks changed.
- No R2 objects were listed, moved, copied, rewritten, or deleted live.
- No provider, Stripe, Cloudflare, GitHub, credit, or billing mutation occurred.

The missing operator evidence means these same safety flags still need to be proven by a live/main dry-run export before a later confirmation phase can be considered.

## Remaining Blockers

- Live/main executor dry-run evidence is not committed.
- Candidate counts are unknown.
- Public/gallery impact is unknown.
- Derivative/R2 key-type counts are unknown.
- Deferred video/music/text/profile domains have no reset coverage.
- Confirmed reset execution is not approved.
- Public content removal, irreversible deletion, and no-credit-refund acknowledgements have not been reviewed against real evidence.
- Tenant isolation remains unclaimed.
- Production readiness remains blocked.

## Next Recommended Phase

`Phase 6.26 — Operator Runs Legacy Media Reset Dry-run`

That phase should collect the live/main dry-run evidence only. It should not execute confirmed deletion, backfill ownership, switch access checks, mutate source rows, update ownership metadata, update review rows, update reset action rows, list or mutate live R2, or claim tenant isolation.
