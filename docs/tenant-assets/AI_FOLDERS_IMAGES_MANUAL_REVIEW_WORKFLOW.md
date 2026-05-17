# AI Folders & Images Manual Review Workflow

Last updated: 2026-05-17

Phase 6.11 defines a manual-review workflow for AI folders/images owner-map issues found by the main-only evidence process. Phase 6.12 adds `AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md` to design review-state persistence. Phase 6.13 adds the empty review-state tables in `0057_add_ai_asset_manual_review_state.sql`. Phase 6.14 adds a local-only import dry-run planner in `scripts/dry-run-tenant-asset-manual-review-import.mjs`. Phase 6.15 adds an admin-approved import executor that can create only manual-review items/events and defaults to dry-run. Phase 6.16 adds read-only manual-review queue/evidence APIs for imported rows. Phase 6.17 adds an admin-approved status workflow that updates only review item status fields and appends review events. These phases do not perform ownership backfill, switch access checks, update folder/image ownership rows, add Admin UI, add a repair/backfill/access-switch executor, list/mutate R2, call providers, call Stripe, call Cloudflare APIs, mutate credits/billing, claim tenant isolation, or claim production readiness.

## Source Evidence

Current source evidence:

- `docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md`
- `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md`

The Phase 6.10 decision is `needs_manual_review`. It reviewed real main evidence, not synthetic fixtures. Access-check switching is `blocked_for_access_switch`, ownership backfill is `blocked_for_backfill`, tenant isolation is not claimed, and production readiness remains blocked.

Current main evidence counts:

| Signal | Count |
| --- | ---: |
| Folders scanned | 16 |
| Images scanned | 63 |
| Metadata missing total | 75 |
| Public unsafe | 21 |
| Derivative ownership risks | 63 |
| Simulated dual-read unsafe | 42 |
| Manual review needed | 90 |
| Metadata conflicts | 0 |
| Relationship conflicts | 0 |
| Orphan folder references | 0 |
| Organization-owned rows | 0 |

## Review Purpose

Manual review is intended to decide how each high-risk owner-map issue should be classified before any future remediation design:

- whether an old row should remain legacy user-owned;
- whether a row can later be approved as a personal user asset;
- whether a row has strong evidence for organization ownership;
- whether a row is unsafe to migrate;
- whether public/gallery attribution needs separate review;
- whether derivative/poster/thumb ownership can inherit from a reviewed parent image;
- whether privacy/lifecycle review is required.

Manual review is not allowed to update rows, run backfills, emit executable SQL, change access checks, repair data, move/delete/list R2 objects, or approve tenant-isolation claims by itself.

## Issue Categories

| Category | Meaning | Phase 6.10 signal | Default action |
| --- | --- | ---: | --- |
| `metadata_missing` | Existing folder/image lacks ownership metadata. Expected for old rows. | 75 | Block ownership-based access switching until reviewed/backfilled or explicitly left legacy. |
| `public_unsafe` | Public/gallery image lacks safe ownership metadata or has ambiguous ownership. | 21 | Review separately because public visibility and attribution are involved. |
| `derivative_risk` | Image has derivative/poster/thumb assets but parent ownership is missing or unsafe. | 63 | Resolve parent ownership before derivative inheritance is trusted. |
| `dual_read_unsafe` | Simulated ownership access would diverge or cannot be safely evaluated. | 42 | Keep access-check switching blocked. |
| `manual_review_needed` | Evidence requires human classification before any backfill/access switch. | 90 | Create review records before any executor is designed. |
| `relationship_review` | Folder/image relationship must be checked for owner alignment. | 0 conflicts | Keep as observation; zero conflicts do not unblock migration alone. |
| `legacy_unclassified` | Row may remain legacy user-owned until a future policy approves metadata assignment. | 75 candidate rows | Decide whether to preserve as legacy or include in future review-state records. |
| `future_org_ownership_review` | Reserved for rows with possible organization evidence. | 0 rows | Do not infer org ownership from weak signals. |
| `platform_admin_test_review` | Reserved for admin/test artifacts if they appear later. | 0 known rows | Require strong admin/test evidence before classification. |
| `safe_observe_only` | New metadata matches legacy user owner. | 4 dual-read safe | Observe only; this does not prove tenant isolation. |

## Review Statuses

These statuses are available for future review rows after Phase 6.13, but no review row is created, imported, or updated in this phase and no runtime behavior changes.

- `pending_review`
- `review_in_progress`
- `approved_personal_user_asset`
- `approved_organization_asset`
- `approved_legacy_unclassified`
- `approved_platform_admin_test_asset`
- `blocked_public_unsafe`
- `blocked_derivative_risk`
- `blocked_relationship_conflict`
- `blocked_missing_evidence`
- `needs_legal_privacy_review`
- `deferred`
- `rejected`
- `superseded`

## Priority And Severity

| Priority | Applies to | Required before future migration |
| --- | --- | --- |
| P0 | `public_unsafe`, `derivative_risk`, `metadata_missing`, `dual_read_unsafe`, `manual_review_needed` | Must be reviewed before access-switch or broad backfill design. |
| P1 | `legacy_unclassified`, future strong org evidence | Needed before deciding whether to preserve legacy rows or assign metadata. |
| P2 | `relationship_review` with zero conflicts | Confirm relationships remain safe in future evidence runs. |
| P3 | `safe_observe_only`, reserved platform/admin-test review | Observation only unless future evidence changes. |

## Safe Evidence Fields

Manual review records may include:

- item type;
- item id;
- issue category;
- classification;
- severity and priority;
- presence/absence booleans;
- aggregate counts;
- safe timestamps;
- ownership metadata presence;
- owner type/status labels;
- public/gallery risk label;
- derivative risk label;
- relationship risk label;
- recommended next action.

Manual review records must never include:

- raw prompts;
- provider request/response bodies;
- private R2 keys;
- signed URLs;
- cookies, auth headers, bearer tokens, or session values;
- Stripe data;
- Cloudflare tokens;
- private keys;
- raw idempotency keys;
- raw request fingerprints;
- full sensitive ownership metadata JSON.

## Review Outcomes

Future operator decisions may be:

- keep as legacy user-owned;
- mark as personal user asset in a later approved backfill;
- mark as organization asset only with strong server-side organization evidence;
- mark as platform admin test asset only with strong admin/test evidence;
- mark unsafe to migrate;
- mark requires privacy/lifecycle review;
- mark requires public-gallery attribution review;
- mark derivative blocked until parent ownership is resolved.

Phase 6.11 does not execute these outcomes.

## Blocked Conditions

Access-check switching and ownership backfill remain blocked when any of these are nonzero or unresolved:

- `metadata_missing`;
- `metadata_conflict`;
- `relationship_conflict`;
- `orphan_reference`;
- `public_unsafe`;
- `derivative_risk`;
- `dual_read_unsafe`;
- `manual_review_needed`;
- organization-owned rows without role-aware access policy;
- platform-admin-test rows without a normal access model.

The Phase 6.10 main evidence has nonzero `metadata_missing`, `public_unsafe`, `derivative_risk`, `dual_read_unsafe`, and `manual_review_needed`, so the workflow cannot approve access-check switching or backfill.

## Phase 6.12 State Schema Design

Phase 6.12 defines future review-state persistence without implementing it:

- proposed tables: `ai_asset_manual_review_items` and `ai_asset_manual_review_events`;
- future migration name: `0057_add_ai_asset_manual_review_state.sql`;
- deterministic review item keys and idempotent future imports;
- append-only review events for future status changes;
- safe evidence snapshot fields and forbidden unsafe fields;
- future admin API/UI requirements with no backfill, access-switch, R2, provider, Stripe, Cloudflare, credit, or billing actions.

## Phase 6.13 Schema Foundation

Phase 6.13 adds the additive migration `0057_add_ai_asset_manual_review_state.sql` and helper constants for the review categories, statuses, event types, severities, priorities, and safe metadata serialization.

The tables are empty after migration. No evidence is imported, no review rows are created, no endpoint/UI is added, no ownership metadata is backfilled, no access checks change, and no R2 objects are listed or mutated.

## Phase 6.14 Import Dry Run

Phase 6.14 adds `npm run tenant-assets:dry-run-review-import` for local-only planning. The committed Markdown evidence summary supports aggregate buckets only and does not allow per-row review-item creation. Item-level review import planning requires a bounded JSON evidence export with safe detail arrays.

The dry run maps evidence categories to target review-item fields and deterministic dedupe keys, but it does not connect to D1, create review rows, emit executable SQL, backfill ownership, switch access checks, or mutate R2.

## Phase 6.15 Import Executor

Phase 6.15 adds `POST /api/admin/tenant-assets/folders-images/manual-review/import`. It is admin-only, production-MFA protected through route policy, same-origin protected, rate-limited, and requires `Idempotency-Key`. It defaults to dry-run; execution requires `dryRun: false`, `confirm: true`, and a bounded `reason`.

Confirmed execution may create only `ai_asset_manual_review_items` rows and matching `ai_asset_manual_review_events` with `event_type = created`. It recomputes the current evidence report server-side, uses deterministic review item IDs for dedupe, skips existing review items, and leaves later review status changes to the separate Phase 6.17 endpoint.

Phase 6.15 still does not update `ai_folders`, update `ai_images`, backfill ownership metadata, switch access checks, change public gallery/media/lifecycle/quota/billing behavior, or list/mutate R2.

## Phase 6.16 Queue Read/Evidence APIs

Phase 6.16 adds read-only admin visibility for imported manual-review rows:

- `GET /api/admin/tenant-assets/folders-images/manual-review/items`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export`

The endpoints are bounded, sanitized, production-MFA protected through route policy, and read-only. They support queue filters, event history, queue rollups, and JSON/Markdown evidence export. They do not update review statuses, add notes, create review rows, update source asset rows, backfill ownership metadata, switch access checks, add Admin UI, or list/mutate R2.

## Phase 6.17 Status Workflow

Phase 6.17 adds `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`. The endpoint is admin-only, production-MFA protected through route policy, same-origin protected, rate-limited, and requires `Idempotency-Key`, `confirm: true`, and a bounded `reason`.

Allowed transitions are conservative: `pending_review` can move to `review_in_progress`, `deferred`, `rejected`, or `needs_legal_privacy_review`; `review_in_progress` can move to approved, blocked, deferred, rejected, or legal/privacy states; terminal approved/blocked/rejected states can move only to `superseded`; `superseded` has no outgoing transitions. Each status write updates only the review item row and creates a sanitized event (`status_changed`, `deferred`, `rejected`, or `superseded`).

Phase 6.17 does not update ownership metadata, source asset rows, public visibility, folders/images access checks, lifecycle/export/delete behavior, quota accounting, billing/credits, providers, Stripe, Cloudflare, or R2. Status decisions are operator evidence only and do not approve backfill or access switching.

## Future Implementation Phases

Recommended next phase:

`Phase 6.18 - Manual Review Status Operator Evidence`

That future phase should collect operator evidence from status changes before any backfill planning or access-switch work. It should still avoid access-check switching, old-row backfill, D1 ownership row rewrites, R2 listing/mutation, and any repair executor unless explicitly approved later.
