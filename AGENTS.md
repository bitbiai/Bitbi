# AGENTS.md

## Purpose and scope

This file is the repo-wide operating guide for Codex in `bitbi.ai`.
It applies to the whole repository unless a deeper `AGENTS.md` overrides it (for example `workers/auth/AGENTS.md`).

---

## Repository reality (verified)

- Frontend is a static site (plain HTML/CSS/vanilla ES modules), served locally with `serve`.
- Backend logic is in Cloudflare Workers:
  - `workers/auth` (primary API/auth/admin/media)
  - `workers/ai` (AI service worker used by auth/admin flows)
  - `workers/contact` (contact form endpoint)
- Persistent/cloud resources in use: Cloudflare D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images.
- `.github/workflows/static.yml` owns tested frontend candidates and protected publication; `config/static-hosting.json` selects the Cloudflare frontend Worker.
- Supported affected backend prerequisites can precede frontend continuation in that protected workflow; deploy only selected components.

Treat this architecture as intentional. Do not replace it with framework rewrites or cross-stack refactors unless explicitly required.

---

## High-risk areas (change conservatively)

- Auth/session/cookie logic (`workers/auth/src/lib/session.js`, auth routes, password/wallet/admin MFA flows).
- Admin authorization and privileged routes (`workers/auth/src/routes/admin*.js`).
- Private media serving and ownership checks (`workers/auth/src/routes/media.js`, `public-media.js`, related helpers).
- AI generation/save/publish flows and derivative pipelines (`/api/ai/*`, derivative queue, image studio integrations).
- D1 migrations and any schema-dependent code (`workers/auth/migrations`, worker route assumptions).
- Wrangler bindings/routes/config (`workers/*/wrangler.jsonc`) and release contract (`config/release-compat.json`).
- Caching/security-sensitive behavior (public vs private asset delivery, rate limiting, cron cleanup).

Do not weaken auth/admin/ownership protections or silently change API shapes used by existing frontend modules.

---

## Key paths to inspect before editing

- Root app/pages: `index.html`, `account/`, `admin/`, `legal/`
- Frontend modules: `js/shared/`, `js/pages/*/main.js`
- Styles: `css/base/`, `css/components/`, `css/pages/`, `css/account/`, `css/admin/`
- Worker entrypoints:
  - `workers/auth/src/index.js`
  - `workers/ai/src/index.js`
  - `workers/contact/src/index.js`
- Auth worker routes/libs: `workers/auth/src/routes/`, `workers/auth/src/lib/`
- Schema/migrations: `workers/auth/migrations/`
- Release/deploy contract: `config/release-compat.json`
- CI workflow: `.github/workflows/static.yml`
- Release/validation scripts: `scripts/*.mjs`

If changing `workers/auth/*`, read `workers/auth/AGENTS.md` and `workers/auth/CLAUDE.md` first.

---

## Verified commands (only use real repo commands)

### Local/static + tests

- `npm run dev`
- `npm test`
- `npm run test:static`
- `npm run test:workers`
- `npm run test:headed`

### Release compatibility + asset-version checks

- `npm run test:release-compat`
- `npm run test:asset-version`
- `npm run validate:release`
- `npm run validate:asset-version`
- `npm run build:static`
- `npm run release:plan`
- `npm run release:preflight`
- `npm run release:apply`

### Worker-local commands (from each worker directory)

- `npx wrangler dev`
- `npx wrangler deploy`
- Auth DB migrations:
  - `npx wrangler d1 migrations apply bitbi-auth-db --local`
  - `npx wrangler d1 migrations apply bitbi-auth-db --remote`

Do not invent commands/scripts that are not present in this repo.

---

## How to make safe changes

1. Inspect nearby code and follow existing patterns in the same area.
2. Keep diffs targeted; avoid opportunistic refactors.
3. Preserve existing behavior unless the task explicitly requires behavior changes.
4. Reuse existing helpers/response patterns/guards before introducing new abstractions.
5. For schema changes, add explicit forward-only migrations; avoid destructive edits.
6. For worker config changes, update related release contract/docs in the same change when needed.
7. Explicitly call out any Cloudflare dashboard/manual dependency; never guess it.

---

## Local release validation

For an authorized release, commit the scoped candidate and use `npm run release:local`.
It resolves the verified published base, runs selected checks in the persistent
local Linux and native browser environments, uploads exact-source evidence, pushes main in the
foreground and continues the existing protected `static.yml` path. `release:preflight`
uses the same evidence/resume path without push or publication. Do not separately
rerun its passed suites on the Mac or GitHub. See the [local validation procedure](docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#portable-local-release-validation).
Scheduled Full and Memvid remain independent; do not dispatch Full for each release.
This entry point grants no additional publication, credential or paid-call authority.

## Git workflow and completion

- Requested implementation tasks normally finish with task-related changes committed and pushed directly to `origin/main`; no separate commit/push approval is needed. Explicit audit-only, read-only, local-only, draft, or no-push instructions override this default.
- Work on `main` when practical. Routine work does not require feature branches, PRs, extra worktrees, approval stages, or backup ceremonies; reuse a suitable existing worktree when necessary.
- Before committing, inspect the task diff and current remote state. Include only intended changes and preserve unrelated user work. Integrate newer remote work safely; never force-push, overwrite it, or discard changes.
- Install the repository-local quality guard with `npm run hooks:install` and verify it with `npm run hooks:check` in each intended checkout. Preserve existing hooks/configuration; the installer refuses conflicts. Before commit, run `npm run test:quality-gates` on final inputs. The active pre-push hook checks proposed branch-tip Git blobs using the same CI budgets and secret scan, regardless of dirty product files; a differing checker/policy fails closed. Never bypass it with `--no-verify`, disabled hooks or another push path. Fresh clones and other worktrees are not protected merely because hook code is versioned; CI remains independent. See `scripts/install-pre-push.mjs`.
- For Admin save/import or MFA/auth-lifecycle changes, run `npm run test:q3-integration` with the existing isolated synthetic test environment: it couples the real Node save entrypoint with Chromium/WebKit MFA, auth-lifecycle, save-dialog and Compare checks. Add appropriate shared-auth/member regressions when shared state changes. The budget hook does not replace these functional checks.
- Batch a completed task into a sensible commit or small coherent set, then push once. Leave GitHub rules and CI/deployment gates unchanged; do not bypass them, add server-side restrictions, or manually dispatch duplicate workflows started by the push.
- Direct-push authorization includes existing automatic workflows. Manual Worker deployments, remote migrations, maintenance, destructive operations, and paid calls still require authorization within the specific task's scope.
- Complete an approved implementation package coherently: reproduce the relevant failure, make the scoped fix, update regressions/docs, validate, then commit/push without asking again for each internal step. The user's goals, acceptance criteria and security constraints are binding; choose the technical solution autonomously, including alternatives that meet them at least as well and the necessary related fixes/tests/docs. Reuse authorization already given; new product semantics, scope expansion or production operations outside that authorization still need a separate decision. Preserve unrelated user work, keep credentials out of logs and commits, and retain private evidence outside the public repository.
- A repair is complete only when its evidenced cause, executable regression/countercontrol, actual local/CI caller and final tested inputs are linked. Tie tests to protected behavior and risk; replace false or redundant proxies with an evidenced equivalent contract, not another blanket gate. Maintain the compact `docs/runbooks/REGRESSION_REGISTER.md`; discovery is not execution, a replay is not native acceptance, and an unexplained historical failure must not be relabelled as fixed.
- Map every new spec to its real CI execution entrypoint. Pages selection and candidate evidence must cover the complete unpublished range from the last verified successful deployment, not a completed historical release or the last push. Preserve exact tested artifact identity, selected job evidence, final dependency guard and shared write lock; use the existing source run/attempt reuse path only when needed, without a duplicate full run merely to publish.
- For the reviewed Admin-reader production surface plus its closed release/test-tooling path set, `admin-reader-v1` requires all News, Admin navigation/session/MFA and short homepage smoke checks in Chromium/WebKit against the candidate build, plus release/security/tooling checks. Dedicated decorative Hero coverage is removed by explicit owner decision; functional failures still block selected acceptance. Inspect the entire unpublished production diff first; shared/runtime/backend/dependency or unknown inputs cannot use this bounded scope. Unselected suites are not passes, and no old failed candidate is re-certified under a new policy.
- Before a CI repair, search the affected signature/caller in [the regression register](docs/runbooks/REGRESSION_REGISTER.md) and read the [main-only release runbook](docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md). Apply their focused checks through the actual caller.

## Completion modes

- Ordinary commit/push tasks end after required local checks, integrated review and a confirmed foreground push. At most one immediate CI snapshot; report unverified CI/publication and hand off without waiting. Completed failures may be diagnosed within scope.
- Explicit CI-repair acceptance or end-to-end publication requires the requested final results on the final source/candidate. If the owner requests asynchronous handoff, initiate required existing workflows once, retain links/checkpoint and stop active waiting. Otherwise observe bounded status and continue scoped repairs. Pending CI is not acceptance or publication; preserve review gates and write locks.
- Use the [main-only release runbook](docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#ci-repair-and-required-acceptance) for actual commands, selection, Full dispatch, complete caller chains and evidence. This exception adds no deployment, paid-call or settings authority. Do not start background monitoring for an ordinary push.

---

## Documentation hygiene

- Keep active current-state docs concise. Do not append full phase history to `CURRENT_IMPLEMENTATION_HANDOFF.md`, `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`, `DATA_INVENTORY.md`, or current docs under `docs/audits/`.
- Put detailed phase outcomes in `docs/audits/archive/root-phase-reports/`, a final response, or `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`.
- Do not create new root-level `PHASE*.md`, `AUDIT_*.md`, or `ALPHA_AUDIT_*.md` reports; archive historical reports outside the repository root.
- Use `docs/audits/NEXT_AUDIT_BASELINE.md` as the single start point for a fresh audit. Retired root audit docs live in `docs/audits/archive/retired-audit-root-docs/`.
- Preserve historical phase reports as frozen evidence. Do not rewrite them to current migration numbers.
- Use `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` for the restart/current audit snapshot and `docs/audits/README.md` for documentation classification.
- Current source-of-truth docs must mention the latest auth migration from `config/release-compat.json` and must not claim production readiness or live billing readiness without recorded evidence.
- Docs remain English. Public/member-facing runtime changes still require English/German product parity; admin docs and admin-only UI remain English unless explicitly requested.

---

## Validation expectations (proportional)

Run the smallest set that truly covers changed surfaces. Routine UI, documentation, and tooling changes need focused checks, not an automatic audit or full application regression:

- Static/UI changes: relevant specs from `npm run test:static`; use the broader suite when shared runtime or wider behavior changes warrant it.
- Worker tooling changes: toolchain, affected dependency checks, and local build-tool smoke checks as needed; no live resources.
- Worker route/contract, authentication, ownership, accounting, schema, or other high-impact changes: relevant broader suites, including `npm run test:workers` for Worker behavior.
- D1 migrations and runtime-sensitive Worker changes also need focused regressions in the target workerd/D1 implementation with native local bindings and recorded toolchain versions. Node SQLite or mocks alone do not establish D1 compatibility. Cover the affected entrypoint and populated transition where relevant; preserve specific failures and use synthetic, credential-free fixtures without live providers.
- Release/config/migration/binding changes: `npm run test:release-compat`, `npm run validate:release`
- Asset version/build-pipeline changes: `npm run test:asset-version`, `npm run validate:asset-version`, `npm run build:static`

Carousel laboratory timing thresholds (including 50 ms tasks, 100 ms first motion and the historical transition-duration range) are diagnostics, not release vetoes. Preserve visible warnings and valid native measurement/countercontrols; missing or broken measurements are not performance passes. Functional completion, geometry, primary media/audio behavior, finite functional liveness timeouts, security and data-integrity gates remain mandatory. Do not relabel historical failures.

The static frontend Worker (`frontend/index.mjs`, `frontend/wrangler.jsonc`)
and explicitly mapped release-only tooling use the existing release/build and
native frontend HTTP/routing/privacy checks, not automatic whole-platform tests.
Select browser/media/backend suites for their actual changed inputs; unknown
inputs and hosting-authority changes remain broad. Unselected jobs must not
allocate runners or become implicit deployment dependencies. Missing/failed
selected execution and wrong artifacts remain fatal. Scheduled/extended Full
regression remains available and blocks reuse when the candidate selects full
acceptance; it is not an unrelated narrow-release prerequisite.

When repairing browser tests, establish intended behavior from product contracts and the actual candidate before changing fixtures, synchronization or expectations. Corrected checks must accept that behavior and reject a meaningful broken case independently; do not copy implementation output, drop coverage or loosen retries/timeouts/thresholds to obtain green.

Reuse valid evidence for unchanged inputs; repeat checks only for a concrete reason. Do not duplicate all CI locally by default. State what was not run and why, and preserve failures and skipped coverage.

---

## Deploy-sensitive rules

- Static-hosting migration preparation is documented in `docs/runbooks/STATIC_HOSTING_MIGRATION.md`. `config/static-hosting.json` selects the reviewed hosting target; production authority still requires the matching verified deployment receipt. No preview/upload/domain change follows from local tests alone. Preserve candidate bytes, independent active-version evidence, and the shared publication lock.

- The protected static workflow may apply supported affected backend prerequisites before the tested frontend; preserve its dependency checks and exact candidate identity.
- Keep worker routes/bindings consistent with `config/release-compat.json`.
- Apply auth migrations before deploying auth code that depends on them.
- Do not assume secrets/bindings/dashboard rules exist; verify in repo docs/config and call out manual requirements.
- Preserve current deploy ordering expectations (migrations, workers, then static) unless task explicitly changes release design.
- Follow “Completion modes”: ordinary push is a handoff; explicitly required CI/release acceptance remains part of the authorized task.

---

## Frontend-specific guardrails

- Keep vanilla JS + ES module architecture.
- Avoid layout or responsive regressions across `index`, `account/*`, and `admin` pages.
- Preserve existing image studio, saved-assets browser, folder flows, favorites, and auth-modal behavior unless explicitly changed.
- Do not switch self-hosted assets to third-party CDNs when local assets/patterns already exist.
- All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.
- All future non-admin changes must be checked and implemented for both English and German routes, pages, and locale strings.
- Public/member-facing page work must update the English and German surfaces in the same change. For Pricing specifically, changes to `pricing.html`, `de/pricing.html`, `js/pages/pricing/main.js`, `css/pages/pricing.css`, or Pricing checkout copy/tests must keep both locales feature-equivalent and preserve the same checkout behavior.
- Public pages, account/member pages, shared navigation, pricing, auth, legal links, overlays, labels, route policies, tests, and localized UI must stay in parity between English and German unless there is an explicit product reason not to.
- Member model availability is a single-source-of-truth invariant: Generate Lab/member generation surfaces and the desktop/mobile Models overlay must derive membership from the same shared contract. The overlay may advertise only currently usable member models—never the broader admin/roadmap catalog or coming-soon entries. Update that shared contract and its EN/DE parity tests together for every member model activation or deactivation; do not add a separate overlay availability array.
- Generate Lab is a separate member workspace; do not change `/generate-lab/`, `/de/generate-lab/`, or Generate Lab-specific header/layout/JS unless the task explicitly asks for it.
- The Admin area is the exception: Admin remains English-only and must not be recreated under `/de/admin` or localized unless explicitly requested later.
- Any Codex/agent implementation should inspect locale routing and German equivalents before declaring a non-admin task complete.

---

## Backend-specific guardrails

- Keep protected endpoints protected (`requireUser`/`requireAdmin` style patterns where present).
- Preserve ownership checks and private/public media boundaries.
- Keep queue/async flows idempotent and retry-safe.
- Do not silently alter JSON response shapes consumed by frontend modules/tests.

---

## Output/reporting requirements for Codex changes

At handoff, report changed files/purpose, actual checks and limitations, commit SHA(s), confirmed push and run/attempt links. Apply the appropriate completion mode; explicit acceptance reports required terminal results or the evidenced blocker. Never equate pushed, CI-passed, published and live-verified.

For substantial changes, also identify relevant schema/config/binding impact, deploy order, and manual Cloudflare follow-up. No new audit report is required by default.

## Documentation current-state rule

- Active current-state docs must stay concise and describe current reality, deploy/migration prerequisites, pending operator actions, blocked claims, and next audit entry points.
- Do not append long phase-by-phase history to active current-state docs.
- Preserve historical detail in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, or dedicated evidence files.
- Do not claim production readiness, live billing readiness, tenant isolation, access-switch readiness, ownership backfill readiness, confirmed legacy media reset readiness, or deployment completion without evidence.

## Decorative homepage media acceptance

Owner decision: dedicated decorative homepage Hero video tests and diagnostics
are removed from all automated paths; see the [coverage contract](docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#decorative-hero-acceptance).
Preserve independent Models/navigation, ordinary UI/accessibility and user-media,
Canvas, audio, generation, saving, auth, ownership, credits and security checks.
Do not change the videos or describe coverage removal as a stall repair.

## Explicit production-release continuation

When the current task explicitly includes publication, complete its supported
backend prerequisites and automatic frontend continuation in the existing
protected release job unless the owner requests an asynchronous checkpoint while CI runs. This does not authorize deployment
for other tasks. Keep exact candidate evidence, owner environment review and
publication lock. Observe required results under “Completion modes” and report
any evidenced external rights/review blocker. A mixed push skipped without
continuation is not a completed publication assignment.

Per-area model availability uses the existing Admin model-status surface and
server admission policy. Preserve independent Generation Lab/Canvas switches,
Main's single durable assistant mode, and dispatched-result recovery; see
[model area availability](docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#model-area-availability).
