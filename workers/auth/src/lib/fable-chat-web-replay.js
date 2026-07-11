export const FABLE_WEB_REPLAY_IDLE_TTL_MS = 300_000;
export const FABLE_WEB_REPLAY_PRUNING_VERSION = 1;

function normalizeCursor(row) {
  return {
    version: Math.max(1, Number(
      row?.version ?? row?.web_replay_pruning_version ?? 1
    )),
    prunedThroughTurnOrder: Math.max(
      -1,
      Number(
        row?.prunedThroughTurnOrder
        ?? row?.web_replay_pruned_through_turn_order
        ?? -1
      )
    ),
    prunedThroughMessageId: row?.prunedThroughMessageId
      ?? row?.web_replay_pruned_through_message_id
      ?? null,
    prunedAt: row?.prunedAt ?? row?.web_replay_pruned_at ?? null,
    inactivityMs: null,
    advanced: false,
  };
}

async function readConversationCursor(env, adminUserId, conversationId) {
  return env.DB.prepare(
    `SELECT web_replay_pruning_version, web_replay_pruned_through_turn_order,
            web_replay_pruned_through_message_id, web_replay_pruned_at
       FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
      LIMIT 1`
  ).bind(conversationId, adminUserId).first();
}

export function normalizeFableChatWebReplaySelection(value) {
  return normalizeCursor(value);
}

export async function getFableChatWebReplaySelection(
  env,
  adminUserId,
  conversationId,
  { nowMs = Date.now(), advanceIfIdle = false } = {}
) {
  const conversation = await readConversationCursor(env, adminUserId, conversationId);
  if (!conversation) return null;
  const current = normalizeCursor(conversation);
  if (!advanceIfIdle) return current;

  const previous = await env.DB.prepare(
    `SELECT t.completed_at, t.assistant_message_id, um.turn_order
       FROM fable_chat_turns t
       INNER JOIN fable_chat_conversations c ON c.id = t.conversation_id
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
        AND um.conversation_id = t.conversation_id AND um.admin_user_id = t.admin_user_id
        AND um.role = 'user'
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.status = 'succeeded'
        AND t.completed_at IS NOT NULL AND t.assistant_message_id IS NOT NULL
        AND c.admin_user_id = ? AND c.deleted_at IS NULL
      ORDER BY t.completed_at DESC, t.id DESC
      LIMIT 1`
  ).bind(conversationId, adminUserId, adminUserId).first();
  if (!previous) return current;

  const previousCompletedMs = Date.parse(previous.completed_at || "");
  if (!Number.isFinite(previousCompletedMs)) return current;
  const inactivityMs = Math.max(0, Number(nowMs) - previousCompletedMs);
  if (inactivityMs < FABLE_WEB_REPLAY_IDLE_TTL_MS) {
    return { ...current, inactivityMs };
  }

  const targetTurnOrder = Math.max(-1, Number(previous.turn_order ?? -1));
  if (targetTurnOrder <= current.prunedThroughTurnOrder) {
    return { ...current, inactivityMs };
  }
  const prunedAt = new Date(Number(nowMs)).toISOString();
  await env.DB.prepare(
    `UPDATE fable_chat_conversations
        SET web_replay_pruning_version = ?,
            web_replay_pruned_through_turn_order = ?,
            web_replay_pruned_through_message_id = ?,
            web_replay_pruned_at = ?
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL
        AND web_replay_pruned_through_turn_order < ?`
  ).bind(
    FABLE_WEB_REPLAY_PRUNING_VERSION,
    targetTurnOrder,
    previous.assistant_message_id,
    prunedAt,
    conversationId,
    adminUserId,
    targetTurnOrder
  ).run();
  const frozen = normalizeCursor(
    await readConversationCursor(env, adminUserId, conversationId)
  );
  return {
    ...frozen,
    inactivityMs,
    advanced: frozen.prunedThroughTurnOrder > current.prunedThroughTurnOrder,
  };
}
