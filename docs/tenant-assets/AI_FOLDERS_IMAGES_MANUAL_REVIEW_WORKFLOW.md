# AI Folders & Images Manual Review Workflow

Last updated: 2026-05-17

Phase 6.11 defines a manual-review workflow for AI folders/images owner-map issues found by the main-only evidence process. It is design and planning only. It does not add a D1 migration, endpoint, Admin UI, repair executor, ownership backfill, access-check switch, D1 row update, R2 listing, R2 mutation, provider call, Stripe call, Cloudflare call, credit mutation, billing mutation, tenant-isolation claim, or production-readiness claim.

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

These statuses are design-only in Phase 6.11. No D1 table is added, no D1 row is updated, and no runtime behavior changes.

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

## Future Implementation Phases

Recommended next phase:

`Phase 6.12 - Manual Review State Schema Design for AI Folders & Images`

That future phase may design or add an additive review-state table if needed. It should still avoid access-check switching, old-row backfill, D1 row rewrites, R2 listing/mutation, and any repair executor unless explicitly approved later.

