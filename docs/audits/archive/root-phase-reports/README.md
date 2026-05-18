# Root Phase Report Archive

Date: 2026-05-18

Purpose: frozen archive for historical Markdown reports that previously lived in the repository root. These files are preserved as implementation evidence, not current source of truth.

Current start point: `docs/audits/NEXT_AUDIT_BASELINE.md`.

Active current docs:

- `CURRENT_IMPLEMENTATION_HANDOFF.md`
- `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `DATA_INVENTORY.md`
- `docs/audits/NEXT_AUDIT_BASELINE.md`
- `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md`

The repository root is now reserved for active top-level docs, project policies, and current handoff/state files. Future historical phase reports should be archived here, or summarized in current-state docs and `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`.

## Root Markdown Classification

| Category | Files |
| --- | --- |
| `active_root_current` | `README.md`, `CURRENT_IMPLEMENTATION_HANDOFF.md`, `SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md`, `DATA_INVENTORY.md` |
| `active_root_project_standard` | `AGENTS.md`, `CLAUDE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md` |
| `historical_root_phase_report` | All `PHASE*.md` files moved into this directory. |
| `historical_root_design_report` | `AI_VIDEO_ASYNC_JOB_DESIGN.md` moved into this directory. |
| `historical_retired_root_audit_doc` | `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, and `ALPHA_AUDIT_2026_05_15.md` moved into `docs/audits/archive/retired-audit-root-docs/`. |
| `superseded_root_doc` | None left in the root after DOC-3. |
| `unclear_requires_review` | None identified during DOC-3 inventory. |

## Moved Files

| Original root file | Archive classification | Short description |
| --- | --- | --- |
| `AI_VIDEO_ASYNC_JOB_DESIGN.md` | `historical_root_design_report` | Async video job design and implementation history. |
| `PHASE0_REMEDIATION_REPORT.md` | `historical_root_phase_report` | Initial remediation report. |
| `PHASE0B_REMEDIATION_REPORT.md` | `historical_root_phase_report` | Follow-up remediation and prereq validation report. |
| `PHASE1A_REMEDIATION_REPORT.md` | `historical_root_phase_report` | Async admin video foundation report. |
| `PHASE1B_REMEDIATION_REPORT.md` | `historical_root_phase_report` | Async video production-usability report. |
| `PHASE1C_REMEDIATION_REPORT.md` | `historical_root_phase_report` | Sync video debug gate and quality guard report. |
| `PHASE1D_SECRET_ROTATION_REPORT.md` | `historical_root_phase_report` | Purpose-specific secret rotation report. |
| `PHASE1E_ROUTE_POLICY_REPORT.md` | `historical_root_phase_report` | Route policy registry report. |
| `PHASE1F_OPERATIONAL_READINESS_REPORT.md` | `historical_root_phase_report` | Operational readiness baseline report. |
| `PHASE1G_AUDIT_SEARCH_SCALABILITY_REPORT.md` | `historical_root_phase_report` | Audit/activity search scalability report. |
| `PHASE1H_DATA_LIFECYCLE_REPORT.md` | `historical_root_phase_report` | Data lifecycle foundation report. |
| `PHASE1I_EXPORT_DELETE_EXECUTOR_REPORT.md` | `historical_root_phase_report` | Export archive and delete executor design report. |
| `PHASE1J_RETENTION_EXECUTOR_REPORT.md` | `historical_root_phase_report` | Retention cleanup and reversible executor report. |
| `PHASE1_COMPLETION_HANDOFF.md` | `historical_root_phase_report` | Historical handoff after early remediation work. |
| `PHASE1_OBSERVABILITY_BASELINE.md` | `historical_root_phase_report` | Historical observability baseline. |
| `PHASE2A_ENTRYPOINT.md` | `historical_root_phase_report` | Historical organization/RBAC entrypoint. |
| `PHASE2A_ORG_RBAC_REPORT.md` | `historical_root_phase_report` | Organization/RBAC foundation report. |
| `PHASE2B_BILLING_ENTITLEMENTS_REPORT.md` | `historical_root_phase_report` | Billing/entitlements foundation report. |
| `PHASE2C_AI_USAGE_ENTITLEMENTS_REPORT.md` | `historical_root_phase_report` | Organization-scoped AI image entitlement report. |
| `PHASE2D_AI_USAGE_RESERVATION_REPORT.md` | `historical_root_phase_report` | AI usage reservation/idempotency report. |
| `PHASE2E_AI_USAGE_ATTEMPT_CLEANUP_REPORT.md` | `historical_root_phase_report` | AI usage attempt cleanup report. |
| `PHASE2F_AI_REPLAY_OBJECT_RETENTION_REPORT.md` | `historical_root_phase_report` | AI replay object retention report. |
| `PHASE2H_MEMBER_TEXT_GENERATION_API_REPORT.md` | `historical_root_phase_report` | Member text generation API report. |
| `PHASE2I_BILLING_EVENT_INGESTION_REPORT.md` | `historical_root_phase_report` | Billing event ingestion report. |
| `PHASE2J_STRIPE_TESTMODE_CREDIT_PACK_CHECKOUT_REPORT.md` | `historical_root_phase_report` | Stripe Testmode credit-pack checkout report. |
| `PHASE2K_ADMIN_STRIPE_TESTMODE_LOCKDOWN_REPORT.md` | `historical_root_phase_report` | Admin Stripe Testmode lockdown report. |
| `PHASE2L_LIVE_STRIPE_CREDIT_PACKS_AND_CREDITS_DASHBOARD_REPORT.md` | `historical_root_phase_report` | Live credit packs and Credits dashboard report. |
| `PHASE2M_ADMIN_BFL_IMAGE_TEST_CREDIT_PRICING_REPORT.md` | `historical_root_phase_report` | Admin BFL image-test credit pricing report. |
| `PHASE2N_ORGANIZATION_CONTEXT_AND_CREDIT_DEBIT_VISIBILITY_REPORT.md` | `historical_root_phase_report` | Organization context and credit debit visibility report. |
| `PHASE2O_PRICING_HERO_LIVE_PACKS_AND_PROFILE_NAV_REPORT.md` | `historical_root_phase_report` | Pricing hero/live packs/profile navigation report. |
| `PHASE_ADMIN_CONTROL_PLANE_REPORT.md` | `historical_root_phase_report` | Admin Control Plane report. |
| `PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md` | `historical_root_phase_report` | Member subscription/Pro report. |
| `PHASE_PRICING_PAGE_CREDIT_PACKS_REPORT.md` | `historical_root_phase_report` | Historical pricing/credit-pack report. |

## Archive Rules

- Do not use these files as current source of truth.
- Do not modernize old migration numbers inside frozen reports.
- Do not delete unique evidence.
- Keep future historical root reports out of the repository root.
