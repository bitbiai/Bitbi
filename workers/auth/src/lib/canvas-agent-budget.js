import { nowIso,sha256Hex } from './tokens.js';
import { CANVAS_AGENT_LIMITS } from '../../../../js/shared/canvas-agent-contract.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
export async function readCanvasAgentBudget(env,run) {
    const costs=await env.DB.prepare(`SELECT COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(reserved),0) AS reserved,
        COALESCE(SUM(pending),0) AS pending,COALESCE(SUM(committed),0) AS committed,
        COALESCE(SUM(allocation_credits),0) AS allocated FROM canvas_project_costs WHERE project_id=?`).bind(run.project_id).first();
    const values=[run.budget_credits,...['charged','reserved','pending','committed','allocated'].map(k=>costs?.[k])];
    if(values.some(v=>!Number.isSafeInteger(v)||v<0))fail('canvas_agent_budget_state_invalid');
    return {capCredits:run.budget_credits,chargedCredits:costs.charged,reservedCredits:costs.reserved,
        pendingOutcomeCredits:costs.pending,committedCredits:costs.committed,allocatedCredits:costs.allocated,
        remainingCredits:Math.max(0,run.budget_credits-costs.committed),revision:run.budget_revision||0};
}
export function publicCanvasBudgetRequest(row) {
    if(!row)return null;
    const action=JSON.parse(row.action_json);
    return {id:row.id,revision:row.revision,projectRevision:row.project_revision,tariffRevision:row.tariff_revision,
        currentCapCredits:row.current_cap,additionalCredits:row.proposed_cap-row.current_cap,proposedCapCredits:row.proposed_cap,
        reason:action.reason,reasonCode:action.reasonCode,model:action.model,action:action.action,status:row.status};
}
export async function requestCanvasAgentBudget(env,run,{requiredCredits,reasonKey,reasonCode,model,action}) {
    const budget=await readCanvasAgentBudget(env,run),cap=budget.committedCredits+requiredCredits;
    if(!Number.isSafeInteger(requiredCredits)||requiredCredits<1||cap<=budget.capCredits||cap>CANVAS_AGENT_LIMITS.maxBudgetCredits)fail('canvas_agent_budget_exceeded');
    if(!/^[a-z0-9_:-]{1,100}$/.test(reasonKey)||!/^[a-z0-9_]{1,90}$/.test(reasonCode))fail('canvas_agent_budget_request_invalid');
    const prior=await env.DB.prepare('SELECT * FROM canvas_agent_budget_requests WHERE run_id=? AND reason_key=? ORDER BY created_at DESC LIMIT 1').bind(run.id,reasonKey).first();
    if(prior?.status==='declined')fail('canvas_agent_budget_declined');
    if(prior?.status==='pending')return prior;
    const id=(await sha256Hex(`canvas-budget:${run.id}:${run.budget_revision||0}:${reasonKey}:${cap}`)).slice(0,32),now=nowIso();
    await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
            WHERE r.id=? AND r.lease_token=? AND r.lease_until>? AND r.budget_credits=? AND r.budget_revision=?
            AND r.status IN ('planning','running') AND p.revision=r.expected_revision AND p.deleted_at IS NULL)
            THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.lease_token,now,run.budget_credits,run.budget_revision||0),
        env.DB.prepare(`INSERT INTO canvas_agent_budget_requests(id,run_id,reason_key,revision,project_revision,tariff_revision,current_cap,proposed_cap,action_json,resume_status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,run.id,reasonKey,run.budget_revision||0,run.expected_revision,run.tariff_revision,run.budget_credits,cap,
            JSON.stringify({reasonCode,model,action}),run.status,now),
        env.DB.prepare(`UPDATE canvas_agent_runs SET status='paused',phase='budget',error_code='canvas_agent_budget_consent_required',
            cause_json=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
            .bind(JSON.stringify({code:reasonCode,step:action,recovery:'decision',model}),now,run.id,run.lease_token),
    ]);
    return env.DB.prepare('SELECT * FROM canvas_agent_budget_requests WHERE id=?').bind(id).first();
}
