# R2 Inventory Report

Generated: 2026-06-16T19:02:46.369Z

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

Full object enumeration through local credentials is **not available**.

Credential presence check (values never printed): `{"CLOUDFLARE_ACCOUNT_ID":false,"CF_ACCOUNT_ID":false,"R2_ACCOUNT_ID":false,"R2_ACCESS_KEY_ID":false,"R2_SECRET_ACCESS_KEY":false,"AWS_ACCESS_KEY_ID":false,"AWS_SECRET_ACCESS_KEY":false,"CLOUDFLARE_API_TOKEN":false}`

Because the local environment has no R2 S3/API credentials and Wrangler exposes no object-list command, this run inventories D1-referenced keys plus bounded existence checks only. Destructive cleanup is blocked until full bucket listing evidence or an authenticated Admin R2 export is available.

## D1-Referenced R2 Categories

Unique D1-referenced R2 objects: **453**

| Category | References |
| --- | --- |
| news_pulse_asset | 106 |
| protected_homepage_hero_asset_or_derivative | 123 |
| protected_user_avatar | 3 |
| protected_user_derivative | 80 |
| protected_user_poster | 60 |
| protected_user_source_asset | 211 |

## Bounded R2 Existence Check

- Checked: 60
- Missing among checked: 0
- Unchecked remaining due to limit: 393
