# Legacy Media Reset Operator Dry-run Runbook

Date: 2026-05-17

Purpose: collect sanitized live/main dry-run evidence from the Phase 6.23 legacy media reset executor before any confirmed reset execution is considered.

This runbook is evidence-only. It does not authorize deletion, source row mutation, R2 cleanup, ownership backfill, access-check switching, tenant isolation, production readiness, or live billing readiness.

## Prerequisites

- Remote auth D1 migrations are applied through:
  - `0056_add_ai_folder_image_ownership_metadata.sql`
  - `0057_add_ai_asset_manual_review_state.sql`
  - `0058_add_legacy_media_reset_actions.sql`
- Auth Worker code with Phase 6.23 is deployed.
- The operator has an admin session with production MFA satisfied.
- The operator understands that Phase 6.24 permits dry-run evidence only.
- No confirmed reset execution is planned in this phase.

## Endpoint

Use the existing Phase 6.23 endpoint:

```text
POST /api/admin/tenant-assets/legacy-media-reset/execute
```

The request must be `dryRun: true`. The endpoint still requires `Idempotency-Key` because it is a POST route.

## Safe Example Request

Use placeholders only; do not commit cookies, headers, tokens, raw idempotency keys, or private URLs.

```bash
curl '<AUTH_WORKER_BASE_URL>/api/admin/tenant-assets/legacy-media-reset/execute' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <OPERATOR_GENERATED_IDEMPOTENCY_KEY>' \
  -H 'Cookie: <ADMIN_SESSION_COOKIE_NOT_FOR_COMMIT>' \
  --data '{
    "dryRun": true,
    "domains": [
      "ai_images",
      "ai_folders",
      "ai_image_derivatives",
      "public_gallery_references"
    ],
    "includeFolders": true,
    "includeImages": true,
    "includePublic": true,
    "includeDerivatives": true,
    "includeQuotaVerification": true,
    "limit": 500,
    "reason": "Phase 6.24 legacy media reset dry-run evidence only"
  }'
```

Do not send `dryRun: false` in Phase 6.24.

## Evidence To Save

Save a sanitized JSON response under `docs/tenant-assets/evidence/`, for example:

```text
docs/tenant-assets/evidence/legacy-media-reset-dry-run-live.json
```

The evidence should include:

- `dryRun: true`
- `execute: false`
- selected domains
- allowed domains
- deferred domains
- plan/candidate counts
- public/gallery warnings or public reference counts
- derivative/R2 key-type counts if present
- blocked reasons
- safety flags:
  - no backfill
  - no access switch
  - no source asset mutation
  - no ownership metadata update
  - no R2 live listing
  - no R2 mutation
  - no billing/credit mutation
  - tenant isolation not claimed
  - production readiness blocked

## Redaction Rules

Before committing evidence, remove or reject files containing:

- raw private R2 keys
- signed URLs
- raw prompts
- provider request/response bodies
- cookies or auth headers
- Stripe data
- Cloudflare tokens
- private keys
- raw idempotency keys
- unsafe metadata blobs

R2 evidence should be counts by key type only, such as original/thumb/medium counts.

## Interpretation

Dry-run evidence can prove only that the executor plan was computed safely. It cannot prove tenant isolation, backfill readiness, access-switch readiness, production readiness, or deletion success.

Decision statuses:

- `legacy_media_reset_dry_run_pending`: no usable evidence is committed.
- `legacy_media_reset_dry_run_collected_blocked`: evidence exists but blockers remain.
- `legacy_media_reset_dry_run_collected_ready_for_confirmation_review`: evidence is complete enough to discuss a separate confirmation phase.
- `legacy_media_reset_dry_run_rejected_unsafe`: evidence contains unsafe values and must be replaced.

## After Collection

Update:

- `docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md`
- `docs/tenant-assets/evidence/README.md`
- relevant current-state docs

Confirmed execution must remain a separate future phase with explicit operator approval.
