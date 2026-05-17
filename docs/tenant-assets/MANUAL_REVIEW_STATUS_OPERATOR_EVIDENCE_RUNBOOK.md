# Manual Review Status Operator Evidence Runbook

Date: 2026-05-17

Purpose: collect bounded main-only operator evidence for the AI folders/images manual-review import, queue, status, and export workflow. This runbook is evidence collection only. It does not approve ownership backfill, access-check switching, source asset row updates, ownership metadata updates, R2 actions, tenant isolation, production readiness, or live billing readiness.

## Prerequisites

- Direct-main/live-main workflow. Do not require or assume a separate staging environment.
- Auth Worker code containing Phases 6.15 through 6.18 is deployed.
- Remote auth D1 migration `0057_add_ai_asset_manual_review_state.sql` is applied before using the review-state endpoints.
- Operator has an admin account with production MFA satisfied.
- Operator can save sanitized evidence files under `docs/tenant-assets/evidence/` or an approved private evidence store before committing summaries.
- Evidence must be redacted before it enters the repo.

## Safety Rules

Do not store or paste:

- raw prompts;
- provider request/response bodies;
- private R2 keys;
- signed URLs;
- cookies, auth headers, bearer tokens, or session values;
- Stripe data;
- Cloudflare tokens;
- private keys;
- raw idempotency keys;
- raw request hashes if policy avoids exposing them;
- unsafe metadata blobs.

This workflow must not:

- backfill ownership;
- switch access checks;
- update `ai_folders` or `ai_images`;
- update ownership metadata;
- list, move, copy, rewrite, or delete R2 objects;
- call providers, Stripe, Cloudflare APIs, or GitHub settings APIs;
- mutate credits, billing, lifecycle, quota, media serving, public gallery, or generation behavior.

## Existing Endpoints To Exercise

Use only the existing main Auth Worker endpoints:

- `POST /api/admin/tenant-assets/folders-images/manual-review/import`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id`
- `GET /api/admin/tenant-assets/folders-images/manual-review/items/:id/events`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence`
- `GET /api/admin/tenant-assets/folders-images/manual-review/evidence/export`
- `POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status`

The Admin Control Plane panel is the Phase 6.18 "Tenant Asset Manual Review Queue" panel.

## Evidence Files To Save

Save sanitized evidence with clear names, for example:

- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-import-dry-run.json`
- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-import-execute.json` if confirmed import is intentionally run
- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-queue-evidence.json`
- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-queue-evidence.md`
- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-status-update.json` if a bounded status update is intentionally run
- `docs/tenant-assets/evidence/YYYY-MM-DD-manual-review-status-idempotency.json` if an idempotency replay/conflict check is intentionally run
- completed `docs/tenant-assets/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_TEMPLATE.md`

Do not commit raw cookies, headers, raw idempotency keys, request hashes, prompts, private R2 keys, signed URLs, provider payloads, Stripe data, Cloudflare tokens, or private keys.

## Dry-Run Import Evidence

Goal: prove the import planner runs through the live/main admin route without writing review rows.

Placeholder request:

```bash
curl -sS https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/import \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <redacted-admin-session-cookie>' \
  -H 'Idempotency-Key: <unique-redacted-dry-run-key>' \
  --data '{"dryRun":true,"limit":100,"includePublic":true,"includeRelationships":true,"includeDerivatives":true,"source":"current_evidence_report"}'
```

Record:

- response timestamp;
- proposed item count;
- created count, which must be `0` for dry-run;
- skipped/existing counts if present;
- safety flags showing no backfill, no access switch, no source mutation, and no R2 operation;
- confirmation that no review rows or events were created by dry-run.

## Confirmed Import Evidence

Run confirmed import only if the owner intentionally approves creating review queue rows. This still writes only `ai_asset_manual_review_items` and `ai_asset_manual_review_events`.

Placeholder request:

```bash
curl -sS https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/import \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <redacted-admin-session-cookie>' \
  -H 'Idempotency-Key: <unique-redacted-import-key>' \
  --data '{"dryRun":false,"confirm":true,"reason":"<bounded operator reason>","limit":100,"includePublic":true,"includeRelationships":true,"includeDerivatives":true,"source":"current_evidence_report"}'
```

Record:

- created review item count;
- skipped/existing count;
- created event count;
- response safety flags;
- sanitized reason summary;
- whether repeated same-key/same-request behavior was idempotent;
- whether same-key/different-request behavior returned conflict if tested.

## Queue Read Evidence

Placeholder requests:

```bash
curl -sS 'https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/items?limit=25' \
  -H 'Cookie: <redacted-admin-session-cookie>'

curl -sS 'https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/items/<review-item-id>' \
  -H 'Cookie: <redacted-admin-session-cookie>'

curl -sS 'https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/items/<review-item-id>/events?limit=25' \
  -H 'Cookie: <redacted-admin-session-cookie>'
```

Record:

- total review items visible;
- item list bounds and filters used;
- detail fields shown;
- event history count;
- evidence that responses are sanitized.

## Status Update Evidence

Run at most a bounded status update on one or more review items only if the owner approves it. Status changes are review-state only; they do not update ownership or access behavior.

Placeholder request:

```bash
curl -sS https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/items/<review-item-id>/status \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <redacted-admin-session-cookie>' \
  -H 'Idempotency-Key: <unique-redacted-status-key>' \
  --data '{"newStatus":"review_in_progress","reason":"<bounded operator reason>","confirm":true,"metadata":{"source":"operator_evidence","phase":"6.19"}}'
```

Record:

- item id or redacted item reference;
- old status;
- new status;
- event type created;
- event timestamp;
- status-change event count after the update;
- idempotency replay/conflict behavior if tested;
- confirmation that only review item/event rows changed.

## Queue Evidence Export

Capture JSON export:

```bash
curl -sS 'https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/evidence/export?format=json' \
  -H 'Cookie: <redacted-admin-session-cookie>'
```

Capture Markdown export if desired:

```bash
curl -sS 'https://<main-host>/api/admin/tenant-assets/folders-images/manual-review/evidence/export?format=markdown' \
  -H 'Cookie: <redacted-admin-session-cookie>'
```

Record:

- total review items;
- total events;
- counts by review status, issue category, severity, and priority;
- `status_changed`, `deferred`, `rejected`, and `superseded` counts;
- terminal approved and terminal blocked counts;
- latest import timestamp;
- latest status update timestamp;
- `accessSwitchReady: false`;
- `backfillReady: false`;
- `tenantIsolationClaimed: false`;
- `productionReadiness: blocked`.

## Admin Control Plane Evidence

Record sanitized notes or screenshots proving:

- "Tenant Asset Manual Review Queue" panel rendered;
- refresh succeeded or failed closed with a clear error;
- JSON export action was available;
- filters/list/detail/event history rendered safe fields only;
- readiness badges showed access switch blocked, backfill blocked, tenant isolation not claimed, no R2 action, and review-state only;
- no backfill, access-switch, source asset update, ownership metadata update, R2, provider, Stripe, credit, billing, or delete controls appeared.

## Decision

After evidence is collected, update `docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md`.

Allowed decision states:

- `operator_evidence_pending`
- `operator_evidence_collected_blocked`
- `operator_evidence_collected_needs_more_idempotency`
- `evidence_rejected_unsafe`
- `needs_more_operator_evidence`

Even successful operator evidence can prove only that the manual-review workflow was exercised and remained bounded. It does not prove tenant isolation, production readiness, ownership backfill readiness, or access-switch readiness.

## Phase 6.20 Interpretation

Phase 6.20 reviewed committed live/main evidence and set the decision to `operator_evidence_collected_needs_more_idempotency`. The dry-run import, confirmed import, final queue export, and one status-change rollup were captured, but same-key replay/conflict evidence and a successful standalone status-update response with hashed idempotency/request-hash evidence were not present.

When archiving future JSON evidence:

- remove or replace raw request `Idempotency-Key` values before committing;
- keep only server-returned hashed/stored-as metadata or redacted placeholders;
- keep bounded counts, status labels, timestamps, and safety flags;
- do not store cookies, auth headers, raw request hashes, prompts, provider bodies, private R2 keys, signed URLs, Stripe data, Cloudflare tokens, private keys, or unsafe metadata blobs.

If replay/conflict evidence is missing, keep a `needs_more_idempotency` decision and do not proceed to backfill-readiness reporting as if idempotency was fully exercised.
