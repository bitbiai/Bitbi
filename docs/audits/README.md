# Audit And Documentation Index

Last reconciled: 2026-05-16

Current release truth: `config/release-compat.json` declares the latest auth D1 migration as `0049_add_admin_video_job_budget_metadata.sql`.

This index classifies first-party audit, report, policy, runbook, and handoff Markdown files. No first-party Markdown is deleted in this phase. Historical reports remain historical evidence and should not be rewritten to pretend they were originally about later migrations.

## Current Source Of Truth

These files should match the current release contract and must not claim production readiness, full SaaS maturity, full tenant isolation, full privacy compliance, or live billing readiness without evidence.

| File | Status | Reason |
| --- | --- | --- |
| `README.md` | Keep/current | Repository overview and current release-truth warning. |
| `CURRENT_IMPLEMENTATION_HANDOFF.md` | Keep/current | Concise current-state restart handoff. |
| `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md` | Keep/current | Current SaaS progress, blockers, and roadmap. |
| `AUDIT_ACTION_PLAN.md` | Keep/current | Current remediation tracker and production blocker list. |
| `AUDIT_NEXT_LEVEL.md` | Keep/update | Hybrid current checkpoint plus preserved original audit baseline. Current-status sections must stay reconciled; lower baseline sections are historical. |
| `DATA_INVENTORY.md` | Keep/current | Current engineering data inventory. |
| `docs/DATA_RETENTION_POLICY.md` | Keep/current | Current engineering retention baseline. |
| `docs/privacy-data-flow-audit.md` | Keep/current | Current privacy/data-flow engineering audit for legal review. |
| `workers/auth/CLAUDE.md` | Keep/current | Auth Worker operating context, routes, config, and latest migration inventory. |
| `ALPHA_AUDIT_2026_05_15.md` | Keep/current | Alpha Audit report for the 2026-05-15 reconciliation. |

## Current Runbook/Policy

| File | Status | Reason |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `workers/auth/AGENTS.md`, `workers/auth/CLAUDE.md` | Keep/current | Agent/repo operation rules. |
| `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Keep/current | Project/security/community policy. |
| `docs/BACKUP_RESTORE_DRILL.md` | Keep/current | Backup/restore drill baseline; live drill evidence still needs verification. |
| `docs/DATA_DELETION_EXECUTOR_DESIGN.md` | Keep/current | Design baseline for deletion/anonymization executor. |
| `docs/OBSERVABILITY_EVENTS.md` | Keep/current | Observability event taxonomy. |
| `docs/SLO_ALERT_BASELINE.md` | Keep/current | SLO/alert baseline; live alert evidence still needs verification. |
| `docs/runbooks/*.md` | Keep/current | Incident runbooks for auth, AI, contact, D1, R2, queues, MFA, secrets, rollback. |
| `docs/ops/*.md` | Keep/current | Operator notes for live pulse and Stripe custom-domain setup. |
| `docs/production-readiness/*.md` | Keep/current | Evidence templates, staging/main-only release checklists, and production-readiness guardrails, including the Phase 3.4 member image gateway main-only checklist. |
| `.agents/skills/**/SKILL.md` | Keep/current | Local Codex skill instructions; not audit reports but part of operational documentation. |

## Historical Phase Report

These reports are historical implementation evidence. They may mention older migrations such as `0040` or `0046` in the context of the phase they recorded.

| Files | Status | Reason |
| --- | --- | --- |
| `PHASE0_REMEDIATION_REPORT.md`, `PHASE0B_REMEDIATION_REPORT.md` | Keep/historical | Phase 0 remediation evidence. |
| `PHASE1A_*` through `PHASE1J_*`, `PHASE1_OBSERVABILITY_BASELINE.md` | Keep/historical | Phase 1 implementation/ops evidence. |
| `PHASE2A_*` through `PHASE2O_*` | Keep/historical | Phase 2 org, billing, AI usage, Stripe, pricing, and org-context evidence. |
| `PHASE_ADMIN_CONTROL_PLANE_REPORT.md` | Keep/historical | Admin Control Plane implementation evidence. |
| `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md` | Keep/historical | Original Pricing/Credit Purchase rollout evidence. |
| `PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md` | Keep/historical | BITBI Pro member subscription and credit-bucket implementation evidence. |

## Historical Handoff

| File | Status | Reason |
| --- | --- | --- |
| `PHASE1_COMPLETION_HANDOFF.md` | Keep/historical handoff | Preserves Phase 1 completion context. |
| `PHASE2A_ENTRYPOINT.md` | Keep/historical handoff | Preserves Phase 2-A entry context. |

## Superseded Or Currently Stale

These files should stay available for context but should not be treated as current source of truth without reconciliation.

| File | Status | Reason |
| --- | --- | --- |
| `docs/privacy-compliance-audit.md` | Archive/update candidate | Superseded by `docs/privacy-data-flow-audit.md` for current engineering flow. Do not delete in this phase. |
| `docs/privacy-text-followup.md` | Archive/update candidate | Follow-up legal copy notes; currentness needs owner/legal review. Do not delete in this phase. |
| `docs/codebase-issue-task-proposals.md` | Archive/update candidate | Proposal backlog may be stale relative to completed phases. Do not delete in this phase. |
| `docs/cloudflare-rate-limiting-wave1.md` | Archive/update candidate | Historical rate-limit rollout note; current route policy and limiter docs should be checked before relying on it. Do not delete in this phase. |
| `docs/gallery-exclusive-little-monster-cleanup.md`, `docs/soundlab-free-exclusive-cleanup.md` | Archive/update candidate | Cleanup notes for retired bundled assets; verify exact production state before action. Do not delete in this phase. |

## Remove Candidate

No first-party Markdown is approved for deletion in this phase.

Future archive/remove candidates must first get an explicit archival plan, an index update, and approval. Current candidates are archive/remove candidate — do not delete in this phase: superseded privacy notes, stale proposal backlogs, and cleanup notes after their evidence is safely preserved elsewhere.
