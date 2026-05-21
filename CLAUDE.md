# CLAUDE.md

Root guidance for Claude/Codex work in `bitbi.ai`.

## Current Repository Reality

- BITBI is a Cloudflare-native SaaS/product codebase with a static vanilla HTML/CSS/ES module frontend.
- Static pages are deployed separately from Workers.
- Backend/runtime logic is split across Cloudflare Workers:
  - `workers/auth` for primary API, auth, admin, media, billing, tenant assets, lifecycle, and cron/queue work.
  - `workers/ai` for internal service-bound AI lab/provider routes.
  - `workers/contact` for the contact endpoint.
- Cloud resources in use include D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, and service bindings.
- The release contract is `config/release-compat.json`. Treat it as the deploy/schema source of truth.
- Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.
- Fresh audit work starts from `docs/audits/NEXT_AUDIT_BASELINE.md`, not retired root audit reports or historical phase files.

## Blocked Claims

Do not claim any of the following unless current repo evidence plus operator/live evidence proves it:

- Production readiness remains BLOCKED.
- Live billing readiness remains BLOCKED.
- Tenant isolation remains NOT CLAIMED.
- Ownership backfill readiness remains BLOCKED.
- Access-switch readiness remains BLOCKED.
- Confirmed legacy media reset readiness remains BLOCKED.
- Confirmed media deletion/reset remains NOT APPROVED.
- Remote migrations or deploys are not complete unless explicit evidence is provided.

## Permanent Rules

- Preserve the static frontend plus Cloudflare Workers architecture. Do not propose a framework rewrite unless explicitly required and technically justified.
- Self-host first. Do not use external CDNs when local fonts, scripts, images, or assets can be self-hosted.
- Use local assets under `fonts/`, `js/vendor/`, `assets/`, and `assets/favicons/` where possible.
- All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.
- Do not weaken auth, admin authorization, tenant ownership, private media, billing, credit, AI budget, or route-policy protections.
- Do not silently change JSON response shapes consumed by frontend modules or tests.

## Key Paths

- Current audit baseline: `docs/audits/NEXT_AUDIT_BASELINE.md`
- Release contract: `config/release-compat.json`
- Static pages: `index.html`, `account/`, `admin/`, `legal/`, `de/`
- Frontend modules: `js/shared/`, `js/pages/`
- Styles: `css/base/`, `css/components/`, `css/pages/`, `css/account/`, `css/admin/`
- Auth Worker: `workers/auth/src/index.js`, `workers/auth/src/routes/`, `workers/auth/src/lib/`
- AI Worker: `workers/ai/src/index.js`
- Contact Worker: `workers/contact/src/index.js`
- Auth migrations: `workers/auth/migrations/`
- Tests/harnesses: `tests/`, `playwright.config.js`, `playwright.workers.config.js`

If changing `workers/auth/*`, read `workers/auth/AGENTS.md` if present and `workers/auth/CLAUDE.md` first.

## Real Repo Commands

```bash
npm run dev
npm test
npm run test:static
npm run test:workers
npm run test:headed
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run test:doc-currentness
npm run check:route-policies
npm run test:release-compat
npm run test:release-plan
npm run validate:release
npm run release:plan
npm run release:preflight
npm run build:static
```

Worker-local commands exist but must not be run for deploys or remote migrations unless the user explicitly approves that task:

```bash
cd workers/auth && npx wrangler dev
cd workers/auth && npx wrangler deploy
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --local
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --remote
cd workers/ai && npx wrangler dev
cd workers/contact && npx wrangler dev
```

Do not invent commands. Do not run deploy or remote mutation commands during audit/docs/tooling work.

## Deploy And Migration Rules

- Static Pages deploy does not deploy Workers.
- Worker deploys are separate from static deploys.
- Apply required auth D1 migrations before deploying Auth Worker code that depends on new schema.
- Verify deploy order with `npm run release:plan` and release contracts in `config/release-compat.json`.
- Do not assume Cloudflare dashboard-managed WAF/static headers/RUM/alerts, secrets, bindings, routes, D1, R2, Queues, Durable Objects, or service bindings are live. Require operator evidence.
- Missing optional kill gates that default to safe/disabled must not be treated as release failures unless the release contract says they are required.

## Frontend Rules

- Keep vanilla JS and ES modules.
- Keep self-hosted assets.
- Maintain English/German parity for public/member changes, including pricing, account, auth, legal links, Generate Lab, shared navigation, labels, tests, and localized strings.
- Do not create `/de/admin`; Admin is English-only.
- Preserve account, assets manager, image studio, saved-assets browser, folder flows, favorites, auth modal behavior, and Generate Lab behavior unless the task explicitly changes them.

## Backend Rules

- Keep protected routes protected with the existing auth/admin/MFA patterns.
- Preserve same-origin/CSRF, body-size/content-type, idempotency, rate-limit, route-policy, and response sanitization controls.
- Do not call real AI providers, Stripe, Cloudflare APIs, GitHub settings APIs, or live BITBI endpoints from tests unless explicitly approved.
- Do not mutate production D1/R2/Queues/secrets/billing/credits during local implementation or docs work.
- Treat tenant asset ownership, manual review, and legacy media reset as high risk. Confirmed reset execution is hard-disabled by default by `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`; dry-run/reporting paths remain available.

## Documentation Hygiene

- Active docs describe current state, deploy/migration prerequisites, pending operator actions, blocked claims, and fresh audit/current work starting points.
- Do not append long phase-by-phase history to active current-state docs.
- Historical phase reports, retired root audit docs, and archive snapshots are frozen evidence. Do not rewrite them to current migration numbers.
- Do not create new root-level `PHASE*.md`, `AUDIT_*.md`, or `ALPHA_AUDIT_*.md` reports.
- Current source-of-truth docs must stay aligned with `config/release-compat.json`.

## Reporting

For substantial changes, report:

- Exact files changed.
- Why each changed.
- Migration/config/binding impact.
- Runtime/deploy impact.
- Tests/checks run and not run.
- Manual operator actions.
- Remaining risks or blocked claims.
