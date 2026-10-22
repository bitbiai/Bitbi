import {canvasAgentBudgetFixture} from './canvas-agent-autonomy-control.mjs';
import {seedCanvasPlanningSettlement} from './canvas-agent-settlement-review-control.mjs';
import {calculateCanvasPlanningSettlementReview} from '../../workers/auth/src/lib/model-tariffs.js';
import {settleStoredReceipt} from '../../workers/auth/src/lib/canvas-agent-planning.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import {stablePricingJson} from '../../js/shared/model-tariff.mjs';
const check=(condition,message)=>{if(!condition)throw new Error(message);};

// This fixture describes persisted 0111 data before the 0112 table rebuild.
// Today's operator preview reads later budget views, so it cannot be used to
// create historical data on this deliberately old schema. Keep the historical
// review envelope, but exercise the actual receipt settlement/debit below.
async function seedReviewedSettlement(c){
 const {db,env}=c.f,run=await c.run(),operation=await c.operation();
 const step=await db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(c.ids.stepId).first();
 const usage=await db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(c.ids.usageAttemptId).first();
 const receipt=JSON.parse(operation.receipt_json),metadata=JSON.parse(usage.metadata_json);
 const calculation=calculateCanvasPlanningSettlementReview(metadata.model_tariff,usage.credit_cost,receipt.usage);
 check(operation.reconcile_attempts===5&&operation.error_code==='generation_result_requires_credit_review','Original failed settlement history is populated');
 check(usage.billing_status==='reserved'&&usage.credit_cost===146&&(await c.ledger()).length===0,'Historical reservation has not been charged');
 check(calculation.credits===94&&calculation.units.outputToken===17333,'Original tariff and actual reasoning usage calculate 94 credits');
 const approval={version:1,...c.ids,receiptDigest:await sha256Hex(operation.receipt_json),responseDigest:await sha256Hex(operation.response_json),
  tariffDigest:await sha256Hex(JSON.stringify(metadata.model_tariff)),inputDigest:operation.input_digest,requestId:operation.request_id,
  units:calculation.units,diagnostics:calculation.diagnostics,reservationCredits:usage.credit_cost,settlementCredits:calculation.credits,
  projectCapCredits:run.budget_credits,budgetRevision:run.budget_revision,projectRevision:run.expected_revision,
  briefRevision:run.brief_revision,originalReconcileAttempts:operation.reconcile_attempts};
 const id=await sha256Hex(stablePricingJson(approval)),now=new Date().toISOString(),token=await sha256Hex('synthetic-historical-review-lease');
 await db.prepare(`INSERT INTO canvas_agent_settlement_reviews(id,operation_id,project_id,run_id,step_id,usage_attempt_id,user_id,
  request_id,input_digest,receipt_digest,response_digest,tariff_digest,review_digest,units_json,diagnostics_json,
  reservation_credits,settlement_credits,project_cap_credits,budget_revision,project_revision,brief_revision,
  original_reconcile_attempts,authorization_ref,actor,state,attempts,lease_token,lease_until,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',1,?,?,?,?)`)
  .bind(id,operation.id,run.project_id,run.id,step.id,usage.id,run.user_id,operation.request_id,operation.input_digest,
   approval.receiptDigest,approval.responseDigest,approval.tariffDigest,id,JSON.stringify(calculation.units),JSON.stringify(calculation.diagnostics),
   usage.credit_cost,calculation.credits,run.budget_credits,run.budget_revision,run.expected_revision,run.brief_revision,
   operation.reconcile_attempts,'synthetic-owner-approval','synthetic-operator',token,new Date(Date.now()+300000).toISOString(),now,now).run();
 await settleStoredReceipt(env,run,step,{...receipt,request:JSON.parse(step.receipt_json).request,operationId:operation.id},operation,
  {settlementReviewId:id,settlementReviewLeaseToken:token});
 const debit=await c.ledger(),settled=await db.prepare('SELECT billing_status,provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(usage.id).first();
 check(debit.length===1&&debit[0].amount===-94&&debit[0].ai_dispatch_token===usage.dispatch_token
  &&settled.billing_status==='finalized'&&settled.provider_outcome==='succeeded','Stored receipt creates the actual original debit exactly once');
 // Populate only the historical continuation outcome; no current production
 // scheduler or newer-schema admission code runs before the migration.
 await db.batch([
  db.prepare("UPDATE canvas_agent_settlement_reviews SET state='completed',settled_at=?,continued_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?")
   .bind(now,now,now,id),
  db.prepare("UPDATE canvas_agent_runs SET status='planning',phase='planning',error_code=NULL,cause_json=NULL,next_attempt_at=?,updated_at=? WHERE id=?")
   .bind(now,now,run.id),
 ]);
}
export async function seedCanvasAssistantMigration(env){
 const later=await env.DB.prepare("SELECT name FROM sqlite_schema WHERE name='canvas_agent_media_action_costs'").first();
 check(!later,'Historical assistant migration starts before the 0116 budget view');
 const f=await canvasAgentBudgetFixture(env,'assistant-model-migration');
 const c=await seedCanvasPlanningSettlement(f,{scope:'assistant-model-migration'});
 await seedReviewedSettlement(c);
 const rows={};
 for(const [key,sql,id] of [
  ['operation','SELECT * FROM canvas_agent_model_operations WHERE id=?',c.ids.operationId],
  ['review','SELECT * FROM canvas_agent_settlement_reviews WHERE operation_id=?',c.ids.operationId],
  ['usage','SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?',c.ids.usageAttemptId],
  ['step','SELECT * FROM canvas_agent_steps WHERE id=?',c.ids.stepId],
 ])rows[key]=await env.DB.prepare(sql).bind(id).first();
 check(rows.review?.state==='completed'&&rows.operation.reconcile_attempts===5,'Populated historical review with exhausted attempts');
 return {ids:c.ids,rows,ledger:await c.ledger()};
}
export async function verifyCanvasAssistantMigration(env,snapshot){
 const {ids,rows}=snapshot;
 for(const [key,table,column,id] of [
  ['operation','canvas_agent_model_operations','id',ids.operationId],['review','canvas_agent_settlement_reviews','operation_id',ids.operationId],
  ['usage','member_ai_usage_attempts_v2','id',ids.usageAttemptId],['step','canvas_agent_steps','id',ids.stepId],
 ])check(JSON.stringify(await env.DB.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).bind(id).first())===JSON.stringify(rows[key]),`Historical ${key} survives byte-for-byte`);
 const ledger=(await env.DB.prepare('SELECT id,amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?').bind(ids.userId,'canvas-agent-'+ids.stepId).all()).results;
 check(JSON.stringify(ledger)===JSON.stringify(snapshot.ledger),'No migration billing rewrite');
 const run=await env.DB.prepare('SELECT model_id,model_revision FROM canvas_agent_runs WHERE id=?').bind(ids.runId).first();
 check(run.model_id==='xai/grok-4.7'&&run.model_revision===0,'Historical accepted model remains Grok');
 for(const sql of ["UPDATE canvas_agent_model_operations SET model='anthropic/claude-fable-5' WHERE id=?","UPDATE canvas_agent_model_operations SET receipt_json='{}' WHERE id=?","UPDATE canvas_agent_model_operations SET receipt_protocol=1 WHERE id=?"]){
  let refused=false;try{await env.DB.prepare(sql).bind(ids.operationId).run();}catch{refused=true;}check(refused,'Historical operation immutability survives rebuild');
 }
 let refused=false;try{await env.DB.prepare("UPDATE canvas_agent_runs SET model_id='anthropic/claude-fable-5' WHERE id=?").bind(ids.runId).run();}catch{refused=true;}check(refused,'Accepted model pin cannot change');
 const fk=(await env.DB.prepare('PRAGMA foreign_key_check').all()).results;check(fk.length===0,'Populated migration preserves references');
 return {historicalOperationPreserved:true,settlementReviewPreserved:true,originalDebit:94,originalFailures:5};
}
