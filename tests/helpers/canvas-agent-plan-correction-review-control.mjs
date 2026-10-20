import worker from '../../workers/auth/src/index.js';
import {canvasAgentConversationFixture,attachCanvasConversation} from './canvas-agent-conversation-control.mjs';
import {freshCanvasAgentPlan} from './canvas-agent-control.mjs';
import {reconcileCanvasAgentModelOperations} from '../../workers/auth/src/lib/canvas-agent-model-operations.js';
import {previewCanvasPlanInterpretation,applyCanvasPlanInterpretation} from '../../workers/auth/src/lib/canvas-agent-plan-interpretation.js';
import {assertCanvasPlanReviewCurrent} from '../../workers/auth/src/lib/canvas-agent-plan-correction-review.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
const check=(v,m)=>{if(!v)throw new Error(m);};
const equal=(a,b,m)=>check(JSON.stringify(a)===JSON.stringify(b),m);
async function rejected(fn,code){try{await fn();}catch(error){check([error,error.cause,error.cause?.cause].some(e=>String(e?.code||e?.message).includes(code)),`Expected ${code}, received ${error.code||error.message}`);return;}throw new Error(`Missing ${code}`);}
async function fixture(base,name){
 const c=await canvasAgentConversationFixture(base,{scope:'reviewed-'+name}),f=c.f;
 const empty=await c.read(),immediate=await c.data(await c.post('/immediate',{text:'Create a 12 second film of builders and a duck pool.',locale:'en',delegateCreative:true,
  expectedConversationRevision:empty.revision,expectedBriefRevision:empty.briefRevision,expectedRevision:0})),intent=immediate.conversation.immediateIntent;
 const admitted=await c.data(await c.post('/immediate/approve',{intentId:intent.id,intentRevision:intent.revision,capCredits:intent.quote.proposedCapCredits,
  authorized:true,expectedRevision:intent.expectedRevision,expectedBriefRevision:intent.expectedBriefRevision})),runId=admitted.run.id;
 c.restore();
 const run=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
 const deliver=async(env=f.env)=>{const current=await run(),now=await f.atClock(()=>Date.now());f.advance(Math.max(0,Date.parse(current.next_attempt_at)-now));
  return f.atClock(async()=>{await worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){},retry(){throw Error('No blind provider retry');}}))},env,{waitUntil(p){throw new Error('No detached correction work');}});});};
 await deliver();check(f.calls.length===1,'One actual original planning request');
 const plan=freshCanvasAgentPlan();plan.assembly.clips.at(-1).transition={preset:'dissolve',duration:.5};
 plan.nodes.push({key:'reference',type:'image_generation',title:'Reference image',modelId:'xai/grok-imagine-image-2.0',prompt:'An ordinary reference image.',config:{outputFormat:'jpeg'},dependencies:[]});
 const completion=(call,value)=>f.request(call.body.options.webhookUrl,'POST',{id:call.id,state:'Completed',model:'xai/grok-4.7',result:{id:call.id+'-response',object:'chat.completion',model:'grok-4.7',
  choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}],usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}});
 check((await completion(f.calls[0],plan)).ok,'Original signed response accepted');
 await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId}));
 // Historical failure projection follows real dispatch, receipt and settlement;
 // immutable accepted run/step/operation identities are never overwritten.
 await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',phase='planning',error_code='canvas_agent_plan_invalid',lease_token=NULL,lease_until=NULL WHERE id=?").bind(runId).run();
 const op=await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=?').bind(runId).first();
 const oldRun=await run(),conversation=await attachCanvasConversation(f,{scope:'reviewed-operational-'+name});
 await conversation.approve();
 const message='Please start anew, ensuring this same problem cannot happen again.';
 const updated=await conversation.exchange(message,{text:'I have recorded your request to continue the film.',intent:'ready',fields:{latestInstruction:message},
  actions:[{type:'start_now',targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:0}]});
 conversation.restore();
 const sourceTurnId=updated.brief.fields.latestInstruction.sourceMessageId;
 check(updated.briefRevision===oldRun.brief_revision+1,'Only the operational dialogue increments the brief');
 const input={userId:f.owner,projectId:f.project,runId,stepId:op.step_id,operationId:op.id,usageAttemptId:op.usage_attempt_id,
  strategy:'bounded-correction',expectedBriefRevision:updated.briefRevision,sourceTurnId,intentId:intent.id,
  instructionReview:{classification:'operational-only',sourceMessageDigest:await sha256Hex(message),proposedInstructionDigest:await sha256Hex(message)}};
 const preview=()=>f.atClock(()=>previewCanvasPlanInterpretation(f.env,input));
 const apply=(review,env=f.env)=>f.atClock(()=>applyCanvasPlanInterpretation(env,{...input,reviewDigest:review.reviewDigest,actor:'synthetic-owner',authorizationRef:'synthetic-exact-operational-review'}));
 const ledger=async()=>(await f.db.prepare('SELECT id,amount,idempotency_key FROM member_credit_ledger WHERE user_id=? AND amount<0 ORDER BY rowid').bind(f.owner).all()).results;
 return {...f,runId,run,op,oldRun,input,preview,apply,deliver,completion,ledger,plan};
}
export async function canvasPlanCorrectionReviewCase(base,name){
 const f=await fixture(base,name),original=await f.run(),before=await f.ledger();
 const review=await f.preview();check(review.authority.boundedCorrection.attempt===1&&review.authority.originalPlanningAttempts===3,'Exact original authorization includes this one reviewed correction');
 check(review.authority.effectiveBriefRevision===original.brief_revision+1&&review.newCharges===0,'Dry run preserves original brief identity and charges');
 if(name==='guards'){
  for(const field of ['story','setting','latestInstruction']){
   const row=await f.db.prepare('SELECT brief_json,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first(),changed=JSON.parse(row.brief_json);
   changed.fields[field]={...(changed.fields[field]||{}),value:'Replace the intended house with a different creative story.'};
   await f.db.prepare('UPDATE canvas_agent_conversations SET brief_json=? WHERE project_id=?').bind(JSON.stringify(changed),f.project).run();
   await rejected(()=>f.apply(review),'canvas_agent_plan_correction_review_invalid');
   await f.db.prepare('UPDATE canvas_agent_conversations SET brief_json=? WHERE project_id=?').bind(row.brief_json,f.project).run();
  }
  await rejected(()=>f.atClock(()=>previewCanvasPlanInterpretation(f.env,{...f.input,instructionReview:{...f.input.instructionReview,sourceMessageDigest:'0'.repeat(64)}})),'canvas_agent_plan_correction_review_invalid');
  await rejected(()=>f.atClock(()=>previewCanvasPlanInterpretation(f.env,{...f.input,sourceTurnId:'foreign-completed-dialogue'})),'canvas_agent_plan_correction_review_invalid');
  await rejected(()=>f.atClock(()=>previewCanvasPlanInterpretation(f.env,{...f.input,instructionReview:null})),'canvas_agent_plan_correction_review_invalid');
  equal(await f.ledger(),before,'Denied semantic or identity changes do not charge');check(f.calls.length===1,'No inference on rejected review');
  return {case:name,newPlanningCalls:0,guardCases:6};
 }
 await f.apply(review);await f.apply(review);
 equal((await f.run()).brief_revision,original.brief_revision,'Operator review never edits immutable accepted brief revision');
 equal(await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(f.op.id).first(),f.op,'Original receipt is untouched');
 let lost=false;
 const DB=new Proxy(f.db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);
   if(!lost&&(await f.run()).repair_attempts===1){lost=true;throw Error('synthetic-lost-correction-allocation-ack');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await f.deliver({...f.env,DB});check(lost,'Crash occurs after real correction allocation commit');
 const allocated=await f.run(),correction=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(review.authority.boundedCorrection.stepId).first();
 check(allocated.status==='planning'&&allocated.repair_attempts===1&&correction.status==='ready','One committed correction remains durably runnable after a lost acknowledgement');
 equal(await f.ledger(),before,'Allocation is no duplicate debit');
 if(name==='race'){
  const current=await f.db.prepare('SELECT brief_json,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(f.project).first(),changed=JSON.parse(current.brief_json);
  changed.revision++;changed.fields.story={value:'A genuinely different film about a cat.',provenance:'corrected',sourceMessageId:'synthetic-later-owner-message',revision:changed.revision};
  await f.db.prepare('UPDATE canvas_agent_conversations SET brief_revision=?,brief_json=? WHERE project_id=?').bind(changed.revision,JSON.stringify(changed),f.project).run();
  await rejected(()=>assertCanvasPlanReviewCurrent(f.env,allocated),'canvas_agent_plan_correction_review_invalid');
  await f.deliver();check(f.calls.length===1&&(await f.run()).status!=='running','A later creative edit prevents dispatch of the already allocated correction');
  equal(await f.ledger(),before,'Stale reviewed correction does not charge');
  return {case:name,newPlanningCalls:0,postAllocationRaceBlocked:true};
 }
 await f.deliver();check(f.calls.length===2,'Exactly one new correction dispatches, original inference is reused');
 const valid=freshCanvasAgentPlan();valid.nodes.push({...f.plan.nodes.at(-1),config:{}});
 check((await f.completion(f.calls[1],valid)).ok,'Separately accepted corrected response persists');
 await f.deliver();const progressed=await f.run();
 check(progressed.status==='running'&&progressed.repair_attempts===1,'Reviewed correction passes full preflight and applies ordinary graph');
 check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=? AND deleted_at IS NULL').bind(f.project).first()).n===5,'The retained story and reference become editable nodes');
 const after=await f.ledger();check(after.length===before.length+1,'Exactly one new planning debit settles');
 check((await f.completion(f.calls[1],valid)).ok,'Duplicate correction receipt is acknowledged');
 await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId:f.runId}));equal(await f.ledger(),after,'Duplicate receipt cannot charge twice');
 const {assertCanvasAgentPlanningAllowed}=await import('../../workers/auth/src/lib/canvas-agent-repair.js');
 await rejected(()=>assertCanvasAgentPlanningAllowed(f.env,progressed,[],{stepId:'unapproved-second-correction',allocation:true}),'canvas_agent_recovered_plan_requires_review');
 return {case:name,newPlanningCalls:1,nodes:5,correctionAttempts:1,originalDebitPreserved:true};
}
