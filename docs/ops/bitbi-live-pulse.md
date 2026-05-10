# Bitbi Live Pulse Operations

Bitbi Live Pulse is a public homepage layer backed by the auth Worker endpoint:

- `GET /api/public/news-pulse?locale=en`
- `GET /api/public/news-pulse?locale=de`

The browser only calls Bitbi's own Worker endpoint. It does not fetch third-party news sources directly.

Desktop homepage rendering remains public and uses the vertical Live Pulse wheel.
Mobile homepage rendering is member-only: logged-out mobile visitors do not fetch or see
Live Pulse content. Logged-in mobile members see one localized item at a time.

Mobile placement is measured in the browser from the real viewport geometry:

- start reference: bottom edge of the site header
- end reference: top edge of the BITBI hero logo image
- ticker top: `headerBottom + 5% * (heroLogoTop - headerBottom)`
- ticker bottom: `headerBottom + 83% * (heroLogoTop - headerBottom)`

The mobile ticker rotates every 5 seconds with a cube-style transition. Reduced-motion
users get the same cadence without the 3D cube animation.

OpenClaw can push curated public display items through the auth Worker only:

- `POST /api/openclaw/news-pulse/ingest`

Wrangler is for deploys, D1 migrations, secrets, manual tests, and logs. It is not the runtime upload mechanism for the local OpenClaw bot.

## Data Model

News Pulse cached items live in the auth D1 database table `news_pulse_items`. The OpenClaw ingest replay guard uses `openclaw_ingest_nonces`.

Apply migration:

```sh
npx wrangler d1 migrations apply bitbi-auth-db --remote
```

The public endpoint serves at most the newest active, unexpired items for the requested locale. If the table is missing or empty, it serves deterministic, source-attributed fallback entries that point to official source pages.

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

## Cron and Bindings

No new binding is required beyond the existing auth Worker D1 binding `DB`.

The existing auth Worker cron (`0 3 * * *`) calls the refresh foundation. If `NEWS_PULSE_SOURCE_URLS` is unset, the scheduled step skips cleanly and the public endpoint continues serving fallback data.

## Content Rules

- Do not copy full article text.
- Keep summaries short and source-attributed.
- Preserve the original source label and source URL.
- Do not hotlink third-party images unless a later source is explicitly licensed and configured.
- Prefer Bitbi-native icons/placeholders for homepage visuals.
- Internal OpenClaw activity logs are not homepage content. Only curated payload items sent to the ingest route may enter `news_pulse_items`.
- The public homepage continues reading only `GET /api/public/news-pulse?locale=en|de`.

## Deployment

Deploy order:

1. Apply auth D1 migrations.
2. Set `OPENCLAW_INGEST_SECRET` on the auth Worker.
3. Deploy the auth Worker.
4. Deploy static/GitHub Pages assets if docs or frontend assets changed.
5. Use `npx wrangler tail` to verify the first OpenClaw ingest attempts.

Static-only deploys are not enough for the endpoint because the Worker route and D1 migration are part of this feature.
