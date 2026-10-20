import { canvasConversationReadIntent } from '../../../../js/shared/canvas-agent-control-intent.mjs';
export { canvasConversationReadIntent };
import { nowIso } from './tokens.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { publicCanvasAgentModelOperation } from './canvas-agent-store.js';

const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};
const code=value=>typeof value==='string'&&/^[a-z][a-z0-9_.:-]{0,119}$/.test(value)?value:null;
const nodeKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value)?value:null;
const rows=result=>result.results||[];

// These are observations of the existing ledgers, never a second execution or
// memory store. No status read may dispatch, reconcile, save or acquire a lease.
export async function canvasConversationExecutionFacts(env,userId,projectId) {
  const project=await env.DB.prepare("SELECT p.id,p.revision FROM canvas_projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL AND u.status='active'").bind(projectId,userId).first();
  if(!project)throw Object.assign(new Error('canvas_project_not_found'),{code:'canvas_project_not_found',status:404});
  const observedAt=nowIso();
  const run=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(projectId,userId).first();
  const [conversation,briefing,actions,decisions,exports,events,steps,totals,budget,operation,proposal,incidents]=await Promise.all([
    env.DB.prepare('SELECT allowance_credits,allowance_tariff,revision,brief_revision,assistant_model_id,assistant_model_revision FROM canvas_agent_conversations WHERE project_id=? AND user_id=?').bind(projectId,userId).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(c.charged),0) AS charged,COALESCE(SUM(c.committed),0) AS committed,
      COALESCE(SUM(c.reserved),0) AS reserved,COALESCE(SUM(c.pending),0) AS pending FROM canvas_agent_step_costs c
      JOIN canvas_agent_runs r ON r.id=c.run_id WHERE c.project_id=? AND r.user_id=? AND r.purpose='briefing'`).bind(projectId,userId).first(),
    env.DB.prepare('SELECT id,turn_id,state,input_json,result_json,updated_at FROM canvas_agent_action_receipts WHERE project_id=? AND user_id=? ORDER BY rowid DESC LIMIT 8').bind(projectId,userId).all(),
    env.DB.prepare("SELECT id,kind,state,scope_json,expires_at FROM canvas_agent_conversation_decisions WHERE project_id=? AND user_id=? AND state='pending' ORDER BY rowid DESC LIMIT 1").bind(projectId,userId).first(),
    env.DB.prepare(`SELECT p.id,p.status,p.asset_id,p.error_code,p.created_at,p.updated_at,p.recipe_json,v.state AS retention_state,
      CASE WHEN h.current_id=p.id THEN 1 ELSE 0 END AS current_export
      FROM canvas_video_processing p LEFT JOIN canvas_export_versions v ON v.id=p.id
      LEFT JOIN canvas_export_heads h ON h.current_id=p.id
      WHERE p.project_id=? AND p.user_id=? AND p.kind='concat' ORDER BY p.created_at DESC LIMIT 4`).bind(projectId,userId).all(),
    run?env.DB.prepare('SELECT id,type,payload_json,created_at FROM canvas_agent_events WHERE run_id=? ORDER BY id DESC LIMIT 16').bind(run.id).all():{results:[]},
    run?env.DB.prepare('SELECT id,node_id,kind,status,updated_at,receipt_json FROM canvas_agent_steps WHERE run_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 12').bind(run.id).all():{results:[]},
    run?env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status='completed'),0) AS completed FROM canvas_agent_steps WHERE run_id=? AND kind='node'").bind(run.id).first():{total:0,completed:0},
    run&&run.budget_credits!==null?readCanvasAgentBudget(env,run):null,
    run?publicCanvasAgentModelOperation(env,run.id):null,
    run?env.DB.prepare('SELECT step_id,status,validation_json,updated_at FROM canvas_agent_proposals WHERE run_id=? ORDER BY rowid DESC LIMIT 1').bind(run.id).first():null,
    env.DB.prepare('SELECT id,revision,state,source_notification_id,context_json FROM canvas_agent_incidents WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 8').bind(projectId,userId).all(),
  ]);
  const sourceRows=rows(steps),scope=parse(decisions?.scope_json),cause=parse(run?.cause_json);
  const fresh=await env.DB.prepare(`SELECT p.revision,r.updated_at FROM canvas_projects p LEFT JOIN canvas_agent_runs r ON r.id=?
    WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL`).bind(run?.id||null,projectId,userId).first();
  return {version:1,observedAt,observedUntil:nowIso(),projectRevision:project.revision,source:'persisted_project_receipts',
    changedDuringObservation:!fresh||fresh.revision!==project.revision||Boolean(run&&fresh.updated_at!==run.updated_at),
    conversation:conversation?{revision:conversation.revision,briefRevision:conversation.brief_revision,
      selectedModelId:conversation.assistant_model_id,modelRevision:conversation.assistant_model_revision}:null,
    production:run?{id:run.id,status:run.status,phase:run.phase,modelId:run.model_id,expectedProjectRevision:run.expected_revision,
      projectChanged:run.expected_revision!==project.revision,errorCode:code(run.error_code),updatedAt:run.updated_at,
      expiresAt:run.expires_at,nextAttemptAt:run.next_attempt_at,authorityExpired:run.expires_at<=observedAt,
      completed:totals.completed,total:totals.total,repairAttempts:run.repair_attempts||0,
      cause:cause?{code:code(cause.code),step:code(cause.step),recovery:code(cause.recovery)}:null,
      validation:proposal?{stepId:proposal.step_id,status:proposal.status,updatedAt:proposal.updated_at,
        issues:(parse(proposal.validation_json)?.issues||[]).slice(0,8).map(issue=>({code:code(issue.code),nodeKey:nodeKey(issue.nodeKey)}))}:null,
      operation,steps:sourceRows.map(s=>{const receipt=parse(s.receipt_json);return {id:s.id,nodeId:s.node_id,kind:s.kind,status:s.status,
        updatedAt:s.updated_at,receipt:receipt?{stored:true,ok:receipt.ok===true,outcome:code(receipt.outcome),code:code(receipt.code),
          assetId:receipt.assetId||receipt.asset?.id||null}:null};})}:null,
    budgets:{project:budget?{...budget,sourceRunId:run.id}:null,briefing:conversation?{capCredits:conversation.allowance_credits,
      chargedCredits:briefing.charged,committedCredits:briefing.committed,reservedCredits:briefing.reserved,
      pendingOutcomeCredits:briefing.pending,remainingCredits:Math.max(0,conversation.allowance_credits-briefing.committed),tariffRevision:conversation.allowance_tariff}:null},
    recentEvents:rows(events).map(event=>{const payload=parse(event.payload_json)||{};return {id:event.id,runId:run.id,at:event.created_at,
      type:code(event.type),code:code(payload.code),tool:code(payload.tool),phase:code(payload.phase)};}),
    incidents:rows(incidents).map(item=>{const context=parse(item.context_json)||{};return {id:item.id,revision:item.revision,state:item.state,
      sourceNotificationId:item.source_notification_id,observedAt:context.observedAt,source:context.source,affected:context.affected,
      operation:context.operation,validation:context.validation,retained:context.retained};}),
    recentActions:rows(actions).map(action=>{const input=parse(action.input_json)||{},result=parse(action.result_json)||{};return {
      id:action.id,turnId:action.turn_id,type:code(input.action?.type),state:action.state,pending:result.pending===true,
      code:code(result.code),updatedAt:action.updated_at,confirmationRequired:action.state==='confirmation_required'};}),
    pendingDecision:decisions?{id:decisions.id,kind:decisions.kind,state:decisions.state,expiresAt:decisions.expires_at,
      expired:decisions.expires_at<=observedAt,capCredits:scope?.capCredits??null,
      applicable:decisions.expires_at>observedAt&&scope?.projectRevision===project.revision&&scope?.briefRevision===conversation?.brief_revision
        &&scope?.questionConversationRevision===conversation?.revision&&scope?.modelId===conversation?.assistant_model_id&&scope?.modelRevision===conversation?.assistant_model_revision}:null,
    exports:rows(exports).map(item=>{const recipe=parse(item.recipe_json);return {id:item.id,status:item.status,assetId:item.asset_id,
      errorCode:code(item.error_code),createdAt:item.created_at,updatedAt:item.updated_at,current:item.current_export===1,
      saved:item.retention_state==='saved'&&Boolean(item.asset_id),musicEnabled:recipe?.backgroundMusic?.enabled===true,
      sourceProjectRevision:recipe?.assembly?.projectRevision??recipe?.assembly?.revision??null};}),
  };
}

export function canvasConversationStatusText(facts,locale='en') {
  const de=locale==='de',run=facts.production,budget=facts.budgets.project;
  if(!run)return de?'In diesem Projekt wurde noch keine Produktion gestartet.':'No production has been started in this project.';
  const states={queued:['waiting','vorgemerkt'],planning:['planning','Planung'],applying:['saving the plan','Plan speichern'],running:['producing','Produktion läuft'],exporting:['exporting','Export läuft'],completed:['completed','abgeschlossen'],paused:['paused','pausiert'],cancelled:['stopped','gestoppt'],taken_over:['manual control','manuelle Kontrolle'],blocked:['blocked','blockiert'],review_required:['needs review','Prüfung erforderlich'],clarification_required:['needs clarification','Rückfrage erforderlich']};
  const state=states[run.status]?.[de?1:0]||run.status;
  const parts=[de?`Produktion: ${state}. ${run.completed} von ${run.total} geplanten Medienschritten sind abgeschlossen.`:`Production: ${state}. ${run.completed} of ${run.total} planned media steps are complete.`];
  if(facts.changedDuringObservation)parts.push(de?'Der Projekt- oder Produktionsstand änderte sich während der Abfrage. Diese Angaben sind eine Momentaufnahme, keine Freigabe für weitere Arbeit.':'The project or production changed during observation. These values are a snapshot, not authorization for further work.');
  if(run.errorCode)parts.push(de?`Aktuell gespeicherter Fehler: ${run.errorCode}.`:`Current recorded error: ${run.errorCode}.`);
  if(budget)parts.push(de?`Freigegebenes Projektlimit: ${budget.capCredits} Credits. Abgebucht: ${budget.chargedCredits}; reserviert: ${budget.reservedCredits}; ungeklärter Ausgang: ${budget.pendingOutcomeCredits}. Verfügbarer Projektrahmen: ${budget.remainingCredits} Credits.`:`Authorized project cap: ${budget.capCredits} credits. Charged: ${budget.chargedCredits}; reserved: ${budget.reservedCredits}; uncertain outcome: ${budget.pendingOutcomeCredits}. Remaining project headroom: ${budget.remainingCredits} credits.`);
  if(facts.budgets.briefing)parts.push(de?`Das gesonderte Gesprächsbudget beträgt ${facts.budgets.briefing.capCredits} Credits. Es erhöht das Projektlimit nicht.`:`The separate briefing allowance is ${facts.budgets.briefing.capCredits} credits. It does not increase the project cap.`);
  parts.push(de?`Stand: ${facts.observedAt}. Reservierungen und ungeklärte Beträge können sich überschneiden; sie sind keine zusätzlichen Abbuchungen.`:`Observed: ${facts.observedAt}. Reserved and uncertain amounts may overlap; they are not additional charges.`);
  return parts.join('\n');
}

export function canvasReconcileExplanation(facts,text,locale='en') {
  const de=locale==='de',events=facts.recentEvents.filter(e=>e.tool==='production.reconcile'),time=String(text).match(/\b\d{1,2}:\d{2}:\d{2}\b/)?.[0];
  const parts=[de?'„production.reconcile“ bezeichnet den Abgleich einer bestehenden Produktion mit ihren gespeicherten Ergebnissen. Es ist ein technischer Schrittname, keine Fehlerursache und kein neuer Generierungsauftrag.':'“production.reconcile” names the reconciliation of an existing production with its stored results. It is a technical step name, not an error cause or a new generation request.'];
  if(events.length){
    const event=events[0];
    parts.push(de?`Der jüngste dazu gelesene Hinweis in dieser Produktion ist vom ${event.at} (UTC), Code: ${event.code||'nicht gespeichert'}.`:`The latest matching event read for this production is dated ${event.at} (UTC), code: ${event.code||'not recorded'}.`);
    if(time)parts.push(de?`Die angezeigte Uhrzeit ${time} lässt sich ohne Datum und Zeitzone nicht eindeutig diesem Ereignis zuordnen.`:`The displayed time ${time} cannot be matched uniquely without its date and time zone.`);
    if(event.code!==facts.production?.errorCode)parts.push(de?'Das ist ein historischer Hinweis; er ist nicht der aktuell gespeicherte Run-Fehler.':'This is a historical event; it is not the currently recorded run error.');
    if(event.code==='canvas_agent_plan_correction_exhausted')parts.push(de?`Die begrenzten Planüberarbeitungen sind ausgeschöpft. Gespeicherte Korrekturversuche: ${facts.production?.repairAttempts||0}. Das bestätigt einen weiterhin unzulässigen Plan, nicht einen neuen Fehler der Videoerzeugung.`:`The bounded plan corrections have been exhausted. Recorded correction attempts: ${facts.production?.repairAttempts||0}. This confirms a plan that still fails validation, not a new video generation failure.`);
    const issues=facts.production?.validation?.issues?.map(issue=>issue.code).filter(Boolean)||[];
    if(issues.length)parts.push(de?`Zuletzt gespeicherte Planprüfung: ${[...new Set(issues)].join(', ')}.`:`Last recorded plan validation: ${[...new Set(issues)].join(', ')}.`);
    if(issues.includes('canvas_agent_trim_outside_planned_source')){
      const shots=facts.production.validation.issues.filter(issue=>issue.code==='canvas_agent_trim_outside_planned_source').map(issue=>issue.nodeKey).filter(Boolean);
      parts.push(de?`Der geplante Clipausschnitt ist länger als die für diesen Generierungsauftrag verfügbare Quelle${shots.length?` (Planschritt: ${shots.join(', ')})`:''}. Prüfe die Clipdauer und den Schnitt dieses Planschritts. Eine korrigierte Planung wäre ein eigener freizugebender Schritt; diese Erklärung ändert den Plan nicht und beauftragt keine neue Planung.`:`A planned clip trim exceeds the source duration available for that generation request${shots.length?` (plan step: ${shots.join(', ')})`:''}. Review that shot's clip duration and trim. A corrected plan would require its own valid authorization; this explanation changes no plan and requests no new planning.`);
    }
    if(issues.includes('canvas_agent_parameter_unsupported'))parts.push(de?'Die Planprüfung meldet eine Einstellung, die der gewählte Generator in Canvas nicht unterstützt. Prüfe die Einstellungen der genannten Planschritte anhand der verfügbaren Modelloptionen.':'Plan validation reports a setting that the selected Canvas generator does not support. Review the affected plan steps against the available model options.');
  }else parts.push(de?'Unter den zuletzt gespeicherten Ereignissen dieser Produktion finde ich keinen passenden Hinweis. Ich kann die zitierte Meldung daher keiner konkreten Ursache zuordnen.':'No matching event appears among the recent stored events for this production. I cannot assign the quoted message to a specific cause.');
  parts.push(canvasConversationStatusText(facts,locale));
  if(['blocked','review_required'].includes(facts.production?.status))parts.push(de?'Der nächste sichere Schritt ist die Prüfung des angegebenen Fehlercodes und der bestehenden Auftragsbelege. Diese Erklärung wiederholt oder startet keine Generierung.':'The safe next step is to review that error code and the existing job receipts. This explanation does not repeat or start generation.');
  return parts.join('\n\n');
}
