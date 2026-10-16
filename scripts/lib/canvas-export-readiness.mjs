import assert from 'node:assert/strict';

export async function verifyCanvasAssemblyRetentionSchema(query) {
  const rows=await query("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='canvas_assembly_export_preserve'");
  assert.equal(rows.length,1,'Required Canvas assembly retention guard missing');
  const compact=value=>String(value||'').replace(/'(?:''|[^'])*'|\s+/g,token=>token.startsWith("'")?token:'').replace(/;$/,'');
  assert.equal(compact(rows[0].sql),compact(`CREATE TRIGGER canvas_assembly_export_preserve AFTER UPDATE OF asset_id ON canvas_video_processing
    WHEN NEW.asset_id=NEW.id AND json_extract(NEW.recipe_json,'$.version') IN (7,8)
    AND json_extract(NEW.recipe_json,'$.assembly.version')=1 AND json_extract(NEW.recipe_json,'$.preview') IS NULL
    BEGIN UPDATE canvas_export_versions SET state='saved',saved_at=NEW.updated_at WHERE id=NEW.id AND state='canvas'; END`),
  'Canvas assembly retention must preserve only completed supported exact/creative private deliveries');
}

// Executed against migrated native D1 in acceptance and production readback.
export async function verifyCanvasExportSchema(query) {
  await verifyCanvasAssemblyRetentionSchema(query);
  await query(`SELECT p.id,p.node_id,p.recipe_json,p.audio_timeline_json,p.seam_result_json,p.preview_base_key,p.preview_base_etag,p.preview_base_bytes,h.latest_id,h.current_id,v.state,v.retired,v.node_id
    FROM canvas_video_processing p JOIN canvas_export_versions v ON v.id=p.id
    JOIN canvas_export_heads h ON h.run_id IS p.run_id AND h.node_id IS p.node_id LIMIT 0`);
  await query('SELECT id,workspace_width,workspace_height,revision,assembly_json FROM canvas_projects LIMIT 0');
  await query('SELECT id,creative_revision FROM canvas_nodes LIMIT 0');
  await query('SELECT id,node_revision FROM canvas_runs LIMIT 0');
  await query('SELECT id,project_id,expected_revision,budget_credits,lease_token,next_attempt_at FROM canvas_agent_runs LIMIT 0');
  await query('SELECT id,run_id,step_key,allocation_credits,usage_attempt_id FROM canvas_agent_steps LIMIT 0');
  await query('SELECT run_id,request_key,action FROM canvas_agent_controls LIMIT 0');
  await query('SELECT budget_revision,repair_attempts,cause_json FROM canvas_agent_runs LIMIT 0');
  await query('SELECT step_id,run_id,plan_json,status,validation_json FROM canvas_agent_proposals LIMIT 0');
  await query('SELECT id,run_id,event_key,type,payload_json FROM canvas_agent_events LIMIT 0');
  await query('SELECT id,run_id,revision,project_revision,tariff_revision,current_cap,proposed_cap,status,decision_key FROM canvas_agent_budget_requests LIMIT 0');
  await query('SELECT step_id,project_id,charged,reserved,pending,committed FROM canvas_agent_step_costs LIMIT 0');
  await query('SELECT receipt_protocol,input_digest,provider_run_id,receipt_json FROM canvas_agent_model_operations LIMIT 0');
  const autonomyGuards=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_agent_proposal_immutable','canvas_agent_budget_request_immutable','canvas_agent_budget_decision_immutable','canvas_agent_cap_amendment','canvas_agent_event_immutable','canvas_agent_model_receipt_protocol_immutable','canvas_agent_model_identity_immutable','canvas_agent_model_receipt_immutable')");
  assert.equal(autonomyGuards.length,8,'Required Canvas proposal/budget consent guards missing');
  await query('SELECT id,source_asset_id,source_version,processing_token,result_json FROM canvas_media_inspections LIMIT 0');
  const agentGuards=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_agent_allocation','canvas_agent_allocation_immutable','canvas_agent_usage_insert','canvas_agent_usage_dispatch','canvas_agent_manual_edit','canvas_project_assembly_revision','canvas_assembly_export_preserve')");
  assert.equal(agentGuards.length,7,'Required Canvas production/assembly guards missing');
  await query('SELECT asset_id,state FROM canvas_asset_dispositions LIMIT 0');
  await query('SELECT request_id,job_id FROM canvas_preview_requests LIMIT 0');
  await query('SELECT id,user_id FROM canvas_export_reclaimable LIMIT 0');
  const rows=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_export_register','canvas_export_activate','canvas_export_identity','canvas_export_recipe_immutable','canvas_export_delete','canvas_export_deleted','canvas_export_publication')");
  assert.equal(rows.length,7,'Required Canvas export guards missing');
  const baseGuards=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_preview_base_fence','canvas_preview_base_asset_deleted','canvas_preview_base_job_deleted')");
  assert.equal(baseGuards.length,3,'Required Canvas preview base guards missing');
  const audioGuards=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name='canvas_audio_timeline_immutable'");
  assert.equal(audioGuards.length,1,'Required Canvas audio snapshot guard missing');
  const seamGuards=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_seam_result_immutable','canvas_seam_preview_activate')");
  assert.equal(seamGuards.length,2,'Required Canvas comparison guards missing');
  await query('SELECT r2_key FROM r2_cleanup_live_references LIMIT 0');
}
