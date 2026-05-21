# 09 - Redaction Checklist

Date: 2026-05-21

Operator: pending human review; automated local checks filled by Codex

Use this before committing, sharing, or attaching any evidence.

## Must Not Be Committed

Checked items in this section mean the Codex-edited evidence content was reviewed and the forbidden data type was absent.

- [x] Secret values.
- [x] Cookies.
- [x] Session tokens.
- [x] Authorization headers.
- [x] Stripe signatures.
- [x] Webhook secrets.
- [x] Payment method IDs.
- [x] Raw provider payloads.
- [x] Raw idempotency keys.
- [x] Raw request hashes/fingerprints.
- [x] Raw R2/private object keys.
- [x] Raw admin cookies.
- [x] Raw customer personal data.
- [x] Private media URLs or signed URLs.
- [x] Unredacted emails unless strictly necessary and operator-approved.
- [x] Screenshots showing secrets, tokens, cookies, dashboard secrets, or private media.

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

- [x] Evidence was reviewed for raw secrets by local automated scan (`npm run check:secrets`) before final gate.
- [x] Evidence was reviewed for raw identifiers that are not needed in the Codex-edited template content.
- [x] Evidence was reviewed for readiness overclaims in the Codex-edited template content.
- [x] Evidence was reviewed for customer/personal data in the Codex-edited template content.
- [x] Evidence was reviewed for private object keys and signed URLs in the Codex-edited template content.
- [x] Evidence index remains `ok:true` with `unsafeCount:0` after evidence-template changes.

## Sprint Redaction Results

- Approved public unauthenticated read-only live health/header commands were run. No admin-authenticated live checks, Cloudflare API calls, Stripe API calls, deploys, migrations, provider calls, tenant mutations, R2 listing, or resource mutations were run.
- No admin cookies, authorization headers, Stripe signatures, webhook secrets, payment methods, raw provider payloads, raw idempotency keys, private object keys, private media URLs, or raw personal data were added by Codex.
- `npm run check:secrets` passed after evidence-template edits.
- `npm run evidence:index` was `ok:true` with `unsafeCount:0` after evidence-template edits.
- Human redaction reviewer/date: pending.
