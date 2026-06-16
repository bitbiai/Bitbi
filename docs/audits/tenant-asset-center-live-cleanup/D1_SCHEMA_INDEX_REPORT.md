# D1 Schema And Index Report

Generated: 2026-06-16T20:48:37.842Z

## Reference-Relevant Columns

| Table | User refs | R2/object keys | Emails | Size fields |
| --- | --- | --- | --- | --- |
| activity_search_index | actor_user_id, target_user_id | - | - | - |
| admin_ai_usage_attempts | admin_user_id | - | - | - |
| admin_audit_log | admin_user_id, target_user_id | - | - | - |
| admin_mfa_credentials | admin_user_id | - | - | - |
| admin_mfa_failed_attempts | admin_user_id | - | - | - |
| admin_mfa_recovery_codes | admin_user_id | - | - | - |
| admin_runtime_budget_switch_events | changed_by_user_id | - | changed_by_email | - |
| admin_runtime_budget_switches | updated_by_user_id | - | updated_by_email | - |
| ai_asset_manual_review_events | actor_user_id | - | actor_email | - |
| ai_asset_manual_review_items | legacy_owner_user_id, proposed_owning_user_id, assigned_to_user_id, reviewed_by_user_id, created_by_user_id | - | - | - |
| ai_daily_quota_usage | user_id | - | - | - |
| ai_folders | user_id, owning_user_id, created_by_user_id | - | - | - |
| ai_generation_log | user_id | - | - | - |
| ai_images | user_id, owning_user_id, created_by_user_id | r2_key, thumb_key, medium_key | - | size_bytes |
| ai_text_assets | user_id | r2_key, poster_r2_key | - | size_bytes, poster_size_bytes |
| ai_usage_attempts | user_id | - | - | - |
| ai_video_job_poison_messages | - | - | - | - |
| ai_video_jobs | user_id | output_r2_key, poster_r2_key | - | output_size_bytes, poster_size_bytes |
| app_settings | updated_by_user_id | - | - | - |
| billing_checkout_sessions | user_id | - | - | - |
| billing_customers | - | - | - | - |
| billing_event_actions | - | - | - | - |
| billing_member_checkout_sessions | user_id | - | - | - |
| billing_member_subscription_checkout_sessions | user_id | - | - | - |
| billing_member_subscriptions | user_id | - | - | - |
| billing_operator_cleanup_run_items | - | - | - | - |
| billing_operator_cleanup_runs | requested_by_user_id | - | - | - |
| billing_operator_item_states | archived_by_user_id, restored_by_user_id | - | - | - |
| billing_operator_purge_tombstones | purged_by_user_id | - | - | - |
| billing_provider_events | user_id | - | - | - |
| credit_ledger | created_by_user_id | - | - | - |
| data_export_archives | subject_user_id | r2_key | - | size_bytes |
| data_lifecycle_request_items | - | r2_key | - | - |
| data_lifecycle_requests | subject_user_id, requested_by_user_id, requested_by_admin_id, approved_by_admin_id, completed_by_user_id, closed_by_user_id | - | - | - |
| email_verification_tokens | user_id | - | - | - |
| entitlements | - | - | - | - |
| favorites | user_id | - | - | - |
| homepage_hero_video_derivatives | source_user_id, created_by_user_id | file_r2_key, poster_r2_key, source_r2_key | - | size_bytes, poster_size_bytes, original_size_bytes |
| homepage_hero_video_slots | source_user_id, updated_by_user_id | - | - | - |
| homepage_hero_video_uploads | user_id, created_by_user_id | r2_key | - | size_bytes |
| linked_wallets | user_id | - | - | - |
| member_ai_usage_attempts | user_id | - | - | - |
| member_credit_bucket_events | user_id | - | - | - |
| member_credit_buckets | user_id | - | - | - |
| member_credit_ledger | user_id, created_by_user_id | - | - | - |
| member_usage_events | user_id | - | - | - |
| memvid_stream_preview_backfill_requests | operator_user_id | - | - | - |
| memvid_stream_preview_events | - | - | - | - |
| memvid_stream_previews | user_id | source_r2_key | - | - |
| news_pulse_items | - | visual_object_key | - | - |
| openclaw_ingest_nonces | - | - | - | - |
| organization_memberships | user_id, created_by_user_id | - | - | - |
| organization_subscriptions | - | - | - | - |
| organizations | created_by_user_id | - | - | - |
| password_reset_tokens | user_id | - | - | - |
| plans | - | - | - | - |
| platform_budget_evidence_archives | created_by_user_id | storage_key | created_by_email | size_bytes |
| platform_budget_limit_events | changed_by_user_id | - | - | - |
| platform_budget_limits | created_by_user_id, updated_by_user_id | - | - | - |
| platform_budget_repair_actions | requested_by_user_id | - | requested_by_email | - |
| platform_budget_usage_events | actor_user_id | - | - | - |
| profile_follows | follower_user_id, followed_user_id | - | - | - |
| profiles | user_id | - | - | - |
| public_media_comments | user_id | - | - | - |
| public_media_likes | user_id | - | - | - |
| r2_cleanup_queue | - | r2_key | - | - |
| rate_limit_counters | - | - | - | - |
| sessions | user_id | - | - | - |
| siwe_challenges | user_id | - | - | - |
| tenant_asset_media_reset_action_events | actor_user_id | - | actor_email | - |
| tenant_asset_media_reset_actions | operator_user_id | - | operator_email | - |
| usage_events | user_id | - | - | - |
| user_activity_log | user_id | - | - | - |
| user_asset_storage_usage | user_id | - | - | - |
| users | - | - | email | - |

## Index Coverage Summary

| Table | Indexes | Foreign keys |
| --- | --- | --- |
| activity_search_index | idx_activity_search_source_action_created, idx_activity_search_source_actor_created, idx_activity_search_source_created, idx_activity_search_source_entity_created, idx_activity_search_source_target_created | 0 |
| admin_ai_usage_attempts | idx_admin_ai_usage_attempts_admin_created, idx_admin_ai_usage_attempts_admin_operation_idempotency, idx_admin_ai_usage_attempts_operation_status, idx_admin_ai_usage_attempts_status_expires | 1 |
| admin_audit_log | idx_admin_audit_log_created_action, idx_audit_log_created_id | 0 |
| admin_mfa_credentials | - | 0 |
| admin_mfa_failed_attempts | idx_admin_mfa_failed_attempts_locked_until | 0 |
| admin_mfa_recovery_codes | idx_admin_mfa_recovery_codes_admin_unused | 0 |
| admin_runtime_budget_switch_events | idx_admin_runtime_budget_switch_events_idempotency, idx_admin_runtime_budget_switch_events_switch_created | 1 |
| admin_runtime_budget_switches | - | 0 |
| ai_asset_manual_review_events | idx_ai_asset_manual_review_events_idempotency, idx_ai_asset_manual_review_events_item | 0 |
| ai_asset_manual_review_items | idx_ai_asset_manual_review_items_category, idx_ai_asset_manual_review_items_created_at, idx_ai_asset_manual_review_items_domain_asset, idx_ai_asset_manual_review_items_evidence_source, idx_ai_asset_manual_review_items_priority, idx_ai_asset_manual_review_items_severity, idx_ai_asset_manual_review_items_status | 0 |
| ai_daily_quota_usage | idx_ai_daily_quota_usage_user_day | 1 |
| ai_folders | idx_ai_folders_asset_owner_type, idx_ai_folders_ownership_status, idx_ai_folders_owning_organization_id, idx_ai_folders_owning_user_id, idx_ai_folders_user_id | 1 |
| ai_generation_log | idx_ai_generation_log_user_created | 1 |
| ai_images | idx_ai_images_asset_owner_type, idx_ai_images_derivatives_status_created, idx_ai_images_derivatives_version_created, idx_ai_images_folder_id, idx_ai_images_ownership_status, idx_ai_images_owning_organization_id, idx_ai_images_owning_user_id, idx_ai_images_user_created_id, idx_ai_images_user_folder_created_id, idx_ai_images_user_id, idx_ai_images_visibility_published_at | 2 |
| ai_text_assets | idx_ai_text_assets_folder_created, idx_ai_text_assets_user_created, idx_ai_text_assets_user_source, idx_ai_text_assets_visibility_published_at | 2 |
| ai_usage_attempts | idx_ai_usage_attempts_billing_reservations, idx_ai_usage_attempts_org_created, idx_ai_usage_attempts_org_feature_created, idx_ai_usage_attempts_org_idempotency, idx_ai_usage_attempts_status_expires, idx_ai_usage_attempts_user_created | 2 |
| ai_video_job_poison_messages | idx_ai_video_job_poison_created, idx_ai_video_job_poison_reason | 0 |
| ai_video_jobs | idx_ai_video_jobs_expires_at, idx_ai_video_jobs_idempotency, idx_ai_video_jobs_owner_status_created, idx_ai_video_jobs_provider_task, idx_ai_video_jobs_status_next_attempt | 1 |
| app_settings | idx_app_settings_updated_at | 0 |
| billing_checkout_sessions | idx_billing_checkout_sessions_event, idx_billing_checkout_sessions_mode_auth_scope, idx_billing_checkout_sessions_mode_org_created, idx_billing_checkout_sessions_mode_status_created, idx_billing_checkout_sessions_mode_user_created, idx_billing_checkout_sessions_org_status, idx_billing_checkout_sessions_org_user_idempotency, idx_billing_checkout_sessions_pack_created, idx_billing_checkout_sessions_payment_intent, idx_billing_checkout_sessions_provider_session | 4 |
| billing_customers | idx_billing_customers_org | 1 |
| billing_event_actions | idx_billing_event_actions_event | 1 |
| billing_member_checkout_sessions | idx_billing_member_checkout_event, idx_billing_member_checkout_provider_session, idx_billing_member_checkout_status_created, idx_billing_member_checkout_user_created, idx_billing_member_checkout_user_idempotency | 3 |
| billing_member_subscription_checkout_sessions | idx_billing_member_subscription_checkout_provider_session, idx_billing_member_subscription_checkout_subscription, idx_billing_member_subscription_checkout_user_created, idx_billing_member_subscription_checkout_user_idempotency | 2 |
| billing_member_subscriptions | idx_billing_member_subscriptions_customer, idx_billing_member_subscriptions_provider_id, idx_billing_member_subscriptions_user_status_period | 1 |
| billing_operator_cleanup_run_items | idx_billing_operator_cleanup_run_items_run, idx_billing_operator_cleanup_run_items_type_item | 1 |
| billing_operator_cleanup_runs | idx_billing_operator_cleanup_runs_status_created, idx_billing_operator_cleanup_runs_type_created, idx_billing_operator_cleanup_runs_user_idempotency | 1 |
| billing_operator_item_states | idx_billing_operator_item_states_archived, idx_billing_operator_item_states_state, idx_billing_operator_item_states_type_item | 2 |
| billing_operator_purge_tombstones | idx_billing_operator_purge_tombstones_checkout_session, idx_billing_operator_purge_tombstones_payment_intent, idx_billing_operator_purge_tombstones_provider_event, idx_billing_operator_purge_tombstones_subscription, idx_billing_operator_purge_tombstones_type_purged | 1 |
| billing_provider_events | idx_billing_provider_events_created, idx_billing_provider_events_customer_received, idx_billing_provider_events_last_processed, idx_billing_provider_events_mode_status_received, idx_billing_provider_events_org_received, idx_billing_provider_events_provider_type, idx_billing_provider_events_status_received | 3 |
| credit_ledger | idx_credit_ledger_org_created, idx_credit_ledger_org_feature_created, idx_credit_ledger_org_idempotency | 2 |
| d1_migrations | - | 0 |
| data_export_archives | idx_data_export_archives_expires_at, idx_data_export_archives_request, idx_data_export_archives_request_status, idx_data_export_archives_status_expires, idx_data_export_archives_subject_created | 2 |
| data_lifecycle_request_items | idx_data_lifecycle_items_r2, idx_data_lifecycle_items_request, idx_data_lifecycle_items_request_created_id, idx_data_lifecycle_items_resource | 1 |
| data_lifecycle_requests | idx_data_lifecycle_requests_created_id, idx_data_lifecycle_requests_expires_at, idx_data_lifecycle_requests_final_status_created, idx_data_lifecycle_requests_status_created, idx_data_lifecycle_requests_subject_created, idx_data_lifecycle_requests_type_status_created | 4 |
| email_verification_tokens | idx_email_verification_tokens_expires_at, idx_email_verification_tokens_token_hash, idx_email_verification_tokens_user_id | 1 |
| entitlements | idx_entitlements_plan_feature | 1 |
| favorites | idx_favorites_user | 1 |
| homepage_hero_video_derivatives | idx_homepage_hero_video_derivatives_idempotency, idx_homepage_hero_video_derivatives_processor_status, idx_homepage_hero_video_derivatives_slot_status, idx_homepage_hero_video_derivatives_source, idx_homepage_hero_video_derivatives_source_fingerprint | 0 |
| homepage_hero_video_slots | - | 0 |
| homepage_hero_video_uploads | idx_homepage_hero_video_uploads_user_created | 3 |
| linked_wallets | idx_linked_wallets_address_normalized, idx_linked_wallets_user_id | 1 |
| member_ai_usage_attempts | idx_member_ai_usage_attempts_billing_reservations, idx_member_ai_usage_attempts_status_expires, idx_member_ai_usage_attempts_user_created, idx_member_ai_usage_attempts_user_feature_created, idx_member_ai_usage_attempts_user_idempotency | 1 |
| member_credit_bucket_events | idx_member_credit_bucket_events_bucket_idempotency, idx_member_credit_bucket_events_user_created | 3 |
| member_credit_buckets | idx_member_credit_buckets_subscription_period, idx_member_credit_buckets_user_legacy, idx_member_credit_buckets_user_purchased, idx_member_credit_buckets_user_type | 2 |
| member_credit_ledger | idx_member_credit_ledger_user_created, idx_member_credit_ledger_user_feature_created, idx_member_credit_ledger_user_idempotency | 2 |
| member_usage_events | idx_member_usage_events_user_created, idx_member_usage_events_user_feature_created, idx_member_usage_events_user_idempotency | 2 |
| memvid_stream_preview_backfill_requests | - | 1 |
| memvid_stream_preview_events | idx_memvid_stream_preview_events_asset_created, idx_memvid_stream_preview_events_type_created | 2 |
| memvid_stream_previews | idx_memvid_stream_previews_asset_status, idx_memvid_stream_previews_status_updated, idx_memvid_stream_previews_stream_uid | 2 |
| news_pulse_items | idx_news_pulse_expires, idx_news_pulse_locale_status_published, idx_news_pulse_visual_status | 0 |
| openclaw_ingest_nonces | idx_openclaw_ingest_nonces_expires | 0 |
| organization_memberships | idx_org_memberships_creator_idempotency, idx_org_memberships_org_role, idx_org_memberships_user_status | 3 |
| organization_subscriptions | idx_org_subscriptions_org_status, idx_org_subscriptions_plan_status | 2 |
| organizations | idx_organizations_created, idx_organizations_creator_idempotency, idx_organizations_status_created | 1 |
| password_reset_tokens | idx_password_reset_tokens_expires_at, idx_password_reset_tokens_token_hash, idx_password_reset_tokens_user_id | 1 |
| plans | idx_plans_status_code | 0 |
| platform_budget_evidence_archives | idx_platform_budget_evidence_archives_created_by, idx_platform_budget_evidence_archives_idempotency, idx_platform_budget_evidence_archives_scope_created, idx_platform_budget_evidence_archives_status_expires, idx_platform_budget_evidence_archives_storage_key | 0 |
| platform_budget_limit_events | idx_platform_budget_limit_events_idempotency, idx_platform_budget_limit_events_scope_created | 0 |
| platform_budget_limits | idx_platform_budget_limits_active_scope_window, idx_platform_budget_limits_scope_status | 0 |
| platform_budget_repair_actions | idx_platform_budget_repair_actions_candidate, idx_platform_budget_repair_actions_idempotency, idx_platform_budget_repair_actions_scope_created, idx_platform_budget_repair_actions_status_created | 0 |
| platform_budget_usage_events | idx_platform_budget_usage_events_attempt_once, idx_platform_budget_usage_events_idempotency_once, idx_platform_budget_usage_events_job_once, idx_platform_budget_usage_events_operation_created, idx_platform_budget_usage_events_scope_day, idx_platform_budget_usage_events_scope_month | 0 |
| profile_follows | idx_profile_follows_followed_created, idx_profile_follows_follower_created | 2 |
| profiles | idx_profiles_avatar_recent | 1 |
| public_media_comments | idx_public_media_comments_media, idx_public_media_comments_media_created, idx_public_media_comments_user_created | 1 |
| public_media_likes | idx_public_media_likes_media, idx_public_media_likes_media_created, idx_public_media_likes_user_created | 1 |
| r2_cleanup_queue | - | 0 |
| rate_limit_counters | idx_rate_limit_counters_expires_at | 0 |
| sessions | idx_sessions_token_hash, idx_sessions_user_id | 1 |
| siwe_challenges | idx_siwe_challenges_expires_at, idx_siwe_challenges_nonce, idx_siwe_challenges_user_id_intent | 1 |
| tenant_asset_media_reset_action_events | idx_tenant_asset_media_reset_action_events_action_created_at, idx_tenant_asset_media_reset_action_events_type | 0 |
| tenant_asset_media_reset_actions | idx_tenant_asset_media_reset_actions_idempotency, idx_tenant_asset_media_reset_actions_request_hash, idx_tenant_asset_media_reset_actions_status_created_at | 0 |
| usage_events | idx_usage_events_org_feature_created, idx_usage_events_org_idempotency, idx_usage_events_user_created | 3 |
| user_activity_log | idx_user_activity_created_id, idx_user_activity_user_id | 0 |
| user_asset_storage_usage | - | 1 |
| users | idx_users_created_id, idx_users_email | 0 |
