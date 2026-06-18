# Production Readiness Evidence Template

Date collected:

Operator:

Commit SHA:

Current release truth: `config/release-compat.json` is authoritative for the latest auth D1 migration; use `npm run release:plan` for the concrete checkpoint before deploy.

This template records current evidence only. It does not approve production readiness, live billing readiness, tenant isolation, ownership backfill, access switching, or confirmed legacy media reset by itself.

## Release Candidate Go/No-Go Manifest

- `npm run rc:check` output path:
- `npm run release:rc` JSON output path:
- `npm run release:rc:markdown` output path:
- Generated timestamp:
- Git branch:
- Git commit SHA:
- Dirty worktree classification:
- Final RC status reviewed as code-merge/deploy-preparation only:
- Production readiness stayed blocked:
- Live billing readiness stayed blocked:
- Historical hardening background reviewed only where relevant:
- Remaining evidence blockers reviewed:
- Evidence index unsafe-marker triage reviewed by file path and marker ID only:
- No raw secret/marker values printed:

## Release Cutover Manifest

- `npm run release:cutover-evidence` output path:
- `npm run release:cutover-evidence:markdown` output path:
- Generated timestamp:
- Git branch:
- Git commit SHA:
- Worktree classification: clean/dirty local planning/blocked
- Deploy units expected from release plan:
- Expected deploy order:
- Auth/AI paired rollout warning reviewed: yes/no/not applicable
- No deploy/no remote migration statement reviewed: yes/no

## Production Readiness Execution Dossier

- `npm run readiness:dossier` JSON output path:
- `npm run readiness:dossier:markdown` output path:
- Dossier generated timestamp:
- Dossier final verdict kept `productionReadiness: blocked`:
- Dossier final verdict kept `liveBillingReadiness: blocked`:
- Evidence index unsafe marker count reviewed without raw values:
- Billing canary evidence status: pending/attached/rejected
- Tenant/reset/backfill/access-switch blockers still visible:
- Redaction guarantees reviewed:

## Deployment State

- Static/Pages deployed commit:
- Auth Worker deployed commit:
- AI Worker deployed commit:
- Contact Worker deployed commit:
- Deployment verification method:
- Deployment gaps:

## Migration State

- Remote auth migrations applied through latest checkpoint from `config/release-compat.json`:
- Evidence path or screenshot reference:
- `0056_add_ai_folder_image_ownership_metadata.sql` applied: yes/no/unknown
- `0057_add_ai_asset_manual_review_state.sql` applied: yes/no/unknown
- `0058_add_legacy_media_reset_actions.sql` applied: yes/no/unknown
- `0059_add_data_lifecycle_completion_state.sql` applied: yes/no/unknown
- Latest release-contract auth migration applied: yes/no/unknown
- Notes:

## Cloudflare Resource Verification

- `npm run cloudflare:resource-model` JSON output path:
- `npm run cloudflare:resource-model:markdown` output path:
- Repo-declared resources reviewed separately from live Cloudflare evidence:
- Resource model confirms no Cloudflare API calls:
- D1 binding verified without exposing values:
- R2 bindings verified without listing private objects:
- Queues verified:
- Durable Objects verified:
- Service bindings verified:
- Cloudflare Images verified:
- WAF/static header/RUM/alert dashboard checks:
- Dashboard-managed custom domains/certificates/rate limits/alerts evidence path:

## Live Health And Security

- `/api/health` result:
- Static page smoke result:
- Admin Control Plane current operations/storage/billing evidence surfaces reviewed:
- `GET /api/admin/readiness/status` result, if deployed:
- `GET /api/admin/billing/evidence/status` result, if admin cookie provided:
- `GET /api/admin/operations/timeline` result, if admin cookie provided:
- Tenant domain evidence result, if admin cookie provided:
- `npm run readiness:live-readonly` command and output path:
- Live checks were opt-in and GET-only by default:
- Admin cookie/header redaction confirmed:
- Security header result:
- Live runtime canary mode: disabled/skipped/live-read-only
- Fetch Metadata cross-site write rejection evidence:
- Internal AI caller-policy missing/invalid rejection evidence:
- Admin legacy/unclassified AI path blocked-before-provider evidence:
- Private storage-key redaction evidence:
- Error/log review:
- Rollback evidence:
- Restore drill evidence:

## Rollback Plan

- `npm run release:rollback-drill` output path:
- Rollback drill reviewed as non-executing:
- Previous Auth Worker version/commit:
- Previous AI Worker version/commit:
- Previous Contact Worker version/commit:
- Previous static Pages artifact/commit:
- Rollback owner:
- Rollback time window:
- Smoke test after rollback:
- Blocked claims after rollback reviewed:

## Redaction Checklist

- No secrets/API keys/tokens:
- No cookies/authorization headers:
- No raw idempotency keys or raw request hashes:
- No private R2 object keys or signed URLs:
- No raw Stripe webhook signatures or payload secrets:
- No provider prompts/payloads beyond approved safe summaries:

## Operator Timeline And Evidence Index

- Admin Operator Timeline reviewed (`/admin/#operations`):
- `GET /api/admin/operations/timeline` result path:
- `externalCallsMade:false`, `r2ListingPerformed:false`, `d1MutationPerformed:false`, and `creditMutationPerformed:false` confirmed:
- Critical/high timeline events triaged:
- Recommended safe panels opened:
- Dangerous actions absent from Admin timeline:
- Activity/archive retention metadata reviewed:
- `docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md` reviewed:
- `npm run evidence:index` output path:
- `npm run evidence:index:markdown` output path:
- Evidence index unsafe marker summary reviewed:
- Unsafe evidence raw values absent from final evidence packet:

## Admin Mutation And Data Lifecycle Evidence

- `npm run check:route-policies` result:
- High-risk admin mutation confirmation/idempotency/audit exceptions reviewed:
- Data lifecycle approval/export/cleanup `confirm=true` evidence:
- Data lifecycle `execute-safe` dry-run evidence:
- Data lifecycle `execute-safe` `dryRun:false` approval evidence, if separately authorized:
- Data lifecycle final status (`completed`, `completed_with_retention`, `rejected`, `closed`, or `blocked_requires_legal_review`) evidence:
- Data lifecycle category matrix / retained-category evidence reviewed:
- Data lifecycle JSON/Markdown/HTML(PDF-friendly) evidence export path:
- Private export/archive raw-key redaction evidence:
- Admin delete/session-revoke explicit confirmation evidence:

## Billing Evidence

- `GET /api/admin/billing/evidence/status` result path:
- `stripeCallsMade:false`, `creditMutationPerformed:false`, and `productionReadiness/liveBillingReadiness:blocked` confirmed:
- Live credit-pack config presence/shape reviewed without secret values:
- BITBI Pro subscription Price ID presence/safe suffix reviewed without full secret values:
- Configured credit-pack labels/amounts reviewed:
- BITBI Pro monthly credits/no-rollover policy reviewed:
- `npm run billing:canary-evidence` output path:
- Live credit-pack checkout canary evidence path:
- Live subscription checkout canary evidence path:
- Verified webhook receipt evidence path:
- Duplicate webhook idempotency evidence path:
- Wrong Price ID rejection evidence path:
- Missing webhook secret fail-closed evidence path:
- Checkout creation grants no credits evidence path:
- Verified webhook/payment event credit-pack grant evidence path:
- `invoice.paid` subscription credit grant evidence path:
- Refund/dispute/payment-failure review-only evidence path:
- Billing reconciliation result path:
- Raw Stripe payload/signature/secret rendering absence confirmed:
- Stripe dashboard/webhook operator evidence:
- Refund/dispute/payment-failure accounting/legal/operator decision status:
- Live billing readiness decision:

## Admin / Platform AI Budget Evidence

- Budget switch evidence:
- App switch evidence:
- Platform cap evidence:
- Reconciliation evidence:
- Repair action evidence:
- Report/export/archive evidence:
- Remaining budget scopes:

## Tenant Asset Evidence

- Post-cleanup rebaseline decision path:
- Post-cleanup rebaseline status: pending/collected/rejected
- Pre-cleanup evidence classified stale/superseded by manual media cleanup: yes/no
- Fresh domain evidence path:
- Fresh ownership backfill dry-run evidence path:
- Fresh Access-Switch shadow diagnostics evidence path:
- Fresh legacy reset status/evidence path:
- Fresh manual-review backlog/status evidence path:
- Owner-map decision reviewed:
- Manual-review evidence decision:
- Manual-review idempotency gaps:
- Legacy media reset dry-run evidence decision:
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` gate state:
- Confirmed reset approval status:
- Access-switch readiness:
- Ownership backfill readiness:
- Tenant isolation claim:

## Final Decision

- Production readiness: blocked/ready/needs more evidence
- Live billing readiness: blocked/ready/needs more evidence
- Tenant isolation: not claimed/claimed with evidence
- Confirmed media reset: blocked/approved through separate future operator-approved change
- Evidence state: collected/incomplete/rejected
- Blocked claims remain blocked: yes/no
- Follow-up actions:
