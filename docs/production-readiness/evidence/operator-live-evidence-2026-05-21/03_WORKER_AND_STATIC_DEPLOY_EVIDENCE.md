# 03 - Worker And Static Deploy Evidence

Date: 2026-05-21

Operator: pending human review; repo-derived expectations filled by Codex

Reviewed commit: `6be19411c897109c2d74e609b91fb9b5a88c8567`

This template records operator evidence after an approved release process. It does not deploy or approve production readiness.

## Release Plan Snapshot

- Release-impact classification: validation-only after evidence Markdown updates; noop/clean at sprint start
- Impacted deploy units: none
- Worker deploys: none
- Schema applies: none
- Static required: no
- Non-static deploy steps: none
- Required manual prerequisites: none
- Push-based static deploy safety result: allowed, mode `validation_only`

Local evidence artifact status:

- `npm run release:plan`: no runtime deploy steps required by current diff.
- `npm run release:cutover-evidence`: local-only, non-mutating, no deploy, no remote migration.
- `npm run release:rc`: local-only release candidate manifest, final production readiness claim remains NO-GO.
- Final master closure refresh: `npm run release:plan` and `npm run check:static-deploy-safety -- --event-name push --acknowledgement ""` both passed for the current commit with no Worker deploys, no schema applies, no static deploy requirement, and no non-static deploy steps.
- Mega Packet refresh: release plan and static deploy safety remained clean before evidence edits; deploy ids, Pages deploy id, and remote D1 migration status remain pending operator verification.

## Complete Deploy Evidence Table

| Target | Expected name / route / domain | Expected source commit | Deployed version / deploy ID | Deployed timestamp | Evidence source | Status | Rollback target | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth Worker | `bitbi-auth`; route `bitbi.ai/api/*` | `6be19411c897109c2d74e609b91fb9b5a88c8567` if released | operator to fill | operator to fill | Cloudflare dashboard or sanitized read-only API evidence | pending | operator to fill | No deploy run by Codex. |
| AI Worker | `bitbi-ai`; service-bound by Auth | `6be19411c897109c2d74e609b91fb9b5a88c8567` if released | operator to fill | operator to fill | Cloudflare dashboard or sanitized read-only API evidence | pending | operator to fill | No deploy run by Codex. |
| Contact Worker | `bitbi-contact`; `contact.bitbi.ai` | `6be19411c897109c2d74e609b91fb9b5a88c8567` if released | operator to fill | operator to fill | Cloudflare dashboard or sanitized read-only API evidence | pending | operator to fill | Contact health 200 was previously observed; deploy id still pending. |
| Static Pages | GitHub Pages / `bitbi.ai` | `6be19411c897109c2d74e609b91fb9b5a88c8567` if released | operator to fill | operator to fill | GitHub Pages deployment/workflow evidence | pending | operator to fill | Public static 200 was previously observed; Pages deploy id still pending. |
| D1 migration status | `bitbi-auth-db` through `0060_add_app_settings.sql` | release contract checkpoint | operator to fill | operator to fill | Cloudflare D1 migration history or approved read-only status output | pending | not a rollback target | No remote D1 command run by Codex. |
| Auth route | `bitbi.ai/api/*` -> `bitbi-auth` | release contract route | operator to fill | operator to fill | Cloudflare route evidence | pending | previous route config if applicable | Presence/shape only. |
| Contact route | `contact.bitbi.ai` -> `bitbi-contact` | release contract route | operator to fill | operator to fill | Cloudflare route/custom-domain evidence | pending | previous route config if applicable | Presence/shape only. |
| Static domain | `bitbi.ai` | Pages workflow/custom domain | operator to fill | operator to fill | GitHub Pages and DNS/Cloudflare dashboard evidence | pending | previous Pages deploy id | Presence/shape only. |

Acceptable sanitized evidence format:

- deployment id/version id, timestamp, source commit if visible, and route/domain name;
- screenshots cropped to show names/status only;
- migration names/status only;
- no secrets, env values beyond repo-declared non-secret vars, cookies, Authorization headers, raw logs, object keys, DB rows, or customer data.

Manual verification steps:

1. Cloudflare Workers and Pages -> each Worker -> Deployments: record latest deploy/version id, timestamp, rollback target, and deployed commit if visible.
2. Cloudflare Workers and Pages -> each Worker -> Settings: record routes, bindings, variables by name, and secret names/presence only.
3. GitHub repository -> Pages / Actions: record Pages deployment id, workflow run id, deployed commit, and whether any manual static-deploy acknowledgement was used.
4. Cloudflare D1 -> `bitbi-auth-db` -> migration history/status: record migration names/status through `0060_add_app_settings.sql` only.
5. If any deployed target does not match the reviewed commit, keep Go/No-Go `NO-GO` and open a separate operator release sequencing task.

## Worker Deploy State

| Worker | Required by release plan? | Deployed commit/version | Deploy evidence reference | Rollback target | Result |
| --- | --- | --- | --- | --- | --- |
| Auth Worker | no for current evidence diff | operator to verify live deploy id/commit | Cloudflare dashboard or sanitized deployment record pending | operator to fill | pending live verification |
| AI Worker | no for current evidence diff | operator to verify live deploy id/commit | Cloudflare dashboard or sanitized deployment record pending | operator to fill | pending live verification |
| Contact Worker | no for current evidence diff | operator to verify live deploy id/commit | Cloudflare dashboard or sanitized deployment record pending | operator to fill | pending live verification |

## Static Deploy State

| Item | Evidence reference | Result |
| --- | --- | --- |
| GitHub Pages workflow run/build id | Operator to attach sanitized GitHub Pages run/build id | pending live verification |
| Static deployed commit | Operator to verify deployed commit matches intended release | pending live verification |
| Static deploy safety guard result | Local sprint guard allowed validation-only diff; live workflow evidence pending | local passed / live pending |
| Manual acknowledgement used? If yes, exact phrase and dependency evidence recorded | No acknowledgement required for current validation-only evidence diff; operator to record if used for another release | pending if applicable |
| Admin Control Plane loads after deploy | Operator browser check pending | pending |
| Public/member pages smoke checked | Operator browser check pending | pending |

## Migration State

| Migration | Expected status | Evidence reference | Result |
| --- | --- | --- | --- |
| `0056_add_ai_folder_image_ownership_metadata.sql` | applied before dependent Auth Worker | Operator remote migration status evidence pending | pending |
| `0057_add_ai_asset_manual_review_state.sql` | applied before dependent Auth Worker | Operator remote migration status evidence pending | pending |
| `0058_add_legacy_media_reset_actions.sql` | applied before dependent Auth Worker | Operator remote migration status evidence pending | pending |
| `0059_add_data_lifecycle_completion_state.sql` | applied before dependent Auth Worker | Operator remote migration status evidence pending | pending |
| `0060_add_app_settings.sql` | latest release-contract checkpoint; applied before dependent Auth Worker | Operator remote migration status evidence pending | pending |

## Operator Notes

- No Worker deploy is performed by this template.
- No remote migration is performed by this template.
- If GitHub Pages blocks because Worker/schema dependencies are present, fix release sequencing rather than weakening the workflow.
