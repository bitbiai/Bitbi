# BITBI Operator / Live Evidence Package

Date prepared: 2026-05-21

Package status: operator template only.

Current release truth: latest auth D1 migration is `0060_add_app_settings.sql`.

This package is an operator-owned evidence workflow. It does not deploy, run migrations, call Cloudflare, call Stripe, call live providers, approve production readiness, approve live billing, claim tenant isolation, approve ownership backfill, approve access-switch enforcement, approve confirmed reset, or prove legal compliance.

Default decision: NO-GO until a human operator attaches sanitized live/manual evidence and reviews every blocker.

## Package Files

| File | Purpose |
| --- | --- |
| `00_RELEASE_IMPACT_AND_SCOPE.md` | Local release-impact gate and reviewed scope. |
| `01_LOCAL_VALIDATION_SUMMARY.md` | Local validation command results. |
| `02_CLOUDFLARE_RESOURCES_AND_BINDINGS.md` | Cloudflare presence/shape evidence checklist. |
| `03_WORKER_AND_STATIC_DEPLOY_EVIDENCE.md` | Worker/static deploy state template. |
| `04_LIVE_HEALTH_AND_SECURITY_HEADERS.md` | Operator-run read-only live health/header evidence template. |
| `05_BILLING_STRIPE_CANARY_EVIDENCE.md` | Billing/Stripe canary evidence template without default Stripe calls. |
| `06_TENANT_ISOLATION_AND_ASSET_EVIDENCE.md` | Tenant asset and isolation evidence template. |
| `07_ROLLBACK_RESTORE_AND_INCIDENT_READINESS.md` | Rollback, restore, alert, and incident readiness evidence template. |
| `08_GO_NO_GO_DECISION_TEMPLATE.md` | Final operator decision worksheet. |
| `09_REDACTION_CHECKLIST.md` | Redaction and no-secret checklist. |

## Required Operating Rules

- Run local release impact first: `npm run release:plan` and `npm run check:static-deploy-safety -- --event-name push --acknowledgement ""`.
- Treat repo-local evidence as local only.
- Store live evidence only after redaction.
- Never paste secrets, cookies, authorization headers, raw Stripe signatures, webhook secrets, raw idempotency keys, raw provider payloads, raw private R2 keys, or private media URLs.
- If a live command requires admin authentication, prefer manual browser evidence. Do not paste admin cookies into shared files.
- Keep blocked claims blocked unless separately proven and operator-reviewed.

## Evidence Storage Policy

Commit these templates if useful. Do not commit raw live output. If the operator creates screenshots or exports, store only redacted summaries or references to a private evidence store.

