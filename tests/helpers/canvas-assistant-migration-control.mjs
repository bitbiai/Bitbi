import {canvasAgentBudgetFixture} from './canvas-agent-autonomy-control.mjs';
import {seedCanvasPlanningSettlement} from './canvas-agent-settlement-review-control.mjs';
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function seedCanvasAssistantMigration(env){
 const f=await canvasAgentBudgetFixture(env,'assistant-model-migration');
 const c=await seedCanvasPlanningSettlement(f,{scope:'assistant-model-migration'});
 await c.apply();
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
