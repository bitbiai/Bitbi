# Homepage Hero And Memvid Stream Video Derivatives

Status: production path is feature-flagged. `config/release-compat.json` is authoritative for the current auth D1 migration checkpoint.

Deploy unit: `homepage-ffmpeg-processor`. The release planner classifies `services/homepage-ffmpeg-processor/**` as a non-static processor/service deploy concern. Static Pages does not deploy this processor.

## Scope

This runbook covers two public video-delivery paths:

- Homepage Hero Videos: Admin-selected source videos are converted once by an external ffmpeg processor and served as versioned MP4/WebP derivatives from R2.
- Memvids Explore hover previews: public Memvid cards may expose short Cloudflare Stream preview metadata when a ready preview row exists.

Original AI, user-uploaded, or Admin-uploaded source videos are never returned by the public homepage hero API and are not used for hover autoplay.

## Feature Flags And Secrets

Auth Worker feature flags:

- `ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG`
- `ENABLE_HOMEPAGE_HERO_MANUAL_UPLOADS`
- `ENABLE_MEMVID_STREAM_PREVIEWS`
- `ENABLE_MEMVID_STREAM_PREVIEW_AUTOPLAY`

Processor/provider secrets:

- `HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET` or `HOMEPAGE_HERO_PROCESSOR_SECRET`
- `CLOUDFLARE_ACCOUNT_ID` or `STREAM_ACCOUNT_ID`
- `CLOUDFLARE_STREAM_API_TOKEN` or `STREAM_API_TOKEN`
- `MEMVID_STREAM_PREVIEW_MAX_DURATION_SECONDS`
- `MEMVID_STREAM_PREVIEW_MAX_LOOPS`

With flags or secrets absent, provider work fails closed and the public site falls back to existing poster/full-play behavior.

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

## Memvid Stream Hover Flow

1. A trusted processor/backfill path creates short preview clips for public Memvids.
2. The clip is uploaded to Cloudflare Stream.
3. `memvid_stream_previews` stores the safe Stream UID, duration, loop cap, and ready status.
4. Public Memvid list responses include `stream_preview` only for ready rows.
5. Desktop hover/fine-pointer frontend code waits before loading playback, loops at most three times, and destroys the player on mouseleave.

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
- Memvid Stream preview backfill should create or update `memvid_stream_previews` rows idempotently by asset/source fingerprint, upload only short preview clips to Stream, and mark old rows `superseded` instead of deleting evidence.
- Do not upload full original Memvids to Stream unless a future approved operator decision accepts the storage/delivered-minute impact.
