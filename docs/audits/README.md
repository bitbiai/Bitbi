# Audit And Documentation Index

Last reconciled: 2026-05-21

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0060_add_app_settings.sql`.

`docs/audits/NEXT_AUDIT_BASELINE.md` is the only active audit baseline. Historical audit docs are archive/background only; they are not an active backlog unless a future fresh audit reconfirms an item from current repo state.

## Start Here

| File | Purpose |
| --- | --- |
| `docs/audits/NEXT_AUDIT_BASELINE.md` | Only active current-state baseline for future audit work. |
| `CURRENT_IMPLEMENTATION_HANDOFF.md` | Short operational restart handoff. |
| `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` | Short current audit summary. |
| `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md` | Current SaaS progress snapshot. |

## Future Audit Starter

Copy this operating rule into the next audit:

- Start from `docs/audits/NEXT_AUDIT_BASELINE.md`.
- Inspect the current repository state before using historical conclusions.
- Historical docs are background/evidence lineage only.
- Reconfirm every finding from current code, tests, docs, or live/operator evidence before treating it as active.
- Do not assume old blockers remain active unless still proven.
- Do not assume blocked claims are resolved unless live/operator evidence proves them.
- Produce new findings, scores, and roadmap from the current repository state.
- Use new finding identifiers or classifications; do not carry forward old audit IDs as active work.

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

## Active Runbooks And Policies

| Files | Purpose |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `workers/auth/AGENTS.md` | Agent/repo operation rules. |
| `.agents/skills/**/SKILL.md` | Local Codex skill instructions. |
| `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Security/community policy. |
| `docs/runbooks/*.md`, `docs/ops/*.md` | Incident/operator runbooks. |
| `docs/BACKUP_RESTORE_DRILL.md`, `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md` | Operational readiness baselines. |
| `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`, `docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md` | Current release/evidence checklist and runbook. |
| `docs/ai-image-derivatives-runbook.md` | AI derivative operational runbook. |

## Historical / Frozen Evidence

These files are not current source of truth. They may mention older migration numbers, old audit labels, or past decisions in their original context. Preserve unique evidence; do not delete or rewrite it blindly.

| Files | Status |
| --- | --- |
| `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` | Frozen historical digest. |
| `docs/audits/archive/*.md` | Archived pre-consolidation snapshots. |
| `docs/audits/archive/root-phase-reports/` | Historical root phase reports relocated out of the root. |
| `docs/audits/archive/retired-audit-root-docs/` | Retired legacy root audit docs. |
| dated `docs/tenant-assets/evidence/*.md` summaries | Evidence records; use current decision files for present status. |
| `docs/audits/archive/root-phase-reports/PHASE1_COMPLETION_HANDOFF.md`, `docs/audits/archive/root-phase-reports/PHASE2A_ENTRYPOINT.md` | Historical handoffs. |

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
| `docs/production-readiness/PHASE2_BILLING_REVIEW_STAGING_CHECKLIST.md` | Superseded historical release-slice checklist; use current main-only release docs and `config/release-compat.json` for release truth. |
| `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md` | Superseded historical release-slice checklist; use current main-only release docs and `config/release-compat.json` for release truth. |

## Documentation Rules

- Current docs explain current state, blockers, migration/deploy prerequisites, and next actions.
- Historical phase-by-phase narrative belongs in frozen historical docs only.
- The repository root is for active top-level docs only. Historical phase reports belong in `docs/audits/archive/root-phase-reports/`.
- Audit-specific plans/reports belong under `docs/audits/` or an archive. Do not create new root-level `AUDIT_*.md`, `ALPHA_AUDIT_*.md`, or `PHASE*.md` files.
- Future completed audit reports should update current state or go directly to archive, not the repository root.
- Old Omega, priority, wave, package, or phase labels are not active backlog labels unless a fresh audit explicitly reopens them.
- Active domain roadmaps are candidate design context only; future audit findings should be newly numbered or newly classified.
- Do not delete unique evidence files.
- Do not update frozen historical reports just to modernize migration numbers.
- New Markdown must be classified by doc-currentness tooling.
