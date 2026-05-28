# BITBI Homepage FFmpeg Processor

This service processes queued Homepage Hero Video derivative jobs and private
manual-upload source poster jobs from the Auth Worker.

Required environment:

- `AUTH_WORKER_BASE_URL`, for example `https://bitbi.ai`
- `HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET`, `HOMEPAGE_HERO_PROCESSOR_SECRET`, or `MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET`

Optional environment:

- `JOB_LIMIT`, default `1`, max `4`
- `PROCESS_HOMEPAGE_HERO=0` to skip Homepage Hero jobs
- `PROCESS_HOMEPAGE_SOURCE_POSTERS=0` to skip private manual-upload source poster backfill jobs
- `PROCESS_MEMVID_STREAM_PREVIEWS=1` to claim short Memvid preview jobs
- `REPAIR_MEMVID_STREAM_DOWNLOADS=1` to repair ready Memvid Stream preview rows that have a Stream UID but no stored ready MP4 download URL
- `CLOUDFLARE_ACCOUNT_ID` or `STREAM_ACCOUNT_ID`
- `CLOUDFLARE_STREAM_API_TOKEN` or `STREAM_API_TOKEN`
- `STREAM_DOWNLOAD_POLL_INTERVAL_MS`, default `5000`
- `STREAM_DOWNLOAD_MAX_WAIT_MS`, default `300000`
- `DRY_RUN=1` to claim and print jobs without downloading or completing them
- `WORK_DIR`, default OS temp directory
- `FFMPEG_BIN`, default `ffmpeg`
- `FFPROBE_BIN`, default `ffprobe`

Run locally:

```bash
npm --prefix services/homepage-ffmpeg-processor run dry-run
```

The processor downloads sources only through signed internal Auth Worker URLs, writes optimized MP4/WebP outputs locally, uploads derivatives or private source posters through signed completion endpoints, and reports sanitized failures through signed fail endpoints.

Homepage Hero jobs include a validated structured preset from the Auth Worker. The processor constructs ffmpeg arguments from those bounded fields only; it does not accept raw ffmpeg command fragments from Admin/browser input.

Manual Homepage Hero source uploads without a browser-provided poster are exposed
as source-poster jobs at `/api/internal/homepage/hero-videos/source-posters/jobs/claim`.
Those jobs extract a WebP frame and store it on the private `ai_text_assets`
poster fields through the Auth Worker. The public homepage still serves only
ready optimized hero derivatives, never these private source originals.

Memvid Stream preview jobs are short-preview-only. After uploading the clip to
Cloudflare Stream, the processor calls the Stream `/downloads` API, polls until
the default MP4 download is `ready`, and sends the real returned download URL to
the Auth Worker. Public hover previews use that stored Cloudflare delivery URL
after the Worker validates the host. Manual `/downloads` curl calls are not part
of the production operator flow.
