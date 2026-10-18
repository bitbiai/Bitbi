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
import { preflightCanvasAgentGraph,validateCanvasAgentNodeConfig } from '../../workers/auth/src/lib/canvas-agent-graph.js';
import { canvasGenerationSettings } from '../../js/shared/canvas-generation-settings.mjs';
import { getCanvasModelForRole } from '../../js/shared/canvas-model-contract.mjs';
import { persistCanvasAgentProposal,markCanvasAgentProposal } from '../../workers/auth/src/lib/canvas-agent-progress.js';
import { canvasAgentValidationIssue } from '../../workers/auth/src/lib/canvas-agent-plan-feedback.js';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const equal=(actual,expected,message)=>check(JSON.stringify(actual)===JSON.stringify(expected),message);
async function rejected(operation,code){try{await operation();}catch(error){check([error.code,error.message,error.cause?.message].some(value=>String(value||'').includes(code)),`Expected ${code}, got ${error.code||error.message}`);return;}throw new Error(`Missing rejection ${code}`);}
export const CANVAS_SETTLEMENT_CASES=['exact','unrelated','concurrent','debit-crash','graph-crash','cancelled','expired','taken-over','edited','invalid-plan','usage-invalid','raw-usage-contract','over-reservation','identity','inert-music-normalization','inert-music-boundary','continuation','continuation-crash','continuation-authority','continuation-evidence','continuation-revalidation'];

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

function inertMusicPlan() {
    const plan=freshCanvasAgentPlan();
    plan.nodes.push({key:'comedyScore',type:'music_generation',title:'Playful dog score',modelId:'elevenlabs/music-v2',
        prompt:'A playful instrumental comedy score for a dog film.',dependencies:[],
        config:{inputMode:'prompt',musicLengthMs:45000,forceInstrumental:true,originalAudio:{enabled:false,gain:0}}});
    plan.assembly.musicKey='comedyScore';plan.assembly.backgroundMusic={enabled:true,gain:.25};
    return plan;
}
const inertMusicRepair={code:'canvas_agent_music_original_audio_noop',nodeKey:'comedyScore',field:'config.originalAudio',from:{enabled:false,gain:0},to:null};

async function inertMusicCase(base,name) {
    const f=await canvasAgentBudgetFixture(base,'settlement-'+name),plan=inertMusicPlan();
    const c=await seedCanvasPlanningSettlement(f,{scope:name,plan});
    const raw=JSON.stringify(plan),original=await c.operation();
    const inventory=await canvasAgentCapabilities(f.env),view=await canvasAgentProject(f.env,f.owner,f.project),run=await c.run();
    const clean=structuredClone(plan);delete clean.nodes.at(-1).config.originalAudio;
    const normal=await preflightCanvasAgentGraph(f.env,run,view,inventory,clean);
    check(normal.ok,'Independent ordinary music plan is executable');
    if(name==='inert-music-boundary'){
        const variants=[
            ['enabled',value=>{value.nodes.at(-1).config.originalAudio.enabled=true;}],
            ['gain',value=>{value.nodes.at(-1).config.originalAudio.gain=.25;}],
            ['extra-field',value=>{value.nodes.at(-1).config.originalAudio.fadeIn=0;}],
            ['different-model',value=>{value.nodes.at(-1).modelId='minimax/music-2.6';value.nodes.at(-1).config={instrumental:true,originalAudio:{enabled:false,gain:0}};}],
            ['different-type',value=>{value.nodes[0].config.originalAudio={enabled:false,gain:0};value.nodes[0].modelId='google/imagen-4.0-fast';value.nodes[0].type='image_generation';}],
            ['other-invalid',value=>{value.nodes.at(-1).config.generateAudio=true;}],
        ];
        for(const [label,change]of variants){
            const invalid=structuredClone(plan);change(invalid);const before=JSON.stringify(invalid);
            const checked=await preflightCanvasAgentGraph(f.env,run,view,inventory,invalid);
            check(!checked.ok&&checked.issues.length>0,`Invalid ${label} remains rejected`);
            if(label!=='other-invalid'&&label!=='different-type')check(!checked.repairs.some(repair=>repair.code===inertMusicRepair.code),`${label} is not normalized`);
            check(JSON.stringify(invalid)===before,`Rejected ${label} preserves raw evidence`);
        }
        const video=structuredClone(clean);video.nodes[0].config.originalAudio={enabled:false,gain:0};
        const checked=await preflightCanvasAgentGraph(f.env,run,view,inventory,video);
        check(checked.ok&&!checked.repairs.length,'Valid video muting is not stripped');
        equal(checked.plan.nodes[0].config.originalAudio,{enabled:false,gain:0},'Video muting remains editable and effective');
        equal(await c.ledger(),[],'Read-only normalization countercontrols never debit');
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'Rejected plans cannot mutate the creative graph');
        check(f.unexpected.length===0,'Boundary checks cannot call any provider');
        return {case:name,planningCalls:0,debits:0};
    }
    const normalized=await preflightCanvasAgentGraph(f.env,run,view,inventory,plan);
    check(normalized.ok,'Exact inert music field is normalized by full preflight');
    equal(normalized.repairs,[inertMusicRepair],'Only the explicit inert-field repair is recorded');
    equal(normalized.plan,normal.plan,'Derived executable plan equals the independently valid ordinary plan');
    equal(normalized.costs,normal.costs,'Normalization does not alter the admitted media or evaluation prices');
    const expectedBody={model:'elevenlabs/music-v2',prompt:plan.nodes.at(-1).prompt,inputMode:'prompt',musicLengthMs:45000,forceInstrumental:true};
    const model=getCanvasModelForRole('elevenlabs/music-v2','member');
    equal(canvasGenerationSettings(plan.nodes.at(-1).config,model,expectedBody.prompt),expectedBody,'Original inert field has no provider meaning');
    equal(canvasGenerationSettings(normalized.plan.nodes.at(-1).config,model,expectedBody.prompt),expectedBody,'Effective provider request preserves the requested duration and instrumental score');
    check(JSON.stringify(plan)===raw,'Preflight preserves the complete raw plan');
    await c.apply();await deliver(f.env,c.ids.runId);
    const current=await c.run();check(current.status==='running'&&current.rounds===1,'Stored original answer reaches normal graph execution without inference');
    const proposal=await f.db.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(c.ids.stepId).first();
    equal(JSON.parse(proposal.plan_json),{...plan,updates:[]},'Historical proposal retains the original unsupported field');
    equal(JSON.parse(proposal.validation_json).repairs,[inertMusicRepair],'Applied proposal explains its effective normalization');
    const graph=await canvasAgentProject(f.env,f.owner,f.project);
    const music=graph.nodes.find(node=>node.model_id==='elevenlabs/music-v2');
    check(Boolean(music)&&!Object.hasOwn(JSON.parse(music.config_json),'originalAudio'),'Ordinary editable music node contains only supported settings');
    equal(canvasGenerationSettings(JSON.parse(music.config_json),model,expectedBody.prompt),expectedBody,'Persisted ordinary node builds the same provider request');
    equal(JSON.parse(current.plan_json).nodes.at(-1).config,clean.nodes.at(-1).config,'Saved effective plan agrees with the actual graph');
    equal(JSON.parse(graph.project.assembly_json).backgroundMusic,{enabled:true,gain:.25},'Independent assembly music controls remain intact');
    const nodeIds=graph.nodes.map(node=>node.id);await c.apply();
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'canvas_agent.process',run_id:c.ids.runId},attempts:2,ack(){},retry(){throw new Error('Unexpected duplicate wake retry');}}]},f.env,{waitUntil(){throw new Error('Unexpected detached recovery');}});
    equal((await canvasAgentProject(f.env,f.owner,f.project)).nodes.map(node=>node.id),nodeIds,'Repeated recovery does not create duplicate nodes');
    equal(await c.operation(),original,'Original response, receipt, tariff bindings and five historical failures remain byte-identical');
    equal((await c.ledger()).map(row=>row.amount),[-94],'Original planning charge settles once');
    check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(c.ids.runId).first()).n===1,'No correction or replacement planning identity exists');
    check(f.unexpected.length===0,'Normalization and graph application perform no new inference');
    return {case:name,planningCalls:0,debits:1,continued:true};
}

async function seedSettledMusicHold(base,scope,changePlan=null) {
    const f=await canvasAgentBudgetFixture(base,scope),plan=inertMusicPlan();f.env.ENABLE_GROK_4_6='false';
    if(changePlan)changePlan(plan);
    const c=await seedCanvasPlanningSettlement(f,{scope,plan});
    const recovered=await c.apply();check(recovered.reviewState==='completed','Historical settlement already completed before preflight hold');
    const run=await c.run(),step=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(c.ids.stepId).first();
    // Reconstruct the historical validator boundary with its unchanged strict
    // node validator. Only preflight now recognizes the exact inert field.
    let issue;const node=plan.nodes.at(-1),model=getCanvasModelForRole(node.modelId,'member');
    try{validateCanvasAgentNodeConfig(model,node.config,node.prompt);}catch(error){issue=canvasAgentValidationIssue(error,node,model);}
    check(issue?.code==='canvas_agent_parameter_unsupported','Historical failure is the actual strict node-validation error');
    await persistCanvasAgentProposal(f.env,run,step,{...plan,updates:[]});
    await markCanvasAgentProposal(f.env,step.id,'invalid',{issues:[issue],repairs:[],costs:null});
    await f.db.prepare("UPDATE canvas_agent_runs SET status='review_required',phase='planning',error_code='canvas_agent_recovered_plan_requires_review',cause_json=?,lease_token=NULL,lease_until=NULL WHERE id=?")
        .bind(JSON.stringify({code:'canvas_agent_recovered_plan_requires_review',step:'planning',recovery:'manual',issues:[issue]}),run.id).run();
    const service=await import('../../workers/auth/src/lib/canvas-agent-settlement-review.js');
    const input={...c.ids,reviewDigest:recovered.reviewDigest,authorizationRef:'synthetic-owner-approval',actor:'synthetic-operator'};
    const preview=()=>service.previewCanvasPlanningSettlementContinuation(f.env,input);
    const apply=async(options={})=>service.applyCanvasPlanningSettlementContinuation(f.env,{...input,continuationDigest:(await preview()).continuationDigest,...options});
    return {...c,f,previewContinuation:preview,applyContinuation:apply,continuationInput:input,continuationService:service};
}

async function continuationRevalidationCase(base) {
    const invalid=await seedSettledMusicHold(base,'settlement-other-parameter',plan=>{plan.nodes[0].config.duration=3;});
    await rejected(invalid.previewContinuation,'canvas_agent_settlement_continuation_preflight_blocked');
    check((await invalid.run()).status==='review_required','The narrow repair cannot conceal another invalid parameter');
    for(const action of ['price','capability','cap','headroom','atomic-edit']){
        const c=await seedSettledMusicHold(base,`settlement-revalidate-${action}`),{f}=c;
        const prepared=await c.previewContinuation(),input={...c.continuationInput,continuationDigest:prepared.continuationDigest};
        const price=(await f.db.prepare('SELECT revision FROM model_pricing_state WHERE id=1').first()).revision;
        if(action==='price')await f.db.prepare('UPDATE model_pricing_state SET revision=revision+1 WHERE id=1').run();
        else if(action==='capability')f.env.ENABLE_GROK_4_6='true';
        else if(action==='cap'){
            const original=await c.run();
            await rejected(()=>f.db.prepare('UPDATE canvas_agent_runs SET budget_credits=budget_credits-1 WHERE id=?').bind(c.ids.runId).run(),'canvas_agent_budget_consent_required');
            equal(await c.run(),original,'A direct cap write is rejected without changing the original authorization');
            // Fixture an ordinary pending budget decision, then use the actual
            // authenticated approval route. The consent trigger stays enabled.
            const requestId=(await sha256Hex(f.owner+':budget-amendment')).slice(0,32),now=new Date().toISOString();
            await f.db.prepare("UPDATE canvas_agent_runs SET status='paused',phase='budget' WHERE id=?").bind(c.ids.runId).run();
            await f.db.prepare(`INSERT INTO canvas_agent_budget_requests(id,run_id,reason_key,revision,project_revision,tariff_revision,
                current_cap,proposed_cap,action_json,resume_status,created_at)
                VALUES(?,?,'synthetic-cap-amendment',?,?,?,?,?,?,'planning',?)`)
                .bind(requestId,c.ids.runId,original.budget_revision,original.expected_revision,price,original.budget_credits,
                    original.budget_credits+1,JSON.stringify({action:'media.generate'}),now).run();
            const response=await f.request(`${f.route}/${c.ids.runId}/budget`,'POST',{
                requestId,requestRevision:original.budget_revision,decision:'accept',proposedCapCredits:original.budget_credits+1,expectedRevision:original.expected_revision,
            },{'Idempotency-Key':'synthetic-cap-amendment-approval'});
            check(response.ok,'The normal owner approval accepts the synthetic budget amendment');
            const amended=await c.run();
            check(amended.budget_credits===original.budget_credits+1&&amended.budget_revision===original.budget_revision+1,
                'Accepted spending scope has a genuinely different cap and revision');
        }
        else if(action==='headroom'){
            // A separately accepted briefing allocation shares the real project
            // cap. It is not another production or a fabricated ledger debit.
            const id=(await sha256Hex(f.owner+':accepted-briefing')).slice(0,32),now=new Date().toISOString();
            await f.db.prepare(`INSERT INTO canvas_agent_conversations(project_id,user_id,brief_json,allowance_credits,allowance_tariff,created_at,updated_at)
                VALUES(?,?,'{}',3893,?,?,?)`).bind(f.project,f.owner,price,now,now).run();
            await f.db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,
                tariff_revision,next_attempt_at,created_at,updated_at,expires_at,purpose)
                SELECT ?,project_id,user_id,?,'{}','planning',expected_revision,3893,tariff_revision,?,?,?,expires_at,'briefing'
                FROM canvas_agent_runs WHERE id=?`).bind(id,'synthetic-other-briefing',now,now,now,c.ids.runId).run();
            await f.allocate({id},'accepted-briefing',3770);
        }
        const before=await c.run();let env=f.env,raced=false;
        if(action==='atomic-edit')env={...f.env,DB:new Proxy(f.db,{get(target,key){
            if(key==='batch')return async statements=>{
                check(!raced,'Only one guarded continuation transaction is attempted');raced=true;
                await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
                return target.batch(statements);
            };
            const value=target[key];return typeof value==='function'?value.bind(target):value;
        }})};
        try{
            if(action==='atomic-edit'){
                let error;try{await c.continuationService.applyCanvasPlanningSettlementContinuation(env,input);}catch(caught){error=caught;}
                check(raced&&/malformed JSON|JSON path error/.test(String(error?.message||error)),'The actual D1 atomic guard rejects a revision race after successful revalidation');
            }else await rejected(()=>c.continuationService.applyCanvasPlanningSettlementContinuation(env,input),
                action==='cap'?'canvas_agent_settlement_continuation_state_changed':action==='headroom'?'canvas_agent_settlement_continuation_preflight_blocked':'canvas_agent_settlement_continuation_prices_changed');
        }finally{
            if(action==='price')await f.db.prepare('UPDATE model_pricing_state SET revision=? WHERE id=1').bind(price).run();
        }
        equal(await c.run(),before,'Changed price, capabilities, money or revision never releases the production hold');
        check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_events WHERE run_id=? AND event_key LIKE 'settlement-plan-continuation:%'").bind(c.ids.runId).first()).n===0,'Rejected or rolled-back continuation writes no acceptance event');
        equal((await c.ledger()).map(row=>row.amount),[-94],'Revalidation never changes the original settled cost');
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'No graph mutation escapes a failed final guard');
        check(f.unexpected.length===0,'Revalidation never calls a provider');
    }
    return {case:'continuation-revalidation',planningCalls:0,debits:6};
}

async function settledContinuationCase(base,name) {
    if(name==='continuation-revalidation')return continuationRevalidationCase(base);
    if(name==='continuation-authority'){
        for(const action of ['cancel','takeover','expired','edited','disabled']){
            const c=await seedSettledMusicHold(base,`settlement-authority-${action}`),{f}=c;
            const prepared=await c.previewContinuation();check(prepared.continuationAllowed,'Exact original authority permits the dry run');
            if(['cancel','takeover'].includes(action)){
                const response=await f.request(`${f.route}/${c.ids.runId}/control`,'POST',{action},{'Idempotency-Key':'synthetic-continuation-stop'});
                check(response.ok,'Normal user control stops the original production');
            }else if(action==='expired')await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(c.ids.runId).run();
            else if(action==='edited')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
            else f.env.CANVAS_AGENT_ENABLED='false';
            const stopped=await c.run();
            await rejected(()=>c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,{...c.continuationInput,continuationDigest:prepared.continuationDigest}),
                action==='disabled'?'canvas_agent_settlement_runtime_unavailable':'canvas_agent_settlement_continuation_state_changed');
            equal(await c.run(),stopped,'A stale continuation approval cannot change stopped, expired or edited authority');
            equal((await c.ledger()).map(row=>row.amount),[-94],'Previously committed planning cost is retained exactly once');
            check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'Invalid authority never reaches graph application');
            check(f.unexpected.length===0,'Authority revalidation performs no provider work');
        }
        return {case:name,planningCalls:0,debits:5};
    }
    const c=await seedSettledMusicHold(base,'settlement-'+name),{f}=c;
    const original=await c.operation(),historical=await f.db.prepare('SELECT * FROM canvas_agent_settlement_reviews WHERE operation_id=?').bind(c.ids.operationId).first();
    const before=await c.run(),quote=await c.previewContinuation();
    check(quote.continuationAllowed&&quote.continuationStatus==='ready','Read-only continuation dry run establishes exact feasible recovery');
    equal(quote.preflight.repairs,[inertMusicRepair],'Operator review exposes only the deterministic inert repair');
    equal(await c.run(),before,'Continuation dry run leaves the held run untouched');
    equal((await c.ledger()).map(row=>row.amount),[-94],'Dry run never repeats settlement');
    const input={...c.continuationInput,continuationDigest:quote.continuationDigest};
    if(name==='continuation-evidence'){
        for(const change of [{continuationDigest:'f'.repeat(64)},{actor:'different-operator'},{authorizationRef:'unrelated-approval'}])
            await rejected(()=>c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,{...input,...change}),'canvas_agent_settlement_continuation_approval_invalid');
        await rejected(()=>c.continuationService.previewCanvasPlanningSettlementContinuation(f.env,{...c.continuationInput,userId:f.foreign}),'canvas_agent_settlement_evidence_invalid');
        const proposal=await f.db.prepare('SELECT validation_json FROM canvas_agent_proposals WHERE step_id=?').bind(c.ids.stepId).first();
        const validation=JSON.parse(proposal.validation_json);validation.issues.push({...validation.issues[0],nodeKey:'another-node'});
        await f.db.prepare('UPDATE canvas_agent_proposals SET validation_json=? WHERE step_id=?').bind(JSON.stringify(validation),c.ids.stepId).run();
        await rejected(()=>c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input),'canvas_agent_settlement_continuation_issue_changed');
        equal(await c.run(),before,'Forged approval or changed validation does not release the hold');
    } else {
        let result;
        if(name==='continuation-crash'){
            const fault=failOnce(f.db,{afterBatch:async()=>Boolean(await f.db.prepare("SELECT id FROM canvas_agent_events WHERE run_id=? AND event_key LIKE 'settlement-plan-continuation:%'").bind(c.ids.runId).first())});
            await rejected(()=>c.continuationService.applyCanvasPlanningSettlementContinuation({...f.env,DB:fault.db},input),'synthetic-process-loss-after-commit');
            check(fault.fired&&(await c.run()).status==='planning','Response loss occurs after the atomic continuation was committed');
            result=await c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input);
        }else{
            const results=await Promise.all([c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input),c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input)]);
            check(results.every(value=>value.replay),'Concurrent duplicate requests observe the same committed continuation');result=results[0];
        }
        check(result.replay&&result.continuationStatus==='already_resumed','Committed continuation is replay-safe');
        await deliver(f.env,c.ids.runId);
        const applied=await c.run();check(applied.status==='running'&&applied.rounds===1,'Original stored plan applies to the ordinary graph after guarded continuation');
        const graph=await canvasAgentProject(f.env,f.owner,f.project),music=graph.nodes.find(node=>node.model_id==='elevenlabs/music-v2');
        check(graph.nodes.filter(node=>node.type==='video_generation').length===3&&music,'The retained plan creates ordinary video and music nodes once');
        check(!Object.hasOwn(JSON.parse(music.config_json),'originalAudio'),'Only the effective node loses the inert unsupported field');
        const proposal=await f.db.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(c.ids.stepId).first();
        equal(JSON.parse(proposal.plan_json),{...c.plan,updates:[]},'Raw stored proposal remains unchanged after continuation');
        equal(JSON.parse(proposal.validation_json).repairs,[inertMusicRepair],'Applied proposal retains the exact normalization evidence');
        const graphIds=graph.nodes.map(node=>node.id);await c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input);
        equal((await canvasAgentProject(f.env,f.owner,f.project)).nodes.map(node=>node.id),graphIds,'Replay after graph application cannot duplicate nodes');
        const cancelled=await f.request(`${f.route}/${c.ids.runId}/control`,'POST',{action:'cancel'},{'Idempotency-Key':'synthetic-stop-after-continuation'});
        check(cancelled.ok,'User retains ordinary stop control after continuation');
        const stopped=await c.run();await c.continuationService.applyCanvasPlanningSettlementContinuation(f.env,input);
        equal(await c.run(),stopped,'A later operator replay cannot undo the user cancellation');
        check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_events WHERE run_id=? AND event_key LIKE 'settlement-plan-continuation:%'").bind(c.ids.runId).first()).n===1,'One durable continuation event covers concurrent and interrupted delivery');
    }
    equal(await c.operation(),original,'Continuation preserves every byte of original provider evidence and failure history');
    equal(await f.db.prepare('SELECT * FROM canvas_agent_settlement_reviews WHERE operation_id=?').bind(c.ids.operationId).first(),historical,'Continuation never rewrites the original financial review');
    equal((await c.ledger()).map(row=>row.amount),[-94],'Continuation never repeats the original planning debit');
    check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(c.ids.runId).first()).n===1,'No new paid planning identity exists');
    check(f.unexpected.length===0,'No new reasoning, provider request or diagnostic generation is used');
    return {case:name,planningCalls:0,debits:1};
}

export async function canvasPlanningSettlementCase(base,name) {
    check(CANVAS_SETTLEMENT_CASES.includes(name),'Known settlement control');
    if(name.startsWith('inert-music-'))return inertMusicCase(base,name);
    if(name.startsWith('continuation'))return settledContinuationCase(base,name);
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
