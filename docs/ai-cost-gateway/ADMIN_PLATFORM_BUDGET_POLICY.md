# Admin And Platform AI Budget Policy

Date: 2026-05-16

Status: Phase 4.9 Admin Music budget enforcement on top of the Phase 4.2 contract/helper foundation, Phase 4.3 charged Admin BFL image-test hardening, Phase 4.4 read-only budget evidence reporting, Phase 4.5 admin async video job budget enforcement, Phase 4.6 OpenClaw/News Pulse visual budget controls, Phase 4.7 internal AI Worker caller-policy guard, Phase 4.8 admin text/embeddings budget metadata, Phase 4.8.1 durable idempotency, and Phase 4.8.2 admin text/embeddings usage-attempt cleanup/inspection. Phase 4.9 adds no migration and changes only `POST /api/admin/ai/test-music`: required `Idempotency-Key`, sanitized `platform_admin_lab_budget` metadata, signed caller-policy propagation, and durable metadata-only `admin_ai_usage_attempts` duplicate suppression/conflict detection. Admin compare/live-agent, sync video debug, unmetered admin image, Admin video beyond Phase 4.5, Admin text/embeddings beyond Phase 4.8/4.8.1/4.8.2, OpenClaw/News Pulse beyond Phase 4.6, platform/background AI, and broad internal AI Worker routes remain unmigrated or baseline-allowed. No real provider calls, Stripe calls, live billing enablement, public billing changes, credit mutations, deploys, remote migrations, or runtime route migrations outside this scope were performed.

## Scope

Covered provider-cost classes:

- Admin AI text, image, embeddings, music, compare, live-agent, sync video debug, and async video jobs.
- Charged admin Black Forest Labs image tests that already debit selected organization credits.
- Platform/background AI jobs, including OpenClaw/News Pulse visual generation and scheduled visual backfill.
- Internal AI Worker routes that are service-only and rely on caller-side enforcement.
- Generated music cover/background cover policy when it is discussed outside the member music bundle.

Non-goals:

- No broad runtime budget enforcement beyond the charged Admin BFL image-test branch, admin async video job caller path, News Pulse visual caller-side budget metadata/status checks, Phase 4.7 internal caller-policy guard for covered routes, and Phase 4.8.1/4.9 admin text/embeddings/music metadata-only idempotency coverage. Phase 4.8.2 only adds operational inspection/cleanup for those attempts.
- No broad admin route migration beyond the charged Admin BFL image-test branch, admin async video job path, and admin text/embeddings/music test routes.
- No D1 schema except additive migrations `0049_add_admin_video_job_budget_metadata.sql` for sanitized job budget metadata, `0050_add_news_pulse_visual_budget_metadata.sql` for sanitized News Pulse visual budget metadata, and `0051_add_admin_ai_usage_attempts.sql` for admin text/embeddings/music idempotency attempts. Phase 4.7, Phase 4.8, Phase 4.8.2, and Phase 4.9 add no migration; Phase 4.8.1 adds `0051`.
- No Admin UI.
- No provider, Stripe, Cloudflare, GitHub, DNS, WAF, secret, deployment, remote migration, or live-billing action.

## Phase 4.4 Evidence Collector

Phase 4.4 adds `workers/auth/src/lib/admin-platform-budget-evidence.js`, `scripts/report-ai-budget-evidence.mjs`, `npm run test:admin-platform-budget-evidence`, `npm run report:ai-budget-evidence`, and `GET /api/admin/ai/budget-evidence`.

The report is read-only and bounded. It returns a blocked verdict while known admin/platform/internal/OpenClaw gaps remain, groups evidence by `admin_org_credit_account`, `platform_admin_lab_budget`, `platform_background_budget`, `openclaw_news_pulse_budget`, `internal_ai_worker_caller_enforced`, `explicit_unmetered_admin`, and `external_provider_only`, and includes sanitized evidence for:

- member image, music, and video as migrated member AI Cost Gateway routes
- charged Admin BFL image-test as implemented/hardened with `admin_org_credit_account` metadata
- admin async video jobs as Phase 4.5 `platform_admin_lab_budget` job/queue metadata coverage
- OpenClaw/News Pulse visual generation as Phase 4.6 `openclaw_news_pulse_budget` visual metadata and duplicate-suppression coverage
- Phase 4.7 internal AI Worker caller-policy guard coverage for async video task create/poll, including the reserved signed JSON body key transport
- admin text/embeddings/music as `platform_admin_lab_budget` metadata-only coverage with required `Idempotency-Key`, durable duplicate suppression/conflict detection, and signed caller-policy propagation
- Phase 4.8.2 admin AI usage-attempt operations as bounded, non-destructive cleanup plus admin-only sanitized list/detail inspection
- Admin compare/live-agent, sync video debug, unmetered admin image, platform/background AI outside News Pulse visuals, and baseline-allowed internal AI Worker routes beyond covered caller paths as baselined gaps

The report does not include raw prompts, provider request bodies, cookies, tokens, secrets, private keys, Stripe data, or raw R2 keys. The endpoint is admin-only, production-MFA-classified through route-policy, fail-closed rate limited, and returns the same sanitized local evidence. It performs no provider calls and no billing, credit, D1, R2, Stripe, Cloudflare, GitHub, DNS, WAF, secret, deployment, or remediation mutation.

## Phase 4.5 Admin Async Video Jobs

Phase 4.5 migrates exactly one remaining admin/platform provider-cost path: admin async video jobs. The route remains admin-only with production MFA classification through route policy, same-origin mutation protection, fail-closed rate limiting, and required `Idempotency-Key`.

Runtime behavior changed only for admin async video jobs:

- `POST /api/admin/ai/video-jobs` builds a Phase 4.2 budget plan before inserting or queueing a new job.
- The job row stores sanitized `budget_policy_json`, `budget_policy_status`, `budget_policy_fingerprint`, and `budget_policy_version`.
- The queue message includes only bounded budget summary fields: operation id, budget scope, plan status, kill-switch target, no live budget enforcement marker, no credit debit marker, and fingerprint.
- The auth Worker queue consumer verifies valid job budget metadata before calling `/internal/ai/video-task/create` or `/internal/ai/video-task/poll`.
- Duplicate same-key same-body requests return the existing job without queueing again; same-key different-body requests conflict before queueing.
- Duplicate queue delivery does not create a second provider task after a provider task id is recorded.
- If task creation was already attempted but no provider task id was recorded, a later retry fails closed with safe operator-review state instead of making another provider create call.

The kill-switch target is recorded as `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`, but Phase 4.5 does not enforce a new runtime env flag. Live platform budget caps and runtime env kill-switch enforcement remain future work. Phase 4.7 keeps service-auth as the first AI Worker gate and adds caller-policy validation for the internal video task create/poll routes. No member image/music/video billing behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, or Admin UI changed.

## Phase 4.6 OpenClaw/News Pulse Visuals

Phase 4.6 migrates exactly one platform/background provider-cost domain: OpenClaw/News Pulse visual generation. Signed OpenClaw ingest and public News Pulse read routes keep their existing auth/read behavior; only the visual generation/backfill helper records and validates budget metadata before provider-cost thumbnail generation.

Runtime behavior changed only for News Pulse generated thumbnails:

- Ingest-triggered waitUntil visual backfill uses operation id `platform.news_pulse.visual.ingest`; scheduled visual backfill uses `platform.news_pulse.visual.scheduled`.
- Visual generation builds a Phase 4.2 budget plan with budget scope `openclaw_news_pulse_budget` before `env.AI.run`.
- The `news_pulse_items` row stores sanitized `visual_budget_policy_json`, `visual_budget_policy_status`, `visual_budget_policy_fingerprint`, and `visual_budget_policy_version`.
- Invalid budget policy config blocks provider execution and records safe failure metadata.
- Existing status/attempt guards still suppress provider calls when a visual is already ready, pending/in progress, exhausted, or outside retry policy.
- Provider failure and storage failure do not mark the visual ready; public News Pulse reads continue to fall back safely without exposing internal R2 keys.
- The future kill-switch target is recorded as `ENABLE_NEWS_PULSE_VISUAL_BUDGET`, but Phase 4.6 does not enforce a new runtime env flag or live budget cap.

Phase 4.6 does not change member image/music/video, org-scoped member image/text, public pricing, Stripe behavior, credit debit behavior, Admin UI, public News Pulse response shape, OpenClaw signed ingest authorization, Admin video beyond Phase 4.5, or internal AI Worker service-auth semantics.

## Phase 4.7 Internal AI Worker Caller-Policy Guard

Phase 4.7 adds a narrow metadata guard for internal Auth Worker -> AI Worker provider-cost calls. The chosen transport is a reserved JSON body key, `__bitbi_ai_caller_policy`, inside the already service-auth-signed request body. The AI Worker validates service-auth first, then validates caller-policy metadata, then strips the reserved key through the shared internal JSON parser before route validators and provider payload construction. Dedicated headers were avoided so the existing body hash covers the metadata without weakening service-auth.

Implemented behavior:

- `workers/shared/ai-caller-policy.mjs` defines the caller-policy version, allowed enforcement statuses, budget scopes, caller classes, sanitization, validation, and audit summary helpers.
- Auth Worker proxy calls can attach safe caller-policy metadata without changing user-visible request or response shapes.
- The charged Admin BFL image-test path propagates `budget_policy_enforced` metadata for `admin.image.test.charged`.
- Admin async video task create/poll propagates `caller_enforced` metadata tied to the Phase 4.5 job budget fingerprint and kill-switch target `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`.
- Member music lyrics/audio internal AI calls propagate `gateway_enforced` metadata for compatibility with the migrated member music gateway; this does not change member billing or debit behavior.
- The AI Worker rejects missing or malformed caller-policy metadata for `/internal/ai/video-task/create` and `/internal/ai/video-task/poll`.
- Known broad internal routes (`test-image`, `test-music`, sync video debug, compare, and live-agent) still allow missing policy only as explicit `baseline_allowed` gaps; admin text/embeddings now supply Phase 4.8.1 policy metadata, while missing policy remains allowed for other compatibility callers on those shared internal routes. Malformed supplied metadata is rejected.

Limits:

- Phase 4.7 does not migrate broad Admin AI, Admin music/text/compare/live-agent, sync video debug, OpenClaw/News Pulse beyond Phase 4.6 compatibility, or platform/background AI globally. Phase 4.8/4.8.1 narrow that by covering only admin text/embeddings, and Phase 4.9 narrows it further only for admin music; Admin compare/live-agent, sync video debug, unmetered admin image, OpenClaw/News Pulse beyond Phase 4.6, and platform/background AI remain unmigrated.
- News Pulse visuals do not call the AI Worker in this flow; they remain direct Auth Worker provider calls covered by Phase 4.6 caller-side budget metadata.
- No new D1 migration, credit debit change, credit clawback, Stripe call, real provider call in tests, live billing enablement, or production readiness claim is introduced.

## Phase 4.8 Admin Text / Embeddings

Phase 4.8 migrates exactly one narrow broad-Admin-AI provider-cost area: admin text and embeddings test routes. The routes remain admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for admin text/embeddings:

- `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings` now require a valid `Idempotency-Key` before proxying to the AI Worker.
- Each route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget`.
- Admin responses include sanitized `budget_policy` and `caller_policy` summaries. They include operation id, budget scope, provider family/model, plan status, future kill-switch target, safe fingerprint, and a hash of the idempotency key only.
- The Auth Worker propagates safe caller-policy metadata under `__bitbi_ai_caller_policy` with `budget_metadata_only` status before service-auth body signing.
- The AI Worker validates supplied caller-policy metadata after service-auth and strips the reserved key before provider payload construction.
- Future kill-switch targets are recorded as `ENABLE_ADMIN_AI_TEXT_BUDGET` and `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`; Phase 4.8 does not enforce new runtime env flags or live platform budget caps.
- Phase 4.8.1 adds `admin_ai_usage_attempts` durable metadata-only attempts before provider calls. Same-key/same-request pending, completed, or failed attempts do not make another provider call; same-key/different-request retries return conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; generated text and embedding vectors are intentionally not persisted or replayed.
- Phase 4.8.2 adds `GET /api/admin/ai/admin-usage-attempts`, `GET /api/admin/ai/admin-usage-attempts/:id`, and `POST /api/admin/ai/admin-usage-attempts/cleanup-expired`. These endpoints return sanitized fields only and the cleanup path is bounded, dry-run by default, non-destructive, same-origin protected, admin/MFA-classified, fail-closed rate limited, and audited.

Phase 4.8.2 does not change Admin music, Admin video beyond Phase 4.5, Admin compare, Admin live-agent, OpenClaw/News Pulse beyond Phase 4.6, platform/background AI, unrelated internal AI Worker routes, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, provider behavior, billing behavior, or live billing readiness.

## Phase 4.9 Admin Music

Phase 4.9 migrates exactly one narrow admin provider-cost route: `POST /api/admin/ai/test-music`. The route remains admin-only, production-MFA-classified through route policy, same-origin protected, and fail-closed rate limited.

Runtime behavior changed only for Admin Music test generation:

- `POST /api/admin/ai/test-music` now requires a valid `Idempotency-Key` before proxying to the AI Worker.
- The route builds a Phase 4.2 budget plan with budget scope `platform_admin_lab_budget` before provider-cost work.
- The route records sanitized `budget_policy` and `caller_policy` summaries with operation id `admin.music.test`, provider family/model, plan status, future kill-switch target `ENABLE_ADMIN_AI_MUSIC_BUDGET`, safe fingerprint, and only a hash of the idempotency key.
- The Auth Worker creates a durable `admin_ai_usage_attempts` row before the internal AI call. Same-key/same-request pending, completed, or failed attempts do not make another provider call; same-key/different-request retries conflict before provider execution.
- Completed duplicate requests return metadata-only replay with `result: null`; raw prompts, lyrics, audio bytes/URLs, and provider response bodies are not stored or replayed.
- The Auth Worker propagates `budget_metadata_only` caller-policy metadata under `__bitbi_ai_caller_policy`; the AI Worker validates supplied metadata after service-auth and strips the reserved key before provider payload construction.
- Phase 4.9 records the future kill-switch target only. Runtime env kill-switch enforcement and live platform budget caps remain future work.

Phase 4.9 adds no migration and does not change Admin Compare, Admin Live-Agent, sync video debug, Admin Video beyond Phase 4.5, Admin Text/Embeddings beyond Phase 4.8/4.8.1/4.8.2, unmetered admin image branches beyond Phase 4.3 charged BFL behavior, OpenClaw/News Pulse beyond Phase 4.6, member image/music/video behavior, org-scoped member image/text behavior, public pricing, Stripe behavior, credit debit behavior, credit clawback behavior, provider behavior outside this route, billing behavior, or live billing readiness.

## Phase 4.2 Helper Contract

`workers/auth/src/lib/admin-platform-budget-policy.js` is the reusable target contract for admin/platform AI budget migrations. It remains pure. Phase 4.3 imports it only from the charged Admin image-test branch to build safe plan/audit metadata; the helper still does not call D1, R2, providers, Stripe, Cloudflare APIs, network fetch, or live environment variables.

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
| Admin text test | `platform_admin_lab_budget` | Phase 4.8.1 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; Phase 4.8.2 adds bounded cleanup and admin-only sanitized inspection; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Runtime env kill switch and live platform budget caps remain future; current enforcement is metadata plan/fingerprint/caller-policy validation plus durable attempt state. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no generated text; cleanup marks only expired active attempts and does not delete rows. | Future target `ENABLE_ADMIN_AI_TEXT_BUDGET`; metadata-only in Phase 4.8.1, operational cleanup/inspection in Phase 4.8.2. | Missing/malformed key, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, sanitized list/detail, dry-run cleanup, scheduled cleanup. | Phase 4.8.2 completed for operational cleanup/inspection. |
| Charged admin BFL image tests | `admin_org_credit_account` | Existing selected-org credit debit for priced BFL image tests. | Required. | Phase 4.3 preserves org-credit debit and adds explicit admin budget policy plan/audit metadata, deterministic policy fingerprint, kill-switch target metadata, and sanitized usage/attempt metadata. | No charge on provider failure; metadata-only replay remains acceptable until full output replay is designed. | Existing org balance plus metadata target `ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET`; no new env flag is enforced in this phase. | Existing charge tests plus policy metadata and no unmetered fallback. | Phase 4.3 completed for charged branch hardening. |
| Unmetered admin image branch | `platform_admin_lab_budget` | Admin-only provider call for unpriced models, no debit. | Partial/route-dependent. | Either disable unpriced models or classify as platform lab budget with limits and kill switch. | No credit debit; replay disabled unless result persisted safely. | Model allowlist, per-admin daily/monthly lab budget, kill switch. | Unpriced model budget denial and no provider call. | Later narrow admin lab budget phase. |
| Admin embeddings | `platform_admin_lab_budget` | Phase 4.8.1 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; Phase 4.8.2 adds bounded cleanup and admin-only sanitized inspection; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Runtime env kill switch and live platform budget caps remain future; current enforcement is metadata plan/fingerprint/caller-policy validation plus durable attempt state. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no raw input or embedding vectors; cleanup marks only expired active attempts and does not delete rows. | Future target `ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET`; metadata-only in Phase 4.8.1, operational cleanup/inspection in Phase 4.8.2. | Missing/malformed key, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, sanitized list/detail, dry-run cleanup, scheduled cleanup. | Phase 4.8.2 completed for operational cleanup/inspection. |
| Admin music test | `platform_admin_lab_budget` | Phase 4.9 requires `Idempotency-Key`, builds safe budget metadata, propagates signed caller-policy metadata, and stores metadata-only idempotency attempts; no credits are debited. | Required; durable key-hash/request-fingerprint conflict detection and duplicate suppression through `admin_ai_usage_attempts`. | Runtime env kill switch and live platform budget caps remain future; current enforcement is metadata plan/fingerprint/caller-policy validation plus durable attempt state. | No member charge; provider failure does not mutate billing; completed duplicate replay is metadata-only with no audio, lyrics, prompts, or provider body; cleanup marks only expired active attempts and does not delete rows. | Future target `ENABLE_ADMIN_AI_MUSIC_BUDGET`; metadata-only in Phase 4.9. | Missing/malformed key, conflict, in-progress duplicate, provider failure terminal retry, sanitized metadata, caller-policy stripping, no audio/lyrics/provider body storage. | Phase 4.9 completed for Admin Music only. |
| Admin compare | `platform_admin_lab_budget` | Multi-provider text calls can fan out. | Not required. | One parent compare budget reservation with per-model child telemetry. | Partial model failure records partial provider spend; no member debit. | Per-request model count cap, daily/monthly cap, kill switch. | Fanout budget cap, partial failure telemetry. | Later narrow migration. |
| Admin live-agent | `platform_admin_lab_budget` | Streaming provider spend until stream ends. | Not request-idempotent today. | Stream-session budget lease with max duration/token estimate and stop reason. | No replay; final telemetry records duration/token/provider status. | Stream duration cap, per-admin daily/monthly cap, kill switch. | Stream cap enforcement and sanitized logs. | Later narrow migration. |
| Admin sync video debug | `platform_admin_lab_budget` | Default-disabled debug route can spend video provider budget if enabled. | Not required. | Keep disabled by default; require emergency budget flag, idempotency, and runbook if retained. | No replay unless persisted; no member debit. | `ALLOW_SYNC_VIDEO_DEBUG` plus explicit budget flag. | Disabled-by-default, no provider without both flags. | Later narrow migration or removal. |
| Admin async video jobs | `platform_admin_lab_budget` with internal caller-enforced subroutes | Phase 4.5 stores sanitized job/queue budget metadata before provider-cost processing; no credits are debited. | Job create requires `Idempotency-Key`; internal tasks inherit the job budget state. | Runtime env kill switch and live budget caps still future; current enforcement is job metadata, idempotency, and duplicate provider-create suppression. | Polling is tied to persisted task id; output/poster success is preserved; output persistence failure does not mark budget state successful. | Future target `ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET`; metadata-only in Phase 4.5. | Missing/invalid metadata, duplicate delivery, response-loss retry suppression, provider/output failures, sanitized telemetry. | Phase 4.5 completed for admin async video jobs only. |
| News Pulse/OpenClaw visuals | `openclaw_news_pulse_budget` | Phase 4.6 records safe visual budget metadata before provider calls and preserves status/attempt duplicate suppression; no credits are debited. | HMAC ingest nonce plus deterministic item/content hash and visual status/attempt guards. | Runtime env kill switch and live platform budget caps remain future; current enforcement is metadata validation, deterministic fingerprinting, and duplicate provider-call suppression. | Ready thumbnail is durable replay; failed rows retry only within attempt cap and budget-policy validity. | Future target `ENABLE_NEWS_PULSE_VISUAL_BUDGET`; metadata-only in Phase 4.6. | Invalid policy, ready/pending duplicate suppression, provider/storage failure, sanitized telemetry. | Phase 4.6 completed for News Pulse visuals only. |
| Scheduled/backfill visual jobs | `openclaw_news_pulse_budget` | Phase 4.6 records safe scheduled visual budget metadata before provider calls and respects existing bounded batch/status/attempt guards. | Deterministic item/content hash plus status/attempt caps. | Runtime env kill switch and live scheduled budget window remain future; current enforcement is metadata validation and item-level suppression. | Existing ready thumbnails prevent regeneration; failed rows are bounded by attempt caps. | Future target `ENABLE_NEWS_PULSE_VISUAL_BUDGET`; metadata-only in Phase 4.6. | Scheduled metadata, ready/pending duplicate suppression, no provider on invalid policy. | Phase 4.6 completed for News Pulse visuals only. |
| Generated music cover/background cover | `member_credit_account` today; `platform_background_budget` only if future policy changes | Phase 3.7 includes cover in parent member music bundle. | Parent member music idempotency. | Keep inside parent member music bundle unless product explicitly changes it; if split, use platform/background or member sub-budget with separate evidence. | Cover failure after audio success must not double debit. | Parent music caps today. | Preserve no separate charge and safe cover status. | No Phase 4.2 runtime work. |
| Internal AI Worker routes | `internal_ai_worker_caller_enforced` | Service-only routes call providers and rely on auth-worker callers. Phase 4.7 validates signed caller-policy metadata, requires it for async video task create/poll, and Phase 4.8.1 supplies metadata for admin text/embeddings while keeping broader shared routes baseline-allowed for other callers. | Inherited/delegated; video task create/poll require caller-policy metadata; admin text/embeddings supply metadata but the shared route still allows known baseline callers. | Internal routes remain service-only; covered callers pass operation id/budget metadata before internal worker executes provider work. | Replay/failure policy belongs to caller; internal route returns safe provider result/status only. | Service binding only, caller kill switch metadata, no public exposure. | Service-auth-first rejection, malformed policy rejection, metadata stripping before provider payloads. | Phase 4.7 guard completed; Phase 4.8.1 added admin text/embeddings caller metadata and caller-side durable idempotency; remaining callers future. |
| Derivative/backfill flows | Not AI provider-cost today unless future route calls provider | Current image derivatives use transforms/R2, not AI provider calls. | Queue/job leases. | Keep outside AI provider budget guard unless provider-call patterns appear; storage/transform cost should be tracked separately. | No AI provider replay needed. | Queue limits and transform/storage budgets. | Guard catches any future provider call. | Outside Phase 4.2. |

## Operation Mapping

Admin and platform operation metadata is now explicit in `workers/auth/src/lib/ai-cost-operations.js`; known temporary gaps are mirrored in `config/ai-cost-policy-baseline.json`. Phase 4.3 marks `admin.image.test.charged` as implemented/hardened for the existing selected-organization credit branch. Phase 4.5 marks admin async video job operations as covered by job/queue budget metadata. Phase 4.6 marks OpenClaw/News Pulse visual operations as covered by visual budget metadata and status/attempt duplicate suppression. Phase 4.7 marks internal async video task create/poll as caller-policy guarded. Phase 4.8.1 marks admin text/embeddings as partial metadata-only coverage with durable idempotency attempts under `platform_admin_lab_budget`, Phase 4.8.2 adds bounded non-destructive cleanup plus admin-only sanitized inspection for those attempt rows, and Phase 4.9 extends that same metadata-only durable attempt foundation to Admin Music only. Other admin/platform/internal entries remain policy metadata and known gaps unless a later phase migrates them.

| Operation / route | Target budget scope | Current status | Target phase |
| --- | --- | --- | --- |
| `/api/admin/ai/test-text` / `admin.text.test` | `platform_admin_lab_budget` | Phase 4.8.2 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, bounded cleanup, and admin-only sanitized inspection; no full result replay/live caps | Completed for admin text cleanup/inspection foundation |
| `/api/admin/ai/test-image` priced BFL branch / `admin.image.test.charged` | `admin_org_credit_account` | Phase 4.3 hardened selected-org credit debit with safe budget policy metadata; result replay remains metadata-only | Completed for charged branch hardening |
| `/api/admin/ai/test-image` unpriced branch / `admin.image.test.unmetered` | `platform_admin_lab_budget` | implicit unmetered admin spend | later narrow phase or removal |
| `/api/admin/ai/test-embeddings` / `admin.embeddings.test` | `platform_admin_lab_budget` | Phase 4.8.2 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, bounded cleanup, and admin-only sanitized inspection; no vectors/full result replay/live caps | Completed for admin embeddings cleanup/inspection foundation |
| `/api/admin/ai/test-music` / `admin.music.test` | `platform_admin_lab_budget` | Phase 4.9 partial coverage: required `Idempotency-Key`, safe budget metadata, signed caller-policy metadata, durable metadata-only duplicate suppression/conflict detection, no audio/lyrics/provider body replay, and no credit debit | Completed for Admin Music metadata-only budget/idempotency coverage |
| `/api/admin/ai/test-video` sync debug / `admin.video.sync_debug` | `platform_admin_lab_budget` | default-disabled debug spend path | future narrow migration or removal |
| `/api/admin/ai/video-jobs` / `admin.video.job.create` | `platform_admin_lab_budget` | Phase 4.5 implemented sanitized job/queue budget metadata, required idempotency, and queue consumer budget-state checks | Completed for admin async video jobs only |
| `/api/admin/ai/compare` / `admin.compare` | `platform_admin_lab_budget` | implicit fan-out admin spend | future narrow migration |
| `/api/admin/ai/live-agent` / `admin.live_agent` | `platform_admin_lab_budget` | implicit streaming admin spend | future narrow migration |
| OpenClaw/News Pulse ingest and scheduled visuals / `platform.news_pulse.visual.*` | `openclaw_news_pulse_budget` | Phase 4.6 implemented sanitized visual budget metadata, invalid-policy provider blocking, and existing status/attempt duplicate suppression; runtime env kill switch and live caps remain future | Completed for News Pulse visuals only |
| Generated music cover/background cover | `member_credit_account` today; future `platform_background_budget` only if product changes | included in parent music bundle | No Phase 4.2 runtime work |
| Future AI provider backfills | `platform_background_budget` | not currently baselined as AI provider-cost unless a provider call appears | future targeted phase |

Internal AI Worker routes remain service-bound provider execution surfaces. Phase 4.7 validates caller-policy metadata after service-auth and before provider route handling. It requires metadata for async video task create/poll, validates supplied metadata on all known provider-cost routes, strips the reserved key before provider payload construction, and leaves broad routes baseline-allowed until targeted migrations.

| Internal AI Worker route | Operation ids | Target budget scope | Current policy owner |
| --- | --- | --- | --- |
| `/internal/ai/test-text` | `admin.text.test`, `internal.text.generate` | `internal_ai_worker_caller_enforced` | Admin text now supplies Phase 4.8 caller-policy metadata; org/member callers remain baseline-compatible |
| `/internal/ai/test-image` | `internal.image.generate` | `internal_ai_worker_caller_enforced` | Auth Worker caller such as admin image or member/org image route |
| `/internal/ai/test-embeddings` | `admin.embeddings.test`, `internal.embeddings.generate` | `internal_ai_worker_caller_enforced` | Admin embeddings now supplies Phase 4.8 caller-policy metadata; shared route still permits known baseline callers |
| `/internal/ai/test-music` | `internal.music.generate` | `internal_ai_worker_caller_enforced` | Member music gateway and Phase 4.9 admin music caller supply metadata; other known callers remain baseline-compatible |
| `/internal/ai/test-video` | `internal.video.generate` | `internal_ai_worker_caller_enforced` | Member video gateway or default-disabled admin debug caller |
| `/internal/ai/video-task/create` | `admin.video.task.create`, `internal.video_task.create` | `internal_ai_worker_caller_enforced` | Phase 4.7 requires signed caller-policy metadata tied to the Phase 4.5 admin video job budget state |
| `/internal/ai/video-task/poll` | `admin.video.task.poll`, `internal.video_task.poll` | `internal_ai_worker_caller_enforced` | Phase 4.7 requires signed caller-policy metadata tied to the persisted Phase 4.5 provider task id |
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
2. Phase 4.3: Harden charged admin BFL image test budget metadata while preserving current organization-credit debit behavior. Completed for the charged branch only; broad Admin AI remains unmigrated.
3. Phase 4.4: Add read-only Admin/Platform AI budget evidence reporting. Completed for helper/script/admin endpoint/test scope only; no runtime enforcement changed.
4. Phase 4.5: Add admin async video job budget reservation metadata and internal task create/poll caller linkage. Completed only for admin async video jobs; broad Admin AI remains unmigrated.
5. Phase 4.6: Add OpenClaw/News Pulse visual budget metadata, invalid-policy provider blocking, and duplicate provider-call suppression. Completed only for News Pulse visuals; runtime env kill-switch enforcement and live caps remain future work.
6. Phase 4.7: Add internal AI Worker caller-policy guard for service-bound routes. Completed for caller-policy validation/metadata handling only.
7. Phase 4.8: Add admin text/embeddings budget metadata, required idempotency, and caller-policy propagation. Completed only for those two routes.
8. Phase 4.8.1: Add admin text/embeddings durable metadata-only idempotency attempts and same-key conflict/duplicate suppression. Completed only for those two routes; full result replay/live platform caps remain future work.
9. Phase 4.8.2: Add admin-only sanitized inspection and bounded non-destructive cleanup for `admin_ai_usage_attempts`. Completed only for admin text/embeddings attempt operability; no new route migration, provider behavior, credit behavior, or billing behavior changed.
10. Phase 4.9: Add Admin Music budget metadata, required idempotency, durable metadata-only duplicate suppression, and caller-policy propagation. Completed only for `POST /api/admin/ai/test-music`; no migration added.
11. Phase 4.10: Migrate one remaining Admin AI/internal caller path, such as Admin Compare or Live-Agent, without broad rewrites.

Each phase must be small, tested, reversible, and independently deployable. None of these phases should claim production readiness or live billing readiness without operator evidence.
