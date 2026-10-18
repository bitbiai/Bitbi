import assert from 'node:assert/strict';
import { runCanvasTests } from './canvas.mjs';

// Closed continuation of f58a9e5d's native Canvas failure. This is an exact
// callback inventory, not an arbitrary skip/filter option for native acceptance.
export const canvasPolicyPrefix = Object.freeze([
  'canvas_natural_chat_populated_migration_preserves_original_authority',
  'canvas_conversation_populated_migration_preserves_historical_identity_without_transcript',
  'canvas_assembly_retention_populated_migration',
  'canvas_export_release_schema_queries',
]);
export const canvasPolicyTailInventory = Object.freeze([
  'image25_native_owned_reference_boundary_and_unverified_tariff_blocks_dispatch',
  'canvas_native_MFA_and_ownership_deny_before_provider',
  'private_media_admin_read_no_inference_and_not_ready_switch_denied',
  'canvas_native_budget_switch_and_missing_cap_deny_before_inference',
  'canvas_native_text_platform_budget_without_member_credit_and_exact_replay',
  'canvas_native_image_requires_selected_member_org_and_credits',
  'canvas_native_paid_image_checkpoint_retry_no_regeneration_and_owner_asset_reload',
  'canvas_native_saved_image_is_reusable_only_by_owner_and_org_switch_conflicts',
  ...['h3','h3-overrun','h3-overrun-failure','h3-last-frame','h3-stale','h3-deleted','h3-foreign','first','success','last-frame','foreign','changed','blocked','blocked-admin','provider-interrupted','receipt-write'].map(name=>'canvas_native_video_'+name),
  ...['grok-imagine-video','grok-imagine-video-1.5-preview'].flatMap(model=>['edit','extend'].map(operation=>`canvas_native_${model}_${operation}_references`)),
  ...['success','failure','unknown','grok-base','grok-preview','h3'].map(name=>'admin_native_pixverse_'+name),
  'canvas_native_private_full_video_and_posters',
  'private_media_native_release_smoke_same_endpoints_both_backends',
  'private_media_native_immediate_fenced_dispatch_and_backend_assignment',
  'canvas_native_grok_reasoning_reservation_saved_output_and_replay',
  'image25_native_completed_uri_preserves_alpha_format_model_and_single_paid_save_after_reload',
  ...['success','released','body','redirect'].map(name=>'image25_native_generate_lab_queue_https_'+name),
  'assets_native_type_before_limit_owner_scope_and_cursor_isolation',
  ...['user','admin'].flatMap(role=>['instrumental','automatic','manual','generated','instrumental-manual','instrumental-generated','manual-generated','provider-failed'].map(name=>`canvas_native_music_${role}_${name}`)),
  ...['user','admin'].flatMap(role=>['prompt','plan-opus','plan-large','explicit-duration','selected-org','missing-usage','invalid-usage','overrun','failed','custom-revision','durable'].map(name=>`elevenlabs_native_${role}_${name}`)),
  'canvas_native_contributors_frozen_branches_bounded_owner_project',
  'canvas_native_seedance_edit_auto_original_reference_duration_settlement_and_replay',
  'canvas_native_omni_independent_video_edit_accepted_price_owned_output_and_replay',
  'canvas_native_completion_metadata_attach_queue_extend_and_music_admission',
  'canvas_assembly_completed_delivery_retention',
  'canvas_smooth_persistence_preview_cache_policy_and_private_completion',
  'canvas_audio_imported_identity_independent_settings_and_snapshot_admission',
  'canvas_audio_real_imported_video_and_image_inputs_type_replacement',
  'canvas_workspace_transition_persistence_validation_snapshot_and_processor_fencing',
  ...['late','evaluate','lease','cancel','manual','newer','failed','rejected','ambiguous','callback-guards','normalization-recovery','bounded-review','legacy','policy-legacy','policy-late'].map(name=>'canvas_durable_model_operation_'+name.replaceAll('-','_')),
  ...['ledger','accept','decline','stale','proposal','stopped','missing-plan','summary','budget-stop','lost-lease','late-proposal'].map(name=>'canvas_agent_autonomy_'+name.replaceAll('-','_')),
  ...['canvas-agent-preflight','canvas-assembly','canvas-inspection','canvas-agent-dispatch','canvas-agent-capabilities','canvas-agent-late-completion','canvas-agent-unknown-provider'].map(name=>'canvas_native_'+name.replaceAll('-','_')),
  'canvas_agent_native_atomic_budget_authority_revocation_and_manual_edit_fencing',
  'canvas_agent_native_manual_generation_takeover_excludes_invalid_requests_and_pending_completed_replays',
  'canvas_agent_native_duration_clarification_explicit_delegation_historical_replay_and_takeover',
  ...['briefing','isolation','recovery','unknown','revocation','concurrency','status-pending','paused-cap'].map(name=>'canvas_conversation_native_'+name),
  ...['queued-observation','snail','prepare','rejected','rejected-tail','malformed','invalid-tail','lost-acceptance','ack-error','normalization','storage','completed-tail','failed-projection','expired-projection','historical','stale-policy','isolation'].map(name=>'canvas_conversation_recovery_native_'+name),
  ...['immediate','delegation','waiting','unknown-waiting','cancel-waiting','stale-project','stale-brief','stale-price','consent-isolation','concurrent-approval','natural-start','button-chat-race','emergency','saved-brief','clear-intent','quote-evaluation'].map(name=>'canvas_natural_chat_native_'+name),
  ...['assembly','node-settings','regenerate','consent','foreign-target','stale-target','production-controls','assembly-extended','budget-controls'].map(name=>'canvas_conversational_actions_native_'+name),
  ...['late-stop','confirmation-replay','claim-race','dependent-failure','immediate-scope','immediate-duration-current'].map(name=>'canvas_conversational_action_recovery_native_'+name),
]);

export async function runCanvasPolicyTailTests(f) {
  const inventory = [...canvasPolicyPrefix, ...canvasPolicyTailInventory];
  let position = 0;
  const scoped = Object.create(f);
  scoped.test = async (name, operation) => {
    assert.equal(name, inventory[position], 'Canvas continuation callback order or membership changed');
    const retained = position++ < canvasPolicyPrefix.length;
    if (!retained) await f.test(name, operation);
  };
  // Seed data and migrations outside callbacks still initialize fresh D1. The
  // retained callbacks are never executed or recorded as fresh native passes.
  await runCanvasTests(scoped);
  assert.equal(position, inventory.length, 'Canvas continuation omitted required callbacks');
}
