// Native D1 control only; never part of the deployment candidate. All product
// imports below are real. Provider responses and actors are synthetic fixtures.
import { createMemoryFixture, memoryActor, memoryResult, seedMemoryTurn } from './q4-memory-fixture.mjs';
import { maintainFableChatMemory, getFableChatMemorySelection } from '../../workers/auth/src/lib/fable-chat-memory.js';
import { buildFableChatModelContext } from '../../workers/auth/src/lib/fable-chat.js';
import { invalidateFableChatAdminCheckpoint } from '../../workers/auth/src/lib/fable-chat-admin-data.js';
import { buildGrokChatModelContext } from '../../workers/auth/src/lib/grok-chat-context.js';

function readFence(DB, predicate, before) {
  let fired = false; const raw = new WeakMap();
  return { DB: { batch: statements => DB.batch(statements.map(statement => raw.get(statement) || statement)), prepare(sql) {
    const wrap = statement => { const wrapper = { bind: (...args) => wrap(statement.bind(...args)),
      first: (...args) => statement.first(...args), all: (...args) => statement.all(...args),
      async run() { if (!fired && predicate(sql)) { fired = true; await before(); } return statement.run(); } }; raw.set(wrapper, statement); return wrapper; };
    return wrap(DB.prepare(sql));
  } }, fired: () => fired };
}
async function scenario(DB, kind) {
  const model = kind === 'grok-selection' ? 'xai/grok-4.6' : 'anthropic/claude-fable-5';
  let f;
  f = await createMemoryFixture(DB, { model, provider: async body => {
    if (kind === 'late-edit') await f.edit();
    return memoryResult(body.profile);
  } });
  const maintain = () => maintainFableChatMemory(f.ctx, memoryActor, f.conversationId);
  const select = () => getFableChatMemorySelection(f.env, memoryActor.id, f.conversationId, 'standard');
  const context = selection => (kind === 'grok-selection' ? buildGrokChatModelContext : buildFableChatModelContext)(f.env, {
    adminUserId: memoryActor.id, conversationId: f.conversationId,
    currentMessage: 'Native next-turn context selection', memorySelection: selection,
  });
  let fence;
  if (kind === 'candidate-edit' || kind === 'running-edit') {
    fence = readFence(DB, sql => kind === 'candidate-edit' ? sql.includes('INSERT INTO fable_chat_memory_checkpoints') : sql.includes("SET status = 'running'"), () => f.edit());
    f.env.DB = fence.DB;
  }
  if (kind === 'batch-failure') await DB.prepare(`CREATE TRIGGER q4_native_memory_fail BEFORE UPDATE OF hidden_summary_content ON fable_chat_memory_checkpoints BEGIN SELECT RAISE(ABORT,'synthetic native memory finalization failure'); END;`).run();
  await maintain();
  if (kind === 'batch-failure') await DB.prepare('DROP TRIGGER q4_native_memory_fail').run();
  let ancestor = null;
  if (kind === 'ancestor-invalidation') {
    ancestor = await select();
    for (let order = 3; order < 5; order += 1) await seedMemoryTurn(DB, f.conversationId, order);
    await maintain();
    for (let order = 5; order < 7; order += 1) await seedMemoryTurn(DB, f.conversationId, order);
    await maintain();
  }
  const old = await select();
  if (ancestor) await invalidateFableChatAdminCheckpoint(f.env, {
    actorAdminUserId: memoryActor.id, conversationId: f.conversationId, checkpointId: ancestor.checkpointId,
    body: { expectedRevision: 0, reason: 'Native ancestor invalidation' }, idempotencyKey: 'q4-native-ancestor-invalidation',
  });
  if (kind === 'selection-edit' || kind === 'grok-selection') await f.edit();
  if (kind === 'append') await seedMemoryTurn(DB, f.conversationId, 3, { text: 'Native uncovered appended turn' });
  const next = await context(old);
  const text = JSON.stringify(next.messages);
  const row = await DB.prepare('SELECT id,status,hidden_summary_content,usage_json,provider_cost_usd_micros,source_admin_revision_version FROM fable_chat_memory_checkpoints WHERE conversation_id=? ORDER BY summary_version DESC LIMIT 1').bind(f.conversationId).first();
  const budget = row ? await DB.prepare('SELECT metadata_json FROM platform_budget_usage_events WHERE source_attempt_id=?').bind(row.id).first() : null;
  if (['batch-failure', 'append'].includes(kind)) await maintain();
  return { kind, conversationId: f.conversationId, checkpointId: row?.id || null,
    status: row?.status || null, sourceRevision: row?.source_admin_revision_version ?? null,
    providerCalls: f.calls.length, injected: fence?.fired() || false,
    hasStoredSummary: Boolean(row?.hidden_summary_content), appliedCheckpoint: next.memorySelection.checkpointId,
    keptOriginalCheckpoint: Boolean(old.checkpointId && next.memorySelection.checkpointId === old.checkpointId),
    hasEditedRaw: text.includes('CURRENT EDITED PREFIX'), hasAppendedRaw: text.includes('Native uncovered appended turn'),
    hasHiddenMemory: (next.system || text).includes('Q4 synthetic summary'),
    usage: row ? JSON.parse(row.usage_json) : {}, checkpointCostMicros: row?.provider_cost_usd_micros ?? null,
    budget: budget ? JSON.parse(budget.metadata_json) : null,
    bounded: kind === 'grok-selection' || next.context.estimatedInputTokens <= next.context.effectiveInputTokenLimit };
}
export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('x-q2-control') !== env.Q2_CONTROL_TOKEN) return new Response(null, { status: 403 });
    if (new URL(request.url).pathname !== '/q4-memory') return new Response(null, { status: 404 });
    const body = await request.json();
    if (body.action === 'seed-legacy') {
      const f = await createMemoryFixture(env.DB);
      return Response.json({ conversationId: f.conversationId, actorId: memoryActor.id });
    }
    const kinds = ['candidate-edit', 'running-edit', 'late-edit', 'selection-edit', 'grok-selection', 'append', 'batch-failure', 'ancestor-invalidation'];
    if (!kinds.includes(body.kind)) return new Response(null, { status: 400 });
    return Response.json(await scenario(env.DB, body.kind));
  },
};
