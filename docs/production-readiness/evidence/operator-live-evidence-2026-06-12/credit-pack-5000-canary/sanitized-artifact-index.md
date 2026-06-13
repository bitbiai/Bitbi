# Sanitized Artifact Index

Generated: 2026-06-13

This index covers the committed evidence files for the 5000-credit-pack repair.
It intentionally excludes raw Stripe payloads, webhook signatures, card data,
cookies, bearer tokens, full receipt URLs, checkout URLs, portal session URLs,
private keys, unredacted secrets, screenshots, RTF files, ZIP files, private
PDFs, and private customer data.

Committed sanitized files:

- `SUMMARY.md`
- `live-billing-status.json`
- `billing-events-summary.json`
- `billing-events-summary.csv`
- `billing-reconciliation-summary.json`
- `billing-reconciliation-summary.csv`
- `billing-reviews-summary.json`
- `sanitized-artifact-index.md`

Excluded generated or superseded artifacts:

- `CREDIT_PACK_5000_FAILURE_INCIDENT.md`; safe facts are folded into `SUMMARY.md`
- `BITBI_PAY_ADMIN_REPAIR_REPORT.md`; safe facts are folded into the committed summaries
- `bitbi-pay-admin-repair-report.json`; safe facts are folded into the committed summaries
- `BITBI_PAY_ADMIN_REPAIR_REPORT.pdf`
- `monthly-accounting-packet.pdf`
- `bitbi-payment-evidence-packet.zip`

The excluded artifacts are not part of the committed repo evidence package.
