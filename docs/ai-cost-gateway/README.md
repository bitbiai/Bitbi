# AI Cost Gateway

Date: 2026-05-17

Status: current index for AI cost controls. Detailed phase history belongs in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` and historical phase reports, not here.

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Production readiness remains BLOCKED. Live billing readiness remains BLOCKED.

## What Exists Now

- Member image, music, and video generation use the AI Cost Gateway pattern with required idempotency, pre-provider reservation, duplicate-provider suppression, safe replay/replay-unavailable behavior, exactly-once debit after success, and no-charge provider failure paths.
- Org-scoped image/text routes keep their established organization credit policy and usage-attempt behavior.
- Charged Admin Image tests use selected-organization credits and `admin_org_credit_account` budget metadata for priced models.
- Admin Image branches are classified: charged, explicit unmetered, or blocked before provider execution.
- Admin Text, Embeddings, Music, Compare, Live-Agent, and Admin async video jobs are covered by scoped admin/platform budget metadata, caller-policy propagation where applicable, durable metadata-only idempotency where applicable, runtime budget switches, D1 app switches, and the first `platform_admin_lab_budget` cap foundation.
- OpenClaw/News Pulse visuals have `openclaw_news_pulse_budget` metadata/status controls and runtime switch enforcement; live cap enforcement for that scope remains future work.
- Phase 4.18 through 4.21 add read-only reconciliation, explicit admin-approved repair, repair report/export, and sanitized evidence archives for `platform_admin_lab_budget`.

## Still Not Complete

- Other budget scopes are not fully cap-enforced.
- Remaining baseline-allowed internal AI Worker routes are not all migrated to full budget/cap enforcement.
- Admin result replay remains metadata-only for several admin lab routes.
- Platform budget evidence still requires operator verification before any production/live claim.
- This system is not customer billing, Stripe billing, credit clawback, or production readiness.

## Main Docs

| Doc | Purpose |
| --- | --- |
| `AI_COST_GATEWAY_DESIGN.md` | Target gateway lifecycle and adapter contract. |
| `AI_COST_ROUTE_INVENTORY.md` | Provider-cost route inventory. |
| `AI_COST_GATEWAY_ROADMAP.md` | Scoped implementation roadmap. |
| `ADMIN_PLATFORM_BUDGET_POLICY.md` | Admin/platform budget policy, scopes, switch model, and evidence model. |
| `LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md` | Cap design plus current first-scope foundation. |
| `MEMBER_MUSIC_COST_DECOMPOSITION.md` | Member music operation decomposition. |
| `ADMIN_TEXT_EMBEDDINGS_IDEMPOTENCY_DESIGN.md` | Admin text/embeddings durable metadata-only attempt design. |
| `ADMIN_LIVE_AGENT_BUDGET_FLOW_AUDIT.md` | Admin Live-Agent audit and implemented enforcement summary. |
| `ADMIN_SYNC_VIDEO_DEBUG_RETIREMENT_AUDIT.md` | Sync video debug retirement decision. |

## Main Code And Checks

- Registry: `workers/auth/src/lib/ai-cost-operations.js`
- Gateway helpers: `workers/auth/src/lib/ai-cost-gateway.js`
- Admin/platform budget helpers: `workers/auth/src/lib/admin-platform-budget-policy.js`
- Runtime switches: `workers/auth/src/lib/admin-platform-budget-switches.js`
- Platform caps: `workers/auth/src/lib/platform-budget-caps.js`
- Reconciliation: `workers/auth/src/lib/platform-budget-reconciliation.js`
- Repair: `workers/auth/src/lib/platform-budget-repair.js`
- Report/export: `workers/auth/src/lib/platform-budget-repair-report.js`
- Archives: `workers/auth/src/lib/platform-budget-evidence-archive.js`
- Baseline: `config/ai-cost-policy-baseline.json`

Run:

```bash
npm run test:ai-cost-gateway
npm run test:ai-cost-policy
npm run test:ai-cost-operations
npm run test:admin-platform-budget-policy
npm run test:admin-platform-budget-evidence
npm run check:ai-cost-policy
npm run report:ai-budget-evidence
```

## Operator Notes

- Budget switches are not budget caps.
- D1 app switches cannot override disabled or missing Cloudflare master flags.
- `platform_admin_lab_budget` caps are not customer billing.
- Repair execution is explicit admin-approved only; report/export/archive flows do not apply repairs.
- Evidence archives are sanitized snapshots under `AUDIT_ARCHIVE` prefix `platform-budget-evidence/`.
- Do not add full phase history to this README. Add detailed history to `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`.
