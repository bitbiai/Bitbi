# Bitbi Live Pulse Operations

Bitbi Live Pulse is a public homepage layer backed by the auth Worker endpoint:

- `GET /api/public/news-pulse?locale=en`
- `GET /api/public/news-pulse?locale=de`
- `GET /api/public/news-pulse/thumbs/:id`

The browser only calls Bitbi's own Worker endpoints. It does not fetch third-party news sources or article images directly.

Desktop homepage rendering remains public and uses the vertical Live Pulse wheel.
Ready generated thumbnails render only as small desktop visuals. Missing, failed, pending, or skipped thumbnail states keep the existing dot/icon fallback.
Mobile homepage rendering is member-only: logged-out mobile visitors do not fetch or see
Live Pulse content. Logged-in mobile members see one localized item at a time.
Mobile rendering does not use News Pulse thumbnails.

Mobile placement is measured in the browser from the real viewport geometry:

- start reference: bottom edge of the site header
- end reference: top edge of the BITBI hero logo image
- ticker top: `headerBottom + 5% * (heroLogoTop - headerBottom)`
- ticker bottom: `headerBottom + 95% * (heroLogoTop - headerBottom)`

The mobile ticker rotates every 5 seconds with a true cube-face transition:
the outgoing item is the front face, the incoming item is the right face, and
the cube turns left without crossfading or stacking text layers. Reduced-motion
users get the same cadence without the 3D cube rotation.

OpenClaw can push curated public display items through the auth Worker only:

- `POST /api/openclaw/news-pulse/ingest`

Wrangler is for deploys, D1 migrations, secrets, manual tests, and logs. It is not the runtime upload mechanism for the local OpenClaw bot.

## Data Model

News Pulse cached items live in the auth D1 database table `news_pulse_items`. The OpenClaw ingest replay guard uses `openclaw_ingest_nonces`.

Migration `0045_add_news_pulse_visuals.sql` adds generated-thumbnail metadata:

- `visual_prompt`
- `visual_status` with logical states `missing`, `pending`, `ready`, `failed`, `skipped`
- `visual_object_key`
- `visual_thumb_url`
- `visual_generated_at`
- `visual_error`
- `visual_attempts`
- `visual_updated_at`

The migration is additive only. Existing rows default to `visual_status = 'missing'` and continue serving the existing icon/dot fallback until a thumbnail is generated.

Apply migration:

```sh
npx wrangler d1 migrations apply bitbi-auth-db --remote
```

The public endpoint serves at most the newest active, unexpired items for the requested locale. If the table is missing or empty, it serves deterministic, source-attributed fallback entries that point to official source pages.

The public JSON response remains backwards-compatible. When a thumbnail is ready, an item may include:

```json
{
  "visual_type": "generated",
  "visual_url": "/api/public/news-pulse/thumbs/<item-id>",
  "visual_thumb_url": "/api/public/news-pulse/thumbs/<item-id>",
  "visual_alt": "Generated abstract thumbnail for <title>"
}
```

Internal object keys, prompts, errors, provider details, and secrets are never returned by the public endpoint.

## OpenClaw Ingest

Set the auth Worker HMAC secret before enabling runtime ingest:

```sh
npx wrangler secret put OPENCLAW_INGEST_SECRET
```

Optional rotation secret:

```sh
npx wrangler secret put OPENCLAW_INGEST_SECRET_NEXT
```

Required request headers:

```text
Content-Type: application/json
X-OpenClaw-Agent: openclaw-mac
X-OpenClaw-Timestamp: 2026-05-09T12:00:00.000Z
X-OpenClaw-Nonce: random-cryptographic-nonce
X-OpenClaw-Signature: sha256=<hex>
X-OpenClaw-Key-Id: current
```

`X-OpenClaw-Key-Id` is optional. Use `next` only during planned secret rotation after `OPENCLAW_INGEST_SECRET_NEXT` is set.

Canonical signature input:

```text
POST
/api/openclaw/news-pulse/ingest
<timestamp header>
<nonce header>
<sha256 hex of the raw JSON request body>
```

Signature:

```text
HMAC_SHA256(OPENCLAW_INGEST_SECRET, canonical_string)
```

The timestamp must be within 5 minutes and each nonce can be used once. The route rate-limits by agent and by IP, rejects oversized bodies over 32 KB, and fails closed if the secret, D1 nonce table, or rate-limit binding is unavailable.

Example payload:

```json
{
  "locale": "de",
  "items": [
    {
      "title": "Kuratierte KI-Statusmeldung",
      "summary": "Kurze quellenbezogene Meldung fuer den Bitbi Live Pulse.",
      "source": "OpenClaw",
      "url": "https://example.com/ai/status",
      "category": "KI",
      "published_at": "2026-05-09T12:00:00.000Z",
      "visual_type": "icon",
      "visual_url": null,
      "visual_prompt": "abstract AI model launch signal, dark neon editorial thumbnail",
      "external_id": "openclaw-status-2026-05-09",
      "tags": ["ki", "status"]
    }
  ],
  "dry_run": false
}
```

Example curl shape using placeholders:

```sh
curl -X POST "https://bitbi.ai/api/openclaw/news-pulse/ingest" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Agent: openclaw-mac" \
  -H "X-OpenClaw-Timestamp: <timestamp>" \
  -H "X-OpenClaw-Nonce: <nonce>" \
  -H "X-OpenClaw-Signature: sha256=<hmac_hex>" \
  --data-binary @payload.json
```

Use `scripts/openclaw-news-pulse-sign.mjs` locally to generate signed headers from a payload file. The script reads `OPENCLAW_INGEST_SECRET` from the local environment and does not store the secret.

## Refresh Configuration

The scheduled Worker refresh is prepared for configured RSS/Atom/JSON Feed sources. It is safe when no source configuration exists.

Optional auth Worker variable:

```text
NEWS_PULSE_SOURCE_URLS
```

Supported formats:

- JSON array: `["https://example.com/feed.xml"]`
- JSON array with locale hints: `[{"url":"https://example.com/feed.xml","locale":"de"}]`
- comma- or newline-separated URLs

Only `https:` source URLs are accepted. The refresh keeps the flow defensive:

- fetch configured sources with a short timeout
- parse JSON Feed, RSS, or Atom
- normalize short titles/summaries
- deduplicate by URL
- keep AI/creative-tech relevant items
- store a bounded set with an expiry timestamp
- delete expired rows during the scheduled cleanup

The MVP does not use AI summarization or translation. TODO: wire localized AI summaries only through an approved Worker-side pattern with existing bindings and secret handling. Do not add paid API keys or AI summarization secrets directly to this flow.

## Generated Thumbnails

OpenClaw may send `visual_prompt` as a suggestion, but Bitbi never trusts it directly. The auth Worker stores a constrained internal prompt built from the item title, summary, category, source, and optional suggestion.

Prompt safety rules:

- abstract Bitbi-native AI/editorial style
- no logos, readable text, trademarks, watermarks, people, portraits, real-person likenesses, copyrighted characters, or political campaign imagery
- source names and known brand terms are stripped from prompt hints
- no third-party article images are copied, fetched, uploaded, or hotlinked

The auth Worker scheduled handler runs a small bounded thumbnail backfill after the News Pulse refresh. It selects active, unexpired rows with `visual_status` `missing` or retryable `failed`, `visual_attempts < 3`, and a valid title/source URL. It then:

1. sets `visual_status = 'pending'` and increments `visual_attempts`
2. calls the existing Cloudflare Workers AI binding with `@cf/black-forest-labs/flux-1-schnell`
3. converts the result through the existing `IMAGES` binding to a small WebP thumbnail, currently 256x256 max
4. stores the object in `USER_IMAGES`
5. sets `visual_status = 'ready'`, `visual_type = 'generated'`, and stores the public thumb URL

Failures set `visual_status = 'failed'` with a short sanitized internal error. Public News Pulse serving continues normally and falls back to the dot/icon. Rows with `ready`, `pending`, `skipped`, expired, invalid, or max-attempt states are not generated again.

Object keys are deterministic and scoped:

```text
news-pulse/thumbs/{item_id}.webp
```

The public thumbnail route looks up the ready row in D1 and serves only the stored object from `USER_IMAGES`. Request paths cannot choose arbitrary R2 keys.

## Cron and Bindings

No new binding is required beyond existing auth Worker bindings:

- `DB` for `news_pulse_items`
- `AI` for FLUX.1 Schnell generation
- `IMAGES` for WebP thumbnail derivation
- `USER_IMAGES` for `news-pulse/thumbs/{item_id}.webp`

The existing auth Worker cron (`0 3 * * *`) calls the refresh foundation and then processes a conservative thumbnail batch. If `NEWS_PULSE_SOURCE_URLS` is unset, the refresh step skips cleanly. If AI, Images, or R2 bindings are unavailable, thumbnail processing skips cleanly and the public endpoint continues serving fallback data.

## Content Rules

- Do not copy full article text.
- Keep summaries short and source-attributed.
- Preserve the original source label and source URL.
- Do not hotlink third-party images.
- Prefer Bitbi-generated abstract thumbnails or Bitbi-native icons/placeholders for homepage visuals.
- Internal OpenClaw activity logs are not homepage content. Only curated payload items sent to the ingest route may enter `news_pulse_items`.
- The public homepage continues reading only `GET /api/public/news-pulse?locale=en|de`.

## Deployment

Deploy order:

1. Apply auth D1 migrations.
2. Set `OPENCLAW_INGEST_SECRET` on the auth Worker.
3. Verify existing auth Worker bindings `AI`, `IMAGES`, and `USER_IMAGES` are present.
4. Deploy the auth Worker.
5. Deploy static/GitHub Pages assets for the desktop thumbnail renderer.
6. Use `npx wrangler tail` to verify OpenClaw ingest and scheduled thumbnail backfill attempts.

Static-only deploys are not enough for the endpoint because the Worker route and D1 migration are part of this feature.
