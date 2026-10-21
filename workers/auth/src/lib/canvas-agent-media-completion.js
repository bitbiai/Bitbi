// Complete an existing durable media operation, never submit a replacement.
// Provider success, billing, private bytes and current node attachment are
// independent proofs. A Canvas status or an asset ID alone is insufficient.
import { nowIso,sha256Hex } from './tokens.js';
import { saveCanvasMedia } from './canvas-media-storage.js';
import { appendCanvasAgentEvent } from './canvas-agent-progress.js';
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};

export async function canvasStoredMediaProof(env,run,step,{storage=true}={}) {
  const row=await env.DB.prepare(`SELECT c.*,j.id AS job_id,j.media_type,j.status AS job_status,j.asset_id AS job_asset,
    j.usage_attempt_id AS job_usage,j.provider_receipts_json,j.result_r2_key,
    a.billing_status,a.provider_outcome,a.credit_cost,a.metadata_json,a.dispatch_token,
    n.asset_id AS node_asset,n.creative_revision,n.deleted_at AS node_deleted,
    m.state AS retention_state,m.asset_id AS retained_asset,
    COALESCE(i.r2_key,t.r2_key) AS r2_key,COALESCE(i.size_bytes,t.size_bytes) AS size_bytes,
    t.mime_type,
    (SELECT COALESCE(SUM(-l.amount),0) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0) AS charged
    ,(SELECT COUNT(*) FROM member_credit_ledger l WHERE l.user_id=a.user_id AND l.idempotency_key=a.idempotency_key AND l.amount<0 AND l.ai_dispatch_token=a.dispatch_token) AS matched_debits
    FROM canvas_runs c JOIN member_generation_jobs j ON j.canvas_run_id=c.id AND j.user_id=c.user_id
    JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id AND a.user_id=j.user_id
    JOIN canvas_nodes n ON n.id=c.node_id AND n.user_id=c.user_id AND n.project_id=c.project_id
    JOIN canvas_media_outputs m ON m.run_id=c.id AND m.user_id=c.user_id AND m.project_id=c.project_id AND m.role='original'
    LEFT JOIN ai_images i ON i.id=c.asset_id AND i.user_id=c.user_id AND j.media_type='image'
    LEFT JOIN ai_text_assets t ON t.id=c.asset_id AND t.user_id=c.user_id AND j.media_type IN ('video','music')
    WHERE c.user_id=? AND c.project_id=? AND c.node_id=? AND c.idempotency_key=? AND c.deleted_at IS NULL`)
    .bind(run.user_id,run.project_id,step.node_id,`canvas-agent-${step.id}`).first();
  const metadata=parse(row?.metadata_json),receipt=parse(step.receipt_json),receipts=parse(row?.provider_receipts_json);
  const receiptName=receipts?.['ai-0']?'ai-0':'service-0',primary=receipts?.[receiptName];
  if(!row||row.status!=='completed'||!['succeeded','preview_pending'].includes(row.job_status)
    ||!row.asset_id||row.asset_id!==row.job_asset||row.asset_id!==row.retained_asset||row.asset_id!==row.node_asset
    ||row.node_deleted||row.node_revision!==row.creative_revision||row.job_usage!==row.usage_attempt_id
    ||step.usage_attempt_id&&step.usage_attempt_id!==row.job_usage||receipt?.canvasRunId&&receipt.canvasRunId!==row.id
    ||row.billing_status!=='finalized'||row.provider_outcome!=='succeeded'
    ||metadata?.canvas_agent?.run_id!==run.id||metadata?.canvas_agent?.step_id!==step.id
    ||!Number.isSafeInteger(row.charged)||row.charged<1||row.charged>step.allocation_credits||row.charged>row.credit_cost||row.matched_debits!==1
    ||!['canvas','saved'].includes(row.retention_state)||!row.r2_key||row.size_bytes<1
    ||row.result_r2_key!==`users/${run.user_id}/generation-jobs/${row.job_id}/result.json`
    ||primary?.key!==`users/${run.user_id}/generation-jobs/${row?.job_id}/provider-${receiptName}.json`
    ||!/^[a-f0-9]{64}$/.test(primary?.fingerprint||'')||primary?.rejection)
      fail('canvas_agent_media_recovery_evidence_invalid');
  const unready=await env.DB.prepare('SELECT 1 FROM member_generation_unready_assets WHERE id=?').bind(row.asset_id).first();
  if(unready)fail('canvas_agent_media_recovery_pending');
  if(storage){
    const [result,original]=await Promise.all([env.USER_IMAGES.get(row.result_r2_key),env.USER_IMAGES.head(row.r2_key)]);
    if(!result||!original||original.size!==row.size_bytes)fail('canvas_agent_media_recovery_storage_missing');
    const payload=await new Response(result.body).json();
    if(payload?.ok!==true||payload.data?.asset?.id!==row.asset_id)fail('canvas_agent_media_recovery_evidence_invalid');
  }
  return {...row,receiptDigest:await sha256Hex(row.provider_receipts_json)};
}

export async function completeCanvasAgentMedia(env,run,step) {
  const proof=await canvasStoredMediaProof(env,run,step);
  await saveCanvasMedia(env,run.user_id,run.project_id,proof.id);
  const now=nowIso();
  await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
      JOIN canvas_agent_steps s ON s.run_id=r.id JOIN canvas_runs c ON c.id=?
      JOIN member_generation_jobs j ON j.id=? JOIN canvas_nodes n ON n.id=s.node_id
      WHERE r.id=? AND r.user_id=? AND r.status='running' AND r.lease_token=? AND r.lease_until>?
      AND p.deleted_at IS NULL AND p.revision=r.expected_revision AND s.id=? AND s.status IN ('ready','accepted','completed')
      AND c.status='completed' AND c.asset_id=? AND c.usage_attempt_id=? AND c.deleted_at IS NULL
      AND j.status IN ('succeeded','preview_pending') AND j.provider_receipts_json=? AND j.asset_id=c.asset_id
      AND n.deleted_at IS NULL AND n.creative_revision=c.node_revision AND n.asset_id=c.asset_id)
      THEN 1 ELSE json_extract('[]','$[') END`)
      .bind(proof.id,proof.job_id,run.id,run.user_id,run.lease_token,now,step.id,proof.asset_id,proof.job_usage,proof.provider_receipts_json),
    env.DB.prepare("UPDATE canvas_agent_steps SET status='completed',receipt_json=?,usage_attempt_id=?,updated_at=? WHERE id=? AND status IN ('ready','accepted')")
      .bind(JSON.stringify({canvasRunId:proof.id,assetId:proof.asset_id}),proof.job_usage,now,step.id),
  ]);
  await appendCanvasAgentEvent(env,run,`media:${step.id}`,'media',{code:'media_ready',phase:'generating',nodeId:step.node_id,
    stepId:step.id,canvasRunId:proof.id,assetId:proof.asset_id,receiptDigest:proof.receiptDigest,tool:'asset.save'});
  return proof;
}
