# Current Implementation Handoff

Date: 2026-05-19

Purpose: short restart guide for future Codex sessions. The primary current-state baseline is `docs/audits/NEXT_AUDIT_BASELINE.md`.

Current release truth: latest auth D1 migration is `0059_add_data_lifecycle_completion_state.sql`.

This handoff is not production approval, live billing approval, legal compliance certification, full tenant-isolation evidence, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness.

## Current Repo Shape

- Static vanilla HTML/CSS/ES modules deploy separately from Cloudflare Workers.
- Workers: `workers/auth` for primary API/auth/admin/media, `workers/ai` for internal AI service calls, and `workers/contact` for contact form.
- Release/deploy contract: `config/release-compat.json`.
- Documentation start point: `docs/audits/NEXT_AUDIT_BASELINE.md`.
- Historical detail: `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and tenant evidence docs.

## Current Implemented State

- Auth/session/admin MFA/service-auth/route-policy/rate-limit/body-size/secret-purpose hardening exists.
- Admin Control Plane surfaces implemented operator tools for users, Operator Timeline/Triage, billing evidence, billing reviews/reconciliation, lifecycle, readiness/evidence status, AI Lab, AI usage, budget switches, caps, repair, reports, archives, and tenant manual-review visibility.
- Admin Readiness now includes a Production Execution Framework panel for repo-supported/deploy-pending/live-evidence-pending state, Cloudflare resource model, readiness dossier, post-deploy read-only verification, and rollback drill copy-only commands.
- Admin-only `GET /api/admin/operations/timeline` aggregates bounded redacted local D1 operational metadata without external calls, live R2 listing, or mutations. Local `npm run evidence:index` / `npm run evidence:index:markdown` inventories repo evidence and classifies unsafe markers without printing raw values.
- Local `npm run readiness:dossier`, `npm run cloudflare:resource-model`, and `npm run release:rollback-drill` provide a non-mutating production execution packet, repo-vs-live Cloudflare resource model, and rollback drill artifact. They keep readiness blocked and do not call Cloudflare/GitHub/Stripe/providers.
- Local Release Candidate tooling now exists: `npm run release:rc` / `npm run release:rc:markdown` generate the Go/No-Go manifest, and `npm run rc:check` prints the final RC validation matrix by default. These are local-only and keep production readiness/live billing blocked.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, guarded Stripe scaffolding, BITBI Pro scaffolding, read-only billing evidence status, and blocked billing canary skeleton tooling exist.
- Member image/music/video AI Cost Gateway paths, selected admin/platform budget controls, and Auth/AI caller-policy release compatibility checks exist.
- Data lifecycle planning/export/archive/cleanup, safe execution, final completion, close/reject, retained-category evidence, and JSON/Markdown/HTML evidence packet foundations exist; high-risk lifecycle writes require `Idempotency-Key`, confirmation where needed, Admin/MFA, rate limiting, and audit logging.
- Tenant asset ownership work exists for folders/images: ownership metadata columns, new personal-write metadata, read diagnostics/evidence, manual-review import/queue/status/Admin visibility, and operator evidence decisions.
- Admin Tenant Isolation Execution controls now group Ownership Backfill, Runtime Access-Switch, and Legacy Media Reset. The cards show warning/exclamation explainers, dry-run or shadow diagnostics, redacted evidence export, exact confirmation requirements, and disabled reasons. Backfill writes are strictly limited to safe classified folder/image rows when explicitly confirmed; Access-Switch enforcement and confirmed Reset remain blocked.
- Legacy media reset work exists: read-only dry-run/reporting, executor design, reset action/event tables, a dry-run-default executor path, and evidence decision docs. Confirmed execution is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved confirmation phase.

## Current Blockers

- Production readiness and live billing readiness are blocked.
- Live deployment state is not proven by repo files; operator verification is required.
- Remote auth migrations through `0059_add_data_lifecycle_completion_state.sql` must be applied before dependent Auth Worker deploys.
- Auth/AI caller-policy runtime changes require paired AI Worker then Auth Worker review/deploy ordering.
- Existing legacy `ai_folders`/`ai_images` rows remain mixed/null/unclassified; access checks still use existing runtime behavior.
- Tenant isolation, access-switch enforcement, global ownership-backfill readiness, and confirmed reset/deletion remain blocked. Use Backfill dry-run/evidence first, Access-Switch shadow diagnostics second, and Reset dry-run/evidence only after those are reviewed.
- Manual-review evidence still needs import replay, import conflict, successful standalone status-update response, status replay, and status conflict evidence.
- Legacy media reset dry-run decision is rejected unsafe because prior live evidence exposed a raw idempotency key; the raw JSON is not present in the current checkout, no sanitized replacement is present, and the confirmation gate remains closed.
- Cloudflare WAF/static headers/RUM/alerts, secrets, bindings, resource live presence, restore drill, rollback evidence, Stripe dashboard/webhook setup, and live billing canaries still require operator evidence. Checkout creation does not grant credits; verified webhook/payment/invoice events are required. Refund/dispute/payment-failure handling remains review-only.
- Operator timeline and evidence index are repo/admin evidence aids only; they do not prove production readiness or authorize dangerous actions.

## Read First

1. `docs/audits/NEXT_AUDIT_BASELINE.md`
2. `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`
3. `docs/audits/README.md`
4. `config/release-compat.json`
5. `docs/production-readiness/README.md`
6. `docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md`
7. `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md`
8. `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`
9. `workers/auth/CLAUDE.md`

## Restart Commands

```bash
git status --short
git log --oneline -10
npm run check:doc-currentness
npm run release:plan
npm run evidence:index
npm run rc:check
npm run release:rc:markdown
npm run readiness:dossier
npm run cloudflare:resource-model
npm run release:rollback-drill
```

For documentation-only changes, run:

```bash
npm run check:js
npm run check:secrets
npm run test:doc-currentness
npm run check:doc-currentness
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run release:plan
git diff --check
```

Use `npm run release:preflight` before merging substantial or release-sensitive changes.

## Recommended Next Work

Recommended next audit entry point: `NEXT-AUDIT-1 - Fresh Deep Audit From Current Baseline`.

If continuing tenant reset work first, collect a sanitized dry-run evidence package with `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` before any confirmation-review or destructive reset planning.

## Documentation Rule

Do not append phase-by-phase history here. Update current state only, and preserve historical detail in the audit archive/changelog or dedicated evidence reports.
