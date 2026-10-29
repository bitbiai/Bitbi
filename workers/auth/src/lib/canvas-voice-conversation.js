import { CANVAS_VOICE_MODEL } from '../../../../js/shared/canvas-voice-settings.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { CANVAS_AGENT_BRIEF_FIELDS, validateCanvasAgentBrief } from '../../../shared/canvas-agent-dialogue.mjs';
import { canvasVoiceSystem, canvasVoicePolicyIdentity } from '../../../shared/canvas-agent/voice.mjs';
import { conversationGuard, conversationRow, userDuration, pauseForBriefChange, canvasConversationReplySource, canvasConversationReplyText } from './canvas-agent-conversation.js';
import { canvasAgentActionContext } from './canvas-agent-actions.js';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { restrictCanvasMediaInventory } from './canvas-agent-media-policy.js';
import { canvasConversationReadIntent } from './canvas-agent-conversation-context.js';
import { nowIso, sha256Hex } from './tokens.js';

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const providerId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const fields = CANVAS_AGENT_BRIEF_FIELDS.filter(field => !['format', 'delegatedChoices'].includes(field));
const provenance = ['user_stated', 'corrected', 'assistant_proposed', 'unresolved'];
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const revisions = row => ({ conversationRevision: row.revision, briefRevision: row.brief_revision });

// scope is supplied only by authenticated server/relay code. Model arguments
// contain neither owner/project/session IDs nor any execution authority.
async function owned(env, scope, { readOnly = false, receiptOnly = false } = {}) {
  if (!scope || !['sessionId', 'projectId'].every(key => /^[a-f0-9]{32}$/.test(scope[key] || '')) || !text(scope.userId, 180, 1)) fail('canvas_voice_scope_invalid', 400);
  const session = await env.DB.prepare(`SELECT s.*,p.revision AS current_project_revision,p.locale FROM canvas_voice_sessions s
    JOIN canvas_projects p ON p.id=s.project_id JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.project_id=? AND s.user_id=?
    AND p.user_id=s.user_id AND p.deleted_at IS NULL AND u.status='active'
    AND ((?=1 AND s.state IN ('active','stopping','completed','unknown')) OR
      (s.state='active' OR ?=1 AND s.state IN ('admitted','connecting')) AND s.stop_requested=0 AND s.expires_at>?
      AND NOT EXISTS(SELECT 1 FROM canvas_voice_stop_requests stop WHERE stop.session_id=s.id))
    AND (?=1 OR EXISTS(SELECT 1 FROM sessions login WHERE login.id=s.auth_session_id AND login.user_id=s.user_id AND login.expires_at>?))`)
    .bind(scope.sessionId, scope.projectId, scope.userId, receiptOnly ? 1 : 0, readOnly ? 1 : 0, nowIso(), receiptOnly ? 1 : 0, nowIso()).first();
  if (!session) fail('canvas_voice_session_unavailable');
  const row = await conversationRow(env, scope.projectId, scope.userId);
  if (!row || row.state !== 'active') fail('canvas_agent_conversation_stopped');
  return { session, row };
}
function sessionGuard(env, scope, receiptOnly = false) {
  return env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_voice_sessions s JOIN canvas_projects p ON p.id=s.project_id
    JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.project_id=? AND s.user_id=?
    AND ((?=1 AND s.state IN ('active','stopping','completed','unknown')) OR s.state='active' AND s.stop_requested=0 AND s.expires_at>?
      AND NOT EXISTS(SELECT 1 FROM canvas_voice_stop_requests stop WHERE stop.session_id=s.id))
    AND (?=1 OR EXISTS(SELECT 1 FROM sessions login WHERE login.id=s.auth_session_id AND login.user_id=s.user_id AND login.expires_at>?))
    AND p.user_id=s.user_id AND p.deleted_at IS NULL AND u.status='active') THEN 1 ELSE json_extract('[]','$[') END`)
    .bind(scope.sessionId, scope.projectId, scope.userId, receiptOnly ? 1 : 0, nowIso(), receiptOnly ? 1 : 0, nowIso());
}
async function ownedTurn(env, scope, id) {
  const turn = await env.DB.prepare(`SELECT t.*,v.provider_response_id,v.provider_item_id,v.source_turn_id,v.interrupted FROM canvas_agent_turns t
    JOIN canvas_voice_turns v ON v.turn_id=t.id WHERE t.id=? AND t.project_id=? AND v.session_id=? AND t.state!='deleted'`)
    .bind(id, scope.projectId, scope.sessionId).first();
  if (!turn) fail('canvas_voice_turn_unavailable');
  return turn;
}
// Internal application boundary for tools: only a final, committed input turn
// from this admitted session can propose changes or answer a current decision.
export async function canvasVoiceSource(env, scope, turnId) {
  if (!/^[a-f0-9]{32}$/.test(turnId || '')) fail('canvas_voice_transcript_pending');
  const { row, session } = await owned(env, scope), turn = await ownedTurn(env, scope, turnId);
  if (turn.state !== 'completed' || !turn.user_text || turn.source_turn_id && turn.source_turn_id !== turn.id || !turn.provider_item_id?.startsWith('input:')) fail('canvas_voice_transcript_pending');
  const latest = await env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state!='deleted' AND user_text!='' ORDER BY rowid DESC LIMIT 1").bind(scope.projectId).first();
  if (latest?.id !== turn.id) fail('canvas_voice_source_changed');
  return { row, session, turn, guard: [sessionGuard(env, scope), conversationGuard(env, row),
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_turns t JOIN canvas_voice_turns v ON v.turn_id=t.id
      WHERE t.id=? AND t.project_id=? AND v.session_id=? AND t.state='completed' AND t.user_text=? AND (v.source_turn_id IS NULL OR v.source_turn_id=t.id)
      AND v.provider_item_id LIKE 'input:%' AND t.id=(SELECT id FROM canvas_agent_turns WHERE project_id=? AND state!='deleted' AND user_text!='' ORDER BY rowid DESC LIMIT 1))
      THEN 1 ELSE json_extract('[]','$[') END`).bind(turn.id,scope.projectId,scope.sessionId,turn.user_text,scope.projectId)] };
}
const voiceProjection = `(SELECT json_object('modelId',v.model_id,'interrupted',v.interrupted,'heardAudioMs',v.heard_audio_ms,'retainedText',v.retained_text,'locale',(SELECT locale FROM canvas_projects WHERE id=t.project_id))
  FROM canvas_voice_turns v WHERE v.turn_id=t.id) AS voice_json`;

export async function readCanvasVoiceContext(env, scope) {
  const { row, session } = await owned(env, scope, { readOnly: true });
  const [currentProject, capabilities, turns, policy] = await Promise.all([
    canvasAgentActionContext(env, scope.userId, scope.projectId),
    canvasAgentCapabilities(env).then(value => restrictCanvasMediaInventory(env, scope.projectId, value, scope.userId)),
    env.DB.prepare(`SELECT t.*,r.model_id AS reply_model_id,${voiceProjection} FROM canvas_agent_turns t
      LEFT JOIN canvas_agent_runs r ON r.id=t.run_id WHERE t.project_id=? AND t.state='completed' ORDER BY t.rowid DESC LIMIT 6`).bind(scope.projectId).all(),
    canvasVoicePolicyIdentity(),
  ]);
  const latest = await owned(env, scope, { readOnly: true });
  if (latest.row.revision !== row.revision || latest.session.current_project_revision !== session.current_project_revision) fail('canvas_agent_conversation_changed');
  const context = { version: 1, locale: session.locale === 'de' ? 'de' : 'en', ...revisions(row), projectRevision: session.current_project_revision,
    brief: validateCanvasAgentBrief(JSON.parse(row.brief_json)), currentProject, capabilities, policy, instructions: canvasVoiceSystem(),
    recentMessages: turns.results.reverse().flatMap(turn => [...(turn.user_text ? [{ id: turn.id, role: 'user', text: turn.user_text }] : []),
      ...(turn.assistant_text && canvasConversationReplySource(turn).kind !== 'operation_ack' ? [{ id: turn.id + '_reply', role: 'assistant',
        text: canvasConversationReplyText(turn), ...canvasConversationReplySource(turn) }] : [])]) };
  const size = () => new TextEncoder().encode(JSON.stringify(context)).byteLength;
  while (context.recentMessages.length && size() > 65536) context.recentMessages.shift();
  if (size() > 65536) fail('canvas_agent_dialogue_context_limit', 400);
  return context;
}

export async function recordCanvasVoiceUserTurn(env, scope, input, attempt = 0) {
  if (!exact(input, ['itemId', 'text']) || !providerId(input.itemId) || !text(input.text, 6000, 1) || !input.text.trim()) fail('canvas_voice_transcript_invalid', 400);
  const { row } = await owned(env, scope), id = (await sha256Hex(`canvas-voice-turn:${scope.sessionId}:${input.itemId}`)).slice(0, 32);
  const previous = await env.DB.prepare('SELECT user_text,state FROM canvas_agent_turns WHERE id=? AND project_id=?').bind(id, scope.projectId).first();
  if (previous) { if (previous.user_text !== input.text || previous.state === 'deleted') fail('idempotency_conflict'); return { turnId: id, ...revisions(row), replay: true }; }
  const now = nowIso();
  try {
    await env.DB.batch([sessionGuard(env, scope), conversationGuard(env, row),
      env.DB.prepare(`SELECT CASE WHEN COUNT(*)<80 THEN 1 ELSE json_extract('[]','$[') END FROM canvas_agent_turns t
        WHERE project_id=? AND state!='deleted' AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=t.id)`).bind(scope.projectId),
      env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'completed',?,?)`).bind(id, scope.projectId, 'voice:' + id, stablePricingJson(input), row.revision + 1, row.brief_revision, input.text, now, now),
      env.DB.prepare('INSERT INTO canvas_voice_turns(turn_id,session_id,provider_item_id,model_id,created_at) VALUES(?,?,?,?,?)').bind(id, scope.sessionId, 'input:' + input.itemId, CANVAS_VOICE_MODEL, now),
      env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(now, scope.projectId)]);
  } catch (error) {
    const next = await conversationRow(env, scope.projectId, scope.userId);
    if (attempt < 1 && next?.revision !== row.revision) return recordCanvasVoiceUserTurn(env, scope, input, attempt + 1);
    throw error;
  }
  return { turnId: id, conversationRevision: row.revision + 1, briefRevision: row.brief_revision, replay: false };
}

export const recordCanvasVoiceReply = (env, scope, input) => recordReply(env, scope, input, 0, false);
// Evidence-only end receipt from the original relay, never another user turn,
// creative mutation or authority to reconnect after Stop.
export const recordCanvasVoiceFinalReply = (env, scope, input) => recordReply(env, scope, input, 0, true);
async function recordReply(env, scope, input, attempt, receiptOnly) {
  if (!exact(input, ['turnId', 'responseId', 'text', 'interrupted', 'heardAudioMs']) || !/^[a-f0-9]{32}$/.test(input.turnId || '') || !providerId(input.responseId)
    || !text(input.text, 8000) || typeof input.interrupted !== 'boolean' || input.heardAudioMs != null && (!Number.isSafeInteger(input.heardAudioMs) || input.heardAudioMs < 0 || input.heardAudioMs > 3600000)) fail('canvas_voice_reply_invalid', 400);
  const { row } = await owned(env, scope, { receiptOnly }), turn = await ownedTurn(env, scope, input.turnId);
  const previous = await env.DB.prepare(`SELECT t.id,t.assistant_text,v.interrupted,v.source_turn_id FROM canvas_voice_turns v
    JOIN canvas_agent_turns t ON t.id=v.turn_id WHERE v.session_id=? AND v.provider_response_id=? AND t.state!='deleted'`).bind(scope.sessionId, input.responseId).first();
  if (previous) {
    if (previous.source_turn_id !== turn.id || previous.assistant_text !== input.text || !previous.interrupted && input.interrupted) fail('idempotency_conflict');
    return { turnId: turn.id, replyTurnId: previous.id, ...revisions(row), replay: true };
  }
  const latest = await env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state!='deleted' ORDER BY rowid DESC LIMIT 1").bind(scope.projectId).first();
  const separate = Boolean(turn.provider_response_id) || latest?.id !== turn.id;
  const replyTurnId = separate ? (await sha256Hex(`canvas-voice-response:${scope.sessionId}:${input.responseId}`)).slice(0, 32) : turn.id, now = nowIso();
  const statements = [sessionGuard(env, scope, receiptOnly), conversationGuard(env, row)];
  if (separate) statements.push(
    env.DB.prepare(`SELECT CASE WHEN COUNT(*)<80 THEN 1 ELSE json_extract('[]','$[') END FROM canvas_agent_turns t
      WHERE project_id=? AND state!='deleted' AND NOT EXISTS(SELECT 1 FROM canvas_agent_incident_explanations x WHERE x.turn_id=t.id)`).bind(scope.projectId),
    env.DB.prepare(`INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,assistant_text,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'',?,'completed',?,?)`).bind(replyTurnId, scope.projectId, 'voice-reply:' + replyTurnId, stablePricingJson({ sourceTurnId: turn.id, responseId: input.responseId }), row.revision + 1, row.brief_revision, input.text, now, now),
    env.DB.prepare('INSERT INTO canvas_voice_turns(turn_id,session_id,provider_item_id,provider_response_id,source_turn_id,model_id,interrupted,heard_audio_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(replyTurnId, scope.sessionId, 'response:' + input.responseId, input.responseId, turn.id, CANVAS_VOICE_MODEL, input.interrupted ? 1 : 0, input.heardAudioMs ?? null, now));
  else statements.push(env.DB.prepare('UPDATE canvas_voice_turns SET provider_response_id=?,source_turn_id=?,interrupted=?,heard_audio_ms=? WHERE turn_id=? AND provider_response_id IS NULL')
      .bind(input.responseId, turn.id, input.interrupted ? 1 : 0, input.heardAudioMs ?? null, turn.id),
    env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
    env.DB.prepare("UPDATE canvas_agent_turns SET assistant_text=?,updated_at=? WHERE id=? AND state='completed'").bind(input.text, now, turn.id));
  statements.push(env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(now, scope.projectId));
  try { await env.DB.batch(statements); }
  catch (error) {
    const latest = await conversationRow(env, scope.projectId, scope.userId);
    if (attempt < 1 && latest?.revision !== row.revision) return recordReply(env, scope, input, attempt + 1, receiptOnly);
    throw error;
  }
  return { turnId: turn.id, replyTurnId, conversationRevision: row.revision + 1, briefRevision: row.brief_revision, replay: false };
}

// Relay-only acknowledgement. A provider-retained prefix is conversation state,
// not proof that a person heard it. Original generated text remains immutable.
export async function markCanvasVoiceReplyInterrupted(env, scope, input, attempt = 0) {
  if (!scope || !['sessionId', 'projectId'].every(key => /^[a-f0-9]{32}$/.test(scope[key] || '')) || !text(scope.userId, 180, 1)
    || !exact(input, ['responseId', 'audioEndMs', 'transcript']) || !providerId(input.responseId)
    || !Number.isSafeInteger(input.audioEndMs) || input.audioEndMs < 0 || input.audioEndMs > 3600000
    || input.transcript != null && !text(input.transcript, 8000)) fail('canvas_voice_interruption_invalid', 400);
  const read = () => env.DB.prepare(`SELECT t.id,t.assistant_text,v.interrupted,v.retained_text,v.heard_audio_ms,c.revision,c.brief_revision
    FROM canvas_voice_turns v JOIN canvas_voice_sessions s ON s.id=v.session_id JOIN canvas_agent_turns t ON t.id=v.turn_id
    JOIN canvas_agent_conversations c ON c.project_id=t.project_id JOIN canvas_projects p ON p.id=c.project_id JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.project_id=? AND v.provider_response_id=? AND p.user_id=s.user_id AND p.deleted_at IS NULL
    AND u.status='active' AND c.state='active' AND t.state='completed' AND s.state IN ('active','stopping','completed','unknown')`)
    .bind(scope.sessionId, scope.userId, scope.projectId, input.responseId).first();
  const previous = await read();
  if (!previous) fail('canvas_voice_turn_unavailable');
  const retained = input.transcript || null;
  if (retained && !previous.assistant_text?.startsWith(retained)) fail('canvas_voice_retained_text_unverified', 400);
  if (previous.interrupted && previous.heard_audio_ms === input.audioEndMs && (previous.retained_text === retained || previous.retained_text && !retained))
    return { replyTurnId: previous.id, ...revisions(previous), replay: true };
  if (previous.interrupted && previous.heard_audio_ms != null && input.audioEndMs > previous.heard_audio_ms) fail('idempotency_conflict');
  try { await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_voice_sessions s JOIN canvas_projects p ON p.id=s.project_id JOIN users u ON u.id=s.user_id
      JOIN canvas_agent_conversations c ON c.project_id=p.id WHERE s.id=? AND s.user_id=? AND s.project_id=? AND p.user_id=s.user_id
      AND p.deleted_at IS NULL AND u.status='active' AND c.state='active' AND c.revision=?) THEN 1 ELSE json_extract('[]','$[') END`)
      .bind(scope.sessionId, scope.userId, scope.projectId, previous.revision),
    env.DB.prepare('UPDATE canvas_voice_turns SET interrupted=1,heard_audio_ms=?,retained_text=? WHERE turn_id=? AND session_id=? AND provider_response_id=?')
      .bind(input.audioEndMs, retained, previous.id, scope.sessionId, input.responseId),
    env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,updated_at=? WHERE project_id=?').bind(nowIso(), scope.projectId),
  ]); } catch (error) {
    const latest = await read();
    if (attempt < 1 && latest?.revision !== previous.revision) return markCanvasVoiceReplyInterrupted(env, scope, input, attempt + 1);
    throw error;
  }
  return { replyTurnId: previous.id, conversationRevision: previous.revision + 1, briefRevision: previous.brief_revision, replay: false };
}

function validateProposal(input) {
  if (!exact(input, ['callId', 'turnId', 'expectedConversationRevision', 'expectedBriefRevision', 'expectedProjectRevision', 'updates', 'questions', 'format', 'duration'])
    || !providerId(input.callId) || !/^[a-f0-9]{32}$/.test(input.turnId || '')
    || !['expectedConversationRevision', 'expectedBriefRevision', 'expectedProjectRevision'].every(key => Number.isSafeInteger(input[key]) && input[key] >= 0)
    || !Array.isArray(input.updates) || input.updates.length > 15 || input.updates.some(update => !exact(update, ['field', 'value', 'provenance'])
      || !fields.includes(update.field) || !text(update.value, 1000) || !provenance.includes(update.provenance))
    || new Set(input.updates.map(update => update.field)).size !== input.updates.length
    || !Array.isArray(input.questions) || input.questions.length > 2 || input.questions.some(question => !text(question, 800, 1))) fail('canvas_voice_brief_invalid', 400);
}
export async function applyCanvasVoiceBrief(env, scope, input, trustedConversationRevision) {
  validateProposal(input);
  // Only the server Owner may supply this projection-only fence. Keep the
  // original model arguments immutable for exact call replay/provenance.
  if (trustedConversationRevision !== undefined && (!Number.isSafeInteger(trustedConversationRevision) || trustedConversationRevision < 0)) fail('canvas_voice_brief_invalid', 400);
  const { row, session } = await owned(env, scope), serialized = stablePricingJson(input);
  const previous = await env.DB.prepare('SELECT input_json,result_json FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(scope.sessionId, input.callId).first();
  if (previous) { if (previous.input_json !== serialized) fail('idempotency_conflict'); return { ...JSON.parse(previous.result_json), replay: true }; }
  if (row.revision !== (trustedConversationRevision ?? input.expectedConversationRevision) || row.brief_revision !== input.expectedBriefRevision || session.current_project_revision !== input.expectedProjectRevision) fail('canvas_agent_conversation_changed');
  const turn = await ownedTurn(env, scope, input.turnId), brief = validateCanvasAgentBrief(JSON.parse(row.brief_json));
  if (canvasConversationReadIntent(turn.user_text)) fail('canvas_voice_read_only_turn', 400);
  const latest = await env.DB.prepare("SELECT id FROM canvas_agent_turns WHERE project_id=? AND state!='deleted' AND user_text!='' ORDER BY rowid DESC LIMIT 1").bind(scope.projectId).first();
  if (latest?.id !== turn.id) fail('canvas_voice_source_changed');
  const meaning = () => ({ fields: brief.fields, duration: { targetDurationSeconds: brief.duration.targetDurationSeconds, choice: brief.duration.choice, sourceMessageId: brief.duration.sourceMessageId } });
  const before = stablePricingJson(meaning());
  const setField = (field, value, origin) => {
    if (brief.fields[field]?.value !== value || brief.fields[field]?.provenance !== origin)
      brief.fields[field] = { value, provenance: origin, sourceMessageId: turn.id, revision: row.brief_revision + 1 };
  };
  for (const update of input.updates) setField(update.field, update.value, update.provenance);
  if (input.format != null) {
    if (!exact(input.format, ['aspectRatio', 'resolution', 'provenance']) || !['aspectRatio', 'resolution', 'provenance'].every(key => Object.hasOwn(input.format, key))
      || !provenance.includes(input.format.provenance) || input.format.aspectRatio !== null && !text(input.format.aspectRatio, 20, 1)
      || input.format.resolution !== null && !text(input.format.resolution, 30, 1)) fail('canvas_voice_format_invalid', 400);
  }
  const formatProposed = input.format != null && (input.format.aspectRatio !== null || input.format.resolution !== null);
  if (formatProposed) {
    const inventory = await restrictCanvasMediaInventory(env, scope.projectId, await canvasAgentCapabilities(env), scope.userId);
    const prior = brief.fields.format?.value?.trim() || '', tokens = prior.split(/\s*[,;]\s*/).map(token => token.replace(/^(?:aspectRatio|resolution):\s*/, ''));
    const videos = inventory.models.filter(model => model.capability === 'video'), aspects = new Set(videos.flatMap(model => model.controls.aspectRatioOptions || [])),
      resolutions = new Set(videos.flatMap(model => model.controls.resolutionOptions || []));
    const oldAspects = tokens.filter(token => aspects.has(token)), oldResolutions = tokens.filter(token => resolutions.has(token));
    if (prior && (input.format.aspectRatio == null || input.format.resolution == null)
      && (tokens.some(token => !aspects.has(token) && !resolutions.has(token)) || oldAspects.length > 1 || oldResolutions.length > 1)) fail('canvas_voice_format_ambiguous', 400);
    const aspectRatio = input.format.aspectRatio ?? oldAspects[0], resolution = input.format.resolution ?? oldResolutions[0];
    if (!inventory.models.some(model => model.capability === 'video' && (!aspectRatio || model.controls.aspectRatioOptions?.includes(aspectRatio))
      && (!resolution || model.controls.resolutionOptions?.includes(resolution)))) fail('canvas_voice_format_unavailable', 400);
    setField('format', [aspectRatio && `aspectRatio: ${aspectRatio}`, resolution && `resolution: ${resolution}`].filter(Boolean).join('; '), input.format.provenance);
  }
  if (input.duration != null) {
    const parsed = userDuration(turn.user_text, brief, turn.id);
    // A carried canonical value needs no new confirmation or source. An explicit
    // current correction still takes precedence over that previously saved value.
    const confirmed = parsed || (brief.duration.choice ? brief.duration : null);
    if (!exact(input.duration, ['choice', 'targetDurationSeconds']) || !confirmed || input.duration.choice !== confirmed.choice || input.duration.targetDurationSeconds !== confirmed.targetDurationSeconds) fail('canvas_voice_duration_unconfirmed', 400);
    if (parsed && (brief.duration.choice !== parsed.choice || brief.duration.targetDurationSeconds !== parsed.targetDurationSeconds)) brief.duration = parsed;
  }
  brief.openQuestions = brief.duration.choice ? input.questions.filter(question => !/(?:duration|how long|wie lang|dauer)/i.test(question)) : [...input.questions];
  if (!brief.duration.choice && brief.openQuestions.some(question => /(?:duration|how long|wie lang|dauer)/i.test(question))) brief.duration.asked = true;
  const changed = before !== stablePricingJson(meaning());
  brief.revision = row.brief_revision + (changed ? 1 : 0); validateCanvasAgentBrief(brief);
  const result = { applied: true, changed, turnId: turn.id, conversationRevision: row.revision + 1, briefRevision: brief.revision, projectRevision: session.current_project_revision };
  const statements = [sessionGuard(env, scope), conversationGuard(env, row),
    env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND revision=? AND deleted_at IS NULL) THEN 1 ELSE json_extract('[]','$[') END").bind(scope.projectId, session.current_project_revision),
    env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(scope.sessionId, input.callId, serialized, JSON.stringify(result), nowIso()),
    env.DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1,brief_revision=?,brief_json=?,updated_at=? WHERE project_id=?').bind(brief.revision, JSON.stringify(brief), nowIso(), scope.projectId)];
  if (changed && (input.duration || [...input.updates, formatProposed ? input.format : null].some(update => update && ['user_stated', 'corrected'].includes(update.provenance)))) statements.push(pauseForBriefChange(env, scope.projectId));
  try { await env.DB.batch(statements); } catch (error) {
    const replay = await env.DB.prepare('SELECT input_json,result_json FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(scope.sessionId, input.callId).first();
    if (replay) { if (replay.input_json !== serialized) fail('idempotency_conflict'); return { ...JSON.parse(replay.result_json), replay: true }; }
    throw error;
  }
  return result;
}

export async function prepareCanvasVoiceNextStep(env, scope) {
  const context = await readCanvasVoiceContext(env, scope), brief = context.brief;
  return { prepared: true, executed: false, ...revisions({ revision: context.conversationRevision, brief_revision: context.briefRevision }),
    missing: [...(!brief.fields.story?.value ? ['story'] : []), ...(!brief.duration.choice ? ['duration'] : [])],
    questions: brief.openQuestions, decision: context.currentProject.execution.pendingDecision,
    requiresExplicitConfirmation: true, production: context.currentProject.execution.production };
}
