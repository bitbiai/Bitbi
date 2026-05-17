# Alpha Audit Phase Changelog

Last updated: 2026-05-17

Status: historical/reference. This file preserves concise phase history so active current-state docs do not grow with every implementation phase.

Current release truth at DOC-1: latest auth D1 migration is `0055_add_platform_budget_evidence_archives.sql`.

## Phase Families

| Range | Summary | Evidence |
| --- | --- | --- |
| Phase 0 | Immediate security/static/package remediation and Cloudflare prereq validation. | `PHASE0_REMEDIATION_REPORT.md`, `PHASE0B_REMEDIATION_REPORT.md` |
| Phase 1 | Async admin video, route policy, operational readiness, audit/activity search, data lifecycle, export/archive, cleanup, and safe executor foundations. | `PHASE1*.md`, `AI_VIDEO_ASYNC_JOB_DESIGN.md` |
| Phase 2 | Organization/RBAC, billing/entitlements/credits, provider billing events, guarded Stripe Testmode/live scaffolding, member credit buckets, BITBI Pro scaffolding, billing review/reconciliation, and Admin Control Plane foundations. | `PHASE2*.md`, `PHASE_ADMIN_CONTROL_PLANE_REPORT.md`, `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md`, `PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md` |
| Phase 3 | AI Cost Gateway design, operation registry, policy baseline, member image/music/video gateway migrations, and replay/finalization/cleanup hardening. | `docs/ai-cost-gateway/*`, `PHASE3` entries in current docs, related tests/checks |
| Phase 4.1-4.14 | Admin/platform AI budget policy, budget metadata, admin video jobs, News Pulse visuals, caller-policy validation, admin text/embeddings/music/compare/live-agent idempotency, sync video debug retirement, and Admin Image branch classification. | `docs/ai-cost-gateway/*`, operation registry/checks, route-policy tests |
| Phase 4.15 | Runtime Cloudflare master budget switch enforcement for already classified admin/platform provider-cost paths. | `workers/auth/src/lib/admin-platform-budget-switches.js`, tests/checks |
| Phase 4.15.1 | D1/Admin UI app-level budget switch control plane on top of Cloudflare master flags. | Migration `0052_add_admin_runtime_budget_switches.sql`, admin APIs/UI/tests |
| Phase 4.16 | Live platform budget cap design/evidence only; no runtime cap enforcement in that phase. | `docs/ai-cost-gateway/LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md` |
| Phase 4.17 | First narrow `platform_admin_lab_budget` cap foundation. | Migration `0053_add_platform_budget_caps.sql`, cap helper/APIs/UI/tests |
| Phase 4.18 | Read-only platform budget usage reconciliation and repair candidates. | `platform-budget-reconciliation` helper/API/UI/tests |
| Phase 4.19 | Explicit admin-approved repair executor for safe local usage-evidence inconsistencies. | Migration `0054_add_platform_budget_repair_actions.sql`, repair helper/API/UI/tests |
| Phase 4.20 | Read-only repair evidence report/export. | `platform-budget-repair-report` helper/API/UI/tests |
| Phase 4.21 | Sanitized evidence archive/retention workflow under `AUDIT_ARCHIVE` prefix `platform-budget-evidence/`. | Migration `0055_add_platform_budget_evidence_archives.sql`, archive helper/API/UI/tests |
| Phase 5.1 | Admin Control Plane UX/navigation consolidation for existing operator capabilities only. | Admin HTML/CSS/JS/tests |
| DOC-1 | Documentation diet, archive consolidation, concise current docs, and currentness checks. | `docs/audits/README.md`, `docs/audits/archive/`, doc-currentness scripts/tests |

## Rules For Future Entries

- Add one concise row per future phase family or substantial milestone.
- Link to detailed evidence instead of pasting final responses into active docs.
- Do not rewrite historical phase reports to current migrations.
- Do not claim production/live billing readiness without evidence.
