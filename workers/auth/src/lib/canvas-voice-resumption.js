import { nowIso } from './tokens.js';

const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };
const providerId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);

// This is only a server-owned reference to a settled opt-in conversation. It is
// never permission to reconnect an accepted/unknown request or reuse its debit.
export async function findCanvasVoiceResumption(env, { userId, projectId }, settings, now = Date.now()) {
    if (settings.resumption.enabled !== true) return null;
    const row = await env.DB.prepare(`SELECT s.id,s.provider_identity,
        json_extract(a.metadata_json,'$.canvas_voice_receipt.recordedAt') AS completed_at
        FROM canvas_voice_sessions s JOIN member_ai_usage_attempts_v2 a ON a.id=s.usage_attempt_id
        JOIN canvas_projects p ON p.id=s.project_id JOIN users u ON u.id=s.user_id
        WHERE s.user_id=? AND s.project_id=? AND p.user_id=s.user_id AND p.deleted_at IS NULL AND u.status='active'
        AND s.state='completed' AND a.billing_status='finalized' AND a.provider_outcome='succeeded'
        AND json_extract(s.settings_json,'$.resumption.enabled')=1 AND s.provider_identity IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM canvas_voice_sessions child WHERE child.resume_session_id=s.id AND child.state!='rejected')
        ORDER BY completed_at DESC,s.created_at DESC LIMIT 1`).bind(userId, projectId).first();
    if (!row || !providerId(row.provider_identity)) return null;
    const until = Date.parse(row.completed_at) + 30 * 60 * 1000;
    if (!Number.isFinite(until) || until <= now) return null;
    return { sessionId: row.id, conversationId: row.provider_identity, expiresAt: new Date(until).toISOString() };
}

export async function validateCanvasVoiceResumption(env, scope, row) {
    if (!row.resume_session_id) {
        if (row.resume_conversation_id || row.resume_expires_at) fail('canvas_voice_resumption_changed');
        return;
    }
    const selected = await findCanvasVoiceResumption(env, scope, JSON.parse(row.settings_json));
    if (!selected || selected.sessionId !== row.resume_session_id || selected.conversationId !== row.resume_conversation_id
        || selected.expiresAt !== row.resume_expires_at) fail('canvas_voice_resumption_changed');
}

// Called only for the provider's conversation.created event by the relay owner.
// The browser can neither select this identity nor overwrite a captured one.
export async function recordCanvasVoiceProviderConversation(env, scope, conversationId) {
    if (!providerId(conversationId)) fail('canvas_voice_provider_identity_invalid');
    const result = await env.DB.prepare(`UPDATE canvas_voice_sessions SET provider_identity=COALESCE(provider_identity,?)
        WHERE id=? AND user_id=? AND project_id=? AND state IN ('connecting','active') AND accepted_at IS NOT NULL
        AND stop_requested=0 AND (provider_identity IS NULL OR provider_identity=?)
        AND (resume_conversation_id IS NULL OR resume_conversation_id=?)
        AND EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id
          WHERE p.id=canvas_voice_sessions.project_id AND p.user_id=canvas_voice_sessions.user_id AND p.deleted_at IS NULL AND u.status='active')
        AND EXISTS(SELECT 1 FROM sessions WHERE id=canvas_voice_sessions.auth_session_id AND user_id=canvas_voice_sessions.user_id AND expires_at>?)`)
        .bind(conversationId, scope.sessionId, scope.userId, scope.projectId, conversationId, conversationId, nowIso()).run();
    if (result.meta?.changes !== 1) fail('canvas_voice_provider_identity_invalid');
    return { recorded: true };
}
