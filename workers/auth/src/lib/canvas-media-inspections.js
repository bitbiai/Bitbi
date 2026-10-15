import { ownedCanvasVideo } from './canvas-video-input.js';
import { nowIso, sha256Hex, randomTokenHex } from './tokens.js';
import { notifyPrivateMedia } from './private-media-service.js';
import { canvasNodeMediaKind } from '../../../../js/shared/canvas-export.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { resolveCanvasVideoInput } from '../../../../js/shared/canvas-video-input.mjs';
export const inspectionError = (code, status=409) => Object.assign(new Error(code), {code,status});
const fail = (code,status) => { throw inspectionError(code,status); };
const id = value => /^[a-f0-9]{32}$/.test(value||'');
export function inspectionFrame(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))fail('canvas_inspection_invalid',400);
    if(value.kind==='last'&&Object.keys(value).length===1)return {kind:'last'};
    if(value.kind==='time'&&Object.keys(value).sort().join(',')==='kind,seconds'&&Number.isFinite(value.seconds)&&value.seconds>=0&&value.seconds<=600)return {kind:'time',seconds:Math.round(value.seconds*1000)/1000};
    fail('canvas_inspection_invalid',400);
}
export function publicCanvasInspection(row) {
    return {id:row.id,status:row.status,error_code:row.error_code||null,nodeId:row.node_id,assetId:row.source_asset_id,version:row.source_version,
        inspection:row.result_json?JSON.parse(row.result_json):null,
        frame:row.status==='ready'?{imageId:row.id,version:row.source_version,previewUrl:`/api/ai/images/${row.id}/file`}:null};
}
export async function readCanvasMediaInspection(env,userId,projectId,jobId) {
    const row=await env.DB.prepare(`SELECT i.* FROM canvas_media_inspections i JOIN canvas_projects p ON p.id=i.project_id AND p.user_id=i.user_id
        WHERE i.id=? AND i.user_id=? AND i.project_id=? AND p.deleted_at IS NULL`).bind(jobId,userId,projectId).first();
    if(!row)fail('canvas_inspection_not_found',404);return publicCanvasInspection(row);
}
export async function prepareCanvasMediaInspection(env,userId,projectId,input) {
    if(!input||Object.keys(input).sort().join(',')!=='assetId,frame,nodeId,version'||!id(input.nodeId)||!id(input.assetId)||!/^[a-f0-9]{64}$/.test(input.version||''))fail('canvas_inspection_invalid',400);
    const frame=inspectionFrame(input.frame);
    const node=await env.DB.prepare(`SELECT n.* FROM canvas_nodes n JOIN canvas_projects p ON p.id=n.project_id AND p.user_id=n.user_id
        JOIN users u ON u.id=n.user_id WHERE n.id=? AND n.user_id=? AND n.project_id=? AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND u.status='active'`)
        .bind(input.nodeId,userId,projectId).first();
    if(!node||node.asset_id!==input.assetId||canvasNodeMediaKind({...node,content:JSON.parse(node.content_json||'{}'),output:JSON.parse(node.output_json||'null')})!=='video')fail('canvas_inspection_source_changed');
    const source=await ownedCanvasVideo(env,userId,input.assetId,input.version,80000000);
    const jobId=(await sha256Hex(JSON.stringify(['canvas-inspection-v1',userId,projectId,node.id,source.id,source.version,frame]))).slice(0,32),now=nowIso();
    try { await env.DB.prepare(`INSERT OR IGNORE INTO canvas_media_inspections(id,user_id,project_id,node_id,source_asset_id,source_version,source_bytes,frame_json,next_attempt_at,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM canvas_nodes n JOIN canvas_projects p ON p.id=n.project_id JOIN users u ON u.id=n.user_id
        WHERE u.status='active' AND n.id=? AND n.user_id=? AND n.project_id=? AND n.asset_id=? AND n.deleted_at IS NULL AND p.deleted_at IS NULL)`)
        .bind(jobId,userId,projectId,node.id,source.id,source.version,source.size,JSON.stringify(frame),now,now,now,node.id,userId,projectId,source.id).run();
    } catch(error) { if(String(error).includes('canvas_inspection_limit'))fail('canvas_inspection_limit',409);throw error; }
    const result=await readCanvasMediaInspection(env,userId,projectId,jobId);
    if(result.status==='queued')await notifyPrivateMedia(env,'cloudflare');return result;
}
export async function claimCanvasInspections(env,backend) {
    if(backend!=='cloudflare')return [];
    const now=nowIso();
    await env.DB.prepare(`UPDATE canvas_media_inspections SET status='failed',error_code='canvas_inspection_owner_unavailable',locked_until=NULL,updated_at=?
        WHERE status IN ('queued','processing') AND NOT EXISTS(SELECT 1 FROM canvas_projects p JOIN users u ON u.id=p.user_id
        WHERE p.id=canvas_media_inspections.project_id AND p.user_id=canvas_media_inspections.user_id AND p.deleted_at IS NULL AND u.status='active')`).bind(now).run();
    // A private image committed before its completion reply was lost is a
    // durable receipt. Reconcile it before applying the extraction retry limit.
    await env.DB.prepare(`UPDATE canvas_media_inspections SET status='ready',error_code=NULL,locked_until=NULL,updated_at=?
        WHERE status IN ('queued','processing') AND result_json IS NOT NULL AND (locked_until IS NULL OR locked_until<=?)
        AND EXISTS(SELECT 1 FROM ai_images a WHERE a.id=canvas_media_inspections.id AND a.user_id=canvas_media_inspections.user_id)`)
        .bind(now,now).run();
    await env.DB.prepare(`UPDATE canvas_media_inspections SET status='failed',error_code='canvas_inspection_exhausted',locked_until=NULL,updated_at=?
        WHERE status IN ('queued','processing') AND attempt_count>=3 AND (locked_until IS NULL OR locked_until<=?)`).bind(now,now).run();
    const rows=(await env.DB.prepare(`SELECT * FROM canvas_media_inspections WHERE status IN ('queued','processing') AND attempt_count<3
        AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?) ORDER BY next_attempt_at LIMIT 1`).bind(now,now).all()).results;
    const result=[];
    for(const row of rows) {
        const token=randomTokenHex(16),lease=new Date(Date.now()+15*60_000).toISOString();
        const claim=await env.DB.prepare(`UPDATE canvas_media_inspections SET status='processing',processing_token=?,locked_until=?,attempt_count=attempt_count+1,updated_at=?
            WHERE id=? AND status IN ('queued','processing') AND (locked_until IS NULL OR locked_until<=?)`).bind(token,lease,now,row.id,now).run();
        if(claim.meta?.changes)result.push({...row,processing_token:token});
    }
    return result;
}
export async function canvasInspectionClaim(env,jobId,token) {
    if(!id(jobId)||!id(token))return null;
    return env.DB.prepare(`SELECT i.* FROM canvas_media_inspections i JOIN canvas_projects p ON p.id=i.project_id JOIN users u ON u.id=i.user_id
        WHERE i.id=? AND i.processing_token=? AND i.status='processing' AND i.locked_until>? AND p.deleted_at IS NULL AND u.status='active'`)
        .bind(jobId,token,nowIso()).first();
}

// An inspection is provenance, not permission to overwrite a newer edge. The
// caller uses the same project revision as other normal creative mutations.
export async function attachCanvasInspectionFrame(env,userId,projectId,edgeId,inspectionId,expectedRevision,authority=null) {
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('canvas_revision_required',400);
    const inspection=await readCanvasMediaInspection(env,userId,projectId,inspectionId);
    const prepared=await env.DB.prepare("SELECT frame_json FROM canvas_media_inspections WHERE id=? AND status='ready'").bind(inspectionId).first();
    if(!inspection.frame||JSON.parse(prepared?.frame_json||'{}').kind!=='last')fail('canvas_inspection_not_ready');
    const edge=await env.DB.prepare('SELECT * FROM canvas_edges WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(edgeId,projectId,userId).first();
    if(!edge||edge.source_node_id!==inspection.nodeId)fail('canvas_inspection_source_changed');
    const nodes=(await env.DB.prepare('SELECT * FROM canvas_nodes WHERE id IN (?,?) AND project_id=? AND user_id=? AND deleted_at IS NULL')
        .bind(edge.source_node_id,edge.target_node_id,projectId,userId).all()).results;
    const source=nodes.find(n=>n.id===edge.source_node_id),target=nodes.find(n=>n.id===edge.target_node_id);
    const user=await env.DB.prepare("SELECT role FROM users WHERE id=? AND status='active'").bind(userId).first();
    if(!source||!target||!user||source.asset_id!==inspection.assetId||target.type!=='video_generation')fail('canvas_inspection_source_changed');
    await ownedCanvasVideo(env,userId,inspection.assetId,inspection.version,80000000);
    const output=JSON.parse(source.output_json||'{}'),value={kind:'video_asset',assetId:source.asset_id,runId:source.type==='asset_reference'?null:output.runId,sourceNodeId:source.id};
    const selected=resolveCanvasVideoInput(getCanvasModelForRole(target.model_id,user.role),value);
    if(!selected.methods.includes('last_frame'))fail('video_method_invalid');
    const config={...JSON.parse(edge.config_json||'{}'),videoInput:{...selected.context,method:'last_frame',sourceVersion:inspection.version,frame:inspection.frame}};
    const statement=env.DB.prepare(`UPDATE canvas_edges SET config_json=?,updated_at=? WHERE id=? AND user_id=? AND project_id=? AND config_json=? AND deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL)
        AND EXISTS(SELECT 1 FROM canvas_nodes WHERE id=? AND asset_id=? AND output_json IS ? AND deleted_at IS NULL)
        AND EXISTS(SELECT 1 FROM canvas_nodes WHERE id=? AND model_id=? AND deleted_at IS NULL)`)
        .bind(JSON.stringify(config),nowIso(),edgeId,userId,projectId,edge.config_json,projectId,userId,expectedRevision,source.id,source.asset_id,source.output_json,target.id,target.model_id);
    if(authority) {
        if(!id(authority.runId)||!id(authority.leaseToken))fail('canvas_agent_authority_revoked');
        await env.DB.batch([
            env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
                WHERE r.id=? AND r.user_id=? AND r.project_id=? AND r.status='running' AND r.lease_token=? AND r.lease_until>?
                AND p.revision=? AND p.revision=r.expected_revision AND p.deleted_at IS NULL AND u.status='active' AND r.expires_at>?) THEN 1 ELSE json_extract('[]','$[') END`)
                .bind(authority.runId,userId,projectId,authority.leaseToken,nowIso(),expectedRevision,nowIso()),
            env.DB.prepare("UPDATE canvas_agent_runs SET status='applying' WHERE id=? AND lease_token=?").bind(authority.runId,authority.leaseToken),
            statement,
            env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','$[') END"),
            env.DB.prepare("UPDATE canvas_agent_runs SET status='running',expected_revision=(SELECT revision FROM canvas_projects WHERE id=?),updated_at=? WHERE id=? AND lease_token=? AND status='applying'")
                .bind(projectId,nowIso(),authority.runId,authority.leaseToken),
        ]);
    }else{
        const updated=await statement.run();if(!updated.meta?.changes)fail('canvas_project_changed');
    }
    const project=await env.DB.prepare('SELECT revision FROM canvas_projects WHERE id=? AND user_id=?').bind(projectId,userId).first();
    return {edgeId,config,revision:project.revision};
}
