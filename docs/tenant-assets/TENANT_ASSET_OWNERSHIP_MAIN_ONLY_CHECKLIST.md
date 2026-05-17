# Tenant Asset Ownership Main-Only Evidence Checklist

Date: 2026-05-17

Default verdict: **blocked**

This checklist is for owner-run evidence collection from `main` after the Phase 6.7 read-only tenant asset ownership evidence endpoint is deployed. It is not a deploy approval, production-readiness approval, live-billing approval, tenant-isolation approval, access-switch approval, or backfill approval.

## Before Evidence Collection

| Check | Evidence | Result |
| --- | --- | --- |
| Working tree is clean before operator deploy/evidence window |  | blocked |
| Reviewed commit SHA recorded |  | blocked |
| Local validation completed |  | blocked |
| Release plan reviewed |  | blocked |
| Remote auth D1 migration `0056_add_ai_folder_image_ownership_metadata.sql` verified before Auth Worker deploy |  | blocked |
| Auth Worker containing Phase 6.7 endpoint deployed by operator if not already live |  | blocked |
| No static/Admin UI deploy is required for Phase 6.8 docs-only work |  | blocked |
| Admin account and MFA path confirmed |  | blocked |

Suggested local checks before an operator deploy/evidence window:

```bash
npm run check:js
npm run check:secrets
npm run test:doc-currentness
npm run check:doc-currentness
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:readiness-evidence
npm run test:main-release-readiness
npm run dry-run:tenant-assets
npm run dry-run:tenant-assets:images
npm run test:tenant-assets
npm run release:plan
npm run release:preflight
git diff --check
git status --short
```

## Collect Evidence

| Step | Evidence | Result |
| --- | --- | --- |
| Authenticate as platform admin |  | blocked |
| Complete MFA where required |  | blocked |
| Call `/api/admin/tenant-assets/folders-images/evidence` with bounded filters |  | blocked |
| Call `/api/admin/tenant-assets/folders-images/evidence/export?format=json` |  | blocked |
| Optionally call `/api/admin/tenant-assets/folders-images/evidence/export?format=markdown` |  | optional |
| Save JSON evidence to approved private evidence storage |  | blocked |
| Save Markdown evidence if used |  | optional |
| Save approved redacted summary or pending marker under `docs/tenant-assets/evidence/` |  | blocked |
| Fill `TENANT_ASSET_OWNERSHIP_EVIDENCE_TEMPLATE.md` |  | blocked |

## Verify Sanitization

| Check | Expected | Result |
| --- | --- | --- |
| No raw prompts or generated private content | none present | blocked |
| No private R2 keys or signed URLs | none present | blocked |
| No cookies, auth headers, bearer tokens, or API keys | none present | blocked |
| No Stripe data, Cloudflare tokens, or private keys | none present | blocked |
| No raw idempotency keys or request fingerprints | none present | blocked |
| Report flags `runtimeBehaviorChanged: false` | true | blocked |
| Report flags `accessChecksChanged: false` | true | blocked |
| Report flags `backfillPerformed: false` | true | blocked |
| Report flags `r2LiveListed: false` | true | blocked |

## Do Not Do

- Do not run remote migrations from this checklist.
- Do not run an ownership backfill.
- Do not update existing `ai_folders` or `ai_images` rows.
- Do not switch access checks to ownership metadata.
- Do not list, move, copy, rewrite, or delete R2 objects.
- Do not call provider APIs.
- Do not call Stripe APIs.
- Do not mutate Cloudflare, GitHub settings, secrets, credits, billing, lifecycle, quota, gallery, media serving, or public pricing.
- Do not record `production ready`, `live billing ready`, or `tenant isolation complete`.

## Decision Gate

If any of these are nonzero, keep the verdict blocked for access-switch and backfill work:

- metadata missing
- metadata conflict
- relationship conflict
- orphan references
- public unsafe
- derivative risk
- dual-read unsafe

If the endpoint is unavailable, output is unsafe, or required migration/deploy evidence is missing, record `blocked`.

If evidence is collected safely but high-risk counts remain, record `needs_more_evidence` or `unsafe_for_access_switch` in the evidence template and proceed only to manual review or Phase 6.10 operator-run main evidence review.

If no real operator-exported evidence is present in the repository, keep `docs/tenant-assets/evidence/PENDING_MAIN_FOLDERS_IMAGES_OWNER_MAP_EVIDENCE.md` as the package state and do not claim main evidence was collected.

## Next Recommended Phase

Phase 6.10 - Operator-run Main Evidence Review and Decision.
