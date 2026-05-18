# Legacy Media Reset Sanitized Dry-run Evidence Template

Date collected:

Operator:

Repo commit or deployed Auth Worker reference:

Evidence file name:

Current release truth: latest auth D1 migration is `0058_add_legacy_media_reset_actions.sql`.

Purpose: provide a safe evidence package for the legacy media reset executor dry-run. This template does not authorize confirmed reset execution, deletion, R2 cleanup, ownership backfill, access-check switching, tenant isolation, production readiness, or live billing readiness.

## Required Mode

- Endpoint: `POST /api/admin/tenant-assets/legacy-media-reset/execute`
- `dryRun`: `true`
- `execute`: `false`
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`: not enabled, or irrelevant because this is dry-run only
- `dryRun:false` used: no

## Selected Domains

Only first-pass domains may be selected:

- `ai_images`:
- `ai_folders`:
- `ai_image_derivatives`:
- `public_gallery_references`:

Deferred domains acknowledged:

- `manual_review_items_supersession`:
- `ai_text_assets`:
- `music_assets`:
- `video_assets`:
- `profile_avatars`:
- `data_lifecycle_exports`:
- `audit_archive`:
- unknown/other media tables:

## Required Counts

| Count | Value |
| --- | --- |
| Proposed source rows to retire |  |
| Proposed images to retire |  |
| Proposed folders to retire |  |
| Public/gallery references to retire |  |
| Derivative references |  |
| Dry-run candidate rows |  |
| Blocked candidates |  |
| Deferred video records |  |
| Deferred music records |  |
| Deferred text asset records |  |

## R2 / Derivative Key-type Counts

Counts only. Do not include raw private R2 keys.

| R2 key type | Count |
| --- | --- |
| original |  |
| thumb |  |
| medium |  |
| poster |  |
| other known D1-referenced key category |  |

## Storage / Quota

- `includeQuotaVerification` requested:
- Quota verification included:
- Quota before/after values included:
- If missing, explain why this blocks confirmation review:

## Idempotency Evidence

Do not record the raw `Idempotency-Key`.

- POST used an `Idempotency-Key`: yes/no
- Raw idempotency key present in evidence: no
- Stored/request idempotency representation: safe hash only / absent / not persisted for dry-run
- Raw request hash present: no
- Replay/conflict evidence included: yes/no/not tested

## Safety Flags

Every accepted evidence package must explicitly answer these.

| Safety flag | Value |
| --- | --- |
| No confirmed deletion/reset occurred |  |
| No media rows were deleted |  |
| No ownership backfill occurred |  |
| No access switch occurred |  |
| No source asset rows were mutated |  |
| No ownership metadata was updated |  |
| No manual-review rows were mutated |  |
| No reset action rows were inserted for dry-run, or dry-run action storage is absent/not used |  |
| No live R2 listing occurred |  |
| No R2 objects were moved/copied/rewritten/deleted |  |
| No provider calls occurred |  |
| No Stripe calls occurred |  |
| No Cloudflare API/settings calls occurred |  |
| No GitHub settings/API calls occurred |  |
| No credit/billing mutation occurred |  |
| Production readiness remains blocked |  |
| Live billing readiness remains blocked |  |
| Tenant isolation remains unclaimed |  |
| Confirmed reset readiness remains blocked |  |

## Unsafe Values Check

The evidence file must not contain:

- raw idempotency keys
- raw request hashes unless explicitly proven safe and non-sensitive
- cookies or authorization headers
- signed URLs
- private R2 keys
- raw prompts or provider request/response bodies
- Stripe data
- Cloudflare tokens/API keys
- GitHub tokens
- private keys
- raw webhook payloads
- private user data or unbounded item lists

## Decision

- Sanitized evidence accepted for dry-run only: yes/no
- If no, missing/unsafe fields:
- Confirmation gate remains closed: yes
- Separate future confirmation phase required before any reset/deletion: yes

## Notes

Use this template to create a sanitized evidence file or Markdown summary under `docs/tenant-assets/evidence/`. Do not paste raw request headers, cookies, raw keys, raw private object names, or full item lists.
