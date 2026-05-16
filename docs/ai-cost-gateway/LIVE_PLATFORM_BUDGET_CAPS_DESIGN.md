# Live Platform Budget Caps Design

Status: Phase 4.16 design/evidence only, preserved after Phase 4.15.1. No runtime caps are enforced by this phase, no provider route behavior changes, no cap schema is added, and no provider, Stripe, Cloudflare, GitHub, or remote migration action is performed. Phase 4.15.1 adds a separate D1-backed app-level Admin AI budget switch layer on top of the existing Cloudflare master flags; that switch control plane is not live cap enforcement.

## Why Caps Are Needed

Phase 4.15 makes already classified admin/platform provider-cost paths fail closed behind Cloudflare master runtime kill switches, and Phase 4.15.1 adds a D1/Admin UI app switch that must also be enabled. These switches are binary operator controls. They do not measure aggregate daily/monthly usage, compare usage to a configured allowance, or stop a path after accumulated platform spend crosses a threshold.

Live platform budget caps are the next control layer. They should let operators set bounded daily/monthly limits by budget scope, operation, provider/model, admin user, and source domain. Until that exists, production/live billing remains blocked and admin/platform provider-cost flags should remain off except for controlled evidence windows.

## Non-Goals For Phase 4.16

- No runtime cap enforcement.
- No D1 migration or new counter table.
- No route behavior change.
- No provider calls.
- No credit debit, credit clawback, billing mutation, Stripe call, or public pricing change.
- No member or organization-scoped route behavior change.
- No broad internal AI Worker migration.
- No production or live billing readiness claim.

## Kill Switches Vs. Budget Caps

Runtime budget kill switches answer whether a classified provider-cost path may execute at all. After Phase 4.15.1, effective execution requires the Cloudflare master flag and the D1 app switch to be enabled. Missing, false, unrecognized, or unavailable switch state blocks covered admin/platform work before provider, queue, credit, or durable-attempt work.

Live budget caps answer whether a covered path may execute after counting prior usage in a window. Caps require trustworthy, durable usage events, window accounting, operator limits, and deterministic exceeded behavior. Phase 4.16 only documents the model and exposes read-only evidence that caps are still `not_implemented`.

## Budget Scope Taxonomy

| Scope | Caps required | Owner | Target granularity | Current source of truth | Current countability | Future posture |
| --- | --- | --- | --- | --- | --- | --- |
| `platform_admin_lab_budget` | Yes | Platform admin lab | Day, month, operation, admin user, provider/model | `admin_ai_usage_attempts`, `ai_video_jobs` | Partially countable | Phase 4.17 fail-closed foundation after a central usage ledger |
| `openclaw_news_pulse_budget` | Yes | OpenClaw / News Pulse | Day, month, source domain, provider/model | `news_pulse_items` visual budget/status columns | Partially countable | Later background cap phase, likely warn-only first |
| `platform_background_budget` | Yes | Platform background jobs | Day, month, operation, source domain | None centralized today | Requires schema | Future background budget migration |
| `admin_org_credit_account` | Secondary | Selected organization plus platform operator | Day, month, organization, admin user, provider/model | `usage_events`, `ai_usage_attempts` | Countable now for debit evidence | Align with cap evidence; org credit ledger remains source of charged truth |
| `explicit_unmetered_admin` | Yes before broader use | Platform admin lab exception owner | Day, month, operation, admin user, provider/model | Safe response/caller metadata only | Metadata only | Keep switch disabled unless operator accepts risk; requires central usage events |
| `internal_ai_worker_caller_enforced` | Inherited | Calling route budget scope | Caller scope, operation, provider/model | Caller-policy metadata | Requires schema | Count through caller usage events, not AI Worker globals |

Member `member_credit_account` and organization `organization_credit_account` routes remain separate from platform caps. They continue to use member/org credit gateway semantics and are not changed by this design.

## Available Data Sources

- Charged Admin Image tests: selected-organization debit evidence in `usage_events` and `ai_usage_attempts`; provider failures remain no-charge. This is countable now for charged evidence, but not yet part of a platform cap window.
- Explicit-unmetered Admin FLUX.2 Dev: safe budget/caller metadata only, no durable usage event. A central usage event is required before aggregate caps are reliable.
- Admin Text, Embeddings, Music, Compare, and Live-Agent: `admin_ai_usage_attempts` stores metadata-only idempotency attempts, statuses, `completed_at`, and safe budget/caller/result metadata. This is partially countable, but actual provider spend is not normalized.
- Admin async video jobs: `ai_video_jobs` stores budget metadata, job status, and completion timestamps. This is partially countable.
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

No migration is added in Phase 4.16. A future additive schema can introduce these tables:

### `platform_budget_limits`

Purpose: configured operator limits.

Suggested fields: `id`, `budget_scope`, `operation_id`, `provider_family`, `model_key`, `owner_domain`, `window_kind`, `limit_units`, `limit_credits`, `mode`, `status`, `effective_at`, `expires_at`, `created_by_admin_user_id`, `metadata_json`, `created_at`, `updated_at`.

Indexes: active limits by `budget_scope/status/window_kind`, operation-specific limits, provider/model limits, effective window.

Retention/privacy: operational/audit data. Store safe identifiers only.

### `platform_budget_usage_events`

Purpose: append-only normalized usage events emitted after successful provider-cost work or safe terminal status decisions.

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

Phase 4.16 updates the read-only admin/platform budget evidence report to expose:

- `liveBudgetCapsStatus: "not_implemented"`.
- Recommended first cap scope: `platform_admin_lab_budget`.
- Countability by budget scope.
- Which paths are switch-enforced but not cap-enforced.
- Which paths currently have estimated cost units and durable completion timestamps.
- That member routes remain separate from platform caps.

The evidence report must remain bounded and sanitized and must not perform unbounded D1 scans.

## Recommended First Implementation

Phase 4.17 should implement the first narrow cap foundation for `platform_admin_lab_budget`.

Scope:

- Admin Text.
- Admin Embeddings.
- Admin Music.
- Admin Compare.
- Admin Live-Agent.
- Admin async video jobs.

Justification: these paths are already runtime-switch-enforced, use `platform_admin_lab_budget`, have durable metadata-only attempts or job rows, and are admin-only. This gives the highest immediate risk reduction without touching member/org billing behavior or background routes.

Likely requirements:

- Add the minimal central platform budget usage table(s).
- Emit one safe usage event per completed provider-cost operation.
- Count daily/monthly windows by scope and operation.
- Fail closed before provider work when cap windows are exceeded.
- Preserve existing idempotency, duplicate suppression, switch enforcement, and metadata redaction.
- Keep result replay metadata-only.

Rollback:

- Disable the existing runtime budget switches.
- Disable future cap-enforcement mode or remove active limits.
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

Production/live billing remains BLOCKED. Runtime budget kill switches from Phase 4.15 are the active admin/platform safety control. Operators should keep admin/platform AI budget flags off unless they intentionally run bounded testing and record evidence. Live cap enforcement remains future work.
