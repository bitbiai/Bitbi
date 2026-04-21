# Saved Asset Image Derivatives Runbook

This runbook covers the asynchronous thumb/medium derivative pipeline for member-generated Saved Assets in `workers/auth`.

The canonical release contract for this pipeline now lives in `config/release-compat.json`.
Use `release.manualPrerequisites` for queue/Cloudflare feature prerequisites and
`release.deployOrder` for migration/deploy sequencing. This runbook now covers only
the derivative-specific behavior and operator flow.

## What changed

- Originals remain in `USER_IMAGES` under the existing `users/{userId}/folders/{folderSlug}/...` layout.
- Derivatives are generated asynchronously by a Cloudflare Queue consumer in the `bitbi-auth` Worker.
- Derivatives are stored privately in `USER_IMAGES` under:
  - `users/{userId}/derivatives/v1/{imageId}/thumb.webp`
  - `users/{userId}/derivatives/v1/{imageId}/medium.webp`
- Saved Assets grid/card/mobile preview contexts now use authenticated thumb URLs.
- Detail modal preview uses an authenticated medium URL when available and falls back to the original only in the detail/open-full flow.

## Release prerequisites

Release-blocking prerequisites for this pipeline are intentionally declared only in
`config/release-compat.json` so queue names, binding names, and deploy order do not
drift between docs and CI validation.

After those manifest-declared prerequisites are satisfied, run the derivative backfill
until `has_more` is `false`.

## Backfill existing Saved Assets

The Worker exposes an admin-only maintenance route:

- `POST /api/admin/ai/image-derivatives/backfill`

Request body:

```json
{
  "limit": 50,
  "cursor": null,
  "includeFailed": true
}
```

Response body:

```json
{
  "ok": true,
  "data": {
    "scanned": 50,
    "enqueued": 50,
    "has_more": true,
    "next_cursor": "2026-04-10T12:00:00.000Z|abc123...",
    "derivatives_version": 1
  }
}
```

Repeat with `cursor = next_cursor` until `has_more` is `false`.

Example with an authenticated admin session cookie:

```bash
curl 'https://bitbi.ai/api/admin/ai/image-derivatives/backfill' \
  -X POST \
  -H 'content-type: application/json' \
  -H 'cookie: __Host-bitbi_session=YOUR_ADMIN_SESSION_COOKIE' \
  --data '{"limit":50,"includeFailed":true}'
```

## Recovery behavior

- New saves publish a queue message immediately after the original and `ai_images` row are persisted.
- The queue consumer is idempotent and lease-based.
- Queue retries now use bounded backoff and stop after the configured retry budget is exhausted.
- A small daily scheduled recovery scan re-enqueues only stale `pending` work that has not been attempted recently.
- On-demand preview/avatar fallback stays bounded: recently failed derivative rows are cooled down instead of repeatedly regenerating inline on every read.
- Failed items can be requeued later with the admin backfill route once the underlying issue is fixed.
