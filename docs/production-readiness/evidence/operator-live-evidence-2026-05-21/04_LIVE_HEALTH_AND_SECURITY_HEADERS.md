# 04 - Live Health And Security Headers

Date: 2026-05-21

Operator: pending human review; public read-only live checks run by Codex after approval phrase

Live endpoint checks require explicit operator approval. This template may be filled from manual browser or approved read-only command output. Do not paste cookies, authorization headers, tokens, or private data.

Approval status: `I_APPROVE_READ_ONLY_LIVE_HEALTH_HEADERS_CHECKS` was present in the sprint instruction. Codex ran only public unauthenticated read-only checks against `https://bitbi.ai` and `https://contact.bitbi.ai`.

Local skipped-mode checks:

- `npm run check:live-health` passed in skipped-safe mode because no live URL was configured.
- `npm run check:live-security-headers` passed in skipped-safe mode because no public base URL was configured.

Approved public live command results:

- `npm run check:live-health -- --base-url https://bitbi.ai --contact-base-url https://contact.bitbi.ai --require-live`: Auth health returned `200`; Contact health returned `200`.
- `npm run check:live-security-headers -- --base-url https://bitbi.ai --require-live`: Static site returned `200`; `x-content-type-options` present; `referrer-policy` present; `permissions-policy` and `content-security-policy` still require manual dashboard/header verification.

Final master closure refresh:

- Approval phrase remained present in the final sprint instruction.
- The same public unauthenticated read-only commands were rerun successfully.
- No admin-authenticated live checks, cookies, Authorization headers, response bodies, Stripe calls, Cloudflare API calls, deploys, migrations, or resource mutations were used.

Mega Packet refresh:

- The current Mega Packet prompt did not provide a separate public live-check approval outside rule text, so Codex did not rerun live HTTP checks in this sprint.
- Previously collected public read-only evidence remains recorded below: Auth health `200`, Contact health `200`, static site `200`, `x-content-type-options` present, and `referrer-policy` present.
- CSP, permissions policy, frame policy, cache-control, CORS, HSTS, content-type, Admin indexing behavior, static asset caching, and health cache behavior remain pending manual/header review.

## Public Site

| Check | Evidence reference | Result |
| --- | --- | --- |
| `https://bitbi.ai/` loads | Approved live header check returned static status `200` | partial live verified |
| Static asset load has no obvious 404/500 errors | Not covered by header script beyond page status | pending manual/browser evidence |
| Cache-control reviewed | Not covered by current script output | pending manual/header evidence |
| Security headers reviewed | Approved live header check covered required/present headers and manual-only headers | partial live verified |
| No sensitive data in public response | Script did not print response body; manual browser review pending | pending manual evidence |

## Worker Health

| Check | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth health endpoint | sanitized health/status only | Approved live health check returned `200` at `https://bitbi.ai` | live read-only pass |
| Contact health endpoint | sanitized health/status only | Approved live health check returned `200` at `https://contact.bitbi.ai` | live read-only pass |
| Unknown API route | safe failure shape, no stack/secrets | Requires approved read-only live check or manual evidence | pending operator approval |
| Internal AI routes | not publicly exposed | Requires manual/repo evidence; no live admin/API probing by Codex | pending |

## Header Checklist

| Header / policy | Evidence reference | Result |
| --- | --- | --- |
| `x-content-type-options: nosniff` where applicable | Approved live header check reported header present | live read-only pass |
| Content Security Policy reviewed | Approved script classified as `MANUAL`; dashboard/header verification remains required | pending manual verification |
| Frame policy reviewed | Not covered by current script output | pending manual/header evidence |
| Referrer policy reviewed | Approved live header check reported header present | live read-only pass |
| Permissions policy reviewed | Approved script classified as `MANUAL`; dashboard/header verification remains required | pending manual verification |
| CORS/origin behavior reviewed for APIs | Not covered by current public health/header scripts | pending manual/API evidence |

## Security Header Policy Review Matrix

| Header / policy | Observed status | Evidence source | Recommendation | Risk if unresolved | Operator follow-up |
| --- | --- | --- | --- | --- | --- |
| `x-content-type-options` | observed present | previous approved public read-only header check | Keep `nosniff` on static and relevant Worker responses. | low | Attach sanitized header output or screenshot. |
| `referrer-policy` | observed present | previous approved public read-only header check | Keep strict enough policy for public/member routes and verify legal/account flows. | low | Attach sanitized header output or screenshot. |
| `content-security-policy` | pending | script classified manual / dashboard review required | Verify exact CSP source list, `frame-ancestors`, script/style/image/connect sources, and report-only vs enforce mode. | medium/high | Attach sanitized header output and Transform Rule status. |
| `permissions-policy` | pending | script classified manual / dashboard review required | Verify least-privilege policy for camera, microphone, geolocation, payment, interest-cohort, and similar browser features. | medium | Attach sanitized header output and Transform Rule status. |
| `X-Frame-Options` / CSP `frame-ancestors` | pending | not covered by current script output | Verify clickjacking protection through either `X-Frame-Options` or CSP `frame-ancestors`. | medium | Attach sanitized response headers. |
| `cache-control` for HTML/API | pending | not covered by current script output | Verify HTML/auth/account/admin/API health responses are not over-cached and sensitive API responses use safe cache policy. | medium | Attach sanitized response headers by route class. |
| CORS on API routes | pending | not covered by public health/header scripts | Verify allowed origins/methods/headers, credential behavior, preflight behavior, and safe failure for unknown origins. | high | Use manual/API evidence without cookies or Authorization headers. |
| HSTS | pending | not covered by current script output | Verify `Strict-Transport-Security` on HTTPS domains if intended by dashboard policy. | medium | Attach sanitized response header output. |
| `content-type` | pending | not covered by current script output | Verify HTML routes return `text/html`, JSON health/API routes return JSON content type, and no sniffing ambiguity. | low/medium | Attach sanitized response headers only. |
| Admin robots/noindex behavior | pending | manual/browser/repo review required | Verify admin pages are not indexed if the current product policy requires that. | medium | Attach sanitized page/header/robots evidence. |
| Static asset caching | pending | manual/header review required | Verify versioned assets can be cached while HTML remains safely refreshed. | medium | Attach sanitized asset response headers. |
| Health endpoint cache behavior | pending | manual/header review required | Verify health endpoints expose no sensitive data and are not cached in a way that hides outages. | medium | Attach sanitized response headers/body summary only. |

Security-header readiness remains incomplete until the pending rows above are verified with sanitized evidence.

## Approved Command Placeholder

Only after explicit approval:

```text
npm run check:live-health -- --base-url https://bitbi.ai --contact-base-url https://contact.bitbi.ai --require-live
npm run check:live-security-headers -- --base-url https://bitbi.ai --require-live
npm run readiness:live-readonly -- --static-url <public-url> --auth-worker-url <auth-origin> --contact-worker-url <contact-origin>
```

Approval record:

- Approver:
- Time: 2026-05-21 local sprint
- Command group: public unauthenticated live health/security headers
- Read-only: yes
- Output redacted: yes; no cookies, authorization headers, response bodies, or secrets recorded

Required approval phrase before Codex may run the public read-only commands:

```text
I_APPROVE_READ_ONLY_LIVE_HEALTH_HEADERS_CHECKS
```
