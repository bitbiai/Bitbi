import { prepareCanvasMediaInspection,readCanvasMediaInspection,attachCanvasInspectionFrame } from './canvas-media-inspections.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { canvasVideoContext } from '../../../../js/shared/canvas-video-input.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { agentFail } from './canvas-agent-store.js';
import { canvasAgentDependencyKind } from './canvas-agent-price-input.js';
import { nowIso } from './tokens.js';

export async function prepareCanvasAgentReferences(env,run,step) {
    const input=JSON.parse(step.input_json),model=getCanvasModelForRole(input.modelId,'member');
    for(const dependency of input.dependencies){
        const source=await env.DB.prepare('SELECT * FROM canvas_nodes WHERE id=? AND user_id=? AND project_id=? AND deleted_at IS NULL').bind(dependency.nodeId,run.user_id,run.project_id).first();
        const output=JSON.parse(source?.output_json||'{}');
        if(canvasAgentDependencyKind(source)!=='video')continue;
        const sourceVersion=source.type==='asset_reference'?JSON.parse(source.content_json||'{}').asset?.sourceVersion:output.sourceVersion;
        const edge=await env.DB.prepare('SELECT * FROM canvas_edges WHERE project_id=? AND user_id=? AND source_node_id=? AND target_node_id=? AND deleted_at IS NULL').bind(run.project_id,run.user_id,dependency.nodeId,step.node_id).first();
        if(!edge)agentFail('canvas_agent_reference_removed');
        const method=dependency.method==='reference'?'reference_video':dependency.method||'reference_video';
        if(method==='reference_video'&&['minimax/h3','google/gemini-omni-flash','bytedance/seedance-2.5'].includes(model.id))continue;
        const original=await ownedCanvasVideo(env,run.user_id,source.asset_id,sourceVersion);
        const config=JSON.parse(edge.config_json);
        if(config.videoInput?.method===method&&config.videoInput.sourceVersion===original.version&&(method!=='last_frame'||config.videoInput.frame?.version===original.version))continue;
        if(method==='last_frame'){
            const job=await prepareCanvasMediaInspection(env,run.user_id,run.project_id,{nodeId:source.id,assetId:original.id,version:original.version,frame:{kind:'last'}});
            const inspection=await readCanvasMediaInspection(env,run.user_id,run.project_id,job.id);
            if(inspection.status==='failed')agentFail('canvas_agent_reference_preparation_failed');
            if(inspection.status!=='ready')return false;
            const attached=await attachCanvasInspectionFrame(env,run.user_id,run.project_id,edge.id,job.id,run.expected_revision,{runId:run.id,leaseToken:run.lease_token});
            run.expected_revision=attached.revision;
        }else{
            const context=canvasVideoContext(model,{assetId:original.id,runId:output.runId,sourceNodeId:source.id});
            config.videoInput={...context,method,sourceVersion:original.version};
            await env.DB.batch([
                env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id WHERE r.id=? AND r.lease_token=? AND r.status='running' AND p.revision=?
                    AND r.lease_until>? AND r.expires_at>? AND p.deleted_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=r.user_id AND status='active')) THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.lease_token,run.expected_revision,nowIso(),nowIso()),
                env.DB.prepare("UPDATE canvas_agent_runs SET status='applying' WHERE id=?").bind(run.id),
                env.DB.prepare('UPDATE canvas_edges SET config_json=? WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(JSON.stringify(config),edge.id,run.user_id),
                env.DB.prepare("UPDATE canvas_agent_runs SET status='running',expected_revision=(SELECT revision FROM canvas_projects WHERE id=?) WHERE id=?").bind(run.project_id,run.id),
            ]);
            run.expected_revision=(await env.DB.prepare('SELECT expected_revision FROM canvas_agent_runs WHERE id=?').bind(run.id).first()).expected_revision;
        }
    }
    return true;
}
