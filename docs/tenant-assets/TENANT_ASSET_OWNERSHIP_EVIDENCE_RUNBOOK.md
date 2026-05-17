# Tenant Asset Ownership Evidence Runbook

Date: 2026-05-17

Purpose: collect operator evidence from the Phase 6.7 read-only AI folders/images ownership evidence endpoints before any future owner-map backfill or access-check migration.

This runbook is evidence collection only. It does not approve production readiness, live billing readiness, full tenant isolation, ownership backfill, access-check switching, D1 mutation, R2 listing, R2 deletion, provider calls, Stripe calls, Cloudflare changes, or GitHub settings changes.

The active workflow is **main-only**. There is no required separate staging environment for this tenant asset ownership evidence collection.

## Prerequisites

- The reviewed Auth Worker code containing the Phase 6.7 tenant asset evidence endpoints is deployed by the operator, if not already live.
- Remote auth D1 migration status is verified through `0058_add_legacy_media_reset_actions.sql` before deploying Auth Worker code that depends on the current schema foundation.
- The operator has a platform admin account and completes admin MFA where required.
- Evidence is saved in an operator-approved private evidence location. Do not commit live evidence files if they contain user ids or production row identifiers.
- Sanitized in-repo summaries, pending records, or approved redacted exports belong under `docs/tenant-assets/evidence/`.
- No backfill, cleanup, R2 listing, provider call, Stripe action, or Cloudflare dashboard/API change is part of this runbook.

## What This Evidence Proves

- The admin-only evidence endpoint is reachable after deployment.
- The report is bounded, local-D1-only, and sanitized.
- The report records the current folder/image ownership metadata coverage and simulated dual-read safety signals.
- The report can identify metadata-missing rows, conflicts, orphan folder references, public unsafe rows, derivative risks, and manual-review counts.

## What This Evidence Does Not Prove

- It does not prove full tenant isolation.
- It does not prove organization-owned asset access is implemented.
- It does not prove it is safe to switch access checks to ownership metadata.
- It does not prove it is safe to backfill old rows.
- It does not prove R2 object existence or owner mapping, because the endpoint does not list live R2.

## Read-Only Endpoints

- `GET /api/admin/tenant-assets/folders-images/evidence`
- `GET /api/admin/tenant-assets/folders-images/evidence/export`

Supported query parameters:

- `limit` - bounded by the endpoint, max 100.
- `includeDetails` - include bounded detail items.
- `includeRelationships` - include folder/image relationship diagnostics.
- `includePublic` - include public-gallery safety diagnostics.
- `includeDerivatives` - include derivative ownership-risk diagnostics.
- `classification` - optional diagnostic classification filter.
- `severity` - optional `critical`, `warning`, or `info` filter.
- `format` - export endpoint only; `json` or `markdown`.

## Collection Steps

1. Record branch, commit, operator, environment, and migration evidence in `docs/tenant-assets/TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md`.
2. Authenticate in the target environment as an approved platform admin and complete MFA.
3. Fetch the evidence summary with a bounded limit.
4. Fetch a JSON export.
5. Optionally fetch a Markdown export.
6. Inspect exports for redaction and absence of unsafe fields.
7. If committing an in-repo summary, use `docs/tenant-assets/evidence/README.md` and optionally `npm run tenant-assets:summarize-evidence`.
8. Record summary counts and the risk decision in the evidence template.
9. Update `docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` after real main evidence is collected and reviewed.
10. Do not run any backfill, cleanup, access-switch, D1 update, R2 list/delete/move, provider, Stripe, or Cloudflare action.

## Safe Examples

Browser/manual collection is preferred when possible, because copying session cookies into a shell is risky.

Open while signed in as an admin:

```text
https://bitbi.ai/api/admin/tenant-assets/folders-images/evidence?limit=100&includeDetails=true&includeRelationships=true&includePublic=true&includeDerivatives=true
```

JSON export:

```text
https://bitbi.ai/api/admin/tenant-assets/folders-images/evidence/export?format=json&limit=100&includeDetails=true&includeRelationships=true&includePublic=true&includeDerivatives=true
```

Markdown export:

```text
https://bitbi.ai/api/admin/tenant-assets/folders-images/evidence/export?format=markdown&limit=100&includeDetails=true&includeRelationships=true&includePublic=true&includeDerivatives=true
```

If an operator intentionally uses curl, use placeholders only and keep cookie handling out of shared notes, shell history, issues, and screenshots:

```bash
curl -sS "https://bitbi.ai/api/admin/tenant-assets/folders-images/evidence?limit=100&includeDetails=true&includeRelationships=true&includePublic=true&includeDerivatives=true" \
  -H "Cookie: <admin-session-cookie>" \
  -o tenant-assets-evidence.json
```

```bash
curl -sS "https://bitbi.ai/api/admin/tenant-assets/folders-images/evidence/export?format=json&limit=100&includeDetails=true&includeRelationships=true&includePublic=true&includeDerivatives=true" \
  -H "Cookie: <admin-session-cookie>" \
  -o tenant-assets-evidence-export.json
```

No example command contains a real cookie, bearer token, Cloudflare token, Stripe key, provider key, private key, or signed URL.

## Recommended Evidence Files

- `tenant-assets-evidence-YYYY-MM-DD.json`
- `tenant-assets-evidence-export-YYYY-MM-DD.json`
- `tenant-assets-evidence-export-YYYY-MM-DD.md`
- `tenant-assets-evidence-record-YYYY-MM-DD.md`

Keep live evidence in a private operator evidence store. Commit only redacted summaries when needed.

If evidence has not been collected yet, keep `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` as a pending marker. In the current Phase 6.10 state, `docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md` is the reviewed main evidence summary and the pending marker is historical. Do not treat pending files as evidence.

`docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md` records the current operator decision. Synthetic fixtures under `scripts/fixtures/` are not main evidence.

To summarize a reviewed JSON export without calling live endpoints:

```bash
npm run tenant-assets:summarize-evidence -- --input docs/tenant-assets/evidence/<redacted-export>.json
```

To write a sanitized Markdown summary into the evidence directory:

```bash
npm run tenant-assets:summarize-evidence -- --input docs/tenant-assets/evidence/<redacted-export>.json --output docs/tenant-assets/evidence/YYYY-MM-DD-main-folders-images-owner-map-evidence.md
```

After the Phase 6.10 decision is reviewed, use `docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md` and `docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md` for design-only manual review planning. The local planner can render a non-mutating plan from the committed Markdown summary:

```bash
npm run tenant-assets:plan-manual-review -- --input docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md
```

For the later manual-review import/status workflow, use `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_RUNBOOK.md`, `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_TEMPLATE.md`, and `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`. Phase 6.20 records sanitized live/main operator evidence as `operator_evidence_collected_needs_more_idempotency`: import dry-run, confirmed import, final queue/status export, and one status-change rollup are present, but same-key replay/conflict idempotency evidence and a successful standalone status-update response still need completion.

## Redaction Checks

Before sharing or attaching evidence, verify that it does not contain:

- raw prompts or generated private content
- private R2 keys, signed URLs, or internal media URLs
- raw provider request/response bodies
- cookies, auth headers, bearer tokens, API keys, or private keys
- Stripe data or payment method data
- Cloudflare tokens, account secrets, or dashboard values
- raw idempotency keys or request fingerprints

## Interpretation Guide

| Signal | Meaning | Operator action |
| --- | --- | --- |
| `metadata_missing > 0` | Expected for old rows; ownership metadata is incomplete. | Do not switch access checks. Keep evidence for manual review/backfill planning. |
| `metadata_conflict > 0` | Legacy `user_id` and ownership metadata disagree. | Block access-switch planning until reviewed. |
| `relationship_conflict > 0` | Folder/image ownership signals disagree. | Block access-switch planning until reviewed. |
| `orphan_reference > 0` | Image references a missing folder. | Block automatic backfill and review data lifecycle impact. |
| `public unsafe > 0` | Public row has missing, ambiguous, or conflicting ownership evidence. | Block public ownership-based access or attribution changes. |
| `derivative risk > 0` | Derivative ownership depends on unclear parent ownership. | Review parent row evidence before any R2 or derivative migration. |
| `organization-owned rows > 0` | Organization owner metadata exists, but org-role access is not enabled yet. | Treat as manual review until role-aware access policy is implemented. |
| `dual-read unsafe count > 0` | Simulated ownership access would not match legacy behavior. | Do not switch access checks. |
| `dual-read safe count > 0` | Some rows are consistent under simulation. | Evidence only; not approval for tenant isolation. |

## Pass, Fail, And Blocked Criteria

Evidence collection can be recorded as passed when:

- the admin endpoint returns successfully for an approved admin/MFA session
- `source` is `local_d1_read_only`
- `runtimeBehaviorChanged`, `accessChecksChanged`, `backfillPerformed`, and `r2LiveListed` are all `false`
- `productionReadiness` is `blocked`
- bounded JSON export is saved
- no unsafe raw fields are present

Evidence collection is failed or blocked when:

- admin authentication or MFA fails unexpectedly
- the endpoint is unavailable after a reviewed deploy
- output appears unbounded
- output includes raw prompts, private R2 keys, signed URLs, secrets, Stripe data, or Cloudflare tokens
- any report field implies a backfill, access switch, R2 listing, provider call, Stripe call, or mutation occurred

Access-switch or backfill planning remains blocked when any high-risk count is nonzero.

## Decision Tree

If any of these are nonzero:

- metadata missing
- metadata conflict
- relationship conflict
- public unsafe
- orphan references
- derivative risk
- dual-read unsafe

Then:

- do not switch access checks
- do not backfill automatically
- do not move, list, or delete R2 objects
- update the decision document and proceed to manual review planning

If all high-risk counts are zero on controlled test data only:

- still do not claim tenant isolation
- still do not switch production access checks
- proceed only to a limited evidence or design phase approved by the owner

## Rollback / No-Op Statement

This runbook is read-only. There is no code or data rollback step because collection does not mutate D1, R2, Cloudflare, Stripe, GitHub, provider state, credits, billing, folders, images, or access checks. If evidence was saved in the wrong place, follow the operator evidence-storage policy for secure disposal.

## Next Recommended Phase

Phase 6.17 adds admin-approved review status updates for imported manual-review rows only. Phase 6.18 adds Admin queue/status visibility and status operator evidence rollups for review-state rows only. Phase 6.19 adds operator evidence collection docs. Phase 6.20 reviews committed live/main operator evidence and leaves the decision at `operator_evidence_collected_needs_more_idempotency`. Phase 6.21 adds read-only legacy media reset dry-run/export planning. Phase 6.22 adds reset executor design. Phase 6.23 adds reset action/event tracking and a dry-run-default executor path; the next recommended reset-planning phase is Phase 6.24 - Legacy Media Reset Operator Dry-run Evidence.
