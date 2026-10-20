import { budgetCanvasAgentPlan } from './canvas-agent-planning.js';
import { plannerProject } from '../routes/canvas-agent.js';
import { canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { nowIso,sha256Hex } from './tokens.js';
import { canvasAgentEventStatement } from './canvas-agent-progress.js';
import { canvasAgentParameterCorrectionFeedback } from './canvas-agent-plan-feedback.js';

export async function assertCanvasAgentPlanningAllowed(env,run,issues=[],permission={}) {
    // Reviewing an already accepted answer authorizes its settlement and the
    // original film, not another paid planning/correction request. Keep this
    // fence on the run after recovery so preflight or visual review cannot
    // silently spend on a replacement answer.
    const review=await env.DB.prepare('SELECT operation_id FROM canvas_agent_settlement_reviews WHERE run_id=? AND allow_new_reasoning=0 LIMIT 1').bind(run.id).first();
    const interpretation=await env.DB.prepare("SELECT interpretation_json FROM canvas_agent_proposals WHERE run_id=? AND json_extract(interpretation_json,'$.allowNewReasoning')=0 LIMIT 1").bind(run.id).first();
    if(!review&&interpretation&&await (await import('./canvas-agent-plan-correction-review.js')).allowsReviewedCanvasCorrection(env,run,JSON.parse(interpretation.interpretation_json),permission))return;
    if(review||interpretation)throw Object.assign(new Error('canvas_agent_recovered_plan_requires_review'),{code:'canvas_agent_recovered_plan_requires_review',status:409,issues:issues.slice(0,16)});
}

export async function quoteCanvasAgentCorrection(env,run,view,inventory,plan,issues) {
    const modelId=canvasAssistantModelId(run.model_id);
    const attempt=(run.repair_attempts||0)+1;
    const id=(await sha256Hex(`canvas-agent-preflight-repair:${run.id}:${attempt}`)).slice(0,32);
    const feedback=issues.slice(0,16).map(issue=>({code:issue.code,
        ...(issue.nodeKey?{nodeKey:issue.nodeKey}:{}),...(issue.modelId?{modelId:issue.modelId}:{}),
        ...(issue.field?{field:issue.field}:{}),...(issue.message?{message:String(issue.message).slice(0,800)}:{}),
        ...(Array.isArray(issue.allowed)?{allowed:issue.allowed.filter(v=>typeof v==='string').slice(0,16)}:{}),
        ...(canvasAgentParameterCorrectionFeedback(issue)||{})}));
    const payload={version:1,model:modelId,requestId:id,brief:JSON.parse(run.input_json).brief,
        durationMode:'creative',targetDurationSeconds:run.target_seconds,toleranceSeconds:run.tolerance_seconds,
        capabilityRevision:inventory.revision,capabilities:inventory,projectRevision:view.project.revision,currentProject:plannerProject(view),
        repair:{attempt,issues:feedback,previousPlan:plan},
        privacyUser:`cau_${await sha256Hex(`canvas-agent-user:${run.user_id}`)}`,promptCacheKey:`cap_${await sha256Hex(`canvas-agent-project:${run.user_id}:${run.project_id}`)}`};
    const quote=await budgetCanvasAgentPlan(env,run,payload);
    return {quote,feedback,id,attempt,modelId};
}
export async function prepareCanvasAgentCorrection(env,run,view,inventory,step,plan,issues) {
    const expectedId=(await sha256Hex(`canvas-agent-preflight-repair:${run.id}:${(run.repair_attempts||0)+1}`)).slice(0,32);
    await assertCanvasAgentPlanningAllowed(env,run,issues,{stepId:expectedId,allocation:true});
    if((run.repair_attempts||0)>=2)return {queued:false,reason:'attempt_limit'};
    const {quote,feedback,id,attempt,modelId}=await quoteCanvasAgentCorrection(env,run,view,inventory,plan,issues);
    await assertCanvasAgentPlanningAllowed(env,run,issues,{stepId:id,allocation:true,quote});
    if(quote.credits>quote.budget.remainingCredits)return {queued:false,reason:'budget',credits:quote.credits};
    const now=nowIso(),source=JSON.parse(step.input_json),input=JSON.stringify({modelId,payload:quote.payload,
        ...(source.repairNodes?{repairNodes:source.repairNodes}:{})});
    try {await env.DB.batch([
        env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=r.project_id
            WHERE r.id=? AND r.lease_token=? AND r.status='planning' AND r.repair_attempts=? AND r.lease_until>?
            AND r.expires_at>? AND p.revision=r.expected_revision AND p.deleted_at IS NULL)
            THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.lease_token,attempt-1,now,now),
        env.DB.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_proposals v WHERE v.run_id=?
          AND json_extract(v.interpretation_json,'$.authority.strategy')='bounded-correction' AND NOT EXISTS(
            SELECT 1 FROM canvas_agent_conversations c WHERE c.project_id=? AND c.state='active'
            AND c.brief_revision=json_extract(v.interpretation_json,'$.authority.effectiveBriefRevision')))
          THEN 1 ELSE json_extract('[]','$[') END`).bind(run.id,run.project_id),
        env.DB.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
            VALUES(?,?,?,'plan',?,?,?,?)`).bind(id,run.id,`preflight_repair_${attempt}`,input,quote.credits,now,now),
        env.DB.prepare("UPDATE canvas_agent_runs SET repair_attempts=repair_attempts+1,phase='repairing',error_code=NULL,cause_json=?,updated_at=? WHERE id=? AND lease_token=?")
            .bind(JSON.stringify({code:'canvas_agent_plan_correction',step:step.id,recovery:'automatic',issues:feedback}),now,run.id,run.lease_token),
        env.DB.prepare("UPDATE canvas_agent_proposals SET status='repairing',validation_json=?,updated_at=? WHERE step_id=?")
            .bind(JSON.stringify({issues:feedback,repairs:[],costs:null}),now,step.id),
        canvasAgentEventStatement(env,run,`repair:${id}`,'decision_summary',{code:'repairing',phase:'repairing',model:modelId,tool:'plan.repair',attempt}),
    ]);}catch(error){
        // A lost acknowledgement after the atomic allocation is observation,
        // not permission to allocate attempt 2 or strand the accepted step.
        const accepted=await env.DB.prepare(`SELECT s.id FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
          WHERE s.id=? AND s.run_id=? AND s.status='ready' AND s.input_json=? AND s.allocation_credits=?
          AND r.status='planning' AND r.phase='repairing' AND r.repair_attempts=? AND r.lease_token=?
          AND EXISTS(SELECT 1 FROM canvas_agent_events e WHERE e.run_id=r.id AND e.event_key=?)`)
          .bind(id,run.id,input,quote.credits,attempt,run.lease_token,`repair:${id}`).first();
        if(!accepted)throw error;
    }
    return {queued:true,credits:quote.credits};
}
