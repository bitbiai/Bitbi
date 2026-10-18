import { logDiagnostic } from '../../../../js/shared/worker-observability.mjs';

const safeCode = value => typeof value === 'string' && /^[a-z0-9_]{1,90}$/.test(value) ? value : null;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value) ? value : null;
const stages=new Set(['queued','consumer_received','preparing','prepared','preparation_failed','dispatching','dispatch_unknown','provider_pending','rejected','response_invalid','receipt_pending','completed','cancelled','callback_observed']);
export function logCanvasDialogueStage(stage, data = {}) {
    // Never spread errors, requests, provider bodies or callback URLs into logs.
    logDiagnostic({service:'bitbi-auth',component:'canvas-agent-dialogue',event:'canvas_dialogue_stage',
        level:data.code?'warn':'info',correlationId:safeId(data.runId),stage:stages.has(stage)?stage:'unknown_stage',
        operation_id:safeId(data.operationId),step_id:safeId(data.stepId),turn_id:safeId(data.turnId),
        code:safeCode(data.code),http_status:Number.isInteger(data.httpStatus)?data.httpStatus:null,
        duration_ms:Number.isFinite(data.durationMs)?Math.max(0,data.durationMs):null,
        dispatch_state:safeCode(data.dispatchState),receipt_state:safeCode(data.receiptState)});
}
const evidenceSql=`SELECT r.id AS run_id,r.status AS run_status,r.error_code AS run_error,r.expires_at,
    r.created_at AS queued_at,r.updated_at AS run_updated_at,
    json_extract(r.cause_json,'$.storageAttempts') AS storage_attempts,
    t.id AS turn_id,t.state AS turn_state,s.id AS step_id,s.status AS step_status,s.receipt_json IS NOT NULL AS step_receipt,
    COALESCE(json_extract(o.receipt_json,'$.ok'),json_extract(s.receipt_json,'$.ok')) AS receipt_ok,
    COALESCE(json_extract(o.receipt_json,'$.outcome'),json_extract(s.receipt_json,'$.outcome')) AS receipt_outcome,
    a.provider_outcome,a.billing_status,a.reservation_released_at,
    o.id AS operation_id,o.state AS operation_state,o.error_code AS operation_error,
    o.response_json IS NOT NULL AS response_stored,o.reconcile_attempts,
    o.dispatched_at,o.response_at,o.completed_at AS receipt_at,t.updated_at AS turn_updated_at
    FROM canvas_agent_runs r LEFT JOIN canvas_agent_turns t ON t.run_id=r.id
    LEFT JOIN canvas_agent_steps s ON s.run_id=r.id AND s.step_key='dialogue'
    LEFT JOIN canvas_agent_model_operations o ON o.step_id=s.id
    LEFT JOIN member_ai_usage_attempts_v2 a ON a.id=COALESCE(s.usage_attempt_id,o.usage_attempt_id,
        (SELECT held.id FROM member_ai_usage_attempts_v2 held WHERE json_extract(held.metadata_json,'$.canvas_agent.step_id')=s.id LIMIT 1))`;
export const readCanvasDialogueEvidence=(env,runId)=>env.DB.prepare(evidenceSql+' WHERE r.id=? AND r.purpose=\'briefing\'').bind(runId).first();
export async function canvasDialogueProjectEvidence(env,projectId) {
    return (await env.DB.prepare(evidenceSql+` WHERE r.project_id=? AND r.purpose='briefing'
        AND (t.state!='deleted' OR o.state IN ('dispatching','pending','unknown','received')
          OR a.billing_status='reserved' AND a.reservation_released_at IS NULL)
        ORDER BY r.rowid`).bind(projectId).all()).results;
}
export function canvasDialogueDelivery(row) {
    if(!row)return {stage:'completed',blocking:false,diagnosticReference:null,canObserve:false,source:'system',code:null};
    const settled=row.billing_status==='finalized'||Boolean(row.reservation_released_at);
    const stopped=['cancelled','taken_over'].includes(row.run_status)||['cancelled','deleted'].includes(row.turn_state);
    let stage,blocking=false;
    if(row.turn_state==='completed')stage='completed';
    else if(row.operation_state==='rejected'&&settled)stage='rejected';
    else if(row.receipt_ok===0){stage='response_invalid';blocking=!settled;}
    else if(row.response_stored||row.receipt_outcome==='completed'){
        stage=stopped&&settled?'cancelled':'receipt_pending';blocking=stage!=='cancelled';
    } else if(row.operation_state==='unknown'||['dispatched','unknown','succeeded'].includes(row.provider_outcome)&&!['dispatching','pending'].includes(row.operation_state)){
        stage='dispatch_unknown';blocking=true;
    } else if(['dispatching','pending'].includes(row.operation_state)){
        stage='provider_pending';blocking=true;
    } else if(row.operation_state==='rejected'){
        stage='receipt_pending';blocking=true;
    } else if(stopped)stage='cancelled';
    else if(['queued','planning','running'].includes(row.run_status)){
        stage=row.run_status==='queued'?'queued':'preparing';blocking=true;
    } else stage='preparation_failed';
    const exhausted=row.reconcile_attempts>=5||row.storage_attempts>=3;
    // Watching an accepted turn is not authority to retry work. In particular,
    // queued work has no provider operation yet and still needs automatic reads.
    // Exhausted reconciliation remains actionable; a later external receipt may
    // still resolve it without another inference or another normalization retry.
    return {stage,blocking,diagnosticReference:row.run_id,canObserve:blocking,
        canReconcile:!exhausted&&Boolean(row.operation_id||row.step_receipt),
        acceptedAt:row.queued_at||null,updatedAt:row.turn_updated_at||row.run_updated_at||null,
        timings:{queuedAt:row.queued_at||null,dispatchedAt:row.dispatched_at||null,
            responseAt:row.response_at||null,receiptAt:row.receipt_at||null,deliveredAt:stage==='completed'?row.turn_updated_at:null},
        recovery:exhausted||stage==='dispatch_unknown'||stage==='response_invalid'&&blocking?'operator':stage==='receipt_pending'?'observe':stage==='preparation_failed'?'correct_request':null,
        source:stage==='completed'?'provider':'system',code:stage==='completed'?null:safeCode(row.operation_error)||safeCode(row.run_error)};
}
export async function canvasDialogueFailure(env,run,error) {
    const row=await readCanvasDialogueEvidence(env,run.id);
    // A caught exception alone says nothing about paid dispatch. Durable intent,
    // usage evidence and stored terminal receipts determine the failure boundary.
    const evidence=canvasDialogueDelivery({...row,run_status:'blocked'});
    const stage=evidence.stage;
    const code=safeCode(error?.code)|| (stage==='preparation_failed'?'canvas_agent_prepare_failed':'canvas_agent_receipt_storage_failed');
    return {status:evidence.blocking?'review_required':'blocked',code,cause:{code,stage,step:'briefing',
        recovery:stage==='receipt_pending'?'observe':stage==='dispatch_unknown'?'operator':stage==='preparation_failed'?'correct_request':'manual',
        diagnosticReference:run.id,operationId:row?.operation_id||null,
        dispatchState:row?.provider_outcome||'not_dispatched',receiptState:row?.operation_state||'none'}};
}
