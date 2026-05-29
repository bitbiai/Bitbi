# Homepage Hero And Memvid Stream Video Derivatives

Status: production path is enabled by default at the Worker capability layer, with Admin runtime switches for test/rollout control. `config/release-compat.json` is authoritative for the current auth D1 migration checkpoint.

Deploy unit: `homepage-ffmpeg-processor`. The release planner classifies `services/homepage-ffmpeg-processor/**` as a non-static processor/service deploy concern. Static Pages does not deploy this processor.

## Scope

This runbook covers two public video-delivery paths:

- Homepage Hero Videos: Admin-selected source videos are converted once by an external ffmpeg processor and served as versioned MP4/WebP derivatives from R2.
- Memvids Explore hover previews: public Memvid cards may expose short Cloudflare Stream preview metadata when a ready preview row exists.

Original AI, user-uploaded, or Admin-uploaded source videos are never returned by the public homepage hero API and are not used for hover autoplay.

## Feature Flags And Secrets

Auth Worker feature flags default to enabled when omitted. Operators may explicitly set any flag to `false`, `0`, `off`, or `disabled` to hard-disable that capability at the Worker layer:

- `ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG`
- `ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS`
- `ENABLE_MEMVID_STREAM_PREVIEWS`
- `ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY`

Admin runtime switches are stored in `app_settings` and are layered below the Worker flags:

- `homepage_hero_external_ffmpeg_enabled`
- `homepage_hero_manual_uploads_enabled`
- `memvid_stream_previews_enabled`
- `memvid_stream_preview_autoplay_enabled`

Effective behavior is `Worker flag enabled + Admin switch enabled + provider configured when required`. The Admin Homepage Hero Videos section shows Worker state, Admin switch state, effective state, provider readiness, missing config names, and last update metadata without exposing secrets.

Processor/provider secrets:

- `HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET` or `HOMEPAGE_HERO_PROCESSOR_SECRET`
- `CLOUDFLARE_ACCOUNT_ID` or `STREAM_ACCOUNT_ID`
- `CLOUDFLARE_STREAM_API_TOKEN` or `STREAM_API_TOKEN`
- `MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET` or `HOMEPAGE_HERO_PROCESSOR_SECRET`
- `MEMVID_STREAM_PREVIEW_MAX_DURATION_SECONDS`
- `MEMVID_STREAM_PREVIEW_MAX_LOOPS`
- `STREAM_DOWNLOAD_POLL_INTERVAL_MS`, optional processor polling interval for Stream MP4 downloads; default 5000 ms
- `STREAM_DOWNLOAD_MAX_WAIT_MS`, optional processor max wait for Stream MP4 downloads; default 300000 ms

Optional GitHub Actions dispatch settings for the one-click Admin Memvid preview flow:

- `MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER=github_actions`
- `GITHUB_ACTIONS_DISPATCH_TOKEN`, Worker secret with permission to dispatch the workflow
- `GITHUB_ACTIONS_DISPATCH_OWNER=bitbiai`
- `GITHUB_ACTIONS_DISPATCH_REPO=Bitbi`
- `GITHUB_ACTIONS_DISPATCH_WORKFLOW=memvid-stream-preview-processor.yml`
- `GITHUB_ACTIONS_DISPATCH_REF=main`

Optional automatic Memvid preview dispatch controls:

- `ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH`, default off unless set to `true`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD`, default `3`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_COOLDOWN_SECONDS`, default `600`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_JOB_LIMIT`, default `5`
- `MEMVID_STREAM_PREVIEW_SCHEDULED_CATCHUP_LIMIT`, default `10`
- `MEMVID_STREAM_PREVIEW_DELETE_RETRY_LIMIT`, default `10`

With provider secrets/config absent, provider work fails closed and the public site falls back to existing poster/full-play behavior. Missing provider secrets do not imply production readiness even when Worker flags and Admin switches are on.

### Auth Worker Wrangler Deploy Safety

The Memvid Stream Preview plain-text Worker vars are tracked in `workers/auth/wrangler.jsonc` so future `wrangler deploy` runs do not remove them from the `bitbi-auth` Worker:

- `CLOUDFLARE_ACCOUNT_ID`
- `ENABLE_MEMVID_STREAM_PREVIEWS`
- `ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY`
- `MEMVID_STREAM_PREVIEW_MAX_DURATION_SECONDS`
- `MEMVID_STREAM_PREVIEW_MAX_LOOPS`
- `MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER`
- `GITHUB_ACTIONS_DISPATCH_OWNER`
- `GITHUB_ACTIONS_DISPATCH_REPO`
- `GITHUB_ACTIONS_DISPATCH_WORKFLOW`
- `GITHUB_ACTIONS_DISPATCH_REF`
- `ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_COOLDOWN_SECONDS`
- `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_JOB_LIMIT`
- `MEMVID_STREAM_PREVIEW_SCHEDULED_CATCHUP_LIMIT`
- `MEMVID_STREAM_PREVIEW_DELETE_RETRY_LIMIT`

`workers/auth/wrangler.jsonc` also uses `keep_vars: true` to preserve dashboard-managed vars that are not represented in the local config. Future Wrangler deploy diffs must not show removal of the Memvid Stream Preview vars above. The Cloudflare Stream API token, Memvid preview processor secret, and GitHub Actions dispatch token remain Worker secrets and must never be committed. If Wrangler or repo validation reports missing required secrets, set them from `workers/auth` without printing or committing values:

```bash
npx wrangler secret put CLOUDFLARE_STREAM_API_TOKEN
npx wrangler secret put MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET
npx wrangler secret put GITHUB_ACTIONS_DISPATCH_TOKEN
```

## Deploy Order

For mixed releases, use `npm run release:plan`. A typical Homepage Hero processor release order is:

1. `auth-migrations`
2. `auth-worker`
3. `homepage-ffmpeg-processor`
4. `static-site`, only after dependencies are handled

On normal push events, the Static Pages workflow skips deployment cleanly when this non-static order is required. A manual `workflow_dispatch` may continue only after the operator uses the exact acknowledgement `I_CONFIRM_RELEASE_PLAN_DEPENDENCIES_HANDLED`; that acknowledgement is not production readiness or live evidence.

## Homepage Hero Flow

1. Admin uploads or selects a private/public source video.
2. Admin creates an `external_ffmpeg` derivative job with `operator_reason` and `Idempotency-Key`.
3. The processor claims queued jobs through `/api/internal/homepage/hero-videos/jobs/claim` using the processor bearer secret.
4. The processor downloads the source through the signed internal source endpoint.
5. The processor generates:
   - MP4/H.264, no audio, max 720px wide, 24 fps, 6-8 seconds, `+faststart`
   - WebP poster around 640px wide
6. The processor posts both outputs to the signed completion endpoint.
7. Admin assigns succeeded derivatives to the four slots.
8. Public `/api/homepage/hero-videos` returns configured slots only when all four enabled slots point at succeeded derivatives.

If fewer than four slots are ready, the homepage keeps using the existing public Memvid fallback.

Manual uploads are saved as private admin-owned video assets using the same saved video asset/poster conventions as generated saved videos. The Admin UI attempts to create a WebP poster from the selected video before upload as a fast path, but missing posters are durable processor work, not a browser-only best effort. Source-poster jobs are claimed through `/api/internal/homepage/hero-videos/source-posters/jobs/claim`, download the private source through signed internal URLs, and complete through signed callbacks that populate `ai_text_assets.poster_r2_key`, dimensions, and size. Until that completes, Admin and Assets Manager APIs return a persistent `homepage_hero_source.poster_status` of `pending` or `failed` with retry metadata. Public Homepage Hero playback never serves the uploaded source video or private source poster URL.

## Hero Conversion Preset

The default derivative preset remains MP4/H.264, max 720px wide, 24 fps, no audio, up to 8 seconds, `+faststart`, CRF 30, and WebP poster around 640px wide.

Operators can adjust bounded structured preset fields in Admin:

- format/container: `mp4`
- codec: `h264`
- max width: 320-1080
- fps: 12-30
- duration cap: 3-12 seconds
- audio: default off
- CRF quality: 24-36
- encoder preset: allowed named presets only
- poster format/width: WebP, bounded width

The Worker validates and stores the preset in `app_settings` as `homepage_hero_ffmpeg_preset`. Raw ffmpeg CLI fragments are not accepted. The signed processor job payload includes the effective preset JSON, and each derivative row stores the preset used for reproducibility. Changing the preset affects new/retried derivative jobs only; succeeded derivatives are not rewritten in place.

## Memvid Stream Hover Flow

1. A video is published, the Admin clicks **Generate / repair Memvid previews**, or the scheduled catch-up cron runs.
2. The Auth Worker queues missing public Memvid preview rows idempotently by asset/source fingerprint and marks existing ready rows that lack Cloudflare MP4 download metadata for repair.
3. Publish-triggered dispatch waits until the queued/repair backlog reaches `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD` and respects `MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_COOLDOWN_SECONDS`. The Admin button remains a force/manual path and bypasses the cooldown. Scheduled catch-up handles low-volume sites so fewer than threshold new videos still get processed without terminal work.
4. If GitHub dispatch settings are configured, the Worker dispatches `.github/workflows/memvid-stream-preview-processor.yml` through the GitHub REST API; otherwise it returns a clear warning and leaves the jobs queued for the separately deployed processor.
5. A trusted processor/backfill path creates short preview clips for public Memvids.
6. The clip is uploaded to Cloudflare Stream.
7. The processor polls Cloudflare Stream video details until the uploaded video is ready, then calls Cloudflare Stream `/downloads`, polls until `result.default.status` is `ready`, and stores the real returned MP4 download URL in `provider_metadata_json`. If `/downloads` returns a transient 400 while Stream processing catches up, the processor retries within the bounded polling window instead of failing immediately.
8. `memvid_stream_previews` stores the safe Stream UID, duration, loop cap, ready status, and Stream download metadata.
9. Public Memvid list responses include `stream_preview` only for ready rows when the Worker flag and Admin metadata switch are effectively enabled. The MP4 URL is exposed only if it is an HTTPS Cloudflare Stream delivery URL.
10. Desktop hover/fine-pointer frontend code waits 100 ms before loading playback, keeps the poster visible until a video frame is ready, loops at most three times, and destroys the player on mouseleave.

The public `stream_preview` contract may include `autoplay_enabled: false` when metadata is allowed but the Admin hover-autoplay switch is off. The frontend treats that as poster-only and does not create a hover media element.

Mobile/touch and `prefers-reduced-motion` users get poster-only cards. Full click/tap playback continues to use the existing public Memvid file route.

Manual Cloudflare `/downloads` curl calls are no longer part of the operator workflow. If old ready rows have a Stream UID but no stored MP4 download URL, the same Admin button plus processor repair mode (`REPAIR_MEMVID_STREAM_DOWNLOADS=1`) repairs them.

Local development or emergency manual fallback remains available without changing production behavior:

```bash
PROCESS_HOMEPAGE_HERO=0 PROCESS_HOMEPAGE_SOURCE_POSTERS=0 PROCESS_MEMVID_STREAM_PREVIEWS=1 JOB_LIMIT=5 node services/homepage-ffmpeg-processor/processor.mjs
```

### Publish, Unpublish, And Cleanup Lifecycle

- Publishing a public video queues one active preview job when the Memvid Stream feature is effectively enabled and provider prerequisites exist. Re-publishing the same source does not duplicate active queued, processing, or ready work.
- When the publish backlog reaches the configured threshold, the Auth Worker may dispatch the processor automatically. A persisted dispatch state in `app_settings` records last dispatch time, reason, provider, status, and next cooldown boundary.
- The scheduled catch-up cron queues missing previews, repairs ready previews with missing MP4 download metadata, retries pending provider deletes, and dispatches the processor when cooldown rules allow.
- Making a video private immediately changes its active preview rows to `disabled` so public APIs stop returning `stream_preview`. The Worker then attempts to delete the Cloudflare Stream asset. Cloudflare 404/not found is treated as already deleted.
- Provider delete failures do not block the user action. The row stores retryable `delete_pending` metadata and scheduled cleanup retries deletion later. If Cloudflare Stream credentials are missing, rows are disabled locally and marked `not_configured` until an operator restores provider configuration.
- Republished assets get fresh preview work. Disabled previews from a prior public state are not re-enabled because their Stream UID was privacy-cleanup scoped.

## Cost Safety

Hero videos use one-time ffmpeg processing plus R2/CDN delivery. Memvid hover previews use Cloudflare Stream delivered minutes, so the frontend:

- does not preload hover media at render time
- starts only after desktop pointer hover and a delay
- does not autoplay on touch/mobile
- disables autoplay for reduced motion
- caps each hover session at three loops
- destroys/unloads media on mouseleave

Estimated delivered minutes:

```text
hoverStarts * previewDurationSeconds * maxLoops / 60
```

The Admin Homepage Hero Videos module shows Stream preview status counts, ready/failed totals, feature-flag state, provider-configuration state, and estimated delivered minutes from hover telemetry.

## Retry And Backfill

- Failed homepage hero derivatives can be retried from Admin through the derivative retry route.
- Manual hero uploads without source posters can be retried from Admin; the retry marks durable pending state for the external ffmpeg source-poster processor instead of requiring browser frame extraction.
- Memvid Stream preview one-click processing should create or update `memvid_stream_previews` rows idempotently by asset/source fingerprint, upload only short preview clips to Stream, prepare the Cloudflare MP4 download, and store the real ready download URL before public hover autoplay relies on the row.
- Do not upload full original Memvids to Stream unless a future approved operator decision accepts the storage/delivered-minute impact.
