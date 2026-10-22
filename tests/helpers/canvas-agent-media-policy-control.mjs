import { canvasMediaConstraintError } from '../../workers/auth/src/lib/canvas-agent-media-errors.js';
import { canvasProductionFailure } from '../../workers/auth/src/lib/canvas-agent-execution-failure.js';
import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits, consumeMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { beginMemberAiUsageAttempt, markMemberAiUsageAttemptProviderRunning, markMemberAiUsageAttemptFinalizing, markMemberAiUsageAttemptSucceeded } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { canvasAgentEnvironment, canvasAgentUsageMetadata } from '../../workers/auth/src/lib/canvas-agent-authority.js';
import { canvasAgentCapabilities } from '../../workers/auth/src/lib/canvas-agent-capabilities.js';
import { canvasMediaPolicyContext, readCanvasMediaPolicy, restrictCanvasMediaInventory } from '../../workers/auth/src/lib/canvas-agent-media-policy.js';
import { plannerPriceInput } from '../../workers/auth/src/lib/canvas-agent-planning.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';

const check = (condition, reason) => { if (!condition) throw new Error(reason); };
const image = '@cf/black-forest-labs/flux-1-schnell', video = 'minimax/h3', music = 'minimax/music-2.6';
export const CANVAS_MEDIA_POLICY_CASES = ['api', 'parallel', 'dispatch', 'cumulative', 'context', 'resume', 'accepted-resume'];
async function rejects(action, code) {
  try { await action(); } catch (error) {
    check([error, error.cause, error.cause?.cause].some(item => String(item?.message || item).includes(code)), `Expected ${code}, received ${String(error)}`); return error;
  }
  throw new Error(`Expected ${code}`);
}
async function fixture(base, name) {
  const DB = base.DB, owner = `media-policy-${name}`, foreign = owner + '-other', now = new Date().toISOString(), waits = [], wakes = [];
  const id = async suffix => (await sha256Hex(owner + suffix)).slice(0, 32);
  const project = await id('project'), run = await id('run');
  const env = { ...base, CANVAS_AGENT_ENABLED: 'true', ENABLE_GROK_4_7: 'true', ENABLE_FABLE_5: 'true',
    AI_SERVICE_AUTH_SECRET: 'canvas-media-policy-synthetic-secret', CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32), H3_CLOUDFLARE_API_TOKEN: 'synthetic-only',
    AI_VIDEO_JOBS_QUEUE: { async send(message) { wakes.push(message); } },
    PRIVATE_MEDIA_PROCESSOR: { async fetch() { throw new Error('Unexpected media processor'); } },
    AI_LAB: { async fetch(request) {
      check(new URL(request.url).pathname === '/internal/ai/canvas-agent/readiness', 'Policy interactions must not call inference');
      const ai = (await import('../../workers/ai/src/index.js')).default;
      return ai.fetch(request, { ENABLE_GROK_4_7: 'true', AI_SERVICE_AUTH_SECRET: env.AI_SERVICE_AUTH_SECRET,
        SERVICE_AUTH_REPLAY: base.SERVICE_AUTH_REPLAY || base.PUBLIC_RATE_LIMITER, AI: { run() { throw new Error('Unexpected paid inference'); } } }, { waitUntil() {} });
    } },
  };
  for (const user of [owner, foreign]) {
    await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(user, user + '@example.invalid', 'synthetic', now, now).run();
    await DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(user, user, await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`), now, new Date(Date.now() + 3600000).toISOString(), now).run();
  }
  await topUpMemberDailyCredits({ env, userId: owner });
  await grantMemberCredits({ env, userId: owner, amount: 1000, createdByUserId: owner, idempotencyKey: owner + '-credits' });
  await DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Media policy fixture','en',?,?)").bind(project, owner, now, now).run();
  const seeds = name === 'parallel' ? [[image, '0-scene-a'], [image, '0-scene-b'], [video, '1-scene-a'], [video, '1-scene-b'], [music, '2-scene-a'], [music, '2-scene-b'], [image, 'remaining-image'], [video, 'project-overflow']] : ['dispatch', 'cumulative', 'resume', 'accepted-resume'].includes(name) ? [[image, 'original'], [image, 'unstarted'], [image, 'unchanged']] : [];
  for (const [modelId, suffix] of seeds) await DB.prepare('INSERT INTO canvas_nodes(id,project_id,user_id,type,title,x,y,model_id,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?)')
    .bind(await id(suffix + '-node'), project, owner, (modelId === image ? 'image' : modelId === video ? 'video' : 'music') + '_generation', suffix, modelId, now, now).run();
  const request = async (path, method = 'GET', body, key = owner + '-request', user = owner) => {
    const response = await worker.fetch(new Request(`https://bitbi.ai/api/account/canvas/projects/${project}/${path}`, {
      method, headers: { Origin: 'https://bitbi.ai', Cookie: `__Host-bitbi_session=${user}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.177', 'Idempotency-Key': key,
        'X-Bitbi-Tariff-Revision': String((await getModelTariff(env)).revision) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, { waitUntil(promise) { waits.push(promise); } });
    const payload = await response.json(); return { status: response.status, ...payload };
  };
  const save = (revision, models, key = owner + '-policy-' + revision) => request('agent/media-policy', 'PUT', { expectedRevision: revision, mode: 'selected', models }, key);
  const start = async (revision, cap = 100) => {
    const inventory = await canvasAgentCapabilities(env);
    await DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,phase,expected_revision,budget_credits,
      tariff_revision,capability_revision,plan_json,media_policy_revision,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at)
      VALUES(?,?,?,?,'{}','running','generating',?,?,?,?,'{}',?,'policy-lease',?,?,?,?,?)`).bind(run, project, owner, run, (await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(project).first()).revision, cap, inventory.tariffRevision, inventory.revision, revision,
      new Date(Date.now() + 600000).toISOString(), now, now, now, new Date(Date.now() + 3600000).toISOString()).run();
  };
  const allocate = async (suffix, modelId, credits) => {
    const node = await id(suffix + '-node'), step = await id(suffix + '-step');
    await DB.prepare("INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,node_id,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,?,'node',?,?,?,?,?)")
      .bind(step, run, suffix, node, JSON.stringify({ modelId, prompt: 'Distinct synthetic scene ' + suffix }), credits, now, now).run();
    return { id: step, node, modelId, credits };
  };
  const reserve = async step => {
    const scoped = canvasAgentEnvironment(env, { userId: owner, projectId: project, runId: run, stepId: step.id, leaseToken: 'policy-lease' });
    const request = new Request('https://bitbi.ai/api/ai/generate-image');
    const metadata = await canvasAgentUsageMetadata(scoped, request, { userId: owner, modelId: step.modelId, credits: step.credits });
    const input = { env: scoped, userId: owner, featureKey: 'ai.image.generate', operationKey: 'member.image.generate', route: '/api/ai/generate-image', idempotencyKey: 'canvas-agent-' + step.id,
      requestFingerprint: await sha256Hex(step.id), creditCost: step.credits, metadata };
    const admitted = await beginMemberAiUsageAttempt(input);
    check(admitted.kind === 'reserved', 'Existing billing gateway reserves the original attempt');
    await DB.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=? WHERE id=?').bind(admitted.attempt.id, step.id).run();
    return { scoped, input, attempt: admitted.attempt };
  };
  return { DB, env, owner, foreign, now, id, project, run, waits, wakes, request, save, start, allocate, reserve };
}
export async function canvasMediaPolicyCase(base, name) {
  const f = await fixture(base, name), { DB, env, project, owner } = f;
  if (name === 'api') {
    const empty = await f.request('agent/media-policy'); check(empty.ok && empty.data.policy.revision === 0 && empty.data.policy.mode === 'automatic', 'Legacy project defaults to automatic');
    check((await f.request('agent/media-policy', 'GET', null, 'foreign-read', f.foreign)).status === 404, 'Foreign project policy is not visible');
    const saved = await f.save(0, [{ modelId: image, creditLimit: 0 }, { modelId: music, creditLimit: null }]);
    check(saved.ok && saved.data.policy.revision === 1, `Selected policy persists: ${saved.code}`);
    const repeated = await f.save(0, [{ modelId: music, creditLimit: null }, { modelId: image, creditLimit: 0 }]);
    check(repeated.ok && repeated.data.idempotentReplay && repeated.data.policy.revision === 1, 'Order-insensitive exact retry reuses policy identity');
    check((await f.save(0, [], 'stale-second-tab')).code === 'canvas_agent_media_policy_changed', 'Stale policy updates fail');
    check((await f.save(1, [{ modelId: 'admin/unavailable', creditLimit: null }])).code === 'canvas_agent_model_ineligible', 'Unknown generators cannot be approved');
    check((await f.save(1, [])).ok, 'An intentionally empty allowlist saves');
    const current = await readCanvasMediaPolicy(env, project, owner);
    check(current.mode === 'selected' && current.models.length === 0, 'Empty selection is not automatic');
    check((await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(project).first()).revision === 0, 'Reading/saving media settings does not fabricate graph edits');
    await DB.prepare('DELETE FROM canvas_projects WHERE id=?').bind(project).run();
    check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_media_policies WHERE project_id=?').bind(project).first()).n === 0, 'Normal project/account removal does not acquire a new foreign-key blocker');
  } else if (name === 'parallel') {
    check((await f.save(0, [image, video, music].map(modelId => ({ modelId, creditLimit: 10 })))).ok, 'Policy saves');
    await f.start(1, 25);
    for (const [i, modelId] of [image, video, music].entries()) {
      const results = await Promise.allSettled([f.allocate(`${i}-scene-a`, modelId, 6), f.allocate(`${i}-scene-b`, modelId, 6)]);
      check(results.filter(r => r.status === 'fulfilled').length === 1, 'Only one of two individually affordable distinct prompts fits each model cap');
      check(results.filter(r => r.status === 'rejected').every(r => String(r.reason).includes('canvas_agent_media_limit_exceeded')), 'Atomic model trigger is the independent rejection');
      const original = results.find(result => result.status === 'rejected').reason;
      const wrapped = new Error('A database operation failed', { cause: original }), mapped = canvasMediaConstraintError(wrapped);
      check(mapped.code === 'canvas_agent_media_limit_exceeded' && mapped.status === 409 && mapped.message === mapped.code, 'Actual native wrapped trigger exposes only the fixed decision code');
      const failure = await canvasProductionFailure(env, await DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.run).first(), wrapped);
      check(failure.code === mapped.code && failure.cause.recovery === 'decision', 'Policy rejection remains an actionable decision without invented dispatch evidence');
      const unknown = Object.assign(new Error('unknown_constraint_private_detail'), { code: 'D1_ERROR' });
      check(canvasMediaConstraintError(unknown) === unknown, 'Unknown database failures remain unknown');
      const provider = new Error('Provider text mentions canvas_agent_media_limit_exceeded');
      check(canvasMediaConstraintError(provider) === provider, 'Untrusted provider text cannot fabricate a database decision');

    }
    await f.allocate('remaining-image', image, 4);
    await rejects(() => f.allocate('project-overflow', video, 4), 'canvas_agent_budget_exceeded');
    const costs = await canvasMediaPolicyContext(env, project, owner);
    check(costs.usage.reduce((sum, row) => sum + row.committedCredits, 0) === 22, 'Winner mapping and global total are exact');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(owner).first()).n === 0, 'Allocation never creates wallet charges');
  } else if (name === 'dispatch' || name === 'cumulative') {
    check((await f.save(0, [{ modelId: image, creditLimit: 10 }])).ok, 'Image cap saves'); await f.start(1);
    const step = await f.allocate('original', image, 6), accepted = await f.reserve(step);
    const duplicate = await beginMemberAiUsageAttempt(accepted.input); check(duplicate.attempt.id === accepted.attempt.id, 'Replay uses one original usage identity');
    const dispatch = await markMemberAiUsageAttemptProviderRunning(accepted.scoped, accepted.attempt.id);
    if (name === 'dispatch') {
      const sibling = await f.allocate('unstarted', image, 4), pending = await f.reserve(sibling);
      check((await f.save(1, [])).ok, 'Deselecting retains existing accepted work');
      const denial = await rejects(() => markMemberAiUsageAttemptProviderRunning(pending.scoped, pending.attempt.id), 'canvas_agent_media_policy_changed');
      check(denial.code === 'canvas_agent_media_policy_changed' && denial.status === 409, 'The real usage catch preserves the fixed policy conflict');
      check((await DB.prepare('SELECT provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(pending.attempt.id).first()).provider_outcome === 'not_dispatched', 'No dispatch escaped the policy edit');
    }
    await markMemberAiUsageAttemptFinalizing(env, accepted.attempt.id, { dispatchToken: dispatch });
    const settled = await consumeMemberCredits({ env, userId: owner, featureKey: accepted.input.featureKey, credits: 5, idempotencyKey: accepted.input.idempotencyKey,
      requestFingerprint: accepted.input.requestFingerprint, aiDispatchToken: dispatch, source: 'synthetic-media-policy' });
    await markMemberAiUsageAttemptSucceeded(env, accepted.attempt.id, { dispatchToken: dispatch, model: image, resultStatus: 'stored', balanceAfter: settled.creditBalance });
    await DB.prepare("UPDATE canvas_agent_steps SET status='completed' WHERE id=?").bind(step.id).run();
    if (name === 'cumulative') {
      await DB.prepare('UPDATE canvas_nodes SET deleted_at=? WHERE id=?').bind(f.now, step.node).run();
      check((await f.save(1, [{ modelId: image, creditLimit: 4 }])).code === 'canvas_agent_media_limit_below_committed', 'Deleting a node cannot reset spent credits');
      const context = await canvasMediaPolicyContext(env, project, owner); check(context.usage[0].chargedCredits === 5 && context.usage[0].remainingCredits === 5, 'Final debit replaces unused reservation exactly once');
    } else check((await canvasMediaPolicyContext(env, project, owner)).usage.find(row => row.modelId === image).chargedCredits === 5, 'Accepted completion settles after deselection without a second dispatch');
  } else if (name === 'context') {
    check((await f.save(0, [{ modelId: image, creditLimit: 12 }])).ok, 'Policy saves');
    const scoped = await restrictCanvasMediaInventory(env, project, await canvasAgentCapabilities(env), owner);
    check(scoped.models.filter(model => ['image', 'video', 'music'].includes(model.capability)).every(model => model.id === image), 'Planner only sees selected media');
    check(scoped.mediaPolicy.usage[0].remainingCredits === 12, 'Planner receives cumulative headroom');
    for (const model of ['xai/grok-4.7', 'anthropic/claude-fable-5']) {
      const input = plannerPriceInput({ model, brief: 'Synthetic film', capabilities: scoped, currentProject: { id: project } });
      check(input.prompt.includes('assistant_media_project_cumulative') && input.prompt.includes(image), 'Both native adapters receive the same authoritative restrictions in the priced prompt');
    }
  } else if (name === 'accepted-resume') {
    check((await f.save(0, [{ modelId: image, creditLimit: 10 }])).ok, 'Policy saves'); await f.start(1);
    const step = await f.allocate('original', image, 6), accepted = await f.reserve(step);
    await markMemberAiUsageAttemptProviderRunning(accepted.scoped, accepted.attempt.id);
    await DB.prepare("UPDATE canvas_agent_steps SET status='accepted',usage_attempt_id=NULL,receipt_json=? WHERE id=?")
      .bind(JSON.stringify({ canvasRunId: await f.id('accepted-canvas-run') }), step.id).run();
    check((await f.save(1, [])).ok, 'Previously dispatched image can be deselected');
    const resumed = await f.request(`agent/${f.run}/control`, 'POST', { action: 'resume' }, 'resume-accepted-only');
    check(resumed.ok && resumed.data.run.mediaPolicyRevision === 2, `Existing dispatch is observed under original identity: ${resumed.code}`);
    const usage = await DB.prepare('SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id=?').bind(accepted.attempt.id).first();
    check(usage.provider_outcome === 'dispatched' && usage.billing_status === 'reserved', 'Resume does not replay or settle accepted usage');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(owner).first()).n === 1, 'No replacement usage identity');
  } else if (name === 'resume') {
    check((await f.save(0, [{ modelId: image, creditLimit: 10 }])).ok, 'Policy saves'); await f.start(1);
    await f.allocate('unchanged', image, 6);
    check((await f.save(1, [])).data.affectedRunPaused, 'Policy change pauses unstarted work');
    const denied = await f.request(`agent/${f.run}/control`, 'POST', { action: 'resume' }, 'resume-forbidden');
    check(denied.code === 'canvas_agent_media_model_not_allowed', `Normal Resume explains forbidden pending model: ${JSON.stringify(denied)}`);
    check((await f.save(2, [{ modelId: image, creditLimit: 10 }])).ok, 'Owner can restore allowed model');
    const resumed = await f.request(`agent/${f.run}/control`, 'POST', { action: 'resume' }, 'resume-compatible');
    check(resumed.ok && resumed.data.run.status === 'running' && resumed.data.run.mediaPolicyRevision === 3, `Normal control adopts compatible policy: ${resumed.code}`);
    check(f.wakes.length === 1, 'One original run wake; no replacement production or inference');
  }
  await Promise.all(f.waits);
  return { case: name, paidProviderCalls: 0 };
}
