import { canvasAgentActionControlId } from './canvas-agent-actions.js';

const fail = () => { throw Object.assign(new Error('canvas_voice_context_changed'), { code: 'canvas_voice_context_changed', status: 409 }); };
const revision = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const parse = value => value ? JSON.parse(value) : null;
const same = (a, b, keys) => keys.every(key => a?.[key] === b?.[key]);
const semantic = ['modelId', 'modelRevision', 'mediaPolicyRevision'];
const runScope = ['id', 'initialRevision', 'briefRevision', 'modelId', 'modelRevision', 'mediaPolicyRevision', 'budgetCredits', 'budgetRevision', 'tariffRevision'];
const automaticStates = new Set(['queued', 'planning', 'running', 'exporting', 'completed', 'blocked', 'review_required']);

// Internal owner state only: this does not amend the immutable Voice admission
// snapshot and never grants a production action or additional spending.
async function current(env, scope) {
    if (!id(scope?.projectId) || !id(scope?.sessionId) || typeof scope.userId !== 'string' || !scope.userId) fail();
    const controlId = await canvasAgentActionControlId(env, scope.projectId);
    const row = await env.DB.prepare(`SELECT p.revision,p.media_policy_revision,c.brief_revision,c.assistant_model_id,c.assistant_model_revision,
        r.id AS run_id,r.expected_revision,r.brief_revision AS run_brief_revision,r.model_id,r.model_revision,r.media_policy_revision AS run_policy_revision,
        r.budget_credits,r.budget_revision,r.tariff_revision,r.status AS run_status,json_extract(r.input_json,'$.expectedRevision') AS initial_revision,
        COALESCE((SELECT MAX(x.rowid) FROM canvas_agent_controls x JOIN canvas_agent_runs y ON y.id=x.run_id WHERE y.project_id=p.id),0) AS controls_revision
        FROM canvas_projects p JOIN canvas_agent_conversations c ON c.project_id=p.id AND c.user_id=p.user_id
        JOIN users u ON u.id=p.user_id JOIN canvas_voice_sessions s ON s.project_id=p.id AND s.user_id=p.user_id
        LEFT JOIN canvas_agent_runs r ON r.id=(SELECT latest.id FROM canvas_agent_runs latest WHERE latest.project_id=p.id AND latest.user_id=p.user_id
            AND latest.purpose='production' ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1)
        WHERE p.id=? AND p.user_id=? AND s.id=? AND p.deleted_at IS NULL AND u.status='active' AND c.state='active'`)
        .bind(scope.projectId, scope.userId, scope.sessionId).first();
    if (!row || controlId !== await canvasAgentActionControlId(env, scope.projectId)) fail();
    return { version: 1, projectId: scope.projectId, userId: scope.userId, sessionId: scope.sessionId,
        projectRevision: row.revision, briefRevision: row.brief_revision, modelId: row.assistant_model_id,
        modelRevision: row.assistant_model_revision, mediaPolicyRevision: row.media_policy_revision,
        controlId, controlsRevision: row.controls_revision, run: row.run_id ? { id: row.run_id, initialRevision: row.initial_revision,
            expectedRevision: row.expected_revision, briefRevision: row.run_brief_revision, modelId: row.model_id, modelRevision: row.model_revision,
            mediaPolicyRevision: row.run_policy_revision, budgetCredits: row.budget_credits, budgetRevision: row.budget_revision,
            tariffRevision: row.tariff_revision, status: row.run_status } : null };
}
function bound(prior, scope) {
    if (prior?.version !== 1 || !revision(prior.projectRevision) || !same(prior, scope, ['projectId', 'userId', 'sessionId'])) fail();
}
function automatic(prior, next) {
    return prior.run && same(prior.run, next.run, runScope) && automaticStates.has(next.run.status)
        && next.run.expectedRevision === next.projectRevision && next.projectRevision >= prior.projectRevision;
}
export async function captureCanvasVoiceProjectContinuity(env, scope, expectedProjectRevision) {
    if (!revision(expectedProjectRevision)) fail();
    const next = await current(env, scope);
    if (next.projectRevision !== expectedProjectRevision) fail();
    return next;
}
export async function reconcileCanvasVoiceProjectContinuity(env, scope, prior) {
    bound(prior, scope); const next = await current(env, scope);
    if (!same(prior, next, [...semantic, 'briefRevision', 'controlId', 'controlsRevision']) || prior.run?.id !== next.run?.id) fail();
    if (next.projectRevision !== prior.projectRevision && !automatic(prior, next)) fail();
    if (prior.run && !same(prior.run, next.run, runScope)) fail();
    return next;
}

// The owner passes only its completed canonical tool result, never model
// arguments. Project/control changes additionally require the original durable
// action receipt; a newly accepted run requires this session's consumed decision.
export async function adoptCanvasVoiceProjectContinuity(env, scope, prior, result) {
    bound(prior, scope);
    const replay = result?.replay === true && result.projectRevision === prior.projectRevision && result.briefRevision === prior.briefRevision;
    if (!result || !revision(result.projectRevision) || !revision(result.briefRevision)
        || !replay && (result.projectRevisionBefore ?? prior.projectRevision) !== prior.projectRevision || result.projectRevision < prior.projectRevision) fail();
    const next = await current(env, scope);
    if (!same(prior, next, semantic) || next.briefRevision !== result.briefRevision) fail();
    if (result.applied === true || result.briefRevision !== prior.briefRevision) {
        if (!revision(result.conversationRevision)) fail();
        // A final spoken source keeps its original revision. Successive own
        // updates prove their exact parent through the immutable call input.
        const projection = await env.DB.prepare(`SELECT v.call_id FROM canvas_voice_calls v JOIN canvas_voice_turns source
            ON source.turn_id=json_extract(v.input_json,'$.turnId') AND source.session_id=v.session_id
            JOIN canvas_agent_turns t ON t.id=source.turn_id AND t.project_id=? AND t.state='completed'
            WHERE v.session_id=? AND json_extract(v.result_json,'$.projectRevision')=? AND json_extract(v.result_json,'$.briefRevision')=?
            AND json_extract(v.result_json,'$.conversationRevision')=?
            AND (?=1 OR (json_extract(v.input_json,'$.expectedBriefRevision')=? AND t.brief_revision<=?)) LIMIT 1`)
            .bind(scope.projectId, scope.sessionId, result.projectRevision, result.briefRevision, result.conversationRevision,
                replay ? 1 : 0, prior.briefRevision, prior.briefRevision).first();
        if (!projection) fail();
    }
    let acceptedRun = false;
    if (id(result.runId) && result.runId !== prior.run?.id && next.run?.id === result.runId) {
        const decision = await env.DB.prepare(`SELECT d.id FROM canvas_agent_conversation_decisions d
            JOIN canvas_voice_turns v ON d.decision_key='voice-decision:'||v.turn_id
            WHERE d.run_id=? AND d.project_id=? AND d.user_id=? AND d.kind='production_start' AND d.state='consumed' AND v.session_id=?`)
            .bind(result.runId, scope.projectId, scope.userId, scope.sessionId).first();
        acceptedRun = Boolean(decision) && next.run.initialRevision === result.projectRevision
            && next.run.briefRevision === result.briefRevision && same(next.run, next, semantic);
        if (!acceptedRun) fail();
    }
    let ownAction = false;
    let actionType = null;
    if (id(result.actionId)) {
        const receipt = await env.DB.prepare(`SELECT a.input_json,a.result_json FROM canvas_agent_action_receipts a JOIN canvas_voice_turns v ON v.turn_id=a.turn_id
            WHERE a.id=? AND a.project_id=? AND a.user_id=? AND a.state='completed' AND v.session_id=?`)
            .bind(result.actionId, scope.projectId, scope.userId, scope.sessionId).first();
        const input = parse(receipt?.input_json), saved = parse(receipt?.result_json), proof = saved?.voiceRevision;
        ownAction = input?.voice?.sessionId === scope.sessionId && proof?.projectBefore === (replay ? result.projectRevisionBefore : prior.projectRevision)
            && proof?.projectAfter === result.projectRevision && saved?.controlId === result.controlId && result.controlId === next.controlId;
        if (!ownAction) fail();
        actionType = input.action?.type;
        if (!same(prior, next, ['controlId', 'controlsRevision'])) {
            const controls = (await env.DB.prepare(`SELECT x.request_key,x.action FROM canvas_agent_controls x JOIN canvas_agent_runs r ON r.id=x.run_id
                WHERE r.project_id=? AND x.rowid>? ORDER BY x.rowid LIMIT 2`).bind(scope.projectId, prior.controlsRevision).all()).results;
            if (controls.length !== 1 || controls[0].request_key !== 'canvas_action_' + result.actionId
                || actionType !== 'production_' + controls[0].action) fail();
            if (actionType === 'production_resume') { if (next.controlId !== prior.controlId) fail(); }
            else {
                const lastStop = await env.DB.prepare(`SELECT id FROM canvas_agent_action_receipts WHERE project_id=? AND state IN ('executing','completed')
                    AND json_extract(input_json,'$.action.type') IN ('production_pause','production_cancel','production_takeover') ORDER BY rowid DESC LIMIT 1`)
                    .bind(scope.projectId).first();
                if (lastStop?.id !== result.actionId) fail();
            }
        }
    }
    if (!ownAction && !same(prior, next, ['controlId', 'controlsRevision'])) fail();
    if (prior.run?.id !== next.run?.id && !acceptedRun) fail();
    if (prior.run && !acceptedRun && !same(prior.run, next.run, runScope.filter(key => ownAction && actionType === 'budget_accept'
        ? !['budgetCredits', 'budgetRevision'].includes(key) : true))) fail();
    if (replay) return reconcileCanvasVoiceProjectContinuity(env, scope, prior);
    const expected = { ...prior, projectRevision: result.projectRevision, run: acceptedRun ? next.run : prior.run };
    if (next.projectRevision !== result.projectRevision && !automatic(expected, next)) fail();
    return next;
}
