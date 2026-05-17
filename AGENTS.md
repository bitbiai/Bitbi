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
- Static deployment is GitHub Pages via `.github/workflows/static.yml`.
- Workers deploy separately from static Pages deploy.

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

## Documentation hygiene

- Keep active current-state docs concise. Do not append full phase history to `CURRENT_IMPLEMENTATION_HANDOFF.md`, `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, or `ALPHA_AUDIT_2026_05_15.md`.
- Put detailed phase outcomes in a dedicated phase report, final response, or `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`.
- Preserve historical phase reports as frozen evidence. Do not rewrite them to current migration numbers.
- Use `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` for the restart/current audit snapshot and `docs/audits/README.md` for documentation classification.
- Current source-of-truth docs must mention the latest auth migration from `config/release-compat.json` and must not claim production readiness or live billing readiness without recorded evidence.
- Docs remain English. Public/member-facing runtime changes still require English/German product parity; admin docs and admin-only UI remain English unless explicitly requested.

---

## Validation expectations (proportional)

Run the smallest set that truly covers changed surfaces:

- Static/UI changes: `npm run test:static`
- Worker route/contract changes: `npm run test:workers`
- Release/config/migration/binding changes: `npm run test:release-compat`, `npm run validate:release`
- Asset version/build-pipeline changes: `npm run test:asset-version`, `npm run validate:asset-version`, `npm run build:static`

If you cannot run something, state exactly what was not run and why.

---

## Deploy-sensitive rules

- Static Pages deploy (`.github/workflows/static.yml`) does **not** deploy workers.
- Keep worker routes/bindings consistent with `config/release-compat.json`.
- Apply auth migrations before deploying auth code that depends on them.
- Do not assume secrets/bindings/dashboard rules exist; verify in repo docs/config and call out manual requirements.
- Preserve current deploy ordering expectations (migrations, workers, then static) unless task explicitly changes release design.

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

When finishing substantial work, include:

- Exact files changed (and added/removed if any)
- Why each change was made
- Any schema/migration/config/binding impact
- Any manual Cloudflare/dashboard follow-up required
- Tests/checks run, plus what was not run
- Known risks/limitations

Keep reports concrete and repository-specific.
