import assert from 'node:assert/strict';

// Executed against migrated native D1 in acceptance and production readback.
export async function verifyCanvasExportSchema(query) {
  await query(`SELECT p.id,p.recipe_json,h.latest_id,h.current_id,v.state,v.retired
    FROM canvas_video_processing p JOIN canvas_export_versions v ON v.id=p.id
    JOIN canvas_export_heads h ON h.run_id=p.run_id LIMIT 0`);
  await query('SELECT asset_id,state FROM canvas_asset_dispositions LIMIT 0');
  await query('SELECT id,user_id FROM canvas_export_reclaimable LIMIT 0');
  const rows=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('canvas_export_register','canvas_export_activate','canvas_export_identity','canvas_export_recipe_immutable','canvas_export_delete','canvas_export_deleted','canvas_export_publication')");
  assert.equal(rows.length,7,'Required Canvas export guards missing');
}
