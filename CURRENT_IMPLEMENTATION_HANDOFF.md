# Current Implementation Handoff

Date: 2026-05-21

Purpose: short restart guide for future Codex sessions. The active baseline is `docs/audits/NEXT_AUDIT_BASELINE.md`.

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

This handoff is not production approval, live billing approval, legal compliance certification, full tenant-isolation evidence, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness.

## Current State

- Static vanilla HTML/CSS/ES modules deploy separately from Cloudflare Workers.
- Workers: `workers/auth` for primary API/auth/admin/media/billing/tenant/lifecycle work, `workers/ai` for internal AI service calls, and `workers/contact` for contact form.
- Release/deploy contract: `config/release-compat.json`.
- Historical audit detail is archive/background only; do not carry old audit labels forward unless a fresh audit reconfirms them.

## Admin Modularization

- `js/pages/admin/main.js` is now a bootstrap/composition file.
- Admin domains live in focused modules: dashboard, router, nav, activity, reference views, avatar lightbox, security, settings, users, user actions/storage, and AI Lab.
- Control Plane domains are split into readiness, billing, AI budget, lifecycle, operations, tenant assets, and tenant-assets subdomains.
- Admin high-risk flows include clearer blocked states, exact confirmations, idempotency expectations, safer evidence exports, and improved focus/modal/keyboard behavior.

## Safety And Evidence

- Current evidence-index status is `ok:true` with `unsafeCount:0`.
- Release-plan-aware static deploy safety is in `.github/workflows/static.yml`; Pages deploy does not deploy Workers or apply migrations.
- Local RC/readiness/resource/rollback tools are non-mutating evidence organizers and keep readiness blocked by default.
- `npm run test:static` most recently passed with 289 tests before this reset; rerun it when static/Admin/frontend files change.

## Current Blockers

- Production readiness and live billing readiness remain blocked.
- Live deployment state is not proven by repo files; operator verification is required.
- Remote auth migrations through the latest auth schema checkpoint in `config/release-compat.json` must be applied before dependent Auth Worker deploys.
- Tenant isolation, global ownership-backfill readiness, Access-Switch enforcement, and confirmed reset/deletion remain blocked.
- The single current safe `ai_images` ownership candidate is exact-candidate operator-execution pending only.
- Manual-review idempotency evidence remains incomplete.
- Legacy media reset dry-run evidence is rejected unsafe/stale, no sanitized replacement is accepted, and the confirmation gate remains closed.

## Do Not Do

- Do not deploy, run remote migrations, or run `npm run release:apply` during docs/audit reset work.
- Do not mutate Workers, API shapes, auth/admin protections, billing behavior, tenant ownership, reset controls, or release workflow behavior.
- Do not delete archive evidence or rewrite historical reports just to make them current.
- Do not claim production readiness, live billing readiness, tenant isolation, access-switch readiness, ownership-backfill readiness, or confirmed reset readiness without current evidence.

## Restart Commands

```bash
git status --short
npm run check:doc-currentness
npm run test:doc-currentness
npm run evidence:index
npm run release:plan
npm run validate:release
npm run test:release-compat
git diff --check
```

Use broader validation such as `npm run release:preflight` before merging substantial or release-sensitive changes.

## Recommended Next Work

Recommended next track: Fresh Deep Audit From Current Baseline.

Future auditors should start from `docs/audits/NEXT_AUDIT_BASELINE.md`, inspect current code/tests/docs/evidence, and produce new findings and scores from current repository state. Historical reports remain evidence/background only.
