# Legacy Media Reset Operator Dry-run Evidence Template

Date/time:

Operator:

Commit/deploy reference:

Auth Worker version/commit:

Remote migration status:

- `0056_add_ai_folder_image_ownership_metadata.sql`:
- `0057_add_ai_asset_manual_review_state.sql`:
- `0058_add_legacy_media_reset_actions.sql`:

Endpoint tested:

```text
POST /api/admin/tenant-assets/legacy-media-reset/execute
```

Request mode:

- `dryRun`: `true`
- `execute`: `false`
- `Idempotency-Key` used: yes/no, value not recorded
- `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION` enabled: no/not relevant for dry-run

Selected domains:

- `ai_images`:
- `ai_folders`:
- `ai_image_derivatives`:
- `public_gallery_references`:

Deferred/rejected domains:

- video assets/jobs:
- music/audio assets:
- text assets:
- profile avatars:
- data lifecycle exports:
- audit archive:
- unknown media tables:
- manual-review supersession:

Candidate counts:

| Count | Value |
| --- | --- |
| Proposed source row retire count |  |
| Proposed image count |  |
| Proposed folder count |  |
| Public/gallery reference count |  |
| Derivative reference count |  |
| R2 original key count |  |
| R2 thumb key count |  |
| R2 medium key count |  |
| Storage/quota bytes referenced |  |
| Blocked candidate count |  |

Public/gallery findings:

Derivative/R2 key-type findings:

Storage/quota findings:

Action/idempotency summary:

- Action id, if returned:
- Request hash exposed: no/yes
- Raw idempotency key exposed: no/yes
- Replay/conflict tested: no/yes

Safety confirmations:

| Safety flag | Confirmed |
| --- | --- |
| No confirmed deletion |  |
| No media rows deleted |  |
| No ownership backfill |  |
| No access switch |  |
| No source asset row update |  |
| No ownership metadata update |  |
| No review row mutation |  |
| No reset action mutation beyond dry-run behavior |  |
| No live R2 listing |  |
| No R2 listing/mutation |  |
| No provider call |  |
| No Stripe call |  |
| No Cloudflare API call |  |
| No credit/billing mutation |  |
| Tenant isolation not claimed |  |
| Production readiness blocked |  |
| Live billing readiness blocked |  |
| Confirmed reset readiness blocked |  |

Decision:

- `legacy_media_reset_dry_run_pending`
- `legacy_media_reset_dry_run_collected_blocked`
- `legacy_media_reset_dry_run_collected_ready_for_confirmation_review`
- `legacy_media_reset_dry_run_rejected_unsafe`

Next recommended phase:

Dry-run closure:

- Evidence complete enough to close dry-run topic: yes/no
- Decision document updated:
- Confirmation gate checklist reviewed:
- If pending, missing evidence files:
- If rejected unsafe, unsafe field classes found without repeating values:
- If ready for confirmation review, separate confirmed execution phase required: yes/no

Notes:

- This template does not authorize confirmed deletion.
- Do not record raw idempotency keys, private R2 keys, cookies/auth headers, signed URLs, provider bodies, Stripe data, Cloudflare tokens, private keys, or unsafe metadata.
- Use `docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md` for the stricter acceptance checklist before committing evidence.
- Keep no-backfill, no-access-switch, no-source-mutation, no-R2-mutation, tenant-isolation-not-claimed, and production-readiness-blocked safety flags explicit.
