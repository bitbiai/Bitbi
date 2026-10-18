import { readJsonBodyOrResponse,BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { stablePricingJson,TARIFF_HEADER } from '../../../../js/shared/model-tariff.mjs';
import { canvasAgentProject,startCanvasAgent } from './canvas-agent.js';
import { agentFail,releaseCanvasAgentUndispatched,publicAgentRun } from '../lib/canvas-agent-store.js';
import { nowIso,randomTokenHex } from '../lib/tokens.js';
import { getModelTariff } from '../lib/model-tariffs.js';
import { emptyBrief,ensureConversation,conversationView,conversationGuard,createConversationTurn,productionBrief,
    pauseForBriefChange,durationQuestion } from '../lib/canvas-agent-conversation.js';

const respond=(data,status=200)=>Response.json({ok:true,data},{status,headers:{'Cache-Control':'private, no-store'}});
const keyFor=request=>{const key=request.headers.get('Idempotency-Key');if(!/^[A-Za-z0-9._:-]{8,100}$/.test(key||''))agentFail('idempotency_key_required',428);return key;};
const check=(body,fields)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))agentFail('canvas_agent_conversation_input_invalid',400);};
const revision=(body,row)=>{if(body.expectedConversationRevision!==row.revision||!Number.isSafeInteger(body.expectedConversationRevision))agentFail('canvas_agent_conversation_changed');};
const textOk=value=>typeof value==='string'&&value.length<=6000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const actionInput=(kind,body)=>stablePricingJson({kind,...body});
async function actionReplay(env,row,key,input) {
    const prior=await env.DB.prepare('SELECT input_json FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key=?').bind(row.project_id,key).first();
    if(prior&&prior.input_json!==input)agentFail('idempotency_conflict');
    return Boolean(prior);
}
const actionStatement=(env,row,key,input)=>env.DB.prepare('INSERT INTO canvas_agent_conversation_actions(project_id,request_key,input_json,created_at) VALUES(?,?,?,?)').bind(row.project_id,key,input,nowIso());
async function allowance(ctx,row,body,key) {
    check(body,['capCredits','expectedConversationRevision']);
    const input=actionInput('allowance',body);
    if(await actionReplay(ctx.env,row,key,input))return;
    revision(body,row);
    if(!Number.isSafeInteger(body.capCredits)||body.capCredits<1||body.capCredits>100000)agentFail('canvas_agent_budget_required',400);
    const tariff=await getModelTariff(ctx.env);
    if(String(tariff.revision)!==ctx.request.headers.get(TARIFF_HEADER))agentFail('model_pricing_stale');
    await ctx.env.DB.batch([conversationGuard(ctx.env,row),actionStatement(ctx.env,row,key,input),
        ctx.env.DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=?,allowance_tariff=?,revision=revision+1,updated_at=? WHERE project_id=?')
            .bind(body.capCredits,tariff.revision,nowIso(),row.project_id)]);
}
async function control(ctx,row,body,key,locale) {
    check(body,['action','expectedConversationRevision','draft','locale']);
    if(body.locale!==undefined&&!['en','de'].includes(body.locale))agentFail('canvas_agent_conversation_input_invalid',400);
    locale=body.locale||locale;
    if(!['save','resume','cancel','clear','skip_questions','delegate_duration'].includes(body.action)||body.draft!==undefined&&!textOk(body.draft))agentFail('canvas_agent_conversation_input_invalid',400);
    const input=actionInput('control',body);
    if(await actionReplay(ctx.env,row,key,input))return;
    revision(body,row);
    const pending=await ctx.env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state='pending'").bind(row.project_id).first();
    if(pending&&['skip_questions','delegate_duration'].includes(body.action))agentFail('canvas_agent_conversation_pending');
    if(['skip_questions','delegate_duration'].includes(body.action)){
        const count=await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_turns WHERE project_id=? AND state!='deleted'").bind(row.project_id).first();
        if(count.n>=80)agentFail('canvas_agent_conversation_limit');
    }
    const brief=body.action==='clear'?emptyBrief():JSON.parse(row.brief_json),now=nowIso(),id=randomTokenHex(16);
    let changed=body.action==='clear',userText=null,assistant=null;
    if(body.action==='delegate_duration'){
        brief.duration={targetDurationSeconds:null,choice:'delegated',asked:brief.duration.asked,sourceMessageId:id};
        userText=locale==='de'?'Wähle eine passende Dauer für diesen Film.':'Choose a suitable duration for this film.';
        assistant=locale==='de'?'Die Wahl der Dauer ist ausdrücklich delegiert. Die Produktion braucht weiterhin deine separate Budgetfreigabe.':'Duration is explicitly delegated. Production still needs your separate spending approval.';
        changed=true;
    }
    if(body.action==='skip_questions'){
        brief.fields.delegatedChoices={value:'Choose reasonable defaults for optional creative details. This does not delegate duration or spending.',provenance:'delegated',sourceMessageId:id,revision:row.brief_revision+1};
        brief.openQuestions=[];changed=true;
        userText=locale==='de'?'Beende optionale Fragen und wähle passende kreative Vorgaben.':'Finish optional questions and use suitable creative defaults.';
        assistant=brief.duration.choice?(locale==='de'?'Optionale kreative Entscheidungen sind delegiert. Prüfe die Projektidee vor der Produktionsfreigabe.':'Optional creative choices are delegated. Review the brief before authorizing production.'):durationQuestion(locale);
        if(!brief.duration.choice)brief.duration.asked=true;
    }
    brief.revision=row.brief_revision+(changed?1:0);
    const state={save:'saved',cancel:'cancelled',resume:'active',clear:'active'}[body.action]||row.state;
    const statements=[conversationGuard(ctx.env,row),actionStatement(ctx.env,row,key,input),
        ctx.env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,state=?,draft=?,updated_at=? WHERE project_id=?')
            .bind(brief.revision,JSON.stringify(brief),state,body.action==='clear'?'':body.draft??row.draft,now,row.project_id)];
    if(['cancel','clear','save'].includes(body.action)){
        statements.push(ctx.env.DB.prepare(`UPDATE canvas_agent_runs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=?
            WHERE project_id=? AND purpose='briefing' AND status IN ('queued','planning','running','paused','review_required','blocked')`).bind(now,row.project_id));
        statements.push(ctx.env.DB.prepare(`UPDATE canvas_agent_turns SET state=?,user_text=CASE WHEN ?='deleted' THEN '' ELSE user_text END,
            assistant_text=CASE WHEN ?='deleted' THEN NULL ELSE assistant_text END,updated_at=?
            WHERE project_id=? ${body.action==='clear'?'':"AND state IN ('pending','review_required')"}`)
            .bind(body.action==='clear'?'deleted':'cancelled',body.action==='clear'?'deleted':'cancelled',body.action==='clear'?'deleted':'cancelled',now,row.project_id));
    }
    if(userText)statements.push(ctx.env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'completed',?,?)`).bind(id,row.project_id,key,input,row.revision+1,brief.revision,userText,assistant,now,now));
    if(changed)statements.push(pauseForBriefChange(ctx.env,row.project_id));
    await ctx.env.DB.batch(statements);
    const stopped=(await ctx.env.DB.prepare("SELECT id FROM canvas_agent_runs WHERE project_id=? AND purpose='briefing' AND status='cancelled'").bind(row.project_id).all()).results;
    for(const run of stopped)await releaseCanvasAgentUndispatched(ctx.env,run.id);
}
async function start(ctx,session,view,row,body,key) {
    check(body,['expectedConversationRevision','expectedBriefRevision','expectedRevision','budgetCredits','locale','authorized']);
    const action=actionInput('start',body);
    if(await actionReplay(ctx.env,row,key,action)){
        const previous=await ctx.env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND request_key=? AND purpose='production'").bind(row.project_id,row.user_id,key).first();
        if(!previous)agentFail('canvas_agent_start_review_required');
        return respond({run:await publicAgentRun(ctx.env,previous),idempotentReplay:true});
    }
    revision(body,row);
    if(body.authorized!==true)agentFail('canvas_agent_production_consent_required',400);
    if(body.expectedBriefRevision!==row.brief_revision||body.expectedRevision!==view.project.revision)agentFail('canvas_agent_project_changed');
    if(row.state==='cancelled')agentFail('canvas_agent_conversation_stopped');
    const pending=await ctx.env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state IN ('pending','review_required')").bind(row.project_id).first();
    if(pending)agentFail('canvas_agent_conversation_pending');
    const unresolved=await ctx.env.DB.prepare("SELECT o.id FROM canvas_agent_model_operations o JOIN canvas_agent_runs r ON r.id=o.run_id WHERE r.project_id=? AND o.state IN ('dispatching','pending','unknown','received') LIMIT 1").bind(row.project_id).first();
    if(unresolved)agentFail('canvas_agent_provider_review_required');
    const brief=JSON.parse(row.brief_json);
    if(!brief.duration.choice){
        if(!brief.duration.asked){brief.duration.asked=true;await ctx.env.DB.prepare('UPDATE canvas_agent_conversations SET brief_json=?,revision=revision+1 WHERE project_id=? AND revision=?').bind(JSON.stringify(brief),row.project_id,row.revision).run();}
        agentFail('canvas_agent_duration_required',400);
    }
    if(!brief.fields.story?.value)agentFail('canvas_agent_brief_required',400);
    const startBody={brief:productionBrief(row),targetDurationSeconds:brief.duration.targetDurationSeconds,
        durationChoice:brief.duration.choice,budgetCredits:body.budgetCredits,expectedRevision:body.expectedRevision,locale:body.locale==='de'?'de':'en'};
    const request=new Request(ctx.request,{body:JSON.stringify(startBody)});
    return startCanvasAgent({...ctx,request},session,row.project_id,{briefRevision:row.brief_revision,
        guard:[conversationGuard(ctx.env,row),actionStatement(ctx.env,row,key,action)]});
}
export async function handleCanvasAgentConversation(ctx,session) {
    const match=ctx.pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/agent\/conversation(?:\/(messages|allowance|control|start))?$/);
    if(!match)return null;
    const projectId=match[1],view=await canvasAgentProject(ctx.env,session.user.id,projectId);
    if(ctx.method==='GET'&&!match[2])return respond(await conversationView(ctx.env,projectId,session.user.id));
    if(ctx.method!=='POST'||!match[2])return null;
    const limited=await enforceSensitiveUserRateLimit(ctx,{userId:session.user.id,scope:'canvas-agent-conversation-write-user',maxRequests:120,windowMs:3600000,component:'canvas-agent-conversation'});if(limited)return limited;
    const parsed=await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});if(parsed.response)return parsed.response;
    const body=parsed.body,key=keyFor(ctx.request),row=await ensureConversation(ctx.env,projectId,session.user.id);
    try {
    // route-policy: account.canvas.agent.conversation.messages
    if(match[2]==='messages'&&ctx.method==='POST'){
        check(body,['text','locale','expectedConversationRevision','expectedBriefRevision']);
        if(!textOk(body.text)||!body.text.trim()||!['en','de'].includes(body.locale))agentFail('canvas_agent_conversation_input_invalid',400);
        const prior=await ctx.env.DB.prepare('SELECT input_json FROM canvas_agent_turns WHERE project_id=? AND request_key=?').bind(projectId,key).first();
        if(prior){if(stablePricingJson(JSON.parse(prior.input_json))!==stablePricingJson(body))agentFail('idempotency_conflict');return respond(await conversationView(ctx.env,projectId,session.user.id));}
        revision(body,row);if(body.expectedBriefRevision!==row.brief_revision)agentFail('canvas_agent_conversation_changed');
        await createConversationTurn(ctx.env,view,row,body,key);
    }
    // route-policy: account.canvas.agent.conversation.allowance
    if(match[2]==='allowance'&&ctx.method==='POST')await allowance(ctx,row,body,key);
    // route-policy: account.canvas.agent.conversation.control
    if(match[2]==='control'&&ctx.method==='POST')await control(ctx,row,body,key,view.project.locale);
    // route-policy: account.canvas.agent.conversation.start
    if(match[2]==='start'&&ctx.method==='POST')return start(ctx,session,view,row,body,key);
    return respond(await conversationView(ctx.env,projectId,session.user.id),match[2]==='messages'?202:200);
    } catch(error) {
        // Concurrent duplicate HTTP delivery may lose the revision guard after
        // the first request commits. Observe that original identity, never
        // rebuild the request or dispatch another inference.
        if(match[2]==='messages'){
            const accepted=await ctx.env.DB.prepare('SELECT input_json FROM canvas_agent_turns WHERE project_id=? AND request_key=?').bind(projectId,key).first();
            if(accepted){
                if(stablePricingJson(JSON.parse(accepted.input_json))!==stablePricingJson(body))agentFail('idempotency_conflict');
                return respond(await conversationView(ctx.env,projectId,session.user.id));
            }
        } else if(await actionReplay(ctx.env,row,key,actionInput(match[2],body))){
            if(match[2]==='start')return start(ctx,session,view,row,body,key);
            return respond(await conversationView(ctx.env,projectId,session.user.id));
        }
        if(String(error).includes('canvas_agent_budget_exceeded'))agentFail('canvas_agent_budget_exceeded');
        const current=await ensureConversation(ctx.env,projectId,session.user.id);
        if(current.revision!==row.revision&&(!error.code||error.code==='ERR_SQLITE_ERROR'||String(error).includes('D1_ERROR')))agentFail('canvas_agent_conversation_changed');
        throw error;
    }
}
