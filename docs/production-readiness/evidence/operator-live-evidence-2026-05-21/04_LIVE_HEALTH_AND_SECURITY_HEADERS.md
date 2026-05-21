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
