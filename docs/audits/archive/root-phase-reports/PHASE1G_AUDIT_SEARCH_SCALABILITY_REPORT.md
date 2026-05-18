# Phase 1-G Audit Search Scalability Report

Date: 2026-04-26

Scope: Phase 1-G hardening for scalable, safer admin audit/activity search and cursor pagination in `workers/auth`.

## Executive Summary

Phase 1-G replaces scan-prone admin audit and user activity search paths with an indexed, redacted projection table populated for new activity events. It also changes the admin audit/activity endpoints from raw `created_at|id` cursors to purpose-signed pagination cursors using `PAGINATION_SIGNING_SECRET`.

This phase reduces growth risk in `/api/admin/activity` and `/api/admin/user-activity` by removing request-path search over raw `meta_json`, bounding admin action counts to the hot retention window, adding query-shape regression checks, and preserving admin UX with prefix search over normalized action/email/entity fields.

This is not a full audit-log product, external search system, or compliance archive. Existing historical rows are not automatically backfilled into the new projection in this phase; production/staging operators must apply migration `0031_add_activity_search_index.sql` and run a controlled backfill if historical indexed search coverage is required.

## Scope

Included:

- Admin audit and user activity read endpoints in `workers/auth/src/routes/admin.js`.
- Queue/direct activity write paths in `workers/auth/src/lib/activity.js` and `workers/auth/src/lib/activity-ingestion.js`.
- Hot-window archive cleanup in `workers/auth/src/lib/activity-archive.js`.
- A new D1 projection table/index migration.
- Route policy metadata, release compatibility, CI/preflight checks, Worker tests, and admin UI search placeholder text.

Out of scope:

- Tenant-aware audit logs.
- Enterprise audit export/search product.
- Production backfill execution.
- External search warehouse.
- Compliance-grade evidence retention beyond existing archive behavior.

## Baseline Inventory

Before Phase 1-G:

| Area | Previous behavior | Risk |
| --- | --- | --- |
| Admin audit endpoint | `GET /api/admin/activity` read from `admin_audit_log` and used a raw `created_at|id` cursor. | Raw cursor could be forged/tampered and was not bound to route/filter context. |
| User activity endpoint | `GET /api/admin/user-activity` read from `user_activity_log`, accepted `search`, and used a raw `created_at|id` cursor. | Same raw cursor risk and inconsistent pagination behavior. |
| Search query | Admin/user activity search matched `%search%` across user emails, action, and raw `a.meta_json`. | Full scans over JSON metadata, broad sensitive metadata exposure risk, poor large-table scaling. |
| Counts | Admin action counts used `GROUP BY action` over the audit table without a hot-window bound. | Request-path aggregation cost grows with table size. |
| Metadata response | Admin responses returned `meta_json` from source rows directly. | Raw metadata could include support/debug fields that should not be used as broad search/response material. |
| Index strategy | Existing source tables had created-at/cursor indexes, but no normalized searchable projection. | Email/action/entity search depended on joins and JSON/string scans. |

Current source-of-truth tables remain:

- `admin_audit_log`
- `user_activity_log`

Current endpoints in scope:

- `GET /api/admin/activity?limit=&cursor=&search=`
- `GET /api/admin/user-activity?limit=&cursor=&search=`

Frontend consumer:

- `admin/index.html` admin activity search input.

## Current Risky Queries Removed

Phase 1-G removes request-path activity search over:

- `a.meta_json LIKE ?`
- wildcard `%search%` metadata matching
- raw `created_at|id` cursor parsing/formatting

The new `scripts/check-admin-activity-query-shape.mjs` guard fails if these patterns are reintroduced into `workers/auth/src/routes/admin.js`.

## New Schema / Migration

New migration:

- `workers/auth/migrations/0031_add_activity_search_index.sql`

New table:

```sql
activity_search_index (
  source_table TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email_norm TEXT,
  target_user_id TEXT,
  target_email_norm TEXT,
  action_norm TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_table, source_event_id)
)
```

Indexes added:

- `(source_table, created_at DESC, source_event_id DESC)`
- `(source_table, action_norm, created_at DESC, source_event_id DESC)`
- `(source_table, actor_email_norm, created_at DESC, source_event_id DESC)`
- `(source_table, target_email_norm, created_at DESC, source_event_id DESC)`
- `(source_table, entity_type, entity_id, created_at DESC, source_event_id DESC)`
- `admin_audit_log (created_at DESC, action)` for hot-window action counts.

The source audit/activity tables remain the source of truth. The projection exists for safer indexed search and stable query shapes.

## Projection / Index Design

New helper:

- `workers/auth/src/lib/activity-search.js`

Projection behavior:

- Normalizes emails by trim/lowercase.
- Normalizes action names into `action_norm`.
- Extracts target/actor email only from known metadata keys.
- Extracts entity identifiers from known safe keys such as `target_user_id`, `image_id`, `folder_id`, `asset_id`, and `job_id`.
- Leaves the optional `summary` projection field `NULL` in Phase 1-G; search uses explicit normalized columns instead of a broad summary text blob.
- Sanitizes returned `meta_json` through action-specific and generic allowlists.

Fields intentionally not used for broad search/response:

- Raw request bodies.
- Tokens, sessions, signatures, recovery codes, MFA data.
- Provider credentials or raw provider payloads.
- Arbitrary raw JSON metadata.

## Write-Path Projection Behavior

Updated write paths:

- `workers/auth/src/lib/activity.js`
- `workers/auth/src/lib/activity-ingestion.js`

Behavior:

- New queued user activity and admin audit events are persisted to the source table and `activity_search_index`.
- Direct D1 fallback for admin audit writes also writes the projection row.
- Queue batch ingestion uses `INSERT OR IGNORE` semantics for idempotent source/projection writes.
- Projection uniqueness is keyed by `(source_table, source_event_id)`.

Archive cleanup:

- `workers/auth/src/lib/activity-archive.js` deletes matching projection rows when hot source rows are archived/pruned.

Deployment dependency:

- Apply migration `0031_add_activity_search_index.sql` before deploying auth Worker code that writes to the projection table.

## Backfill Strategy

No production backfill is executed in this phase.

Current behavior:

- New events are indexed going forward after migration `0031` is applied.
- Existing historical rows without projection entries remain visible in recent unfiltered listing.
- Existing historical rows without projection entries do not participate in indexed prefix search until a controlled backfill runs.

Recommended backfill approach:

- Run only in staging first.
- Default to dry-run.
- Process bounded batches ordered by source table and created time.
- Use the same normalization/redaction helper from `activity-search.js`.
- Do not print raw metadata.
- Record progress externally or by deterministic source id window.
- Verify search parity on representative historical samples before production.

Phase 1-G intentionally does not add a production-mutating backfill command to normal CI/preflight.

## Signed Cursor Behavior

Updated endpoints now use signed cursors:

- `GET /api/admin/activity`
- `GET /api/admin/user-activity`

Cursor properties:

- Signed with `PAGINATION_SIGNING_SECRET` through `workers/auth/src/lib/pagination.js`.
- Does not use `SESSION_SECRET`.
- Contains cursor tuple `created_at` + `id`.
- Contains a route/purpose-specific cursor type.
- Contains a filter hash derived from source table and normalized search term.
- Contains an expiry timestamp.

Rejected cases:

- Tampered cursor.
- Cursor from another route.
- Cursor from another search/filter.
- Expired cursor.
- Missing or invalid pagination signing secret.

Ordering:

- Keyset pagination uses `(created_at DESC, id DESC)` to avoid duplicates/skips when multiple rows share a timestamp.

## Search Behavior Before vs After

| Behavior | Before | After |
| --- | --- | --- |
| Action search | Wildcard substring over `action`. | Prefix/range match over `idx.action_norm`. |
| Actor email search | Wildcard substring via user join/raw metadata. | Prefix/range match over `idx.actor_email_norm`. |
| Target email search | Wildcard substring via user join/raw metadata. | Prefix/range match over `idx.target_email_norm`. |
| Entity id search | Not structured. | Prefix/range match over `idx.entity_id`. |
| Raw metadata search | `a.meta_json LIKE '%term%'`. | Removed from request path. |
| Empty search | Recent keyset listing. | Recent keyset listing preserved. |
| Search term syntax | Broad string. | Trimmed/lowercased prefix search, capped at 100 characters. |
| Response metadata | Raw `meta_json`. | Sanitized `meta_json` allowlist. |

Admin UI copy was updated from broad “details” search to “email prefix, action, or entity ID” to avoid promising arbitrary metadata search.

## Count / Summary Behavior

Admin activity counts are now bounded to the configured hot retention window through `getActivityRetentionCutoff()`.

Current limitation:

- Counts remain request-time grouped counts for the hot D1 window.
- Phase 1-G does not add a precomputed aggregate table.

Reasoning:

- The hot-window bound removes the worst unbounded full-history scan risk while preserving existing admin dashboard behavior.
- A precomputed summary table should be introduced only after product requirements define exact reporting windows and dimensions.

## Admin UI Changes

Changed:

- `admin/index.html` search placeholder now says: “Search logs by email prefix, action, or entity ID...”

Not changed:

- Admin layout.
- Admin routing.
- Existing activity table behavior.
- Existing admin workflow.

## Route Policy and Release Compatibility

Updated:

- `workers/auth/src/app/route-policy.js` records `PAGINATION_SIGNING_SECRET` for admin activity endpoints.
- `config/release-compat.json` latest auth migration is now `0031_add_activity_search_index.sql`.
- `scripts/test-release-compat.mjs` and `scripts/test-release-plan.mjs` know about the new migration/check.
- `.github/workflows/static.yml` runs `npm run check:admin-activity-query-shape`.
- `scripts/lib/release-plan.mjs` includes the query-shape guard in recommended preflight checks.

## Performance / Query-Shape Checks

New script:

- `scripts/check-admin-activity-query-shape.mjs`

New package script:

- `npm run check:admin-activity-query-shape`

The guard is deterministic and fails on:

- Raw `meta_json LIKE` activity search patterns in `workers/auth/src/routes/admin.js`.
- Unbounded admin action count/grouping pattern.
- Raw activity cursor formatting/parsing patterns.

## Tests Added / Updated

Updated:

- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`

Coverage added:

- Activity search projection rows are written for queued user activity.
- Activity search projection rows are written for queued admin audit events.
- Duplicate activity queue redelivery does not duplicate projection rows.
- Admin audit direct fallback writes projection rows.
- Admin activity endpoint uses signed cursors.
- Tampered activity cursor is rejected.
- Cursor from another search/filter is rejected.
- Expired signed cursor is rejected.
- Missing pagination signing config fails closed.
- Raw metadata-only search no longer matches.
- Actor/target email and action prefix search still works through projection.
- Returned `meta_json` is sanitized.
- Bounded counts exclude rows outside hot retention window.
- User activity search uses signed cursors and projection-backed prefix search.

## Commands Run and Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run release:preflight` | PASS before Phase 1-G changes | Baseline confirmed clean before implementation. |
| `npm run check:toolchain` | PASS | Node/npm toolchain guard remains green. |
| `npm run test:quality-gates` | PASS | Secret/DOM/toolchain scanner tests remain green. |
| `npm run check:secrets` | PASS | No obvious committed secret patterns found. |
| `npm run check:dom-sinks` | PASS | No new unreviewed DOM sinks above baseline. |
| `npm run check:route-policies` | PASS | 88 registered auth-worker route policies validate. |
| `npm run test:operational-readiness` | PASS | Operational readiness helper tests remain green. |
| `npm run check:operational-readiness` | PASS | Required operational docs and runbooks still exist. |
| `npm run check:live-health` | PASS, SKIPPED | No live URL configured; normal CI remains non-flaky. |
| `npm run check:live-security-headers` | PASS, SKIPPED | No public base URL configured; normal CI remains non-flaky. |
| `npm run check:js` | PASS | Targeted JS syntax guard includes the new query-shape script and activity-search helper. |
| `npm run check:admin-activity-query-shape` | PASS | New guard does not detect raw metadata search, raw activity cursors, or unbounded action counts. |
| `npm run test:release-compat` | PASS | Release compatibility accepts migration `0031`. |
| `npm run test:release-plan` | PASS | Release plan includes the new query-shape guard. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq tests remain green. |
| `npm run validate:cloudflare-prereqs` | PASS repo config; production BLOCKED | Live validation was skipped, so production deploy remains blocked as designed. |
| `npm run check:worker-body-parsers` | PASS | Body parser guard remains green. |
| `npm run test:workers` | PASS, 306/306 | Worker tests cover signed cursors, projection-driven search, redaction, projection writes, `summary` nulling, and fail-closed pagination config. |
| `npm run test:asset-version` | PASS | Asset version tests remain green. |
| `npm run validate:asset-version` | PASS | Asset version validation remains green. |
| `npm run build:static` | PASS | Static site builds successfully. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI tests remain green after the search placeholder update. |
| `npm ls --depth=0` | PASS | Root package tree resolves. |
| `npm audit --audit-level=low` | PASS | Root audit found 0 vulnerabilities. |
| `npm run release:preflight` | PASS | Aggregate preflight passed with the new query-shape guard included. |
| `git diff --check` | PASS | No whitespace errors in the final diff. |

Not run:

- `npm ci`, because no dependency or lockfile changes were made.
- Worker package `npm ci` / `npm ls` / `npm audit`, because worker package manifests and lockfiles were not changed in this phase.
- Live Cloudflare validation, because no live credentials/URLs were configured and production-mutating validation is intentionally out of scope.
- Remote D1 migrations, because production/staging mutation is out of scope.

## Merge Readiness

Status: conditional pass.

Local validation passed, including `npm run test:workers` 306/306, `npm run test:static` 155/155, and `npm run release:preflight`.

Merge requires committing all Phase 1-G files together:

- D1 migration `0031_add_activity_search_index.sql`.
- Activity search helper and route changes.
- Activity write/ingestion/archive updates.
- Worker harness/test updates.
- Query-shape guard and CI/preflight wiring.
- Release compatibility updates.
- Admin UI placeholder update.
- Documentation/action-plan updates.

A partial commit would either break auth Worker runtime writes to `activity_search_index`, omit release compatibility for the new migration, or leave CI unaware of the new query-shape guard.

## Production Deploy Readiness

Status: blocked until staging/live migration verification.

Required before production deploy:

1. Apply `workers/auth/migrations/0031_add_activity_search_index.sql` to staging D1.
2. Deploy auth Worker code to staging.
3. Generate representative user/admin activity events.
4. Verify projection rows are created for new events.
5. Verify `/api/admin/activity` and `/api/admin/user-activity` with signed cursors and projection search.
6. Verify historical search limitations are acceptable or run a controlled backfill.
7. Apply migration `0031` to production D1 before auth Worker deploy.
8. Keep `PAGINATION_SIGNING_SECRET` provisioned in `workers/auth`.
9. Run `npm run release:preflight` on the final commit set.

Do not deploy the updated auth Worker before migration `0031` is applied.

## Rollback Plan

Safe rollback options:

- If migration `0031` has been applied but code has not deployed, leaving the extra table/indexes in place is safe.
- If code deploy causes issues, roll back auth Worker code to the previous version; the projection table can remain unused.
- Do not drop `activity_search_index` during emergency rollback.
- If projection writes fail in staging, stop deploy and inspect migration presence, D1 permissions, and activity queue consumer logs.

Historical data rollback:

- No source audit/activity rows are rewritten or deleted by this phase.
- Archive cleanup now removes matching projection rows when source hot rows are pruned; source archives remain the durable cold history.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
| --- | --- | ---: | ---: | --- |
| Historical rows are not automatically backfilled. | Indexed search may not find old rows without projection entries. | No | Maybe, if support requires full historical search on day one | Run staging dry-run/backfill design before production historical-search expectations are advertised. |
| Search is prefix/exact-field oriented, not arbitrary substring search. | Admins lose broad raw “details” search semantics. | No | No | Update support docs/UI if more explicit filters are needed. |
| Counts are bounded to hot retention, not precomputed all-history analytics. | Dashboard counts are operational hot-window counts, not compliance totals. | No | No | Add summary tables only after reporting requirements are defined. |
| Migration `0031` is required before auth Worker deploy. | Missing table can break activity write/ingest paths. | No | Yes | Apply migration in staging/production before code deploy. |
| Projection fields are intentionally narrow. | Some future support searches may need additional safe fields. | No | No | Add explicit indexed fields, not raw metadata scans. |
| No load test over very large D1 tables was run locally. | Query cost under production cardinality still needs staging evidence. | No | No | Add staging large-row-count query timing checks after migration/backfill. |

## Next Recommended Actions

1. Commit every Phase 1-G file together, including the untracked report, query-shape script, migration, and helper module.
2. Apply migration `0031` in staging before deploying the auth Worker.
3. Verify new activity/admin audit events create projection rows in staging.
4. Run representative admin activity search and signed-cursor pagination checks in staging.
5. Decide whether historical rows require a controlled backfill before production launch.
6. Add a dry-run backfill script if historical indexed search becomes operationally required.
7. Add staging query timing checks with a large-enough synthetic dataset.
8. Add explicit UI filter controls if support needs action/email/entity search beyond the single search box.

## Phase 1-G Pre-Merge Review Result

Status: PASS for merge; production deploy remains blocked on migration/live verification.

Review findings:

- Found that search-mode queries joined `activity_search_index` but still drove from `admin_audit_log` / `user_activity_log`, which could preserve scan-prone behavior under large tables.
- Found the projection `summary` field duplicated normalized emails/entity details even though the field is not used by search.
- Found the hot-window admin count query had a bounded predicate but no dedicated count-supporting index in the Phase 1-G migration.

Fixes made:

- Search-mode admin audit and user activity queries now drive from `activity_search_index` and join back to the source table by `source_event_id`.
- `scripts/check-admin-activity-query-shape.mjs` now requires both admin activity search routes to have projection-driven query shapes.
- New projection rows now leave `summary` as `NULL`; explicit normalized fields remain the only searchable projection values.
- Migration `0031_add_activity_search_index.sql` now also adds `idx_admin_audit_log_created_action` for the bounded action count query.

Validation after review fixes:

- `npm run check:js`: PASS.
- `npm run check:admin-activity-query-shape`: PASS.
- `npm run test:release-compat`: PASS.
- `npm run test:release-plan`: PASS.
- `npm run test:workers`: PASS, 306/306.
- `npm run test:static`: PASS, 155/155.
- `npm run test:cloudflare-prereqs`: PASS.
- `npm run validate:cloudflare-prereqs`: PASS for repo config; production deploy BLOCKED because live validation was skipped.
- Phase 1-C quality checks: PASS.
- `npm run check:route-policies`: PASS.
- Phase 1-F operational checks: PASS/skipped as designed for live checks without URLs.
- `npm run build:static`: PASS.
- `npm ls --depth=0`: PASS.
- `npm audit --audit-level=low`: PASS.
- `npm run release:preflight`: PASS.
- `git diff --check`: PASS.

Remaining pre-deploy risk:

- Migration `0031_add_activity_search_index.sql` must be applied before auth Worker deploy.
- Historical activity rows remain unindexed until a controlled backfill is designed and run.
- Live Cloudflare/staging checks were not run in this local review.
