# Current Implementation Handoff

Date: 2026-05-18

Purpose: short restart guide for future Codex sessions. The primary current-state baseline is `docs/audits/NEXT_AUDIT_BASELINE.md`.

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

This handoff is not production approval, live billing approval, legal compliance certification, full tenant-isolation evidence, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness.

## Current Repo Shape

- Static vanilla HTML/CSS/ES modules deploy separately from Cloudflare Workers.
- Workers: `workers/auth` for primary API/auth/admin/media, `workers/ai` for internal AI service calls, and `workers/contact` for contact form.
- Release/deploy contract: `config/release-compat.json`.
- Documentation start point: `docs/audits/NEXT_AUDIT_BASELINE.md`.
- Historical detail: `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, `docs/audits/archive/`, `docs/audits/archive/root-phase-reports/`, `docs/audits/archive/retired-audit-root-docs/`, and tenant evidence docs.

## Current Implemented State

- Auth/session/admin MFA/service-auth/route-policy/rate-limit/body-size/secret-purpose hardening exists.
- Admin Control Plane surfaces implemented operator tools for users, billing, lifecycle, AI Lab, AI usage, budget switches, caps, reconciliation, repair, reports, archives, and tenant manual-review visibility.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, guarded Stripe scaffolding, and BITBI Pro scaffolding exist.
- Member image/music/video AI Cost Gateway paths and selected admin/platform budget controls exist.
- Data lifecycle planning/export/archive/cleanup foundations exist.
- Tenant asset ownership work exists for folders/images: ownership metadata columns, new personal-write metadata, read diagnostics/evidence, manual-review import/queue/status/Admin visibility, and operator evidence decisions.
- Legacy media reset work exists: read-only dry-run/reporting, executor design, reset action/event tables, a dry-run-default executor path, and evidence decision docs. Confirmed execution is hard-disabled by default unless optional gate `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` is exactly enabled in a future approved confirmation phase.

## Current Blockers

- Production readiness and live billing readiness are blocked.
- Live deployment state is not proven by repo files; operator verification is required.
- Remote auth migrations through `0058_add_legacy_media_reset_actions.sql` must be applied before dependent Auth Worker deploys.
- Existing legacy `ai_folders`/`ai_images` rows remain mixed/null/unclassified; access checks still use existing runtime behavior.
- Ownership backfill, access-switching, tenant isolation, and confirmed reset/deletion remain blocked.
- Manual-review evidence still needs idempotency replay/conflict completion.
- Legacy media reset dry-run decision is rejected unsafe because prior live evidence exposed a raw idempotency key; the raw JSON is not present in the current checkout, no sanitized replacement is present, and the confirmation gate remains closed.
- Cloudflare WAF/static headers/RUM/alerts, secrets, bindings, restore drill, rollback evidence, and Stripe/live billing canaries still require operator evidence.

## Read First

1. `docs/audits/NEXT_AUDIT_BASELINE.md`
2. `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`
3. `docs/audits/README.md`
4. `config/release-compat.json`
5. `docs/production-readiness/README.md`
6. `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md`
7. `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`
8. `workers/auth/CLAUDE.md`

## Restart Commands

```bash
git status --short
git log --oneline -10
npm run check:doc-currentness
npm run release:plan
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
