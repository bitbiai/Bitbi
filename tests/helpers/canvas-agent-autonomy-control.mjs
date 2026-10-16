import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits, consumeMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { beginMemberAiUsageAttempt, markMemberAiUsageAttemptProviderRunning, markMemberAiUsageAttemptFinalizing,
    markMemberAiUsageAttemptSucceeded, markMemberAiUsageAttemptUnknown } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { canvasAgentEnvironment, canvasAgentUsageMetadata } from '../../workers/auth/src/lib/canvas-agent-authority.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { readCanvasAgentBudget, requestCanvasAgentBudget } from '../../workers/auth/src/lib/canvas-agent-budget.js';
import { canvasAgentModelOperationFixture } from './canvas-agent-model-operation-control.mjs';
import { freshCanvasAgentPlan } from './canvas-agent-control.mjs';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
const equal=(actual,expected,message)=>check(JSON.stringify(actual)===JSON.stringify(expected),message);
async function rejected(operation,code) {
    try {await operation();} catch(error) {
        check([error,error?.cause,error?.cause?.cause].some(item=>[item?.code,item?.message].some(value=>String(value||'').split(/[^a-z0-9_]+/i).includes(code))),`Expected ${code}`);
        return;
    }
    throw new Error(`Missing rejection ${code}`);
}
const runOf=f=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
const nodesOf=async f=>(await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n;
const debitsOf=async f=>(await f.db.prepare('SELECT COALESCE(SUM(-amount),0) AS amount FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).amount;

// A real Worker fixture without filesystem or Node dependencies. Both SQLite
// and native D1 callers use the same account, credit gateway and route checks.
async function budgetFixture(base,scope,locale='en') {
    const db=base.DB,owner=`autonomy-${scope}`,foreign=`autonomy-other-${scope}`,project=(await sha256Hex(owner)).slice(0,32);
    const messages=[],unexpected=[],waits=[],now=new Date().toISOString();let sequence=0;
    const env={...base,CANVAS_AGENT_ENABLED:'true',ENABLE_GROK_4_7:'true',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
        H3_CLOUDFLARE_API_TOKEN:'synthetic-autonomy-workers-ai',AI_SERVICE_AUTH_SECRET:'synthetic-autonomy-service-secret',
        AI_VIDEO_JOBS_QUEUE:{async send(body){messages.push(body);}},
        PRIVATE_MEDIA_PROCESSOR:{async fetch(){unexpected.push('processor');throw new Error('No processing before a production is authorized');}},
    };
    env.AI_LAB={fetch:request=>aiWorker.fetch(request,{ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:env.AI_SERVICE_AUTH_SECRET,
        SERVICE_AUTH_REPLAY:env.SERVICE_AUTH_REPLAY||env.PUBLIC_RATE_LIMITER,
        AI:{run(){unexpected.push('AI.run');throw new Error('Budget decisions cannot perform inference');}}},{waitUntil(){throw new Error('Unexpected detached AI work');}})};
    env.__TEST_FETCH=async()=>{unexpected.push('external');throw new Error('Unexpected external provider request');};
    for(const id of [owner,foreign]) {
        await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)")
            .bind(id,id+'@example.invalid','synthetic',now,now).run();
        await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
            .bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
    }
    await topUpMemberDailyCredits({env,userId:owner});
    await grantMemberCredits({env,userId:owner,amount:10000,createdByUserId:owner,idempotencyKey:owner+'-credits'});
    await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Autonomy credit control','en',?,?)").bind(project,owner,now,now).run();
    const tariff=(await getModelTariff(env)).revision,route=`/api/account/canvas/projects/${project}/agent`;
    const request=async(path,method='GET',body,headers={})=>{
        const response=await worker.fetch(new Request(new URL(path,'https://bitbi.ai'),{method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${owner}`,
            'Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${++sequence}`,'X-Bitbi-Tariff-Revision':String(tariff),...headers},
            ...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil(promise){waits.push(promise);}});
        await Promise.all(waits.splice(0));return response;
    };
    const createRun=async(key,cap=500,projectId=project)=>{
        const id=(await sha256Hex(`${owner}:${key}`)).slice(0,32),revision=(await db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(projectId).first()).revision;
        await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,tariff_revision,
            lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'planning',?,?,?,?,?,?,?,?,?)`)
            .bind(id,projectId,owner,key,JSON.stringify({brief:'Build a house with a neighboring duck pool.',locale}),revision,cap,tariff,'lease-'+id,
                new Date(Date.now()+600000).toISOString(),now,now,now,new Date(Date.now()+3600000).toISOString()).run();
        return db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first();
    };
    const allocate=async(run,key,credits)=>{
        const id=(await sha256Hex(`${run.id}:${key}`)).slice(0,32);
        await db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
            VALUES(?,?,?,'plan',?,?,?,?)`).bind(id,run.id,key,JSON.stringify({modelId:'xai/grok-4.7'}),credits,now,now).run();
        return db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(id).first();
    };
    const reserve=async(run,step)=>{
        const scoped=canvasAgentEnvironment(env,{runId:run.id,stepId:step.id,projectId:run.project_id,userId:owner,leaseToken:run.lease_token});
        const path=`/api/account/canvas/projects/${run.project_id}/agent`,request=new Request('https://bitbi.ai'+path);
        const metadata=await canvasAgentUsageMetadata(scoped,request,{userId:owner,modelId:'xai/grok-4.7',credits:step.allocation_credits});
        const args={env:scoped,userId:owner,featureKey:'ai.text.generate',operationKey:'member.text.generate',route:path,idempotencyKey:`autonomy-${step.id}`,
            requestFingerprint:await sha256Hex(step.id),creditCost:step.allocation_credits,metadata};
        const result=await beginMemberAiUsageAttempt(args);
        await db.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=? WHERE id=?').bind(result.attempt.id,step.id).run();
        return {scoped,args,metadata,attempt:result.attempt};
    };
    return {db,env,owner,foreign,project,projectPath:`/api/account/canvas/projects/${project}`,route,tariff,messages,unexpected,request,createRun,allocate,reserve};
}
export {budgetFixture as canvasAgentBudgetFixture};

async function charge(f,run,step,credits,onDebit=()=>{}) {
    const reserved=await f.reserve(run,step),token=await markMemberAiUsageAttemptProviderRunning(reserved.scoped,reserved.attempt.id);
    await markMemberAiUsageAttemptFinalizing(reserved.scoped,reserved.attempt.id,{dispatchToken:token});
    const result=await consumeMemberCredits({env:reserved.scoped,userId:f.owner,featureKey:'ai.text.generate',credits,idempotencyKey:reserved.args.idempotencyKey,
        requestFingerprint:reserved.args.requestFingerprint,aiDispatchToken:token,source:'canvas_agent_plan'});
    await onDebit();
    await markMemberAiUsageAttemptSucceeded(reserved.scoped,reserved.attempt.id,{dispatchToken:token,model:'xai/grok-4.7',resultStatus:'stored',
        balanceAfter:result.creditBalance,metadata:reserved.metadata});
    await f.db.prepare("UPDATE canvas_agent_steps SET status='completed' WHERE id=?").bind(step.id).run();
    return reserved;
}

async function ledgerCase(base) {
    const f=await budgetFixture(base,'ledger'),first=await f.createRun('first',500),step=await f.allocate(first,'plan',127);
    const reserved=await f.reserve(first,step);
    check((await beginMemberAiUsageAttempt(reserved.args)).attempt.id===reserved.attempt.id,'Identical reservation reuses one real attempt');
    let budget=await readCanvasAgentBudget(f.env,first);
    check(budget.allocatedCredits===127&&budget.reservedCredits===127&&budget.committedCredits===127&&budget.chargedCredits===0,'Allocation and wallet reservation count once before dispatch');
    await charge(f,first,step,78,async()=>{
        const during=await readCanvasAgentBudget(f.env,first);
        check(during.chargedCredits===78&&during.reservedCredits===127&&during.committedCredits===127,'A ledger debit during finalization is not added to its reservation');
    });
    budget=await readCanvasAgentBudget(f.env,first);
    check(budget.chargedCredits===78&&budget.reservedCredits===0&&budget.committedCredits===78&&budget.allocatedCredits===127,'Finalized cost comes from actual ledger78, not ceiling127');
    await f.db.prepare("UPDATE canvas_agent_runs SET status='taken_over',lease_token=NULL,lease_until=NULL WHERE id=?").bind(first.id).run();
    const second=await f.createRun('second',300),pending=await f.allocate(second,'uncertain',127),unknown=await f.reserve(second,pending);
    const token=await markMemberAiUsageAttemptProviderRunning(unknown.scoped,unknown.attempt.id);
    await markMemberAiUsageAttemptUnknown(unknown.scoped,unknown.attempt.id,{dispatchToken:token});
    budget=await readCanvasAgentBudget(f.env,second);
    check(budget.chargedCredits===78&&budget.pendingOutcomeCredits===127&&budget.reservedCredits===127&&budget.committedCredits===205&&budget.remainingCredits===95,'Same project retains stopped-run charge and unknown full ceiling');
    const other=(await sha256Hex('unrelated-autonomy-ledger-project')).slice(0,32),now=new Date().toISOString();
    await f.db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Other project','en',?,?)").bind(other,f.owner,now,now).run();
    await f.allocate(await f.createRun('other',500,other),'unrelated',90);
    check((await readCanvasAgentBudget(f.env,second)).committedCredits===205,'Other project allocations do not consume this project ceiling');
    const parallel=await Promise.allSettled([f.allocate(second,'parallel-one',60),f.allocate(second,'parallel-two',60)]);
    check(parallel.filter(r=>r.status==='fulfilled').length===1,'Atomic D1 admission allows exactly one of two competing60 allocations under95 headroom');
    check(parallel.filter(r=>r.status==='rejected').every(r=>String(r.reason).includes('canvas_agent_budget_exceeded')),'Rejected parallel allocation fails the real budget trigger');
    budget=await readCanvasAgentBudget(f.env,second);
    check(budget.committedCredits===265&&budget.remainingCredits===35&&budget.chargedCredits===78,'No allocation becomes another wallet debit');
    await rejected(()=>f.allocate(second,'over-cap',36),'canvas_agent_budget_exceeded');
    check(await debitsOf(f)===78&&f.unexpected.length===0,'Only the original78 credits were settled, with no provider call');
    return {case:'ledger',chargedCredits:78,originalCeiling:127,heldCredits:127,parallelAdmissions:1};
}

async function amendmentCase(base,name) {
    const f=await budgetFixture(base,name),run=await f.createRun('budget',200);await f.allocate(run,'existing',150);
    const ask=()=>requestCanvasAgentBudget(f.env,run,{requiredCredits:100,reasonKey:'media_cost',reasonCode:'canvas_agent_budget_exceeded',model:'minimax/h3',action:'media.generate'});
    const amendment=await ask(),endpoint=`${f.route}/${run.id}/budget`;
    const body={requestId:amendment.id,requestRevision:0,decision:name==='decline'?'decline':'accept',proposedCapCredits:250,expectedRevision:run.expected_revision};
    const post=(value=body,key='autonomy-budget-decision',headers={})=>f.request(endpoint,'POST',value,{'Idempotency-Key':key,...headers});
    const initial=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(run.id).first();
    check(initial.status==='paused'&&initial.budget_credits===200,'Proposal pauses before any additional spending');
    const visible=await (await f.request(f.route)).json();
    check(visible.data.run.budgetRequest.proposedCapCredits===250&&visible.data.run.budgetRequest.additionalCredits===50,'Displayed exact ceiling and extra authorization are distinct from required100 action cost');
    check((await post(body,'foreign-budget-decision',{Cookie:`__Host-bitbi_session=${f.foreign}`})).status===404,'Another member cannot approve this project');
    for(const changed of [{...body,proposedCapCredits:251},{...body,requestRevision:1},{...body,expectedRevision:run.expected_revision+1}])
        check((await post(changed,'changed-budget-decision')).status===409,'A changed proposal or revision cannot broaden consent');
    await rejected(()=>f.db.prepare('UPDATE canvas_agent_runs SET budget_credits=251,budget_revision=1 WHERE id=?').bind(run.id).run(),'canvas_agent_budget_consent_required');
    if(name==='stale') {
        check((await post(body,'stale-tariff',{'X-Bitbi-Tariff-Revision':String(f.tariff+1)})).status===409,'Stale tariff cannot approve an old price');
        await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
        check((await post()).status===409,'A newer manual project revision invalidates the pending request');
        const staleView=await (await f.request(f.route)).json();
        check(staleView.data.run.budgetRequest===null,'A stale manual revision is no longer presented as an actionable budget decision');
        check((await f.db.prepare('SELECT status FROM canvas_agent_budget_requests WHERE id=?').bind(amendment.id).first()).status==='pending','Read-only observation preserves the historical undecided request without manufacturing a decision');
        check((await f.db.prepare('SELECT budget_credits FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).budget_credits===200,'Stale consent leaves the previous cap unchanged');
    } else {
        const accepted=await post(),value=await accepted.json();check(accepted.status===200,'Exact displayed budget decision succeeds');
        check(value.data.run.budgetCredits===(name==='accept'?250:200),'Only acceptance changes the exact cap');
        const replay=await post();check(replay.status===200&&(await replay.json()).data.idempotentReplay===true,'Identical repeated decision is read-only replay');
        check((await post({...body,decision:name==='accept'?'decline':'accept'})).status===409,'Conflicting repeated decision cannot change consent');
        check((await post(body,'different-decision-key')).status===409,'A different idempotency identity cannot reuse a closed decision');
        check(f.messages.length===1,'One decision queues one continuation');
        if(name==='decline')await rejected(ask,'canvas_agent_budget_declined');
        const stored=await f.db.prepare('SELECT status,decision_key FROM canvas_agent_budget_requests WHERE id=?').bind(amendment.id).first();
        check(stored.status===(name==='accept'?'accepted':'declined'),'The decision is persistently bound to its exact request');
    }
    check(await debitsOf(f)===0&&f.unexpected.length===0,'Approving a cap is not a generation or wallet charge');
    return {case:name,capCredits:name==='accept'?250:200,noPaidDispatch:true};
}

async function budgetStopCase(base) {
    for(const action of ['cancel','takeover']) {
        const f=await budgetFixture(base,'budget-'+action),run=await f.createRun('budget',200);
        await f.allocate(run,'existing',150);
        const amendment=await requestCanvasAgentBudget(f.env,run,{requiredCredits:100,reasonKey:'media_cost',reasonCode:'canvas_agent_budget_exceeded',model:'minimax/h3',action:'media.generate'});
        check((await (await f.request(f.route)).json()).data.run.budgetRequest?.id===amendment.id,'A pending budget request is genuinely visible before the stop');
        const response=await f.request(`${f.route}/${run.id}/control`,'POST',{action},{'Idempotency-Key':'autonomy-budget-'+action});
        check(response.status===200,'The normal stop control succeeds while budget approval is pending');
        const after=await response.json(),expected=action==='cancel'?'cancelled':'taken_over';
        check(after.data.run.status===expected&&after.data.run.budgetRequest===null,'Stopping removes the actionable budget request from the response');
        const stored=await f.db.prepare('SELECT * FROM canvas_agent_budget_requests WHERE id=?').bind(amendment.id).first();
        check(stored.status==='stale'&&stored.proposed_cap===250&&stored.current_cap===200,'Stopping retains the exact unaccepted proposal as stale evidence');
        const decision={requestId:amendment.id,requestRevision:0,decision:'accept',proposedCapCredits:250,expectedRevision:run.expected_revision};
        check((await f.request(`${f.route}/${run.id}/budget`,'POST',decision,{'Idempotency-Key':'autonomy-after-stop'})).status===409,'A previously displayed pending request cannot resume a stopped run');
        const reopened=await (await f.request(f.route)).json();
        check(reopened.data.run.status===expected&&reopened.data.run.budgetCredits===200&&reopened.data.run.budgetRequest===null,'Reopening preserves the stopped state and original ceiling');
        check(f.messages.length===0&&f.unexpected.length===0&&await debitsOf(f)===0,'Stopped budget decisions do not queue work, call providers or debit credits');
    }
    return {case:'budget-stop',staleRequests:2,noPaidDispatch:true};
}

async function lostLeaseCase(base) {
    const f=await budgetFixture(base,'lost-lease'),run=await f.createRun('active',500);
    await f.allocate(run,'plan',127);
    await f.db.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL WHERE id=?').bind(run.id).run();
    const original=f.env.AI_LAB.fetch;let takeovers=0,acknowledged=0;
    f.env.AI_LAB.fetch=async request=>{
        if(new URL(request.url).pathname==='/internal/ai/canvas-agent/readiness'&&takeovers===0) {
            const claimed=await f.db.prepare('SELECT lease_token,lease_until FROM canvas_agent_runs WHERE id=?').bind(run.id).first();
            check(claimed.lease_token&&claimed.lease_until>new Date().toISOString(),'The queue acquired a real current lease before the controlled revocation');
            takeovers++;
            const response=await f.request(`${f.route}/${run.id}/control`,'POST',{action:'takeover'},{'Idempotency-Key':'autonomy-during-lease'});
            check(response.status===200,'Manual takeover reaches the actual control route during the old claimant readiness check');
        }
        return original(request);
    };
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:{type:'canvas_agent.process',run_id:run.id},attempts:1,
        ack(){acknowledged++;},retry(){throw new Error('The stale claimant must finish without retrying paid work');}}]},f.env,{waitUntil(){throw new Error('No detached claimant work');}});
    const events=(await f.db.prepare('SELECT type,payload_json FROM canvas_agent_events WHERE run_id=? ORDER BY id').bind(run.id).all()).results;
    const view=await (await f.request(f.route)).json();
    check(takeovers===1&&acknowledged===1,'The controlled race genuinely revokes one claimed queue delivery');
    check(view.data.run.status==='taken_over'&&view.data.run.currentAction.code==='taken_over','The stale claimant cannot replace the current manual-takeover action');
    check(events.length===1&&events[0].type==='action'&&JSON.parse(events[0].payload_json).code==='taken_over','A lost lease cannot append a false terminal error after takeover');
    check(f.unexpected.length===0&&f.messages.length===0&&await debitsOf(f)===0,'The lost lease cannot dispatch, requeue or charge');
    return {case:'lost-lease',takeovers:1,staleErrors:0};
}

// UI and backend share the same real start, signed AI preparation, callback,
// queue and read API. Only the external model response is controlled. The old
// fixture's unstarted run is explicitly taken over before a new approved cap.
export async function canvasAgentAutonomyFixture(base,{scope='autonomy-flow',budgetCredits=10000,plan=freshCanvasAgentPlan(),locale='en'}={}) {
    const initial=await canvasAgentModelOperationFixture(base,{scope});
    check((await initial.request(`${initial.route}/${initial.runId}/control`,'POST',{action:'takeover'},{'Idempotency-Key':scope+'-replace-unstarted'})).ok,'Close only the fixture initial unstarted run');
    const input={brief:'Build a small-town house next to a pool with ducks, then celebrate.',expectedRevision:0,budgetCredits,locale};
    const started=await initial.data(await initial.request(initial.route,'POST',input,{'Idempotency-Key':scope+'-autonomous-start'}));
    const runId=started.run.id;
    const deliver=async({duplicates=2}={})=>{
        const row=await initial.db.prepare('SELECT next_attempt_at FROM canvas_agent_runs WHERE id=?').bind(runId).first();
        const now=await initial.atClock(()=>Date.now());initial.advance(Math.max(0,(Date.parse(row.next_attempt_at)||now)-now));
        await initial.atClock(async()=>{
            let acknowledged=0;
            await worker.queue({queue:'bitbi-ai-video-jobs',messages:Array.from({length:duplicates},()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,
                ack(){acknowledged++;},retry(){throw new Error('Autonomy queue delivery must be acknowledged');}}))},initial.env,{waitUntil(){throw new Error('Background production cannot depend on a detached browser request');}});
            check(acknowledged===duplicates,'Duplicate queue deliveries are acknowledged');
        });
        return initial.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    };
    const complete=async(value=plan)=>{
        const call=initial.calls.at(-1);check(call,'Complete only an actually dispatched operation');
        return initial.request(call.body.options.webhookUrl,'POST',{id:call.id,state:'Completed',provider:'xai',model:'xai/grok-4.7',
            result:{id:`synthetic-${scope}-completion-${initial.calls.length}`,object:'chat.completion',model:'grok-4.7',
                choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value),reasoning_content:'Keep the same house and neighboring duck pool across the shots.'}}],
                usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}});
    };
    return {...initial,runId,input,deliver,complete,plan,
        operation:()=>initial.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=? ORDER BY rowid DESC LIMIT 1').bind(runId).first()};
}

function incompatiblePlan() {
    const plan=freshCanvasAgentPlan();
    const image=key=>({key,type:'image_generation',title:'House reference',modelId:'openai/gpt-image-2',prompt:'The same house next to its duck pool.',config:{},dependencies:[]});
    plan.nodes=[image('first'),image('reference'),{...plan.nodes[0],key:'shot',config:{duration:4,resolution:'768P',aspectRatio:'16:9'},
        dependencies:[{key:'first',role:'first_frame'},{key:'reference',role:'reference_image'}]}];
    plan.assembly={...plan.assembly,targetDurationSeconds:4,clips:[{key:'shot',trim:{start:0,duration:4},transition:{preset:'none'}}]};
    return plan;
}

async function proposalCase(base,name) {
    const plan=incompatiblePlan(),f=await canvasAgentAutonomyFixture(base,{scope:'autonomy-'+name,plan});
    await f.deliver();check(f.calls.length===1&&await nodesOf(f)===0,'Only the first paid planning dispatch exists');
    const paidInput=JSON.parse(f.calls[0].body.input.messages[1].content);
    check(paidInput.durationMode==='creative'&&paidInput.targetDurationSeconds===null&&paidInput.budget.capCredits===10000,'Actual outgoing provider request carries automatic duration and authorized budget');
    check((await f.complete()).status===200,'Signed original result is retained');
    let view=await f.observe();
    check(view.proposedPlan?.shots.length===1&&view.proposedPlan.nodes.length===3,'The returned plan is visible before graph preflight can succeed');
    const original=await f.db.prepare('SELECT * FROM canvas_agent_proposals WHERE run_id=?').bind(f.runId).first();
    check(await debitsOf(f)>0&&f.calls.length===1,'One original planning result settled without another dispatch');
    if(name==='stopped') {
        await f.db.prepare("UPDATE canvas_agent_runs SET error_code='canvas_agent_h3_reference_modes_mixed',cause_json=? WHERE id=?")
            .bind(JSON.stringify({code:'canvas_agent_h3_reference_modes_mixed',step:'validating',recovery:'automatic'}),f.runId).run();
        const before=await debitsOf(f);
        check((await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'takeover'},{'Idempotency-Key':'autonomy-preserve-takeover'})).status===200,'Explicit manual takeover closes creative authority');
        await f.deliver();view=await f.observe();
        check(view.status==='taken_over'&&view.cause.code==='canvas_agent_h3_reference_modes_mixed'&&view.proposedPlan.nodes.length===3,'Takeover preserves cause and completed paid storyboard');
        check(f.calls.length===1&&await nodesOf(f)===0&&await debitsOf(f)===before,'Observation and duplicate wake cannot resurrect a stopped production');
    } else {
        await f.deliver();view=await f.observe();
        check(view.proposedPlan.validation.issues.some(issue=>issue.code==='canvas_agent_h3_reference_modes_mixed'),'Actual incompatible H3 reference modes produce precise retained feedback');
        check(await nodesOf(f)===0&&f.calls.length===1,'Invalid plan is not applied and does not dispatch media');
        const repair=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid DESC LIMIT 1").bind(f.runId).first();
        const input=JSON.parse(repair.input_json).payload;
        check(input.repair.attempt===1&&input.repair.issues.some(issue=>issue.code==='canvas_agent_h3_reference_modes_mixed'),'A separately allocated bounded repair receives exact actionable issues');
        equal(input.repair.previousPlan,{...plan,updates:plan.updates||[]},'The repair retains the paid original plan, including both creative references');
        check(input.budget.chargedCredits>0&&input.budget.remainingCredits<10000,'Repair sees already committed project spending');
    }
    equal((await f.db.prepare('SELECT plan_json FROM canvas_agent_proposals WHERE step_id=?').bind(original.step_id).first()).plan_json,original.plan_json,'The retained raw proposal is immutable');
    await rejected(()=>f.db.prepare("UPDATE canvas_agent_proposals SET plan_json='{}' WHERE step_id=?").bind(original.step_id).run(),'canvas_agent_proposal_immutable');
    return {case:name,providerCalls:1,proposalRetained:true,mediaCalls:0};
}

async function missingPlanCase(base) {
    const f=await canvasAgentAutonomyFixture(base,{scope:'autonomy-missing-plan'});
    await f.deliver();check((await f.complete()).status===200,'Known valid completed operation calibrates missing-plan control');
    await f.observe();const op=await f.operation();
    check(op.state==='completed','The underlying model operation genuinely completed');
    const step=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(op.step_id).first(),receipt=JSON.parse(step.receipt_json);
    check(step.status==='completed'&&receipt.plan,'A real normalized plan exists before the deliberate stored-projection fault');
    delete receipt.plan;
    await f.db.prepare('UPDATE canvas_agent_steps SET receipt_json=? WHERE id=?').bind(JSON.stringify(receipt),step.id).run();
    await f.deliver();const view=await f.observe();
    check(view.status==='blocked'&&view.errorCode==='canvas_agent_completed_plan_missing','Missing completed plan is a specific terminal invariant, not waiting forever');
    const errors=(await f.db.prepare("SELECT payload_json FROM canvas_agent_events WHERE run_id=? AND type='error'").bind(f.runId).all()).results;
    check(errors.length===1&&JSON.parse(errors[0].payload_json).code==='canvas_agent_completed_plan_missing','A still-authorized genuine failure emits its error event; the lost-lease guard does not suppress all errors');
    check(view.proposedPlan&&await nodesOf(f)===0&&f.calls.length===1,'Existing proposal survives the fault without paid replay or graph mutation');
    return {case:'missing-plan',providerCalls:1,explicitInvariant:true};
}

async function lateProposalCase(base) {
    const f=await canvasAgentAutonomyFixture(base,{scope:'autonomy-late-proposal'});
    await f.deliver();
    check(f.calls.length===1&&(await f.operation()).state==='pending','One actual background request is accepted before the user takes over');
    const pending=await f.observe();
    check(pending.proposedPlan===null&&await debitsOf(f)===0,'No proposal or settled charge is fabricated before the provider completes');
    const stopped=await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'takeover'},{'Idempotency-Key':'autonomy-before-late-result'});
    check(stopped.status===200,'Manual takeover succeeds before the accepted provider result arrives');
    const stopView=await stopped.json();
    check(stopView.data.run.status==='taken_over'&&stopView.data.run.currentAction.code==='taken_over','The real takeover action is visible before the late callback');
    check((await f.complete()).status===200,'The original signed late callback is retained after takeover');
    const view=await f.observe(),charged=await debitsOf(f);
    check((await f.operation()).state==='completed'&&view.proposedPlan?.nodes.length===f.plan.nodes.length&&charged>0,'Late completion genuinely settles the accepted operation and exposes its paid plan');
    const events=(await f.db.prepare('SELECT id,type,payload_json FROM canvas_agent_events WHERE run_id=? ORDER BY id').bind(f.runId).all()).results;
    const takeover=events.find(event=>JSON.parse(event.payload_json).code==='taken_over');
    const proposed=events.find(event=>JSON.parse(event.payload_json).code==='proposed');
    check(takeover&&proposed&&proposed.id>takeover.id,'The countercontrol includes a real later proposal event rather than suppressing late-result history');
    check(view.status==='taken_over'&&view.currentAction.code==='taken_over','Late retained history cannot replace the current stopped action with proposed production');
    await f.deliver();const reopened=await f.observe();
    check(reopened.status==='taken_over'&&reopened.currentAction.code==='taken_over'&&reopened.proposedPlan.revision===view.proposedPlan.revision,'Reopening and duplicate queue wake preserve the manual state and saved proposal');
    check(f.calls.length===1&&await nodesOf(f)===0&&await debitsOf(f)===charged,'Late-result observation does not replan, generate media or charge the original operation again');
    return {case:'late-proposal',providerCalls:1,proposalRetained:true,currentAction:'taken_over'};
}

async function summaryCase(base) {
    for(const protocol of [1,2]) {
        const f=await canvasAgentAutonomyFixture(base,{scope:'autonomy-summary-'+protocol});
        await f.deliver();const before=await f.operation();
        check(before.receipt_protocol===2,'New durable operations explicitly use summary-capable canonical receipts');
        if(protocol===1) {
            // Restore the exact pre-upgrade row shape before its first callback.
            // This is historical input, not a production protocol mutation.
            await f.db.prepare('DELETE FROM canvas_agent_model_operations WHERE id=?').bind(before.id).run();
            const historical={...before,receipt_protocol:1},keys=Object.keys(historical);
            await f.db.prepare(`INSERT INTO canvas_agent_model_operations(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>historical[key])).run();
        }
        await rejected(()=>f.db.prepare('UPDATE canvas_agent_model_operations SET receipt_protocol=? WHERE id=?').bind(protocol===1?2:1,before.id).run(),'canvas_agent_model_identity_immutable');
        check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_events WHERE run_id=? AND type='provider_summary'").bind(f.runId).first()).n===0,'There is no fabricated provider summary before completion');
        const call=f.calls[0],response={id:'summary-result',object:'chat.completion',model:'grok-4.7',
            choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(f.plan),reasoning_content:'Maintain consistent house geometry.',reasoning:'hidden-private',encrypted_content:'encrypted-private'}}],
            usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}};
        const callback={id:call.id,state:'Completed',provider:'xai',model:'xai/grok-4.7',result:response};
        check((await f.request(call.body.options.webhookUrl,'POST',callback)).status===200,'Actual authenticated completion is accepted');
        await f.observe();const settled=await f.operation(),stored=settled.response_json;
        check(!/hidden-private|encrypted-private/.test(stored),'Raw hidden and encrypted fields never enter stored canonical receipts');
        const events=(await f.db.prepare("SELECT payload_json FROM canvas_agent_events WHERE run_id=? AND type='provider_summary'").bind(f.runId).all()).results;
        if(protocol===1) {
            check(!stored.includes('reasoning_content')&&events.length===0,'Old receipt canonicalization remains unchanged after deployment');
            response.choices[0].message.reasoning_content='A summary absent from the historically stored receipt.';
        } else {
            check(stored.includes('Maintain consistent house geometry.')&&events.length===1,'New receipts retain one documented completed provider summary');
            const event=JSON.parse(events[0].payload_json);
            check(event.text==='Maintain consistent house geometry.'&&event.source==='provider'&&event.delivery==='completed','Persisted summary carries honest terminal delivery and provenance');
        }
        const debit=await debitsOf(f);
        check((await f.request(call.body.options.webhookUrl,'POST',callback)).status===200,'Original callback replay remains valid under its immutable protocol');
        await f.observe();
        check((await f.operation()).response_json===stored&&await debitsOf(f)===debit&&f.calls.length===1,'Duplicate event cannot rewrite receipt, charge or submit again');
    }
    return {case:'summary',providerCalls:2,legacyCanonicalPreserved:true,completedSummaryEvents:1};
}

export const CANVAS_AGENT_AUTONOMY_CASES=['ledger','accept','decline','stale','budget-stop','lost-lease','proposal','stopped','missing-plan','late-proposal','summary'];
export async function canvasAgentAutonomyCase(base,name) {
    if(name==='ledger')return ledgerCase(base);
    if(['accept','decline','stale'].includes(name))return amendmentCase(base,name);
    if(name==='budget-stop')return budgetStopCase(base);
    if(name==='lost-lease')return lostLeaseCase(base);
    if(['proposal','stopped'].includes(name))return proposalCase(base,name);
    if(name==='missing-plan')return missingPlanCase(base);
    if(name==='late-proposal')return lateProposalCase(base);
    if(name==='summary')return summaryCase(base);
    throw new Error('Unknown Canvas autonomy control');
}

// Seed the pre-0107 historical shape through the actual charge gateway. The
// caller applies only the new forward migration, then compares retained data.
export async function seedCanvasAgentStoppedMigration(base) {
    const f=await budgetFixture(base,'migration'),run=await f.createRun('stopped',3000),step=await f.allocate(run,'plan',127);
    await charge(f,run,step,78);
    const receipt={ok:true,plan:incompatiblePlan(),model:'xai/grok-4.7',outcome:'completed'};
    await f.db.prepare('UPDATE canvas_agent_steps SET receipt_json=? WHERE id=?').bind(JSON.stringify(receipt),step.id).run();
    await f.db.prepare("UPDATE canvas_agent_runs SET status='taken_over',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=?").bind(run.id).run();
    return {...f,runId:run.id,stepId:step.id,receipt,before:await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(run.id).first()};
}
