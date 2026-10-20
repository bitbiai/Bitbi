import { nowIso, sha256Hex } from './tokens.js';
import { CANVAS_CLIENT_NOTIFICATION_CODES } from '../../../../js/shared/canvas-notification-contract.mjs';

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,240}$/.test(value);
const code = value => typeof value === 'string' && /^[a-z][a-z0-9_]{1,100}$/.test(value) ? value : 'canvas_request_failed';
const selector = `SELECT n.*,p.title AS project_title,p.deleted_at AS project_deleted_at,r.read_at,
 CASE WHEN r.read_at IS NOT NULL THEN r.read_at WHEN n.created_at<b.introduced_at AND n.resolved=1 THEN b.introduced_at ELSE NULL END AS effective_read_at
 FROM canvas_notification_sources n LEFT JOIN canvas_projects p ON p.id=n.project_id AND p.user_id=n.user_id
 CROSS JOIN canvas_notification_rollout b LEFT JOIN canvas_notification_reads r ON r.user_id=n.user_id AND r.notification_id=n.id`;
const unreadSql = `SELECT COUNT(*) AS count FROM canvas_notification_sources n CROSS JOIN canvas_notification_rollout b
 LEFT JOIN canvas_notification_reads r ON r.user_id=n.user_id AND r.notification_id=n.id
 WHERE n.user_id=? AND r.read_at IS NULL AND (n.created_at>=b.introduced_at OR n.resolved=0)`;
const unread = async (env, userId) => Number((await env.DB.prepare(unreadSql).bind(userId).first())?.count || 0);
function publicItem(row) {
    let details = {};
    try { details = JSON.parse(row.details_json); } catch { /* No untrusted/raw fallback. */ }
    const bounded = {};
    for (const key of ['runId','nodeId','assetId','exportId','actionId','turnId','decisionId','intentId','modelId','actionType','tool']) {
        if (typeof details?.[key] === 'string' && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(details[key])) bounded[key] = details[key];
    }
    for (const key of ['pending','posterPending']) if ([0,1,true,false].includes(details?.[key])) bounded[key] = Boolean(details[key]);
    if (typeof details?.errorCode==='string' && /^[a-z][a-z0-9_]{1,100}$/.test(details.errorCode)) bounded.errorCode=details.errorCode;
    return { id: row.id, source: row.source, kind: row.kind, code: code(row.code), severity: row.severity,
        projectId: row.project_id || null, projectTitle: String(row.project_title || '').slice(0,120), projectDeleted: Boolean(row.project_deleted_at),
        createdAt: row.created_at, readAt: row.effective_read_at || null, resolved: Boolean(row.resolved),
        diagnosticRef: /^[a-zA-Z0-9_.:-]{1,128}$/.test(row.diagnostic_ref || '') ? row.diagnostic_ref : null,
        stage: /^[a-z_]{1,64}$/.test(row.stage || '') ? row.stage : null,
        status: row.source === 'client' ? Number(row.status) || 0 : row.status, confirmed: Boolean(row.confirmed), details: bounded };
}
const encodeCursor = row => btoa(JSON.stringify([row.created_at,row.id]));
function decodeCursor(value) {
    if (!value) return null;
    if (value.length > 600) fail('canvas_notification_cursor_invalid');
    let row; try { row = JSON.parse(atob(value)); } catch { fail('canvas_notification_cursor_invalid'); }
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row[0]) || !safeId(row[1])) fail('canvas_notification_cursor_invalid');
    return row;
}
export async function listCanvasNotifications(env, userId, { cursor = null, limit = 40, projectId = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) fail('canvas_notification_limit_invalid');
    if (projectId && !/^[a-f0-9]{32}$/.test(projectId)) fail('canvas_notification_project_invalid');
    const after = decodeCursor(cursor), params = [userId];
    let where = ' WHERE n.user_id=?';
    if (projectId) { where += ' AND n.project_id=?'; params.push(projectId); }
    if (after) { where += ' AND (n.created_at<? OR (n.created_at=? AND n.id<?))'; params.push(after[0],after[0],after[1]); }
    const rows = (await env.DB.prepare(selector + where + ' ORDER BY n.created_at DESC,n.id DESC LIMIT ?').bind(...params,limit + 1).all()).results;
    const page = rows.slice(0,limit), baseline = await env.DB.prepare('SELECT introduced_at FROM canvas_notification_rollout WHERE id=1').first();
    return { items: page.map(publicItem), nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null,
        unreadCount: await unread(env,userId), viewerId: userId, baselineAt: baseline.introduced_at };
}
export async function readCanvasNotifications(env, userId, body) {
    if (!body || Object.keys(body).some(k => k !== 'ids') || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some(id => !safeId(id))) fail('canvas_notification_read_invalid');
    const ids = [...new Set(body.ids)], now = nowIso();
    // Only exact presented identities are acknowledged. A later outcome or a new
    // arrival has another identity and cannot be consumed by this request.
    await env.DB.batch(ids.map(id => env.DB.prepare(`INSERT INTO canvas_notification_reads(user_id,notification_id,read_at)
        SELECT user_id,id,? FROM canvas_notification_sources WHERE user_id=? AND id=?
        ON CONFLICT(user_id,notification_id) DO NOTHING`).bind(now,userId,id)));
    // D1 permits 100 bound values per statement. Keep the owner plus the entire
    // validated 100-ID selection in two bindings, including on replay.
    const rows = (await env.DB.prepare('SELECT notification_id FROM canvas_notification_reads WHERE user_id=? AND notification_id IN (SELECT value FROM json_each(?))').bind(userId,JSON.stringify(ids)).all()).results;
    return { viewerId: userId, readIds: rows.map(row => row.notification_id), unreadCount: await unread(env,userId) };
}
export async function recordCanvasClientNotification(env, userId, body) {
    const allowed = ['requestId','code','errorCode','projectId','diagnosticRef','status','source','sourceId'];
    if (!body || Object.keys(body).some(k => !allowed.includes(k)) || !/^[a-zA-Z0-9._:-]{8,128}$/.test(body.requestId || '')) fail('canvas_notification_input_invalid');
    if (body.source || body.sourceId) {
        if (!['action','export','run','event','lifecycle'].includes(body.source) || !safeId(body.sourceId)) fail('canvas_notification_source_invalid');
        const identity=(body.source==='lifecycle'?'project':body.source)+':'+body.sourceId,prefix=identity+':';
        const rows = (await env.DB.prepare(selector + ` WHERE n.user_id=? AND n.source=? AND (n.id=? OR n.id=? OR substr(n.id,1,length(?))=?) ORDER BY n.created_at DESC,n.id DESC LIMIT 1`)
            .bind(userId,body.source,body.sourceId,identity,prefix,prefix).all()).results;
        return { viewerId: userId, item: rows[0] ? publicItem(rows[0]) : null };
    }
    if (!CANVAS_CLIENT_NOTIFICATION_CODES.includes(body.code)) fail('canvas_notification_code_invalid');
    const projectId = body.projectId || null, diagnostic = body.diagnosticRef || null, status = body.status ?? 0, errorCode=body.errorCode ?? null;
    if (errorCode!==null && (typeof errorCode!=='string' || !/^[a-z][a-z0-9_]{1,100}$/.test(errorCode))) fail('canvas_notification_input_invalid');
    if (diagnostic && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(diagnostic) || !Number.isSafeInteger(status) || status < 0 || status > 599) fail('canvas_notification_input_invalid');
    if (projectId && (!/^[a-f0-9]{32}$/.test(projectId) || !await env.DB.prepare('SELECT id FROM canvas_projects WHERE id=? AND user_id=?').bind(projectId,userId).first())) fail('project_not_found',404);
    const id = (await sha256Hex('canvas-notice:' + userId + ':' + body.requestId)).slice(0,32);
    const prior = await env.DB.prepare('SELECT * FROM canvas_notification_clients WHERE id=? AND user_id=?').bind(id,userId).first();
    if (prior && (prior.code !== body.code || prior.error_code !== errorCode || prior.project_id !== projectId || prior.diagnostic_ref !== diagnostic || prior.http_status !== status)) fail('idempotency_conflict',409);
    if (!prior) {
        // Only browser transport notices have bounded local retention. Original
        // operation history remains under its existing project/receipt lifecycle.
        await env.DB.batch([
            env.DB.prepare(`DELETE FROM canvas_notification_reads WHERE user_id=? AND notification_id IN
                (SELECT 'client:'||id FROM canvas_notification_clients WHERE user_id=? AND created_at<?)`).bind(userId,userId,new Date(Date.now()-90*86400000).toISOString()),
            env.DB.prepare('DELETE FROM canvas_notification_clients WHERE user_id=? AND created_at<?').bind(userId,new Date(Date.now()-90*86400000).toISOString()),
            env.DB.prepare(`INSERT INTO canvas_notification_clients(id,user_id,request_key,project_id,code,error_code,diagnostic_ref,http_status,created_at)
                SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM canvas_notification_clients WHERE user_id=?)<500
                ON CONFLICT(user_id,request_key) DO NOTHING`).bind(id,userId,body.requestId,projectId,body.code,errorCode,diagnostic,status,nowIso(),userId),
        ]);
    }
    const row = (await env.DB.prepare(selector + ' WHERE n.user_id=? AND n.id=?').bind(userId,'client:'+id).all()).results[0];
    if (!row) fail('canvas_notification_capacity',429);
    // A racing replay with a changed body must not silently accept the first.
    const saved = await env.DB.prepare('SELECT * FROM canvas_notification_clients WHERE id=? AND user_id=?').bind(id,userId).first();
    if (saved.code !== body.code || saved.error_code !== errorCode || saved.project_id !== projectId || saved.diagnostic_ref !== diagnostic || saved.http_status !== status) fail('idempotency_conflict',409);
    return { viewerId: userId, item: publicItem(row) };
}
