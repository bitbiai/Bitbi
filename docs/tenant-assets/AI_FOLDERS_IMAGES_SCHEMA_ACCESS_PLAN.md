# AI Folders & Images Schema Access Plan

Date: 2026-05-17

Current release truth: latest auth D1 migration is `0057_add_ai_asset_manual_review_state.sql`.

Phase 6.3 was schema/access planning only for `ai_folders` and `ai_images`. Phase 6.4 adds the planned nullable metadata columns and simple lookup/review indexes through migration `0056_add_ai_folder_image_ownership_metadata.sql`. Phase 6.5 starts assigning that metadata only on new personal folder/image writes. Phase 6.6 adds read-only ownership metadata diagnostics and simulated dual-read safety checks. Phase 6.7 exposes those diagnostics through a bounded admin-only evidence report and JSON/Markdown export. Phase 6.8 adds the operator evidence runbook/template/checklist for collecting that report. Phase 6.9 adds the main-only evidence package, Phase 6.10 records the main evidence decision, Phase 6.11 adds manual-review workflow design, Phase 6.12 designs manual-review state schema, Phase 6.13 adds empty review-state tables in `0057_add_ai_asset_manual_review_state.sql`, Phase 6.14 adds local-only review-item import dry-run planning, Phase 6.15 adds an admin-approved review-item import executor, Phase 6.16 adds read-only manual-review queue/evidence APIs, Phase 6.17 adds an admin-approved review status workflow for review items/events only, Phase 6.18 adds operator evidence rollups plus Admin Control Plane queue visibility/status controls for review-state rows only, Phase 6.19 adds operator evidence collection docs, Phase 6.20 reviews real live/main operator evidence with `operator_evidence_collected_needs_more_idempotency`, and Phase 6.21 adds read-only legacy media reset dry-run/export planning. These phases do not rewrite existing D1 source rows, delete media rows, backfill ownership metadata, update ownership metadata, mutate review rows in Phase 6.21, move/list/delete R2 objects, change access checks, change image generation behavior, change folder access behavior, change public gallery behavior, change lifecycle/export/delete behavior, change quota accounting, mutate billing/credits, call providers, call Stripe, call Cloudflare APIs, or claim tenant isolation.

## Current Data Model

### `ai_folders`

- Defined by `0007_add_image_studio.sql` and `0009_add_folder_status.sql`.
- Columns today: `id`, `user_id`, `name`, `slug`, `created_at`, `status`.
- Current owner signal: `user_id`.
- Phase 6.4 schema fields now exist as nullable metadata. Phase 6.5 assigns them for new personal folder writes only; old rows remain nullable/unclassified and access checks still use `user_id`.
- No parent folder, public visibility, organization, or tenant quota fields exist.

### `ai_images`

- Defined by `0007_add_image_studio.sql`, `0017_add_ai_image_derivatives.sql`, `0019_add_ai_image_publication.sql`, and `0046_add_asset_storage_quota.sql`.
- Core columns today: `id`, `user_id`, `folder_id`, `r2_key`, `prompt`, `model`, `steps`, `seed`, `created_at`.
- Derivative/object fields: `thumb_key`, `medium_key`, MIME/dimension fields, derivative status/version/timestamps, and `size_bytes`.
- Publication fields: `visibility`, `published_at`.
- Current owner signal: `user_id`.
- Phase 6.4 schema fields now exist as nullable metadata. Phase 6.5 assigns them for new personal saved-image writes only; old rows remain nullable/unclassified and access checks still use `user_id`.

## Current Access Model

- Folder create/list/rename/delete uses the signed-in user's `session.user.id` and `ai_folders.user_id`.
- Image list/read/save/rename/delete/move/publish uses `ai_images.user_id`; folder-bound writes additionally require a matching active `ai_folders.user_id`.
- Image media and derivative serving uses `ai_images.id` plus `ai_images.user_id`.
- Public Mempics reads use `visibility = 'public'` and user-profile attribution through `ai_images.user_id`.
- Avatar-from-saved-image uses an owned image thumbnail selected by `ai_images.user_id`.
- Admin storage inspection and mutation are target-user centered.
- Data lifecycle planning is `subject_user_id` centered.
- Storage quota is `user_asset_storage_usage` centered on user id.

## Proposed Additive Schema

Phase 6.4 adds these metadata columns to both `ai_folders` and `ai_images`. Phase 6.5 writes them for new personal rows only; existing rows can still be null and no read/access check depends on them yet.

| Field | Purpose |
| --- | --- |
| `asset_owner_type` | Ownership class for the row. |
| `owning_user_id` | Personal owner when the row is a personal user asset. |
| `owning_organization_id` | Tenant owner when the row is an organization asset. |
| `created_by_user_id` | Actor who created/imported/saved the row. |
| `ownership_status` | Migration/review state for the ownership metadata. |
| `ownership_source` | How ownership metadata was assigned. |
| `ownership_confidence` | `high`, `medium`, `low`, or `none`. |
| `ownership_metadata_json` | Bounded sanitized supporting evidence, never raw prompt/provider bodies/secrets. |
| `ownership_assigned_at` | Timestamp for assignment/review. |

Allowed `asset_owner_type` values:

- `personal_user_asset`
- `organization_asset`
- `platform_admin_test_asset`
- `platform_background_asset`
- `legacy_unclassified_asset`
- `external_reference_asset`
- `audit_archive_asset`

Allowed `ownership_status` values:

- `current`
- `legacy_unclassified`
- `ambiguous`
- `orphan_reference`
- `unsafe_to_migrate`
- `pending_review`

Allowed `ownership_source` values:

- `new_write_personal`
- `new_write_org_context`
- `admin_selected_org`
- `platform_admin_test`
- `dry_run_inferred`
- `manual_review`
- `legacy_default`

Future index targets:

| Table | Purpose | Columns |
| --- | --- | --- |
| `ai_folders` | personal folder listing | `owning_user_id`, `asset_owner_type`, `status`, `name` |
| `ai_folders` | organization folder listing | `owning_organization_id`, `asset_owner_type`, `status`, `name` |
| `ai_folders` | migration review queues | `ownership_status`, `asset_owner_type`, `created_at` |
| `ai_images` | personal image listing | `owning_user_id`, `asset_owner_type`, `folder_id`, `created_at`, `id` |
| `ai_images` | organization image listing | `owning_organization_id`, `asset_owner_type`, `folder_id`, `created_at`, `id` |
| `ai_images` | public gallery owner-aware listing | `visibility`, `asset_owner_type`, `published_at`, `created_at`, `id` |
| `ai_images` | migration review queues | `ownership_status`, `asset_owner_type`, `created_at` |

Phase 6.4 added simple single-column indexes for `owning_user_id`, `owning_organization_id`, `asset_owner_type`, and `ownership_status` on both tables. Composite access-path indexes remain future work until access checks are implemented.

## Target Ownership Model

- Personal rows use `asset_owner_type = personal_user_asset`, `owning_user_id = user_id`, and `created_by_user_id = user_id`.
- Organization rows use `asset_owner_type = organization_asset`, a durable `owning_organization_id`, and the creating user in `created_by_user_id`.
- Admin image tests are `platform_admin_test_asset` by default. Charged tests may carry selected organization reference in metadata, but retained output should not silently become a customer organization asset without product approval.
- Legacy rows without strong evidence remain `legacy_unclassified_asset`, `ambiguous`, `orphan_reference`, `unsafe_to_migrate`, or `pending_review`.
- Derivatives inherit parent image ownership and do not create independent ownership proof.

## Write-Path Rules

| Write path | Future ownership assignment |
| --- | --- |
| Personal generation/save | `personal_user_asset`, `owning_user_id = session.user.id`, `created_by_user_id = session.user.id`. |
| Org-scoped generation/save | `organization_asset` only from validated explicit organization context and active membership. |
| Folder create, personal context | `personal_user_asset`. |
| Folder create, org context | `organization_asset` with validated org membership. |
| Folder rename/delete | Must require matching owner scope and appropriate role. |
| Image move to folder | Image and folder owner metadata must match; no personal-to-org or org-to-personal move by accident. |
| Publish/unpublish | Never changes ownership metadata. |
| Admin charged image test | Prefer `platform_admin_test_asset` plus selected-org reference; do not count as org-owned unless a future product decision says retained output belongs to the org. |
| Explicit unmetered admin image test | `platform_admin_test_asset`. |
| Derivative generation | Inherits parent `ai_images` owner metadata. |

Phase 6.5 implements only the personal folder create and personal saved-image write assignments. Server-verified organization folder/image writes, admin retained image outputs, and access-check changes remain future work.

## Phase 6.5 New-Write Assignment

- `POST /api/ai/folders` writes `personal_user_asset`, `owning_user_id = session.user.id`, `created_by_user_id = session.user.id`, `ownership_status = current`, `ownership_source = new_write_personal`, `ownership_confidence = high`, and bounded sanitized metadata.
- `POST /api/ai/images/save` writes the same personal ownership metadata for new saved `ai_images` rows. Folder-bound saves still require the existing user-owned folder check.
- Client-provided organization hints are ignored for ownership. There is no server-verified org-scoped saved-image ownership assignment in this phase.
- Derivative keys remain part of the parent image row and inherit parent ownership by metadata note only; no R2 keys are moved or renamed.
- Publishing/unpublishing does not change ownership metadata.
- Old/null rows remain compatible and readable through existing `user_id` checks.

## Phase 6.6 Read Diagnostics

- `workers/auth/src/lib/tenant-asset-read-diagnostics.js` compares legacy `user_id` signals with the new ownership metadata in a simulated read-only report.
- The dry-run report now includes `readDiagnostics`, `dual_read_safety_simulated`, and the classes `same_allow`, `metadata_missing`, `metadata_conflict`, `relationship_conflict`, `orphan_reference`, `unsafe_to_switch`, and `needs_manual_review`.
- Diagnostics do not authorize requests, repair rows, backfill metadata, list R2, or alter public/gallery/media behavior.
- Organization-owned and platform-admin-test rows remain `needs_manual_review` until explicit access policies exist.
- Public images with missing or conflicting metadata remain `unsafe_to_switch`.

## Phase 6.7 Admin Evidence Report

- `GET /api/admin/tenant-assets/folders-images/evidence` returns a bounded admin-only local-D1 evidence report over the Phase 6.6 diagnostics.
- `GET /api/admin/tenant-assets/folders-images/evidence/export` exports the same sanitized evidence as JSON or Markdown.
- Report sections include summary counts, classification rollups, dual-read safety rollups, folder/image evidence, relationship evidence, public-gallery evidence, derivative evidence, and a manual-review queue.
- The report is read-only evidence only. It does not authorize requests, switch access checks, backfill rows, update ownership metadata, list R2, expose prompts/private R2 keys, call providers, call Stripe, mutate credits, or claim production or tenant-isolation readiness.

## Phase 6.8 Evidence Collection Runbook

- `TENANT_ASSET_OWNERSHIP_EVIDENCE_RUNBOOK.md` defines safe operator steps for the Phase 6.7 evidence/export endpoints.
- `TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md` records endpoint filters, summary counts, sanitization checks, risk decision, and no-mutation statements.
- `TENANT_ASSET_OWNERSHIP_MAIN_ONLY_CHECKLIST.md` covers direct-main evidence discipline.
- Phase 6.8 adds no migration, endpoint, Admin UI, runtime route change, ownership backfill, access-check switch, D1/R2 mutation, R2 listing, provider call, Stripe call, or tenant-isolation claim.

## Phase 6.9 Main Evidence Package

- `docs/tenant-assets/evidence/README.md` defines the main-only evidence package location.
- `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` records that no real operator-exported main evidence was present in-repo when Phase 6.9 was prepared.
- `npm run tenant-assets:summarize-evidence` can summarize a reviewed JSON export without calling live endpoints.
- Phase 6.9 adds no migration, endpoint, Admin UI, runtime route change, ownership backfill, access-check switch, D1/R2 mutation, R2 listing, provider call, Stripe call, or tenant-isolation claim.

## Phase 6.10 Evidence Decision

- `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` records the current operator decision.
- The decision reviews `docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md`.
- Status is `needs_manual_review`.
- Access-check switching and ownership backfill remain blocked because the summary records 75 metadata-missing rows, 21 public unsafe rows, 63 derivative ownership risks, 42 simulated dual-read unsafe rows, and 90 manual-review rows.
- Synthetic fixtures and pending markers are not main evidence.
- Phase 6.10 adds no migration, endpoint, Admin UI, runtime route change, ownership backfill, access-check switch, D1/R2 mutation, R2 listing, provider call, Stripe call, or tenant-isolation claim.

## Phase 6.11 Manual Review Workflow

- `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md` defines design-only issue categories, review statuses, safe fields, blocked conditions, and outcomes.
- `docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md` records the Phase 6.10 count-based plan.
- `npm run tenant-assets:plan-manual-review` renders a local non-mutating plan from a committed evidence summary.
- Phase 6.11 adds no D1 migration, endpoint, Admin UI, review executor, runtime route change, ownership backfill, access-check switch, D1/R2 mutation, R2 listing, provider call, Stripe call, or tenant-isolation claim.

## Phase 6.12 Manual Review State Schema Design

- `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md` proposes future review-state tables, indexes, transitions, audit events, idempotency, safe evidence snapshots, and future API/UI requirements.
- Proposed future tables are `ai_asset_manual_review_items` and `ai_asset_manual_review_events`.
- Phase 6.12 creates no review rows, imports no evidence into D1, changes no access checks, performs no ownership backfill, mutates no D1/R2 data, and makes no tenant-isolation claim.

## Phase 6.13 Manual Review State Schema

- `0057_add_ai_asset_manual_review_state.sql` creates empty `ai_asset_manual_review_items` and `ai_asset_manual_review_events` tables plus lookup/audit indexes.
- The tables are schema foundation only. Phase 6.13 imports no evidence, creates no review rows, adds no endpoint/UI, changes no access checks, performs no ownership backfill, updates no folder/image ownership metadata, mutates no R2 objects, and makes no tenant-isolation claim.
- Phase 6.14 adds that dry-run import planner. It creates aggregate buckets from the committed Markdown evidence summary and proposed candidates only from bounded JSON evidence; no real review rows are created.
- Phase 6.15 adds `POST /api/admin/tenant-assets/folders-images/manual-review/import`. It defaults to dry-run; confirmed execution requires admin auth, production MFA, same-origin, rate limiting, `Idempotency-Key`, `confirm: true`, and `reason`, and can write only `ai_asset_manual_review_items` plus matching `ai_asset_manual_review_events`.
- Phase 6.16 adds read-only endpoints for manual-review queue inspection and evidence export: `/manual-review/items`, `/manual-review/items/:id`, `/manual-review/items/:id/events`, `/manual-review/evidence`, and `/manual-review/evidence/export`. They are bounded and sanitized; they do not update statuses, create notes, import rows, backfill ownership, switch access checks, mutate source asset rows, or touch R2.
- Phase 6.17 adds `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`. It requires admin auth, production MFA through route policy, same-origin protection, rate limiting, `Idempotency-Key`, `confirm: true`, and a bounded `reason`. It can update only review item status/review metadata and append a matching event. It does not update ownership metadata, source asset rows, access checks, public visibility, lifecycle/quota/billing behavior, or R2.
- Phase 6.18 adds status operator evidence rollups and Admin Control Plane visibility for the manual-review queue. The panel supports safe refresh, JSON export, filters, item/event inspection, and review-status controls that call only the Phase 6.17 endpoint. It adds no migration, review import change, ownership backfill, access switch, source asset mutation, ownership metadata update, R2 action, provider call, Stripe call, Cloudflare API call, credit/billing mutation, or tenant-isolation claim.
- Phase 6.19 adds `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_RUNBOOK.md`, `MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_TEMPLATE.md`, and `evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`. Phase 6.20 updates the decision to `operator_evidence_collected_needs_more_idempotency` from committed live/main operator evidence. It adds no runtime behavior, migration, review import execution, review status update by Codex/tests, source asset mutation, ownership metadata update, R2 action, ownership backfill, access switch, or tenant-isolation claim.

## Access-Check Impact Matrix

| Area | Current access basis | Proposed access basis | Phase 6.3 behavior change | Future phase | Tests required |
| --- | --- | --- | --- | --- | --- |
| Image list/read | `ai_images.user_id = session.user.id` | Personal owner or active org membership read role | no | 6.6 | Personal unchanged, org member allowed, non-member denied |
| Image create/save | session user and optional user-owned folder | Explicit personal/org context assigns owner metadata | no access change; Phase 6.5 writes personal metadata only | 6.5/6.6 | Personal save metadata, org save later, weak org rejected |
| Image rename/move | image and folder matched by `user_id` | Asset and folder owner metadata match; org mutation role | no | 6.6 | No cross-scope moves, org admin move |
| Image delete | `user_id` match and cleanup queued from row keys | Personal owner or org mutation role; cleanup remains row-key based | no | 6.7 | Role-safe delete, cleanup prefix safety |
| Image publish/unpublish | `user_id` match | Personal owner or org publisher role; ownership unchanged | no | 6.6 | Publication does not change owner |
| Image media/derivatives | `id` plus `user_id` | Personal owner or org read membership; derivative inherits parent | no | 6.6 | Member access, non-member denied, derivative owner inherited |
| Folder list/read | `ai_folders.user_id` | Personal owner or org membership; counts owner-scope filtered | no | 6.6 | Personal counts, org counts, no mixed owner leakage |
| Folder create/update/delete | `ai_folders.user_id` | Owner-scope and role-aware checks | no access change; Phase 6.5 writes personal metadata only on create | 6.5/6.6 | Personal create metadata, org context later, role-safe delete |
| Public gallery | `visibility = public`, profile join by `user_id` | Visibility plus owner-aware publisher attribution | no | 6.6 | Personal unchanged, org publisher, ambiguous public rows blocked/reviewed |
| Avatar from saved image | source image selected by `ai_images.user_id` | Personal image owner or explicit org avatar policy | no | 6.6 | Personal unchanged, org image not silently personal avatar |
| Admin storage | target-user centered admin queries/mutations | Owner class surfaced; future mutations choose user/org scope explicitly | no | 6.8 | Admin sees owner status, no accidental org mutation through user path |
| Data lifecycle/export/delete | `subject_user_id` plans | Organization subject plans for org-owned rows | no | 6.7 | Personal unchanged, org lifecycle plan, ambiguous review |
| Storage quota | `user_asset_storage_usage` | Personal quota plus future organization storage counters | no | 6.7 | No double count, org counter separate |

## Public Gallery Impact

Public gallery behavior must not change until an explicit future phase. The target model needs:

- personal publisher attribution from the existing user profile path
- organization publisher attribution for `organization_asset`
- a product decision about showing created-by users for org assets
- safe exclusion or review of `unsafe_to_migrate` public rows
- versioned media URLs that keep current cache semantics

## Folder/Image Relationship Model

Preferred target: one owner scope per folder. An `ai_images.folder_id` row must point to a folder with the same owner class and owner id. Mixed-owner folders should be rejected unless a future product design explicitly creates shared folders.

## Derivative Ownership Model

`thumb_key` and `medium_key` inherit the parent `ai_images` owner metadata. Derivative R2 keys are not independent owner evidence. A later derivative alignment phase should verify parent ownership before generating or serving derivatives for organization assets.

## Storage Quota Impact

Phase 6.5 does not change `user_asset_storage_usage`. Future organization assets need separate organization storage counters before any bytes are reassigned. The migration must avoid double-counting rows during a transition where legacy `user_id` remains present for compatibility.

## Lifecycle Export Delete Impact

Current lifecycle plans are user-subject plans. Future organization assets require:

- organization subject requests
- role/admin approval policy
- created-by user treatment for users who leave an organization
- explicit handling for public org assets
- review-only treatment for ambiguous, orphan, and unsafe rows

## Admin Inspection Impact

Admin storage tooling should eventually show owner type, owning user, owning organization, creator, status, source, confidence, and ambiguity reason. Phase 6.5 does not change admin storage endpoints.

## Migration And Backfill Constraints

- Every backfill must be dry-run-first.
- Do not infer organization ownership from UI active organization, current folder name, R2 key shape, or membership alone.
- Newly written rows after schema launch can be marked current.
- Old user-only rows remain personal candidates or legacy unclassified until reviewed.
- Public ambiguous rows are `unsafe_to_migrate`.
- Folder/image owner conflicts are `ambiguous`.
- Missing folders are `orphan_reference`.
- Derivative mismatch requires review.
- Deleted/anonymized user assets require lifecycle/legal review.
- No ownership backfill should run in the same phase as the schema migration.

## Test Plan

Future implementation tests should cover:

- schema compatibility with existing inserts and reads
- personal folder/image writes with owner metadata
- org-context folder/image writes with owner metadata
- weak org signal rejection
- role-aware org reads/writes
- folder/image owner mismatch rejection
- public gallery attribution branch
- derivative owner inheritance
- lifecycle and quota separation
- admin inspection redaction
- dry-run-first backfill evidence

## Future Phases

| Phase | Scope |
| --- | --- |
| 6.4 | Additive ownership metadata schema for `ai_folders` and `ai_images`; implemented with no backfill and no access behavior change. |
| 6.5 | Write-path metadata assignment for new personal `ai_folders` and `ai_images` rows only; no backfill and no access behavior change. |
| 6.6 | Ownership metadata read diagnostics / dual-read safety checks; implemented as simulated evidence only. |
| 6.7 | Tenant asset ownership admin evidence report for folders/images; implemented as read-only bounded JSON/Markdown evidence. |
| 6.8 | Evidence collection runbook/template/checklist for the Phase 6.7 folders/images report. |
| 6.9 | Main-only owner-map evidence package and pending marker; implemented with no live endpoint calls by Codex, backfill, or access switch. |
| 6.10 | Operator-run main evidence review and decision; implemented as `needs_manual_review` from real main evidence summary, with access/backfill blocked. |
| 6.11 | Manual review workflow design for AI folders/images owner-map issues; implemented as design/check tooling only, no backfill or access switch. |
| 6.12 | Manual review state schema design for operator review records; implemented as design/check tooling only, no migration or review rows. |
| 6.13 | Additive manual review state schema for AI folders/images; implemented as empty review-state tables/indexes only, no review-row import or backfill. |
| 6.14 | Manual review item import dry run from approved evidence; implemented as local planning only with no review-row import. |
| 6.15 | Admin-approved manual review item import executor; defaults to dry-run and writes review items/events only when confirmed. |
| 6.16 | Manual review queue read/evidence operationalization; implemented as read-only admin APIs and JSON/Markdown export, no status updates or source mutation. |
| 6.17 | Manual review status workflow and operator evidence; implemented as admin-approved review item status/event updates only, no ownership backfill or access switch. |
| 6.18 | Manual review status operator evidence and Admin visibility; implemented as evidence rollups plus Admin Control Plane queue/status controls, no ownership backfill or access switch. |
| 6.19 | Manual review status operator evidence collection; implemented as runbook/template docs only, no runtime behavior, import execution, status update, source mutation, ownership backfill, or access switch. |
| 6.20 | Manual review operator evidence decision update; implemented from committed live/main evidence as `operator_evidence_collected_needs_more_idempotency`, with no runtime behavior, import execution, status update, source mutation, ownership backfill, or access switch. |
| 6.21 | Legacy personal media reset dry-run; implemented as admin-only read/export planning from D1 counts only, no deletion, source mutation, review-row mutation, R2 listing/mutation, ownership backfill, or access switch. |
| 6.22 | Admin-approved legacy media reset executor design; implemented as design-only requirements for future action tracking/execution, with no endpoint, UI, migration, deletion, source mutation, review-row mutation, R2 action, ownership backfill, or access switch. |

Recommended next phase: **Phase 6.23 - Legacy Media Reset Action Tracking Schema**.
