# Legacy Personal Media Reset Executor Design

Date: 2026-05-17

Phase 6.22 designs a future admin-approved legacy media reset executor for old personal/admin-created media. It is a design-only phase. No executor, endpoint, UI, migration, deletion, source-row mutation, review-row mutation, ownership backfill, access-check switch, R2 listing, or R2 mutation is implemented here.

## Purpose

The operator is evaluating whether retiring old personal/admin-created media and recreating media under the current ownership-metadata write paths is safer than backfilling legacy ownership metadata. Phase 6.21 added a read-only D1 dry-run inventory. Phase 6.22 defines how a future executor would need to behave if a later phase is explicitly approved.

The design goal is to make future deletion/retirement bounded, auditable, idempotent, reversible where possible before final deletion, and separated from ownership backfill or access-check migration.

## Scope

This design covers:

- future endpoint/API behavior;
- allowed and deferred domains;
- deletion/retirement ordering;
- public/gallery handling;
- derivative/thumb/medium/poster handling;
- text/music/video coverage limits;
- R2 and lifecycle safety;
- action tracking, audit events, and idempotency;
- partial failure, retry, reconciliation, verification, and evidence;
- future Admin UI requirements.

## Non-Goals

Phase 6.22 does not:

- implement `POST /api/admin/tenant-assets/legacy-media-reset/execute`;
- add action-tracking tables or a D1 migration;
- delete, depublish, rewrite, or retire any source rows;
- update ownership metadata;
- update manual-review rows or statuses;
- backfill ownership;
- switch access checks;
- list, move, copy, rewrite, or delete live R2 objects;
- change lifecycle/export/delete, quota, public gallery, media serving, generation, billing, credit, provider, Stripe, Cloudflare, or GitHub behavior;
- claim tenant isolation, production readiness, live billing readiness, or backfill/access-switch readiness.

## Prerequisite Evidence

A future executor must start from a fresh server-side Phase 6.21 dry-run report:

- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run`
- `GET /api/admin/tenant-assets/legacy-media-reset/dry-run/export`

The executor must recompute the dry-run server-side immediately before execution. Client-provided candidate lists can be treated only as operator selection hints, never as authoritative deletion input.

Required evidence before execution:

- dry-run report version and generated timestamp;
- selected domains and candidate counts;
- public/gallery candidate counts;
- derivative reference counts;
- manual-review impact counts;
- optional text/music/video coverage status;
- operator acknowledgements;
- evidence snapshot hash.

## Domain Coverage Matrix

| Domain | First executor status | Reason | Required future checks |
| --- | --- | --- | --- |
| `ai_images` | allowed with constraints | Existing lifecycle helpers know image rows and R2 key references. | Row still selected, owned by legacy personal/admin reset scope, not org-owned, public handling complete, cleanup keys known from D1. |
| `ai_folders` | allowed after child handling | Folders are logical containers; child image/text rows must be handled first. | Folder is empty or all children are selected/retired; status remains eligible. |
| `ai_image_derivatives` | allowed with parent image | Thumb/medium keys are derived from `ai_images` rows. | Parent image selected; no live R2 listing; cleanup uses D1 keys only. |
| `public_gallery_references` | allowed only with explicit acknowledgement | Public content removal affects gallery visibility, attribution, and history. | `acknowledgePublicContentRemoval=true`; public refs retired before source row deletion. |
| `manual_review_items_supersession` | optional/deferred step | Reset may obsolete review items, but review history must remain intact. | Separate explicit selection; append review event or mark superseded only after successful source retirement. |
| `ai_text_assets` | deferred | Text/audio/video saved assets were not covered by Phase 6 ownership metadata. | Separate coverage expansion or executor scope review. |
| `music_assets` | deferred | Music uses `ai_text_assets.source_module='music'` and needs media-specific review. | Confirm delete path, gallery/public handling, quota impact, and generated audio references. |
| `video_assets` and `ai_video_jobs` | deferred | Video jobs have async/provider lifecycle and output/poster keys. | Confirm terminal job states, output references, poster cleanup, queue state, and saved asset duplication. |
| `profile_avatars` | deferred | Private avatar storage uses a different domain and bucket prefix. | Separate profile/avatar reset design. |
| `data_lifecycle_exports` | blocked/deferred | Export archives are retention artifacts, not generated media reset candidates. | Govern through data lifecycle policy only. |
| `audit_archive` | blocked | Audit archives must not be reset as media. | Retention/audit policy only. |
| unknown media tables | blocked | Unknown schema cannot be safely retired. | Add schema coverage before selection. |

## Future Endpoint Design

Future endpoints, not implemented in Phase 6.22:

- `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/evidence`
- `GET /api/admin/tenant-assets/legacy-media-reset/actions/:id/export`

Future POST route policy:

- admin-only;
- production MFA required;
- same-origin required;
- high sensitivity;
- bounded JSON body;
- fail-closed rate limit;
- DB required;
- `Idempotency-Key` required;
- no public route exposure.

Future request fields:

- `dryRun`: boolean, default `true`;
- `confirm`: required `true` for execution;
- `reason`: bounded string required for execution;
- `domains`: allowlisted array;
- `includeFolders`, `includeImages`, `includePublic`, `includeDerivatives`, `includeVideos`, `includeMusic`, `includeTextAssets`, `includeQuotaVerification`;
- `limit`;
- `evidenceReportGeneratedAt`, validated against a fresh recomputed dry-run;
- `operatorAttestation`, bounded booleans/text only;
- `acknowledgePublicContentRemoval`, required when public/gallery retirement is selected;
- `acknowledgeNoCreditRefund`, required because media reset is not a billing/credit refund path;
- `acknowledgeIrreversibleDeletion`, required for execution.

Future response fields:

- action id;
- dry-run/execution mode;
- selected domains;
- before/after counts;
- created action/event counts;
- public refs retired count;
- source rows retired count;
- derivative references retired count;
- R2 cleanup queued/attempted/succeeded/failed counts by key type only;
- quota verification status;
- manual review items superseded count if explicitly enabled;
- partial failure summary;
- safety flags: no backfill, no access switch, no credit/billing mutation, tenant isolation not claimed, production readiness blocked.

Responses must not include raw prompts, raw provider bodies, private R2 keys, signed URLs, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, raw idempotency keys, raw request fingerprints, or unsafe metadata blobs.

## Deletion And Retirement Order

A future executor must follow a strict order:

1. Create a reset action record and freeze a sanitized evidence snapshot.
2. Recompute the Phase 6.21 dry-run server-side.
3. Validate selected domains against the recomputed dry-run.
4. Block if dry-run counts or candidate classes changed beyond a safe tolerance unless `confirmLatestEvidence=true`.
5. For public/gallery rows, retire public references first and require explicit acknowledgement.
6. For folder/image scope, retire child images before folder retirement.
7. For derivatives, enqueue/retire parent and derivative references together from D1-known keys only.
8. For R2 cleanup, use only keys collected from selected D1 rows and existing lifecycle/cleanup helpers.
9. Recalculate or verify storage quota after successful source retirement.
10. Optionally supersede matching manual-review items only after successful source retirement and explicit selection.
11. Produce a final verification report with no backfill/access-switch claims.

## Public/Gallery Handling

Public rows must never be silently deleted. A future executor must:

- require `includePublic=true` and `acknowledgePublicContentRemoval=true`;
- report gallery/public counts before execution;
- retire public references before source row deletion;
- preserve audit evidence that public visibility changed because of an approved reset;
- state that public attribution/history and currently visible content can disappear;
- block if public rows are selected without explicit acknowledgement.

## Derivative, Poster, And Thumb Handling

Derivative/thumb/medium/poster keys are D1 references only. A future executor must:

- never list live R2 to discover objects;
- never delete arbitrary prefixes;
- use parent-row key fields only;
- dedupe cleanup keys;
- use existing lifecycle cleanup queue/delete primitives where available;
- record cleanup counts by key category, not raw keys;
- leave failed R2 cleanup in a durable retry state rather than dropping references silently.

## Text, Music, And Video Handling

The first executor should not delete `ai_text_assets`, music, video assets, or `ai_video_jobs` unless a separate coverage expansion is approved.

Reasons:

- Phase 6 ownership metadata work focused on `ai_folders` and `ai_images`.
- Music and video share `ai_text_assets` and may have public gallery behavior.
- Video jobs have async states, provider task ids, output/poster keys, and possible saved asset duplication.
- Text/music/video deletion needs separate public/gallery, quota, lifecycle, and operator evidence.

If a later phase expands coverage, it must define terminal job states, public handling, R2 key provenance, quota effects, and duplicate saved-asset behavior before execution.

## R2 And Lifecycle Safety Model

The executor must reuse existing safe lifecycle patterns:

- collect keys from selected D1 rows only;
- insert durable cleanup queue entries before or with row retirement;
- dedupe cleanup keys;
- attempt inline cleanup only after durable queue protection exists, if that existing pattern is approved for the executor;
- leave retryable cleanup failures visible;
- never list live R2;
- never delete by user prefix alone;
- never emit or expose raw private keys in responses/exports.

Existing `ai_images` and `ai_text_assets` lifecycle helpers show the current safe pattern: D1 row selection by owner, cleanup-key collection, durable cleanup queue insertion, source row mutation, best-effort inline cleanup, and storage release/reconciliation. A reset executor must not bypass those safety boundaries.

## Storage And Quota Verification

Future execution must not mutate quota blindly. It must:

- record D1-referenced bytes before execution;
- record bytes retired by domain;
- recalculate or verify `user_asset_storage_usage`;
- report quota verification success/failure separately from source row retirement;
- allow retry of quota verification without repeating deletion.

## Manual Review Impact

Reset can make imported review items obsolete, but review history must remain auditable. A future executor may only supersede review items if explicitly selected and after source retirement succeeds.

Recommended design:

- match review items by source table/row/category/evidence path where available;
- append a review event or action event explaining reset supersession;
- never delete review items/events;
- keep supersession separate from ownership backfill or access-switch approval.

## Future Action And Audit Schema Proposal

Phase 6.22 does not add a migration. A future schema phase should add action tracking before execution unless an existing audit/action table is intentionally reused.

Proposed future tables:

- `tenant_asset_media_reset_actions`
- `tenant_asset_media_reset_action_events`

Proposed action fields:

- action id;
- dry-run flag;
- status;
- requested domains;
- before/after counts;
- evidence snapshot hash;
- idempotency key hash;
- request hash;
- operator user id/email;
- bounded reason;
- acknowledgements;
- result summary JSON;
- error summary JSON;
- created, updated, completed timestamps.

Proposed event types:

- `created`;
- `dry_run_completed`;
- `execution_started`;
- `public_refs_retired`;
- `source_rows_retired`;
- `derivative_cleanup_completed`;
- `storage_verified`;
- `review_items_superseded`;
- `failed`;
- `completed`.

## Idempotency Model

Future writes must require `Idempotency-Key`.

Rules:

- same key plus same normalized request returns the stored action/result;
- same key plus different normalized request returns conflict;
- request hash excludes volatile timestamps;
- raw idempotency key is never returned;
- prefer storing a key hash rather than raw key;
- partial failure retry resumes from action state rather than duplicating deletion;
- action id can be deterministic from key hash plus normalized request, or random with a unique idempotency lookup.

## Failure And Retry Model

Future failure categories:

- `preflight_blocked`;
- `dry_run_changed`;
- `public_gallery_retirement_failed`;
- `source_row_retirement_failed`;
- `r2_cleanup_failed`;
- `quota_verification_failed`;
- `review_supersession_failed`;
- `partial_completion`.

Retry policy:

- preflight/dry-run failures are retryable only after evidence or request changes;
- public/source-row failures keep action incomplete and require operator review before retry;
- R2 cleanup failures remain retryable through durable cleanup queue evidence;
- quota verification failures are retryable without repeating source deletion;
- review supersession failures must not roll back completed source retirement;
- terminal failed actions remain visible and exportable.

## Reconciliation And Verification

Future evidence must include:

- selected domains;
- before/after source counts;
- public refs retired count;
- source rows retired count;
- derivative refs retired count;
- R2 cleanup queued/attempted/succeeded/failed counts by key type only;
- storage quota before/after or verification status;
- manual-review supersession count if enabled;
- skipped/blocked count;
- no access-switch flag;
- no ownership-backfill flag;
- no credit/billing mutation flag;
- tenant isolation not claimed;
- production readiness blocked.

Verification cannot claim tenant isolation, access-switch readiness, ownership backfill readiness, or production readiness without separate evidence phases.

## Future Admin UI Design

A future UI may show:

- dry-run summary;
- domain checkboxes;
- public/gallery and derivative risk warnings;
- explicit acknowledgements;
- bounded reason field;
- confirmation control;
- action history;
- export evidence controls.

The UI must not include:

- access-switch toggle;
- ownership-backfill toggle;
- credit refund button;
- raw R2 key display;
- unbounded deletion controls;
- provider/Stripe/Cloudflare/billing actions.

## Testing Strategy

Future implementation tests must cover:

- dry-run default writes no rows;
- execution requires admin, production MFA, same-origin, confirmation, reason, acknowledgements, and idempotency;
- same-key replay and same-key conflict behavior;
- no source mutation on dry-run;
- public rows blocked without acknowledgement;
- derivative cleanup uses D1-known keys only;
- no live R2 listing;
- partial failure states and retry behavior;
- quota verification failure without repeated deletion;
- review supersession disabled unless selected;
- sanitized responses/exports;
- route policy coverage;
- no backfill/access-switch/credit/billing/provider/Stripe/Cloudflare behavior.

## Release And Deploy Prerequisites

If a future phase implements this design:

- remote D1 migration `0056_add_ai_folder_image_ownership_metadata.sql` must be applied;
- remote D1 migration `0057_add_ai_asset_manual_review_state.sql` must be applied if review impact is read;
- any future action-tracking migration must be applied before the Auth Worker code that writes action rows;
- Auth Worker deployment must follow migration application;
- Static/Pages deployment is needed only if a future UI is added.

## Phase 6.22 Safety Statement

Phase 6.22 is executor design only. It adds no executor, no endpoint, no UI, no migration, no delete command, no R2 command, no D1 mutation, no review-row mutation, no ownership backfill, no access-check switch, no provider call, no Stripe call, no Cloudflare API call, no GitHub mutation, no billing/credit mutation, no deployment, and no production-readiness or tenant-isolation claim.

Recommended next phase: `Phase 6.23 - Legacy Media Reset Action Tracking Schema`.
