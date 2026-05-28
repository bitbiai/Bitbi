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

With provider secrets/config absent, provider work fails closed and the public site falls back to existing poster/full-play behavior. Missing provider secrets do not imply production readiness even when Worker flags and Admin switches are on.

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

1. A trusted processor/backfill path creates short preview clips for public Memvids.
2. The clip is uploaded to Cloudflare Stream.
3. `memvid_stream_previews` stores the safe Stream UID, duration, loop cap, and ready status.
4. Public Memvid list responses include `stream_preview` only for ready rows when the Worker flag and Admin metadata switch are effectively enabled.
5. Desktop hover/fine-pointer frontend code waits before loading playback, loops at most three times, and destroys the player on mouseleave.

The public `stream_preview` contract may include `autoplay_enabled: false` when metadata is allowed but the Admin hover-autoplay switch is off. The frontend treats that as poster-only and does not create a hover media element.

Mobile/touch and `prefers-reduced-motion` users get poster-only cards. Full click/tap playback continues to use the existing public Memvid file route.

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
- Memvid Stream preview backfill should create or update `memvid_stream_previews` rows idempotently by asset/source fingerprint, upload only short preview clips to Stream, and mark old rows `superseded` instead of deleting evidence.
- Do not upload full original Memvids to Stream unless a future approved operator decision accepts the storage/delivered-minute impact.
