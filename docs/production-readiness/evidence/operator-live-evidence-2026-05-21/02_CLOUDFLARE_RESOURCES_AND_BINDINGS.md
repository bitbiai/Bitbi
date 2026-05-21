# 02 - Cloudflare Resources And Bindings

Date: 2026-05-21

Operator: pending human review; repo-derived expectations filled by Codex

Account/zone reviewed: pending operator dashboard verification

This checklist is presence/shape evidence only. Do not record secret values, tokens, raw object keys, cookies, or private URLs.

Repo evidence source: `config/release-compat.json` and `npm run cloudflare:resource-model`.

Local command status: passed; repo_config_only; no Cloudflare API calls; no mutations; issueCount `0`.

Current resource-model summary:

- Total repo-declared resources: `74`
- Repo-validated resources: `36`
- Live-verification-required resources: `11`
- Optional/fail-closed resources: `8`
- Dashboard-managed pending resources: `19`
- Repo truth is live proof: `false`
- Production readiness: `blocked`

Final master closure refresh:

- `npm run validate:cloudflare-prereqs` passed repo config validation and kept production deploy readiness `BLOCKED` because live Cloudflare validation was skipped.
- `npm run cloudflare:resource-model` and `npm run cloudflare:resource-model:markdown` passed with the same repo-config-only summary.
- No Cloudflare API verification phrase was present; no Cloudflare API commands were run.

Mega Packet refresh:

- `npm run validate:cloudflare-prereqs` passed repo-controlled prerequisite checks and kept production deploy readiness `BLOCKED` because live validation was skipped.
- `npm run cloudflare:resource-model` and `npm run cloudflare:resource-model:markdown` passed again in local-only mode at the current commit.
- No Cloudflare API verification phrase was provided as an operator approval; dashboard/API evidence below remains pending unless a sanitized operator artifact is attached.

## Full Operator Verification Matrix

| Item | Expected repo-declared value | Evidence source | Verification status | Evidence required | Redaction required | Owner/date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth Worker | `bitbi-auth` | repo-declared + local resource model | pending | Cloudflare Worker deployment name, latest deploy/version id, timestamp, deployed commit if visible | no env values, no secrets, no logs with cookies/tokens | operator/date pending | Do not deploy from this evidence task. |
| AI Worker | `bitbi-ai` | repo-declared + local resource model | pending | Cloudflare Worker deployment name, latest deploy/version id, timestamp, deployed commit if visible | no env values, no provider keys | operator/date pending | Internal service Worker; live presence still must be verified. |
| Contact Worker | `bitbi-contact` | repo-declared + local resource model | pending | Cloudflare Worker deployment name, latest deploy/version id, timestamp, deployed commit if visible | no env values, no Resend key | operator/date pending | Contact health 200 was previously observed, but deploy id remains pending. |
| Auth route | `bitbi.ai/api/*` | repo-declared + local resource model | pending | Cloudflare route screenshot/note showing route pattern and target Worker | no cookies, request logs, or auth headers | operator/date pending | Presence/shape only. |
| Contact route/domain | `contact.bitbi.ai` | repo-declared + local resource model | pending | Cloudflare route/custom-domain evidence showing target Worker | no cookies, request logs, or auth headers | operator/date pending | Presence/shape only. |
| Public static domain | `bitbi.ai` | GitHub Pages workflow + previous public 200 check | partial | Pages deploy id/build id and custom-domain evidence | no GitHub tokens or private settings | operator/date pending | Public 200 was observed; Pages deploy id remains pending. |
| GitHub Pages/static site domain | `.github/workflows/static.yml` and `bitbi.ai` | repo-declared | pending | GitHub Pages deployment id, workflow run id, deployed commit | no GitHub tokens | operator/date pending | Static deploy safety is repo-local; live deploy match remains pending. |
| Auth D1 database | `bitbi-auth-db` | repo-declared + local resource model | pending | D1 database presence and migration history/status through `0060_add_app_settings.sql` | no table rows, no user data, no query output | operator/date pending | Remote D1 status was not checked by Codex. |
| Latest auth migration | `0060_add_app_settings.sql` | release contract + doc currentness | pending | Dashboard or read-only operator evidence that remote migration status includes `0060_add_app_settings.sql` | migration names/status only | operator/date pending | Do not run migration apply. |
| Private media R2 | `bitbi-private-media` | repo-declared + local resource model | pending | Bucket presence only | no object listing, keys, signed URLs, private media URLs | operator/date pending | No R2 listing was run. |
| User images R2 | `bitbi-user-images` | repo-declared + local resource model | pending | Bucket presence only | no object listing, keys, signed URLs, private media URLs | operator/date pending | No R2 listing was run. |
| Audit archive R2 | `bitbi-audit-archive` | repo-declared + local resource model | pending | Bucket presence only | no object listing, keys, signed URLs | operator/date pending | Dashboard-managed creation remains pending in model. |
| Activity queue | `bitbi-auth-activity-ingest` | repo-declared + local resource model | pending | Queue presence and producer/consumer binding names | no message payloads | operator/date pending | Dashboard-managed creation remains pending. |
| Image derivatives queue | `bitbi-ai-image-derivatives` | repo-declared + local resource model | pending | Queue presence and producer/consumer binding names | no message payloads | operator/date pending | Dashboard-managed creation remains pending. |
| AI video jobs queue | `bitbi-ai-video-jobs` | repo-declared + local resource model | pending | Queue presence and producer/consumer binding names | no message payloads | operator/date pending | Dashboard-managed creation remains pending. |
| Auth public rate limiter DO | `PUBLIC_RATE_LIMITER` / `AuthPublicRateLimiterDurableObject` | repo-declared + local resource model | pending | Binding/class presence | no DO state output | operator/date pending | Presence/shape only. |
| Contact public rate limiter DO | `PUBLIC_RATE_LIMITER` / `ContactPublicRateLimiterDurableObject` | repo-declared + local resource model | pending | Binding/class presence | no DO state output | operator/date pending | Presence/shape only. |
| AI service-auth replay DO | `SERVICE_AUTH_REPLAY` / `AiServiceAuthReplayDurableObject` | repo-declared + local resource model | pending | Binding/class presence | no DO state output | operator/date pending | Presence/shape only. |
| Cloudflare Images | `IMAGES` binding | repo-declared + local resource model | pending | Binding presence and Images feature enabled | no image ids/private media | operator/date pending | Dashboard feature evidence remains pending. |
| Workers AI | `AI` binding | repo-declared + local resource model | pending | Binding presence on Auth and AI Workers | no provider prompts/payloads | operator/date pending | Presence/shape only. |
| Auth to AI service binding | `AI_LAB -> bitbi-ai` | repo-declared + local resource model | pending | Service binding target name/environment | no service auth secret | operator/date pending | Presence/shape only. |
| Worker vars by name | `APP_BASE_URL`, `RESEND_FROM_EMAIL`, `BITBI_ENV` | repo-declared + local resource model | repo-validated / live pending | Dashboard vars by name and non-secret values where already repo-declared | no unrelated env vars/secrets | operator/date pending | Record names and expected non-secret values only. |
| Required secrets by name | 11 required secret-name checks | local resource model | pending | Presence by name only for required Auth, AI, Contact secrets | never record values | operator/date pending | See required secret matrix below. |
| Optional/fail-closed secrets | 8 optional/fail-closed secret-name checks | local resource model | pending | Presence/absence by name only if needed for approved feature scope | never record values | operator/date pending | Absence does not enable readiness claims. |
| Auth cron | `0 3 * * *` | repo-declared + local resource model | pending | Scheduled trigger presence | no logs with private data | operator/date pending | Presence/shape only. |
| WAF/sensitive POST rate limit | dashboard-managed | release plan optional prerequisite + resource model | pending | Dashboard rule presence/scope/status | no request logs/customer data | operator/date pending | Optional prerequisite; still must be reviewed before readiness. |
| Static security Transform Rules | dashboard-managed | release plan optional prerequisite + resource model | pending | Transform Rules/header setting evidence | no tokens/screens showing unrelated settings | operator/date pending | Required for remaining security-header policy confidence. |
| RUM setting | dashboard-managed | release plan optional prerequisite + resource model | pending | RUM setting status | no analytics raw user data | operator/date pending | Dashboard-only setting. |
| Alerts/notifications | dashboard-managed/manual | SLO baseline + resource model context | pending | Alert policies, notification routes, owners | no recipient secrets/webhooks | operator/date pending | Not repo-proven. |
| Custom domains/certificates | dashboard-managed/manual | release runbook context | pending | Domain/certificate active status for `bitbi.ai` and `contact.bitbi.ai` | no DNS account secrets | operator/date pending | Presence/shape only. |
| Cache/security policies | dashboard-managed/manual | live/header checklist context | pending | Cache, header, CORS, frame/CSP policies | no logs or private requests | operator/date pending | Required before security-header readiness. |

## Required Secret Presence Matrix

Record only presence by name. Never record values.

| Worker | Secret name | Status | Evidence required |
| --- | --- | --- | --- |
| Auth | `SESSION_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `SESSION_HASH_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `PAGINATION_SIGNING_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `ADMIN_MFA_ENCRYPTION_KEY` | pending | Cloudflare secret presence by name only |
| Auth | `ADMIN_MFA_PROOF_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `ADMIN_MFA_RECOVERY_HASH_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `AI_SAVE_REFERENCE_SIGNING_SECRET` | pending | Cloudflare secret presence by name only |
| Auth | `RESEND_API_KEY` | pending | Cloudflare secret presence by name only |
| Auth | `AI_SERVICE_AUTH_SECRET` | pending | Cloudflare secret presence by name only |
| AI | `AI_SERVICE_AUTH_SECRET` | pending | Cloudflare secret presence by name only |
| Contact | `RESEND_API_KEY` | pending | Cloudflare secret presence by name only |

## Dashboard-Managed Pending Items From Local Resource Model

The local resource model identified these 19 dashboard-managed pending items. They are not live-verified by repo config alone.

| Item | Status | Operator evidence required |
| --- | --- | --- |
| `STRIPE_MODE` | pending | Auth Worker variable setting by name/status only |
| `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_CHECKOUT_SUCCESS_URL` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_CHECKOUT_CANCEL_URL` | pending | Auth Worker variable setting by name/status only |
| `ENABLE_LIVE_STRIPE_CREDIT_PACKS` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_LIVE_CHECKOUT_SUCCESS_URL` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_LIVE_CHECKOUT_CANCEL_URL` | pending | Auth Worker variable setting by name/status only |
| `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID` | pending | Auth Worker variable setting by name/status only; mask value if shown |
| `STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL` | pending | Auth Worker variable setting by name/status only |
| `STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL` | pending | Auth Worker variable setting by name/status only |
| Cloudflare Images enabled for Auth | pending | Dashboard feature/binding presence |
| `bitbi-auth-activity-ingest` queue created | pending | Queue presence |
| `bitbi-ai-image-derivatives` queue created | pending | Queue presence |
| `bitbi-ai-video-jobs` queue created | pending | Queue presence |
| `bitbi-audit-archive` bucket created | pending | Bucket presence only |
| Sensitive POST WAF/rate-limit rule | pending | Rule presence/scope/status |
| Static security Transform Rules | pending | Transform/header rule presence/scope/status |
| Cloudflare RUM setting | pending | RUM setting status |

## Manual Dashboard Verification Steps

1. In Cloudflare, select the expected account/zone for `bitbi.ai`; record account/zone names only, not tokens.
2. Open Workers and Pages, then record `bitbi-auth`, `bitbi-ai`, and `bitbi-contact` deployment ids, version ids, timestamps, routes/domains, bindings, vars, and secret names only.
3. Open D1 `bitbi-auth-db`; record migration names/status through `0060_add_app_settings.sql` only. Do not query tables or paste row data.
4. Open R2 and record bucket presence for `bitbi-private-media`, `bitbi-user-images`, and `bitbi-audit-archive` only. Do not list objects or copy keys.
5. Open Queues, Durable Objects, Images, Workers AI, cron triggers, WAF/rate-limit rules, Transform Rules, RUM, alerts, domains, and certificates; record presence/status only.
6. Attach sanitized screenshots or notes to the private operator evidence store; this repo package should contain references and statuses, not raw sensitive evidence.

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
