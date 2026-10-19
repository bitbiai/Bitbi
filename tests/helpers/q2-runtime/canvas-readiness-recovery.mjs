import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runCanvasTests} from './canvas.mjs';

// Closed follow-up to the published 4dd1cacc Canvas acceptance. The ordinary
// suite still runs every callback. This scoped entry executes only new cases
// and records the exact retained/fresh discovery union for release verification.
export const canvasReadinessRecoveryInventory=Object.freeze([
  ...['operator','stale_control','cancelled','expired','edited'].map(name=>'canvas_h3_original_recovery_readiness_'+name),
  ...['accepted_pending','accepted_saved','retry_recover','retry_exhausted','disabled','model_disabled','revoked','expired','edited','unknown'].map(name=>'canvas_agent_readiness_'+name),
]);
export async function runCanvasReadinessRecoveryTests(f){
  const discovery=[],fresh=[],scoped=Object.create(f);
  scoped.test=async(name,operation)=>{
    assert(!discovery.includes(name),'Duplicate readiness recovery callback');discovery.push(name);
    if(canvasReadinessRecoveryInventory.includes(name)){fresh.push(name);await f.test(name,operation);}
  };
  await runCanvasTests(scoped);
  assert.deepEqual(fresh,canvasReadinessRecoveryInventory,'Missing or reordered fresh readiness callbacks');
  const retained=discovery.filter(name=>!canvasReadinessRecoveryInventory.includes(name));
  assert.equal(retained.length,251,'Retained readiness Canvas inventory changed');
  assert.equal(createHash('sha256').update(JSON.stringify(retained)).digest('hex'),'3bcde3da85495a7cfa8190ca3ad20f8f255c7b065941f88cfbf5d1c75cd3640f','Retained readiness membership/order changed');
  f.metrics.push({readinessRecovery:{retained,fresh,discovery}});
}
