import { nowIso, sha256Hex } from './tokens.js';
import { CANVAS_CLIENT_NOTIFICATION_CODES } from '../../../../js/shared/canvas-notification-contract.mjs';
import { validateCanvasSourceEndFit } from './canvas-export-recipes.js';
import { canvasAgentValidationDiagnostic } from '../../../shared/canvas-agent-plan.mjs';

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,240}$/.test(value);
const code = value => typeof value === 'string' && /^[a-z][a-z0-9_]{1,100}$/.test(value) ? value : 'canvas_request_failed';
const selector = `SELECT n.*,p.title AS project_title,p.deleted_at AS project_deleted_at,r.read_at,
 e.recipe_json AS export_recipe_json,e.seam_result_json AS export_seam_json,e.audio_timeline_json AS export_timeline_json,a.metadata_json AS export_metadata_json,
 i.context_json AS incident_context_json,
 CASE WHEN r.read_at IS NOT NULL THEN r.read_at WHEN n.created_at<b.introduced_at AND n.resolved=1 THEN b.introduced_at ELSE NULL END AS effective_read_at
 FROM canvas_notification_sources n LEFT JOIN canvas_projects p ON p.id=n.project_id AND p.user_id=n.user_id
 LEFT JOIN canvas_video_processing e ON n.source='export' AND e.id=json_extract(n.details_json,'$.exportId') AND e.user_id=n.user_id AND e.project_id=n.project_id AND e.asset_id IS NOT NULL
 LEFT JOIN ai_text_assets a ON a.id=e.id AND e.asset_id=e.id AND a.user_id=n.user_id AND a.canvas_processing_token IS NOT NULL
 LEFT JOIN canvas_agent_incidents i ON i.project_id=n.project_id AND i.user_id=n.user_id AND i.source_notification_id=n.id
 CROSS JOIN canvas_notification_rollout b LEFT JOIN canvas_notification_reads r ON r.user_id=n.user_id AND r.notification_id=n.id`;
const visible = `NOT EXISTS(SELECT 1 FROM canvas_notification_reads d WHERE d.user_id=n.user_id AND d.notification_id=n.id AND d.deleted_at IS NOT NULL)`;
const stateSql = `SELECT COUNT(*) AS totalCount,
 COALESCE(SUM(CASE WHEN r.read_at IS NULL AND (n.created_at>=b.introduced_at OR n.resolved=0) THEN 1 ELSE 0 END),0) AS unreadCount,
 (SELECT COALESCE(MAX(id),0) FROM canvas_notification_mutations WHERE user_id=?) AS inboxRevision
 FROM canvas_notification_sources n CROSS JOIN canvas_notification_rollout b
 LEFT JOIN canvas_notification_reads r ON r.user_id=n.user_id AND r.notification_id=n.id
 WHERE n.user_id=? AND r.deleted_at IS NULL`;
const stateQuery = (env,userId) => env.DB.prepare(stateSql).bind(userId,userId);
function publicItem(row) {
    let details = {};
    try { details = JSON.parse(row.details_json); } catch { /* No untrusted/raw fallback. */ }
    const bounded = {};
    for (const key of ['runId','nodeId','assetId','exportId','actionId','turnId','decisionId','intentId','modelId','actionType','tool']) {
        if (typeof details?.[key] === 'string' && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(details[key])) bounded[key] = details[key];
    }
    for (const key of ['pending','posterPending']) if ([0,1,true,false].includes(details?.[key])) bounded[key] = Boolean(details[key]);
    if (typeof details?.errorCode==='string' && /^[a-z][a-z0-9_]{1,100}$/.test(details.errorCode)) bounded.errorCode=details.errorCode;
    try{
        const context=JSON.parse(row.incident_context_json),diagnostic=canvasAgentValidationDiagnostic(context.operation?.validation||context.validation);
        if(diagnostic)bounded.validationDiagnostic=diagnostic;
        if(['completed','not_submitted','unknown','rejected'].includes(context.operation?.outcome))bounded.providerOutcome=context.operation.outcome;
    }catch{/* Unvalidated diagnostic input is never projected. */}
    if(row.source==='export'&&row.code==='canvas_export_ready') {
        try {
            const recipe=JSON.parse(row.export_recipe_json),fit=JSON.parse(row.export_seam_json)?.sourceEndFit,
                timeline=JSON.parse(row.export_timeline_json),metadata=JSON.parse(row.export_metadata_json);
            if(!recipe.preview&&metadata.canvas_export===details.exportId&&validateCanvasSourceEndFit(recipe,fit,timeline)
                &&Number.isFinite(metadata.duration)&&metadata.duration>0&&metadata.duration<=600
                &&Math.abs(timeline.at(-1).start+timeline.at(-1).duration-metadata.duration)<=Math.max(.25,timeline.length*.06)) {
                bounded.sourceEndFit={policy:fit.policy,clips:fit.clips.length,transitions:fit.transitions.length,
                    durationSeconds:metadata.duration,targetSeconds:recipe.assembly.target.seconds};
            }
        }catch{ /* Absent or invalid historical diagnostics never imply an adjustment. */ }
    }
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
    let where = ` WHERE n.user_id=? AND ${visible}`;
    if (projectId) { where += ' AND n.project_id=?'; params.push(projectId); }
    if (after) { where += ' AND (n.created_at<? OR (n.created_at=? AND n.id<?))'; params.push(after[0],after[0],after[1]); }
    // One D1 snapshot: page, counters and mutation revision cannot disagree.
    const [result,state,baseline] = await env.DB.batch([
        env.DB.prepare(selector + where + ' ORDER BY n.created_at DESC,n.id DESC LIMIT ?').bind(...params,limit + 1),
        stateQuery(env,userId),env.DB.prepare('SELECT introduced_at FROM canvas_notification_rollout WHERE id=1'),
    ]);
    const rows=result.results,page=rows.slice(0,limit);
    return { items:page.map(publicItem),nextCursor:rows.length>limit?encodeCursor(page.at(-1)):null,
        ...state.results[0],viewerId:userId,baselineAt:baseline.results[0].introduced_at };
}
export const readCanvasNotifications = (env,userId,body) => mutateInbox(env,userId,body,'read');
export const deleteCanvasNotifications = (env,userId,body) => mutateInbox(env,userId,body,'delete');
async function mutateInbox(env,userId,body,kind) {
    const allowed=kind==='delete'?['requestId','ids','clientRequestIds','all']:['requestId','ids','all'];
    if(!body||Object.keys(body).some(key=>!allowed.includes(key))||body.all!==undefined&&body.all!==true
        ||body.ids!==undefined&&(!Array.isArray(body.ids)||body.ids.length>100||body.ids.some(id=>!safeId(id)))
        ||body.clientRequestIds!==undefined&&(!Array.isArray(body.clientRequestIds)||body.clientRequestIds.length>60||body.clientRequestIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9._:-]{8,128}$/.test(id)))
        ||body.all&&body.ids?.length||!body.all&&!body.ids?.length&&!body.clientRequestIds?.length
        ||body.requestId!==undefined&&!/^[a-zA-Z0-9._:-]{8,128}$/.test(body.requestId)
        ||(body.all||kind==='delete')&&!body.requestId)fail('canvas_notification_'+kind+'_invalid');
    const ids=[...new Set(body.ids||[])].sort(),clients=[...new Set(body.clientRequestIds||[])].sort();
    const hash=await sha256Hex(JSON.stringify({kind,all:body.all===true,ids,clients}));
    const key=body.requestId||'read:'+hash,now=nowIso(),token=crypto.randomUUID();
    const prior=await env.DB.prepare('SELECT input_hash FROM canvas_notification_mutations WHERE user_id=? AND request_key=?').bind(userId,key).first();
    if(prior&&prior.input_hash!==hash)fail('idempotency_conflict',409);
    const clientIds=await Promise.all(clients.map(async id=>'client:'+(await sha256Hex('canvas-notice:'+userId+':'+id)).slice(0,32)));
    const guard=`EXISTS(SELECT 1 FROM canvas_notification_mutations WHERE user_id=? AND request_key=? AND apply_token=?)`;
    const conflict=kind==='delete'?'DO UPDATE SET deleted_at=COALESCE(deleted_at,excluded.deleted_at)':'DO NOTHING';
    const statements=[
        env.DB.prepare(`INSERT INTO canvas_notification_mutations(user_id,request_key,input_hash,apply_token,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,request_key) DO NOTHING`).bind(userId,key,hash,token,now),
        env.DB.prepare(`INSERT INTO canvas_notification_reads(user_id,notification_id,read_at,deleted_at)
            SELECT n.user_id,n.id,?,? FROM canvas_notification_sources n WHERE n.user_id=? AND ${visible}
            AND (?=1 OR n.id IN (SELECT value FROM json_each(?))) AND ${guard}
            ON CONFLICT(user_id,notification_id) ${conflict}`).bind(now,kind==='delete'?now:null,userId,body.all?1:0,JSON.stringify(ids),userId,key,token),
    ];
    // A pending browser delivery has an owner-derived canonical identity even
    // before it is stored. A late POST cannot resurrect its removed alias.
    if(clientIds.length)statements.push(env.DB.prepare(`INSERT INTO canvas_notification_reads(user_id,notification_id,read_at,deleted_at)
        SELECT ?,value,?,? FROM json_each(?) WHERE ${guard}
        ON CONFLICT(user_id,notification_id) DO UPDATE SET deleted_at=COALESCE(deleted_at,excluded.deleted_at)`)
        .bind(userId,now,now,JSON.stringify(clientIds),userId,key,token));
    statements.push(stateQuery(env,userId),env.DB.prepare(`SELECT notification_id FROM canvas_notification_reads
        WHERE user_id=? AND notification_id IN (SELECT value FROM json_each(?)) AND ${kind==='delete'?'deleted_at IS NOT NULL':'deleted_at IS NULL'}`).bind(userId,JSON.stringify(ids)),
        env.DB.prepare('SELECT input_hash FROM canvas_notification_mutations WHERE user_id=? AND request_key=?').bind(userId,key));
    const result=await env.DB.batch(statements);
    if(result.at(-1).results[0]?.input_hash!==hash)fail('idempotency_conflict',409);
    return {viewerId:userId,...result.at(-3).results[0],[kind==='delete'?'deletedIds':'readIds']:result.at(-2).results.map(row=>row.notification_id),all:body.all===true};
}
export async function recordCanvasClientNotification(env, userId, body) {
    const allowed = ['requestId','code','errorCode','projectId','diagnosticRef','status','source','sourceId'];
    if (!body || Object.keys(body).some(k => !allowed.includes(k)) || !/^[a-zA-Z0-9._:-]{8,128}$/.test(body.requestId || '')) fail('canvas_notification_input_invalid');
    if (body.source || body.sourceId) {
        if (!['action','export','run','event','lifecycle'].includes(body.source) || !safeId(body.sourceId)) fail('canvas_notification_source_invalid');
        const identity=(body.source==='lifecycle'?'project':body.source)+':'+body.sourceId,prefix=identity+':';
        const rows = (await env.DB.prepare(selector + ` WHERE n.user_id=? AND n.source=? AND (n.id=? OR n.id=? OR substr(n.id,1,length(?))=?) ORDER BY n.created_at DESC,n.id DESC LIMIT 1`)
            .bind(userId,body.source,body.sourceId,identity,prefix,prefix).all()).results;
        if(rows[0]?.project_id)await (await import('./canvas-agent-incidents.js')).captureCanvasProjectIncidents(env,rows[0].project_id,userId);
        const removed=rows[0]&&await env.DB.prepare('SELECT deleted_at FROM canvas_notification_reads WHERE user_id=? AND notification_id=? AND deleted_at IS NOT NULL').bind(userId,rows[0].id).first();
        return { viewerId:userId,item:rows[0]&&!removed?publicItem(rows[0]):null,deleted:Boolean(removed) };
    }
    if (!CANVAS_CLIENT_NOTIFICATION_CODES.includes(body.code)) fail('canvas_notification_code_invalid');
    const projectId = body.projectId || null, diagnostic = body.diagnosticRef || null, status = body.status ?? 0, errorCode=body.errorCode ?? null;
    if (errorCode!==null && (typeof errorCode!=='string' || !/^[a-z][a-z0-9_]{1,100}$/.test(errorCode))) fail('canvas_notification_input_invalid');
    if (diagnostic && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(diagnostic) || !Number.isSafeInteger(status) || status < 0 || status > 599) fail('canvas_notification_input_invalid');
    if (projectId && (!/^[a-f0-9]{32}$/.test(projectId) || !await env.DB.prepare('SELECT id FROM canvas_projects WHERE id=? AND user_id=?').bind(projectId,userId).first())) fail('project_not_found',404);
    const id = (await sha256Hex('canvas-notice:' + userId + ':' + body.requestId)).slice(0,32);
    const removed=await env.DB.prepare('SELECT deleted_at FROM canvas_notification_reads WHERE user_id=? AND notification_id=? AND deleted_at IS NOT NULL').bind(userId,'client:'+id).first();
    if(removed)return {viewerId:userId,item:null,deleted:true};
    const prior = await env.DB.prepare('SELECT * FROM canvas_notification_clients WHERE id=? AND user_id=?').bind(id,userId).first();
    if (prior && (prior.code !== body.code || prior.error_code !== errorCode || prior.project_id !== projectId || prior.diagnostic_ref !== diagnostic || prior.http_status !== status)) fail('idempotency_conflict',409);
    if (!prior) {
        // Only browser transport notices have bounded local retention. Original
        // operation history remains under its existing project/receipt lifecycle.
        await env.DB.batch([
            env.DB.prepare(`DELETE FROM canvas_notification_reads WHERE user_id=? AND deleted_at IS NULL AND notification_id IN
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
    if(projectId)await (await import('./canvas-agent-incidents.js')).captureCanvasProjectIncidents(env,projectId,userId);
    const deleted=await env.DB.prepare('SELECT deleted_at FROM canvas_notification_reads WHERE user_id=? AND notification_id=? AND deleted_at IS NOT NULL').bind(userId,'client:'+id).first();
    return {viewerId:userId,item:deleted?null:publicItem(row),deleted:Boolean(deleted)};
}
