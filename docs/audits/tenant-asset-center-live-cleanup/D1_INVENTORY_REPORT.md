# D1 Inventory Report

Generated: 2026-06-17T13:31:34.822Z

## Scope

- Remote D1 database: `bitbi-auth-db`
- Latest auth migration in release contract: `0066_add_operator_billing_cleanup.sql`
- Mutation mode: dry-run inventory only
- Exact prior test emails checked: `zi***@bk.ru`, `sa***@kiandex.com`

## Users / Profiles

| User | Email | Role | Status | Display | Avatar |
| --- | --- | --- | --- | --- | --- |
| b4e6060d-b...6696a1 | bi***@bitbi.ai | admin | active | Satoshi | yes |
| 231cc7ef-8...2509e1 | de***@deleted.bitbi.invalid | user | deleted | - | no |
| 48dfde96-3...a8fd70 | de***@deleted.bitbi.invalid | user | deleted | - | no |
| dc357302-e...5c7a92 | de***@deleted.bitbi.invalid | user | deleted | - | no |
| 8db941b3-7...356fc6 | st***@gmail.com | user | active | Mr. Hans Wurst | yes |
| 8addc556-c...4a2a7e | st***@van-ark.com | user | active | BunnMaster | yes |

Active/non-deleted protected accounts found: **3**.
Deleted/anonymized user rows retained in D1: **3**.
Exact prior test email rows currently present: **0**.

## Row Counts

Tables discovered: **76**.

| Table | Rows |
| --- | --- |
| memvid_stream_preview_events | 1781 |
| user_activity_log | 1185 |
| activity_search_index | 959 |
| ai_asset_manual_review_events | 286 |
| ai_asset_manual_review_items | 279 |
| member_credit_ledger | 264 |
| admin_audit_log | 213 |
| ai_generation_log | 182 |
| member_usage_events | 169 |
| member_credit_bucket_events | 119 |
| member_ai_usage_attempts | 118 |
| news_pulse_items | 108 |
| billing_operator_cleanup_run_items | 89 |
| billing_operator_item_states | 89 |
| memvid_stream_previews | 79 |
| sessions | 77 |
| ai_usage_attempts | 72 |
| credit_ledger | 72 |
| usage_events | 70 |
| d1_migrations | 67 |
| ai_text_assets | 61 |
| ai_video_jobs | 54 |
| billing_provider_events | 47 |
| ai_images | 40 |
| homepage_hero_video_derivatives | 40 |

Raw schema, row counts, and user/profile rows are stored only under `.local/operator-evidence/tenant-asset-live-cleanup-20260617T133134Z`.
