import appearanceContract from '../../../../js/shared/appearance-contract.js';
import { buildAdminAuditEvent } from './activity.js';
import { buildActivitySearchRecord } from './activity-search.js';

const { DEFAULT_SEGMENTS, normalizeAppearance } = appearanceContract;
export const APPEARANCE_SETTING_KEY = 'appearance.global.v1';
const initial = () => ({ version: 1, revision: 0, segments: { ...DEFAULT_SEGMENTS }, personalEnabled: false });

export class AppearanceError extends Error {
    constructor(message, status = 400, code = 'appearance_invalid') {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function unavailable() {
    return new AppearanceError('Appearance settings are temporarily unavailable.', 503, 'appearance_unavailable');
}

async function readStored(env) {
    if (!env?.DB) throw unavailable();
    const row = await env.DB.prepare('SELECT value_json, updated_at FROM app_settings WHERE key = ? LIMIT 1')
        .bind(APPEARANCE_SETTING_KEY).first();
    if (!row) return { appearance: initial(), raw: JSON.stringify(initial()), updatedAt: null };
    try {
        const value = JSON.parse(row.value_json);
        return { appearance: normalizeAppearance(value), raw: row.value_json, updatedAt: row.updated_at };
    } catch { throw unavailable(); }
}

export async function getAppearance(env, { admin = false } = {}) {
    const stored = await readStored(env);
    return admin ? { ...stored.appearance, updatedAt: stored.updatedAt } : stored.appearance;
}

export async function saveAppearance(env, actor, input) {
    if (!actor?.id || actor.role !== 'admin') throw new AppearanceError('Admin privileges required.', 403, 'appearance_forbidden');
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['revision', 'segments'].includes(key))
        || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision === Number.MAX_SAFE_INTEGER) {
        throw new AppearanceError('Provide the current revision and all five segment themes.');
    }
    let requested;
    try { requested = normalizeAppearance({ version: 1, revision: input.revision, segments: input.segments, personalEnabled: false }); }
    catch { throw new AppearanceError('Each of the five segments must use dark, light or soft.'); }
    const current = await readStored(env);
    if (current.appearance.revision !== input.revision) throw new AppearanceError('Appearance was changed elsewhere. Reload before saving.', 409, 'appearance_conflict');
    const next = { ...requested, revision: requested.revision + 1 };
    const updatedAt = new Date().toISOString(), changeId = crypto.randomUUID();
    // The unique change id ties audit/index writes to this exact successful CAS,
    // including two writers choosing the same segment values and revision.
    const raw = JSON.stringify({ ...next, changeId });
    const event = buildAdminAuditEvent({ id: changeId, adminUserId: actor.id, action: 'appearance.updated', createdAt: updatedAt,
        meta: { entity_type: 'app_settings', entity_id: APPEARANCE_SETTING_KEY, before: current.appearance, after: next } });
    const index = buildActivitySearchRecord(event);
    const results = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO app_settings (key, value_json, updated_at, updated_by_user_id, reason) VALUES (?, ?, ?, NULL, NULL)')
            .bind(APPEARANCE_SETTING_KEY, JSON.stringify(initial()), updatedAt),
        env.DB.prepare('UPDATE app_settings SET value_json = ?, updated_at = ?, updated_by_user_id = ?, reason = ? WHERE key = ? AND value_json = ?')
            .bind(raw, updatedAt, actor.id, 'Admin appearance change', APPEARANCE_SETTING_KEY, current.raw),
        env.DB.prepare(`INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
            SELECT ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM app_settings WHERE key = ? AND value_json = ?)`)
            .bind(event.event_id, event.admin_user_id, event.action, event.meta_json, event.created_at, APPEARANCE_SETTING_KEY, raw),
        env.DB.prepare(`INSERT INTO activity_search_index (source_table, source_event_id, actor_user_id, actor_email_norm,
            target_user_id, target_email_norm, action_norm, entity_type, entity_id, summary, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id = ?)`)
            .bind(index.source_table, index.source_event_id, index.actor_user_id, index.actor_email_norm, index.target_user_id,
                index.target_email_norm, index.action_norm, index.entity_type, index.entity_id, index.summary, index.created_at, event.event_id),
    ]);
    if (results[1]?.meta?.changes !== 1) throw new AppearanceError('Appearance was changed elsewhere. Reload before saving.', 409, 'appearance_conflict');
    return { ...next, updatedAt };
}
