# Bitbi Live Pulse Operations

Bitbi Live Pulse is a public homepage layer backed by the auth Worker endpoint:

- `GET /api/public/news-pulse?locale=en`
- `GET /api/public/news-pulse?locale=de`

The browser only calls Bitbi's own Worker endpoint. It does not fetch third-party news sources directly.

## Data Model

News Pulse cached items live in the auth D1 database table `news_pulse_items`.

Apply migration:

```sh
npx wrangler d1 migrations apply bitbi-auth-db --remote
```

The public endpoint serves at most the newest active, unexpired items for the requested locale. If the table is missing or empty, it serves deterministic, source-attributed fallback entries that point to official source pages.

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

## Deployment

Deploy order:

1. Apply auth D1 migrations.
2. Deploy the auth Worker.
3. Deploy static/GitHub Pages assets.

Static-only deploys are not enough for the endpoint because the Worker route and D1 migration are part of this feature.
