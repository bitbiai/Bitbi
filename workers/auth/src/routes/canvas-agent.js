import { readCanvasMediaPolicy, restrictCanvasMediaInventory, canvasMediaResumeStatements } from '../lib/canvas-agent-media-policy.js';
import { normalizeCanvasAgentStart, CANVAS_AGENT_MODEL, CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { stablePricingJson,TARIFF_HEADER } from '../../../../js/shared/model-tariff.mjs';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse,BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { nowIso,randomTokenHex,sha256Hex } from '../lib/tokens.js';
import { canvasAgentAvailability,canvasAgentCapabilities } from '../lib/canvas-agent-capabilities.js';
import { budgetCanvasAgentPlan } from '../lib/canvas-agent-planning.js';
import { publicAgentRun,wakeCanvasAgent,agentFail,releaseCanvasAgentUndispatched,publicCanvasAgentModelOperation,canvasAgentAllowedActions } from '../lib/canvas-agent-store.js';
import { readCanvasAgentEvents,appendCanvasAgentEvent,canvasAgentEventStream } from '../lib/canvas-agent-progress.js';

const respond=(data,status=200)=>json({ok:true,data},{status,headers:{'Cache-Control':'no-store'}});
const keyFor=request=>{const key=request.headers.get('Idempotency-Key');if(!/^[A-Za-z0-9._:-]{8,100}$/.test(key||''))agentFail('idempotency_key_required',428);return key;};
export async function canvasAgentProject(env,userId,projectId) {
    const project=await env.DB.prepare('SELECT * FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(projectId,userId).first();
    if(!project)agentFail('project_not_found',404);
    const nodes=(await env.DB.prepare('SELECT * FROM canvas_nodes WHERE project_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at,id').bind(projectId,userId).all()).results;
    const edges=(await env.DB.prepare('SELECT * FROM canvas_edges WHERE project_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at,id').bind(projectId,userId).all()).results;
    return {project,nodes,edges};
}
export function plannerProject(view) {
    return {id:view.project.id,title:view.project.title,assembly:JSON.parse(view.project.assembly_json||'null'),
        nodes:view.nodes.map(n=>({id:n.id,type:n.type,title:n.title,modelId:n.model_id,config:JSON.parse(n.config_json),content:JSON.parse(n.content_json),
            output:n.output_json?((o)=>({kind:o.kind,assetId:o.assetId||o.asset?.id,sourceVersion:o.sourceVersion,runId:o.runId}))(JSON.parse(n.output_json)):null})),
        edges:view.edges.map(e=>({id:e.id,sourceNodeId:e.source_node_id,targetNodeId:e.target_node_id,config:JSON.parse(e.config_json)}))};
}
export async function startCanvasAgent(ctx,session,projectId,{briefRevision=null,assistantModelId=null,assistantModelRevision=null,guard=[],afterStart=()=>[]}={}) {
    const {env,request}=ctx,userId=session.user.id,key=keyFor(request);
    const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    const previous=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE user_id=? AND request_key=?').bind(userId,key).first();
    if(previous){
        if(previous.project_id!==projectId||stablePricingJson(JSON.parse(previous.input_json))!==stablePricingJson(parsed.body))agentFail('idempotency_conflict');
        return respond({run:await publicAgentRun(env,previous),idempotentReplay:true});
    }
    const view=await canvasAgentProject(env,userId,projectId);
    const input=normalizeCanvasAgentStart(parsed.body);
    if(input.expectedRevision!==view.project.revision)agentFail('canvas_agent_project_changed');
    const mediaPolicy=await readCanvasMediaPolicy(env,projectId,userId);
    if(input.mediaPolicyRevision!==mediaPolicy.revision)agentFail('canvas_agent_media_policy_changed');
    const conversation=await env.DB.prepare('SELECT assistant_model_id,assistant_model_revision FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(projectId,userId).first();
    const modelId=canvasAssistantModelId(assistantModelId??conversation?.assistant_model_id);
    const modelRevision=assistantModelRevision??conversation?.assistant_model_revision??0;
    if(!Number.isSafeInteger(modelRevision)||modelRevision!==(conversation?.assistant_model_revision??0)||modelId!==(conversation?.assistant_model_id??CANVAS_AGENT_MODEL))agentFail('canvas_agent_model_changed');
    const availability=await canvasAgentAvailability(env,{modelId});
    const id=randomTokenHex(16),now=nowIso(),expires=new Date(Date.now()+48*60*60000).toISOString();
    const statements=[...guard,env.DB.prepare(`SELECT CASE WHEN
        (?=0 AND NOT EXISTS(SELECT 1 FROM canvas_agent_conversations WHERE project_id=?))
        OR EXISTS(SELECT 1 FROM canvas_agent_conversations WHERE project_id=? AND user_id=? AND assistant_model_id=? AND assistant_model_revision=?)
        THEN 1 ELSE json_extract('[]','$[') END`).bind(conversation?1:0,projectId,projectId,userId,modelId,modelRevision)];
    let inventory=null,planStep=null;
    if(input.duration){
        if(!availability.available)agentFail(availability.code,503);
        inventory=await restrictCanvasMediaInventory(env,projectId,await canvasAgentCapabilities(env),userId);
        // A refreshed tariff is a new user decision, never a hidden higher cap.
        if(inventory.tariffRevision>0&&request.headers.get(TARIFF_HEADER)!==String(inventory.tariffRevision))agentFail('model_pricing_stale');
        const payload={version:1,model:modelId,requestId:id,brief:input.brief,...input.duration,
            toleranceSeconds:CANVAS_AGENT_LIMITS.toleranceSeconds,capabilityRevision:inventory.revision,capabilities:inventory,
            projectRevision:view.project.revision,currentProject:plannerProject(view),
            privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${userId}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${userId}:${projectId}`)}`};
        delete payload.durationChoice;
        const quote=await budgetCanvasAgentPlan(env,{project_id:projectId,model_id:modelId,budget_credits:input.budgetCredits,budget_revision:0},payload);
        if(quote.credits>quote.budget.remainingCredits)agentFail('canvas_agent_budget_exceeded');
        planStep={id:randomTokenHex(16),input:{modelId,payload:quote.payload},credits:quote.credits};
    }
    const insertIndex=statements.length;
    statements.push(env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,target_seconds,budget_credits,tariff_revision,capability_revision,next_attempt_at,created_at,updated_at,expires_at,brief_revision,policy_json,model_id,model_revision,media_policy_revision)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL)`)
        .bind(id,projectId,userId,key,stablePricingJson(parsed.body),input.duration?'queued':'clarification_required',view.project.revision,input.duration?.targetDurationSeconds??null,input.budgetCredits,inventory?.tariffRevision??null,inventory?.revision??null,now,now,now,expires,briefRevision,planStep?JSON.stringify(planStep.input.payload.policy):null,modelId,modelRevision,mediaPolicy.revision,projectId,userId,view.project.revision));
    if(planStep)statements.push(env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'plan','plan',?,?,?,?)`).bind(planStep.id,id,JSON.stringify(planStep.input),planStep.credits,now,now));
    statements.push(...afterStart(id));
    statements.push(env.DB.prepare("UPDATE canvas_agent_conversation_decisions SET state='cancelled',revision=revision+1,updated_at=? WHERE project_id=? AND state='pending'").bind(now,projectId));
    statements.push(env.DB.prepare("UPDATE canvas_agent_start_intents SET state='cancelled',revision=revision+1,error_code='canvas_agent_already_active',updated_at=? WHERE project_id=? AND state IN ('waiting','approval_required','authorized')").bind(now,projectId));
    try {const result=await env.DB.batch(statements);if(result[insertIndex].meta?.changes!==1)agentFail('canvas_agent_project_changed');}
    catch(error){if(String(error).includes('UNIQUE'))agentFail('canvas_agent_already_active');throw error;}
    const row=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first();
    await appendCanvasAgentEvent(env,row,'start','action',{code:'started',phase:'planning',model:modelId,tool:'plan.create'});
    if(input.duration)await wakeCanvasAgent(env,id);
    return respond({availability,run:await publicAgentRun(env,row)},202);
}
async function control(ctx,session,projectId,id) {
    const {env,request}=ctx,key=keyFor(request),parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});
    if(parsed.response)return parsed.response;
    if(Object.keys(parsed.body||{}).some(k=>!['action','expectedRevision'].includes(k))||!['pause','resume','cancel','takeover'].includes(parsed.body?.action)
        ||parsed.body.expectedRevision!==undefined&&(parsed.body.action!=='resume'||!Number.isSafeInteger(parsed.body.expectedRevision)||parsed.body.expectedRevision<0))agentFail('canvas_agent_control_invalid',400);
    const run=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=? AND purpose='production'").bind(id,session.user.id,projectId).first();
    if(!run)agentFail('canvas_agent_not_found',404);
    const prior=await env.DB.prepare('SELECT action FROM canvas_agent_controls WHERE run_id=? AND request_key=?').bind(id,key).first();
    if(prior){
        const event=await env.DB.prepare('SELECT payload_json FROM canvas_agent_events WHERE run_id=? AND event_key=?').bind(id,`control:${key}`).first();
        if(prior.action!==parsed.body.action||(JSON.parse(event?.payload_json||'{}').requestedProjectRevision??null)!==(parsed.body.expectedRevision??null))agentFail('idempotency_conflict');
        await releaseCanvasAgentUndispatched(env,id);return respond({run:await publicAgentRun(env,run),idempotentReplay:true});
    }
    if(parsed.body.expectedRevision!==undefined&&!(run.phase==='generating'&&['blocked','review_required'].includes(run.status)))agentFail('canvas_agent_control_invalid',400);
    const action=parsed.body.action,status={pause:'paused',resume:run.plan_json?'running':'queued',cancel:'cancelled',takeover:'taken_over'}[action];
    if(['completed','cancelled','taken_over'].includes(run.status))agentFail('canvas_agent_control_closed');
    if(action==='resume'&&['blocked','review_required'].includes(run.status)) {
        if(run.phase==='generating')await (await import('../lib/canvas-agent-media-resume.js')).resumeCanvasMedia(env,run,{requestKey:key,expectedProjectRevision:parsed.body.expectedRevision??null});
        else {
            const {readmitCanvasPlanning}=await import('../lib/canvas-agent-planning-recovery.js');
            await readmitCanvasPlanning(env,run,{requestKey:key});
        }
        await wakeCanvasAgent(env,id);
        return respond({run:await publicAgentRun(env,await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first())});
    }
    if(!canvasAgentAllowedActions(run,await publicCanvasAgentModelOperation(env,run.id)).includes(action))agentFail('canvas_agent_review_required');
    if(action==='resume') {
        if(run.status!=='paused'||run.error_code==='canvas_agent_brief_changed')agentFail('canvas_agent_review_required');
        const {project}=await canvasAgentProject(env,session.user.id,projectId);
        // Resuming a stale plan would overwrite the user's edit. A new revision
        // request starts from the newly saved graph and has separate authorization.
        if(project.revision!==run.expected_revision)agentFail('canvas_agent_project_changed');
        const available=await canvasAgentAvailability(env,{modelId:run.model_id});if(!available.available)agentFail(available.code);
        if((await canvasAgentCapabilities(env)).tariffRevision!==run.tariff_revision)agentFail('model_pricing_stale');
    }
    const mediaPolicyGuards=action==='resume'?await canvasMediaResumeStatements(env,run):[];
    const now=nowIso();
    await env.DB.batch([
        ...mediaPolicyGuards,
        env.DB.prepare('INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,?,?)').bind(id,key,action,now),
        env.DB.prepare('UPDATE canvas_agent_runs SET status=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status=?')
            .bind(status,now,now,id,session.user.id,run.status),
        env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
        ...(['cancel','takeover'].includes(action)?[env.DB.prepare("UPDATE canvas_agent_budget_requests SET status='stale' WHERE run_id=? AND status='pending'").bind(id)]:[]),
    ]);
    await appendCanvasAgentEvent(env,run,`control:${key}`,'action',{code:status,phase:run.phase,tool:`production.${action}`});
    if(action==='resume')await wakeCanvasAgent(env,id);
    else await releaseCanvasAgentUndispatched(env,id);
    return respond({run:await publicAgentRun(env,await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first())});
}
async function budgetDecision(ctx,session,projectId,id) {
    const {env,request}=ctx,key=keyFor(request),parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});
    if(parsed.response)return parsed.response;
    const body=parsed.body,fields=['requestId','requestRevision','decision','proposedCapCredits','expectedRevision'];
    if(!body||Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k))
        ||!/^[a-f0-9]{32}$/.test(body.requestId||'')||!['accept','decline'].includes(body.decision)
        ||![body.requestRevision,body.proposedCapCredits,body.expectedRevision].every(Number.isSafeInteger))agentFail('canvas_agent_budget_request_invalid',400);
    const run=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=? AND purpose='production'").bind(id,session.user.id,projectId).first();
    if(!run)agentFail('canvas_agent_not_found',404);
    const amendment=await env.DB.prepare('SELECT * FROM canvas_agent_budget_requests WHERE id=? AND run_id=?').bind(body.requestId,id).first();
    if(!amendment)agentFail('canvas_agent_budget_request_invalid');
    if(body.requestRevision!==amendment.revision||body.proposedCapCredits!==amendment.proposed_cap||body.expectedRevision!==amendment.project_revision)agentFail('canvas_agent_budget_request_changed');
    const status=body.decision==='accept'?'accepted':'declined';
    if(amendment.status!=='pending'){
        if(amendment.status!==status||amendment.decision_key!==key)agentFail('canvas_agent_budget_decision_conflict');
        return respond({run:await publicAgentRun(env,run),idempotentReplay:true});
    }
    const {project}=await canvasAgentProject(env,session.user.id,projectId);
    if(run.status!=='paused'||run.phase!=='budget'||project.revision!==amendment.project_revision||run.expected_revision!==amendment.project_revision
        ||run.budget_revision!==amendment.revision||run.budget_credits!==amendment.current_cap)agentFail('canvas_agent_budget_request_changed');
    const inventory=await canvasAgentCapabilities(env);
    if(inventory.tariffRevision!==amendment.tariff_revision||String(amendment.tariff_revision)!==request.headers.get(TARIFF_HEADER))agentFail('model_pricing_stale');
    const available=await canvasAgentAvailability(env,{modelId:run.model_id});if(!available.available)agentFail(available.code);
    const now=nowIso();
    await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
            JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.user_id=? AND r.status='paused' AND r.phase='budget'
            AND r.budget_revision=? AND r.budget_credits=? AND r.expected_revision=? AND p.revision=? AND p.deleted_at IS NULL
            AND r.expires_at>? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs other
                WHERE other.project_id=r.project_id AND other.id!=r.id AND other.purpose='production' AND other.status IN ('queued','planning','applying','running','exporting')))
            THEN 1 ELSE json_extract('[]','$[') END`).bind(id,session.user.id,amendment.revision,amendment.current_cap,amendment.project_revision,amendment.project_revision,now),
        env.DB.prepare("UPDATE canvas_agent_budget_requests SET status=?,decision_key=?,decided_at=? WHERE id=? AND status='pending'").bind(status,key,now,amendment.id),
        env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
        env.DB.prepare(`UPDATE canvas_agent_runs SET budget_credits=?,budget_revision=?,status=?,phase=?,error_code=NULL,
            cause_json=?,next_attempt_at=?,updated_at=? WHERE id=?`)
            .bind(body.decision==='accept'?amendment.proposed_cap:amendment.current_cap,amendment.revision+(body.decision==='accept'?1:0),
                amendment.resume_status,body.decision==='accept'?'validating':'adapting',
                JSON.stringify({code:body.decision==='accept'?'canvas_agent_budget_accepted':'canvas_agent_budget_declined',step:JSON.parse(amendment.action_json).action,recovery:'automatic'}),now,now,id),
    ]);
    await appendCanvasAgentEvent(env,run,`budget-decision:${amendment.id}`,'decision_summary',{code:status,phase:'budget',newCapCredits:body.decision==='accept'?amendment.proposed_cap:amendment.current_cap});
    await wakeCanvasAgent(env,id);
    return respond({run:await publicAgentRun(env,await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first())});
}
export async function handleCanvasAgent(ctx,session) {
    if(ctx.pathname.endsWith('/agent/media-policy')) {
        const {handleCanvasMediaPolicy}=await import('./canvas-agent-media-policy.js');
        return handleCanvasMediaPolicy(ctx,session);
    }
    if(ctx.pathname.includes('/agent/conversation')){
        const {handleCanvasAgentConversation}=await import('./canvas-agent-conversation.js');
        return handleCanvasAgentConversation(ctx,session);
    }
    if(ctx.pathname==='/api/account/canvas/agent/capabilities'&&ctx.method==='GET') {
        return respond({availability:await canvasAgentAvailability(ctx.env),capabilities:await canvasAgentCapabilities(ctx.env)});
    }
    const match=ctx.pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/agent(?:\/([a-f0-9]{32})\/(control|budget|events))?$/);
    if(!match)return null;
    await canvasAgentProject(ctx.env,session.user.id,match[1]);
    if(ctx.method==='GET'&&!match[2]) {
        let row=await ctx.env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(match[1],session.user.id).first();
        if(row){const {reconcileCanvasAgentModelOperations}=await import('../lib/canvas-agent-model-operations.js');await reconcileCanvasAgentModelOperations(ctx.env,{runId:row.id});
            row=await ctx.env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(row.id).first();}
        const cursor=Number(new URL(ctx.request.url).searchParams.get('afterEvent')||0);
        const events=row?await readCanvasAgentEvents(ctx.env,row.id,cursor):{events:[],eventCursor:0,hasMore:false};
        const selected=await ctx.env.DB.prepare('SELECT assistant_model_id FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(match[1],session.user.id).first();
        return respond({availability:await canvasAgentAvailability(ctx.env,{modelId:canvasAssistantModelId(selected?.assistant_model_id)}),run:await publicAgentRun(ctx.env,row),...events});
    }
    if(ctx.method==='GET'&&match[3]==='events'){
        const row=await ctx.env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=? AND purpose='production'").bind(match[2],session.user.id,match[1]).first();
        if(!row)agentFail('canvas_agent_not_found',404);
        const cursor=Number(new URL(ctx.request.url).searchParams.get('afterEvent')||0);
        if(!Number.isSafeInteger(cursor)||cursor<0)agentFail('canvas_agent_event_cursor_invalid',400);
        return canvasAgentEventStream(ctx.env,row,session.user.id,cursor,ctx.request.signal);
    }
    if(ctx.method!=='POST')return null;
    const limited=await enforceSensitiveUserRateLimit(ctx,{userId:session.user.id,scope:'canvas-agent-write-user',maxRequests:30,windowMs:3600000,component:'canvas-agent'});if(limited)return limited;
    // route-policy: account.canvas.agent.control
    if(match[3]==='control'&&ctx.method==='POST')return control(ctx,session,match[1],match[2]);
    // route-policy: account.canvas.agent.budget
    if(match[3]==='budget'&&ctx.method==='POST')return budgetDecision(ctx,session,match[1],match[2]);
    if(match[2])return null;
    // route-policy: account.canvas.agent.start
    if(ctx.method==='POST')return startCanvasAgent(ctx,session,match[1]);
    return null;
}

// Shared by the ordinary controls and validated conversation action service.
export { control as controlCanvasAgent, budgetDecision as decideCanvasAgentBudget };
