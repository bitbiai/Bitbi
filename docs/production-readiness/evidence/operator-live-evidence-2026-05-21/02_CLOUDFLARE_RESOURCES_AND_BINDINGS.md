# 02 - Cloudflare Resources And Bindings

Date:

Operator:

Account/zone reviewed:

This checklist is presence/shape evidence only. Do not record secret values, tokens, raw object keys, cookies, or private URLs.

## Workers

| Worker | Expected name | Deployed version/commit | Evidence reference | Result |
| --- | --- | --- | --- | --- |
| Auth Worker | `bitbi-auth` |  |  | pending |
| AI Worker | `bitbi-ai` |  |  | pending |
| Contact Worker | `bitbi-contact` |  |  | pending |

## Routes And Domains

| Surface | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth API route | `bitbi.ai/api/*` |  | pending |
| Contact route | `contact.bitbi.ai` |  | pending |
| Static site | GitHub Pages / `bitbi.ai` |  | pending |
| Custom domains/certificates | operator-reviewed |  | pending |

## D1

| Item | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth D1 database | `bitbi-auth-db` |  | pending |
| Latest applied migration | `0060_add_app_settings.sql` |  | pending |
| Migration evidence records names/status only | yes |  | pending |

## R2

| Binding | Expected bucket | Evidence reference | Result |
| --- | --- | --- | --- |
| `PRIVATE_MEDIA` | `bitbi-private-media` |  | pending |
| `USER_IMAGES` | `bitbi-user-images` |  | pending |
| `AUDIT_ARCHIVE` | `bitbi-audit-archive` |  | pending |

Do not list private object keys. Record bucket presence only.

## Queues

| Binding | Expected queue | Evidence reference | Result |
| --- | --- | --- | --- |
| `ACTIVITY_INGEST_QUEUE` | `bitbi-auth-activity-ingest` |  | pending |
| `AI_IMAGE_DERIVATIVES_QUEUE` | `bitbi-ai-image-derivatives` |  | pending |
| `AI_VIDEO_JOBS_QUEUE` | `bitbi-ai-video-jobs` |  | pending |

## Durable Objects

| Worker | Binding | Class | Evidence reference | Result |
| --- | --- | --- | --- | --- |
| Auth | `PUBLIC_RATE_LIMITER` | `AuthPublicRateLimiterDurableObject` |  | pending |
| Contact | `PUBLIC_RATE_LIMITER` | `ContactPublicRateLimiterDurableObject` |  | pending |
| AI | `SERVICE_AUTH_REPLAY` | `AiServiceAuthReplayDurableObject` |  | pending |

## Other Bindings And Dashboard Settings

| Item | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Cloudflare Images binding | `IMAGES` |  | pending |
| Workers AI binding | `AI` |  | pending |
| Auth to AI service binding | `AI_LAB` -> `bitbi-ai` |  | pending |
| Auth cron trigger | `0 3 * * *` |  | pending |
| Dashboard WAF/rate limits | reviewed, not repo-proven |  | pending |
| Static security Transform Rules | reviewed, not repo-proven |  | pending |
| RUM setting | reviewed, not repo-proven |  | pending |
| Alerts/notifications | reviewed, not repo-proven |  | pending |

## Secret Presence Only

Record presence only. Never record values.

- [ ] Auth required secrets present by name.
- [ ] AI required secrets present by name.
- [ ] Contact required secrets present by name.
- [ ] No secret values copied into this package.

