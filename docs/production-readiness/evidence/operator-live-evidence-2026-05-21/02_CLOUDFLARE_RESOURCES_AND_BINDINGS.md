# 02 - Cloudflare Resources And Bindings

Date: 2026-05-21

Operator: pending human review; repo-derived expectations filled by Codex

Account/zone reviewed: pending operator dashboard verification

This checklist is presence/shape evidence only. Do not record secret values, tokens, raw object keys, cookies, or private URLs.

Repo evidence source: `config/release-compat.json` and `npm run cloudflare:resource-model`.

Local command status: passed; repo_config_only; no Cloudflare API calls; no mutations; issueCount `0`.

## Workers

| Worker | Expected name | Deployed version/commit | Evidence reference | Result |
| --- | --- | --- | --- | --- |
| Auth Worker | `bitbi-auth` | operator to verify in Cloudflare | Repo-declared in `config/release-compat.json`; live deploy id pending | repo-declared / pending operator verification |
| AI Worker | `bitbi-ai` | operator to verify in Cloudflare | Repo-declared in `config/release-compat.json`; live deploy id pending | repo-declared / pending operator verification |
| Contact Worker | `bitbi-contact` | operator to verify in Cloudflare | Repo-declared in `config/release-compat.json`; live deploy id pending | repo-declared / pending operator verification |

## Routes And Domains

| Surface | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth API route | `bitbi.ai/api/*` | Repo-declared; operator screenshot/note pending | repo-declared / pending operator verification |
| Contact route | `contact.bitbi.ai` | Repo-declared; operator screenshot/note pending | repo-declared / pending operator verification |
| Static site | GitHub Pages / `bitbi.ai` | Repo workflow declared; Pages deploy state pending | pending operator verification |
| Custom domains/certificates | operator-reviewed | Operator dashboard verification pending | pending |

## D1

| Item | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth D1 database | `bitbi-auth-db` | Repo-declared in release contract | repo-declared / pending remote verification |
| Latest applied migration | `0060_add_app_settings.sql` | Latest expected checkpoint from release contract | pending operator remote migration status |
| Migration evidence records names/status only | yes | Operator must attach names/status only, no data rows | pending |

## R2

| Binding | Expected bucket | Evidence reference | Result |
| --- | --- | --- | --- |
| `PRIVATE_MEDIA` | `bitbi-private-media` | Repo-declared; no live listing run | repo-declared / pending operator verification |
| `USER_IMAGES` | `bitbi-user-images` | Repo-declared; no live listing run | repo-declared / pending operator verification |
| `AUDIT_ARCHIVE` | `bitbi-audit-archive` | Repo-declared; no live listing run | repo-declared / pending operator verification |

Do not list private object keys. Record bucket presence only.

## Queues

| Binding | Expected queue | Evidence reference | Result |
| --- | --- | --- | --- |
| `ACTIVITY_INGEST_QUEUE` | `bitbi-auth-activity-ingest` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| `AI_IMAGE_DERIVATIVES_QUEUE` | `bitbi-ai-image-derivatives` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| `AI_VIDEO_JOBS_QUEUE` | `bitbi-ai-video-jobs` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |

## Durable Objects

| Worker | Binding | Class | Evidence reference | Result |
| --- | --- | --- | --- | --- |
| Auth | `PUBLIC_RATE_LIMITER` | `AuthPublicRateLimiterDurableObject` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| Contact | `PUBLIC_RATE_LIMITER` | `ContactPublicRateLimiterDurableObject` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| AI | `SERVICE_AUTH_REPLAY` | `AiServiceAuthReplayDurableObject` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |

## Other Bindings And Dashboard Settings

| Item | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Cloudflare Images binding | `IMAGES` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| Workers AI binding | `AI` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| Auth to AI service binding | `AI_LAB` -> `bitbi-ai` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| Auth cron trigger | `0 3 * * *` | Repo-declared; dashboard evidence pending | repo-declared / pending operator verification |
| Dashboard WAF/rate limits | reviewed, not repo-proven | Operator dashboard evidence required | pending |
| Static security Transform Rules | reviewed, not repo-proven | Operator dashboard evidence required | pending |
| RUM setting | reviewed, not repo-proven | Operator dashboard evidence required | pending |
| Alerts/notifications | reviewed, not repo-proven | Operator dashboard evidence required | pending |

## Secret Presence Only

Record presence only. Never record values.

- [ ] Auth required secrets present by name.
- [ ] AI required secrets present by name.
- [ ] Contact required secrets present by name.
- [x] No secret values copied into this package during Codex evidence sprint.
