# 2026-05-19 Post-Cleanup Tenant Asset Rebaseline Packet

Generated: 2026-05-19T19:12:09Z

Repo commit at packet creation: `1492404194eb9817e28588e6cc9644810fe49c82`

Status: `post_cleanup_evidence_pending`

This packet exists because the operator manually deleted most old images and videos. Pre-cleanup evidence counts are retained historically but must not be used as current Backfill, Access-Switch, Reset, or tenant-isolation evidence.

## What Was Collected By Codex

- Local repo evidence inventory and current-state docs were updated.
- No live authenticated endpoint was called.
- No production D1/R2/Queue data was read or mutated.
- No live R2 objects were listed, moved, copied, rewritten, or deleted.
- No ownership backfill, runtime access switch, or confirmed reset was executed.

## Pending Live Read-Only Evidence Commands

Use an operator-managed admin cookie file or equivalent secure local header injection. Do not print or commit the cookie/header.

```bash
export BITBI_BASE_URL="https://bitbi.ai"
export BITBI_ADMIN_COOKIE_FILE="/secure/local/path/admin-cookie.txt"
```

Tenant domain state:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/domains/evidence"
```

Ownership Backfill dry-run and evidence:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/ownership-backfill/dry-run?limit=100&includeDetails=false"

curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/ownership-backfill/evidence?format=markdown&limit=100"
```

Access-Switch status and shadow diagnostics:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/access-switch/status"

curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/access-switch/shadow-diagnostics?limit=100"
```

Legacy Media Reset status and evidence:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/legacy-media-reset/status"

curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/legacy-media-reset/evidence?format=markdown&limit=100"
```

Manual-review queue/status evidence:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/folders-images/manual-review/evidence?format=json"

curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/folders-images/manual-review/items?limit=100"
```

Combined tenant isolation evidence:

```bash
curl --fail --silent --show-error --cookie "$BITBI_ADMIN_COOKIE_FILE" \
  "$BITBI_BASE_URL/api/admin/tenant-assets/tenant-isolation/evidence?format=markdown&limit=100"
```

## Acceptance Requirements

- Evidence must be generated after the manual media cleanup.
- Evidence must state `dryRun: true` or read-only status where applicable.
- Evidence must not include raw private R2 keys, cookies, auth headers, bearer tokens, raw idempotency keys, raw request hashes, signed URLs, provider payloads, Stripe values, Cloudflare tokens, or secrets.
- Backfill candidates must be separated from blocked/manual-review/public/deferred candidates.
- Access-Switch evidence must include shadow diagnostics before any enforced-mode planning.
- Reset evidence must keep confirmed execution blocked unless a later approved phase enables the gate.
- Tenant isolation remains unclaimed.

## Local-Only Supporting Commands

These commands use repo files/fixtures only and are not live evidence:

```bash
npm run dry-run:tenant-assets
npm run dry-run:tenant-assets:images
npm run evidence:index
npm run evidence:index:markdown
```
