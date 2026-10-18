import worker from '../../workers/auth/src/index.js';
import { canvasAgentBudgetFixture } from './canvas-agent-autonomy-control.mjs';
import { freshCanvasAgentPlan } from './canvas-agent-control.mjs';
import { canvasAgentCapabilities } from '../../workers/auth/src/lib/canvas-agent-capabilities.js';
import { canvasAgentProject,plannerProject } from '../../workers/auth/src/routes/canvas-agent.js';
import { canvasAgentPolicyIdentity } from '../../workers/shared/canvas-agent/manifest.mjs';
import { canvasAgentEnvironment } from '../../workers/auth/src/lib/canvas-agent-authority.js';
import { beginMemberAiUsageAttempt,markMemberAiUsageAttemptProviderRunning,markMemberAiUsageAttemptFinalizing } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { reconcileCanvasAgentModelOperations } from '../../workers/auth/src/lib/canvas-agent-model-operations.js';
import { publicAgentRun } from '../../workers/auth/src/lib/canvas-agent-store.js';
import { previewCanvasPlanningSettlementReview,applyCanvasPlanningSettlementReview } from '../../workers/auth/src/lib/canvas-agent-settlement-review.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const equal=(actual,expected,message)=>check(JSON.stringify(actual)===JSON.stringify(expected),message);
async function rejected(operation,code){try{await operation();}catch(error){check([error.code,error.message,error.cause?.message].some(value=>String(value||'').includes(code)),`Expected ${code}, got ${error.code||error.message}`);return;}throw new Error(`Missing rejection ${code}`);}
export const CANVAS_SETTLEMENT_CASES=['exact','unrelated','concurrent','debit-crash','graph-crash','cancelled','expired','taken-over','edited','invalid-plan','usage-invalid','raw-usage-contract','over-reservation','identity'];

// Sanitized historical metering and tariff only. All identities, content and
// provider receipts below are synthetic; no production payload is embedded.
export const HISTORICAL_PLANNING_TARIFF={credits:146,tariff:{version:'model-tariff-v1',factoryVersion:'factory-2026-09-21',revision:22,
    key:'xai/grok-4.7:{}',configuration:{},units:{inputToken:56954,outputToken:16384},rates:null,source:'factory'},
    factorySettlement:{inputRateUsdPerMillion:2,outputRateUsdPerMillion:6,longContextThreshold:200000,longContextMultiplier:2,
        fundingMultiplier:1.05,usdToEur:.855176,netEurPerCredit:.0016325062499999998,targetProfitMargin:.2}};
export async function seedCanvasPlanningSettlement(f,{scope='settlement',plan=freshCanvasAgentPlan(),usageChange=null,rawUsageChange=null}={}) {
    const db=f.db,env=f.env,now=new Date().toISOString();env.CANVAS_AGENT_ENABLED='true';env.ENABLE_GROK_4_7='true';
    const view=await canvasAgentProject(env,f.owner,f.project),inventory=await canvasAgentCapabilities(env);
    const runId=(await sha256Hex(scope+':run:'+f.project)).slice(0,32),stepId=(await sha256Hex(scope+':step:'+f.project)).slice(0,32),operationId=(await sha256Hex(scope+':operation:'+f.project)).slice(0,32);
    const policy=await canvasAgentPolicyIdentity('planning'),lease='synthetic-settlement-lease',duration=plan.assembly.targetDurationSeconds;
    const payload={version:1,model:'xai/grok-4.7',requestId:runId,brief:'A funny dog film with editable source clips.',targetDurationSeconds:duration,
        toleranceSeconds:.5,projectRevision:view.project.revision,capabilityRevision:inventory.revision,capabilities:inventory,currentProject:plannerProject(view),policy,
        privacyUser:'cau_'+await sha256Hex(f.owner),promptCacheKey:'cap_'+await sha256Hex(f.project)};
    const inputDigest=await sha256Hex(JSON.stringify(payload));
    await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,target_seconds,budget_credits,tariff_revision,
        capability_revision,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at,policy_json)
        VALUES(?,?,?,?,?,'planning',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId,f.project,f.owner,'synthetic-'+scope,
            JSON.stringify({brief:payload.brief,locale:'en',targetDurationSeconds:duration}),view.project.revision,duration,3893,inventory.tariffRevision,inventory.revision,
            lease,new Date(Date.now()+600000).toISOString(),now,now,now,new Date(Date.now()+3600000).toISOString(),JSON.stringify(policy)).run();
    await db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
        VALUES(?,?,'plan','plan',?,146,?,?)`).bind(stepId,runId,JSON.stringify({modelId:'xai/grok-4.7',payload}),now,now).run();
    const scoped=canvasAgentEnvironment(env,{runId,stepId,projectId:f.project,userId:f.owner,leaseToken:lease});
    const metadata={canvas_agent:{run_id:runId,step_id:stepId,project_id:f.project},model_tariff:structuredClone(HISTORICAL_PLANNING_TARIFF)};
    // Construct an accepted historical tariff at its own revision. Restore the
    // current price state immediately; the real stale-price guard stays active.
    // This is fixture setup, never a recovery mutation of the accepted pin.
    let admitted;
    await db.prepare('UPDATE model_pricing_state SET revision=? WHERE id=1').bind(22).run();
    try{admitted=await beginMemberAiUsageAttempt({env:scoped,userId:f.owner,featureKey:'ai.text.generate',operationKey:'member.text.generate',
        route:`/api/account/canvas/projects/${f.project}/agent`,idempotencyKey:'canvas-agent-'+stepId,requestFingerprint:inputDigest,creditCost:146,metadata});}
    finally{await db.prepare('UPDATE model_pricing_state SET revision=? WHERE id=1').bind(inventory.tariffRevision).run();}
    const usageAttemptId=admitted.attempt.id,dispatchToken=await markMemberAiUsageAttemptProviderRunning(scoped,usageAttemptId);
    await markMemberAiUsageAttemptFinalizing(scoped,usageAttemptId,{dispatchToken});
    const usage={input_tokens:16076,output_tokens:2582,cache_read_input_tokens:1152,output_tokens_details:{thinking_tokens:14751},
        provider:{prompt_tokens:16076,completion_tokens:2582,total_tokens:33409,cached_tokens:1152,image_tokens:0,reasoning_tokens:14751,sources_used:0}};
    if(usageChange)usageChange(usage);
    const receipt={ok:true,model:'xai/grok-4.7',requestId:runId,outcome:'completed',responseId:'synthetic-stored-response',plan:{...plan,updates:plan.updates||[]},usage,policy};
    const response={id:'synthetic-original-provider-run',state:'Completed',model:'xai/grok-4.7',result:{id:receipt.responseId,object:'chat.completion',model:'grok-4.7',
        choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens,
            total_tokens:usage.provider.total_tokens,prompt_tokens_details:{cached_tokens:usage.cache_read_input_tokens},completion_tokens_details:{reasoning_tokens:usage.output_tokens_details.thinking_tokens}}}};
    if(rawUsageChange)rawUsageChange(response.result.usage);
    await db.prepare(`UPDATE canvas_agent_steps SET status='accepted',usage_attempt_id=?,receipt_json=? WHERE id=?`)
        .bind(usageAttemptId,JSON.stringify({request:{inputDigest,frameDigests:[]},operationId}),stepId).run();
    await db.prepare(`INSERT INTO canvas_agent_model_operations(id,step_id,run_id,user_id,usage_attempt_id,dispatch_token,kind,model,request_id,input_digest,context_json,
        caller_policy_json,state,provider_run_id,response_json,receipt_json,receipt_protocol,dispatched_at,response_at,completed_at,next_attempt_at,receipt_deadline,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'plan','xai/grok-4.7',?,?,?,?,'completed',?,?,?,2,?,?,?,?,?,?,?)`).bind(operationId,stepId,runId,f.owner,usageAttemptId,dispatchToken,
            runId,inputDigest,JSON.stringify({targetDurationSeconds:duration,toleranceSeconds:.5,existingNodeIds:view.nodes.map(node=>node.id),policy}),
            JSON.stringify({request_fingerprint:inputDigest,model_id:'xai/grok-4.7',source_component:'auth-worker-canvas-agent',correlation_id:runId}),
            response.id,JSON.stringify(response),JSON.stringify(receipt),now,now,now,now,new Date(Date.now()+1800000).toISOString(),now,now).run();
    await db.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL WHERE id=?').bind(runId).run();
    // Exercise the original failing settlement through the real reconciler.
    // Only its persisted wake time is advanced, as in the existing queue fixture.
    for(let attempt=0;attempt<5;attempt++){
        await db.prepare("UPDATE canvas_agent_model_operations SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(operationId).run();
        await reconcileCanvasAgentModelOperations(env,{runId});
    }
    const ids={userId:f.owner,projectId:f.project,runId,stepId,operationId,usageAttemptId};
    const run=()=>db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    const operation=()=>db.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(operationId).first();
    const ledger=()=>db.prepare('SELECT id,amount,ai_dispatch_token FROM member_credit_ledger WHERE user_id=? AND idempotency_key=?').bind(f.owner,'canvas-agent-'+stepId).all().then(result=>result.results);
    const preview=()=>previewCanvasPlanningSettlementReview(env,ids);
    const apply=async(options={})=>applyCanvasPlanningSettlementReview(env,{...ids,reviewDigest:(await preview()).reviewDigest,authorizationRef:'synthetic-owner-approval',actor:'synthetic-operator',...options});
    return {f,ids,plan,payload,receipt,metadata,run,operation,ledger,preview,apply,baselineNodeCount:view.nodes.length};
}

async function deliver(env,runId){
    await env.DB.prepare("UPDATE canvas_agent_runs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){},retry(){throw new Error('Unexpected recovery queue retry');}}))},env,{waitUntil(){throw new Error('No detached recovery');}});
}

// Inject a process-boundary failure around real D1 operations, not fake SQL
// results. The native runner executes the very same fixture and transaction.
function failOnce(db,{statement=null,afterBatch=null}) {
    let fired=false;
    return {get fired(){return fired;},db:new Proxy(db,{get(target,key){
        if(key==='prepare')return sql=>{
            const wrap=prepared=>new Proxy(prepared,{get(item,method){
                if(method==='bind')return(...args)=>wrap(item.bind(...args));
                if(['run','first','all'].includes(method))return async(...args)=>{if(!fired&&statement?.(sql)){fired=true;throw new Error('synthetic-process-loss');}return item[method](...args);};
                const value=item[method];return typeof value==='function'?value.bind(item):value;
            }});return wrap(target.prepare(sql));
        };
        if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!fired&&afterBatch&&await afterBatch()){fired=true;throw new Error('synthetic-process-loss-after-commit');}return result;};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
    }})};
}

export async function canvasPlanningSettlementCase(base,name) {
    check(CANVAS_SETTLEMENT_CASES.includes(name),'Known settlement control');
    if(name==='raw-usage-contract'){
        // Each synthetic provider envelope is persisted once, preserving the
        // real immutable-receipt trigger. Its historical normalized receipt
        // still looks valid; review must independently validate the raw data.
        const changes=[
            usage=>{usage.num_sources_used=1;},
            usage=>{usage.prompt_tokens_details.audio_tokens=1;},
            usage=>{usage.completion_tokens_details.accepted_prediction_tokens=1;},
            usage=>{usage.cached_tokens=0;},
            usage=>{usage.prompt_tokens_details.image_tokens=2;},
        ];
        for(const [index,rawUsageChange] of changes.entries()){
            const f=await canvasAgentBudgetFixture(base,'settlement-raw-'+index);
            const c=await seedCanvasPlanningSettlement(f,{scope:'raw-'+index,rawUsageChange});
            await rejected(c.preview,'canvas_agent_settlement_usage_mismatch');
            equal(await c.ledger(),[],'Unsupported or contradictory raw metering never reaches a debit');
            check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_settlement_reviews WHERE run_id=?').bind(c.ids.runId).first()).n===0,'Rejected raw evidence cannot create an approval');
            check(f.unexpected.length===0,'Raw metering validation does not call the provider');
        }
        return {case:name,planningCalls:0,debits:0};
    }
    const f=await canvasAgentBudgetFixture(base,'settlement-'+name),plan=freshCanvasAgentPlan();
    let unrelated;
    if(name==='unrelated'){
        const id=(await sha256Hex('synthetic-unrelated-settlement-project')).slice(0,32),now=new Date().toISOString();
        await f.db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Unrelated work','en',?,?)").bind(id,f.owner,now,now).run();
        const run=await f.createRun('unrelated-existing',300,id),step=await f.allocate(run,'unrelated-plan',40);
        unrelated={run,step};
    }
    if(name==='invalid-plan')plan.nodes[0].config.duration=3;
    const c=await seedCanvasPlanningSettlement(f,{scope:name,plan,usageChange:name==='usage-invalid'?usage=>{usage.provider.total_tokens++;}:name==='over-reservation'?usage=>{
        usage.output_tokens=40000;usage.provider.completion_tokens=40000;usage.provider.total_tokens=usage.input_tokens+40000+usage.provider.reasoning_tokens;
    }:null});
    const original=await c.operation(),before=await c.ledger();equal(before,[],'Stored answer initially has no debit');
    check(original.reconcile_attempts===5&&(await c.run()).status==='review_required','Five historical settlement failures remain visible');
    if(name==='usage-invalid'||name==='over-reservation'){
        if(name==='usage-invalid')check(original.error_code==='canvas_agent_usage_invalid','Contradictory usage is rejected before the token-estimate review boundary');
        await rejected(c.preview,name==='usage-invalid'?'canvas_agent_settlement_state_changed':'canvas_agent_settlement_additional_authorization_required');
        equal(await c.ledger(),[],'Invalid or excessive usage cannot be charged');check(f.unexpected.length===0,'No provider call repairs invalid usage');
        return {case:name,planningCalls:0,debits:0};
    }
    const beforeUsage=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(c.ids.usageAttemptId).first();
    const projected=await publicAgentRun(f.env,await c.run());
    check(projected.modelOperation.outcome==='completed'&&projected.modelOperation.recovery==='settlement_review','Stored success is billing review, never unknown inference');
    check(projected.currentAction.tool==='billing.review'&&!projected.allowedActions.includes('resume'),'UI projection cannot restart stored planning');
    const quote=await c.preview();
    check(quote.reservationCredits===146&&quote.settlementCredits===94&&quote.unusedReservationCredits===52,'Original tariff settles exact reported usage for94 within146');
    check(quote.units.inputToken===16076&&quote.units.outputToken===17333&&quote.budget.capCredits===3893,'Reasoning remains billable under the unchanged project cap');
    equal(await c.ledger(),[],'Dry run is not a debit');
    if(name==='identity'){
        await rejected(()=>previewCanvasPlanningSettlementReview(f.env,{...c.ids,userId:f.foreign}),'canvas_agent_settlement_evidence_invalid');
        await rejected(()=>c.apply({reviewDigest:'f'.repeat(64)}),'canvas_agent_settlement_approval_invalid');
        await rejected(()=>c.apply({operationId:'f'.repeat(32)}),'canvas_agent_settlement_evidence_invalid');
        equal(await c.ledger(),[],'Forged identity or approval cannot settle');
        return {case:name,planningCalls:0,debits:0};
    }
    if(['cancelled','taken-over'].includes(name))await f.request(`${f.route}/${c.ids.runId}/control`,'POST',{action:name==='cancelled'?'cancel':'takeover'},{'Idempotency-Key':'synthetic-settlement-stop'});
    if(name==='expired')await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(c.ids.runId).run();
    if(name==='edited')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
    let result;
    if(name==='debit-crash'){
        const fault=failOnce(f.db,{statement:sql=>/UPDATE member_ai_usage_attempts_v2\s+SET status = 'succeeded'/.test(sql)});
        await rejected(()=>applyCanvasPlanningSettlementReview({...f.env,DB:fault.db},{...c.ids,reviewDigest:quote.reviewDigest,authorizationRef:'synthetic-owner-approval',actor:'synthetic-operator'}),'synthetic-process-loss');
        check(fault.fired&&(await c.ledger()).length===1,'Failure occurred after the actual ledger commit');result=await c.apply();
    } else if(name==='concurrent'){
        const results=await Promise.allSettled([c.apply(),c.apply()]);
        check(results.some(value=>value.status==='fulfilled'),'One concurrent recovery succeeds');
        for(const value of results)if(value.status==='rejected')check(/busy_or_exhausted|malformed JSON|JSON path error/.test(value.reason.code||value.reason.message),'Concurrent loser is fenced by the exact-state guard');
        result=await c.apply();
    } else result=await c.apply();
    check((await c.ledger()).length===1&&(await c.ledger())[0].amount===-94,'One original identity receives exactly one94-credit debit');
    const usage=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(c.ids.usageAttemptId).first();
    check(usage.billing_status==='finalized'&&usage.credit_cost===146&&usage.idempotency_key===beforeUsage.idempotency_key&&usage.request_fingerprint===beforeUsage.request_fingerprint,'Finalization preserves the admitted identity and ceiling');
    equal(JSON.parse(usage.metadata_json).model_tariff,JSON.parse(beforeUsage.metadata_json).model_tariff,'Historical pin is never rewritten');
    const after=await c.operation();equal(after,original,'Raw response, receipt and all five failure records remain unchanged');
    check(result.budget.reservedCredits===0&&result.budget.chargedCredits===94&&result.budget.remainingCredits===3799,'Reservation released once; project accounting counts the actual debit once');
    await c.apply();check((await c.ledger()).length===1,'Operator replay does not debit again');
    const held=['cancelled','taken-over','expired','edited'].includes(name);
    if(held){
        check(result.reviewState==='held'&&!result.continuationAllowed,'Cost reconciliation does not renew execution authority');
        await deliver(f.env,c.ids.runId);
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'Stopped or edited projects receive no new nodes');
    } else {
        let env=f.env,fault;
        if(name==='graph-crash'){fault=failOnce(f.db,{afterBatch:async()=>Boolean(await f.db.prepare("SELECT id FROM canvas_agent_runs WHERE id=? AND status='running' AND rounds=1").bind(c.ids.runId).first())});env={...env,DB:fault.db};}
        await deliver(env,c.ids.runId);
        if(fault)check(fault.fired,'The fault occurred after the actual graph commit');
        if(name==='invalid-plan'){
            check((await c.run()).error_code==='canvas_agent_recovered_plan_requires_review','Invalid preflight stops before another paid correction');
            check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(c.ids.runId).first()).n===1,'Recovery cannot add a new planning step');
        } else {
            const current=await c.run();check(current.status==='running'&&current.rounds===1,'Original stored plan passes preflight into normal graph execution');
            const nodes=(await f.db.prepare('SELECT id,type FROM canvas_nodes WHERE project_id=?').bind(f.project).all()).results;
            check(nodes.filter(node=>node.type==='video_generation').length===3&&nodes.filter(node=>node.type==='note').length===1,'Three editable video nodes and continuity note exist once');
            check(JSON.parse((await f.db.prepare('SELECT assembly_json FROM canvas_projects WHERE id=?').bind(f.project).first()).assembly_json).clips.length===3,'Playback order is normal persisted assembly');
            const beforeIds=nodes.map(node=>node.id);await c.apply();
            equal((await f.db.prepare('SELECT id FROM canvas_nodes WHERE project_id=?').bind(f.project).all()).results.map(node=>node.id),beforeIds,'Recovery replay after graph application creates no nodes');
            check((await publicAgentRun(f.env,await c.run())).modelOperation.recovery===null,'Settled history no longer projects a live billing block');
        }
    }
    check(f.unexpected.length===0,'No additional planning inference or media test request occurred');
    if(unrelated){
        equal(await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(unrelated.run.id).first(),unrelated.run,'Unrelated accepted run remains byte-for-byte unchanged');
        equal(await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(unrelated.step.id).first(),unrelated.step,'Unrelated planning step is not reset, charged or resumed');
    }
    return {case:name,planningCalls:0,debits:1,chargedCredits:94,originalReservationCredits:146,unusedReservationCredits:52,continued:!held&&name!=='invalid-plan'};
}
