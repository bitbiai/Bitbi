# Production Readiness Evidence Template

Date collected:

Operator:

Commit SHA:

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

This template records current evidence only. It does not approve production readiness, live billing readiness, tenant isolation, ownership backfill, access switching, or confirmed legacy media reset by itself.

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

## Deployment State

- Static/Pages deployed commit:
- Auth Worker deployed commit:
- AI Worker deployed commit:
- Contact Worker deployed commit:
- Deployment verification method:
- Deployment gaps:

## Migration State

- Remote auth migrations applied through:
- Evidence path or screenshot reference:
- `0056_add_ai_folder_image_ownership_metadata.sql` applied: yes/no/unknown
- `0057_add_ai_asset_manual_review_state.sql` applied: yes/no/unknown
- `0058_add_legacy_media_reset_actions.sql` applied: yes/no/unknown
- Notes:

## Cloudflare Resource Verification

- D1 binding verified without exposing values:
- R2 bindings verified without listing private objects:
- Queues verified:
- Durable Objects verified:
- Service bindings verified:
- Cloudflare Images verified:
- WAF/static header/RUM/alert dashboard checks:

## Live Health And Security

- `/api/health` result:
- Static page smoke result:
- Admin Readiness & Evidence dashboard reviewed (`/admin/#readiness`):
- `GET /api/admin/readiness/status` result, if deployed:
- `npm run readiness:live-readonly` command and output path:
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

- Previous Auth Worker version/commit:
- Previous AI Worker version/commit:
- Previous Contact Worker version/commit:
- Previous static Pages artifact/commit:
- Rollback owner:
- Rollback time window:
- Smoke test after rollback:

## Redaction Checklist

- No secrets/API keys/tokens:
- No cookies/authorization headers:
- No raw idempotency keys or raw request hashes:
- No private R2 object keys or signed URLs:
- No raw Stripe webhook signatures or payload secrets:
- No provider prompts/payloads beyond approved safe summaries:

## Admin Mutation And Data Lifecycle Evidence

- `npm run check:route-policies` result:
- High-risk admin mutation confirmation/idempotency/audit exceptions reviewed:
- Data lifecycle approval/export/cleanup `confirm=true` evidence:
- Data lifecycle `execute-safe` dry-run evidence:
- Data lifecycle `execute-safe` `dryRun:false` approval evidence, if separately authorized:
- Private export/archive raw-key redaction evidence:
- Admin delete/session-revoke explicit confirmation evidence:

## Billing Evidence

- Stripe mode tested:
- Webhook evidence:
- Checkout/subscription canary evidence:
- Credit/debit behavior evidence:
- Remediation/accounting/legal approval status:
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
- Confirmed media reset: blocked/approved in separate phase
- Evidence state: collected/incomplete/rejected
- Blocked claims remain blocked: yes/no
- Follow-up actions:
