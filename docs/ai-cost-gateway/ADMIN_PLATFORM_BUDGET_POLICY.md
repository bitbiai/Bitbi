# Admin And Platform AI Budget Policy

Date: 2026-05-15

Status: Phase 4.2 contract/helper foundation. Phase 4.1 converted the Phase 3.9 known-gap baseline into a concrete budget policy model for provider-cost AI flows that are not normal member-credit routes. Phase 4.2 adds a pure helper contract in `workers/auth/src/lib/admin-platform-budget-policy.js` plus deterministic tests; it does not change runtime behavior, migrate admin AI, migrate OpenClaw/News Pulse, migrate internal AI Worker routes, call providers, mutate billing, add migrations, deploy, or prove production/live billing readiness.

## Scope

Covered provider-cost classes:

- Admin AI text, image, embeddings, music, compare, live-agent, sync video debug, and async video jobs.
- Charged admin Black Forest Labs image tests that already debit selected organization credits.
- Platform/background AI jobs, including OpenClaw/News Pulse visual generation and scheduled visual backfill.
- Internal AI Worker routes that are service-only and rely on caller-side enforcement.
- Generated music cover/background cover policy when it is discussed outside the member music bundle.

Non-goals:

- No runtime budget enforcement.
- No admin route migration.
- No D1 schema.
- No Admin UI.
- No provider, Stripe, Cloudflare, GitHub, DNS, WAF, secret, deployment, or live-billing action.

## Phase 4.2 Helper Contract

`workers/auth/src/lib/admin-platform-budget-policy.js` is the reusable target contract for future admin/platform AI budget migrations. It is pure and not imported by current runtime routes in this phase.

Exports:

- `ADMIN_PLATFORM_BUDGET_POLICY_VERSION`
- budget scope constants matching the taxonomy below
- budget action/status constants
- `AdminPlatformBudgetPolicyError`
- `normalizeAdminPlatformBudgetOperation(input)`
- `buildAdminPlatformBudgetFingerprint(input)`
- `buildAdminPlatformBudgetAuditFields(input)`
- `classifyAdminPlatformBudgetPlan(input)`
- `validateAdminPlatformKillSwitchConfig(input)`

The helper validates budget scope, actor/domain ownership, provider-cost idempotency targets, kill-switch metadata, explicit unmetered-admin justification, and caller-enforced exemptions. It builds deterministic fingerprints with sensitive fields omitted and prompt-like fields hashed inside the fingerprint payload. It builds allowlisted audit fields only and never includes raw prompts, lyrics, provider request bodies, cookies, auth headers, tokens, Stripe data, Cloudflare tokens, or private R2 keys.

Plan statuses are target planning states only: `ready_for_budget_check`, `requires_kill_switch`, `blocked_by_policy`, `caller_enforced`, `explicit_unmetered`, `platform_budget_review`, `admin_org_credit_required`, and `invalid_config`. A later runtime phase must still add route-level auth, MFA, CSRF, rate limits, body limits, D1 state, queue safety, provider-call suppression, and budget finalization before any provider-cost route is considered migrated.

## Budget Scope Taxonomy

| Scope | Spend owner | Credits debited | Admin-visible budget required | Kill switch required | Idempotency target | Replay target | Operator review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `member_credit_account` | Member | Yes | No | Yes | Mandatory | Expected | No |
| `organization_credit_account` | Organization | Yes | No | Yes | Mandatory | Expected | No |
| `admin_org_credit_account` | Selected organization for admin-initiated paid tests | Yes | Yes | Yes | Mandatory | Metadata replay at minimum | Yes |
| `platform_admin_lab_budget` | Platform admin lab / internal testing budget | No member credits | Yes | Yes | Mandatory unless an explicit unmetered exception is recorded | Operation-dependent | Yes |
| `platform_background_budget` | Platform background jobs | No member credits | Yes | Yes | Deterministic job key | Durable result/status replay | Yes |
| `openclaw_news_pulse_budget` | OpenClaw / News Pulse platform budget | No member credits | Yes | Yes | Deterministic item/job key | Durable thumbnail/status replay | Yes |
| `internal_ai_worker_caller_enforced` | Caller route or queue job | Delegated | Yes at caller | Service route delegates to caller | Delegated to caller | Delegated to caller | Yes |
| `explicit_unmetered_admin` | Explicit temporary admin exception | No | Yes | Yes | Optional only with documented exception | Usually disabled | Yes |
| `external_provider_only` | External provider / not billed by BITBI | No | Usually no | Yes | Caller-dependent | Caller-dependent | Yes if BITBI initiates calls |

Policy rule: new provider-cost routes must use one of these scopes in the operation registry and either be gateway-enforced or be explicitly listed in `config/ai-cost-policy-baseline.json` with a temporary allowance reason, kill-switch target or exemption, future enforcement path, severity, and owner/domain.

## Flow Policy Matrix

| Flow class | Budget owner | Current cost behavior | Current idempotency | Target behavior | Failure/replay policy | Limits and kill switch | Future tests | Rollout phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin text test | `platform_admin_lab_budget` | Admin-only provider call, implicit unmetered platform spend. | Not required by route policy. | Explicit platform lab budget metadata, deterministic idempotency or explicit one-shot exception, safe model/cost metadata. | No member charge; provider failure records no budget finalization; replay may be disabled if no result is persisted. | Daily/monthly admin lab budget, per-admin rate cap, admin AI kill switch. | Missing key/duplicate/conflict, no provider on budget denial, sanitized telemetry. | Phase 4.2 helper done; later narrow route migration. |
| Charged admin BFL image tests | `admin_org_credit_account` | Existing selected-org credit debit for priced BFL image tests. | Required. | Preserve org-credit debit, add explicit admin budget policy metadata, budget reason, and better replay/finalization classification. | No charge on provider failure; metadata-only replay remains acceptable until full output replay is designed. | Existing org balance plus admin BFL model allowlist/kill switch. | Existing charge tests plus policy metadata and no unmetered fallback. | Phase 4.3. |
| Unmetered admin image branch | `platform_admin_lab_budget` | Admin-only provider call for unpriced models, no debit. | Partial/route-dependent. | Either disable unpriced models or classify as platform lab budget with limits and kill switch. | No credit debit; replay disabled unless result persisted safely. | Model allowlist, per-admin daily/monthly lab budget, kill switch. | Unpriced model budget denial and no provider call. | Phase 4.3 or later. |
| Admin embeddings | `platform_admin_lab_budget` | Admin-only provider call, not product-facing. | Not required. | Explicit lab budget or remove/disable if unused. | No replay required; sanitized telemetry only. | Low daily cap and kill switch. | Route remains admin-only, no secrets/raw vectors. | Later narrow migration or removal. |
| Admin music test | `platform_admin_lab_budget` | Admin-only MiniMax music provider spend. | Not required. | Mandatory idempotency and platform lab budget reservation before provider call. | No member debit; provider failure releases budget reservation; replay is metadata-only or disabled. | Tight daily/monthly cap, route kill switch. | No provider on missing key/budget denial, no duplicate spend. | Later narrow migration. |
| Admin compare | `platform_admin_lab_budget` | Multi-provider text calls can fan out. | Not required. | One parent compare budget reservation with per-model child telemetry. | Partial model failure records partial provider spend; no member debit. | Per-request model count cap, daily/monthly cap, kill switch. | Fanout budget cap, partial failure telemetry. | Later narrow migration. |
| Admin live-agent | `platform_admin_lab_budget` | Streaming provider spend until stream ends. | Not request-idempotent today. | Stream-session budget lease with max duration/token estimate and stop reason. | No replay; final telemetry records duration/token/provider status. | Stream duration cap, per-admin daily/monthly cap, kill switch. | Stream cap enforcement and sanitized logs. | Later narrow migration. |
| Admin sync video debug | `platform_admin_lab_budget` | Default-disabled debug route can spend video provider budget if enabled. | Not required. | Keep disabled by default; require emergency budget flag, idempotency, and runbook if retained. | No replay unless persisted; no member debit. | `ALLOW_SYNC_VIDEO_DEBUG` plus explicit budget flag. | Disabled-by-default, no provider without both flags. | Later narrow migration or removal. |
| Admin async video jobs | `platform_admin_lab_budget` with internal caller-enforced subroutes | Job rows provide idempotency and queue state but no explicit budget reservation. | Job create requires `Idempotency-Key`; internal tasks inherit. | Parent admin video budget reservation before provider task create; internal task create/poll tied to job budget state. | Task create response-loss must not create duplicate provider tasks; polling tied to persisted task id. | Per-admin job/day and platform monthly cap; queue kill switch. | Duplicate delivery, response-loss, provider task retry, no budget double-finalization. | Phase 4.4. |
| News Pulse/OpenClaw visuals | `openclaw_news_pulse_budget` | Visual rows/status suppress duplicate active work, no budget cap. | HMAC ingest nonce plus item status; not budget idempotency. | Deterministic item-level budget key, status-based suppression, per-batch and daily/monthly platform cap. | Ready thumbnail is durable replay; failed rows retry only within attempt cap and budget. | Visual generation kill switch, batch cap, daily/monthly cap. | No provider when cap/kill switch blocks, no duplicate item spend. | Phase 4.5. |
| Scheduled/backfill visual jobs | `openclaw_news_pulse_budget` or `platform_background_budget` | Scheduled handler can backfill missing/failed visuals. | Status/attempt caps only. | Scheduled budget window with deterministic item keys and bounded batch reservations. | Existing ready thumbnails prevent regeneration; failed rows bounded. | Scheduled kill switch and budget window. | Batch cap and budget-denial tests. | Phase 4.5. |
| Generated music cover/background cover | `member_credit_account` today; `platform_background_budget` only if future policy changes | Phase 3.7 includes cover in parent member music bundle. | Parent member music idempotency. | Keep inside parent member music bundle unless product explicitly changes it; if split, use platform/background or member sub-budget with separate evidence. | Cover failure after audio success must not double debit. | Parent music caps today. | Preserve no separate charge and safe cover status. | No Phase 4.2 runtime work. |
| Internal AI Worker routes | `internal_ai_worker_caller_enforced` | Service-only routes call providers and rely on auth-worker callers. | Inherited/delegated. | Internal routes remain service-only; callers must pass operation id/budget metadata before internal worker executes provider work. | Replay/failure policy belongs to caller; internal route returns safe provider result/status only. | Service binding only, caller kill switch, no public exposure. | Unknown caller rejected in future, no public route, no secret leakage. | Phase 4.6. |
| Derivative/backfill flows | Not AI provider-cost today unless future route calls provider | Current image derivatives use transforms/R2, not AI provider calls. | Queue/job leases. | Keep outside AI provider budget guard unless provider-call patterns appear; storage/transform cost should be tracked separately. | No AI provider replay needed. | Queue limits and transform/storage budgets. | Guard catches any future provider call. | Outside Phase 4.2. |

## Operation Mapping

Admin and platform operation metadata is now explicit in `workers/auth/src/lib/ai-cost-operations.js`; known temporary gaps are mirrored in `config/ai-cost-policy-baseline.json`. Phase 4.2 adds helper validation for the future contract, but this mapping remains policy metadata only and does not change request handling.

| Operation / route | Target budget scope | Current status | Target phase |
| --- | --- | --- | --- |
| `/api/admin/ai/test-text` / `admin.text.test` | `platform_admin_lab_budget` | implicit unmetered admin spend | helper contract done; future narrow route migration |
| `/api/admin/ai/test-image` priced BFL branch / `admin.image.test.charged` | `admin_org_credit_account` | partial existing selected-org credit debit | Phase 4.3 |
| `/api/admin/ai/test-image` unpriced branch / `admin.image.test.unmetered` | `platform_admin_lab_budget` | implicit unmetered admin spend | Phase 4.3 or later |
| `/api/admin/ai/test-embeddings` / `admin.embeddings.test` | `platform_admin_lab_budget` | implicit unmetered admin spend | future narrow migration or removal |
| `/api/admin/ai/test-music` / `admin.music.test` | `platform_admin_lab_budget` | implicit unmetered admin spend | future narrow migration |
| `/api/admin/ai/test-video` sync debug / `admin.video.sync_debug` | `platform_admin_lab_budget` | default-disabled debug spend path | future narrow migration or removal |
| `/api/admin/ai/video-jobs` / `admin.video.job.create` | `platform_admin_lab_budget` | job idempotency exists; budget reservation missing | Phase 4.4 |
| `/api/admin/ai/compare` / `admin.compare` | `platform_admin_lab_budget` | implicit fan-out admin spend | future narrow migration |
| `/api/admin/ai/live-agent` / `admin.live_agent` | `platform_admin_lab_budget` | implicit streaming admin spend | future narrow migration |
| OpenClaw/News Pulse ingest and scheduled visuals / `platform.news_pulse.visual.*` | `openclaw_news_pulse_budget` | row status suppresses duplicates; budget caps missing | Phase 4.5 |
| Generated music cover/background cover | `member_credit_account` today; future `platform_background_budget` only if product changes | included in parent music bundle | No Phase 4.2 runtime work |
| Future AI provider backfills | `platform_background_budget` | not currently baselined as AI provider-cost unless a provider call appears | future targeted phase |

Internal AI Worker routes remain service-bound provider execution surfaces. Phase 4.2 does not migrate them; the target is caller-side policy enforcement plus service-route verification in Phase 4.6.

| Internal AI Worker route | Operation ids | Target budget scope | Current policy owner |
| --- | --- | --- | --- |
| `/internal/ai/test-text` | `internal.text.generate` | `internal_ai_worker_caller_enforced` | Auth Worker caller such as admin text or org text route |
| `/internal/ai/test-image` | `internal.image.generate` | `internal_ai_worker_caller_enforced` | Auth Worker caller such as admin image or member/org image route |
| `/internal/ai/test-embeddings` | `internal.embeddings.generate` | `internal_ai_worker_caller_enforced` | Admin embeddings caller |
| `/internal/ai/test-music` | `internal.music.generate` | `internal_ai_worker_caller_enforced` | Member music gateway or admin music caller |
| `/internal/ai/test-video` | `internal.video.generate` | `internal_ai_worker_caller_enforced` | Member video gateway or default-disabled admin debug caller |
| `/internal/ai/video-task/create` | `admin.video.task.create`, `internal.video_task.create` | `internal_ai_worker_caller_enforced` | Admin video job caller |
| `/internal/ai/video-task/poll` | `admin.video.task.poll`, `internal.video_task.poll` | `internal_ai_worker_caller_enforced` | Admin video job caller |
| `/internal/ai/compare` | `internal.compare` | `internal_ai_worker_caller_enforced` | Admin compare caller |
| `/internal/ai/live-agent` | `internal.live_agent` | `internal_ai_worker_caller_enforced` | Admin live-agent caller |

## Observability Fields

Future budget events should be safe and bounded:

- `operation_id`
- `budget_scope`
- `budget_owner_id` when safe and not PII-heavy
- `actor_user_id`
- `actor_role`
- `route_id`
- `provider_family`
- `model_id` or resolver key
- `estimated_units`
- `estimated_credits_or_budget_units`
- `reservation_id` or job id
- `idempotency_status`
- `provider_status`
- `finalization_status`
- `kill_switch_state`
- `budget_window`
- `replay_status`
- `safe_error_code`

Do not store raw prompts, lyrics, auth headers, cookies, tokens, Stripe data, provider secrets, raw provider payloads, card/payment method data, or internal R2 keys in budget telemetry.

## Target Invariants

- Provider-cost admin/platform routes must be registered before runtime migration.
- Member image/music/video must not regress from mandatory idempotency, reservation, replay/suppression, and exactly-once debit.
- Admin/platform budgeted routes must deny before provider execution when limits or kill switches block the request.
- Internal AI Worker routes must stay service-only and rely on caller-side operation metadata.
- OpenClaw/News Pulse visual generation must be deterministic by item/job key and bounded by batch/window budgets.
- Explicit unmetered admin behavior must be a reviewed exception, not a silent default.
- Strict mode for `check:ai-cost-policy` should remain failing until all temporary baseline gaps are closed or explicitly removed.

## Recommended Implementation Order

1. Phase 4.2: Add admin/platform budget policy contract/helpers and tests only; no route migration. Completed for helper/test scope.
2. Phase 4.3: Harden charged admin BFL image test budget metadata while preserving current organization-credit debit behavior.
3. Phase 4.4: Add admin async video job budget reservation and internal task create/poll caller linkage.
4. Phase 4.5: Add OpenClaw/News Pulse visual budget controls, caps, and kill switch.
5. Phase 4.6: Add internal AI Worker caller-policy guard for service-bound routes.
6. Phase 4.7: Add read-only admin/platform AI budget observability dashboard after telemetry is reliable.

Each phase must be small, tested, reversible, and independently deployable. None of these phases should claim production readiness or live billing readiness without operator evidence.
