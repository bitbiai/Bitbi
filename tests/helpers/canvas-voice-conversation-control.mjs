import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { ensureConversation, conversationRow, canvasConversationReplySource } from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import { recordCanvasVoiceUserTurn, recordCanvasVoiceReply, recordCanvasVoiceFinalReply, applyCanvasVoiceBrief, readCanvasVoiceContext, prepareCanvasVoiceNextStep } from '../../workers/auth/src/lib/canvas-voice-conversation.js';
import { canvasVoiceSystem } from '../../workers/shared/canvas-agent/voice.mjs';
import {canvasVoiceTextContinuation} from './canvas-voice-text-control.mjs';
import {canvasVoiceToolsCase} from './canvas-voice-tools-control.mjs';

const check = (value, message) => { if (!value) throw new Error(message); };
async function reject(call, code) { try { await call(); } catch (error) { check(error.code === code, `Expected ${code}, received ${error.code || 'unclassified'}`); return; } throw new Error(`Expected ${code}`); }
export const CANVAS_VOICE_CONVERSATION_CASES = ['shared', 'isolation', 'replay', 'stale', 'format', 'readonly', 'concurrency', 'correction', 'text', 'tools'];
export async function canvasVoiceConversationCase(env, name) {
  const DB = env.DB, owner = 'voice-' + name, projectId = (await sha256Hex(owner)).slice(0, 32), sessionId = (await sha256Hex('session-' + owner)).slice(0, 32);
  const scope = { userId: owner, projectId, sessionId }, now = new Date().toISOString(), later = new Date(Date.now() + 600000).toISOString();
  await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(owner, owner + '@example.invalid', 'synthetic', now, now).run();
  await DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Voice fixture','de',?,?)").bind(projectId, owner, now, now).run();
  await ensureConversation(env, projectId, owner);
  await DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at)
    VALUES(?,?,?,'active',0,0,0,?,?,?)`).bind(sessionId, projectId, owner, name==='tools'?JSON.stringify({tools:{canvas:{enabled:true}}}):'{}', now, later).run();
  const counts = async () => {
    const result = {};
    for (const table of ['canvas_agent_runs', 'canvas_agent_steps', 'canvas_agent_model_operations', 'member_ai_usage_attempts_v2', 'canvas_nodes', 'canvas_agent_conversation_decisions']) result[table] = (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
    return JSON.stringify(result);
  };
  const before = await counts(), transcript = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-cat-1', text: 'Ein Katzenvideo, ungefähr 45 Sekunden lang, im realistischen Stil.' });
  const proposal = { callId: 'call-1', turnId: transcript.turnId, expectedConversationRevision: transcript.conversationRevision, expectedBriefRevision: 0, expectedProjectRevision: 0,
    updates: [{ field: 'story', value: 'Eine Katze erkundet einen Garten.', provenance: 'user_stated' }, { field: 'style', value: 'realistisch', provenance: 'user_stated' }],
    questions: ['Welches Bildformat möchtest du?'], duration: { choice: 'explicit', targetDurationSeconds: 45 } };
  if (name === 'shared') {
    const saved = await applyCanvasVoiceBrief(env, scope, proposal);
    check(saved.applied && saved.briefRevision === 1, 'Voice confirms the ordinary canonical brief');
    await recordCanvasVoiceReply(env, scope, { turnId: transcript.turnId, responseId: 'response-1', text: 'Realistisch und ungefähr 45 Sekunden. Welches Bildformat?', interrupted: true, heardAudioMs: 120 });
    const row = await conversationRow(env, projectId, owner), brief = JSON.parse(row.brief_json);
    check(brief.fields.story.sourceMessageId === transcript.turnId && brief.duration.targetDurationSeconds === 45, 'Typed continuation reads the same sourced brief');
    const context = await readCanvasVoiceContext(env, scope);
    check(context.brief.fields.style.value === 'realistisch' && context.recentMessages.length === 2, 'Voice uses saved text/brief history');
    check(context.recentMessages[1].interrupted === true && context.recentMessages[1].playback === 'not_verified', 'Interruption is not proof of heard audio');
    const next = await prepareCanvasVoiceNextStep(env, scope);
    check(next.executed === false && next.requiresExplicitConfirmation && next.missing.length === 0, 'Preparing next step grants no authority');
    check(!canvasVoiceSystem().includes('Return only the dialogue JSON contract') && canvasVoiceSystem().includes('same Canvas user'), 'Voice shares role without spoken JSON contract');
    check(canvasConversationReplySource({ voice_json: JSON.stringify({ modelId: 'grok-voice-3.0', interrupted: 0 }) }).provenance === 'model', 'Real Voice answer cannot be misattributed to application fallback');
    const interruptedSource=canvasConversationReplySource({voice_json:JSON.stringify({modelId:'grok-voice-3.0',interrupted:1})});
    check(interruptedSource.provenance==='application'&&interruptedSource.kind==='voice_interruption'&&interruptedSource.originalModelId==='grok-voice-3.0','Unknown playback note is application-authored and keeps original model evidence');
    check(canvasConversationReplySource({voice_json:JSON.stringify({modelId:'grok-voice-3.0',interrupted:1,retainedText:'Known prefix'})}).provenance==='model','Confirmed provider prefix retains model provenance');
  } else if (name === 'isolation') {
    await reject(() => applyCanvasVoiceBrief(env, { ...scope, userId: 'other-user' }, proposal), 'canvas_voice_session_unavailable');
    await reject(() => readCanvasVoiceContext(env, { ...scope, projectId: 'f'.repeat(32) }), 'canvas_voice_session_unavailable');
    await DB.prepare('UPDATE canvas_voice_sessions SET stop_requested=1 WHERE id=?').bind(sessionId).run();
    await reject(() => applyCanvasVoiceBrief(env, scope, proposal), 'canvas_voice_session_unavailable');
    await reject(() => recordCanvasVoiceUserTurn(env, scope, {itemId:'after-stop',text:'New request after Stop'}), 'canvas_voice_session_unavailable');
    const finalReply={turnId:transcript.turnId,responseId:'stopped-response',text:'Already generated partial response.',interrupted:true};
    await recordCanvasVoiceFinalReply(env,scope,finalReply);
    check((await recordCanvasVoiceFinalReply(env,scope,finalReply)).replay,'Evidence-only final response survives Stop exactly once without another action');
    await reject(()=>recordCanvasVoiceFinalReply(env,{...scope,userId:'foreign'},finalReply),'canvas_voice_session_unavailable');
    await DB.prepare('UPDATE canvas_voice_sessions SET stop_requested=0 WHERE id=?').bind(sessionId).run();
    await DB.prepare("UPDATE canvas_voice_sessions SET state='completed' WHERE id=?").bind(sessionId).run();
    await reject(() => recordCanvasVoiceReply(env, scope, { turnId: transcript.turnId, responseId: 'late-response', text: 'Late', interrupted: false }), 'canvas_voice_session_unavailable');
    const expiredId = (await sha256Hex('expired-' + owner)).slice(0, 32);
    await DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,request_key,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at)
      VALUES(?,?,?,'expired','active',0,0,0,'{}','2000-01-01T00:00:00.000Z','2000-01-01T00:01:00.000Z')`).bind(expiredId, projectId, owner).run();
    await reject(() => readCanvasVoiceContext(env, { ...scope, sessionId: expiredId }), 'canvas_voice_session_unavailable');
  } else if (name === 'replay') {
    const duplicate = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-cat-1', text: 'Ein Katzenvideo, ungefähr 45 Sekunden lang, im realistischen Stil.' });
    check(duplicate.replay && duplicate.turnId === transcript.turnId, 'Duplicate final transcript does not create another turn');
    const original = { ...proposal, expectedConversationRevision: 0 };
    const saved = await applyCanvasVoiceBrief(env, scope, original, transcript.conversationRevision), replay = await applyCanvasVoiceBrief(env, scope, original, saved.conversationRevision);
    check(replay.replay && replay.briefRevision === saved.briefRevision, 'Call replay returns original result even after revision advanced');
    const receipt = await DB.prepare('SELECT input_json FROM canvas_voice_calls WHERE session_id=? AND call_id=?').bind(sessionId, original.callId).first();
    check(JSON.parse(receipt.input_json).expectedConversationRevision === 0, 'Projection fence preserves original model input for durable replay');
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...original, questions: ['Changed'] }, saved.conversationRevision), 'idempotency_conflict');
    const reply = { turnId: transcript.turnId, responseId: 'response-1', text: 'Gespeichert.', interrupted: false };
    await recordCanvasVoiceReply(env, scope, reply);
    check((await recordCanvasVoiceReply(env, scope, reply)).replay, 'Duplicate response is not a new assistant answer');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_turns WHERE project_id=?').bind(projectId).first()).n === 1, 'Single user/response pair remains canonical');
    const followup = await recordCanvasVoiceReply(env, scope, { ...reply, responseId: 'response-2', text: 'Welches Format?' });
    check(followup.replyTurnId !== transcript.turnId, 'A tool follow-up has a separate response identity');
    check((await recordCanvasVoiceReply(env, scope, { ...reply, responseId: 'response-2', text: 'Welches Format?' })).replay, 'Follow-up replay is deduplicated');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_turns WHERE project_id=? AND user_text!=\'\'').bind(projectId).first()).n === 1, 'Tool continuation does not invent another user instruction');
  } else if (name === 'stale') {
    await DB.prepare('UPDATE canvas_agent_conversations SET revision=revision+1 WHERE project_id=?').bind(projectId).run();
    await reject(() => applyCanvasVoiceBrief(env, scope, proposal), 'canvas_agent_conversation_changed');
    const next = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-cat-2', text: 'Die Katze ist schwarz.' });
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, expectedConversationRevision: next.conversationRevision }), 'canvas_voice_source_changed');
    await DB.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(projectId).run();
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, turnId: next.turnId, expectedConversationRevision: next.conversationRevision }), 'canvas_agent_conversation_changed');
  } else if (name === 'format') {
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, format: { aspectRatio: '7:3', resolution: '99K', provenance: 'user_stated' } }), 'canvas_voice_format_unavailable');
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, duration: { choice: 'delegated', targetDurationSeconds: null } }), 'canvas_voice_duration_unconfirmed');
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, updates: [{ field: 'budget', value: 'unlimited', provenance: 'user_stated' }] }), 'canvas_voice_brief_invalid');
    const good = await applyCanvasVoiceBrief(env, scope, { ...proposal, format: { aspectRatio: '16:9', resolution: null, provenance: 'user_stated' } });
    check(good.applied, 'An offered aspect ratio can be saved without inventing a resolution');
    const brief = JSON.parse((await conversationRow(env, projectId, owner)).brief_json);
    check(brief.fields.format.value === 'aspectRatio: 16:9', 'Unanswered resolution stays unknown');
    // Historical text briefs legitimately use the plain canonical token.
    brief.fields.format.value='16:9';await DB.prepare('UPDATE canvas_agent_conversations SET brief_json=? WHERE project_id=?').bind(JSON.stringify(brief),projectId).run();
    const updated=await applyCanvasVoiceBrief(env,scope,{...proposal,callId:'legacy-format',updates:[],duration:null,
      expectedConversationRevision:good.conversationRevision,expectedBriefRevision:good.briefRevision,format:{aspectRatio:null,resolution:'1080p',provenance:'corrected'}});
    const latest=await conversationRow(env,projectId,owner),kept=JSON.parse(latest.brief_json);
    check(kept.fields.format.value==='aspectRatio: 16:9; resolution: 1080p','Resolution correction preserves historical text aspect ratio');
    kept.fields.format.value='16:9; preserve the special crop';await DB.prepare('UPDATE canvas_agent_conversations SET brief_json=? WHERE project_id=?').bind(JSON.stringify(kept),projectId).run();
    const unchanged=await conversationRow(env,projectId,owner);
    await reject(()=>applyCanvasVoiceBrief(env,scope,{...proposal,callId:'ambiguous-format',updates:[],duration:null,
      expectedConversationRevision:updated.conversationRevision,expectedBriefRevision:updated.briefRevision,format:{aspectRatio:null,resolution:'720p',provenance:'corrected'}}),'canvas_voice_format_ambiguous');
    check(JSON.stringify(await conversationRow(env,projectId,owner))===JSON.stringify(unchanged),'Ambiguous partial update never discards existing meaningful format content');
  } else if (name === 'readonly') {
    const question = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-question', text: 'What does production.reconcile mean?' });
    await reject(() => applyCanvasVoiceBrief(env, scope, { ...proposal, turnId: question.turnId, expectedConversationRevision: question.conversationRevision }), 'canvas_voice_read_only_turn');
    const row = await conversationRow(env, projectId, owner), revision = row.revision;
    await readCanvasVoiceContext(env, scope); await prepareCanvasVoiceNextStep(env, scope);
    check((await conversationRow(env, projectId, owner)).revision === revision, 'Context and next-step preparation are read-only');
  } else if (name === 'concurrency') {
    const results = await Promise.all([applyCanvasVoiceBrief(env, scope, proposal), applyCanvasVoiceBrief(env, scope, proposal)]);
    check(results.filter(result => result.replay).length === 1, 'Duplicate simultaneous call observes one committed mutation');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_calls WHERE session_id=?').bind(sessionId).first()).n === 1, 'One durable call identity');
    const replies = await Promise.all([0, 1].map(() => recordCanvasVoiceReply(env, scope, { turnId: transcript.turnId, responseId: 'concurrent-response', text: 'Gespeichert.', interrupted: false })));
    check(replies.filter(result => result.replay).length === 1, 'Concurrent callback acknowledgement is not another model answer');
  } else if(name==='tools') {
    await canvasVoiceToolsCase(env,scope);
  } else if(name==='text') {
    await canvasVoiceTextContinuation(env,scope,transcript,proposal);
  } else if (name === 'correction') {
    await applyCanvasVoiceBrief(env, scope, proposal);
    await DB.prepare("UPDATE canvas_agent_conversations SET draft='typed draft',assistant_model_id='anthropic/claude-fable-5' WHERE project_id=?").bind(projectId).run();
    const correction = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-correction', text: 'Bitte ändere den Stil auf Cartoon.' });
    await applyCanvasVoiceBrief(env, scope, { ...proposal, callId: 'correction', turnId: correction.turnId, expectedConversationRevision: correction.conversationRevision,
      expectedBriefRevision: correction.briefRevision, updates: [{ field: 'style', value: 'Cartoon', provenance: 'corrected' }], duration: null, questions: [] });
    const row = await conversationRow(env, projectId, owner), brief = JSON.parse(row.brief_json);
    check(brief.fields.style.value === 'Cartoon' && brief.fields.story.value === 'Eine Katze erkundet einen Garten.' && brief.duration.targetDurationSeconds === 45, 'Correction preserves already established facts');
    check(row.draft === 'typed draft' && row.assistant_model_id === 'anthropic/claude-fable-5', 'Voice leaves text draft and selected text model intact');
    const repeated = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'item-repeat', text: 'Der Stil bleibt Cartoon.' });
    const result = await applyCanvasVoiceBrief(env, scope, { ...proposal, callId: 'same-value', turnId: repeated.turnId, expectedConversationRevision: repeated.conversationRevision,
      expectedBriefRevision: repeated.briefRevision, updates: [{ field: 'style', value: 'Cartoon', provenance: 'corrected' }], duration: null, questions: [] });
    check(result.changed === false && result.briefRevision === row.brief_revision, 'Repeating an unchanged preference does not invalidate creative revision');
  } else throw new Error('Unknown voice fixture');
  if(name!=='text')check(await counts() === before, 'Voice context and brief work cannot dispatch, bill, create decisions or edit graph');
  check((await DB.prepare('PRAGMA foreign_key_check').all()).results.length === 0, 'Voice transcript relations retain integrity');
  return { case: name, inferenceCalls: 0, productionActions: 0 };
}
