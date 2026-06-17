# R2 Inventory Report

Generated: 2026-06-17T03:43:20.319Z

## Repo Bindings

| Binding | Bucket | Remote |
| --- | --- | --- |
| PRIVATE_MEDIA | bitbi-private-media | yes |
| USER_IMAGES | bitbi-user-images | yes |
| AUDIT_ARCHIVE | bitbi-audit-archive | yes |

## Live Buckets Visible To Wrangler

| Bucket | Repo status |
| --- | --- |
| bitbi-audit-archive | repo-bound |
| bitbi-private-media | repo-bound |
| bitbi-public-media | dashboard-visible / not bound |
| bitbi-user-images | repo-bound |

`bitbi-public-media` is visible in the Cloudflare account when Wrangler lists buckets, but it is not declared as an Auth Worker R2 binding. It was not added by this audit.

## Full Bucket Listing Status

Full object enumeration through local S3-compatible R2 credentials is **available**.

Credential presence check (values never printed): `{"CLOUDFLARE_ACCOUNT_ID":false,"CF_ACCOUNT_ID":false,"R2_ACCOUNT_ID":true,"R2_ACCESS_KEY_ID":true,"R2_SECRET_ACCESS_KEY":true,"AWS_ACCESS_KEY_ID":false,"AWS_SECRET_ACCESS_KEY":false,"CLOUDFLARE_API_TOKEN":false}`

Requested buckets: `bitbi-user-images`, `bitbi-private-media`, `bitbi-audit-archive`, `bitbi-public-media`

| Bucket | Status | Objects | Bytes | Pages | HEAD attempted | HEAD failed | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bitbi-user-images | listed | 516 | 980.8 MB | 1 | 516 | 0 | - |
| bitbi-private-media | listed | 7 | 132.5 KB | 1 | 7 | 0 | - |
| bitbi-audit-archive | listed | 7 | 12.2 KB | 1 | 7 | 0 | - |
| bitbi-public-media | listed | 6 | 0 B | 1 | 6 | 0 | - |

Raw object manifests and HEAD metadata are stored only in `.local/operator-evidence/tenant-asset-live-cleanup-20260617T034320Z/r2-full-inventory`.

Destructive cleanup remains disabled in this package. Full inventory is used for proof and later-candidate classification only.

## D1-Referenced R2 Categories

Unique D1-referenced R2 objects: **455**

| Category | References |
| --- | --- |
| news_pulse_asset | 108 |
| protected_homepage_hero_asset_or_derivative | 123 |
| protected_user_avatar | 3 |
| protected_user_derivative | 80 |
| protected_user_poster | 60 |
| protected_user_source_asset | 211 |

## Bounded R2 Existence Check

- Checked: 0
- Missing among checked: 0
- Unchecked remaining due to limit: 0

## Full Inventory Relationship Summary

- Full R2 inventory objects listed: 536
- D1 references found in full R2 inventory: 455
- D1 references missing from full R2 inventory: 0
- D1 references not checked because a bucket did not list successfully: 0
- Full R2 objects without a D1 reference: 81
