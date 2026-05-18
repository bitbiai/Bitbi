# Audit And Documentation Index

Last reconciled: 2026-05-18

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0058_add_legacy_media_reset_actions.sql`.

DOC-2 makes `docs/audits/NEXT_AUDIT_BASELINE.md` the clean starting point for the next deep audit. Active docs should describe current state only; historical phase narrative is frozen separately.

## Start Here

| File | Purpose |
| --- | --- |
| `docs/audits/NEXT_AUDIT_BASELINE.md` | Primary current-state baseline for future audit work. |
| `CURRENT_IMPLEMENTATION_HANDOFF.md` | Short operational restart handoff. |
| `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` | Short current audit summary. |
| `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md` | Current SaaS progress snapshot. |
| `AUDIT_ACTION_PLAN.md` | Current remediation priorities. |
| `ALPHA_AUDIT_2026_05_15.md` | Active scorecard, no phase log. |
| `AUDIT_NEXT_LEVEL.md` | Compact next-audit checkpoint. |

## Active Current Source Of Truth

These files must stay aligned with `config/release-compat.json` and must not claim production readiness, live billing readiness, legal compliance, full SaaS maturity, full tenant isolation, access-switch readiness, ownership backfill readiness, or confirmed media reset readiness without evidence.

| File | Purpose |
| --- | --- |
| `README.md` | Repository overview and release-truth warning. |
| `DATA_INVENTORY.md` | Current engineering data inventory. |
| `docs/DATA_RETENTION_POLICY.md` | Current retention baseline. |
| `docs/privacy-data-flow-audit.md` | Current privacy/data-flow engineering audit for legal review. |
| `docs/production-readiness/README.md` | Production-readiness guardrails. |
| `docs/production-readiness/EVIDENCE_TEMPLATE.md` | Production evidence template. |
| `docs/ai-cost-gateway/README.md` | AI cost gateway current index. |
| `docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md` | Admin/platform AI budget policy. |
| `docs/ai-cost-gateway/LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md` | Live platform budget cap design/current cap foundation notes. |
| `workers/auth/CLAUDE.md` | Auth Worker operational context and route/deploy guidance. |

## Active Domain Docs

| Area | Files |
| --- | --- |
| Tenant assets | `docs/tenant-assets/*.md`, plus current decisions/indexes under `docs/tenant-assets/evidence/`. |
| AI cost gateway | `docs/ai-cost-gateway/*.md`. |
| Async video | `AI_VIDEO_ASYNC_JOB_DESIGN.md`. |

## Active Runbooks And Policies

| Files | Purpose |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `workers/auth/AGENTS.md` | Agent/repo operation rules. |
| `.agents/skills/**/SKILL.md` | Local Codex skill instructions. |
| `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Security/community policy. |
| `docs/runbooks/*.md`, `docs/ops/*.md` | Incident/operator runbooks. |
| `docs/BACKUP_RESTORE_DRILL.md`, `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md` | Operational readiness baselines. |
| `docs/production-readiness/*CHECKLIST.md`, `docs/production-readiness/*RUNBOOK.md` | Release/evidence checklists and runbooks. |
| `docs/ai-image-derivatives-runbook.md` | AI derivative operational runbook. |

## Historical / Frozen Evidence

These files are not current source of truth. They may mention older migration numbers or past decisions in their original context.

| Files | Status |
| --- | --- |
| `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` | Frozen historical digest. |
| `docs/audits/archive/*.md` | Archived pre-consolidation snapshots. |
| root `PHASE*.md` reports | Frozen implementation evidence. |
| dated `docs/tenant-assets/evidence/*.md` summaries | Evidence records; use current decision files for present status. |
| `PHASE1_COMPLETION_HANDOFF.md`, `PHASE2A_ENTRYPOINT.md` | Historical handoffs. |

## Superseded Or Stale Context

Keep these files for context only. Reconcile with the current baseline before reuse.

| File | Status |
| --- | --- |
| `docs/privacy-compliance-audit.md` | Superseded by `docs/privacy-data-flow-audit.md` for current engineering flow. |
| `docs/privacy-text-followup.md` | Historical privacy-copy follow-up. |
| `docs/codebase-issue-task-proposals.md` | Historical proposal backlog. |
| `docs/cloudflare-rate-limiting-wave1.md` | Historical/dashboard-managed WAF note. |
| `docs/gallery-exclusive-little-monster-cleanup.md` | Historical cleanup note; no deletion without live verification. |
| `docs/soundlab-free-exclusive-cleanup.md` | Historical cleanup note; no deletion without live verification. |

## Documentation Rules

- Current docs explain current state, blockers, migration/deploy prerequisites, and next actions.
- Historical phase-by-phase narrative belongs in frozen historical docs only.
- Do not delete unique evidence files.
- Do not update frozen historical reports just to modernize migration numbers.
- New Markdown must be classified by doc-currentness tooling.
