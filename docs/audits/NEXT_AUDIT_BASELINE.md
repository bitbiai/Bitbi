# Current Repository Baseline - Clean Audit Restart

Baseline reset: 2026-05-21

This file is the only active audit baseline for `bitbi.ai`. Start future audit work here, inspect the current repository state, and treat historical audit reports as archive/background only unless a fresh audit reconfirms an issue from current code, tests, docs, or operator evidence.

This baseline is not production readiness, live billing readiness, tenant isolation, ownership-backfill readiness, access-switch readiness, confirmed legacy media reset readiness, legal compliance certification, deploy approval, or proof that live systems match the repository.

## Current Architecture

- Frontend: static vanilla HTML/CSS/ES modules, deployed separately from Workers through GitHub Pages.
- Backend: Cloudflare Workers in `workers/auth`, `workers/ai`, and `workers/contact`.
- Auth Worker: primary API, auth, admin, media, billing, tenant assets, lifecycle, cron, queues, and Admin evidence surfaces.
- AI Worker: internal service-bound AI lab/provider routes with caller-policy and service-auth protections.
- Contact Worker: contact form endpoint with its own rate-limit Durable Object.
- Cloud resources modeled in repo: D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, service bindings, Worker routes, cron, and dashboard-managed prerequisites.
- Admin remains English-only. Public/member runtime work still requires English/German parity.

## Admin Frontend Structure

- `js/pages/admin/main.js` is a compact bootstrap/composition entrypoint.
- Top-level Admin modules now include `dashboard.js`, `router.js`, `nav.js`, `activity.js`, `reference-views.js`, `avatar-lightbox.js`, `ui.js`, `security.js`, `settings.js`, `users.js`, `user-actions.js`, and `user-storage.js`.
- Admin Control Plane domains are split under `js/pages/admin/control-plane/`: readiness, billing, AI budget, lifecycle, operations, tenant assets, and guidance.
- Tenant asset subdomains are split under `js/pages/admin/control-plane/tenant-assets/`: evidence, manual review, backfill/access-switch, and legacy reset.
- Admin high-risk flows include clearer blocked-state copy, exact confirmations, idempotency expectations, focus/modal/keyboard behavior, and read-only evidence exports where applicable.

## Release And Deploy Safety

- Release contract source: `config/release-compat.json`.
- Latest auth D1 migration: read `release.schemaCheckpoints.auth.latest` from that contract; current docs must not duplicate the filename.
- Deploy units and ordering must come from `npm run release:plan`.
- Static Pages deploy is release-plan-aware in `.github/workflows/static.yml`; it does not deploy Workers or apply migrations.
- Expected deploy model: auth migrations first when required, then AI Worker before dependent Auth Worker changes, then Auth Worker, Contact Worker, and static site as reported by the release plan.
- Repo files do not prove remote migrations, Worker deploy state, static Pages deploy state, live secrets, live bindings, dashboard settings, or Cloudflare resource presence.

## Evidence And Checks

- Evidence index reset status: `ok:true` and `unsafeCount:0` from repo-local evidence indexing.
- Most recent pre-reset static context recorded `npm run test:static` passing with 289 tests; rerun it when static/Admin/frontend files change.
- Required docs/release reset checks are listed in `CURRENT_IMPLEMENTATION_HANDOFF.md` and should pass before merge.
- Local tests, local dossiers, local evidence indexes, and repo declarations remain local evidence only.

## Implemented Current State

- Admin Control Plane surfaces exist for users, billing evidence/reviews/reconciliation, Live Billing Command Center, lifecycle, readiness/evidence, AI Lab, AI usage, platform budget controls, tenant assets, operations, and registration availability.
- Admin Control Plane modularization is complete enough that `main.js` is no longer the large domain implementation file.
- Release Candidate, release-plan, static-deploy-safety, release-cutover, readiness dossier, Cloudflare resource model, rollback drill, and main-release-readiness tooling exist as local non-mutating aids.
- Evidence Index classifies local repo evidence without live R2 listing or raw unsafe value output.
- Auth/admin high-risk route guardrails exist: Admin/MFA policy, same-origin/Fetch Metadata protections, body/type limits, rate limits, idempotency, exact confirmations, redaction, and audit logging where implemented.
- Data Lifecycle planning, approval, safe execution where backend policy allows, final states, retained-category evidence, and JSON/Markdown/HTML evidence exports exist.
- Tenant Asset Center, Manual Review post-cleanup classifier/export/supersession support, Ownership Backfill dry-run/exact-candidate controls, Access-Switch shadow diagnostics, and Legacy Media Reset status/evidence controls exist with blocked-state language.
- AI cost/platform budget controls exist for member image/music/video paths and selected admin/platform routes.

## Blocked And Unclaimed

- Production readiness remains blocked until live/operator evidence is collected and reviewed.
- Live billing readiness remains blocked until Stripe dashboard, Customer Portal where configured, webhook, invoice, duplicate-event, wrong Price ID, no-credit-before-webhook, tax/invoice review, and live canary evidence exists and is reviewed.
- Tenant isolation remains unclaimed.
- Ownership backfill readiness remains blocked except for specifically reviewed current evidence and separately approved exact-candidate execution.
- Access-Switch enforced mode remains blocked until current evidence, switch policy, tests, and rollback model support it.
- Confirmed legacy media reset remains blocked; `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` must stay disabled unless a separately approved operator change proves otherwise.
- Full legal/GDPR erasure completion is claimable only per completed Data Lifecycle request evidence; operational admin delete is not full legal erasure by itself.

## Future Audit Starter

1. Start from this file.
2. Inspect current repo state, release contract, migrations, Admin modules, tests, and current evidence.
3. Use historical docs only for background, evidence lineage, or understanding why a guard exists.
4. Reconfirm every finding from current code, tests, docs, or live/operator evidence before treating it as active.
5. Do not assume old blockers remain active unless they are still proven.
6. Do not assume blocked claims are resolved unless live/operator evidence proves them.
7. Produce new findings, scores, and roadmap from the current repository state.

## Archive Background

Historical detail remains preserved in `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and `docs/tenant-assets/evidence/`. Do not delete or rewrite unique evidence just to simplify the tree.
