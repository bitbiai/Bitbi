# Phase 2-N Organization Context And Credit Debit Visibility Report

Date: 2026-04-29

## Scope

Phase 2-N adds a narrow organization-context control surface so eligible users can see which organization owns credits, select the active organization used by the Credits page and Admin AI Lab, and verify platform-admin Admin AI image-test debits against the intended organization.

This phase does not add public billing, subscriptions, invoices, customer portal, Stripe Tax, refunds, chargeback reversal, role self-escalation, member-facing image pricing changes, or new non-admin AI access.

## Files Changed

- `account/organization.html`
- `account/profile.html`
- `css/account/organization.css`
- `css/account/profile.css`
- `js/pages/organization/main.js`
- `js/pages/credits/main.js`
- `js/pages/profile/main.js`
- `js/pages/admin/ai-lab.js`
- `js/shared/active-organization.js`
- `js/shared/auth-api.js`
- `workers/auth/src/routes/orgs.js`
- `workers/auth/src/routes/admin-ai.js`
- `workers/auth/src/lib/stripe-billing.js`
- `workers/auth/src/app/route-policy.js`
- `scripts/check-route-policies.mjs`
- `tests/helpers/auth-worker-harness.js`
- `tests/workers.spec.js`
- `tests/auth-admin.spec.js`

Documentation updated:

- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `AUDIT_ACTION_PLAN.md`
- `AUDIT_NEXT_LEVEL.md`
- `PHASE2M_ADMIN_BFL_IMAGE_TEST_CREDIT_PRICING_REPORT.md`
- `workers/auth/CLAUDE.md`

## Migration

No migration was added. Phase 2-N uses the existing organization, membership, billing, credit ledger, usage event, AI usage attempt, and checkout/session tables. Latest auth migration remains `0040_add_live_stripe_credit_pack_scope.sql`.

## New Page Route

- `/account/organization.html`

The static page shell can be loaded directly, but the page renders a safe unauthorized state unless the current user is a platform/global admin or an active owner of at least one organization.

## New API Route

- `GET /api/orgs/:id/organization-dashboard`

Authorization:

- Platform/global admin may inspect any active organization visible through the admin organization API.
- Active organization owner may inspect their own organization.
- Organization admin, member, viewer, normal user, non-member, and unauthenticated users are denied unless they are also platform/global admins.

Response includes only sanitized fields:

- Organization id/name/slug/status.
- Current user access scope.
- Current organization role.
- Whether platform-admin Admin AI image tests are available.
- Credit balance summary.
- Recent sanitized credit ledger entries.
- Recent sanitized `admin_ai_image_test` debits.
- Active member summaries where existing admin/owner patterns allow.
- Warnings, including when a platform admin is not an owner of the selected organization.

The response does not expose secrets, raw webhook payloads, raw provider responses, raw prompts, idempotency hashes, request fingerprints, service-auth metadata, or SQL/debug metadata.

## Access Model

Visible and usable:

- Platform/global admins.
- Active organization owners.

Not visible or usable:

- Unauthenticated users.
- Normal users without eligible organizations.
- Organization admins unless also platform/global admins.
- Organization members.
- Organization viewers.

The frontend link is hidden by default until eligibility is known. Backend authorization remains authoritative.

## Organization Selection Behavior

Phase 2-N adds a shared frontend helper using:

- localStorage key: `bitbi.activeOrganizationId`

Behavior:

- localStorage is display/convenience only.
- Backend routes still enforce organization authorization and role checks.
- If exactly one eligible organization exists, the frontend auto-selects it.
- If multiple eligible organizations exist, the user must select one.
- If the stored organization id is no longer accessible, the helper clears it.
- Selection is shared by `/account/organization.html`, `/account/credits.html`, and the platform-admin Admin AI Lab BFL image-test flow.

## Solo Admin Recommended Setup

For the intended solo-admin BITBI workflow:

- The user is a platform/global admin.
- The `BITBI` organization exists and is active.
- The same user is an active owner of the `BITBI` organization.
- `BITBI` is selected as the active organization on `/account/organization.html`.
- `/account/credits.html` and Admin AI Lab use the same selected organization id.

Credits belong to organizations, not to platform-admin users. Platform admin access alone does not contain credits. If the platform admin is not an owner of the selected organization, the Organization page shows a warning and does not silently escalate roles.

## Admin AI Lab Integration

For charged Black Forest Labs Admin AI image tests:

- The selected active organization is sent as `organization_id`.
- If no organization is selected, the UI and backend fail before provider execution with: `Select an organization before running this charged image test.`
- The backend still requires platform/global admin, `Idempotency-Key`, server-side model cost calculation, sufficient organization credits, and existing usage-attempt reservation/finalization behavior.
- After successful charged image tests, the Admin AI Lab refreshes the selected organization balance.
- Success metadata includes safe diagnostics: organization id/name, charged credits, model id, ledger entry id when available, usage event id when available, usage attempt id, idempotency status, and balance before/after.

The frontend cost and organization display are not trusted for billing. The server remains authoritative.

## Credit Debit Visibility

`/account/organization.html` and `/account/credits.html` now share the selected organization context. The Organization page shows recent sanitized ledger rows and recent `admin_ai_image_test` debits when the existing credits dashboard API exposes them.

Expected examples:

- Starting balance: 5,000 credits.
- Successful Flux 1 schnell admin image test: balance decreases to 4,999.
- Successful Flux 2 klein 9B admin image test: balance decreases by 10.

## Route Policy

Route policy metadata now includes `GET /api/orgs/:id/organization-dashboard` as a sensitive authenticated read requiring platform-admin-or-owner access. The Admin AI image test policy remains platform-admin-only and charged only for the supported BFL image-test models.

## Validation

Validation passed on 2026-04-29:

- `git diff --check`
- `npm run check:js`
- `npm run check:route-policies`
- `npm run test:workers`
- `npm run test:release-compat`
- `npm run test:release-plan`
- `npm run validate:release`
- `npm run test:cloudflare-prereqs`
- `npm run validate:cloudflare-prereqs` (live Cloudflare validation skipped; production deploy remains blocked)
- `npm run check:worker-body-parsers`
- `npm run check:data-lifecycle`
- `npm run check:admin-activity-query-shape`
- `npm run test:operational-readiness`
- `npm run check:operational-readiness`
- `npm run test:static`
- `npm run test:asset-version`
- `npm run validate:asset-version`
- `npm run build:static`
- `npm run release:preflight`

Targeted Worker and static tests were added for the new organization dashboard, active organization selection, Admin AI Lab selected-organization behavior, and safe debit diagnostics.

## Remaining Risks

- localStorage is only a frontend convenience. It cannot and does not enforce authorization.
- Platform admins who are not organization owners can inspect/select organizations through admin APIs, but credits still belong to the selected organization.
- No role self-escalation flow was added; a platform admin who should also be organization owner still needs a controlled admin membership flow or one-time operator D1 fix.
- Staging/live verification was not performed by Codex.
- Full tenant-owned asset migration remains incomplete.

## Non-Goals

- No public billing.
- No subscriptions.
- No invoices.
- No customer portal.
- No Stripe Tax.
- No refunds or chargeback reversal.
- No role self-escalation.
- No member-facing image pricing change.
- No admin image-test access for organization owners/admins/members/viewers unless they are platform/global admins.
- No production readiness claim.
