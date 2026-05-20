# Current Repository Baseline - Fresh Audit Starting Point

Updated: 2026-05-20

Purpose: this is the active starting point for the next deep audit. Start here, inspect current code and current evidence, and treat historical package/wave reports as archive/background only. Do not continue old package numbering.

This baseline is not production readiness, live billing readiness, tenant isolation, ownership-backfill readiness, access-switch readiness, confirmed legacy media reset readiness, legal compliance certification, or deploy approval.

## Repository Architecture

- Frontend: static vanilla HTML/CSS/ES modules, deployed separately from Workers.
- Backend: Cloudflare Workers in `workers/auth`, `workers/ai`, and `workers/contact`.
- Auth Worker scope: primary API, auth, admin, media, billing, tenant assets, lifecycle, cron, and queue work.
- AI Worker scope: internal service-bound AI lab/provider routes.
- Contact Worker scope: contact form endpoint.
- Cloud resources in use: Cloudflare D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, service bindings, Worker routes, and dashboard-managed settings.
- Admin remains English-only. Public/member runtime changes still require English/German route, page, and locale parity.

## Current Release Truth

- Release contract source: `config/release-compat.json`.
- Latest auth D1 migration from that contract at this update: `0060_add_app_settings.sql`.
- Deploy units and deploy ordering must be determined by `npm run release:plan`.
- Repo files do not prove remote migrations, Worker deploy state, static Pages deploy state, live secrets, live bindings, dashboard settings, or Cloudflare resource presence.
- Apply required remote auth migrations before deploying Auth Worker code that depends on those schema objects. Do not assume any remote migration is applied without operator evidence.

## Implemented Current Capabilities

- Admin Control Plane for users, billing, lifecycle, readiness/evidence, AI Lab, AI usage, platform budget controls, tenant assets, and operations.
- Registration availability switch backed by `app_settings`; it affects new registration only and does not disable existing login/session/admin/MFA/account access.
- Data Lifecycle request overlay, planning, approval, safe execution where backend policy allows, final states, retained-category evidence, and JSON/Markdown/HTML evidence export.
- Billing Evidence Center and Financial Control Plane surfaces for read-only billing prerequisite/status evidence, review, reconciliation, and local canary skeletons.
- Tenant Asset Center with folder/image ownership metadata diagnostics, manual-review queue/status visibility, reset status/evidence, and tenant-isolation execution controls.
- Tenant Isolation Execution controls for Ownership Backfill dry-run/evidence/guarded exact-candidate execution, Access-Switch status/shadow diagnostics, and Legacy Media Reset status/evidence.
- Manual Review post-cleanup classifier, JSON/Markdown/HTML evidence export, and guarded review-state supersession controls.
- Operator Timeline/Triage with bounded redacted Admin-only local D1 metadata.
- Evidence Index for local repo evidence classification without live R2 listing or raw unsafe value output.
- Release Candidate / Go-No-Go framework, release cutover evidence, main release readiness gate, and release plan tooling.
- Cloudflare Resource Model, Readiness Dossier, and Rollback Drill local evidence organizers.
- AI cost/platform budget controls for member image/music/video paths and selected admin/platform routes.
- Admin mutation guardrails: Admin/MFA policy, same-origin/Fetch Metadata protection, body/type limits, rate limits, idempotency, exact confirmations where required, and audit logging.
- AI Worker caller policy and service-auth protections for provider-cost routes.
- R2/private key redaction patterns for logs, evidence, exports, and Admin surfaces.

## Current Blockers And Not-Claimed State

- Production readiness remains blocked until live/operator evidence is collected and reviewed.
- Live billing readiness remains blocked until Stripe dashboard/webhook/live canary evidence exists and is reviewed.
- Tenant isolation remains unclaimed.
- Ownership backfill readiness remains blocked except for specifically reviewed current evidence and any separately approved exact-candidate execution.
- Access-Switch enforced mode remains blocked unless current evidence and a durable switch/rollback model support it.
- Confirmed legacy media reset remains blocked.
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` remains disabled unless current environment evidence proves an explicitly approved operator change.
- Full legal/GDPR erasure completion is claimable only per completed Data Lifecycle request evidence; operational admin delete is not full legal erasure by itself.
- Local tests, local dossiers, local evidence indexes, and repo declarations do not prove live production state.

## Current Evidence State

- Post-cleanup tenant asset evidence is recorded in `docs/tenant-assets/evidence/POST_CLEANUP_TENANT_ASSET_EVIDENCE_REBASELINE.md`.
- Pre-cleanup tenant owner-map, manual-review, and reset counts are historical after manual media cleanup and must not be treated as current truth.
- Ownership Backfill evidence currently records one exact safe `ai_images` candidate for operator-controlled review; no global backfill or tenant-isolation claim follows from that.
- Access-Switch shadow diagnostics remain read-only; enforced mode remains blocked.
- Legacy Media Reset evidence remains status/evidence only; the prior reset dry-run decision is unsafe/stale and confirmed execution remains blocked.
- Manual Review queue supersession support exists, but D1 review rows are not automatically updated by copied evidence files. Run dry-run, export evidence, then use guarded supersession only after review.
- Data Lifecycle evidence packets can document request state, retained categories, final states, and redacted archive metadata; they are not legal advice.
- Billing evidence remains read-only/status-oriented until live Stripe canary and webhook evidence is reviewed.
- Release/cutover/readiness evidence tooling is local-only and blocked by default until live/manual evidence is attached.
- Evidence Index may report historical unsafe-marker candidates by file path and marker ID. Do not hide them, do not print raw values, and manually review before reuse in readiness packets.

## Current Operational Next Actions

- Run final local and CI checks before any merge or deploy decision.
- Use `npm run release:plan` to identify affected deploy units.
- Apply pending migrations before dependent Worker deploys only with explicit operator approval/evidence.
- Deploy affected units only after release plan, CI, and operator review.
- Collect live read-only evidence for deployed Workers, static Pages, secrets by presence, bindings, resources, headers, alerts, rollback, restore, and billing.
- Use tenant Backfill, Access-Switch, Manual Review supersession, and Legacy Reset controls only through guarded evidence-first workflows.
- Do not continue old package numbering for future work.

## Future Audit Instructions

- The next audit starts from this baseline only.
- Historical/archive docs may be inspected for background or evidence lineage, but they are not current truth.
- Do not treat old phase, wave, or package reports as active roadmap items.
- Do not continue old numbering.
- Inspect current code, current release contract, current migrations, current Admin surfaces, current tests, and current evidence.
- Classify every finding as `implemented`, `evidence_pending`, `blocked`, or `unsafe_to_claim`.
- Preserve blocked claims until current repo evidence plus operator/live evidence proves otherwise.

## Historical Archive Pointers

- `docs/audits/ALPHA_AUDIT_PHASE_CHANGELOG.md`
- `docs/audits/archive/`
- `docs/audits/archive/root-phase-reports/`
- `docs/audits/archive/retired-audit-root-docs/`
- `docs/tenant-assets/evidence/`
- `docs/audits/README.md`
