import { claimCanvasAgent,readAgentRun,agentTransition,wakeCanvasAgent,agentFail,ACTIVE_AGENT_STATES } from './canvas-agent-store.js';
import { canvasAgentProject } from '../routes/canvas-agent.js';
import { canvasAgentAvailability,canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { executeCanvasAgentPlan } from './canvas-agent-planning.js';
import { prepareCanvasAgentGraph } from './canvas-agent-graph.js';
import { canvasAgentEnvironment } from './canvas-agent-authority.js';
import { saveCanvasMedia } from './canvas-media-storage.js';
import { nowIso,sha256Hex } from './tokens.js';
import { CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { exportMusicSettings } from '../../../../js/shared/canvas-export.mjs';
import { verifyCanvasDuration } from '../../../../js/shared/canvas-assembly.mjs';
import { saveCanvasExport } from './canvas-export-recipes.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { evaluateCanvasAgent,prepareCanvasAgentImprovement } from './canvas-agent-evaluation.js';

async function checkAuthority(env,run) {
    if(run.expires_at<=nowIso())agentFail('canvas_agent_authorization_expired');
    if(run.actions>CANVAS_AGENT_LIMITS.maxActions)agentFail('canvas_agent_action_limit');
    const available=await canvasAgentAvailability(env);if(!available.available)agentFail(available.code);
    const user=await env.DB.prepare("SELECT id,role,status FROM users WHERE id=? AND status='active'").bind(run.user_id).first();
    if(!user)agentFail('canvas_agent_authority_revoked');
    const view=await canvasAgentProject(env,run.user_id,run.project_id);
    if(view.project.revision!==run.expected_revision)agentFail('canvas_agent_project_changed');
    return {user,view};
}
async function generationStep(env,run,step,user) {
    const key=`canvas-agent-${step.id}`;
    let nodeRun=await env.DB.prepare('SELECT * FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(run.user_id,key).first();
    if(nodeRun?.status==='completed') {
        if(nodeRun.asset_id)await saveCanvasMedia(env,run.user_id,run.project_id,nodeRun.id);
        await env.DB.prepare("UPDATE canvas_agent_steps SET status='completed',receipt_json=?,usage_attempt_id=?,updated_at=? WHERE id=?")
            .bind(JSON.stringify({canvasRunId:nodeRun.id,assetId:nodeRun.asset_id}),nodeRun.usage_attempt_id,nowIso(),step.id).run();
        return;
    }
    if(nodeRun){
        const job=await env.DB.prepare('SELECT * FROM member_generation_jobs WHERE canvas_run_id=? AND user_id=?').bind(nodeRun.id,run.user_id).first();
        if(job){
            if(['preview_pending','succeeded'].includes(job.status)){
                // The private durable result is authoritative even if a legacy
                // Canvas projection still says failed/pending. Repair only the
                // stored projection; never repeat a provider request.
                if(!job.result_r2_key)agentFail('canvas_agent_result_review_required');
                const stored=await env.USER_IMAGES.get(job.result_r2_key);
                if(!stored)agentFail('canvas_agent_result_review_required');
                const result=await new Response(stored.body).json();
                if(!result.ok||result.data?.asset?.id!==job.asset_id)agentFail('canvas_agent_result_review_required');
                const {finishCanvasGeneration}=await import('./canvas-video-output.js');
                await finishCanvasGeneration(env,job,result);return;
            }
            if(['queued','processing','ingesting'].includes(job.status))return;
            agentFail(job.error_code==='generation_provider_rejected'?'canvas_agent_provider_rejected':'canvas_agent_provider_review_required');
        }
        // Legacy failed can mean save-pending or unknown dispatch. The ordinary
        // route's exact key permits storage recovery, never a new generation.
        if(nodeRun.error_code==='canvas_agent_admission_wait'){
            if(nodeRun.usage_attempt_id)agentFail('canvas_agent_provider_review_required');
            const retryAt=JSON.parse(nodeRun.output_json||'{}').retryAt;
            if(!Number.isFinite(Date.parse(retryAt)))agentFail('canvas_agent_provider_review_required');
            if(retryAt>nowIso()){await agentTransition(env,run,{phase:'waiting_limit',next_attempt_at:retryAt});return;}
        }else if(nodeRun.error_code!=='canvas_image_save_pending')agentFail('canvas_agent_provider_review_required');
    }
    const input=JSON.parse(step.input_json);
    for(const dep of input.dependencies){
        const source=await env.DB.prepare('SELECT output_json,asset_id,type FROM canvas_nodes WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(dep.nodeId,run.project_id,run.user_id).first();
        if(!source)agentFail('canvas_agent_reference_removed');
        if(!source.output_json&&!['text_prompt','note'].includes(source.type))return;
    }
    const {prepareCanvasAgentReferences}=await import('./canvas-agent-references.js');
    if(!await prepareCanvasAgentReferences(env,run,step,user))return;
    const current=await readAgentRun(env,run.id);
    if(current.status!=='running'||current.lease_token!==run.lease_token)agentFail('canvas_agent_claim_lost');
    const scoped=canvasAgentEnvironment(env,{runId:run.id,stepId:step.id,projectId:run.project_id,userId:run.user_id,leaseToken:run.lease_token});
    const pathname=`/api/account/canvas/projects/${run.project_id}/nodes/${step.node_id}/run`;
    const request=new Request(`https://bitbi.ai${pathname}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-Bitbi-Tariff-Revision':String(run.tariff_revision)},body:'{}'});
    const {runCanvasNode}=await import('../routes/canvas.js');
    const response=await runCanvasNode({env:scoped,request,pathname,method:'POST',canvasUser:user},{user},run.project_id,step.node_id);
    const payload=await response.json();
    if(payload.code==='canvas_agent_admission_wait'){
        const retryAt=payload.data?.retryAt;
        if(!Number.isFinite(Date.parse(retryAt)))agentFail('canvas_agent_provider_review_required');
        await agentTransition(env,run,{phase:'waiting_limit',next_attempt_at:new Date(retryAt).toISOString()});return;
    }
    if(!payload.ok&&!['canvas_video_pending','canvas_image_save_pending','canvas_run_in_progress'].includes(payload.code))agentFail(payload.code||'canvas_agent_node_blocked');
    if(run.phase==='waiting_limit')await agentTransition(env,run,{phase:'generating'});
    await env.DB.prepare("UPDATE canvas_agent_steps SET status='accepted',receipt_json=?,updated_at=? WHERE id=? AND status='ready'")
        .bind(JSON.stringify({canvasRunId:payload.data?.run?.id||payload.data?.run_id}),nowIso(),step.id).run();
    await env.DB.prepare('UPDATE canvas_agent_runs SET actions=actions+1 WHERE id=? AND lease_token=?').bind(run.id,run.lease_token).run();
}
async function exportStep(env,run,view) {
    const assembly=JSON.parse(view.project.assembly_json),anchor=assembly.anchorNodeId||assembly.clips.at(-1)?.nodeId;
    if(!anchor)agentFail('canvas_agent_assembly_missing');
    const stepId=(await sha256Hex(`canvas-agent-export:${run.id}`)).slice(0,32),key=`agent_export_${stepId}`;
    let step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='export'").bind(run.id).first();
    if(!step){
        const node=view.nodes.find(n=>n.id===anchor),config=JSON.parse(node?.config_json||'{}');
        const body={assemblyRevision:view.project.revision,backgroundMusic:exportMusicSettings(assembly.backgroundMusic??config.backgroundMusic),smoothJoins:(assembly.smoothJoins??config.smoothJoins)===true};
        await env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,node_id,input_json,created_at,updated_at) VALUES(?,?,'export','export',?,?,?,?)`)
            .bind(stepId,run.id,anchor,JSON.stringify(body),nowIso(),nowIso()).run();
        step=await env.DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(stepId).first();
    }
    const {canvasExport}=await import('../routes/canvas-video-processing.js');
    const pathname=`/api/account/canvas/projects/${run.project_id}/nodes/${anchor}/full-video`;
    const request=new Request(`https://bitbi.ai${pathname}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:step.input_json});
    // Replays observe the exact immutable export. No inference or wallet debit.
    const scoped=canvasAgentEnvironment(env,{runId:run.id,stepId:step.id,projectId:run.project_id,userId:run.user_id,leaseToken:run.lease_token});
    const response=await canvasExport({env:scoped,request,pathname,method:'POST'},run.user_id,run.project_id,{nodeId:anchor});
    const payload=await response.json();if(!payload.ok)agentFail(payload.code||'canvas_agent_export_failed');
    const output=payload.data.export;
    if(!output?.id)agentFail('canvas_agent_export_unavailable');
    await env.DB.prepare("UPDATE canvas_agent_steps SET status='accepted',receipt_json=?,updated_at=? WHERE id=? AND status='ready'").bind(JSON.stringify({exportId:output.id}),nowIso(),stepId).run();
    const row=await env.DB.prepare('SELECT * FROM canvas_video_processing WHERE id=? AND user_id=?').bind(output.id,run.user_id).first();
    if(row.status==='failed')agentFail(row.error_code||'canvas_agent_export_failed');
    if(!['ready','preview_pending'].includes(row.status)||!row.asset_id)return;
    const metadata=JSON.parse(row.output_json||'{}');
    // The processor completion route verifies measured duration/streams and the
    // immutable source sequence before this owned saved result can exist.
    const asset=await env.DB.prepare('SELECT metadata_json FROM ai_text_assets WHERE id=? AND user_id=?').bind(row.asset_id,run.user_id).first();
    const stored=JSON.parse(asset?.metadata_json||'{}');
    const duration=metadata.duration??stored.duration??stored.duration_seconds;
    verifyCanvasDuration(duration,assembly.target);
    const original=await ownedCanvasVideo(env,run.user_id,row.asset_id,null,80_000_000);
    await saveCanvasExport(env,run.user_id,run.project_id,{nodeId:anchor},row.id);
    await env.DB.prepare("UPDATE canvas_agent_steps SET status='completed',updated_at=? WHERE id=?").bind(nowIso(),stepId).run();
    await agentTransition(env,run,{status:'completed',phase:'completed',error_code:null,result_json:JSON.stringify({...JSON.parse(run.result_json||'{}'),exportId:row.id,assetId:row.asset_id,
        fileUrl:`/api/ai/text-assets/${row.asset_id}/file`,previewUrl:`/api/ai/text-assets/${row.asset_id}/poster`,sourceVersion:original.version,
        targetDurationSeconds:run.target_seconds,toleranceSeconds:run.tolerance_seconds,measuredDurationSeconds:duration,technicalValidation:'processor_measured'})});
}
export async function processCanvasAgent(env,id) {
    // Receipt ingestion/settlement is independent of a creative execution
    // lease. A cancellation still retains the already accepted paid result.
    const {reconcileCanvasAgentModelOperations}=await import('./canvas-agent-model-operations.js');
    await reconcileCanvasAgentModelOperations(env,{runId:id});
    let run=await claimCanvasAgent(env,id);if(!run)return {status:'ignored'};
    try {
        const {user,view}=await checkAuthority(env,run);
        if(['queued','planning'].includes(run.status)){
            await agentTransition(env,run,{status:'planning',phase:'planning'});
            const step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid DESC LIMIT 1").bind(id).first();
            if(step.status==='accepted'&&!step.receipt_json)agentFail('canvas_agent_planning_review_required');
            const plan=step.status==='completed'?JSON.parse(step.receipt_json).data?.plan||JSON.parse(step.receipt_json).plan:await executeCanvasAgentPlan(env,run,step,user);
            if(!plan)return {status:'waiting_model'};
            const inventory=await canvasAgentCapabilities(env);
            if(inventory.revision!==run.capability_revision)agentFail('canvas_agent_capabilities_changed');
            await prepareCanvasAgentGraph(env,run,view,inventory,plan,JSON.parse(step.input_json).repairNodes||null);
        } else if(run.status==='running'){
            const steps=(await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='node' ORDER BY created_at,rowid").bind(id).all()).results;
            const pending=steps.filter(s=>s.status!=='completed');
            if(!pending.length){
                await agentTransition(env,run,{phase:'evaluating'});
                const evaluation=await evaluateCanvasAgent(env,run,view,user);
                if(evaluation?.accepted)await agentTransition(env,run,{status:'exporting',phase:'exporting'});
                else if(evaluation)await prepareCanvasAgentImprovement(env,run,view,evaluation);
            }
            else {
                const ready=pending.find(s=>JSON.parse(s.input_json).dependencies.every(dep=>!steps.some(t=>t.node_id===dep.nodeId&&t.status!=='completed')));
                if(!ready)agentFail('canvas_agent_dependency_blocked');
                await generationStep(env,run,ready,user);
            }
        } else if(run.status==='exporting')await exportStep(env,run,view);
    } catch(error){
        const code=/^[a-z0-9_]{1,90}$/.test(error?.code||'')?error.code:'canvas_agent_execution_review_required';
        const status=/unknown|review|required|claim_lost|provider_timeout/.test(code)?'review_required':'blocked';
        await env.DB.prepare('UPDATE canvas_agent_runs SET status=?,error_code=?,updated_at=? WHERE id=? AND lease_token=?')
            .bind(status,code,nowIso(),id,run.lease_token).run();
    } finally {
        const next=new Date(Math.max(Date.now()+10000,Date.parse(run.next_attempt_at)||0)).toISOString();
        await env.DB.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL,next_attempt_at=? WHERE id=? AND lease_token=?').bind(next,id,run.lease_token).run();
        run=await readAgentRun(env,id);
        if(ACTIVE_AGENT_STATES.includes(run.status))await wakeCanvasAgent(env,id,Math.min(43200,Math.max(10,Math.ceil((Date.parse(next)-Date.now())/1000))));
    }
    return {status:run.status};
}
