# Backup and Restore Drill Foundation

This document defines a non-destructive restore-readiness plan. No production backup or restore was executed in Phase 1-F.

## Assets Covered

- D1 database: `bitbi-auth-db`.
- R2 buckets: `bitbi-private-media`, `bitbi-user-images`, `bitbi-audit-archive`.
- Queue state: Cloudflare Queues do not provide a durable restore target in this repo; recovery depends on idempotent producers/consumers and D1/R2 job state.
- Durable Objects: `PUBLIC_RATE_LIMITER` and `SERVICE_AUTH_REPLAY`; state is operational/security state, not primary business data.

## Candidate RPO/RTO

| System | Candidate RPO | Candidate RTO | Notes |
|---|---:|---:|---|
| D1 auth database | 24 hours or better | 4 hours | Needs live backup/export policy verification. |
| R2 media | 24 hours or better | 8 hours | Needs bucket inventory and lifecycle policy verification. |
| Async video jobs | D1 job state RPO | 4 hours | Requeue/retry from D1 where safe. |
| Audit archive | 24 hours or better | 24 hours | Restore is lower urgency but high integrity. |

## D1 Restore Drill Procedure

Staging-only, approval required before any remote command:

1. Export or obtain a recent D1 backup for staging.
2. Create an isolated staging restore database.
3. Apply migrations through `config/release-compat.json` latest checkpoint.
4. Import backup into the isolated staging database.
5. Run schema verification queries for critical tables: users, sessions, admin MFA, media, async video jobs, poison messages.
6. Point a staging Worker to the restored database only after approval.
7. Run critical smoke checks: login, admin MFA, media ownership, async video status, contact health.
8. Record elapsed time, data gaps, migration issues, and rollback outcome.

Do not run production `d1 execute`, destructive SQL, or production binding changes without explicit approval.

## R2 Restore Drill Procedure

Staging-only, approval required before any remote command:

1. Inventory source bucket object counts and prefixes.
2. Copy a small representative sample into a staging bucket.
3. Verify private media access control through the auth Worker.
4. Verify async video output and poster references remain authorized.
5. Verify cleanup jobs do not delete restored objects unexpectedly.
6. Record missing prefixes, object count differences, and access-control findings.

Do not make production bucket lifecycle or delete changes during a drill.

## Verification Checklist

- Latest migration in `config/release-compat.json` exists on disk.
- Restore database has the expected tables and indexes.
- No restored secrets are stored in D1.
- Private media remains inaccessible without authorization.
- Admin-only operational routes remain admin-only.
- Queue reprocessing is idempotent and does not duplicate provider work.
- Rollback path is documented before changing staging bindings.

## Open Decisions

- Whether D1 backups are dashboard-managed, API-managed, or IaC-managed.
- Exact production RPO/RTO targets.
- Whether R2 bucket replication/versioning is required.
- Whether restore drills should be quarterly before enterprise readiness.
