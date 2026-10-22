import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits, consumeMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { beginMemberAiUsageAttempt, markMemberAiUsageAttemptProviderRunning, markMemberAiUsageAttemptFinalizing, markMemberAiUsageAttemptSucceeded } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { canvasMediaActionEnvironment, canvasMediaActionUsageMetadata, quoteCanvasMediaAction } from '../../workers/auth/src/lib/canvas-agent-media-action.js';
import { canvasMediaPolicyContext, saveCanvasMediaPolicy } from '../../workers/auth/src/lib/canvas-agent-media-policy.js';

const image = '@cf/black-forest-labs/flux-1-schnell', textModel = 'xai/grok-4.6';
const check = (condition, message) => { if (!condition) throw new Error(message); };
export const CANVAS_MEDIA_ACTION_POLICY_CASES = ['parallel', 'historical', 'unknown', 'text', 'resume-outer', 'resume-model'];
async function rejects(action, code) {
  try { await action(); } catch (error) {
    check([error, error.cause, error.cause?.cause].some(item => String(item?.message || item).includes(code)), `Expected ${code}, received ${String(error)}`); return;
  }
  throw new Error(`Expected ${code}`);
}
async function fixture(base, name) {
  const DB = base.DB, owner = `media-action-policy-${name}`, now = new Date().toISOString();
  const id = async suffix => (await sha256Hex(owner + suffix)).slice(0, 32);
  const project = await id('project'), production = await id('production'), turn = await id('turn');
  const env = { ...base, AI: { run() { throw new Error('Accounting fixtures must not call a provider'); } } };
  await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)")
    .bind(owner, owner + '@example.invalid', 'synthetic', now, now).run();
  await topUpMemberDailyCredits({ env, userId: owner });
  await grantMemberCredits({ env, userId: owner, amount: 1000, createdByUserId: owner, idempotencyKey: owner + '-credits' });
  await DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Synthetic action policy','en',?,?)").bind(project, owner, now, now).run();
  for (const suffix of ['first', 'second', 'text']) await DB.prepare('INSERT INTO canvas_nodes(id,project_id,user_id,type,title,x,y,model_id,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?)')
    .bind(await id(suffix), project, owner, suffix === 'text' ? 'text_generation' : 'image_generation', suffix, suffix === 'text' ? textModel : image, now, now).run();
  const outer = name === 'resume-outer' || name === 'outer-allocation';
  const policy = await saveCanvasMediaPolicy(env, project, owner, { expectedRevision: 0, mode: outer ? 'automatic' : 'selected',
    models: outer ? [] : [{ modelId: image, creditLimit: ['parallel', 'resume-model'].includes(name) ? 10 : name === 'text' ? 0 : 100 }] }, owner + '-policy');
  check(policy.policy.revision === 1, 'The actual project policy service persists revision one');
  const revision = (await DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(project).first()).revision;
  await DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,phase,expected_revision,budget_credits,
    media_policy_revision,next_attempt_at,created_at,updated_at,expires_at) VALUES(?,?,?,?,'{}','paused','generating',?,?,1,?,?,?,?)`)
    .bind(production, project, owner, production, revision, outer ? 10 : 100, now, now, now, new Date(Date.now() + 3600000).toISOString()).run();
  await DB.prepare('INSERT INTO canvas_agent_conversations(project_id,user_id,brief_json,created_at,updated_at) VALUES(?,?,\'{}\',?,?)').bind(project, owner, now, now).run();
  await DB.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,?,'{}',0,0,'Create the confirmed variant','completed',?,?)")
    .bind(turn, project, turn, now, now).run();
  const action = async (suffix, credits, { legacy = false } = {}) => {
    const actionId = await id(suffix + '-action'), nodeId = await id(suffix), modelId = suffix === 'text' ? textModel : image;
    const prepared = { modelId, credits, expectedRevision: revision, ...(suffix === 'text' ? {} : { mediaPolicyRevision: 1, projectCapRunId: production }) };
    const result = { ...(legacy ? {} : { prepared }), confirmationInput: JSON.stringify({ decision: 'accept', credits }) };
    await DB.prepare("INSERT INTO canvas_agent_action_receipts(id,project_id,user_id,turn_id,ordinal,input_json,state,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'confirmation_required',?,?,?)")
      .bind(actionId, project, owner, turn, suffix === 'first' ? 0 : suffix === 'second' ? 1 : 2,
        JSON.stringify({ locale: 'en', action: { type: 'regenerate', targetId: nodeId } }), JSON.stringify(result), now, now).run();
    return { id: actionId, project_id: project, user_id: owner, nodeId, prepared, result_json: JSON.stringify(result) };
  };
  // The exact compare-and-claim operation from executeOne; this fixture isolates
  // its D1 concurrency boundary, complementing the ordinary confirmed-action test.
  const claim = row => DB.prepare("UPDATE canvas_agent_action_receipts SET state='executing',result_json=?,updated_at=? WHERE id=? AND state=? AND result_json IS ?")
    .bind(row.result_json, now, row.id, 'confirmation_required', row.result_json).run();
  const canvasRun = async row => {
    const runId = await id(row.id + '-canvas'), rawKey = `canvas_action_${row.id}`;
    await DB.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,idempotency_key,status,input_json,node_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'running','{}',0,?,?)")
      .bind(runId, project, row.nodeId, owner, row.prepared.modelId, 'image', rawKey, now, now).run();
    return { id: runId, rawKey };
  };
  const reserve = async (row, source, legacy = false) => {
    const scoped = legacy ? env : canvasMediaActionEnvironment(env, row, row.prepared);
    const request = new Request('https://bitbi.ai/api/ai/generate-image', { headers: { 'Idempotency-Key': source.rawKey } });
    const metadata = legacy ? {} : await canvasMediaActionUsageMetadata(scoped, request, { userId: owner, modelId: image, credits: row.prepared.credits });
    // Member usage keys are opaque scoped hashes, not Canvas's raw request key.
    const usageKey = 'ai:' + await sha256Hex(`${owner}:${source.rawKey}:member.image.generate`);
    const args = { env: scoped, userId: owner, featureKey: 'ai.image.generate', operationKey: 'member.image.generate', route: '/api/ai/generate-image',
      idempotencyKey: usageKey, requestFingerprint: await sha256Hex(row.id), creditCost: row.prepared.credits, metadata };
    const admitted = await beginMemberAiUsageAttempt(args);
    check(admitted.kind === 'reserved' && usageKey !== source.rawKey, 'The existing usage service admits exactly the original scoped request');
    return { args, attempt: admitted.attempt, scoped };
  };
  const settle = async (reserved, credits) => {
    const dispatchToken = await markMemberAiUsageAttemptProviderRunning(reserved.scoped, reserved.attempt.id);
    await markMemberAiUsageAttemptFinalizing(reserved.scoped, reserved.attempt.id, { dispatchToken });
    const debit = { env: reserved.scoped, userId: owner, featureKey: 'ai.image.generate', credits,
      idempotencyKey: reserved.args.idempotencyKey, requestFingerprint: reserved.args.requestFingerprint, aiDispatchToken: dispatchToken, source: 'synthetic-media-action' };
    const charged = await consumeMemberCredits(debit);
    await markMemberAiUsageAttemptSucceeded(reserved.scoped, reserved.attempt.id, { dispatchToken, model: image, resultStatus: 'stored', balanceAfter: charged.creditBalance, metadata: {} });
    return debit;
  };
  const cost = row => DB.prepare('SELECT * FROM canvas_agent_media_action_costs WHERE step_id=?').bind('action:' + row.id).first();
  const allocate = async (suffix, credits, runId = production, kind = 'node') => {
    const step = await id(suffix + '-step');
    await DB.prepare('INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,node_id,input_json,allocation_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(step, runId, suffix, kind, kind === 'node' ? await id('second') : null, JSON.stringify({ modelId: kind === 'node' ? image : textModel }), credits, now, now).run();
    return step;
  };
  return { DB, env, owner, project, production, revision, id, now, action, claim, canvasRun, reserve, settle, cost, allocate };
}
export async function canvasMediaActionPolicyCase(base, name) {
  const f = await fixture(base, name), { DB, env } = f;
  if (name === 'parallel') {
    const rows = await Promise.all([f.action('first', 6), f.action('second', 6)]);
    const claims = await Promise.allSettled(rows.map(f.claim));
    check(claims.filter(result => result.status === 'fulfilled').length === 1, 'Only one distinct six-credit action fits the shared ten-credit model cap');
    check(claims.some(result => result.status === 'rejected' && String(result.reason).includes('canvas_agent_media_limit_exceeded')), 'The atomic SQL claim rejects the competing action');
    const row = rows[claims.findIndex(result => result.status === 'fulfilled')];
    check((await f.claim(row)).meta.changes === 0, 'A duplicate action claim cannot create a second commitment');
    const source = await f.canvasRun(row), reserved = await f.reserve(row, source);
    check((await beginMemberAiUsageAttempt(reserved.args)).attempt.id === reserved.attempt.id, 'Duplicate admission retains its original usage identity');
    const debit = await f.settle(reserved, 5); await consumeMemberCredits(debit);
    const costs = await f.cost(row), usage = await canvasMediaPolicyContext(env, f.project, f.owner);
    check(costs.charged === 5 && costs.committed === 5 && costs.reserved === 0, 'Actual debit replaces the maximum commitment without adding both');
    check(usage.usage.find(item => item.modelId === image).committedCredits === 5, 'Unaccepted sibling is not a second debit or reservation');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n === 1, 'Duplicate completion leaves one ledger debit');
    const metadata = JSON.parse((await DB.prepare('SELECT metadata_json FROM member_ai_usage_attempts_v2 WHERE id=?').bind(reserved.attempt.id).first()).metadata_json);
    check(metadata.canvas_media_action.action_id === row.id, 'Finalization retains the immutable action-to-usage association');
  } else if (name === 'historical') {
    const row = await f.action('first', 50, { legacy: true }), source = await f.canvasRun(row), reserved = await f.reserve(row, source, true);
    await f.settle(reserved, 37);
    await DB.prepare("INSERT INTO member_generation_jobs(id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,status,next_attempt_at,created_at,updated_at,canvas_run_id) VALUES(?,?,?,'image',?,?,'succeeded',?,?,?,?)")
      .bind(await f.id('historical-job'), f.owner, reserved.attempt.id, source.rawKey, 'synthetic/action-input.json', f.now, f.now, f.now, source.id).run();
    await DB.prepare("UPDATE canvas_agent_action_receipts SET state='review_required' WHERE id=?").bind(row.id).run();
    const original = await DB.prepare('SELECT usage_attempt_id FROM canvas_runs WHERE id=?').bind(source.id).first();
    const metadata = JSON.parse((await DB.prepare('SELECT metadata_json FROM member_ai_usage_attempts_v2 WHERE id=?').bind(reserved.attempt.id).first()).metadata_json);
    check(original.usage_attempt_id === null && !metadata.canvas_media_action, 'Countercase really lacks the new shortcut fields');
    const cost = await f.cost(row);
    check(cost.charged === 37 && cost.committed === 37 && cost.reserved === 0, 'Historical durable-job ownership links the original hashed usage and exact debit');
    await rejects(() => saveCanvasMediaPolicy(env, f.project, f.owner, { expectedRevision: 1, mode: 'selected', models: [{ modelId: image, creditLimit: 36 }] }, 'historical-below-spent'), 'canvas_agent_media_limit_below_committed');
  } else if (name === 'unknown') {
    const row = await f.action('first', 11, { legacy: true }); await f.canvasRun(row);
    await DB.prepare("UPDATE canvas_agent_action_receipts SET state='review_required' WHERE id=?").bind(row.id).run();
    const before = await f.cost(row);
    check(before.charged === 0 && before.reserved === 0 && before.pending === 11 && before.committed === 11, 'A Canvas acceptance without linked usage retains the confirmed ceiling as uncertain commitment');
    await DB.prepare('UPDATE canvas_nodes SET deleted_at=? WHERE id=?').bind(f.now, row.nodeId).run();
    const after = await f.cost(row);
    check(after.committed === 11 && after.pending === 11, 'Removing the active node cannot erase an uncertain original expense');
    await rejects(() => saveCanvasMediaPolicy(env, f.project, f.owner, { expectedRevision: 1, mode: 'selected', models: [{ modelId: image, creditLimit: 10 }] }, 'unknown-below-committed'), 'canvas_agent_media_limit_below_committed');
    check((await DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).first()).n === 0, 'Inspection cannot invent a replacement usage attempt');
  } else if (name === 'text') {
    const row = await f.action('text', 20);
    check(JSON.stringify(await quoteCanvasMediaAction(env, f.owner, f.project, textModel, 20)) === '{}', 'Media restrictions do not claim text/reasoning authority');
    check(canvasMediaActionEnvironment(env, row, row.prepared) === env, 'A text action keeps its existing execution context');
    check((await f.claim(row)).meta.changes === 1, 'A selected media revision and zero image cap do not block a genuine text action');
    check(await f.cost(row) === null, 'Text is not silently charged against image/video/music limits');
  } else if (name === 'resume-outer' || name === 'resume-model') {
    await DB.prepare("UPDATE canvas_agent_runs SET status='running' WHERE id=?").bind(f.production).run();
    const step = await f.allocate('original-unstarted', 6);
    check((await DB.prepare('SELECT committed FROM canvas_agent_step_costs WHERE step_id=?').bind(step).first()).committed === 6, 'The ordinary active allocation initially holds six credits');
    await DB.prepare("UPDATE canvas_agent_runs SET status='blocked' WHERE id=?").bind(f.production).run();
    check((await DB.prepare('SELECT committed FROM canvas_agent_step_costs WHERE step_id=?').bind(step).first()).committed === 0, 'A blocked genuinely unstarted allocation releases headroom before the distinct approved variant');
    const row = await f.action('first', 6); await f.claim(row);
    const reserved = await f.reserve(row, await f.canvasRun(row)); await f.settle(reserved, 6);
    check((await f.cost(row)).charged === 6, 'The distinct original action is settled through the existing ledger before resume');
    await rejects(() => DB.prepare("UPDATE canvas_agent_runs SET status='running' WHERE id=?").bind(f.production).run(),
      name === 'resume-outer' ? 'canvas_agent_budget_exceeded' : 'canvas_agent_media_limit_exceeded');
    const stopped = await DB.prepare('SELECT status,budget_credits,media_policy_revision FROM canvas_agent_runs WHERE id=?').bind(f.production).first();
    check(stopped.status === 'blocked' && stopped.budget_credits === (name === 'resume-outer' ? 10 : 100) && stopped.media_policy_revision === 1,
      'Rejected readmission preserves the original cap, policy and blocked state atomically');
    check((await DB.prepare('SELECT status,usage_attempt_id FROM canvas_agent_steps WHERE id=?').bind(step).first()).usage_attempt_id === null,
      'Readmission cannot dispatch the original step or invent a usage identity');
    if (name === 'resume-outer') {
      // Independent owner/project avoids modifying the historical cap or
      // clearing allocations merely to reach the later allocation fence.
      const g = await fixture(base, 'outer-allocation'), action = await g.action('first', 6); await g.claim(action);
      await g.settle(await g.reserve(action, await g.canvasRun(action)), 6);
      await DB.prepare("UPDATE canvas_agent_runs SET status='running' WHERE id=?").bind(g.production).run();
      await rejects(() => g.allocate('over-remaining', 5), 'canvas_agent_budget_exceeded');
      await g.allocate('fits-remaining', 4);
      await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=100 WHERE project_id=?').bind(g.project).run();
      const briefing = await g.id('briefing');
      await DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,purpose,status,phase,expected_revision,budget_credits,
        next_attempt_at,created_at,updated_at,expires_at) VALUES(?,?,?,?,'{}','briefing','planning','planning',?,100,?,?,?,?)`)
        .bind(briefing, g.project, g.owner, briefing, g.revision, g.now, g.now, g.now, new Date(Date.now() + 3600000).toISOString()).run();
      await rejects(() => g.allocate('briefing-over-project', 1, briefing, 'plan'), 'canvas_agent_budget_exceeded');
      check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_steps WHERE run_id=?').bind(briefing).first()).n === 0,
        'A separate valid conversation allowance cannot exceed the outer cap already consumed by media and variant');
    }
  } else throw new Error('Unknown media action policy case');
  return { case: name, paidProviderCalls: 0 };
}
