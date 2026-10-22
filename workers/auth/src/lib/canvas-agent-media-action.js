import { canvasMediaPolicyContext } from './canvas-agent-media-policy.js';
import { canvasMediaPolicyAllows } from '../../../../js/shared/canvas-agent-media-policy.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';

// Informational dialogue cannot mint this authority. Only the persisted,
// explicitly confirmed regenerate action wraps its ordinary generation caller.
const actions = new WeakMap();
const media = modelId => ['image', 'video', 'music'].includes(getCanvasModelForRole(modelId, 'member')?.capability);
const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };
export function canvasMediaActionAuthority(env) {
  for (let scope = env; scope; scope = Object.getPrototypeOf(scope)) if (actions.has(scope)) return actions.get(scope);
  return null;
}
export function canvasMediaActionEnvironment(env, row, prepared) {
  if (!media(prepared.modelId)) return env;
  const scope = Object.create(env);
  actions.set(scope, Object.freeze({ id: row.id, projectId: row.project_id, userId: row.user_id,
    modelId: prepared.modelId, credits: prepared.credits, policyRevision: prepared.mediaPolicyRevision,
    projectCapRunId: prepared.projectCapRunId }));
  return scope;
}
export async function quoteCanvasMediaAction(env, userId, projectId, modelId, credits) {
  if (!media(modelId)) return {};
  const policy = await canvasMediaPolicyContext(env, projectId, userId);
  if (!canvasMediaPolicyAllows(policy, modelId)) fail('canvas_agent_media_model_not_allowed');
  const cap = policy.models.find(item => item.modelId === modelId)?.creditLimit ?? null;
  const used = policy.usage.find(item => item.modelId === modelId)?.committedCredits || 0;
  if (cap !== null && used + credits > cap) fail('canvas_agent_media_limit_exceeded');
  const run = await env.DB.prepare(`SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production'
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(projectId, userId).first();
  if (!run) fail('canvas_agent_project_budget_required');
  const budget = await readCanvasAgentBudget(env, run);
  if (budget.remainingCredits < credits) fail('canvas_agent_budget_exceeded');
  return { mediaPolicyRevision: policy.revision, projectCapRunId: run.id };
}
export async function canvasMediaActionUsageMetadata(env, request, { userId, modelId, credits }) {
  const authority = canvasMediaActionAuthority(env);
  if (!authority) return {};
  if (authority.userId !== userId || authority.modelId !== modelId || !media(modelId)
    || !Number.isSafeInteger(credits) || credits < 1 || credits > authority.credits
    || !['/api/ai/generate-image', '/api/ai/generate-video', '/api/ai/generate-music'].includes(new URL(request.url).pathname))
    fail('canvas_agent_authority_revoked');
  const row = await env.DB.prepare(`SELECT a.state,a.result_json,p.deleted_at,u.status AS user_status
    FROM canvas_agent_action_receipts a JOIN canvas_projects p ON p.id=a.project_id JOIN users u ON u.id=a.user_id
    WHERE a.id=? AND a.project_id=? AND a.user_id=?`).bind(authority.id, authority.projectId, userId).first();
  const result = JSON.parse(row?.result_json || '{}');
  const prepared = result.prepared;
  const confirmation = JSON.parse(result.confirmationInput || '{}');
  if (row?.state !== 'executing' || row.deleted_at || row.user_status !== 'active' || confirmation.decision !== 'accept'
    || prepared?.modelId !== modelId || prepared.credits !== authority.credits
    || prepared.projectCapRunId !== authority.projectCapRunId || prepared.mediaPolicyRevision !== authority.policyRevision)
    fail('canvas_agent_authority_revoked');
  const policy = await canvasMediaPolicyContext(env, authority.projectId, userId);
  if (policy.revision !== authority.policyRevision) fail('canvas_agent_media_policy_changed');
  if (!canvasMediaPolicyAllows(policy, modelId)) fail('canvas_agent_media_model_not_allowed');
  // The executing receipt already reserves its maximum in the existing costs
  // projection. Atomic database guards arbitrate concurrent action/step claims.
  const cap = policy.models.find(item => item.modelId === modelId)?.creditLimit ?? null;
  if (cap !== null && (policy.usage.find(item => item.modelId === modelId)?.committedCredits || 0) > cap)
    fail('canvas_agent_media_limit_exceeded');
  const canvasRun = await env.DB.prepare('SELECT id FROM canvas_runs WHERE user_id=? AND project_id=? AND idempotency_key=?').bind(userId, authority.projectId, `canvas_action_${authority.id}`).first();
  if (!canvasRun) fail('canvas_agent_authority_revoked');
  return { canvas_media_action: { action_id: authority.id, project_id: authority.projectId,
    canvas_run_id: canvasRun.id, request_key: request.headers.get('Idempotency-Key'),
    policy_revision: authority.policyRevision, project_cap_run_id: authority.projectCapRunId } };
}
