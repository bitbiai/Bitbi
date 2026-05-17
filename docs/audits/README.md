# Audit And Documentation Index

Last reconciled: 2026-05-17

Current release truth: `config/release-compat.json` declares latest auth D1 migration `0056_add_ai_folder_image_ownership_metadata.sql`.

DOC-1 separates active operational documentation from historical evidence. No first-party Markdown was deleted. Large pre-DOC-1 active-doc snapshots were preserved in `docs/audits/archive/` before the active copies were slimmed.

## How To Use This Index

- Read active current docs for restart, deploy truth, and current blockers.
- Read runbooks/policies for operational procedures.
- Read historical phase reports and archives as evidence only.
- Do not update frozen historical reports with new migration numbers.
- Do not append full future phase history to every active doc; use `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` or a dedicated phase report.

## Active Current Source Of Truth

These files must stay reconciled with `config/release-compat.json` and must not claim production readiness, live billing readiness, legal compliance, full SaaS maturity, or full tenant isolation without evidence.

| File | Purpose |
| --- | --- |
| `README.md` | Repository overview and release-truth warning. |
| `CURRENT_IMPLEMENTATION_HANDOFF.md` | Concise restart handoff. |
| `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` | Short current audit summary. |
| `ALPHA_AUDIT_2026_05_15.md` | Active Alpha Audit scorecard. |
| `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md` | Compact SaaS progress summary. |
| `AUDIT_ACTION_PLAN.md` | Current remediation priorities. |
| `AUDIT_NEXT_LEVEL.md` | Compact next audit checkpoint. |
| `DATA_INVENTORY.md` | Current engineering data inventory. |
| `docs/DATA_RETENTION_POLICY.md` | Current retention baseline. |
| `docs/privacy-data-flow-audit.md` | Current privacy/data-flow engineering audit for legal review. |
| `docs/production-readiness/README.md` | Production-readiness guardrails. |
| `docs/production-readiness/EVIDENCE_TEMPLATE.md` | Production evidence template. |
| `docs/ai-cost-gateway/README.md` | AI cost gateway current index. |
| `docs/ai-cost-gateway/ADMIN_PLATFORM_BUDGET_POLICY.md` | Admin/platform AI budget policy. |
| `docs/ai-cost-gateway/LIVE_PLATFORM_BUDGET_CAPS_DESIGN.md` | Live platform budget cap design/current cap foundation notes. |
| `workers/auth/CLAUDE.md` | Auth Worker operational context and route inventory. |

## Active Runbooks And Policies

| Files | Purpose |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `workers/auth/AGENTS.md` | Agent/repo operation rules. |
| `.agents/skills/**/SKILL.md` | Local Codex skill instructions. |
| `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Security/community policy. |
| `docs/BACKUP_RESTORE_DRILL.md`, `docs/OBSERVABILITY_EVENTS.md`, `docs/SLO_ALERT_BASELINE.md` | Operational readiness baselines. |
| `docs/DATA_DELETION_EXECUTOR_DESIGN.md` | Deletion/anonymization executor design baseline. |
| `docs/runbooks/*.md` | Incident runbooks. |
| `docs/ops/*.md` | Operator notes for live pulse and Stripe custom-domain setup. |
| `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`, `docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md`, `docs/production-readiness/PHASE2_BILLING_REVIEW_STAGING_CHECKLIST.md`, `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md` | Release/evidence checklists and runbooks. |
| `docs/ai-image-derivatives-runbook.md` | AI derivative operational runbook. |

## Active Domain Designs

| Files | Purpose |
| --- | --- |
| `AI_VIDEO_ASYNC_JOB_DESIGN.md` | Async admin video design baseline. |
| `docs/ai-cost-gateway/AI_COST_GATEWAY_DESIGN.md` | AI Cost Gateway design. |
| `docs/ai-cost-gateway/AI_COST_GATEWAY_ROADMAP.md` | AI Cost Gateway roadmap. |
| `docs/ai-cost-gateway/AI_COST_ROUTE_INVENTORY.md` | Provider-cost route inventory. |
| `docs/ai-cost-gateway/MEMBER_MUSIC_COST_DECOMPOSITION.md` | Member music cost model decomposition. |
| `docs/ai-cost-gateway/ADMIN_TEXT_EMBEDDINGS_IDEMPOTENCY_DESIGN.md` | Admin text/embeddings idempotency design. |
| `docs/ai-cost-gateway/ADMIN_LIVE_AGENT_BUDGET_FLOW_AUDIT.md` | Admin Live-Agent budget-flow audit/design. |
| `docs/ai-cost-gateway/ADMIN_SYNC_VIDEO_DEBUG_RETIREMENT_AUDIT.md` | Sync video debug retirement audit. |
| `docs/tenant-assets/*.md` | Tenant asset ownership design, inventory, risk matrix, dry-run reports, Phase 6.3 schema/access plan, and Phase 6.4 schema foundation notes. |

## Historical Phase Reports - Frozen Evidence

These files are historical implementation evidence. They may mention older migrations in their original phase context. Do not rewrite them as current source of truth.

| Files | Status |
| --- | --- |
| `PHASE0_REMEDIATION_REPORT.md`, `PHASE0B_REMEDIATION_REPORT.md` | Frozen Phase 0 evidence. |
| `PHASE1A_*` through `PHASE1J_*`, `PHASE1_OBSERVABILITY_BASELINE.md` | Frozen Phase 1 evidence. |
| `PHASE2A_*` through `PHASE2O_*` | Frozen Phase 2 evidence. |
| `PHASE_ADMIN_CONTROL_PLANE_REPORT.md` | Frozen Admin Control Plane evidence. |
| `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md` | Frozen Pricing/Credit Purchase evidence. |
| `PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md` | Frozen BITBI Pro/member subscription evidence. |
| `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md` | Historical phase digest for future concise updates. |
| `docs/audits/archive/*.md` | Exact archived pre-DOC-1 snapshots and future archival evidence. |

## Historical Handoffs

| File | Status |
| --- | --- |
| `PHASE1_COMPLETION_HANDOFF.md` | Frozen Phase 1 handoff. |
| `PHASE2A_ENTRYPOINT.md` | Frozen Phase 2-A entrypoint. |

## Superseded Or Stale Context - Keep, Do Not Treat As Current

These files remain available for context. They now carry or should carry an explicit historical/superseded header and should not be used as current source of truth without reconciling with active docs.

| File | Status |
| --- | --- |
| `docs/privacy-compliance-audit.md` | Superseded by `docs/privacy-data-flow-audit.md` for current engineering flow. |
| `docs/privacy-text-followup.md` | Historical privacy-copy follow-up; legal/currentness review required before reuse. |
| `docs/codebase-issue-task-proposals.md` | Historical proposal backlog; may be stale after completed phases. |
| `docs/cloudflare-rate-limiting-wave1.md` | Historical/dashboard-managed WAF note; release plan may still reference it as manual prerequisite context. |
| `docs/gallery-exclusive-little-monster-cleanup.md` | Historical cleanup note; no deletion without live verification. |
| `docs/soundlab-free-exclusive-cleanup.md` | Historical cleanup note; no deletion without live verification. |

## Explicit Ignore

| Pattern | Reason |
| --- | --- |
| `js/vendor/README-qrcode-generator.md` | Third-party/vendor documentation, not first-party audit evidence. |
| Any path segment named `node_modules`, plus `_site/**`, `.git/**`, `.wrangler/**`, `playwright-report/**`, `test-results/**` | Generated, dependency, or local tool output. |

## Removal Status

No first-party Markdown is approved for deletion in DOC-1.

Future removal requires:

1. Evidence is archived or proven duplicated.
2. This index is updated.
3. References and checks are updated.
4. The owner explicitly approves deletion.
