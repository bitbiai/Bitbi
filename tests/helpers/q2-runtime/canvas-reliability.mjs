import assert from 'node:assert/strict';

export const canvasReliabilityInventory=Object.freeze([
  'canvas_reliability_populated_notifications_migration',
  'canvas_reliability_committed_project_lifecycle',
  'canvas_reliability_owned_notification_history',
  ...['evidence','quoted','budget-scope'].map(name=>`canvas_reliability_explanation_${name}`),
  ...['fallback','manual','model','fable','unknown','resolved','revoked','isolation','deleted'].map(name=>`canvas_reliability_incident_${name}`),
  ...['recover','guards','crash','active','preflight'].map(name=>`canvas_reliability_plan_interpretation_${name}`),
  ...['fresh','resume','transient','bounded','unknown','guards','diagnostics','stored'].map(name=>`canvas_reliability_local_planning_${name}`),
  ...['recover','guards','race','format'].map(name=>`canvas_reliability_plan_correction_review_${name}`),
]);
// This additive suite is also part of Full. It does not relabel or rerun the
// previous Canvas/media evidence, and uses the same native Worker/D1 bindings.
export async function runCanvasReliabilityTests(f){
  let snapshot;
  for(const migration of f.migrations){
    if(migration.path.startsWith('0113')){
      const response=await f.control('/canvas-notifications-migration-seed',{});
      assert.equal(response.status,200,await response.clone().text());snapshot=await response.json();
    }
    await f.db.batch(migration.statements.map(sql=>f.db.prepare(sql)));
  }
  assert(snapshot,'The populated lifecycle migration boundary must be exercised');
  await f.test(canvasReliabilityInventory[0],async()=>{
    // Calibrate the real native D1 boundary: Node SQLite accepts the original
    // ten-arm view, while workerd limits each compound SELECT to five terms.
    const terms=count=>Array.from({length:count},(_,index)=>`SELECT ${index+1} AS value`).join(' UNION ALL ');
    assert.deepEqual(await f.rows(terms(5)),[1,2,3,4,5].map(value=>({value})));
    await assert.rejects(()=>f.db.prepare(`CREATE VIEW canvas_notification_limit_countercontrol AS ${terms(10)}`).run(),/too many terms in compound SELECT/);
    assert.deepEqual(await f.rows("SELECT name FROM sqlite_master WHERE name='canvas_notification_limit_countercontrol'"),[]);
    const response=await f.control('/canvas-notifications-migration-verify',snapshot);
    assert.equal(response.status,200,await response.clone().text());
    assert.deepEqual(await response.json(),{originalRowsPreserved:2,oldResolvedRead:true,oldUnresolvedUnread:true,readWrites:0});
    const changed=structuredClone(snapshot);changed.rows[0].input_json='{"forged":true}';
    await assert.rejects(()=>f.control('/canvas-notifications-migration-verify',changed),/preserves original generation evidence/);
  });
  for(const [name,path]of[[canvasReliabilityInventory[1],'/canvas-project-lifecycle'],[canvasReliabilityInventory[2],'/canvas-notifications']])await f.test(name,async()=>{
    if(path==='/canvas-notifications'){
      // The previous readback used one owner plus 100 ID bindings. Prove that
      // native D1 rejects that query; the shared authenticated caller below
      // must still accept all 100 IDs with the compact two-binding readback.
      const ids=Array.from({length:100},(_,index)=>`client:native-limit-${index}`);
      await assert.rejects(()=>f.db.prepare(`SELECT notification_id FROM canvas_notification_reads WHERE user_id=? AND notification_id IN (${ids.map(()=>'?').join(',')})`).bind('native-limit-owner',...ids).all(),/too many SQL variables|variable number must be between/);
    }
    const response=await f.control(path,{});assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.deepEqual(result,path==='/canvas-project-lifecycle'
      ?{foreignKeyCountercontrol:true,committedDeletion:true,redactedHistory:true,duplicateDeletion:true,lateWorkFenced:true,lateGraphWritesFenced:6,cleanupFailureBoundaries:3,completedGenerationReplayed:true}
      :{ownerIsolation:true,baseline:true,explicitReadIds:true,arrivalPreserved:true,clientDeduplicated:true,canonicalOnly:true,posterTruth:true,deletedProjectNotice:true});f.metrics.push(result);
  });
  for(const name of ['evidence','quoted','budget-scope'])await f.test(`canvas_reliability_explanation_${name}`,async()=>{
    const response=await f.control('/canvas-explanation',{name});assert.equal(response.status,200,await response.clone().text());
    assert.deepEqual(await response.json(),{case:name,providerCalls:name==='evidence'?0:1,scopes:2});
  });
  for(const name of ['fallback','manual','model','fable','unknown','resolved','revoked','isolation','deleted'])await f.test(`canvas_reliability_incident_${name}`,async()=>{
    const response=await f.control('/canvas-incident',{name});assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.case,name);assert.equal(result.providerCalls,['model','fable','unknown','resolved'].includes(name)?1:0);f.metrics.push(result);
  });
  for(const name of ['recover','guards','crash','active','preflight'])await f.test(`canvas_reliability_plan_interpretation_${name}`,async()=>{
    const response=await f.control('/canvas-agent-plan-interpretation',{name});assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.case,name);f.metrics.push(result);
  });
  for(const name of ['fresh','resume','transient','bounded','unknown','guards','diagnostics','stored'])await f.test(`canvas_reliability_local_planning_${name}`,async()=>{
    const response=await f.control('/canvas-local-planning-recovery',{name});assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.case,name);f.metrics.push(result);
  });
  for(const name of ['recover','guards','race','format'])await f.test(`canvas_reliability_plan_correction_review_${name}`,async()=>{
    const response=await f.control('/canvas-agent-plan-correction-review',{name});assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.case,name);assert.equal(result.newPlanningCalls,name==='recover'?1:0);f.metrics.push(result);
  });
  assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
}
