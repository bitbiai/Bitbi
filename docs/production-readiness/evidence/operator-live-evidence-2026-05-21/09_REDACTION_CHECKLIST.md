# 09 - Redaction Checklist

Date:

Operator:

Use this before committing, sharing, or attaching any evidence.

## Must Not Be Committed

- [ ] Secret values.
- [ ] Cookies.
- [ ] Session tokens.
- [ ] Authorization headers.
- [ ] Stripe signatures.
- [ ] Webhook secrets.
- [ ] Payment method IDs.
- [ ] Raw provider payloads.
- [ ] Raw idempotency keys.
- [ ] Raw request hashes/fingerprints.
- [ ] Raw R2/private object keys.
- [ ] Raw admin cookies.
- [ ] Raw customer personal data.
- [ ] Private media URLs or signed URLs.
- [ ] Unredacted emails unless strictly necessary and operator-approved.
- [ ] Screenshots showing secrets, tokens, cookies, dashboard secrets, or private media.

## Allowed Evidence Shape

- Safe resource names.
- Commit SHAs and deploy IDs when not secret.
- Migration names/status.
- Bounded counts.
- Redacted screenshots.
- Safe suffixes or masked IDs when needed.
- Operator name/date/time.
- Links or references to private evidence storage.

## Final Review

- [ ] Evidence was reviewed for raw secrets.
- [ ] Evidence was reviewed for raw identifiers that are not needed.
- [ ] Evidence was reviewed for readiness overclaims.
- [ ] Evidence was reviewed for customer/personal data.
- [ ] Evidence was reviewed for private object keys and signed URLs.
- [ ] Evidence index remains `ok:true` with `unsafeCount:0` after any committed evidence-template changes.

