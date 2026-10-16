import { normalizeCanvasAgentStart, CANVAS_AGENT_MODEL, CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { stablePricingJson,TARIFF_HEADER } from '../../../../js/shared/model-tariff.mjs';
import { json } from '../lib/response.js';
import { readJsonBodyOrResponse,BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { nowIso,randomTokenHex,sha256Hex } from '../lib/tokens.js';
import { canvasAgentAvailability,canvasAgentCapabilities } from '../lib/canvas-agent-capabilities.js';
import { quoteCanvasAgentPlan } from '../lib/canvas-agent-planning.js';
import { publicAgentRun,wakeCanvasAgent,agentFail,releaseCanvasAgentUndispatched,publicCanvasAgentModelOperation,canvasAgentAllowedActions } from '../lib/canvas-agent-store.js';

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
async function start(ctx,session,projectId) {
    const {env,request}=ctx,userId=session.user.id,key=keyFor(request);
    const parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    const previous=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE user_id=? AND request_key=?').bind(userId,key).first();
    if(previous){
        if(previous.project_id!==projectId||stablePricingJson(JSON.parse(previous.input_json))!==stablePricingJson(parsed.body))agentFail('idempotency_conflict');
        return respond({run:await publicAgentRun(env,previous),idempotentReplay:true});
    }
    const view=await canvasAgentProject(env,userId,projectId);
    const asked=await env.DB.prepare("SELECT input_json FROM canvas_agent_runs WHERE user_id=? AND project_id=? AND status='clarification_required' ORDER BY created_at DESC LIMIT 1").bind(userId,projectId).first();
    const input=normalizeCanvasAgentStart(parsed.body,{durationAsked:Boolean(asked&&JSON.parse(asked.input_json).brief===parsed.body.brief)});
    if(input.expectedRevision!==view.project.revision)agentFail('canvas_agent_project_changed');
    const availability=await canvasAgentAvailability(env);
    const id=randomTokenHex(16),now=nowIso(),expires=new Date(Date.now()+48*60*60000).toISOString();
    const statements=[];
    let inventory=null,planStep=null;
    if(input.duration){
        if(!availability.available)agentFail(availability.code,503);
        inventory=await canvasAgentCapabilities(env);
        // A refreshed tariff is a new user decision, never a hidden higher cap.
        if(inventory.tariffRevision>0&&request.headers.get(TARIFF_HEADER)!==String(inventory.tariffRevision))agentFail('model_pricing_stale');
        const payload={version:1,model:CANVAS_AGENT_MODEL,requestId:id,brief:input.brief,...input.duration,
            toleranceSeconds:CANVAS_AGENT_LIMITS.toleranceSeconds,capabilityRevision:inventory.revision,capabilities:inventory,
            projectRevision:view.project.revision,currentProject:plannerProject(view),
            privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${userId}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${userId}:${projectId}`)}`};
        delete payload.durationChoice;
        const quote=await quoteCanvasAgentPlan(env,payload);
        if(quote.credits>input.budgetCredits)agentFail('canvas_agent_budget_exceeded');
        planStep={id:randomTokenHex(16),input:{modelId:CANVAS_AGENT_MODEL,payload},credits:quote.credits};
    }
    statements.push(env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,target_seconds,budget_credits,tariff_revision,capability_revision,next_attempt_at,created_at,updated_at,expires_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL)`)
        .bind(id,projectId,userId,key,stablePricingJson(parsed.body),input.duration?'queued':'clarification_required',view.project.revision,input.duration?.targetDurationSeconds??null,input.budgetCredits,inventory?.tariffRevision??null,inventory?.revision??null,now,now,now,expires,projectId,userId,view.project.revision));
    if(planStep)statements.push(env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'plan','plan',?,?,?,?)`).bind(planStep.id,id,JSON.stringify(planStep.input),planStep.credits,now,now));
    try {const result=await env.DB.batch(statements);if(result[0].meta?.changes!==1)agentFail('canvas_agent_project_changed');}
    catch(error){if(String(error).includes('UNIQUE'))agentFail('canvas_agent_already_active');throw error;}
    const row=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first();
    if(input.duration)await wakeCanvasAgent(env,id);
    return respond({availability,run:await publicAgentRun(env,row)},202);
}
async function control(ctx,session,projectId,id) {
    const {env,request}=ctx,key=keyFor(request),parsed=await readJsonBodyOrResponse(request,{maxBytes:BODY_LIMITS.smallJson});
    if(parsed.response)return parsed.response;
    if(Object.keys(parsed.body||{}).join(',')!=='action'||!['pause','resume','cancel','takeover'].includes(parsed.body.action))agentFail('canvas_agent_control_invalid',400);
    const run=await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=?').bind(id,session.user.id,projectId).first();
    if(!run)agentFail('canvas_agent_not_found',404);
    const prior=await env.DB.prepare('SELECT action FROM canvas_agent_controls WHERE run_id=? AND request_key=?').bind(id,key).first();
    if(prior){if(prior.action!==parsed.body.action)agentFail('idempotency_conflict');await releaseCanvasAgentUndispatched(env,id);return respond({run:await publicAgentRun(env,run),idempotentReplay:true});}
    const action=parsed.body.action,status={pause:'paused',resume:run.plan_json?'running':'queued',cancel:'cancelled',takeover:'taken_over'}[action];
    if(['completed','cancelled','taken_over'].includes(run.status))agentFail('canvas_agent_control_closed');
    if(!canvasAgentAllowedActions(run,await publicCanvasAgentModelOperation(env,run.id)).includes(action))agentFail('canvas_agent_review_required');
    if(action==='resume') {
        if(run.status!=='paused')agentFail('canvas_agent_review_required');
        const {project}=await canvasAgentProject(env,session.user.id,projectId);
        // Resuming a stale plan would overwrite the user's edit. A new revision
        // request starts from the newly saved graph and has separate authorization.
        if(project.revision!==run.expected_revision)agentFail('canvas_agent_project_changed');
        const available=await canvasAgentAvailability(env);if(!available.available)agentFail(available.code);
        if((await canvasAgentCapabilities(env)).tariffRevision!==run.tariff_revision)agentFail('model_pricing_stale');
    }
    const now=nowIso();
    await env.DB.batch([
        env.DB.prepare('INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,?,?)').bind(id,key,action,now),
        env.DB.prepare('UPDATE canvas_agent_runs SET status=?,error_code=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=? AND status=?')
            .bind(status,now,now,id,session.user.id,run.status),
        env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
    ]);
    if(action==='resume')await wakeCanvasAgent(env,id);
    else await releaseCanvasAgentUndispatched(env,id);
    return respond({run:await publicAgentRun(env,await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(id).first())});
}
export async function handleCanvasAgent(ctx,session) {
    if(ctx.pathname==='/api/account/canvas/agent/capabilities'&&ctx.method==='GET') {
        return respond({availability:await canvasAgentAvailability(ctx.env),capabilities:await canvasAgentCapabilities(ctx.env)});
    }
    const match=ctx.pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/agent(?:\/([a-f0-9]{32})\/control)?$/);
    if(!match)return null;
    await canvasAgentProject(ctx.env,session.user.id,match[1]);
    if(ctx.method==='GET'&&!match[2]) {
        let row=await ctx.env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(match[1],session.user.id).first();
        if(row){const {reconcileCanvasAgentModelOperations}=await import('../lib/canvas-agent-model-operations.js');await reconcileCanvasAgentModelOperations(ctx.env,{runId:row.id});
            row=await ctx.env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(row.id).first();}
        return respond({availability:await canvasAgentAvailability(ctx.env),run:await publicAgentRun(ctx.env,row)});
    }
    if(ctx.method!=='POST')return null;
    const limited=await enforceSensitiveUserRateLimit(ctx,{userId:session.user.id,scope:'canvas-agent-write-user',maxRequests:30,windowMs:3600000,component:'canvas-agent'});if(limited)return limited;
    // route-policy: account.canvas.agent.control
    if(match[2]&&ctx.method==='POST')return control(ctx,session,match[1],match[2]);
    // route-policy: account.canvas.agent.start
    if(ctx.method==='POST')return start(ctx,session,match[1]);
    return null;
}
