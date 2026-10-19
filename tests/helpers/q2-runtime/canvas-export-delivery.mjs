import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runCanvasTests} from './canvas.mjs';

export const canvasExportDeliveryInventory=Object.freeze([
  'private_media_admin_read_no_inference_and_not_ready_switch_denied',
  'canvas_native_private_full_video_and_posters',
  'private_media_native_release_smoke_same_endpoints_both_backends',
  'private_media_native_immediate_fenced_dispatch_and_backend_assignment',
  'canvas_assembly_completed_delivery_retention',
  'canvas_smooth_persistence_preview_cache_policy_and_private_completion',
  'canvas_audio_imported_identity_independent_settings_and_snapshot_admission',
  'canvas_audio_real_imported_video_and_image_inputs_type_replacement',
  'canvas_workspace_transition_persistence_validation_snapshot_and_processor_fencing',
  'canvas_native_canvas_agent_preflight',
  'canvas_native_canvas_agent_native_duration',
]);
// Execute the actual callbacks, migrations and private HTTPS fixture in the
// ordinary Canvas suite. Discovery is checked before accepting this selection;
// the full suite remains the default and never calls this focused wrapper.
export async function runCanvasExportDeliveryTests(f){
  const discovery=[],fresh=[],scoped=Object.create(f);
  scoped.test=async(name,operation)=>{
    assert(!discovery.includes(name),'Duplicate export delivery callback');discovery.push(name);
    if(canvasExportDeliveryInventory.includes(name)){fresh.push(name);await f.test(name,operation);}
  };
  await runCanvasTests(scoped);
  assert.deepEqual(fresh,canvasExportDeliveryInventory,'Missing/reordered affected export delivery callback');
  assert.equal(discovery.length,267,'Canvas discovery changed; review export caller closure');
  assert.equal(createHash('sha256').update(JSON.stringify(discovery)).digest('hex'),'9f41365aff215f22be923d5564703618ac5b828607df719071f55345e479d83f','Canvas discovery changed; review export caller closure');
  f.metrics.push({exportDelivery:{fresh,discovery}});
}
