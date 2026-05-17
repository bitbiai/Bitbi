# Current Implementation Handoff

Date: 2026-05-17

Purpose: concise restart point for future Codex sessions. This file is current source of truth for where to restart, not a phase log. Historical implementation detail is preserved in `docs/audits/archive/`, `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, and the root `PHASE*.md` reports.

## Current Release Truth

| Item | Current state |
| --- | --- |
| Branch | `main` |
| Latest completed implementation phase | Phase 6.6 read-only AI folder/image ownership metadata diagnostics |
| Latest documentation phase | DOC-1 documentation diet and archive consolidation |
| Latest auth D1 migration | `0056_add_ai_folder_image_ownership_metadata.sql` |
| Latest AI Worker Durable Object migration | `v1-service-auth-replay` |
| Production readiness | BLOCKED |
| Live billing readiness | BLOCKED |

This handoff is not production approval, live billing approval, legal compliance certification, or full tenant-isolation evidence.

## Current System Shape

- Static vanilla HTML/CSS/ES modules on GitHub Pages.
- Cloudflare Workers for auth/admin/media/billing/AI/contact.
- Auth Worker uses D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, and service bindings.
- Release truth lives in `config/release-compat.json`.
- Current docs are indexed in `docs/audits/README.md`.

## Current Implemented Foundations

- Auth, session, MFA, route-policy, service-auth, limiter, body-size, and secret-purpose hardening.
- Admin Control Plane with grouped navigation, billing review/reconciliation panels, lifecycle tools, AI Lab, AI usage attempts, AI budget switches, platform budget caps, reconciliation, repair, report/export, and evidence archives.
- Organization/RBAC, billing/credits/entitlements, member credit buckets, BITBI Pro scaffolding, and guarded live credit-pack/subscription paths.
- Member image, music, and video AI Cost Gateway coverage with required idempotency, duplicate suppression, replay-unavailable safety, and no-charge provider failure paths.
- Admin/platform AI budget controls for the classified routes, including Cloudflare master switches, D1 app switches, the first `platform_admin_lab_budget` cap foundation, reconciliation evidence, explicit admin-approved repair actions, report/export, and sanitized archives.
- Data lifecycle planning, export archive generation/download, safe cleanup, and reversible executor foundations.
- Tenant-owned asset migration design, source/schema inventory, risk matrix, focused `ai_folders`/`ai_images` owner-map dry-run scripts, schema/access impact plan, nullable ownership metadata columns, new personal folder/image write metadata assignment, and read-only dual-read diagnostics exist; no old-row ownership backfill, organization ownership assignment, access-check switch, or R2 objects were migrated.

## Current Blockers

- Remote auth migrations through `0056_add_ai_folder_image_ownership_metadata.sql` must be applied before deploying auth Worker code that depends on those tables.
- Required Worker secrets and bindings must be verified without printing values.
- Stripe Testmode, live credit-pack, and BITBI Pro subscription canaries require explicit operator flags and evidence; live billing remains blocked.
- Cloudflare WAF/static headers/RUM/alerts remain dashboard-managed or manual evidence items.
- Restore drill, live health checks, security-header checks, queue/R2/D1 verification, and rollback evidence are still required.
- Tenant-owned asset admin/staging evidence, org-owned write assignment, old-row owner-map/backfill, self-service privacy flows, legal-approved billing remediation, invoices/customer portal/tax, and broad remaining internal AI Worker route coverage remain future work.

## Read First

1. `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`
2. `docs/audits/README.md`
3. `config/release-compat.json`
4. `docs/production-readiness/README.md`
5. `docs/production-readiness/EVIDENCE_TEMPLATE.md`
6. `docs/ai-cost-gateway/README.md`
7. `docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md`
8. `docs/ai-cost-gateway/LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md`
9. `DATA_INVENTORY.md`
10. `workers/auth/CLAUDE.md`

Historical phase evidence is frozen in root `PHASE*.md` reports and pre-DOC-1 snapshots under `docs/audits/archive/`.

## Restart Checklist

```bash
git status --short
git log --oneline -10
npm run check:doc-currentness
npm run release:plan
```

For documentation-only changes, run at least:

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

1. Collect operator evidence for migrations through `0056`, Admin Control Plane budget panels, platform cap behavior, repair/report/archive behavior, tenant schema compatibility, Phase 6.5 new-write metadata behavior, Phase 6.6 diagnostics output, and AI cost policy checks.
2. Verify Stripe Testmode and live billing canaries only in bounded operator windows with the relevant flags intentionally enabled.
3. Choose one focused next implementation track: Phase 6.7 tenant asset ownership admin evidence report or staging owner-map evidence collection, next budget scope, remaining internal caller-policy gap, billing remediation workflow, or production evidence collection.

## Documentation Rule

Do not append full phase history here. Add detailed phase evidence to a dedicated phase report or `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`, then keep this handoff as a concise restart guide.
