# Admin And Platform AI Budget Policy

Date: 2026-05-18

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

Status: current policy summary. This document is not a phase log and does not approve production readiness, live billing readiness, customer billing, or live provider use.

## Current Verdict

- AI cost gateway controls exist for implemented member image/music/video scopes.
- Admin/platform budget controls exist for selected admin/platform provider-cost scopes.
- `platform_admin_lab_budget` has the first daily/monthly cap foundation, reconciliation, repair, report/export, and sanitized archive evidence tooling.
- Platform budget controls are internal spend controls and evidence controls. They are not Stripe billing readiness, customer invoicing, credit refunds, or legal/accounting approval.
- Production readiness remains BLOCKED.
- Live billing readiness remains BLOCKED.

## Covered Scopes

| Scope | Current purpose | Current state | Remaining gap |
| --- | --- | --- | --- |
| `member_credit_account` | Member personal image/music/video credits | Gateway reservation, idempotency, duplicate-provider suppression, and exactly-once success debit exist for implemented routes. | Live billing/canary evidence still required. |
| `organization_credit_account` | Organization AI usage | Existing org attempts/credit policy remain in place. | Not the focus of platform budget caps. |
| `admin_org_credit_account` | Admin-initiated paid image tests against selected org credits | Charged image branches require selected org, idempotency, credit checks/debits, and safe budget metadata. | Live billing readiness is still blocked. |
| `platform_admin_lab_budget` | Platform-owned admin lab/testing provider spend | Metadata, caller-policy propagation, runtime switches, D1 app switches, daily/monthly caps, reconciliation, repair, reports, and archives exist for covered operations. | Operator/live evidence and remaining edge-scope review are required. |
| `openclaw_news_pulse_budget` | OpenClaw/News Pulse visuals | Safe metadata/status and runtime switch controls exist. | Aggregate cap enforcement remains future work. |
| `platform_background_budget` | Other platform/background jobs | Policy taxonomy exists. | Needs dedicated schema/usage events before cap claims. |
| `explicit_unmetered_admin` | Intentional uncharged admin exceptions | Classified and switch-controlled for narrow allowed branches. | Keep disabled unless operator explicitly accepts bounded test risk. |
| `internal_ai_worker_caller_enforced` | Internal AI Worker routes whose caller owns budget enforcement | Provider-cost internal routes require caller-policy metadata before provider execution. | Aggregate cap accounting for this scope remains future work. |

## Current Controls

- Provider-cost routes must be classified as member, organization, admin-org-credit, platform-budgeted, caller-enforced, explicit-unmetered, or blocked.
- Budget metadata is sanitized and must not store raw prompts, provider bodies, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, or private R2 keys.
- Admin/platform routes use default-disabled runtime budget switches where implemented.
- Covered admin/platform routes require both the Cloudflare master switch and the D1 app switch before provider/queue/durable-attempt work.
- Covered `platform_admin_lab_budget` routes check active caps before provider-cost work and record bounded usage evidence after successful completion where completion is observable.
- Admin AI usage attempts provide metadata-only idempotency for covered admin text, embeddings, music, compare, and live-agent flows.
- Admin async video jobs store safe budget metadata and count through the platform budget foundation.
- Sync admin video debug remains disabled by default and is not a normal budgeted path.
- Budget evidence, reconciliation, repair reports, exports, and archives are admin-only and sanitized.

## Current Repair And Archive Model

- Reconciliation is read-only and proposes candidate evidence issues.
- Repair execution is explicit admin-approved only.
- Executable repair is limited to narrow missing-usage-event creation when local D1 source evidence proves a successful covered source row and no matching usage event exists.
- Review-only repair actions may record audit decisions without rewriting usage/source rows.
- Evidence archive creation stores sanitized snapshots in private `AUDIT_ARCHIVE` under the `platform-budget-evidence/` prefix.
- Archive cleanup must remain bounded to the approved prefix and must not delete unrelated R2 objects.

## Current Data Model

Relevant additive auth migrations for this budget layer:

- `0049_add_admin_video_job_budget_metadata.sql`
- `0050_add_news_pulse_visual_budget_metadata.sql`
- `0051_add_admin_ai_usage_attempts.sql`
- `0052_add_admin_runtime_budget_switches.sql`
- `0053_add_platform_budget_caps.sql`
- `0054_add_platform_budget_repair_actions.sql`
- `0055_add_platform_budget_evidence_archives.sql`

Remote migration application is not proven by this document. Operators must verify applied migrations before deploying dependent Auth Worker code.

## Current Admin Surfaces

- Budget evidence endpoint and Admin Control Plane visibility.
- Budget switch list/update controls for D1 app switches.
- Platform Budget Caps panel for configured `platform_admin_lab_budget` limits.
- Reconciliation and repair evidence panels.
- Explicit repair controls for approved safe candidates.
- Repair report/export and evidence archive panels.

These surfaces cannot edit Cloudflare variables, call Stripe, call providers, mutate customer billing, expose secrets, expose Cloudflare values, or approve production readiness by themselves.

## Required Safety Properties

- Block unclassified provider-cost admin branches before provider execution.
- Deny disabled or unavailable budget switch/cap paths before provider, queue, credit, or durable-attempt work.
- Preserve member/org credit behavior unless a task explicitly changes that scope.
- Never store raw idempotency keys in responses or evidence.
- Keep result replay metadata-only where full result replay is not proven safe.
- Keep operator repair/reset actions explicit, bounded, audited, idempotent, and admin/MFA/same-origin protected.

## Current Gaps

- Other platform budget scopes are not fully cap-enforced.
- Internal AI Worker provider-cost routes fail closed without caller policy; aggregate cap accounting for `internal_ai_worker_caller_enforced` remains future work.
- Admin result replay remains metadata-only for several admin lab routes.
- Live/manual Cloudflare evidence is still required before production claims.
- Platform budget controls do not prove Stripe billing, refunds, invoices, taxes, customer credits, or legal/accounting readiness.

## Checks

```bash
npm run check:ai-cost-policy
npm run test:ai-cost-policy
npm run test:ai-cost-operations
npm run test:ai-cost-gateway
npm run test:admin-platform-budget-policy
npm run test:admin-platform-budget-evidence
npm run report:ai-budget-evidence
```

These are local/repository checks. They do not call real providers, Stripe, or Cloudflare APIs and do not prove live readiness without operator evidence.
