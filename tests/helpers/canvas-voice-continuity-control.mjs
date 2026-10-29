import { captureCanvasVoiceProjectContinuity, reconcileCanvasVoiceProjectContinuity, adoptCanvasVoiceProjectContinuity } from '../../workers/auth/src/lib/canvas-voice-project-continuity.js';
import { readOwnedCanvasVoiceSession, recordCanvasVoiceExposure } from '../../workers/auth/src/lib/canvas-voice-accounting.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { recordCanvasVoiceUserTurn, applyCanvasVoiceBrief } from '../../workers/auth/src/lib/canvas-voice-conversation.js';

const check = (value, message) => { if (!value) throw new Error(message); };
async function reject(work, code = 'canvas_voice_context_changed') {
    try { await work(); } catch (error) { check(error.code === code, `Expected ${code}, got ${error.code}`); return; }
    throw new Error(`Expected ${code}`);
}
export async function canvasVoiceContinuityCase(env, scope, exposure) {
    const { DB } = env, now = new Date().toISOString(), runId = (await sha256Hex(scope.sessionId + ':production')).slice(0, 32);
    let original = await captureCanvasVoiceProjectContinuity(env, scope, 0);
    check(original.run === null, 'The initial no-production scope is explicit');
    const turn = await recordCanvasVoiceUserTurn(env, scope, { itemId: 'continuity-style', text: 'Make the film realistic with background music.' });
    const input = { callId: 'continuity-brief', turnId: turn.turnId, expectedConversationRevision: turn.conversationRevision,
        expectedBriefRevision: 0, expectedProjectRevision: 0, updates: [{ field: 'style', value: 'realistic', provenance: 'user_stated' }], questions: [] };
    const brief = await applyCanvasVoiceBrief(env, scope, input);
    await reject(() => adoptCanvasVoiceProjectContinuity(env, scope, original, { ...brief, conversationRevision: 999 }));
    original = await adoptCanvasVoiceProjectContinuity(env, scope, original, brief);
    check(original.briefRevision === 1, 'Own canonical brief receipt advances only its exact semantic fence');
    const replay = await applyCanvasVoiceBrief(env, scope, input);
    check(replay.replay && (await adoptCanvasVoiceProjectContinuity(env, scope, original, replay)).briefRevision === 1, 'Exact brief replay does not apply a second edit');
    const secondInput = { ...input, callId: 'continuity-audio', expectedConversationRevision: brief.conversationRevision,
        expectedBriefRevision: 1, updates: [{ field: 'audio', value: 'background music', provenance: 'user_stated' }] };
    const second = await applyCanvasVoiceBrief(env, scope, secondInput);
    check((await DB.prepare('SELECT brief_revision FROM canvas_agent_turns WHERE id=?').bind(turn.turnId).first()).brief_revision === 0,
        'The final spoken source retains its original brief revision across both local calls');
    const adopted = await adoptCanvasVoiceProjectContinuity(env, scope, original, second);
    check(adopted.briefRevision === 2, 'Two accepted calls from the same final spoken source adopt their exact successive parent revisions');
    await reject(() => adoptCanvasVoiceProjectContinuity(env, scope, { ...original, briefRevision: 0 }, second));
    original = adopted;
    await reject(() => adoptCanvasVoiceProjectContinuity(env, scope, original, replay));
    const secondReplay = await applyCanvasVoiceBrief(env, scope, secondInput);
    check(secondReplay.replay && (await adoptCanvasVoiceProjectContinuity(env, scope, original, secondReplay)).briefRevision === 2,
        'Only an exact replay of the current adopted scope remains harmless');
    const conversation = await DB.prepare('SELECT assistant_model_id,assistant_model_revision FROM canvas_agent_conversations WHERE project_id=?').bind(scope.projectId).first();
    await DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,
        next_attempt_at,created_at,updated_at,expires_at,brief_revision,model_id,model_revision,media_policy_revision)
        VALUES(?,?,?,?,?,'running',0,3000,?,?,?,?,?,?,?,0)`)
        .bind(runId, scope.projectId, scope.userId, 'synthetic-continuity-run', JSON.stringify({ expectedRevision: 0 }), now, now, now,
            new Date(Date.now() + 600000).toISOString(), original.briefRevision, conversation.assistant_model_id, conversation.assistant_model_revision).run();
    await reject(() => reconcileCanvasVoiceProjectContinuity(env, scope, original));
    await reject(() => adoptCanvasVoiceProjectContinuity(env, scope, original, { runId, projectRevision: 0, briefRevision: original.briefRevision }));
    // Initial observation can bind an existing run; a later new run cannot be
    // adopted just because its owner/project happen to match.
    const bound = await captureCanvasVoiceProjectContinuity(env, scope, 0);
    check(bound.run.id === runId, 'Exact initial production identity is pinned');
    for (const patch of [{ briefRevision: 9 }, { modelRevision: 9 }, { mediaPolicyRevision: 9 }, { controlId: '0'.repeat(32) }, { sessionId: '0'.repeat(32) }])
        await reject(() => reconcileCanvasVoiceProjectContinuity(env, scope, { ...bound, ...patch }));
    await reject(() => captureCanvasVoiceProjectContinuity(env, { ...scope, userId: 'foreign' }, 0));
    // Synthetic atomic graph-write envelope follows the existing applying fence;
    // the complete Voice journey separately invokes the real plan application.
    await DB.batch([DB.prepare("UPDATE canvas_agent_runs SET status='applying' WHERE id=?").bind(runId),
        DB.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(scope.projectId),
        DB.prepare("UPDATE canvas_agent_runs SET status='running',expected_revision=(SELECT revision FROM canvas_projects WHERE id=?) WHERE id=?").bind(scope.projectId, runId)]);
    const advanced = await reconcileCanvasVoiceProjectContinuity(env, scope, bound);
    check(advanced.projectRevision === 1 && advanced.run.expectedRevision === 1, 'Known guarded production advances its own project fence');
    await reject(() => readOwnedCanvasVoiceSession(env, scope), 'canvas_voice_authority_changed');
    check((await readOwnedCanvasVoiceSession(env, scope, { expectedProjectRevision: 1 })).current_project_revision === 1, 'Only the explicitly reconciled revision is admitted');
    await reject(() => readOwnedCanvasVoiceSession(env, scope, { expectedProjectRevision: 2 }), 'canvas_voice_authority_changed');
    await recordCanvasVoiceExposure(env, scope, exposure, { expectedProjectRevision: advanced.projectRevision });
    check((await DB.prepare('SELECT project_revision FROM canvas_voice_sessions WHERE id=?').bind(scope.sessionId).first()).project_revision === 0, 'The original admission snapshot is immutable');
    await DB.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(scope.projectId).run();
    check((await DB.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(runId).first()).status === 'paused', 'A manual edit triggers the real production stop fence');
    await reject(() => reconcileCanvasVoiceProjectContinuity(env, scope, advanced));
    await reject(() => recordCanvasVoiceExposure(env, scope, exposure, { expectedProjectRevision: 1 }), 'canvas_voice_authority_changed');
    // A subsequent external resume cannot launder that edit into Voice scope,
    // even if it legitimately rebinds the original run.expected_revision.
    await DB.batch([DB.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,'external-resume','resume',?)").bind(runId, now),
        DB.prepare("UPDATE canvas_agent_runs SET status='running',expected_revision=2 WHERE id=?").bind(runId)]);
    await reject(() => reconcileCanvasVoiceProjectContinuity(env, scope, advanced));
    await reject(() => adoptCanvasVoiceProjectContinuity(env, scope, advanced, { projectRevisionBefore: 1, projectRevision: 2, briefRevision: original.briefRevision,
        actionId: 'a'.repeat(32), controlId: advanced.controlId }));
    check((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(scope.userId).first()).n === 0,
        'Continuity reads, rejection and metering do not launch work or debit a second identity');
}
