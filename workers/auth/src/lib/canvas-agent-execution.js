import { canvasProductionFailure,canvasExecutionDiagnostic } from './canvas-agent-execution-failure.js';
import { claimCanvasAgent,readAgentRun,agentTransition,wakeCanvasAgent,agentFail,ACTIVE_AGENT_STATES } from './canvas-agent-store.js';
import { canvasAgentProject } from '../routes/canvas-agent.js';
import { canvasAgentCapabilities } from './canvas-agent-capabilities.js';
import { canvasAssistantAvailability } from './canvas-agent-assistant-models.js';
import { canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { executeCanvasAgentPlan,requireCanvasAgentProviderReadiness } from './canvas-agent-planning.js';
import { prepareCanvasAgentGraph,preflightCanvasAgentGraph } from './canvas-agent-graph.js';
import { canvasAgentEnvironment } from './canvas-agent-authority.js';
import { saveCanvasMedia } from './canvas-media-storage.js';
import { nowIso,sha256Hex } from './tokens.js';
import { CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';
import { exportMusicSettings } from '../../../../js/shared/canvas-export.mjs';
import { verifyCanvasDuration } from '../../../../js/shared/canvas-assembly.mjs';
import { saveCanvasExport } from './canvas-export-recipes.js';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { evaluateCanvasAgent,prepareCanvasAgentImprovement } from './canvas-agent-evaluation.js';
import { persistCanvasAgentProposal,markCanvasAgentProposal,appendCanvasAgentEvent } from './canvas-agent-progress.js';
import { prepareCanvasAgentCorrection } from './canvas-agent-repair.js';
import { requestCanvasAgentBudget } from './canvas-agent-budget.js';
import { canvasDialogueFailure,logCanvasDialogueStage } from './canvas-agent-dialogue-state.js';
import { imageGenerationCapacity } from './image-generation-capacity.js';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { canvasAgentValidationDiagnostic } from '../../../shared/canvas-agent-plan.mjs';
import { readValidCanvasPlanInterpretation,persistCanvasPlanInterpretation,readCanvasCompletedInvalidPlan } from './canvas-agent-plan-interpretation.js';
import { completeCanvasAgentMedia } from './canvas-agent-media-completion.js';

async function checkAuthority(env,run) {
    if(run.expires_at<=nowIso())agentFail('canvas_agent_authorization_expired');
    if(run.actions>CANVAS_AGENT_LIMITS.maxActions)agentFail('canvas_agent_action_limit');
    // Local disable, pricing and model-area gates still apply on every wake.
    // Already accepted media must not depend on an unrelated AI service probe.
    const available=await canvasAssistantAvailability(env,canvasAssistantModelId(run.model_id),{dialogue:run.purpose==='briefing',providerReadiness:false});if(!available.available)agentFail(available.code);
    const user=await env.DB.prepare("SELECT id,role,status FROM users WHERE id=? AND status='active'").bind(run.user_id).first();
    if(!user)agentFail('canvas_agent_authority_revoked');
    const view=await canvasAgentProject(env,run.user_id,run.project_id);
    if(run.purpose!=='briefing'&&view.project.revision!==run.expected_revision)agentFail('canvas_agent_project_changed');
    if(run.purpose!=='briefing')await (await import('./canvas-agent-plan-correction-review.js')).assertCanvasPlanReviewCurrent(env,run);
    return {user,view};
}
async function generationStep(env,run,step,user,requireReadiness) {
    const boundary={stage:'media_lookup'};
    try{return await reconcileGenerationStep(env,run,step,user,requireReadiness,boundary);}
    catch(error){
        error.executionDiagnostic=await canvasExecutionDiagnostic(error,{stage:boundary.stage,stepId:step.id});
        throw error;
    }
}
async function reconcileGenerationStep(env,run,step,user,requireReadiness,boundary) {
    const key=`canvas-agent-${step.id}`;
    let nodeRun=await env.DB.prepare('SELECT * FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(run.user_id,key).first();
    if(nodeRun?.status==='completed') {
        boundary.stage='media_completion';
        const durable=await env.DB.prepare('SELECT id,status FROM member_generation_jobs WHERE canvas_run_id=? AND user_id=?').bind(nodeRun.id,run.user_id).first();
        if(durable){
            // finishCanvasGeneration publishes the node before the job's final
            // write. Its still-running owner retains storage/settlement recovery;
            // a visible image is not yet proof that the whole job is complete.
            if(['queued','processing','ingesting'].includes(durable.status))return;
            await completeCanvasAgentMedia(env,run,step);return;
        }
        if(nodeRun.asset_id)await saveCanvasMedia(env,run.user_id,run.project_id,nodeRun.id);
        await env.DB.prepare("UPDATE canvas_agent_steps SET status='completed',receipt_json=?,usage_attempt_id=?,updated_at=? WHERE id=?")
            .bind(JSON.stringify({canvasRunId:nodeRun.id,assetId:nodeRun.asset_id}),nodeRun.usage_attempt_id,nowIso(),step.id).run();
        await appendCanvasAgentEvent(env,run,`media:${step.id}`,'media',{code:'media_ready',phase:'generating',nodeId:step.node_id,tool:'asset.save'});
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
                boundary.stage='media_projection';
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
    boundary.stage='media_reference';
    const input=JSON.parse(step.input_json);
    for(const dep of input.dependencies){
        const source=await env.DB.prepare('SELECT output_json,asset_id,type FROM canvas_nodes WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL').bind(dep.nodeId,run.project_id,run.user_id).first();
        if(!source)agentFail('canvas_agent_reference_removed');
        if(!source.output_json&&!(source.type==='asset_reference'&&source.asset_id)&&!['text_prompt','note'].includes(source.type))return;
    }
    const {prepareCanvasAgentReferences}=await import('./canvas-agent-references.js');
    if(!await prepareCanvasAgentReferences(env,run,step,user))return;
    const current=await readAgentRun(env,run.id);
    if(current.status!=='running'||current.lease_token!==run.lease_token)agentFail('canvas_agent_claim_lost');
    if(current.actions>=CANVAS_AGENT_LIMITS.maxActions)agentFail('canvas_agent_action_limit');
    if(!nodeRun||nodeRun.error_code==='canvas_agent_admission_wait')await requireReadiness();
    const scoped=canvasAgentEnvironment(env,{runId:run.id,stepId:step.id,projectId:run.project_id,userId:run.user_id,leaseToken:run.lease_token});
    const pathname=`/api/account/canvas/projects/${run.project_id}/nodes/${step.node_id}/run`;
    const request=new Request(`https://bitbi.ai${pathname}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-Bitbi-Tariff-Revision':String(run.tariff_revision)},body:'{}'});
    const {runCanvasNode}=await import('../routes/canvas.js');
    await appendCanvasAgentEvent(env,run,`generate:${step.id}`,'action',{code:'generating',phase:'generating',nodeId:step.node_id,model:input.modelId,tool:'node.execute'});
    boundary.stage='media_admission';
    const response=await runCanvasNode({env:scoped,request,pathname,method:'POST',canvasUser:user},{user},run.project_id,step.node_id);
    boundary.stage='media_acceptance';
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
    await appendCanvasAgentEvent(env,run,'export','action',{code:'exporting',phase:'exporting',tool:'video.export'});
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
    await appendCanvasAgentEvent(env,run,'complete','action',{code:'completed',phase:'completed',tool:'asset.save'});
}
export async function processCanvasAgent(env,id) {
    // Receipt ingestion/settlement is independent of a creative execution
    // lease. A cancellation still retains the already accepted paid result.
    const {reconcileCanvasAgentModelOperations}=await import('./canvas-agent-model-operations.js');
    await reconcileCanvasAgentModelOperations(env,{runId:id});
    const pending=await readAgentRun(env,id);
    if(pending?.status==='planning'&&JSON.parse(pending.cause_json||'{}').recovery==='local_retry'){
        if(pending.lease_until>nowIso())return {status:'ignored'};
        try{await (await import('./canvas-agent-planning-recovery.js')).readmitCanvasPlanning(env,pending,{automatic:true});}
        catch(error){
            const execution=await canvasExecutionDiagnostic(error,{stage:'reservation'});
            const cause={...JSON.parse(pending.cause_json),recovery:'support',readmissionFailure:execution};
            const stopped=await env.DB.prepare("UPDATE canvas_agent_runs SET status='blocked',cause_json=?,updated_at=? WHERE id=? AND status='planning' AND cause_json=?")
                .bind(JSON.stringify(cause),nowIso(),id,pending.cause_json).run();
            if(stopped.meta?.changes===1)await appendCanvasAgentEvent(env,pending,`readmission:${execution.reference}`,'error',
                {phase:pending.phase,code:execution.reason,tool:'production.resume',execution});
            return {status:'blocked'};
        }
    }
    let run=await claimCanvasAgent(env,id);if(!run)return {status:'ignored'};
    if(run.purpose==='briefing'&&run.status==='queued')logCanvasDialogueStage('consumer_received',{runId:id,durationMs:Date.now()-Date.parse(run.created_at)});
    try {
        const {user,view}=await checkAuthority(env,run);
        let readinessChecked=false;
        const requireReadiness=async()=>{if(!readinessChecked){await requireCanvasAgentProviderReadiness(env,run);readinessChecked=true;}};
        if(run.purpose==='briefing'){
            const {processCanvasAgentConversation}=await import('./canvas-agent-conversation.js');
            await processCanvasAgentConversation(env,run,user);
        } else if(['queued','planning'].includes(run.status)){
            await agentTransition(env,run,{status:'planning',phase:'planning'});
            const step=await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid DESC LIMIT 1").bind(id).first();
            if(step.status==='accepted'&&!step.receipt_json)agentFail('canvas_agent_planning_review_required');
            let plan=step.status==='rejected'?await readValidCanvasPlanInterpretation(env,run,step):null;
            if(!plan)try {
                plan=step.status==='completed'?JSON.parse(step.receipt_json).data?.plan||JSON.parse(step.receipt_json).plan:await executeCanvasAgentPlan(env,run,step,user);
            } catch(error) {
                if(error.code!=='canvas_agent_plan_invalid'||error.outcome!=='completed')throw error;
                // A verified completed response may need a separately identified
                // correction. Unknown acceptance never enters this path.
                const invalid=await readCanvasCompletedInvalidPlan(env,run,step);
                if(!invalid)throw error;
                let interpretationIssues=[];
                if(invalid.diagnostic.reason==='terminal_transition')try {
                    plan=await persistCanvasPlanInterpretation(env,run,step);
                } catch(interpretationError) {
                    // Removing an inert final join is insufficient when the
                    // same saved plan has unsupported settings. Keep its raw
                    // evidence and use the existing separately budgeted repair.
                    if(interpretationError.code!=='canvas_agent_plan_interpretation_preflight_blocked')throw interpretationError;
                    interpretationIssues=interpretationError.issues||[];
                }
                if(!plan) {
                    const inventory=await canvasAgentCapabilities(env);
                    if(inventory.revision!==run.capability_revision)agentFail('canvas_agent_capabilities_changed');
                    const issues=[{code:'canvas_agent_plan_invalid',field:invalid.diagnostic.path,
                        message:`Application validation rejected ${invalid.diagnostic.reason}. Correct this constraint while retaining the confirmed brief and valid existing work.`},...interpretationIssues].slice(0,16);
                    const correction=await prepareCanvasAgentCorrection(env,run,view,inventory,step,invalid.plan,issues);
                    if(correction.queued)return {status:'repairing'};
                    if(correction.reason==='budget'){
                        const request=await requestCanvasAgentBudget(env,run,{requiredCredits:correction.credits,reasonKey:'plan_correction',
                            reasonCode:'canvas_agent_plan_correction',model:canvasAssistantModelId(run.model_id),action:'plan.repair'});
                        await appendCanvasAgentEvent(env,run,`budget:${request.id}`,'decision_summary',{code:'budget',phase:'budget',tool:'budget.request'});
                        return {status:'budget_required'};
                    }
                    throw Object.assign(new Error('canvas_agent_plan_correction_exhausted'),{code:'canvas_agent_plan_correction_exhausted',issues,
                        validationDiagnostic:invalid.diagnostic,outcome:'completed'});
                }
            }
            if(!plan){if(step.status==='completed')agentFail('canvas_agent_completed_plan_missing');return {status:'waiting_model'};}
            await persistCanvasAgentProposal(env,run,step,plan);
            const inventory=await canvasAgentCapabilities(env);
            if(inventory.revision!==run.capability_revision)agentFail('canvas_agent_capabilities_changed');
            const repairNodes=JSON.parse(step.input_json).repairNodes||null;
            const preflight=await preflightCanvasAgentGraph(env,run,view,inventory,plan,repairNodes);
            await markCanvasAgentProposal(env,step.id,preflight.ok?'proposed':'invalid',preflight);
            const exceeds=preflight.ok&&preflight.estimatedCredits>preflight.budget.remainingCredits;
            if(!preflight.ok||exceeds){
                const issues=!preflight.ok?preflight.issues:[{code:'canvas_agent_budget_exceeded',message:'Preserve the brief and existing work, but choose a cheaper feasible plan within the remaining project headroom. Optional visual evaluation may be omitted.'}];
                const correction=await prepareCanvasAgentCorrection(env,run,view,inventory,step,plan,issues);
                if(correction.queued)return {status:'repairing'};
                if(exceeds||correction.reason==='budget'){
                    const request=await requestCanvasAgentBudget(env,run,{requiredCredits:exceeds?preflight.estimatedCredits:correction.credits,
                        reasonKey:exceeds?'production_cost':'plan_correction',reasonCode:exceeds?'canvas_agent_budget_exceeded':'canvas_agent_plan_correction',
                        model:exceeds?preflight.costs?.nodes?.find(n=>n.credits>0)?.modelId||null:canvasAssistantModelId(run.model_id),action:exceeds?'media.generate':'plan.repair'});
                    await markCanvasAgentProposal(env,step.id,'budget_required',preflight);
                    await appendCanvasAgentEvent(env,run,`budget:${request.id}`,'decision_summary',{code:'budget',phase:'budget',tool:'budget.request'});
                    return {status:'budget_required'};
                }
                throw Object.assign(new Error('canvas_agent_plan_correction_exhausted'),{code:'canvas_agent_plan_correction_exhausted',issues});
            }
            await prepareCanvasAgentGraph(env,run,view,inventory,preflight.plan,repairNodes);
            await markCanvasAgentProposal(env,step.id,'applied',preflight);
            await appendCanvasAgentEvent(env,run,`applied:${step.id}`,'action',{code:'applied',phase:'generating',tool:'graph.apply'});
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
                const ready=pending.filter(s=>JSON.parse(s.input_json).dependencies.every(dep=>!steps.some(t=>t.node_id===dep.nodeId&&t.status!=='completed')));
                if(!ready.length)agentFail('canvas_agent_dependency_blocked');
                const images=ready.filter(s=>getCanvasModelForRole(JSON.parse(s.input_json).modelId,'member')?.capability==='image');
                const capacity=imageGenerationCapacity(env);
                // Admission creates ordinary durable jobs. It never waits for
                // provider completion or launches an in-memory Promise.all.
                // Dependencies remain serialized; the queue owns overlap and
                // the shared route gate atomically enforces actual capacity.
                const admitted=images.length?images.slice(0,Math.min(capacity.global,capacity.user,capacity.project)):ready.slice(0,1);
                for(const step of admitted) {
                    await generationStep(env,run,step,user,requireReadiness);
                    if(run.phase==='waiting_limit')break;
                }
            }
        } else if(run.status==='exporting')await exportStep(env,run,view);
    } catch(error){
        const diagnostic=error.readinessDiagnostic;
        const previous=JSON.parse(run.cause_json||'{}');
        const readiness=diagnostic?{...diagnostic,attempts:(previous.recovery==='readiness'&&Number.isSafeInteger(previous.readiness?.attempts)?previous.readiness.attempts:0)+1,
            firstFailureAt:previous.recovery==='readiness'?previous.readiness?.firstFailureAt||nowIso():nowIso(),lastFailureAt:nowIso()}:null;
        if(readiness?.retryable&&readiness.attempts<5){
            // Retry only the failed signed observation. No inference/usage
            // attempt has started on this boundary, and receipts keep their IDs.
            const next=new Date(Date.now()+Math.min(240,30*2**(readiness.attempts-1))*1000).toISOString();
            await agentTransition(env,run,{error_code:error.code,cause_json:JSON.stringify({code:error.code,step:run.phase,recovery:'readiness',readiness}),next_attempt_at:next});
            await appendCanvasAgentEvent(env,run,`readiness:${readiness.firstFailureAt}:${readiness.attempts}`,'error',{phase:run.phase,code:error.code,tool:'production.readiness',readiness});
            return {status:run.status};
        }
        const failure=run.purpose==='briefing'?await canvasDialogueFailure(env,run,error):await canvasProductionFailure(env,run,error);
        const {code,status}=failure;
        const cause={...failure.cause,...(Array.isArray(error.issues)?{issues:error.issues.slice(0,16)}:{}),
            ...(canvasAgentValidationDiagnostic(error.validationDiagnostic)?{diagnostic:canvasAgentValidationDiagnostic(error.validationDiagnostic),outcome:error.outcome==='completed'?'completed':null}:{}),
            ...(readiness?{readiness:{...readiness,exhausted:readiness.retryable&&readiness.attempts>=5}}:{})};
        const failed=await env.DB.prepare('UPDATE canvas_agent_runs SET status=?,error_code=?,cause_json=?,updated_at=? WHERE id=? AND lease_token=?')
            .bind(status,code,JSON.stringify(cause),nowIso(),id,run.lease_token).run();
        if(failed.meta?.changes===1)await appendCanvasAgentEvent(env,run,`error:${run.rounds}:${run.repair_attempts||0}:${code}`,'error',{phase:run.phase,code,tool:'production.reconcile',
            ...(cause.diagnostic?{diagnostic:cause.diagnostic,outcome:cause.outcome}:{}),
            ...(cause.execution?{execution:cause.execution,stepId:cause.stepId,operationId:cause.operationId,dispatchState:cause.dispatchState}:{})});
        if(failure&&run.purpose==='briefing'){
            logCanvasDialogueStage(cause.stage,{runId:id,operationId:cause.operationId,code,dispatchState:cause.dispatchState,receiptState:cause.receiptState});
            if(cause.dispatchState==='not_dispatched'){
                const {releaseCanvasAgentUndispatched}=await import('./canvas-agent-store.js');
                await releaseCanvasAgentUndispatched(env,id);
            }
        }
    } finally {
        const next=new Date(Math.max(Date.now()+10000,Date.parse(run.next_attempt_at)||0)).toISOString();
        await env.DB.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL,next_attempt_at=? WHERE id=? AND lease_token=?').bind(next,id,run.lease_token).run();
        run=await readAgentRun(env,id);
        if(ACTIVE_AGENT_STATES.includes(run.status))await wakeCanvasAgent(env,id,Math.min(43200,Math.max(10,Math.ceil((Date.parse(next)-Date.now())/1000))));
    }
    if(run.purpose==='briefing')await (await import('./canvas-agent-immediate.js')).recoverCanvasImmediateIntents(env,{projectId:run.project_id});
    return {status:run.status};
}
