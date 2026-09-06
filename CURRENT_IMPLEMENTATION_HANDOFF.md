# Current Implementation Handoff

Date: 2026-09-06

Purpose: short restart guide for future Codex sessions. The active baseline is `docs/audits/NEXT_AUDIT_BASELINE.md`.

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

This handoff is not production approval, live billing approval, legal compliance certification, full tenant-isolation evidence, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness.

## Current State

- Static vanilla HTML/CSS/ES modules deploy separately from Cloudflare Workers.
- Workers: `workers/auth` for primary API/auth/admin/media/billing/tenant/lifecycle work, `workers/ai` for internal AI service calls, and `workers/contact` for contact form.
- Release/deploy contract: `config/release-compat.json`.
- Historical audit detail is archive/background only; do not carry old audit labels forward unless a fresh audit reconfirms them.
- OMA2 Q1 is a static-only change: Canvas saves retain identity-scoped patches and failed work; image saves retain their original result/metadata/folder; organization responses and checkout actions use a confirmed current context. No Worker, schema or API contract change is included.
- Admin storage counts remain a dated historical baseline, not a current inventory pass. Capability availability, upload outcomes and interrupted assistant streams distinguish evidence, failure and completion. Interrupted text is excluded from follow-up assistant history.
- Authorized commit/push work ends after local checks, diff review and confirmed foreground push, under root `AGENTS.md`, "Commit/push completion: no CI waiting". Stefan owns CI and live-release verification.
- OMA2 Q2 is an Auth Worker candidate only: atomic lifecycle cleanup release, resumable credit-pack fulfillment and single-use MFA with preserved cookie headers. Its additive schema inputs are 0082 and 0083; no production activation is included. See `docs/runbooks/OMA2_Q2_RELEASE.md` for package-specific recovery gates and test scope.

## Admin Modularization

- `js/pages/admin/main.js` is now a bootstrap/composition file.
- Admin domains live in focused modules: dashboard, router, nav, activity, reference views, avatar lightbox, security, settings, users, user actions/storage, and AI Lab.
- Control Plane domains are split into readiness, billing, AI budget, lifecycle, operations, tenant assets, and tenant-assets subdomains.
- Admin high-risk flows include clearer blocked states, exact confirmations, idempotency expectations, safer evidence exports, and improved focus/modal/keyboard behavior.

## Safety And Evidence

- Current evidence-index status is `ok:true` with `unsafeCount:0`.
- Release-plan-aware static deploy safety is in `.github/workflows/static.yml`; Pages deploy does not deploy Workers or apply migrations.
- Local RC/readiness/resource/rollback tools are non-mutating evidence organizers and keep readiness blocked by default.
- Q1 regression entrypoints are `tests/oma2-q1-canvas.spec.js`, `tests/oma2-q1-member.spec.js` and `tests/oma2-q1-admin.spec.js`; run them with the relevant existing frontend suites in a safe local fixture environment. Local results do not verify deployed functionality.

## Current Blockers

- Production readiness and live billing readiness remain blocked.
- Live deployment state is not proven by repo files; operator verification is required.
- Remote auth migrations through the latest auth schema checkpoint in `config/release-compat.json` must be applied before dependent Auth Worker deploys.
- REL-01 code adds durable provider outcomes and dispatch/settlement guards. A bounded read on 2026-09-06 observed the migration receipt named 0081 and Auth version `a7aec8ca-170b-48b7-8564-821ad93d9e1f` at 100% traffic. These metadata do not establish complete SQL or bundle/input identity. Unknown attempts remain fenced after reservation expiry; older Workers are not a safe mixed-version recovery policy. Q2 activation remains pending separate approval and compatible recovery evidence.
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

The next decision is the separately authorized Q2 Auth/schema release after its specific recovery gates. Q2 does not close the full OMA2 audit, historical migration repair or the separate queue/receipt/memory packages. Do not start another package or any cloud activation automatically.

## Transition-fenced 0081 successor

The repository 0081 establishes read-only legacy attempt/job views over canonical `_v2` tables and requires an internal claim token on AI ledger debits. Existing ambiguous identities remain fenced; accepted old provider work does not authorize a replacement. Preserve the applied migration history. Earlier 54e89/237e bundles are incompatible recovery versions; a receipt bearing the migration name alone is insufficient evidence of SQL identity. Private release records retain dated metadata and unresolved artifact identity.
