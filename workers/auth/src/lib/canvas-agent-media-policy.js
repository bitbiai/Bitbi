import { normalizeCanvasMediaPolicy, canvasMediaPolicyAllows } from '../../../../js/shared/canvas-agent-media-policy.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { nowIso } from './tokens.js';
import { readCanvasAgentBudget } from './canvas-agent-budget.js';

const media = new Set(['image', 'video', 'music']);
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
export async function readCanvasMediaPolicy(env, projectId, userId = null) {
  const row = await env.DB.prepare(`SELECT p.media_policy_revision,p.user_id,m.mode,m.models_json
    FROM canvas_projects p LEFT JOIN canvas_agent_media_policies m ON m.project_id=p.id AND m.revision=p.media_policy_revision
    WHERE p.id=? AND p.deleted_at IS NULL AND (? IS NULL OR p.user_id=?)`).bind(projectId, userId, userId).first();
  if (!row) fail('project_not_found', 404);
  if (row.media_policy_revision > 0 && !row.mode) fail('canvas_agent_media_policy_invalid');
  return { revision: row.media_policy_revision, ...normalizeCanvasMediaPolicy({ mode: row.mode || 'automatic', models: JSON.parse(row.models_json || '[]') }) };
}
export async function readCanvasMediaUsage(env, projectId, policy) {
  const rows = (await env.DB.prepare(`SELECT model_id,COALESCE(SUM(charged),0) AS charged,COALESCE(SUM(reserved),0) AS reserved,
    COALESCE(SUM(pending),0) AS pending,COALESCE(SUM(committed),0) AS committed FROM canvas_agent_media_costs WHERE project_id=? GROUP BY model_id`).bind(projectId).all()).results;
  const ids = new Set([...rows.map(row => row.model_id), ...policy.models.map(item => item.modelId)]);
  return [...ids].sort().map(modelId => {
    const row = rows.find(item => item.model_id === modelId) || { charged: 0, reserved: 0, pending: 0, committed: 0 };
    const cap = policy.models.find(item => item.modelId === modelId)?.creditLimit ?? null;
    if ([row.charged, row.reserved, row.pending, row.committed].some(n => !Number.isSafeInteger(n) || n < 0)) fail('canvas_agent_budget_state_invalid');
    return { modelId, chargedCredits: row.charged, reservedCredits: row.reserved, pendingOutcomeCredits: row.pending,
      committedCredits: row.committed, remainingCredits: cap === null ? null : Math.max(0, cap - row.committed) };
  });
}
export async function canvasMediaPolicyContext(env, projectId, userId = null) {
  const policy = await readCanvasMediaPolicy(env, projectId, userId);
  return { ...policy, scope: 'assistant_media_project_cumulative', usage: await readCanvasMediaUsage(env, projectId, policy),
    semantics: 'Additional ceilings within the authorized project budget, including outstanding and uncertain commitments. Null means no additional model cap; zero forbids new spending. Existing owned media may be reused. Manual user execution retains its own authorization.' };
}
export async function restrictCanvasMediaInventory(env, projectId, inventory, userId = null) {
  const policy = await canvasMediaPolicyContext(env, projectId, userId);
  const models = inventory.models.filter(model => !media.has(model.capability) || canvasMediaPolicyAllows(policy, model.id));
  // Catalog readiness and project spending policy have distinct revisions.
  // Usage changes must not invalidate an already accepted capability snapshot.
  return { ...inventory, models, mediaPolicy: policy };
}
export function assertCanvasMediaPlan(policy, steps) {
  const costs = new Map();
  for (const step of steps) {
    const modelId = step.input?.modelId ?? step.modelId;
    if (!media.has(getCanvasModelForRole(modelId, 'member')?.capability)) continue;
    if (!canvasMediaPolicyAllows(policy, modelId)) fail('canvas_agent_media_model_not_allowed');
    costs.set(modelId, (costs.get(modelId) || 0) + step.credits);
  }
  for (const [modelId, credits] of costs) {
    const cap = policy.models.find(item => item.modelId === modelId)?.creditLimit ?? null;
    const committed = policy.usage.find(item => item.modelId === modelId)?.committedCredits || 0;
    if (cap !== null && committed + credits > cap) fail('canvas_agent_media_limit_exceeded');
  }
}
export async function canvasMediaPolicyView(env, projectId, userId) {
  const policy = await readCanvasMediaPolicy(env, projectId, userId);
  const { canvasAgentCapabilities } = await import('./canvas-agent-capabilities.js');
  const all = await canvasAgentCapabilities(env);
  const inventory = all.models.filter(model => media.has(model.capability)).map(model => ({ ...model, provider: getCanvasModelForRole(model.id, 'member')?.vendor || model.id.split('/')[0], available: true, reason: null }));
  for (const selected of policy.models) if (!inventory.some(model => model.id === selected.modelId)) {
    const model = getCanvasModelForRole(selected.modelId, 'member');
    inventory.push({ id: selected.modelId, label: model?.label || selected.modelId, provider: model?.vendor || selected.modelId.split('/')[0],
      capability: model?.capability || 'image', controls: model?.controls || {}, pricing: { status: 'unavailable' }, available: false, reason: 'canvas_agent_model_ineligible' });
  }
  const run = await env.DB.prepare("SELECT * FROM canvas_agent_runs WHERE project_id=? AND user_id=? AND purpose='production' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(projectId, userId).first();
  return { policy, inventory, usage: await readCanvasMediaUsage(env, projectId, policy), projectBudget: run ? await readCanvasAgentBudget(env, run) : null,
    activeRun: run && !['completed', 'cancelled', 'taken_over'].includes(run.status) ? { id: run.id, status: run.status, phase: run.phase } : null };
}
export async function saveCanvasMediaPolicy(env, projectId, userId, input, key) {
  if (!input || Object.keys(input).some(field => !['expectedRevision', 'mode', 'models'].includes(field))
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !/^[A-Za-z0-9._:-]{8,100}$/.test(key || '')) fail('canvas_agent_media_policy_invalid', 400);
  const next = normalizeCanvasMediaPolicy({ mode: input.mode, models: input.models });
  const current = await readCanvasMediaPolicy(env, projectId, userId);
  const prior = await env.DB.prepare('SELECT * FROM canvas_agent_media_policies WHERE user_id=? AND request_key=?').bind(userId, key).first();
  if (prior) {
    if (prior.project_id !== projectId || prior.revision !== input.expectedRevision + 1 || prior.mode !== next.mode || prior.models_json !== JSON.stringify(next.models)) fail('idempotency_conflict');
    return { ...await canvasMediaPolicyView(env, projectId, userId), idempotentReplay: true, affectedRunPaused: false };
  }
  if (current.revision !== input.expectedRevision) fail('canvas_agent_media_policy_changed');
  const view = await canvasMediaPolicyView(env, projectId, userId);
  for (const item of next.models) {
    const model = view.inventory.find(row => row.id === item.modelId);
    // A disabled historical selection can be retained/removed. It cannot newly
    // authorize an unavailable or administrator-only generator.
    if (!model?.available && !current.models.some(row => row.modelId === item.modelId)) fail('canvas_agent_model_ineligible');
    const committed = view.usage.find(row => row.modelId === item.modelId)?.committedCredits || 0;
    if (item.creditLimit !== null && item.creditLimit < committed) fail('canvas_agent_media_limit_below_committed');
  }
  try {
    await env.DB.prepare('INSERT INTO canvas_agent_media_policies(project_id,user_id,revision,request_key,mode,models_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(projectId, userId, current.revision + 1, key, next.mode, JSON.stringify(next.models), nowIso()).run();
  } catch (error) {
    const accepted = await env.DB.prepare('SELECT * FROM canvas_agent_media_policies WHERE user_id=? AND request_key=?').bind(userId, key).first();
    if (accepted?.project_id === projectId && accepted.revision === current.revision + 1 && accepted.mode === next.mode && accepted.models_json === JSON.stringify(next.models))
      return { ...await canvasMediaPolicyView(env, projectId, userId), idempotentReplay: true, affectedRunPaused: Boolean(view.activeRun) };
    for (const code of ['canvas_agent_media_limit_below_committed', 'canvas_agent_media_policy_changed']) if (String(error).includes(code)) fail(code);
    throw error;
  }
  return { ...await canvasMediaPolicyView(env, projectId, userId), affectedRunPaused: Boolean(view.activeRun && ['queued', 'planning', 'applying', 'running', 'exporting'].includes(view.activeRun.status)) };
}
export async function assertCanvasMediaDispatch(env, authority, modelId) {
  if (!media.has(getCanvasModelForRole(modelId, 'member')?.capability)) return;
  const policy = await readCanvasMediaPolicy(env, authority.projectId, authority.userId);
  const run = await env.DB.prepare('SELECT media_policy_revision FROM canvas_agent_runs WHERE id=? AND user_id=? AND project_id=?').bind(authority.runId, authority.userId, authority.projectId).first();
  if (run?.media_policy_revision !== policy.revision) fail('canvas_agent_media_policy_changed');
  if (!canvasMediaPolicyAllows(policy, modelId)) fail('canvas_agent_media_model_not_allowed');
  const cap = policy.models.find(item => item.modelId === modelId)?.creditLimit ?? null;
  if (cap !== null && (await readCanvasMediaUsage(env, authority.projectId, policy)).find(item => item.modelId === modelId)?.committedCredits > cap) fail('canvas_agent_media_limit_exceeded');
}
export async function canvasMediaResumeStatements(env, run, { authorized = true } = {}) {
  const policy = await canvasMediaPolicyContext(env, run.project_id, run.user_id);
  if (policy.revision === run.media_policy_revision) return [];
  if (!authorized || !['paused','blocked','review_required'].includes(run.status)) fail('canvas_agent_media_policy_resume_required');
  const pending = (await env.DB.prepare(`SELECT s.input_json,s.allocation_credits,COALESCE(cost.committed,0) AS committed FROM canvas_agent_steps s
    LEFT JOIN canvas_agent_media_costs cost ON cost.step_id=s.id
    LEFT JOIN member_ai_usage_attempts_v2 a ON a.user_id=? AND a.id=COALESCE(s.usage_attempt_id,
      (SELECT id FROM member_ai_usage_attempts_v2 WHERE user_id=? AND json_extract(metadata_json,'$.canvas_agent.step_id')=s.id LIMIT 1))
    WHERE s.run_id=? AND s.kind='node' AND s.status IN ('ready','accepted') AND (a.id IS NULL OR a.provider_outcome='not_dispatched' AND a.reservation_released_at IS NULL)`).bind(run.user_id, run.user_id, run.id).all()).results;
  const { canvasAgentCapabilities } = await import('./canvas-agent-capabilities.js');
  const inventory = await canvasAgentCapabilities(env);
  for (const step of pending) {
    const modelId = JSON.parse(step.input_json).modelId;
    if (!media.has(getCanvasModelForRole(modelId, 'member')?.capability)) continue;
    if (!canvasMediaPolicyAllows(policy, modelId)) fail('canvas_agent_media_model_not_allowed');
    if (!inventory.models.some(model => model.id === modelId)) fail('canvas_agent_model_ineligible');
  }
  // Blocked run allocations stop reserving project space. Explicit resumption
  // must readmit that unstarted space in addition to durable commitments.
  for (const item of policy.models) {
    const readmitted = pending.filter(step => JSON.parse(step.input_json).modelId === item.modelId)
      .reduce((sum, step) => sum + Math.max(0, step.allocation_credits - step.committed), 0);
    if (item.creditLimit !== null && (policy.usage.find(row => row.modelId === item.modelId)?.committedCredits || 0) + readmitted > item.creditLimit) fail('canvas_agent_media_limit_exceeded');
  }
  return [env.DB.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canvas_agent_media_policies p,json_each(p.models_json) item
    WHERE p.project_id=? AND p.revision=? AND p.mode='selected' AND json_extract(item.value,'$.creditLimit') IS NOT NULL
    AND json_extract(item.value,'$.creditLimit') < COALESCE((SELECT SUM(c.committed) FROM canvas_agent_media_costs c
      WHERE c.project_id=p.project_id AND c.model_id=json_extract(item.value,'$.modelId')),0)
      +COALESCE((SELECT SUM(MAX(0,s.allocation_credits-c.committed)) FROM canvas_agent_steps s JOIN canvas_agent_media_costs c ON c.step_id=s.id
        WHERE s.run_id=? AND s.status IN ('ready','accepted') AND c.model_id=json_extract(item.value,'$.modelId')
        AND c.reservation_released_at IS NULL AND (c.billing_status IS NULL OR c.billing_status='reserved')
        AND (c.provider_outcome IS NULL OR c.provider_outcome='not_dispatched')),0))
    THEN 1 ELSE json_extract('[]','$[') END`).bind(run.project_id,policy.revision,run.id),
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL AND media_policy_revision=?)
    THEN 1 ELSE json_extract('[]','$[') END`).bind(run.project_id, run.user_id, policy.revision),
    env.DB.prepare("UPDATE canvas_agent_runs SET media_policy_revision=?,error_code=CASE WHEN status='paused' THEN NULL ELSE error_code END,cause_json=CASE WHEN status='paused' THEN NULL ELSE cause_json END WHERE id=? AND media_policy_revision=?").bind(policy.revision, run.id, run.media_policy_revision)];
}
