# Legacy Personal Media Reset Dry Run

Date: 2026-05-17

Phase 6.21 adds a bounded, admin-only, read-only dry-run report for evaluating whether retiring old personal/admin-created media and recreating media under the current ownership-metadata write paths may be cleaner than ownership backfill.

This phase is evidence and planning only. It does not delete media, depublish public rows, update source asset rows, update manual-review rows, backfill ownership, change access checks, list live R2, or mutate R2.

## Endpoints

- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run/export`

Both endpoints are admin-only, production-MFA protected by route policy, high-sensitivity, rate-limited, DB-backed, bounded, sanitized, and read-only.

Supported query options:

- `limit`
- `includeDetails`
- `includeImages`
- `includeFolders`
- `includePublic`
- `includeDerivatives`
- `includeVideos`
- `includeMusic`
- `includeTextAssets`
- `includeQuota`
- `format` on the export endpoint: `json` or `markdown`

## Domains Inventoried

| Domain | Phase 6.21 coverage | Notes |
| --- | --- | --- |
| `ai_folders` | `covered_by_phase_6_21_dry_run` | Counts total folders, active folders, ownership metadata presence, and child-handling implications. |
| `ai_images` | `covered_by_phase_6_21_dry_run` | Counts total images, ownership metadata presence, public rows, folder-linked rows, and derivative references. |
| Public gallery / Mempics | `covered_by_phase_6_21_dry_run` | Public rows require depublish/gallery review before any future delete executor. |
| Derivative/thumb/medium references | `covered_by_phase_6_21_dry_run` | Derived from D1 only. No live R2 existence check is performed. |
| `ai_text_assets` | `partially_covered` | Summarizes text/music/video saved assets if the table exists; ownership migration coverage is not claimed. |
| Music assets | `partially_covered` | Counts `ai_text_assets.source_module = music`; future coverage review is required before deletion. |
| Video saved assets and jobs | `partially_covered` | Counts saved video rows and `ai_video_jobs`; future coverage review is required before deletion. |
| `user_asset_storage_usage` | `partially_covered` | Uses D1-stored byte counts only; no R2 `head`/`list` is performed. |
| Manual review items | `covered_by_phase_6_21_dry_run` when review tables exist | Reports how many review items may become obsolete after a successful future reset, but mutates none. |
| Lifecycle/delete paths | `partially_covered` | Confirms a future executor must reuse existing lifecycle/delete helpers and durable cleanup queues instead of direct SQL/R2 deletion. |

Optional/missing tables are reported as `unknown_schema`; the report does not claim coverage for missing domains.

## Candidate Classifications

The report uses dry-run labels only:

- `candidate_safe_for_future_executor`
- `candidate_requires_depublish_or_gallery_review`
- `candidate_requires_derivative_cleanup`
- `candidate_requires_folder_child_handling`
- `candidate_requires_existing_delete_path`
- `candidate_requires_manual_review`
- `candidate_unknown_table_or_schema`
- `candidate_not_covered`
- `blocked_active_dependency`
- `blocked_unowned_or_org_unknown`
- `not_selected`

No label authorizes deletion or access switching.

## Public/Gallery Handling

Public rows cannot be silently deleted. A future executor must deliberately handle public/gallery references, attribution/history impact, and current public content disappearance. Phase 6.21 changes no public visibility, gallery rows, public URLs, or media serving behavior.

## Derivative Handling

Derivative, poster, and thumbnail references are inferred from D1 metadata only. Phase 6.21 does not list, inspect, move, or delete live R2 objects. A future executor must clean parent and derivative references atomically or through the existing lifecycle cleanup queue/delete logic.

## Video/Music Handling

Phase 6 ownership work focused on `ai_folders` and `ai_images`. The reset dry-run inspects `ai_text_assets` and `ai_video_jobs` conservatively:

- known tables are summarized by counts and public/source-module/job-status rollups;
- unknown or absent tables are marked `unknown_schema`;
- no reset coverage is claimed for video/music without a future executor design or coverage expansion.

## Manual Review Impact

If manual-review tables exist, the report summarizes review item/event counts, status/category rollups, and the number of folder/image-related review items that may become obsolete after a successful future reset. Phase 6.21 does not update, supersede, delete, or create manual-review rows.

## Future Executor Requirements

A later executor, if approved, must:

- default to `dryRun: true`;
- require admin auth, production MFA, same-origin writes, fail-closed rate limits, bounded JSON, explicit `confirm: true`, a bounded reason, and `Idempotency-Key`;
- use existing lifecycle/delete helpers and durable cleanup queues;
- avoid direct uncontrolled SQL or R2 deletion;
- write audit evidence;
- verify no source/orphan rows remain;
- recalculate or verify storage quota;
- supersede manual-review rows only in a separately approved phase.

## Safety Statement

Phase 6.21 performs no deletion, no ownership backfill, no access-check switch, no source asset mutation, no ownership metadata update, no review row mutation, no public/gallery mutation, no storage quota mutation, no R2 listing/move/copy/delete/rewrite, no provider call, no Stripe call, no Cloudflare API call, no credit/billing mutation, no deployment, and no tenant-isolation or production-readiness claim.

Recommended next phase: `Phase 6.22 — Admin-approved Legacy Media Reset Executor Design`.
