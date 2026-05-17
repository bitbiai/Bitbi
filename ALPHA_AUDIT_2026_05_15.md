# Alpha Audit 2026-05-15

Date: 2026-05-15

Last reconciled: 2026-05-17 for Phase 6.7 tenant asset ownership admin evidence report.

This is the active Alpha Audit scorecard. It summarizes current risk and links to the preserved evidence. It is not a production deploy approval, live billing readiness claim, full SaaS maturity claim, full tenant-isolation claim, or legal compliance certification.

Current release truth: `config/release-compat.json` declares the latest auth D1 migration as `0056_add_ai_folder_image_ownership_metadata.sql`.

## Current Summary

Use `docs/audits/ALPHA_AUDIT_CURRENT_SUMMARY.md` as the concise operator restart summary.

Historical phase detail is preserved in:

- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/ALPHA_AUDIT_2026_05_15_PRE_DOC1.md`
- root `PHASE*.md` reports
- `docs/audits/README.md`

## Executive Verdict

| Area | Verdict |
| --- | --- |
| Production readiness | BLOCKED |
| Live billing readiness | BLOCKED |
| SaaS maturity | Partial foundation, not complete |
| Tenant isolation | Partial organization/RBAC plus Phase 6.1 design, Phase 6.2 folder/image owner-map dry run, Phase 6.3 schema/access plan, Phase 6.4 nullable folder/image metadata columns, Phase 6.5 new-write metadata, Phase 6.6 read diagnostics, and Phase 6.7 admin evidence report/export; not full tenant ownership |
| AI cost controls | Stronger for migrated/member/admin-lab paths, still scoped |
| Documentation integrity | Improved by DOC-1, but future phases must avoid history sprawl |

## Scorecard

| Area | Score |
| --- | ---: |
| Security | 68 |
| Production readiness | 42 |
| SaaS/product maturity | 51 |
| Code maintainability | 57 |
| AI/LLM cost efficiency | 45 |
| Billing correctness | 49 |
| Tenant isolation | 38 |
| Privacy/data lifecycle | 55 |
| Observability/ops | 50 |
| Performance | 56 |
| Documentation integrity | 70 after DOC-1 consolidation |

## Active Findings

| ID | Severity | Finding | Current status | Next action |
| --- | --- | --- | --- | --- |
| A-001 | P0 | Current docs can become stale against release migrations. | Guarded by `check:doc-currentness`; active docs now point to summary/index/archive. | Keep current docs concise and release-truth aligned. |
| A-002 | P0 | Production readiness lacks live evidence. | BLOCKED. | Record staging/live migrations, resources, health, headers, queues, D1/R2, Stripe, and rollback evidence. |
| A-003 | P1 | Billing lifecycle remediation is not complete. | Review queue, resolution metadata, read-only reconciliation, and evidence tools exist. | Define approved remediation/accounting/legal workflow before live readiness. |
| A-004 | P1 | Existing assets are not fully tenant-owned. | Phase 6.1 adds design/inventory/risk docs; Phase 6.2 adds `ai_folders`/`ai_images` owner-map dry-run tests; Phase 6.3 adds the schema/access impact plan; Phase 6.4 adds nullable metadata columns; Phase 6.5 assigns new personal write metadata; Phase 6.6 adds read diagnostics; Phase 6.7 adds admin evidence report/export. No old rows, access checks, organization ownership, or R2 objects migrated/listed live. | Collect staging owner-map evidence before any broad backfill or runtime access change. |
| A-005 | P1 | AI cost controls are scoped, not universal. | Member image/music/video and selected admin/platform paths are controlled; other scopes remain explicit future work. | Continue one provider-cost scope at a time. |
| A-006 | P1 | Privacy/data lifecycle is an engineering foundation, not compliance approval. | Inventory, retention, export, cleanup, and safe executor foundations exist. | Legal/product approval and self-service flows remain open. |
| A-007 | P2 | Route policy is still a registry/check guard, not central enforcement. | Guard tests exist. | Plan central enforcement only after stable route inventory. |
| A-008 | P2 | Ops evidence remains incomplete. | Runbooks/checks exist. | Execute restore drill, alert verification, live health/header checks. |

## Closed Or Reduced Findings

- Auth-to-AI HMAC and nonce replay protection exist.
- Sensitive route body parsing, rate limiting, admin MFA, and route-policy checks are in place.
- Admin async video jobs replaced normal reliance on sync debug; sync video debug is disabled-by-default.
- Member image/music/video are on the AI Cost Gateway path.
- Admin text, embeddings, music, compare, live-agent, async video jobs, and selected platform budget flows have budget/idempotency/switch/cap/evidence foundations according to their scoped phases.
- Billing review queue, local reconciliation, repair evidence, and archive workflows exist, but they do not prove live billing readiness.

## Roadmap

1. Keep production/live billing claims blocked until evidence is recorded.
2. Apply and verify auth migrations through `0056` before auth Worker deployment.
3. Collect main-only or staging evidence for AI budget switches, platform caps, reconciliation, repair, report/export, and archive workflows.
4. Choose one next implementation track: Phase 6.8 staging tenant asset owner-map evidence, next AI budget scope, internal caller-policy hardening, billing remediation workflow, or production evidence.

## Documentation Governance

- Do not append full future phase history to this report.
- Put detailed phase outcomes in a phase report or `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`.
- Keep active current docs short and linked to evidence.
- Historical reports are frozen evidence and may reference older migrations in their original context.
