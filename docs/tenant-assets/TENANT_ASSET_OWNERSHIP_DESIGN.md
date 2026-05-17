# Tenant Asset Ownership Design

Date: 2026-05-17

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0056_add_ai_folder_image_ownership_metadata.sql`.

Phase 6.1 is design and dry-run only. Phase 6.2 adds a focused owner-map dry run for `ai_folders` and `ai_images` only. Phase 6.3 adds the schema/access impact plan for that same domain. Phase 6.4 adds nullable ownership metadata columns to `ai_folders` and `ai_images` only. Phase 6.5 assigns those columns only on new personal folder/image writes. Phase 6.6 adds read-only dual-read diagnostics for the same domain. Phase 6.7 adds an admin-only bounded evidence report/export over those diagnostics. Phase 6.8 adds the operator evidence collection runbook, template, and main-only checklist for that report. Phase 6.9 adds the main-only evidence package directory and pending evidence state because no real operator-exported evidence was present in the repository. These phases do not rewrite existing D1 ownership rows, backfill old owner metadata, move/list/delete R2 objects, change generation behavior, change access checks, change public gallery behavior, mutate credits, call providers, call Stripe, call Cloudflare APIs, or claim full tenant isolation.

## Current Problem

Organizations, memberships, organization credits, and org-scoped generation attempts exist, but saved/generated media is still primarily modeled as user-owned:

- `ai_images`, `ai_text_assets`, `ai_folders`, `profiles`, `favorites`, `ai_video_jobs`, and `user_asset_storage_usage` are centered on `user_id`.
- Some provider-cost work can be organization-scoped or organization-billed, but the durable saved asset rows do not carry an organization owner.
- R2 object keys usually encode `users/{userId}/...`, which is useful for legacy ownership but not sufficient for tenant ownership.
- Public galleries join published assets to `profiles` by `user_id`, so public attribution is user-only.
- Data lifecycle/export/delete planning is centered on `subject_user_id`, not organization subjects.

The target state must separate "who created it" from "who owns it" before broad enterprise tenant isolation can be claimed.

## Target Ownership Model

Future asset rows should distinguish these concepts:

| Concept | Purpose |
| --- | --- |
| `asset_owner_type` | Classifies the asset ownership model. |
| `owning_user_id` | Personal asset owner when `asset_owner_type = personal_user_asset`. |
| `owning_organization_id` | Tenant owner when `asset_owner_type = organization_asset`. |
| `created_by_user_id` | Actor who created or imported the asset. |
| `source_domain` | Source such as member generation, admin test, public background job, or audit archive. |
| `parent_asset_id` | Optional parent used by derivatives/posters/covers/thumbs. |
| `legacy_classification` | Evidence for rows that cannot be safely assigned yet. |

The model should avoid overloading `user_id`. Existing `user_id` may remain for compatibility during transition, but future code should not treat it as the only ownership source once tenant migration begins.

## Owner Classes

| Owner class | Meaning | Example current sources | Migration posture |
| --- | --- | --- | --- |
| `personal_user_asset` | Asset belongs to an individual account. | Existing personal image/text/music/video saves, avatars, favorites. | Can often map from `user_id` after validation. |
| `organization_asset` | Asset belongs to an organization/tenant. | Future org-owned folders/assets; org-scoped generation outputs after migration. | Requires explicit organization mapping and role checks. |
| `platform_admin_test_asset` | Asset created by platform admin lab/testing. | Admin async video jobs and admin-saved AI lab outputs where retained. | Must be separated from customer/org assets. |
| `platform_background_asset` | Platform-generated/public operational content. | News Pulse/OpenClaw visuals. | Keep outside member/org tenant migration unless future design says otherwise. |
| `legacy_unclassified_asset` | Existing row cannot be safely assigned yet. | Rows missing reliable owner/billing/context evidence. | Must not be migrated destructively. |
| `external_reference_asset` | Row references public/external content rather than owning media. | Favorites with `item_type`, `item_id`, `thumb_url`. | Store referenced owner evidence if needed. |
| `audit_archive_asset` | Operational/legal/security evidence archive. | `data_export_archives`, platform budget archives. | Retain under audit/lifecycle policy, not member media policy. |

## Domain Rules

### Personal Assets

Personal assets are visible and mutable by the owning user. Current `user_id` equality checks remain valid for personal assets. Future schema should store `asset_owner_type = personal_user_asset`, `owning_user_id = user_id`, and `created_by_user_id = user_id`.

### Organization Assets

Organization assets are owned by the tenant, not by a single user. Access should require active membership and the right role for the action:

- read/list: active member or viewer if product allows
- create/save: member or higher, subject to entitlement and quota
- mutate/delete/publish: admin or owner unless product chooses another role
- export/delete: organization lifecycle policy, not just personal account deletion

### Platform/Admin Assets

Admin test outputs and platform background outputs must not become customer/org assets by accident. They should be classified as `platform_admin_test_asset` or `platform_background_asset` and excluded from customer billing/lifecycle promises unless explicitly included later.

### Public Gallery Attribution

Published assets should retain safe public attribution, but future organization-owned assets need a publisher model:

- user publisher for personal assets
- organization publisher for organization assets
- optional created-by attribution only if product/legal approves

Current Mempics/Memvids/Memtracks public routes derive publisher data from `profiles.user_id`; this is a known Phase 6.x gap.

### Folders

Folders should become owner-bound containers. A folder must not contain both personal and organization assets unless the row explicitly supports mixed owner classes and the UI/API makes that visible. Preferred target: one owner class per folder.

### Derivatives, Posters, Covers, Thumbs

Derivative objects should inherit owner class from their parent asset. Future metadata should make that inheritance auditable:

- parent image -> thumb/medium derivatives
- text/music/video asset -> poster
- video job -> output/poster
- member music cover -> poster/cover asset

Derivative R2 keys should not be moved in Phase 6.1.

### Storage Quota

`user_asset_storage_usage` is per-user. Future organization assets need tenant quota accounting. A migration should not reassign bytes until source assets, derivatives, and posters are mapped.

### Data Export/Delete

Current lifecycle planning is user-centered. Organization asset export/delete requires:

- organization subject type
- organization membership and admin approval model
- clear policy for created-by users who leave the organization
- R2 key owner-map evidence
- explicit exclusions for audit/security archives

## Migration Principles

1. Start with dry-run owner maps, not writes.
2. Migrate one asset domain at a time.
3. Separate owner, creator, publisher, billing source, and storage quota.
4. Never infer organization ownership from a folder or R2 key alone.
5. Never delete, move, or rewrite R2 objects until owner-map proof exists.
6. Preserve existing member generation and public gallery behavior until a phase explicitly changes it.
7. Treat ambiguous rows as `legacy_unclassified_asset`.
8. Keep audit archives and platform background assets out of customer tenant ownership unless explicitly designed.

## Phase 6.1 Non-Goals

- No D1 ownership backfill.
- No schema migration.
- No R2 object move, copy, rewrite, list, or delete.
- No route behavior changes.
- No admin endpoint.
- No member/org generation change.
- No public gallery change.
- No lifecycle/delete executor change.
- No full tenant isolation claim.

Phase 6.4 changes this schema status only for `ai_folders` and `ai_images`: migration `0056_add_ai_folder_image_ownership_metadata.sql` adds nullable owner metadata columns and indexes. Phase 6.5 begins filling those columns only for new personal folder/image writes, with no row backfill, organization ownership assignment, access check, gallery, quota, lifecycle, R2, billing, or generation behavior changes.

## Phase 6.2 Owner-Map Dry Run

Phase 6.2 narrows the first migration-planning target to `ai_folders` and `ai_images`.

- Focused command: `npm run dry-run:tenant-assets -- --domain folders-images`.
- Fixture command: `npm run dry-run:tenant-assets:images`.
- Detailed report: `docs/tenant-assets/AI_FOLDERS_IMAGES_OWNER_MAP_DRY_RUN.md`.
- Strong rule: organization ownership requires explicit row-level owner-map evidence; active organization UI/localStorage context is ignored.
- Safety result: no schema migration, no backfill SQL, no D1/R2 mutation, no route behavior change.

The dry run classifies candidates as `personal_user_asset`, `organization_asset`, `platform_admin_test_asset`, `legacy_unclassified_asset`, `ambiguous_owner`, `orphan_reference`, or `unsafe_to_migrate`.

## Phase 6.3 Schema/Access Plan

Phase 6.3 adds the planning document `docs/tenant-assets/AI_FOLDERS_IMAGES_SCHEMA_ACCESS_PLAN.md` and extends the focused dry run with schema/access readiness output.

- Proposed future metadata for both `ai_folders` and `ai_images`: `asset_owner_type`, `owning_user_id`, `owning_organization_id`, `created_by_user_id`, `ownership_status`, `ownership_source`, `ownership_confidence`, `ownership_metadata_json`, and `ownership_assigned_at`.
- Read/access impact remains planned only; existing `user_id` checks, public gallery reads, lifecycle/export/delete behavior, and storage quota behavior are unchanged.
- Phase 6.4 now marks the focused report `schema_added_not_backfilled`; Phase 6.5 marks personal folder/image write paths as assigned for new rows only; Phase 6.6 adds simulated read diagnostics; Phase 6.7 surfaces the diagnostics to admins through bounded evidence/report export; Phase 6.8 defines the operator-run evidence collection process; Phase 6.9 records that main evidence is pending in-repo. Access checks remain unchanged, org-owned write assignment is still future work, backfill has not started, and the owner map is not complete.
- Recommended next step: Phase 6.10 operator-run main evidence review and decision only, with no broad backfill and no runtime access behavior change.

## Phase 6.5 New-Write Assignment

Phase 6.5 updates only the new write paths for `ai_folders` and `ai_images`.

- New personal folders are written as `personal_user_asset` with high-confidence `new_write_personal` metadata.
- New personal saved images are written as `personal_user_asset` with high-confidence `new_write_personal` metadata.
- Existing rows remain null/unclassified until a future reviewed backfill.
- Client-supplied organization hints do not create organization ownership.
- Access checks, public gallery reads, media serving, lifecycle/export/delete, quota accounting, billing, credits, and R2 keys remain unchanged.

## Phase 6.6 Read Diagnostics

Phase 6.6 adds a read-only diagnostics helper and fixture-backed dry-run output for `ai_folders` and `ai_images`.

- Diagnostics compare existing legacy `user_id` signals with ownership metadata where present.
- Results are simulated evidence only and never authorize requests.
- Null legacy rows, public ambiguous rows, folder/image mismatches, orphan folder references, derivative risks, organization rows, and platform-admin-test rows are flagged for review.
- Access checks, backfill, public gallery behavior, media serving, lifecycle/export/delete, quota accounting, billing, credits, and R2 behavior remain unchanged.

## Phase 6.7 Admin Evidence Report

Phase 6.7 exposes the read diagnostics through admin-only evidence endpoints:

- `GET /api/admin/tenant-assets/folders-images/evidence`
- `GET /api/admin/tenant-assets/folders-images/evidence/export`

The report is bounded, local-D1-only, sanitized, and supports JSON/Markdown export. It surfaces folder/image metadata coverage, simulated dual-read safety, relationship conflicts, public-gallery unsafe rows, derivative risks, and manual-review counts. It does not authorize requests, apply backfills, update rows, list R2, expose prompts/private keys, or change runtime access behavior.

## Phase 6.8 Evidence Collection Runbook

Phase 6.8 adds operator evidence collection guidance only:

- `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md`
- `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md`
- `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_MAIN_ONLY_CHECKLIST.md`

The runbook tells operators how to collect bounded live/main evidence from the Phase 6.7 endpoints after deployment. It does not add routes, migrations, Admin UI, backfill execution, access-check switching, D1/R2 mutation, R2 listing, provider calls, Stripe calls, or tenant-isolation approval.

## Phase 6.9 Main Evidence Package

Phase 6.9 adds a main-only evidence package location:

- `docs/tenant-assets/evidence/README.md`
- `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md`

No real operator-exported evidence was present in the repository when Phase 6.9 was prepared, so the package is explicitly pending and must not be treated as collected live/main evidence. The local `npm run tenant-assets:summarize-evidence` helper can summarize a future reviewed JSON export without calling live endpoints. It does not mutate D1/R2, call Cloudflare, call Stripe, call providers, switch access checks, or run a backfill.

## Admin Inspection Requirements

Future admin tools should show:

- owner class
- owning user or organization
- created-by user
- public/private state
- R2 object references by class, not raw keys by default
- lifecycle/export coverage
- quota accounting owner
- migration classification status
- legacy ambiguity reason

Admin inspection should remain sanitized and should not expose raw prompts, provider payloads, secrets, cookies, private keys, Stripe data, or private R2 keys unless an authorized operator workflow explicitly requires it.

## Future Roadmap

| Phase | Target | Notes |
| --- | --- | --- |
| 6.2 | AI folders/images owner-map dry run | Implemented as source/fixture dry run only; no schema, backfill, R2 mutation, or access-check change. |
| 6.3 | AI folders/images ownership schema proposal and access-check impact plan | Implemented as design/check output only; no migration, backfill, or access behavior change. |
| 6.4 | Additive ownership metadata schema for folders/images | Implemented as nullable columns and compatibility tests only; no backfill or access behavior change. |
| 6.5 | Write-path metadata assignment for new folders/images | Implemented for new personal folder/image rows only; no backfill or access behavior change. |
| 6.6 | Ownership metadata read diagnostics and dual-read safety checks | Implemented as simulated read-only evidence; no access switch. |
| 6.7 | Tenant asset ownership admin evidence report | Implemented as read-only bounded JSON/Markdown admin evidence for folders/images; no access switch or backfill. |
| 6.8 | Evidence collection runbook and main-only template | Implemented as operator guidance only; no access switch, backfill, R2 listing, or runtime change. |
| 6.9 | Main owner-map evidence package | Implemented as main-only evidence directory plus pending package state; no live endpoint calls, access switch, or backfill. |
| 6.10 | Operator-run main evidence review and decision | Use the runbook to collect/review real bounded main evidence; no access switch or backfill. |
| 6.11 | Bounded non-destructive backfill | Operator-approved metadata only after dry-run proof and reviewed evidence. |
| 6.12 | Destructive cleanup gate | Only after backups, owner-map proof, legal/product approval, and explicit operator approval. |

## Dry-Run Command

```bash
npm run dry-run:tenant-assets
npm run dry-run:tenant-assets -- --markdown
npm run dry-run:tenant-assets -- --domain folders-images
npm run dry-run:tenant-assets:images
npm run test:tenant-assets
```

The dry-run is source/schema inventory only. It does not call Cloudflare, Stripe, providers, D1, R2, Queues, or production resources.
