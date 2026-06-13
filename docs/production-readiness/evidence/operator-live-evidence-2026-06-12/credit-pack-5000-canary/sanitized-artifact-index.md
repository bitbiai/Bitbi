# Sanitized Artifact Index

Generated: 2026-06-13T08:51:56Z

This index was created by BITBI Pay Admin. It intentionally excludes raw Stripe payloads,
webhook signatures, card data, cookies, bearer tokens, checkout URLs, portal session URLs,
private keys, and unredacted secrets.

- `SUMMARY.md`
- `live-billing-status.json`
- `billing-events-summary.json`
- `billing-reviews-summary.json`
- `billing-reconciliation-summary.json`
- `billing-events-summary.csv`
- `billing-reconciliation-summary.csv`

Opaque binary exports such as ZIP/PDF files are intentionally omitted from the
repo evidence package so deploy checks can inspect the committed evidence as
plain text.
