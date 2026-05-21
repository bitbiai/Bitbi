# 04 - Live Health And Security Headers

Date: 2026-05-21

Operator: pending human review; live checks not approved in this sprint

Live endpoint checks require explicit operator approval. This template may be filled from manual browser or approved read-only command output. Do not paste cookies, authorization headers, tokens, or private data.

Approval status: `I_APPROVE_READ_ONLY_LIVE_HEALTH_HEADERS_CHECKS` was not provided as an explicit approval for execution. No public live HTTP checks were run.

Local skipped-mode checks:

- `npm run check:live-health` passed in skipped-safe mode because no live URL was configured.
- `npm run check:live-security-headers` passed in skipped-safe mode because no public base URL was configured.

## Public Site

| Check | Evidence reference | Result |
| --- | --- | --- |
| `https://bitbi.ai/` loads | Requires approved read-only live check or manual browser evidence | pending operator approval |
| Static asset load has no obvious 404/500 errors | Requires approved read-only live check or manual browser evidence | pending operator approval |
| Cache-control reviewed | Requires approved read-only live check or manual browser evidence | pending operator approval |
| Security headers reviewed | Requires approved read-only live check or manual browser evidence | pending operator approval |
| No sensitive data in public response | Requires approved read-only live check or manual browser evidence | pending operator approval |

## Worker Health

| Check | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth health endpoint | sanitized health/status only | Requires approved read-only live check or manual evidence | pending operator approval |
| Contact health endpoint | sanitized health/status only | Requires approved read-only live check or manual evidence | pending operator approval |
| Unknown API route | safe failure shape, no stack/secrets | Requires approved read-only live check or manual evidence | pending operator approval |
| Internal AI routes | not publicly exposed | Requires manual/repo evidence; no live admin/API probing by Codex | pending |

## Header Checklist

| Header / policy | Evidence reference | Result |
| --- | --- | --- |
| `x-content-type-options: nosniff` where applicable | Requires approved read-only live check or manual evidence | pending operator approval |
| Content Security Policy reviewed | Requires approved read-only live check or manual evidence | pending operator approval |
| Frame policy reviewed | Requires approved read-only live check or manual evidence | pending operator approval |
| Referrer policy reviewed | Requires approved read-only live check or manual evidence | pending operator approval |
| Permissions policy reviewed | Requires approved read-only live check or manual evidence | pending operator approval |
| CORS/origin behavior reviewed for APIs | Requires approved read-only live check or manual evidence | pending operator approval |

## Approved Command Placeholder

Only after explicit approval:

```text
npm run check:live-health -- --base-url https://bitbi.ai --contact-base-url https://contact.bitbi.ai --require-live
npm run check:live-security-headers -- --base-url https://bitbi.ai --require-live
npm run readiness:live-readonly -- --static-url <public-url> --auth-worker-url <auth-origin> --contact-worker-url <contact-origin>
```

Approval record:

- Approver:
- Time:
- Command group:
- Read-only: yes/no
- Output redacted: yes/no

Required approval phrase before Codex may run the public read-only commands:

```text
I_APPROVE_READ_ONLY_LIVE_HEALTH_HEADERS_CHECKS
```
