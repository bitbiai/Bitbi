// Reconcile a late, settled H3 result. This service has no provider transport,
// credit writer or authority-renewal operation. The original job remains intact.
import { nowIso,sha256Hex } from './tokens.js';
import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { parseH3Task } from '../../../../js/shared/minimax-h3.mjs';
import { canvasAgentAvailability } from './canvas-agent-capabilities.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';
import { assertCanvasPlanReviewCurrent } from './canvas-agent-plan-correction-review.js';
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const errorCode='canvas_agent_provider_review_required';
const readinessError='canvas_agent_provider_unavailable';
const recoverableState=run=>run.status==='review_required'&&run.error_code===errorCode
    ||run.status==='blocked'&&run.error_code===readinessError;
const recoverKey=digest=>`media-recovery:${digest}`;

async function evidence(env,{runId,userId,projectId}) {
    const run=await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=? AND purpose='production'").bind(runId,userId,projectId).first();
    if(!run)fail('canvas_agent_media_recovery_not_found');
    const context=await env.DB.prepare(`SELECT p.revision,p.deleted_at,u.status,c.brief_revision
      FROM canvas_projects p JOIN users u ON u.id=p.user_id LEFT JOIN canvas_agent_conversations c ON c.project_id=p.id
      WHERE p.id=? AND p.user_id=?`).bind(projectId,userId).first();
    if(!context||context.deleted_at||context.status!=='active')fail('canvas_agent_authority_revoked');
    if(!recoverableState(run)||run.phase!=='generating')fail('canvas_agent_media_recovery_state_changed');
    if(run.expires_at<=nowIso())fail('canvas_agent_authorization_expired');
    const reviewed=await assertCanvasPlanReviewCurrent(env,run),effectiveBriefRevision=reviewed?.effectiveBriefRevision??run.brief_revision;
    if(context.revision!==run.expected_revision||effectiveBriefRevision!==null&&context.brief_revision!==effectiveBriefRevision)fail('canvas_agent_project_changed');
    if(run.lease_until&&run.lease_until>nowIso())fail('canvas_agent_claim_lost');
    const stopped=await env.DB.prepare("SELECT 1 FROM canvas_agent_controls WHERE run_id=? AND action IN ('pause','cancel','takeover') AND created_at>=? LIMIT 1").bind(runId,run.updated_at).first();
    if(stopped)fail('canvas_agent_authority_revoked');
    const steps=(await env.DB.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='node' AND status='accepted'").bind(runId).all()).results;
    // H3 runs one dependent video at a time. A sibling with unresolved acceptance
    // is never made safe merely because some other result arrived.
    if(steps.length!==1)fail('canvas_agent_media_recovery_pending');
    const step=steps[0];
    const row=await env.DB.prepare(`SELECT cr.id AS canvas_run_id,cr.model_id,cr.node_revision,cr.asset_id,cr.output_json,cr.usage_attempt_id,
      j.id AS job_id,j.user_id,j.status AS job_status,j.provider_receipts_json,j.result_r2_key,j.asset_id AS job_asset,j.usage_attempt_id AS job_usage,
      a.billing_status,a.provider_outcome,a.credit_cost,a.metadata_json,a.idempotency_key,
      n.creative_revision,n.asset_id AS node_asset,n.deleted_at AS node_deleted,
      t.r2_key,t.mime_type,t.size_bytes,t.metadata_json AS asset_metadata,
      (SELECT SUM(-l.amount) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0) AS charged
      FROM canvas_runs cr JOIN member_generation_jobs j ON j.canvas_run_id=cr.id AND j.user_id=cr.user_id
      JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id AND a.user_id=j.user_id
      JOIN canvas_nodes n ON n.id=cr.node_id AND n.user_id=cr.user_id AND n.project_id=cr.project_id
      JOIN ai_text_assets t ON t.id=cr.asset_id AND t.user_id=cr.user_id
      WHERE cr.idempotency_key=? AND cr.project_id=? AND cr.user_id=? AND cr.node_id=? AND cr.deleted_at IS NULL AND cr.status='completed'`)
      .bind(`canvas-agent-${step.id}`,projectId,userId,step.node_id).first();
    if(!row||row.model_id!=='minimax/h3'||!['succeeded','preview_pending'].includes(row.job_status)
      ||row.asset_id!==row.job_asset||row.node_asset!==row.asset_id||row.node_deleted||row.node_revision!==row.creative_revision
      ||row.usage_attempt_id!==row.job_usage||step.usage_attempt_id&&step.usage_attempt_id!==row.job_usage
      ||row.billing_status!=='finalized'||row.provider_outcome!=='succeeded'||row.charged!==row.credit_cost
      ||!Number.isSafeInteger(row.charged)||row.charged<1||row.charged>step.allocation_credits
      ||row.mime_type!=='video/mp4'||!row.r2_key||row.size_bytes<1
      ||row.result_r2_key!==`users/${userId}/generation-jobs/${row.job_id}/result.json`)fail('canvas_agent_media_recovery_evidence_invalid');
    const receipts=JSON.parse(row.provider_receipts_json),task=receipts['h3-task']?.task;
    if(!receipts['ai-0']?.fingerprint||receipts['ai-0'].rejection||!task)fail('canvas_agent_media_recovery_evidence_invalid');
    const parsed=parseH3Task({task});
    if(parsed.pending||parsed.failed||parsed.outputSeconds<=0)fail('canvas_agent_media_recovery_evidence_invalid');
    const budget=await readCanvasAgentBudget(env,run),cost=await env.DB.prepare('SELECT charged FROM canvas_agent_step_costs WHERE step_id=?').bind(step.id).first();
    const correctedCharged=budget.chargedCredits+row.charged-(cost?.charged||0);
    const remaining=(await env.DB.prepare("SELECT COALESCE(SUM(allocation_credits),0) AS credits FROM canvas_agent_steps WHERE run_id=? AND status='ready'").bind(runId).first()).credits;
    if(correctedCharged+remaining>run.budget_credits)fail('canvas_agent_budget_exceeded');
    const receiptDigest=await sha256Hex(row.provider_receipts_json);
    // Keep existing v1 authorizations byte-for-byte valid. A historical generic
    // readiness block is a distinct reviewed state, never proof of an outage.
    const proof={version:run.status==='blocked'?2:1,...(run.status==='blocked'?{priorStatus:run.status}:{}),runId,userId,projectId,stepId:step.id,canvasRunId:row.canvas_run_id,jobId:row.job_id,assetId:row.asset_id,
      usageAttemptId:row.job_usage,receiptDigest,projectRevision:run.expected_revision,briefRevision:run.brief_revision,
      capCredits:run.budget_credits,budgetRevision:run.budget_revision,planningModel:run.model_id||'xai/grok-4.7',
      actualCredits:row.charged,correctedProjectCharged:correctedCharged,remainingAllocation:remaining,
      outputSeconds:parsed.outputSeconds,resolution:parsed.resolution,priorError:run.error_code,priorUpdatedAt:run.updated_at,
      expiresAt:run.expires_at};
    return {run,step,row,proof,effectiveBriefRevision,digest:await sha256Hex(stablePricingJson(proof))};
}
export async function previewCanvasMediaRecovery(env,input) {
    const {proof,digest}=await evidence(env,input);return {...proof,recoveryDigest:digest};
}
export async function authorizeCanvasMediaRecovery(env,input) {
    const prior=await env.DB.prepare("SELECT 1 FROM canvas_agent_controls c JOIN canvas_agent_runs r ON r.id=c.run_id WHERE c.run_id=? AND c.request_key=? AND c.action='recover_media' AND r.user_id=? AND r.project_id=?").bind(input.runId,recoverKey(input.recoveryDigest),input.userId,input.projectId).first();
    if(prior)return {authorized:true,idempotentReplay:true};
    const {run,proof,digest}=await evidence(env,input);
    if(input.recoveryDigest!==digest||input.projectCapCredits!==proof.capCredits
      ||!/^[A-Za-z0-9_.:@/-]{1,100}$/.test(input.actor||'')||!/^[A-Za-z0-9_.:/-]{1,160}$/.test(input.authorizationRef||''))fail('canvas_agent_media_recovery_scope_changed');
    const now=nowIso();
    await env.DB.batch([
      env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
        WHERE r.id=? AND r.user_id=? AND r.status=? AND r.error_code=? AND r.updated_at=?
        AND p.revision=r.expected_revision AND p.deleted_at IS NULL AND r.expires_at>?) THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.user_id,run.status,run.error_code,run.updated_at,now),
      env.DB.prepare("INSERT INTO canvas_agent_controls(run_id,request_key,action,created_at) VALUES(?,?,'recover_media',?)").bind(run.id,recoverKey(digest),now),
      env.DB.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,'decision_summary',?,?)")
        .bind(run.id,recoverKey(digest),JSON.stringify({code:'media_recovery_authorized',recoveryDigest:digest,actor:input.actor,authorizationRef:input.authorizationRef,...proof}),now),
    ]);
    return {authorized:true,recoveryDigest:digest};
}
export async function recoverCanvasAgentMedia(env,scope=null) {
    const rows=(await env.DB.prepare(`SELECT id,user_id,project_id FROM canvas_agent_runs r WHERE purpose='production'
      AND ((status='review_required' AND error_code=?) OR (status='blocked' AND error_code=?))
      AND expires_at>? AND (? IS NULL OR id=?) AND
      ((status='review_required' AND json_extract(cause_json,'$.recovery')='receipt')
        OR EXISTS(SELECT 1 FROM canvas_agent_controls c WHERE c.run_id=r.id AND c.action='recover_media'))
      ORDER BY updated_at LIMIT 10`).bind(errorCode,readinessError,nowIso(),scope?.runId??null,scope?.runId??null).all()).results;
    const results=[];
    for(const identity of rows){
      try{
        const data=await evidence(env,{runId:identity.id,userId:identity.user_id,projectId:identity.project_id}),{run,step,row,proof,digest,effectiveBriefRevision}=data;
        if((run.status!=='review_required'||JSON.parse(run.cause_json||'{}').recovery!=='receipt')
          &&!await env.DB.prepare("SELECT 1 FROM canvas_agent_controls WHERE run_id=? AND request_key=? AND action='recover_media'").bind(run.id,recoverKey(digest)).first())continue;
        const available=await canvasAgentAvailability(env,{modelId:run.model_id});if(!available.available)fail(available.code);
        const [stored,original]=await Promise.all([env.USER_IMAGES.get(row.result_r2_key),env.USER_IMAGES.head(row.r2_key)]);
        if(!stored||!original||original.size!==row.size_bytes)fail('canvas_agent_media_recovery_storage_missing');
        const result=await new Response(stored.body).json();
        if(result.ok!==true||result.data?.asset?.id!==row.asset_id)fail('canvas_agent_media_recovery_evidence_invalid');
        const now=nowIso(),key=`media-recovered:${step.id}:${proof.receiptDigest}`;
        await env.DB.batch([
          env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id
            LEFT JOIN canvas_agent_conversations c ON c.project_id=p.id JOIN canvas_agent_steps s ON s.run_id=r.id
            JOIN member_generation_jobs j ON j.id=? JOIN canvas_nodes n ON n.id=s.node_id
            WHERE r.id=? AND r.user_id=? AND r.status=? AND r.error_code=? AND r.updated_at=? AND r.budget_credits=?
            AND r.expires_at>? AND (r.lease_until IS NULL OR r.lease_until<=?) AND p.revision=r.expected_revision AND p.deleted_at IS NULL
            AND u.status='active' AND (r.brief_revision IS NULL OR c.brief_revision=?)
            AND s.id=? AND s.status='accepted' AND j.provider_receipts_json=? AND j.status IN ('succeeded','preview_pending')
            AND j.result_r2_key=? AND n.deleted_at IS NULL AND n.creative_revision=? AND n.asset_id=?) THEN 1 ELSE json_extract('[]','$[') END`)
            .bind(row.job_id,run.id,run.user_id,run.status,run.error_code,run.updated_at,run.budget_credits,now,now,effectiveBriefRevision,step.id,row.provider_receipts_json,row.result_r2_key,row.node_revision,row.asset_id),
          env.DB.prepare("UPDATE canvas_agent_steps SET status='completed',usage_attempt_id=?,receipt_json=?,updated_at=? WHERE id=?")
            .bind(row.job_usage,JSON.stringify({canvasRunId:row.canvas_run_id,assetId:row.asset_id}),now,step.id),
          env.DB.prepare("UPDATE canvas_agent_runs SET status='running',phase='generating',error_code=NULL,cause_json=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?")
            .bind(JSON.stringify({code:'canvas_agent_media_recovered',recovery:'automatic',receiptDigest:proof.receiptDigest}),now,now,run.id),
          env.DB.prepare(`SELECT CASE WHEN (SELECT budget_credits FROM canvas_agent_runs WHERE id=?)>=
            COALESCE((SELECT SUM(committed) FROM canvas_agent_step_costs WHERE project_id=?),0) THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.project_id),
          env.DB.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,'media',?,?)")
            .bind(run.id,key,JSON.stringify({code:'media_ready',phase:'generating',nodeId:step.node_id,recoveryDigest:digest,receiptDigest:proof.receiptDigest,priorError:run.error_code,assetId:row.asset_id,jobId:row.job_id,usageAttemptId:row.job_usage}),now),
        ]);
        results.push({runId:run.id,recovered:true,assetId:row.asset_id});
      }catch(error){results.push({runId:identity.id,recovered:false,code:error.code||'canvas_agent_media_recovery_pending'});}
    }
    return results;
}
