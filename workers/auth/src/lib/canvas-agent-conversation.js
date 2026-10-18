import { resolveCanvasAgentDuration, CANVAS_AGENT_MODEL } from '../../../../js/shared/canvas-agent-contract.mjs';
import { nowIso,randomTokenHex,sha256Hex } from './tokens.js';
import { agentFail,agentTransition,wakeCanvasAgent } from './canvas-agent-store.js';
import { executeCanvasAgentModel } from './canvas-agent-planning.js';
import { canvasAgentCapabilities,canvasAgentDialogueAvailability } from './canvas-agent-capabilities.js';
import { quoteModelTariff,getModelTariff } from './model-tariffs.js';
import { dialoguePriceInput,validateCanvasAgentDialogueReply,CANVAS_AGENT_BRIEF_FIELDS,CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES,CANVAS_AGENT_DIALOGUE_SYSTEM,CANVAS_AGENT_DIALOGUE_SCHEMA,CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS } from '../../../shared/canvas-agent-dialogue.mjs';
import { canvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';
import { plannerProject } from '../routes/canvas-agent.js';

export const BRIEF_FIELDS=CANVAS_AGENT_BRIEF_FIELDS;
export const emptyBrief=()=>({version:1,revision:0,fields:{},duration:{targetDurationSeconds:null,choice:null,asked:false,sourceMessageId:null},openQuestions:[]});
export const conversationRow=(env,projectId,userId)=>env.DB.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(projectId,userId).first();
export const durationQuestion=locale=>locale==='de'?'Wie lang soll dein Film ungefähr werden? Du kannst mir die Wahl der Dauer auch ausdrücklich überlassen.':'About how long should your film be? You can also explicitly ask me to choose a suitable duration.';
export function userDuration(text,brief,messageId,{delegate=false}={}) {
    let duration=resolveCanvasAgentDuration({brief:text});
    if(!duration&&brief.duration.asked&&/^\s*\d+(?:[.,]\d+)?\s*$/.test(text))duration=resolveCanvasAgentDuration({targetDurationSeconds:Number(text.trim().replace(',','.'))});
    const positive=/^(?:(?:please )?(?:choose|pick|select) (?:a |the )?(?:(?:suitable|appropriate|good) )?(?:(?:film|video) )?(?:duration|length)(?: for (?:the|my|this) (?:film|video))?|(?:bitte )?(?:wähle|bestimme) (?:eine |die )?(?:(?:passende|geeignete) )?(?:dauer|länge)(?: für (?:den|diesen|meinen) film)?)[.!]?$/i.test(text.trim());
    const explicit=delegate||positive||brief.duration.asked&&/^\s*(?:you choose|your choice|du entscheidest|such du aus|entscheide du|überlasse ich dir)[.!]?\s*$/i.test(text);
    if(!duration&&explicit)duration={targetDurationSeconds:null,durationChoice:'delegated'};
    return duration?{targetDurationSeconds:duration.targetDurationSeconds,choice:duration.durationChoice,asked:brief.duration.asked,sourceMessageId:messageId}:null;
}
export async function ensureConversation(env,projectId,userId) {
    const now=nowIso();
    await env.DB.prepare(`INSERT OR IGNORE INTO canvas_agent_conversations(project_id,user_id,brief_json,created_at,updated_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL)`)
        .bind(projectId,userId,JSON.stringify(emptyBrief()),now,now,projectId,userId).run();
    return conversationRow(env,projectId,userId);
}
export async function conversationCosts(env,projectId) {
    return env.DB.prepare(`SELECT COALESCE(SUM(c.committed),0) AS committed,COALESCE(SUM(c.charged),0) AS charged
        FROM canvas_agent_step_costs c JOIN canvas_agent_runs r ON r.id=c.run_id WHERE c.project_id=? AND r.purpose='briefing'`).bind(projectId).first();
}
export async function conversationView(env,projectId,userId) {
    const row=await ensureConversation(env,projectId,userId);
    // Operation receipts are authoritative. Projection repairs never dispatch.
    await env.DB.prepare(`UPDATE canvas_agent_turns SET state=CASE WHEN (SELECT status FROM canvas_agent_runs WHERE id=run_id)='review_required' THEN 'review_required'
        WHEN (SELECT status FROM canvas_agent_runs WHERE id=run_id) IN ('cancelled','taken_over') THEN 'cancelled' ELSE 'failed' END,
        error_code=(SELECT error_code FROM canvas_agent_runs WHERE id=run_id),updated_at=?
        WHERE project_id=? AND state='pending' AND run_id IN (SELECT id FROM canvas_agent_runs WHERE status IN ('blocked','review_required','cancelled','taken_over'))`).bind(nowIso(),projectId).run();
    const turns=(await env.DB.prepare("SELECT * FROM canvas_agent_turns WHERE project_id=? AND state!='deleted' ORDER BY rowid").bind(projectId).all()).results;
    const messages=turns.flatMap(t=>[{id:t.id,role:'user',text:t.user_text,status:'completed'},...(t.assistant_text?[{id:`${t.id}:reply`,role:'assistant',text:t.assistant_text,status:'completed'}]
        :[{id:`${t.id}:reply`,role:'assistant',text:'',status:t.state,code:t.error_code||null}])]);
    const costs=await conversationCosts(env,projectId),tariff=await getModelTariff(env);
    let suggestedAllowanceCredits=null;
    try {
        const ceiling=await quoteModelTariff(env,{modelId:CANVAS_AGENT_MODEL,input:{prompt:'x'.repeat(CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES),
            system:CANVAS_AGENT_DIALOGUE_SYSTEM+JSON.stringify(CANVAS_AGENT_DIALOGUE_SCHEMA),maxTokens:CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS}});
        suggestedAllowanceCredits=Math.min(100000,costs.committed+ceiling.credits);
    } catch { /* Unpriced inference stays unavailable; no fabricated tariff. */ }
    return {conversation:{revision:row.revision,briefRevision:row.brief_revision,state:row.state,draft:row.draft,
        messages,brief:JSON.parse(row.brief_json),pendingTurnId:turns.find(t=>t.state==='pending')?.id||null,
        allowance:{capCredits:row.allowance_credits,committedCredits:costs.committed,chargedCredits:costs.charged,
            remainingCredits:Math.max(0,row.allowance_credits-costs.committed),tariffRevision:tariff.revision,suggestedAllowanceCredits}},
        availability:await canvasAgentDialogueAvailability(env)};
}
export function conversationGuard(env,row) {
    return env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_conversations c JOIN canvas_projects p ON p.id=c.project_id
        JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.user_id=? AND c.revision=? AND c.brief_revision=?
        AND p.deleted_at IS NULL AND u.status='active') THEN 1 ELSE json_extract('[]','$[') END`).bind(row.project_id,row.user_id,row.revision,row.brief_revision);
}
export function pauseForBriefChange(env,projectId) {
    return env.DB.prepare(`UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_brief_changed',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE project_id=? AND purpose='production' AND status IN ('queued','planning','running','exporting')`).bind(nowIso(),projectId);
}
export function conversationLocale(view) { return view.project?.locale==='de'?'de':'en'; }
async function localStatusTurn(env,row,input,key) {
    if(!/^(?:how (?:far along are you|is (?:it|the (?:film|video|production)) going)|what(?:'s| is) the (?:status|progress)|status|progress|wie (?:weit bist du|ist der (?:stand|status))|was macht (?:der film|das video|die produktion))\s*[?.!]?$/i.test(input.text.trim()))return false;
    const run=await env.DB.prepare("SELECT status,phase FROM canvas_agent_runs WHERE project_id=? AND purpose='production' ORDER BY rowid DESC LIMIT 1").bind(row.project_id).first();
    const states={queued:['Queued','In der Warteschlange'],planning:['Planning','Planung'],running:['Producing','Produktion'],exporting:['Exporting','Export'],completed:['Completed','Abgeschlossen'],paused:['Paused','Pausiert'],cancelled:['Stopped','Gestoppt'],taken_over:['Manual editing','Manuelle Bearbeitung'],blocked:['Blocked — see production details','Blockiert – siehe Produktionsdetails'],review_required:['Needs review — see production details','Prüfung erforderlich – siehe Produktionsdetails']};
    const text=run?(states[run.status]||['See production details','Siehe Produktionsdetails'])[input.locale==='de'?1:0]:(input.locale==='de'?'Noch keine Produktion gestartet. Deine Projektidee bleibt gespeichert.':'No production has started. Your project brief stays saved.');
    const id=randomTokenHex(16),now=nowIso();
    await env.DB.batch([conversationGuard(env,row),env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(now,row.project_id),
        env.DB.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'completed',?,?)")
          .bind(id,row.project_id,key,JSON.stringify(input),row.revision+1,row.brief_revision,input.text,text,now,now)]);
    return true;
}
export async function createConversationTurn(env,view,row,input,key) {
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_turns WHERE project_id=? AND state!='deleted'").bind(row.project_id).first();
    if(count.n>=80)agentFail('canvas_agent_conversation_limit');
    if(await localStatusTurn(env,row,input,key))return;
    const available=await canvasAgentDialogueAvailability(env);if(!available.available)agentFail(available.code,503);
    const inventory=await canvasAgentCapabilities(env),costs=await conversationCosts(env,row.project_id);
    if(row.state!=='active')agentFail('canvas_agent_conversation_saved');
    if(row.allowance_credits<=costs.committed)agentFail('canvas_agent_briefing_allowance_required',402);
    if(inventory.tariffRevision!==row.allowance_tariff)agentFail('model_pricing_stale');

    const pending=await env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state IN ('pending','review_required')").bind(row.project_id).first();
    if(pending)agentFail('canvas_agent_conversation_pending');
    const id=randomTokenHex(16),runId=randomTokenHex(16),stepId=randomTokenHex(16),now=nowIso();
    const brief=JSON.parse(row.brief_json),duration=userDuration(input.text,brief,id);
    if(duration)brief.duration=duration;
    const delegateOptional=/^(?:enough questions|no more questions|stop asking questions|genug fragen|keine weiteren fragen)[.!]?$/i.test(input.text.trim());
    if(delegateOptional){
        brief.fields.delegatedChoices={value:'Choose suitable defaults for optional creative details; duration and spending remain separate.',provenance:'delegated',sourceMessageId:id,revision:row.brief_revision+1};
        brief.openQuestions=[];
    }
    // A free, deterministic first question is persisted even if inference fails.
    const askDuration=!brief.duration.choice&&!brief.duration.asked;
    if(askDuration)brief.duration.asked=true;
    const recent=(await env.DB.prepare("SELECT id,user_text,assistant_text FROM canvas_agent_turns WHERE project_id=? AND state='completed' ORDER BY rowid DESC LIMIT 6").bind(row.project_id).all()).results.reverse();
    const project=plannerProject(view);
    // Creative graph is current; bounded selected facts do not copy asset bytes.
    project.nodes=project.nodes.slice(0,60).map(n=>({id:n.id,type:n.type,title:n.title,modelId:n.modelId,output:n.output}));
    const production=await env.DB.prepare("SELECT id,status,phase,error_code,result_json FROM canvas_agent_runs WHERE project_id=? AND purpose='production' ORDER BY rowid DESC LIMIT 1").bind(row.project_id).first();
    brief.revision=row.brief_revision+(duration||delegateOptional?1:0);
    const policy=await canvasAgentPolicyIdentity('briefing');
    const payload={version:1,model:CANVAS_AGENT_MODEL,requestId:runId,locale:input.locale,
        conversationRevision:row.revision+1,briefRevision:row.brief_revision+(duration||delegateOptional?1:0),projectRevision:view.project.revision,
        message:{id,text:input.text},brief,recentMessages:recent.flatMap(t=>[{id:t.id,role:'user',text:t.user_text},...(t.assistant_text?[{id:`${t.id}_reply`,role:'assistant',text:t.assistant_text.slice(0,6000)}]:[])]),
        capabilities:inventory,currentProject:{...project,production:production?{id:production.id,status:production.status,phase:production.phase,errorCode:production.error_code,hasSavedExport:Boolean(production.result_json)}:null},policy,
        privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${row.user_id}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${row.user_id}:${row.project_id}`)}`};
    while(payload.recentMessages.length&&new TextEncoder().encode(JSON.stringify(payload)).byteLength>CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES)payload.recentMessages.splice(0,2);
    const quote=await quoteModelTariff(env,{modelId:CANVAS_AGENT_MODEL,input:dialoguePriceInput(payload)});
    if(quote.credits>row.allowance_credits-costs.committed)agentFail('canvas_agent_briefing_allowance_required',402);
    brief.revision=payload.briefRevision;
    const statements=[conversationGuard(env,row),env.DB.prepare(`UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,draft='',updated_at=? WHERE project_id=?`)
        .bind(brief.revision,JSON.stringify(brief),now,row.project_id),
        env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,phase,expected_revision,budget_credits,tariff_revision,capability_revision,next_attempt_at,created_at,updated_at,expires_at,purpose,policy_json,brief_revision)
          VALUES(?,?,?,?,?,'queued','briefing',?,?,?,?,?,?,?,?,'briefing',?,?)`).bind(runId,row.project_id,row.user_id,`dialogue:${key}`,JSON.stringify(input),view.project.revision,row.allowance_credits,inventory.tariffRevision,inventory.revision,now,now,now,new Date(Date.now()+48*3600000).toISOString(),JSON.stringify(policy),brief.revision),
        env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'dialogue','plan',?,?,?,?)`)
            .bind(stepId,runId,JSON.stringify({modelId:CANVAS_AGENT_MODEL,payload,askDuration}),quote.credits,now,now),
        env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,run_id,conversation_revision,brief_revision,user_text,state,policy_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(id,row.project_id,key,JSON.stringify(input),runId,row.revision+1,brief.revision,input.text,JSON.stringify(policy),now,now)];
    if(duration||delegateOptional)statements.push(pauseForBriefChange(env,row.project_id));
    await env.DB.batch(statements);
    await wakeCanvasAgent(env,runId);
    return id;
}
export async function processCanvasAgentConversation(env,run,user,storageAttempt=0) {
    const turn=await env.DB.prepare('SELECT * FROM canvas_agent_turns WHERE run_id=?').bind(run.id).first();
    const row=await conversationRow(env,run.project_id,run.user_id);
    if(!turn||turn.state==='deleted'||row?.state!=='active')agentFail('canvas_agent_conversation_stopped');
    if(!['pending','review_required'].includes(turn.state))return agentTransition(env,run,{status:'completed',phase:'briefing'});
    await agentTransition(env,run,{status:'planning',phase:'briefing'});
    const step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND step_key='dialogue'").bind(run.id).first();
    const receipt=step.status==='completed'?JSON.parse(step.receipt_json):await executeCanvasAgentModel(env,run,step,user);
    if(!receipt)return;
    const dialogue=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,{messageId:turn.id});
    if(!dialogue||typeof dialogue.text!=='string'||!Array.isArray(dialogue.updates))agentFail('canvas_agent_dialogue_invalid');
    // A delayed accepted response is retained operationally, but never restores
    // deleted context or overwrites a newer brief. Status-only turns and
    // allowance acknowledgements may advance conversation revision independently.
    const current=await conversationRow(env,run.project_id,run.user_id);
    if(!current||current.state!=='active'||current.brief_revision!==turn.brief_revision){
        await env.DB.prepare("UPDATE canvas_agent_turns SET state='cancelled',error_code='canvas_agent_conversation_changed',updated_at=? WHERE id=? AND state!='deleted'").bind(nowIso(),turn.id).run();
        return agentTransition(env,run,{status:'completed',phase:'briefing'});
    }
    const brief=JSON.parse(current.brief_json),old=JSON.stringify(brief.fields);
    for(const update of dialogue.updates){
        if(!BRIEF_FIELDS.includes(update.field)||update.sourceMessageId!==turn.id||typeof update.value!=='string'||update.value.length>1000)continue;
        if(update.field==='delegatedChoices'&&brief.fields.delegatedChoices?.sourceMessageId===turn.id&&brief.fields.delegatedChoices.provenance==='delegated')continue;
        const provenance=['user_stated','assistant_proposed','corrected','unresolved'].includes(update.provenance)?update.provenance:'assistant_proposed';
        brief.fields[update.field]={value:update.value,provenance,sourceMessageId:turn.id,revision:current.brief_revision+1};
    }
    const changed=old!==JSON.stringify(brief.fields);
    brief.openQuestions=Array.isArray(dialogue.questions)?dialogue.questions.slice(0,2):[];
    if(brief.duration.choice)brief.openQuestions=brief.openQuestions.filter(q=>!/(?:duration|how long|wie lang|dauer)/i.test(q));
    let text=dialogue.text;
    if(JSON.parse(step.input_json).askDuration){
        const question=durationQuestion(JSON.parse(step.input_json).payload.locale);
        if(!/(?:duration|how long|wie lang|dauer)/i.test(text))text=`${text}\n\n${question}`;
        if(!brief.openQuestions.some(q=>/(?:duration|how long|wie lang|dauer)/i.test(q)))brief.openQuestions=[question,...brief.openQuestions].slice(0,2);
    }
    brief.revision=current.brief_revision+(changed?1:0);
    const statements=[conversationGuard(env,current),env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,updated_at=? WHERE project_id=?')
        .bind(brief.revision,JSON.stringify(brief),nowIso(),run.project_id),
        env.DB.prepare("UPDATE canvas_agent_turns SET state='completed',assistant_text=?,updated_at=? WHERE id=? AND state IN ('pending','review_required')").bind(text.slice(0,8000),nowIso(),turn.id)];
    if(changed&&dialogue.updates.some(u=>['user_stated','corrected'].includes(u.provenance)))statements.push(pauseForBriefChange(env,run.project_id));
    try {await env.DB.batch(statements);} catch(error) {
        const latest=await conversationRow(env,run.project_id,run.user_id);
        if(latest&&latest.revision!==current.revision&&storageAttempt<2)
            return processCanvasAgentConversation(env,run,user,storageAttempt+1);
        throw error;
    }
    await agentTransition(env,run,{status:'completed',phase:'briefing'});
}
export function productionBrief(row) {
    const brief=JSON.parse(row.brief_json);
    return [Object.entries(brief.fields).map(([name,entry])=>`${name} (${entry.provenance}): ${entry.value}`).join('\n'),
        brief.duration.choice==='delegated'?'Duration explicitly delegated by the user.':`Target duration: ${brief.duration.targetDurationSeconds} seconds.`].join('\n');
}
