import { canvasVoiceSettings, canvasVoiceProjectDefaults, assertCanvasVoiceSettingsCapabilities } from '../../../../js/shared/canvas-voice-settings.mjs';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { nowIso, sha256Hex } from './tokens.js';
import { agentFail } from './canvas-agent-store.js';
import { CANVAS_VOICE_MAX_SECONDS } from './canvas-voice-pricing.js';

// Capability declarations are not account access, billable admission, or live
// acceptance. The readiness blockers remain explicit until those proofs exist.
export function canvasVoiceCapabilities() {
    return { voiceIds: ['eve', 'ara', 'rex', 'sal', 'leo'], inputCodecs: ['audio/pcm', 'audio/pcmu', 'audio/pcma', 'audio/opus'],
        outputCodecs: ['audio/pcm', 'audio/pcmu', 'audio/pcma', 'audio/opus'], resumption: true,
        tools: ['canvas'], externalToolBudget: false, collectionResourceIds: [], mcpResources: [] };
}
export function canvasVoiceAvailability(env) {
    const blockers = [];
    if (typeof env.XAI_API_KEY !== 'string' || !env.XAI_API_KEY.trim()) blockers.push('canvas_voice_provider_unavailable');
    if (env.CANVAS_VOICE_ENABLED !== 'true') blockers.push('canvas_voice_disabled');
    return { available: blockers.length === 0, code: blockers[0] || null, blockers, capCredits: null, maxCapCredits: 100000,
        maxDurationSeconds: CANVAS_VOICE_MAX_SECONDS, priceLabel: null };
}
export async function requireCanvasVoiceOwner(env, userId, projectId) {
    const project = await env.DB.prepare(`SELECT p.id,p.revision FROM canvas_projects p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL AND u.status='active'`).bind(projectId, userId).first();
    if (!project) agentFail('canvas_project_not_found', 404);
    return project;
}
export async function readCanvasVoiceSettings(env, userId, projectId) {
    const project = await requireCanvasVoiceOwner(env, userId, projectId);
    const row = await env.DB.prepare('SELECT revision,settings_json FROM canvas_voice_settings WHERE project_id=? AND user_id=?').bind(projectId, userId).first();
    return { settings: row ? canvasVoiceSettings(JSON.parse(row.settings_json)) : canvasVoiceProjectDefaults(), revision: row?.revision || 0,
        projectRevision: project.revision, capabilities: canvasVoiceCapabilities(), availability: canvasVoiceAvailability(env) };
}
export async function saveCanvasVoiceSettings(env, userId, projectId, body, key) {
    if (!body || Object.keys(body).some(name => !['settings', 'expectedRevision'].includes(name)) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
        || !/^[A-Za-z0-9._:-]{8,100}$/.test(key || '')) agentFail('canvas_voice_settings_invalid', 400);
    await requireCanvasVoiceOwner(env, userId, projectId);
    const settings = assertCanvasVoiceSettingsCapabilities(body.settings, canvasVoiceCapabilities());
    const inputHash = await sha256Hex(stablePricingJson({ settings, expectedRevision: body.expectedRevision }));
    const previous = await env.DB.prepare('SELECT input_hash FROM canvas_voice_setting_writes WHERE project_id=? AND request_key=?').bind(projectId, key).first();
    if (previous) {
        if (previous.input_hash !== inputHash) agentFail('idempotency_conflict');
        return readCanvasVoiceSettings(env, userId, projectId);
    }
    const now = nowIso(), serialized = JSON.stringify(settings);
    const existing = await readCanvasVoiceSettings(env, userId, projectId);
    if (existing.revision !== body.expectedRevision) agentFail('canvas_voice_settings_changed');
    try { await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id
          WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL AND u.status='active')
          AND COALESCE((SELECT revision FROM canvas_voice_settings WHERE project_id=?),0)=?
          THEN 1 ELSE json_extract('[]','$[') END`).bind(projectId, userId, projectId, body.expectedRevision),
        env.DB.prepare('INSERT INTO canvas_voice_setting_writes(project_id,request_key,input_hash,created_at) VALUES(?,?,?,?)').bind(projectId, key, inputHash, now),
        env.DB.prepare(`INSERT INTO canvas_voice_settings(project_id,user_id,revision,settings_json,updated_at) VALUES(?,?,1,?,?)
          ON CONFLICT(project_id) DO UPDATE SET revision=canvas_voice_settings.revision+1,settings_json=excluded.settings_json,updated_at=excluded.updated_at`)
            .bind(projectId, userId, serialized, now),
    ]); } catch (error) {
        const replay = await env.DB.prepare('SELECT input_hash FROM canvas_voice_setting_writes WHERE project_id=? AND request_key=?').bind(projectId, key).first();
        if (replay) {
            if (replay.input_hash !== inputHash) agentFail('idempotency_conflict');
            return readCanvasVoiceSettings(env, userId, projectId);
        }
        const latest = await readCanvasVoiceSettings(env, userId, projectId);
        if (latest.revision !== body.expectedRevision) agentFail('canvas_voice_settings_changed');
        throw error;
    }
    return { ...await readCanvasVoiceSettings(env, userId, projectId), restartRequired: true };
}
