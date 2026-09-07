// Synthetic fixture construction shared by Node-SQLite and native D1 probes.
// No network/provider implementation is imported; callers supply a local D1 binding.
import { createFableChatConversation } from '../../workers/auth/src/lib/fable-chat.js';
import { editFableChatAdminMessage, reviseFableChatAdminTurn } from '../../workers/auth/src/lib/fable-chat-admin-data.js';
import { normalizeFableChatMemorySummary, calculateFableChatMemoryCostUsd } from '../../workers/shared/fable-chat-memory-contract.mjs';

export const memoryActor = { id: 'q4-memory-owner', email: 'q4-memory@example.test', role: 'admin' };
export const providerUsage = { input_tokens: 8000, output_tokens: 120, total_tokens: 8120 };
export const providerCost = calculateFableChatMemoryCostUsd(providerUsage).totalCostUsd;
export const fixedHex = n => Number(n).toString(16).padStart(32, '0');
export function memoryResult(profile = 'standard', marker = 'original-prefix') {
  const normalized = normalizeFableChatMemorySummary({
    version: 1, language: 'English', facts: [`Q4 synthetic summary ${marker}`], preferences: [], entities: [],
    dates_locations_numbers: [], decisions_commitments: [], open_items: [], constraints: [], corrections_uncertainties: [], sources: [],
  }, { mode: profile });
  return { ok: true, model: { id: '@cf/qwen/qwen3-30b-a3b-fp8' }, elapsedMs: 25,
    result: { summary: normalized.canonical, estimatedSummaryTokens: normalized.estimatedTokens,
      usage: providerUsage, providerCostUsd: providerCost } };
}
export async function seedMemoryTurn(DB, conversationId, order, { model = 'anthropic/claude-fable-5', text = null } = {}) {
  const identity = n => conversationId.slice(4, 20) + fixedHex(n).slice(-16);
  const ids = { userMessageId: `fbm_${identity(order + 1)}`, assistantMessageId: `fbm_${identity(order + 10001)}`, turnId: `fbt_${identity(order + 20001)}` };
  const at = new Date(Date.UTC(2026, 8, 7, 8, 0, order)).toISOString();
  await DB.batch([
    DB.prepare(`INSERT INTO fable_chat_messages (id,conversation_id,message_group_id,admin_user_id,turn_order,role,role_order,content,state,model_id,metadata_json,created_at,updated_at)
      VALUES (?,?,?, ?,?,'user',0,?,'succeeded',NULL,'{}',?,?)`).bind(ids.userMessageId,conversationId,`fbg_${identity(order+30001)}`,memoryActor.id,order,text || `original-user-${order} ${'u'.repeat(5980)}`,at,at),
    DB.prepare(`INSERT INTO fable_chat_messages (id,conversation_id,message_group_id,admin_user_id,turn_order,role,role_order,content,state,model_id,metadata_json,citations_json,created_at,updated_at)
      VALUES (?,?,?, ?,?,'assistant',1,?,'succeeded',?,'{}','[]',?,?)`).bind(ids.assistantMessageId,conversationId,`fbg_${identity(order+30001)}`,memoryActor.id,order,text || `original-assistant-${order} ${'a'.repeat(5980)}`,model,at,at),
    DB.prepare(`INSERT INTO fable_chat_turns (id,conversation_id,admin_user_id,idempotency_key_hash,request_fingerprint,user_message_id,assistant_message_id,status,model_id,created_at,updated_at,completed_at,expires_at)
      VALUES (?,?,?,?,?,?,?,'succeeded',?,?,?,?,?)`).bind(ids.turnId,conversationId,memoryActor.id,`synthetic-key-${order}`,`synthetic-fingerprint-${order}`,ids.userMessageId,ids.assistantMessageId,model,at,at,at,'2030-01-01T00:00:00Z'),
    DB.prepare('UPDATE fable_chat_conversations SET turn_count=MAX(turn_count,?),updated_at=? WHERE id=? AND admin_user_id=?').bind(order+1,at,conversationId,memoryActor.id),
  ]);
  return ids;
}
export async function createMemoryFixture(DB, { provider = null, model = 'anthropic/claude-fable-5', mode = 'standard', tailText = null } = {}) {
  const at = new Date().toISOString();
  await DB.prepare(`INSERT OR IGNORE INTO users(id,email,password_hash,status,role,created_at,updated_at,email_verified_at) VALUES (?,?,'unused','active','admin',?,?,?)`).bind(memoryActor.id,memoryActor.email,at,at,at).run();
  await DB.prepare(`INSERT OR IGNORE INTO admin_runtime_budget_switches (switch_key,enabled,reason,metadata_json,created_at,updated_at) VALUES ('ENABLE_ADMIN_AI_TEXT_BUDGET',1,'synthetic fixture','{}',?,?)`).bind(at,at).run();
  for (const window of ['daily','monthly']) await DB.prepare(`INSERT OR IGNORE INTO platform_budget_limits(id,budget_scope,window_type,limit_units,mode,status,reason,metadata_json,created_at,updated_at) VALUES (?,'platform_admin_lab_budget',?,10000,'enforce','active','synthetic fixture','{}',?,?)`).bind(`q4-memory-${window}`,window,at,at).run();
  const calls = [];
  const env = { DB, BITBI_ENV: 'test', ENABLE_ADMIN_AI_TEXT_BUDGET: 'true', AI_SERVICE_AUTH_SECRET: 'q4-synthetic-service-auth-secret-32-chars',
    AI_LAB: { async fetch(request) {
      if (new URL(request.url).pathname !== '/internal/ai/fable-chat/memory') throw new Error('Unexpected synthetic provider path');
      const body = await request.json(); calls.push(body);
      const result = provider ? await provider(body, calls.length) : memoryResult(body.profile);
      return result instanceof Response ? result : Response.json(result);
    } } };
  const conversation = await createFableChatConversation(env,memoryActor.id,{ model, memoryMode: mode });
  const turns = [];
  for (let order=0;order<3;order+=1) turns.push(await seedMemoryTurn(DB,conversation.id,order,{model,text:order === 2 ? tailText : null}));
  const ctx = { env, correlationId: 'q4-memory-synthetic', request: new Request('https://example.test/api/admin/fable-chat/messages'), pathname: '/api/admin/fable-chat/messages', method: 'POST' };
  return { env, ctx, calls, conversationId: conversation.id, turns,
    async edit(order=0, revision=0) { return editFableChatAdminMessage(env,{
      actorAdminUserId:memoryActor.id,conversationId:conversation.id,messageId:turns[order].userMessageId,
      body:{expectedRevision:revision,expectedMessageRevision:0,reason:'Q4 synthetic edit',content:'CURRENT EDITED PREFIX'},idempotencyKey:`q4-memory-edit-${conversation.id}-${order}-${revision}`,
    }); },
    async deleteTurn(order=0, revision=0) { return reviseFableChatAdminTurn(env,{
      actorAdminUserId:memoryActor.id,conversationId:conversation.id,turnId:turns[order].turnId,action:'delete',
      body:{expectedRevision:revision,expectedTurnRevision:0,reason:'Q4 synthetic delete'},idempotencyKey:`q4-memory-delete-${conversation.id}-${order}-${revision}`,
    }); },
  };
}
