# Legacy Classification Report

Generated: 2026-06-16T20:54:54.217Z

Classification is conservative. Legacy alone does not mean delete; unassignable proof is required.

## D1-Referenced Object Classification

| Classification | Reference count |
| --- | --- |
| news_pulse_asset | 106 |
| protected_homepage_hero_asset_or_derivative | 123 |
| protected_user_avatar | 3 |
| protected_user_derivative | 80 |
| protected_user_poster | 60 |
| protected_user_source_asset | 211 |

## Full R2 Unreferenced Object Classification

| Classification | Object count |
| --- | --- |
| audit_or_legal_retention_keep | 7 |
| news_pulse_asset | 64 |
| unknown_blocker_keep | 10 |

## Current Safety Decision

Execution remains blocked because this task is a read-only full-inventory pass. D1-referenced protected data is kept. Unknown, audit/export, public-bucket, and protected-owner objects are retained as blockers/keeps, not deleted.
