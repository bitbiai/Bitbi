import { resolveCanvasAgentDuration, CANVAS_AGENT_MODEL } from '../../../../js/shared/canvas-agent-contract.mjs';
import { nowIso,randomTokenHex,sha256Hex } from './tokens.js';
import { agentFail,agentTransition,wakeCanvasAgent,claimCanvasAgent,publicAgentRun } from './canvas-agent-store.js';
import { executeCanvasAgentModel } from './canvas-agent-planning.js';
import { canvasAgentCapabilities,canvasAgentDialogueAvailability } from './canvas-agent-capabilities.js';
import { quoteModelTariff,getModelTariff } from './model-tariffs.js';
import { dialoguePriceInput,validateCanvasAgentDialogueReply,CANVAS_AGENT_BRIEF_FIELDS,CANVAS_AGENT_DIALOGUE_VERSION,CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES,CANVAS_AGENT_DIALOGUE_SYSTEM,CANVAS_AGENT_DIALOGUE_SCHEMA,CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS } from '../../../shared/canvas-agent-dialogue.mjs';
import { canvasAgentSystem, canvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';
import { canvasAssistantModelId, CANVAS_FABLE_MODEL, CANVAS_FABLE_ADMISSION_VERSION } from '../../../../js/shared/canvas-assistant-models.mjs';
import { CANVAS_GROK_ADMISSION_VERSION } from '../../../../js/shared/canvas-grok-admission.mjs';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { detectCanvasDirectControl } from '../../../../js/shared/canvas-agent-control-intent.mjs';
import {canvasAgentActionContext,prepareCanvasAgentActionStatements,executeCanvasAgentActions,publicCanvasAgentActions,recoverCanvasAgentActions} from './canvas-agent-actions.js';
import { canvasDialogueProjectEvidence,canvasDialogueDelivery,canvasDialogueFailure,logCanvasDialogueStage } from './canvas-agent-dialogue-state.js';
import { canvasConversationExecutionFacts,canvasConversationStatusText,canvasConversationReadIntent,canvasReconcileExplanation } from './canvas-agent-conversation-context.js';

export const BRIEF_FIELDS=CANVAS_AGENT_BRIEF_FIELDS;
export const emptyBrief=()=>({version:1,revision:0,fields:{},duration:{targetDurationSeconds:null,choice:null,asked:false,sourceMessageId:null},openQuestions:[]});
export const conversationRow=(env,projectId,userId)=>env.DB.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(projectId,userId).first();
export const durationQuestion=locale=>locale==='de'?'Wie lang soll dein Film ungefähr werden? Du kannst mir die Wahl der Dauer auch ausdrücklich überlassen.':'About how long should your film be? You can also explicitly ask me to choose a suitable duration.';
export function userDuration(text,brief,messageId,{delegate=false}={}) {
    let duration=resolveCanvasAgentDuration({brief:text,durationAsked:brief.duration.asked});
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
    return env.DB.prepare(`SELECT COALESCE(SUM(c.committed),0) AS committed,COALESCE(SUM(c.charged),0) AS charged,
        COALESCE(SUM(c.reserved),0) AS reserved,COALESCE(SUM(c.pending),0) AS pending
        FROM canvas_agent_step_costs c JOIN canvas_agent_runs r ON r.id=c.run_id WHERE c.project_id=? AND r.purpose='briefing'`).bind(projectId).first();
}
// Existing approval/start receipts identify application acknowledgements. Their
// text is not a discriminator; pending questions have no consumed receipt.
const applicationReceiptSelect=`(EXISTS(SELECT 1 FROM canvas_agent_conversation_actions a
    JOIN canvas_agent_conversation_decisions d ON d.id=json_extract(a.input_json,'$.decisionId') AND d.project_id=a.project_id
    JOIN canvas_projects p ON p.id=d.project_id AND p.user_id=d.user_id
    WHERE a.project_id=t.project_id AND a.request_key=t.request_key AND json_extract(a.input_json,'$.kind')='decision'
      AND d.decision_key=a.request_key AND d.state IN ('consumed','cancelled'))
    OR EXISTS(SELECT 1 FROM canvas_agent_start_intents i JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id
      WHERE i.id=t.id AND i.project_id=t.project_id AND t.request_key='immediate:'||i.request_key)) AS application_receipt`;
export async function conversationView(env,projectId,userId) {
    if(!await ensureConversation(env,projectId,userId))agentFail('canvas_project_not_found',404);
    await observeCanvasConversationReceipts(env,projectId,userId);
    await recoverCanvasAgentActions(env,{projectId,userId});
    const actions=await publicCanvasAgentActions(env,projectId,userId);
    const row=await conversationRow(env,projectId,userId);
    const incidents=await (await import('./canvas-agent-incidents.js')).canvasIncidentConversationProjection(env,projectId,userId);
    const incidentTurns=new Map(incidents.records.map(item=>[item.turn_id,item]));
    // Operation receipts are authoritative. Projection repairs never dispatch.
    await env.DB.prepare(`UPDATE canvas_agent_turns SET state=CASE WHEN (SELECT status FROM canvas_agent_runs WHERE id=run_id)='review_required' THEN 'review_required'
        WHEN (SELECT status FROM canvas_agent_runs WHERE id=run_id) IN ('cancelled','taken_over') THEN 'cancelled' ELSE 'failed' END,
        error_code=(SELECT error_code FROM canvas_agent_runs WHERE id=run_id),updated_at=?
        WHERE project_id=? AND state='pending' AND run_id IN (SELECT id FROM canvas_agent_runs WHERE status IN ('blocked','review_required','cancelled','taken_over'))`).bind(nowIso(),projectId).run();
    const turns=(await env.DB.prepare(`SELECT t.*,r.model_id AS reply_model_id,s.receipt_json AS dialogue_receipt,s.input_json AS dialogue_input,${applicationReceiptSelect}
        FROM canvas_agent_turns t LEFT JOIN canvas_agent_runs r ON r.id=t.run_id
        LEFT JOIN canvas_agent_steps s ON s.run_id=t.run_id AND s.step_key='dialogue'
        WHERE t.project_id=? AND t.state!='deleted'
        AND (NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=t.id)
          OR t.id IN (SELECT x.turn_id FROM canvas_agent_incident_explanations x JOIN canvas_agent_turns latest ON latest.id=x.turn_id
            WHERE latest.project_id=t.project_id ORDER BY latest.rowid DESC LIMIT 32))
        ORDER BY t.rowid`).bind(projectId).all()).results;
    const evidence=await canvasDialogueProjectEvidence(env,projectId),byTurn=new Map(evidence.map(item=>[item.turn_id,item]));
    const blockers=evidence.map(item=>({...canvasDialogueDelivery(item),turnId:item.turn_state==='deleted'?null:item.turn_id})).filter(item=>item.blocking);
    for(const turn of turns)turn.incident_explanation=incidentTurns.get(turn.id)||null;
    const messages=turns.flatMap(t=>[...(t.user_text?[{id:t.id,role:'user',text:t.user_text,status:'completed',provenance:'user',kind:'message'}]:[]),...(t.assistant_text?[{id:`${t.id}:reply`,role:'assistant',text:canvasConversationReplyText(t),status:'completed'}]
        :[{id:`${t.id}:reply`,role:'assistant',text:'',status:t.state,code:t.error_code||null}])].map(message=>message.role==='assistant'
            ?{...message,...canvasConversationReplySource(t,actions),delivery:canvasDialogueDelivery(byTurn.get(t.id))}:message));
    const costs=await conversationCosts(env,projectId),tariff=await getModelTariff(env);
    let suggestedAllowanceCredits=null;
    try {
        const modelId=canvasAssistantModelId(row.assistant_model_id);
        const ceiling=await quoteModelTariff(env,{modelId,input:{prompt:'x'.repeat(CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES),
            system:canvasAgentSystem('briefing')+JSON.stringify(CANVAS_AGENT_DIALOGUE_SCHEMA),maxTokens:CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS,
            ...(modelId===CANVAS_FABLE_MODEL?{canvasFableAdmission:CANVAS_FABLE_ADMISSION_VERSION}:{canvasGrokAdmission:CANVAS_GROK_ADMISSION_VERSION})}});
        suggestedAllowanceCredits=Math.min(100000,costs.committed+ceiling.credits);
    } catch { /* Unpriced inference stays unavailable; no fabricated tariff. */ }
    const production=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' ORDER BY rowid DESC LIMIT 1").bind(projectId,userId).first();
    const models=await (await import('./canvas-agent-assistant-models.js')).canvasAssistantModelInventory(env);
    const selectedModel=row.assistant_model_id||CANVAS_AGENT_MODEL;
    return {...(production?{run:await publicAgentRun(env,production)}:{}),conversation:{revision:row.revision,explanationRevision:incidents.revision,briefRevision:row.brief_revision,state:row.state,draft:row.draft,
        messages,actions,brief:JSON.parse(row.brief_json),pendingTurnId:turns.find(t=>t.state==='pending')?.id||null,
        reasoningModel:{modelId:selectedModel,displayName:models.find(model=>model.modelId===selectedModel)?.displayName||selectedModel,revision:row.assistant_model_revision||0,eligibleModels:models},
        pendingDecision:await (await import('./canvas-agent-conversation-decisions.js')).publicCanvasConversationDecision(env,projectId,userId),
        canSend:row.state==='active'&&blockers.length===0,blockingOperation:blockers[0]||null,
        immediateIntent:await (await import('./canvas-agent-immediate.js')).publicCanvasImmediateIntent(env,projectId),
        allowance:{capCredits:row.allowance_credits,diagnosticsAuthorized:row.diagnostic_allowance===1,committedCredits:costs.committed,chargedCredits:costs.charged,
            reservedCredits:costs.reserved,pendingOutcomeCredits:costs.pending,
            remainingCredits:Math.max(0,row.allowance_credits-costs.committed),tariffRevision:tariff.revision,suggestedAllowanceCredits}},
        availability:await (await import('./canvas-agent-assistant-models.js')).canvasAssistantAvailability(env,selectedModel,{dialogue:true})};
}
// A model reply and an application action receipt have different authors and
// identities. Recover the original validated answer from historical receipts
// whose old UI projection replaced it with a generic action acknowledgement.
const historicalOperationAcknowledgement=turn=>['Dein Auftrag ist gespeichert. Die Ergebnisse erscheinen hier.','Your request is saved. Its results will appear here.'].some(text=>turn.assistant_text?.startsWith(text));
export function canvasConversationReplyText(turn) {
    const replaced=historicalOperationAcknowledgement(turn);
    if(replaced&&turn.run_id&&turn.dialogue_receipt&&turn.dialogue_input){try{
        const input=JSON.parse(turn.dialogue_input),receipt=JSON.parse(turn.dialogue_receipt);
        const dialogue=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,{messageId:turn.id,dialogueVersion:input.payload.version,projectRevision:input.payload.projectRevision});
        if(dialogue.actions?.length){
            const question=input.askDuration?durationQuestion(input.payload.locale):null;
            return question&&!/(?:duration|how long|wie lang|dauer)/i.test(dialogue.text)?`${dialogue.text}\n\n${question}`:dialogue.text;
        }
    }catch{/* Invalid historical evidence cannot manufacture a replacement reply. */}}
    return turn.assistant_text;
}
export function canvasConversationReplySource(turn,actions=[]) {
    if(!turn.incident_explanation&&turn.incident_explanation_json){try{turn.incident_explanation=JSON.parse(turn.incident_explanation_json);}catch{/* Malformed derived attribution is never promoted to model output. */}}
    if(turn.incident_explanation){const incident=turn.incident_explanation;return {
        provenance:incident.state==='model'?'model':'application',kind:'incident_explanation',incidentId:incident.incident_id,
        sourceNotificationId:incident.source_notification_id,incidentState:incident.incident_state,
        ...(incident.state==='model'?{modelId:turn.reply_model_id||CANVAS_AGENT_MODEL}:{})};}
    if(turn.application_receipt===1)return {provenance:'application',kind:'operation_ack'};
    if(turn.run_id&&historicalOperationAcknowledgement(turn)&&canvasConversationReplyText(turn)===turn.assistant_text)
        return {provenance:'application',kind:'operation_ack'};
    if(turn.run_id){
        const proposed=actions.filter(action=>action.turnId===turn.id&&!['status','brief_summary','show_project','show_result','focus_node'].includes(action.type));
        return {provenance:'model',kind:'answer',modelId:turn.reply_model_id||CANVAS_AGENT_MODEL,
            ...(proposed.length?{proposedActions:{source:'action_receipts',ids:proposed.map(action=>action.id),
                state:proposed.every(action=>action.state==='completed')?'completed':proposed.some(action=>['failed','review_required','cancelled'].includes(action.state))?'attention_required':'unconfirmed'}}:{})};
    }
    const related=actions.filter(action=>action.turnId===turn.id),control=detectCanvasDirectControl(turn.user_text);
    if(control==='status'||canvasConversationReadIntent(turn.user_text))return {provenance:'application',kind:'local_explanation'};
    return {provenance:'application',kind:related.length||control?'operation_ack':'decision'};
}
export async function canvasConversationBlocker(env,projectId) {
    const evidence=await canvasDialogueProjectEvidence(env,projectId);
    return evidence.map(item=>canvasDialogueDelivery(item)).find(item=>item.blocking)||null;
}
// Recover only the local follow-up of an already accepted ready reply. This
// reads its pinned receipt; it neither reruns inference nor reapplies the brief.
async function ensureCompletedConversationBudgetQuestion(env,run){
    const saved=await env.DB.prepare(`SELECT t.id,t.state,t.user_text,s.input_json,s.receipt_json FROM canvas_agent_turns t
        JOIN canvas_agent_steps s ON s.run_id=t.run_id AND s.step_key='dialogue'
        WHERE t.run_id=? AND t.state='completed' AND s.status='completed'`).bind(run.id).first();
    if(!saved?.receipt_json||canvasConversationReadIntent(saved.user_text))return;
    const input=JSON.parse(saved.input_json),receipt=JSON.parse(saved.receipt_json);
    const dialogue=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,{messageId:saved.id,dialogueVersion:input.payload.version,projectRevision:input.payload.projectRevision});
    if(dialogue?.intent==='ready')await (await import('./canvas-agent-conversation-decisions.js')).ensureCanvasConversationBudgetQuestion(env,run.project_id,run.user_id);
}
// Observation can normalize/settle an existing receipt and project its saved
// dialogue. It cannot call executeCanvasAgentModel or start any ready request.
export async function observeCanvasConversationReceipts(env,projectId,userId) {
    await (await import('./canvas-agent-incident-model.js')).reconcileCanvasIncidentExplanations(env,{projectId,userId});
    const evidence=await canvasDialogueProjectEvidence(env,projectId);
    const {reconcileCanvasAgentModelOperations}=await import('./canvas-agent-model-operations.js');
    const actionable=evidence.filter(item=>{
        const settlement=(!['completed','rejected'].includes(item.step_status)||item.billing_status==='reserved'&&!item.reservation_released_at)
            &&!(item.reconcile_attempts>=5);
        const projection=(['pending','review_required','failed'].includes(item.turn_state)&&item.step_status==='completed'
            ||['pending','review_required'].includes(item.turn_state)&&item.step_status==='rejected'
            ||item.turn_state==='completed'&&item.step_status==='completed'&&['queued','planning','running','blocked','review_required'].includes(item.run_status))
            &&!(item.storage_attempts>=3);
        return (item.response_stored||['completed','rejected'].includes(item.operation_state))&&(settlement||projection);
    });
    for(const item of actionable.slice(0,20)){
        if(!['completed','rejected'].includes(item.step_status)||item.billing_status==='reserved'&&!item.reservation_released_at)
            await reconcileCanvasAgentModelOperations(env,{runId:item.run_id});
        if(await env.DB.prepare('SELECT incident_id FROM canvas_agent_incident_explanations WHERE model_run_id=?').bind(item.run_id).first()){
            await (await import('./canvas-agent-incident-model.js')).reconcileCanvasIncidentExplanations(env,{projectId,userId});
            continue;
        }
        const current=await env.DB.prepare(`SELECT r.*,s.status AS dialogue_status,t.state AS turn_state
            FROM canvas_agent_runs r JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue'
            JOIN canvas_agent_turns t ON t.run_id=r.id WHERE r.id=? AND r.user_id=?`).bind(item.run_id,userId).first();
        if(current?.dialogue_status==='completed'&&current.turn_state==='completed'){
            // The transcript transaction can commit before the final run write.
            // Close only that evidenced tail; never apply the brief a second time.
            // Finish the local question first, leaving this tail recoverable if storage fails.
            await ensureCompletedConversationBudgetQuestion(env,current);
            await env.DB.prepare(`UPDATE canvas_agent_runs SET status='completed',error_code=NULL,cause_json=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
                WHERE id=? AND status IN ('queued','planning','running','blocked','review_required')
                AND EXISTS(SELECT 1 FROM canvas_agent_turns t WHERE t.run_id=canvas_agent_runs.id AND t.state='completed')`)
                .bind(nowIso(),current.id).run();
            continue;
        }
        if(current?.dialogue_status==='rejected'&&['pending','review_required'].includes(current.turn_state)){
            // A finalized invalid result or proven rejection is terminal. Its
            // old pending-turn mutex must not contradict the nonblocking view.
            await env.DB.batch([env.DB.prepare(`UPDATE canvas_agent_runs SET status='blocked',error_code=?,lease_token=NULL,lease_until=NULL,updated_at=?
                WHERE id=? AND status IN ('queued','planning','running','blocked','review_required','completed')`)
                .bind(item.operation_error||'canvas_agent_dialogue_invalid',nowIso(),current.id),
                env.DB.prepare(`UPDATE canvas_agent_turns SET state='failed',error_code=?,updated_at=? WHERE run_id=? AND state IN ('pending','review_required')
                    AND EXISTS(SELECT 1 FROM canvas_agent_runs r WHERE r.id=canvas_agent_turns.run_id AND r.status='blocked')`)
                    .bind(item.operation_error||'canvas_agent_dialogue_invalid',nowIso(),current.id)]);
            continue;
        }
        if(!current||current.dialogue_status!=='completed'||!['pending','review_required','failed'].includes(current.turn_state)
            ||!['queued','planning','running','blocked','review_required','completed'].includes(current.status)
            ||JSON.parse(current.cause_json||'{}').storageAttempts>=3
            ||JSON.parse(current.cause_json||'{}').storageAttempts>0&&current.next_attempt_at>nowIso())continue;
        await env.DB.prepare(`UPDATE canvas_agent_runs SET status='planning',error_code=NULL,next_attempt_at=? WHERE id=?
            AND status IN ('queued','planning','running','blocked','review_required','completed') AND (lease_until IS NULL OR lease_until<=?)
            AND NOT EXISTS(SELECT 1 FROM canvas_agent_runs newer WHERE newer.project_id=? AND newer.purpose='briefing'
                AND newer.id!=? AND newer.status IN ('queued','planning','running','exporting'))`)
            .bind(nowIso(),current.id,nowIso(),projectId,current.id).run();
        const run=await claimCanvasAgent(env,current.id);if(!run)continue;
        try {await processCanvasAgentConversation(env,run,{id:userId},0,true);}
        catch(error){
            const failure=await canvasDialogueFailure(env,run,error);
            const storageAttempts=(JSON.parse(current.cause_json||'{}').storageAttempts||0)+1;
            await env.DB.prepare('UPDATE canvas_agent_runs SET status=?,error_code=?,cause_json=?,updated_at=? WHERE id=? AND lease_token=?')
                .bind(failure.status,failure.code,JSON.stringify({...failure.cause,storageAttempts}),nowIso(),run.id,run.lease_token).run();
            logCanvasDialogueStage(failure.cause.stage,{runId:run.id,code:failure.code,receiptState:'completed'});
        } finally {
            await env.DB.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=?')
                .bind(new Date(Date.now()+60_000).toISOString(),nowIso(),run.id,run.lease_token).run();
        }
    }
}
export function conversationGuard(env,row) {
    return env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_conversations c JOIN canvas_projects p ON p.id=c.project_id
        JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.user_id=? AND c.revision=? AND c.brief_revision=?
        AND p.deleted_at IS NULL AND u.status='active') THEN 1 ELSE json_extract('[]','$[') END`).bind(row.project_id,row.user_id,row.revision,row.brief_revision);
}
export async function changeCanvasAssistantModel(env,userId,projectId,input) {
    if(!input||typeof input.modelId!=='string'||Object.keys(input).some(key=>!['modelId','conversationRevision','modelRevision','key'].includes(key))
        ||!Number.isSafeInteger(input.conversationRevision)||input.conversationRevision<0
        ||!Number.isSafeInteger(input.modelRevision)||input.modelRevision<0
        ||typeof input.key!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(input.key))agentFail('canvas_agent_model_selection_invalid',400);
    const modelId=canvasAssistantModelId(input.modelId),serialized=JSON.stringify(input);
    const project=await env.DB.prepare('SELECT id FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(projectId,userId).first();
    if(!project)agentFail('canvas_project_not_found',404);
    const previous=await env.DB.prepare('SELECT * FROM canvas_agent_model_selections WHERE project_id=? AND user_id=? AND request_key=?').bind(projectId,userId,input.key).first();
    if(previous){if(previous.input_json!==serialized)agentFail('canvas_agent_idempotency_conflict');return previous;}
    const row=await ensureConversation(env,projectId,userId);
    if(row.revision!==input.conversationRevision||(row.assistant_model_revision||0)!==input.modelRevision)agentFail('canvas_agent_conversation_changed');
    const available=await canvasAssistantAvailability(env,modelId,{dialogue:true});
    if(!available.available)agentFail(available.code,503);
    const nextRevision=(row.assistant_model_revision||0)+(canvasAssistantModelId(row.assistant_model_id)!==modelId?1:0),now=nowIso();
    const statements=[conversationGuard(env,row),
        env.DB.prepare(`UPDATE canvas_agent_conversations SET assistant_model_id=?,assistant_model_revision=?,revision=revision+1,updated_at=?
            WHERE project_id=? AND user_id=? AND assistant_model_revision=?`)
            .bind(modelId,nextRevision,now,projectId,userId,input.modelRevision),
        env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
        env.DB.prepare(`INSERT INTO canvas_agent_model_selections(project_id,user_id,request_key,input_json,model_id,model_revision,created_at) VALUES(?,?,?,?,?,?,?)`)
            .bind(projectId,userId,input.key,serialized,modelId,nextRevision,now)];
    if(nextRevision!==input.modelRevision)statements.push(env.DB.prepare(`UPDATE canvas_agent_start_intents SET state='cancelled',error_code='canvas_agent_model_changed',updated_at=?
        WHERE project_id=? AND user_id=? AND state IN ('waiting','approval_required','authorized')`).bind(now,projectId,userId));
    await env.DB.batch(statements);
    return {modelId,revision:nextRevision};
}
export function pauseForBriefChange(env,projectId) {
    return env.DB.prepare(`UPDATE canvas_agent_runs SET status='paused',error_code='canvas_agent_brief_changed',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE project_id=? AND purpose='production' AND status IN ('queued','planning','running','exporting')`).bind(nowIso(),projectId);
}
export function conversationLocale(view) { return view.project?.locale==='de'?'de':'en'; }
async function localControlTurn(env,view,row,input,key) {
    const type=detectCanvasDirectControl(input.text);if(!type)return false;
    if(type==='status')return localExplanationTurn(env,row,input,key,canvasConversationStatusText(await canvasConversationExecutionFacts(env,row.user_id,row.project_id),input.locale));
    const id=randomTokenHex(16),now=nowIso();
    const actions=[{type,targetId:null,value:null,number:null,secondaryNumber:null,ids:[],revision:view.project.revision}];
    const receipts=await prepareCanvasAgentActionStatements(env,{userId:row.user_id,projectId:row.project_id,turnId:id,actions,expectedRevision:view.project.revision,locale:input.locale});
    await env.DB.batch([conversationGuard(env,row),env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(now,row.project_id),
        env.DB.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'completed',?,?)")
          .bind(id,row.project_id,key,JSON.stringify(input),row.revision+1,row.brief_revision,input.text,input.locale==='de'?'Dein Auftrag ist gespeichert.':'Your request is saved.',now,now),...receipts]);
    await executeCanvasAgentActions(env,{userId:row.user_id,projectId:row.project_id,turnId:id});
    return true;
}
async function localExplanationTurn(env,row,input,key,text) {
    const now=nowIso();
    await env.DB.batch([conversationGuard(env,row),env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(now,row.project_id),
        env.DB.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'completed',?,?)")
            .bind(randomTokenHex(16),row.project_id,key,JSON.stringify(input),row.revision+1,row.brief_revision,input.text,text,now,now)]);
    return true;
}
export async function createConversationTurn(env,view,row,input,key) {
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_turns t WHERE project_id=? AND state!='deleted' AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=t.id)").bind(row.project_id).first();
    if(count.n>=80)agentFail('canvas_agent_conversation_limit');
    if(await localControlTurn(env,view,row,input,key))return;
    const readIntent=canvasConversationReadIntent(input.text);
    if(readIntent==='reconcile_explanation')return localExplanationTurn(env,row,input,key,
        canvasReconcileExplanation(await canvasConversationExecutionFacts(env,row.user_id,row.project_id),input.text,input.locale));
    const modelId=canvasAssistantModelId(row.assistant_model_id);
    const available=await canvasAgentDialogueAvailability(env,modelId);
    if(readIntent&&(!available.available||row.allowance_credits<=(await conversationCosts(env,row.project_id)).committed))return localExplanationTurn(env,row,input,key,
        (input.locale==='de'?'Canvas-Systemauskunft: Eine Modellantwort ist derzeit nicht freigegeben oder nicht verfügbar. Eine Frage oder ein zitiertes Kommando führt keine Aktion aus. Die gespeicherten Fakten sind:\n':'Canvas system information: A model reply is not currently authorized or available. A question or a quoted command does not execute an action. The stored facts are:\n')+
        canvasConversationStatusText(await canvasConversationExecutionFacts(env,row.user_id,row.project_id),input.locale));
    if(!available.available)agentFail(available.code,503);
    const inventory=await canvasAgentCapabilities(env),costs=await conversationCosts(env,row.project_id);
    if(row.state!=='active')agentFail('canvas_agent_conversation_saved');
    if(row.allowance_credits<=costs.committed)agentFail('canvas_agent_briefing_allowance_required',402);
    if(inventory.tariffRevision!==row.allowance_tariff)agentFail('model_pricing_stale');

    const pending=await canvasConversationBlocker(env,row.project_id);
    if(pending)agentFail('canvas_agent_conversation_pending');
    const id=randomTokenHex(16),runId=randomTokenHex(16),stepId=randomTokenHex(16),now=nowIso();
    const brief=JSON.parse(row.brief_json),duration=readIntent?null:userDuration(input.text,brief,id);
    if(duration)brief.duration=duration;
    const delegateOptional=/^(?:enough questions|no more questions|stop asking questions|genug fragen|keine weiteren fragen)[.!]?$/i.test(input.text.trim());
    if(delegateOptional){
        brief.fields.delegatedChoices={value:'Choose suitable defaults for optional creative details; duration and spending remain separate.',provenance:'delegated',sourceMessageId:id,revision:row.brief_revision+1};
        brief.openQuestions=[];
    }
    // A free, deterministic first question is persisted even if inference fails.
    const askDuration=!readIntent&&!brief.duration.choice&&!brief.duration.asked;
    if(askDuration)brief.duration.asked=true;
    const recent=(await env.DB.prepare(`SELECT t.id,t.run_id,t.user_text,t.assistant_text,r.model_id AS reply_model_id,
        (SELECT json_object('incident_id',x.incident_id,'state',x.state,'source_notification_id',i.source_notification_id,'incident_state',i.state)
          FROM canvas_agent_incident_explanations x JOIN canvas_agent_incidents i ON i.id=x.incident_id WHERE x.turn_id=t.id) AS incident_explanation_json,
        s.receipt_json AS dialogue_receipt,s.input_json AS dialogue_input,${applicationReceiptSelect} FROM canvas_agent_turns t
        LEFT JOIN canvas_agent_runs r ON r.id=t.run_id LEFT JOIN canvas_agent_steps s ON s.run_id=t.run_id AND s.step_key='dialogue'
        WHERE t.project_id=? AND t.state='completed' ORDER BY t.rowid DESC LIMIT 6`).bind(row.project_id).all()).results.reverse();
    const project=await canvasAgentActionContext(env,row.user_id,row.project_id);
    project.conversationSources=recent.filter(t=>t.assistant_text&&canvasConversationReplySource(t).kind!=='operation_ack')
        .map(t=>({id:`${t.id}_reply`,...canvasConversationReplySource(t)}));
    brief.revision=row.brief_revision+(duration||delegateOptional?1:0);
    const policy=await canvasAgentPolicyIdentity('briefing');
    const payload={version:CANVAS_AGENT_DIALOGUE_VERSION,model:modelId,requestId:runId,locale:input.locale,
        conversationRevision:row.revision+1,briefRevision:row.brief_revision+(duration||delegateOptional?1:0),projectRevision:view.project.revision,
        // A server-originated budget question has no user message. Preserve its
        // real assistant text without inventing an empty user history entry.
        message:{id,text:input.text},brief,recentMessages:recent.flatMap(t=>[...(t.user_text?[{id:t.id,role:'user',text:t.user_text}]:[]),...(t.assistant_text&&canvasConversationReplySource(t).kind!=='operation_ack'?[{id:`${t.id}_reply`,role:'assistant',text:canvasConversationReplyText(t).slice(0,6000)}]:[])]),
        capabilities:inventory,currentProject:project,policy,
        privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${row.user_id}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${row.user_id}:${row.project_id}`)}`};
    while(payload.recentMessages.length&&new TextEncoder().encode(JSON.stringify(payload)).byteLength>CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES)payload.recentMessages.splice(0,2);
    const quote=await quoteModelTariff(env,{modelId,input:dialoguePriceInput(payload)});
    if(quote.credits>row.allowance_credits-costs.committed)agentFail('canvas_agent_briefing_allowance_required',402);
    brief.revision=payload.briefRevision;
    const statements=[conversationGuard(env,row),env.DB.prepare(`UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,draft='',updated_at=? WHERE project_id=?`)
        .bind(brief.revision,JSON.stringify(brief),now,row.project_id),
        env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,phase,expected_revision,budget_credits,tariff_revision,capability_revision,next_attempt_at,created_at,updated_at,expires_at,purpose,policy_json,brief_revision,model_id,model_revision)
          VALUES(?,?,?,?,?,'queued','briefing',?,?,?,?,?,?,?,?,'briefing',?,?,?,?)`).bind(runId,row.project_id,row.user_id,`dialogue:${key}`,JSON.stringify(input),view.project.revision,row.allowance_credits,inventory.tariffRevision,inventory.revision,now,now,now,new Date(Date.now()+48*3600000).toISOString(),JSON.stringify(policy),brief.revision,modelId,row.assistant_model_revision||0),
        env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,'dialogue','plan',?,?,?,?)`)
            .bind(stepId,runId,JSON.stringify({modelId,payload,askDuration}),quote.credits,now,now),
        env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,run_id,conversation_revision,brief_revision,user_text,state,policy_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(id,row.project_id,key,JSON.stringify(input),runId,row.revision+1,brief.revision,input.text,JSON.stringify(policy),now,now)];
    if(duration||delegateOptional)statements.push(pauseForBriefChange(env,row.project_id));
    await env.DB.batch(statements);
    logCanvasDialogueStage('queued',{runId,stepId,turnId:id,dispatchState:'not_dispatched',receiptState:'none'});
    await wakeCanvasAgent(env,runId);
    return id;
}
export async function processCanvasAgentConversation(env,run,user,storageAttempt=0,receiptOnly=false) {
    if(await (await import('./canvas-agent-incident-model.js')).processCanvasIncidentExplanation(env,run,user,{receiptOnly}))return;
    const turn=await env.DB.prepare('SELECT * FROM canvas_agent_turns WHERE run_id=?').bind(run.id).first();
    const row=await conversationRow(env,run.project_id,run.user_id);
    if(!turn||turn.state==='deleted'||row?.state!=='active')agentFail('canvas_agent_conversation_stopped');
    if(!['pending','review_required'].includes(turn.state)&&!(receiptOnly&&turn.state==='failed')){
        if(turn.state==='completed')await ensureCompletedConversationBudgetQuestion(env,run);
        return agentTransition(env,run,{status:'completed',phase:'briefing'});
    }
    await agentTransition(env,run,{status:'planning',phase:'briefing'});
    const step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND step_key='dialogue'").bind(run.id).first();
    if(receiptOnly&&step.status!=='completed')return;
    const receipt=step.status==='completed'?JSON.parse(step.receipt_json):await executeCanvasAgentModel(env,run,step,user);
    if(!receipt)return;
    const acceptedInput=JSON.parse(step.input_json);
    const dialogue=validateCanvasAgentDialogueReply(receipt.dialogue||receipt.data?.dialogue,{messageId:turn.id,dialogueVersion:acceptedInput.payload.version,projectRevision:acceptedInput.payload.projectRevision});
    if(!dialogue||typeof dialogue.text!=='string'||!Array.isArray(dialogue.updates))agentFail('canvas_agent_dialogue_invalid');
    // A delayed accepted response is retained operationally, but never restores
    // deleted context or overwrites a newer brief. Status-only turns and
    // allowance acknowledgements may advance conversation revision independently.
    const current=await conversationRow(env,run.project_id,run.user_id);
    if(!current||current.state!=='active'||current.brief_revision!==turn.brief_revision){
        await env.DB.prepare("UPDATE canvas_agent_turns SET state='cancelled',error_code='canvas_agent_conversation_changed',updated_at=? WHERE id=? AND state!='deleted'").bind(nowIso(),turn.id).run();
        return agentTransition(env,run,{status:'completed',phase:'briefing'});
    }
    const brief=JSON.parse(current.brief_json),old=JSON.stringify(brief.fields),readOnly=Boolean(canvasConversationReadIntent(turn.user_text));
    for(const update of readOnly?[]:dialogue.updates){
        if(!BRIEF_FIELDS.includes(update.field)||update.sourceMessageId!==turn.id||typeof update.value!=='string'||update.value.length>1000)continue;
        if(update.field==='delegatedChoices'&&brief.fields.delegatedChoices?.sourceMessageId===turn.id&&brief.fields.delegatedChoices.provenance==='delegated')continue;
        const provenance=['user_stated','assistant_proposed','corrected','unresolved'].includes(update.provenance)?update.provenance:'assistant_proposed';
        brief.fields[update.field]={value:update.value,provenance,sourceMessageId:turn.id,revision:current.brief_revision+1};
    }
    const changed=old!==JSON.stringify(brief.fields);
    if(!readOnly)brief.openQuestions=Array.isArray(dialogue.questions)?dialogue.questions.slice(0,2):[];
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
        env.DB.prepare("UPDATE canvas_agent_turns SET state='completed',assistant_text=?,error_code=NULL,updated_at=? WHERE id=? AND state IN ('pending','review_required','failed')").bind(text.slice(0,8000),nowIso(),turn.id)];
    statements.push(...await prepareCanvasAgentActionStatements(env,{userId:run.user_id,projectId:run.project_id,turnId:turn.id,actions:readOnly?[]:dialogue.actions||[],expectedRevision:acceptedInput.payload.projectRevision,expectedControlId:acceptedInput.payload.currentProject.lastControlId,locale:acceptedInput.payload.locale}));
    if(changed&&dialogue.updates.some(u=>['user_stated','corrected'].includes(u.provenance)))statements.push(pauseForBriefChange(env,run.project_id));
    try {await env.DB.batch(statements);} catch(error) {
        const latest=await conversationRow(env,run.project_id,run.user_id);
        if(latest&&latest.revision!==current.revision&&storageAttempt<2)
            return processCanvasAgentConversation(env,run,user,storageAttempt+1,receiptOnly);
        throw error;
    }
    await agentTransition(env,run,{status:'completed',phase:'briefing',error_code:null,cause_json:null});
    await executeCanvasAgentActions(env,{userId:run.user_id,projectId:run.project_id,turnId:turn.id});
    if(!readOnly&&dialogue.intent==='ready')await (await import('./canvas-agent-conversation-decisions.js')).ensureCanvasConversationBudgetQuestion(env,run.project_id,run.user_id);
    logCanvasDialogueStage('completed',{runId:run.id,stepId:step.id,turnId:turn.id,dispatchState:'succeeded',receiptState:'completed'});
}
export function productionBrief(row) {
    const brief=JSON.parse(row.brief_json);
    return [Object.entries(brief.fields).map(([name,entry])=>`${name} (${entry.provenance}): ${entry.value}`).join('\n'),
        brief.duration.choice==='delegated'?'Duration explicitly delegated by the user.':`Target duration: ${brief.duration.targetDurationSeconds} seconds.`].join('\n');
}
