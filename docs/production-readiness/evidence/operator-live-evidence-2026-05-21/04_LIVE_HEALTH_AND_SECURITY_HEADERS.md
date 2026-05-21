# 04 - Live Health And Security Headers

Date:

Operator:

Live endpoint checks require explicit operator approval. This template may be filled from manual browser or approved read-only command output. Do not paste cookies, authorization headers, tokens, or private data.

## Public Site

| Check | Evidence reference | Result |
| --- | --- | --- |
| `https://bitbi.ai/` loads |  | pending |
| Static asset load has no obvious 404/500 errors |  | pending |
| Cache-control reviewed |  | pending |
| Security headers reviewed |  | pending |
| No sensitive data in public response |  | pending |

## Worker Health

| Check | Expected | Evidence reference | Result |
| --- | --- | --- | --- |
| Auth health endpoint | sanitized health/status only |  | pending |
| Contact health endpoint | sanitized health/status only |  | pending |
| Unknown API route | safe failure shape, no stack/secrets |  | pending |
| Internal AI routes | not publicly exposed |  | pending |

## Header Checklist

| Header / policy | Evidence reference | Result |
| --- | --- | --- |
| `x-content-type-options: nosniff` where applicable |  | pending |
| Content Security Policy reviewed |  | pending |
| Frame policy reviewed |  | pending |
| Referrer policy reviewed |  | pending |
| Permissions policy reviewed |  | pending |
| CORS/origin behavior reviewed for APIs |  | pending |

## Approved Command Placeholder

Only after explicit approval:

```text
npm run readiness:live-readonly -- --static-url <public-url> --auth-worker-url <auth-origin> --contact-worker-url <contact-origin>
```

Approval record:

- Approver:
- Time:
- Command group:
- Read-only: yes/no
- Output redacted: yes/no

