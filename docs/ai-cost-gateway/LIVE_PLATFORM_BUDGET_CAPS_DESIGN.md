# Live Platform Budget Caps Design

Current release truth: latest auth D1 migration is `0057_add_ai_asset_manual_review_state.sql`.

Status: Phase 4.16 design/evidence is preserved, Phase 4.17 implements the first narrow `platform_admin_lab_budget` cap foundation, Phase 4.18 adds read-only reconciliation/repair evidence for that foundation, Phase 4.19 adds an explicit admin-approved repair executor for selected safe candidates, Phase 4.20 adds read-only operator repair evidence reporting/export, and Phase 4.21 adds sanitized evidence archives under `AUDIT_ARCHIVE` with retention metadata. Phase 4.21 adds local migration `0055_add_platform_budget_evidence_archives.sql` and does not change runtime provider route behavior or repair execution semantics. No provider call, Stripe call, Cloudflare/GitHub mutation, remote migration, member/org billing change, credit clawback, or live billing enablement is performed by this document or by tests. Other budget scopes remain future work.

## Why Caps Are Needed

Phase 4.15 makes already classified admin/platform provider-cost paths fail closed behind Cloudflare master runtime kill switches, and Phase 4.15.1 adds a D1/Admin UI app switch that must also be enabled. These switches are binary operator controls. They do not measure aggregate daily/monthly usage, compare usage to a configured allowance, or stop a path after accumulated platform spend crosses a threshold.

Live platform budget caps are the next control layer. Phase 4.17 starts with one scope, `platform_admin_lab_budget`, and lets operators set bounded daily/monthly limits before covered admin lab provider-cost work can proceed. Production/live billing remains blocked and other admin/platform provider-cost flags should remain off except for controlled evidence windows.

## Non-Goals For Phase 4.16

- No runtime cap enforcement.
- No D1 migration or new counter table.
- No route behavior change.
- No provider calls.
- No credit debit, credit clawback, billing mutation, Stripe call, or public pricing change.
- No member or organization-scoped route behavior change.
- No broad internal AI Worker migration.
- No production or live billing readiness claim.

## Phase 4.17 Implemented Foundation

Phase 4.17 adds a narrow runtime cap foundation for `platform_admin_lab_budget` only:

- `platform_budget_limits` stores active daily/monthly operator limits for the allowlisted scope.
- `platform_budget_limit_events` stores bounded admin update evidence and idempotency conflict checks for cap changes.
- `platform_budget_usage_events` stores sanitized successful provider-cost usage evidence with daily/monthly window keys and source attempt/job de-duplication.
- Covered routes must pass the Phase 4.15 Cloudflare master switch, the Phase 4.15.1 D1 app switch, and the Phase 4.17 cap check before provider/internal AI/queue/durable-attempt work.
- Successful Admin Text, Embeddings, Music, Compare, Live-Agent, and Admin async video job completions record one bounded usage event where completion is observed.
- Missing active daily/monthly cap configuration, unavailable D1, or exceeded caps fail closed before provider-cost work.

Phase 4.17 is not customer billing, not Stripe/live billing, and does not change member or organization credit behavior. `admin_org_credit_account`, `explicit_unmetered_admin`, `openclaw_news_pulse_budget`, `platform_background_budget`, and broader internal caller scopes remain future cap work.

## Phase 4.18 Reconciliation Evidence

Phase 4.18 adds a read-only evidence layer for the Phase 4.17 `platform_admin_lab_budget` foundation. The helper and admin-only endpoint compare `platform_budget_usage_events` against successful `admin_ai_usage_attempts` and successful `ai_video_jobs`, detect duplicate/orphan/failed-source/window/unit mismatches where data supports it, and return proposed repair candidates with `actionSafety: dry_run_only`.

No repair is applied in Phase 4.18. The reconciliation layer does not mutate `platform_budget_usage_events`, `admin_ai_usage_attempts`, `ai_video_jobs`, credits, queues, billing, R2, Cloudflare, Stripe, or provider resources. A future explicit admin-approved repair executor phase is required before any write can occur.

## Phase 4.19 Admin-Approved Repair Executor

Phase 4.19 adds a narrow executor for `platform_admin_lab_budget` repair candidates. It is explicit-admin-only, requires `Idempotency-Key`, a bounded reason, and confirmation for non-dry-run execution, and records each approved non-dry-run request in `platform_budget_repair_actions`.

Executable repair is limited to `create_missing_usage_event` when local D1 evidence still proves a successful `admin_ai_usage_attempts` row or successful admin `ai_video_jobs` row and no matching `platform_budget_usage_events` row exists. The executor inserts one missing usage event with sanitized metadata and does not mutate source attempts/jobs, credits, billing, Stripe, Cloudflare, queues, or provider state.

Duplicate, orphan, failed-source, window, and missing-cost candidates are review-only in Phase 4.19. Recording a review action writes only a `platform_budget_repair_actions` audit row and does not rewrite or delete existing usage/source rows.

## Phase 4.20 Repair Evidence Report / Export

Phase 4.20 adds an admin-only, read-only operator report over `platform_budget_repair_actions`, sanitized related `platform_budget_usage_events`, bounded reconciliation summary, and cap status summary for `platform_admin_lab_budget`.

The report endpoints are:

- `GET /api/admin/ai/platform-budget-repair-report`
- `GET /api/admin/ai/platform-budget-repair-report/export?format=json`
- `GET /api/admin/ai/platform-budget-repair-report/export?format=markdown`

Reports are bounded, sanitized, and local-D1-only. They support filters for status, candidate type, requested action, dry-run flag, date range, limit, detail inclusion, and candidate snapshot inclusion. They do not apply repairs, run automatic repair, delete or rewrite repair actions, mutate `platform_budget_usage_events`, mutate source attempts/jobs, call providers, call Stripe, mutate credits, mutate Cloudflare, or change member/org billing behavior.

## Kill Switches Vs. Budget Caps

Runtime budget kill switches answer whether a classified provider-cost path may execute at all. After Phase 4.15.1, effective execution requires the Cloudflare master flag and the D1 app switch to be enabled. Missing, false, unrecognized, or unavailable switch state blocks covered admin/platform work before provider, queue, credit, or durable-attempt work.

Live budget caps answer whether a covered path may execute after counting prior usage in a window. Caps require trustworthy, durable usage events, window accounting, operator limits, and deterministic exceeded behavior. Phase 4.16 documents the model and exposes read-only design evidence; Phase 4.17 implements the first narrow `platform_admin_lab_budget` foundation while other budget scopes remain not implemented.

## Budget Scope Taxonomy

| Scope | Caps required | Owner | Target granularity | Current source of truth | Current countability | Future posture |
| --- | --- | --- | --- | --- | --- | --- |
| `platform_admin_lab_budget` | Yes | Platform admin lab | Day, month, operation, admin user, provider/model | `platform_budget_limits`, `platform_budget_usage_events`, `admin_ai_usage_attempts`, `ai_video_jobs` | Countable now for covered operations | Phase 4.17 fail-closed foundation implemented |
| `openclaw_news_pulse_budget` | Yes | OpenClaw / News Pulse | Day, month, source domain, provider/model | `news_pulse_items` visual budget/status columns | Partially countable | Later background cap phase, likely warn-only first |
| `platform_background_budget` | Yes | Platform background jobs | Day, month, operation, source domain | None centralized today | Requires schema | Future background budget migration |
| `admin_org_credit_account` | Secondary | Selected organization plus platform operator | Day, month, organization, admin user, provider/model | `usage_events`, `ai_usage_attempts` | Countable now for debit evidence | Align with cap evidence; org credit ledger remains source of charged truth |
| `explicit_unmetered_admin` | Yes before broader use | Platform admin lab exception owner | Day, month, operation, admin user, provider/model | Safe response/caller metadata only | Metadata only | Keep switch disabled unless operator accepts risk; requires central usage events |
| `internal_ai_worker_caller_enforced` | Inherited | Calling route budget scope | Caller scope, operation, provider/model | Caller-policy metadata | Requires schema | Count through caller usage events, not AI Worker globals |

Member `member_credit_account` and organization `organization_credit_account` routes remain separate from platform caps. They continue to use member/org credit gateway semantics and are not changed by this design.

## Available Data Sources

- Charged Admin Image tests: selected-organization debit evidence in `usage_events` and `ai_usage_attempts`; provider failures remain no-charge. This is countable now for charged evidence, but not yet part of a platform cap window.
- Explicit-unmetered Admin FLUX.2 Dev: safe budget/caller metadata only, no durable usage event. A central usage event is required before aggregate caps are reliable.
- Admin Text, Embeddings, Music, Compare, and Live-Agent: `admin_ai_usage_attempts` stores metadata-only idempotency attempts, statuses, `completed_at`, and safe budget/caller/result metadata. Phase 4.17 records normalized estimated-unit usage events after successful completion for these routes.
- Admin async video jobs: `ai_video_jobs` stores budget metadata, job status, and completion timestamps. Phase 4.17 checks caps before queueing and records normalized estimated-unit usage when the queue consumer marks a job succeeded.
- OpenClaw / News Pulse visuals: `news_pulse_items` stores visual budget metadata/status and visual lifecycle timestamps. This is partially countable for ready/succeeded visuals but not centralized.
- Internal AI Worker caller-enforced routes: counting must happen at the Auth Worker caller scope. Internal service routes should not own independent platform caps until every caller has a durable usage event.

## Candidate Cap Dimensions

- Per day and per month.
- Per operation id.
- Per budget scope.
- Per admin user for admin lab routes.
- Per provider family and model key.
- Per source domain for background/news generation.
- Per selected organization for admin-org-credit evidence.
- Per source component for caller-enforced internal routes.

The first implementation should use estimated units/credits where actual provider usage is unavailable. It should store enough metadata to later reconcile actual provider costs without storing raw prompts, messages, lyrics, embeddings, provider bodies, secrets, cookies, auth headers, Stripe data, Cloudflare tokens, or private R2 keys.

## Future Data Model

No migration is added in Phase 4.16. Phase 4.17 implements the first narrow subset through local additive migration `0053_add_platform_budget_caps.sql`. Phase 4.19 adds `0054_add_platform_budget_repair_actions.sql` for admin-approved repair audit rows. Phase 4.20 adds read-only reporting/export over that table and does not add schema. Phase 4.21 adds `0055_add_platform_budget_evidence_archives.sql` for sanitized archive metadata and private archive object tracking. Later phases can extend this schema or add derived window/override tables if needed.

### `platform_budget_limits`

Purpose: configured operator limits. Phase 4.17 implements the scoped form with `budget_scope`, `window_type`, `limit_units`, `mode`, `status`, effective timestamps, bounded reason/metadata, and updater ids.

Suggested fields: `id`, `budget_scope`, `operation_id`, `provider_family`, `model_key`, `owner_domain`, `window_kind`, `limit_units`, `limit_credits`, `mode`, `status`, `effective_at`, `expires_at`, `created_by_admin_user_id`, `metadata_json`, `created_at`, `updated_at`.

Indexes: active limits by `budget_scope/status/window_kind`, operation-specific limits, provider/model limits, effective window.

Retention/privacy: operational/audit data. Store safe identifiers only.

### `platform_budget_usage_events`

Purpose: append-only normalized usage events emitted after successful provider-cost work or safe terminal status decisions. Phase 4.17 implements bounded usage events for `platform_admin_lab_budget` with operation key, source route, actor summary, estimated units, daily/monthly window keys, source attempt/job ids, idempotency hash, and sanitized metadata.

Suggested fields: `id`, `budget_scope`, `operation_id`, `source_route`, `source_component`, `admin_user_id`, `owner_domain`, `provider_family`, `model_key`, `estimated_cost_units`, `estimated_credits`, `actual_cost_units`, `actual_credits`, `result_status`, `billable`, `attempt_id`, `job_id`, `news_pulse_item_id`, `request_fingerprint_hash`, `occurred_at`, `metadata_json`, `created_at`.

Indexes: scope/window, operation/window, provider/model/window, attempt/job/item unique references.

Retention/privacy: audit and cost-control data. Store hashes and safe metadata only; no raw inputs or provider payloads.

### `platform_budget_windows`

Purpose: materialized window totals for fast fail-closed checks.

Suggested fields: `id`, `budget_scope`, `operation_id`, `provider_family`, `model_key`, `window_kind`, `window_start`, `window_end`, `consumed_estimated_units`, `consumed_estimated_credits`, `consumed_actual_units`, `consumed_actual_credits`, `status`, `updated_at`.

Indexes: unique scope/operation/provider/window key and active exceeded windows.

Retention/privacy: derived operational data, rebuildable from usage events.

### `platform_budget_overrides`

Purpose: bounded operator overrides for cap-exceeded conditions.

Suggested fields: `id`, `limit_id`, `window_id`, `budget_scope`, `operation_id`, `mode`, `reason_code`, `safe_note`, `approved_by_admin_user_id`, `expires_at`, `created_at`.

Indexes: active overrides by scope/operation/window.

Retention/privacy: audit data. Notes must be safe and should not include raw prompts, secrets, tokens, customer billing details, or provider payloads.

## Cap-Exceeded Behavior

Recommended future behavior:

- Fail closed before provider/queue/credit/durable-attempt work for admin lab routes.
- Skip background News Pulse visual work safely without affecting public reads or deleting existing visuals.
- Return safe admin-only JSON for admin routes with `code: "platform_budget_cap_exceeded"`.
- Include budget scope, operation id, provider/model summary, window kind, and safe correlation id.
- Do not mutate credits, Stripe, Cloudflare, provider resources, or unrelated records when a cap blocks work.
- Allow bounded operator overrides only through explicit admin-only audit metadata.

## Evidence And Reporting

Phase 4.16 updates the read-only admin/platform budget evidence report to expose design/countability status. Phase 4.17 extends that report for the first implemented foundation:

- `liveBudgetCapsStatus: "platform_admin_lab_budget_foundation"`.
- Recommended first cap scope: `platform_admin_lab_budget`.
- Cap-enforced operation ids for covered admin lab operations.
- Safe daily/monthly limit and usage summaries when D1 is available.
- Countability by budget scope.
- Which paths are cap-enforced versus still only switch-enforced.
- Which paths currently have estimated cost units and durable completion timestamps.
- That member routes remain separate from platform caps.

The evidence report must remain bounded and sanitized and must not perform unbounded D1 scans.

## Recommended First Implementation

Phase 4.17 implements the first narrow cap foundation for `platform_admin_lab_budget`.

Scope:

- Admin Text.
- Admin Embeddings.
- Admin Music.
- Admin Compare.
- Admin Live-Agent.
- Admin async video jobs.

Justification: these paths are already runtime-switch-enforced, use `platform_admin_lab_budget`, have durable metadata-only attempts or job rows, and are admin-only. This gives the highest immediate risk reduction without touching member/org billing behavior or background routes.

Implemented requirements:

- Add the minimal central platform budget usage table(s).
- Emit one safe usage event per completed provider-cost operation.
- Count daily/monthly windows by scope and operation.
- Fail closed before provider work when cap windows are exceeded.
- Preserve existing idempotency, duplicate suppression, switch enforcement, and metadata redaction.
- Keep result replay metadata-only.

Rollback:

- Disable the existing runtime budget switches.
- Disable app-level D1 switches or disable/remove active limits.
- Keep append-only usage events for audit unless a future retention policy says otherwise.

## Testing Strategy

Future implementation tests should prove:

- Cap checks occur before provider, queue, credit, and durable-attempt work.
- Same idempotency key does not double-count.
- Failed provider work is not counted as successful spend unless a future policy explicitly records wasted-provider attempts separately.
- Background skips do not affect public reads.
- Admin JSON errors are sanitized.
- No member/org route behavior changes.
- Strict policy checks fail if a route claims cap enforcement without usage-event evidence.

## Production Readiness

Production/live billing remains BLOCKED. Runtime budget kill switches from Phase 4.15, D1 app switches from Phase 4.15.1, the Phase 4.17 `platform_admin_lab_budget` cap foundation, Phase 4.18 reconciliation evidence, Phase 4.19 admin-approved repair actions, Phase 4.20 repair evidence reports/exports, and Phase 4.21 sanitized evidence archives are layered safety/evidence controls, not customer billing. Phase 4.21 archives are operator-approved snapshots stored in `AUDIT_ARCHIVE` under `platform-budget-evidence/`; archive creation applies no repairs, performs no provider/Stripe/credit/source mutation, and cleanup is bounded plus approved-prefix-only. Operators should keep admin/platform AI budget flags off unless they intentionally run bounded testing, apply migrations through `0055`, configure daily/monthly caps, and record evidence. Other scopes remain future work.
