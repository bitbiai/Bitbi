import { enqueueAdminAuditEvent } from "../lib/activity.js";
import {
  FableChatAdminDataError,
  editFableChatAdminMessage,
  getFableChatAdminAuditMetadata,
  getFableChatAdminConversationDetail,
  getFableChatAdminOverview,
  getFableChatAdminWebSearch,
  inspectFableChatAdminRawRecord,
  invalidateFableChatAdminCheckpoint,
  listFableChatAdminAttempts,
  listFableChatAdminBudgetUsage,
  listFableChatAdminCheckpoints,
  listFableChatAdminConversations,
  listFableChatAdminTranscript,
  mutateFableChatAdminConversation,
  normalizeAdminFableCheckpointId,
  normalizeAdminFableConversationId,
  normalizeAdminFableMessageId,
  normalizeAdminFableTurnId,
  purgeFableChatAdminConversation,
  revealFableChatAdminCheckpointSummary,
  reviseFableChatAdminTurn,
} from "../lib/fable-chat-admin-data.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import { BODY_LIMITS, readJsonBodyOrResponse } from "../lib/request.js";
import { json } from "../lib/response.js";
import { requireAdmin } from "../lib/session.js";
import { withCorrelationId } from "../../../../js/shared/worker-observability.mjs";

const PREFIX = "/api/admin/fable-chat-data";

// release-route: GET /api/admin/fable-chat-data/overview
// release-route: GET /api/admin/fable-chat-data/conversations
// release-route: GET /api/admin/fable-chat-data/conversations/:id
// release-route: PATCH /api/admin/fable-chat-data/conversations/:id
// release-route: GET /api/admin/fable-chat-data/conversations/:id/transcript
// release-route: GET /api/admin/fable-chat-data/conversations/:id/attempts
// release-route: GET /api/admin/fable-chat-data/conversations/:id/checkpoints
// release-route: GET /api/admin/fable-chat-data/conversations/:id/web-search
// release-route: GET /api/admin/fable-chat-data/conversations/:id/usage
// release-route: PATCH /api/admin/fable-chat-data/conversations/:id/messages/:id
// release-route: POST /api/admin/fable-chat-data/conversations/:id/turns/:id/delete
// release-route: POST /api/admin/fable-chat-data/conversations/:id/turns/:id/restore
// release-route: POST /api/admin/fable-chat-data/conversations/:id/checkpoints/:id/invalidate
// release-route: POST /api/admin/fable-chat-data/conversations/:id/checkpoints/:id/reveal
// release-route: GET /api/admin/fable-chat-data/conversations/:id/records/:kind/:id
// release-route: POST /api/admin/fable-chat-data/conversations/:id/purge

function correlated(response, correlationId) {
  return withCorrelationId(response, correlationId);
}

function notFound(correlationId) {
  return correlated(json({ ok: false, error: "Not found.", code: "not_found" }, { status: 404 }), correlationId);
}

async function rateLimit(ctx, adminUserId, operation, { write = false } = {}) {
  const options = sensitiveRateLimitOptions({
    component: "admin-fable-chat-data",
    correlationId: ctx.correlationId,
    requestInfo: { request: ctx.request, pathname: ctx.pathname, method: ctx.method },
  });
  const windowMs = 10 * 60_000;
  for (const [scope, key, max] of [
    [`admin-fable-chat-data-${operation}-admin`, adminUserId, write ? 40 : 180],
    [`admin-fable-chat-data-${operation}-ip`, getClientIp(ctx.request), write ? 80 : 360],
  ]) {
    const result = await evaluateSharedRateLimit(ctx.env, scope, key, max, windowMs, options);
    if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId);
    if (result.limited) return rateLimitResponse();
  }
  return null;
}

async function readBody(request, correlationId) {
  const parsed = await readJsonBodyOrResponse(request, {
    maxBytes: BODY_LIMITS.adminJson,
    requiredContentType: true,
  });
  return parsed.response
    ? { body: null, response: correlated(parsed.response, correlationId) }
    : { body: parsed.body, response: null };
}

function queryInput(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function idempotencyKey(request) {
  return request.headers.get("Idempotency-Key") || "";
}

function audit(ctx, adminUser, action, result) {
  const promise = enqueueAdminAuditEvent(ctx.env, {
    adminUserId: adminUser.id,
    action,
    targetUserId: null,
    meta: getFableChatAdminAuditMetadata(result),
  }, {
    correlationId: ctx.correlationId,
    requestInfo: { request: ctx.request, pathname: ctx.pathname, method: ctx.method },
  });
  if (ctx.execCtx?.waitUntil) ctx.execCtx.waitUntil(promise);
  else promise.catch(() => {});
}

function errorResponse(error, correlationId) {
  if (!(error instanceof FableChatAdminDataError) && error?.name !== "FableChatAdminDataError") {
    return null;
  }
  return correlated(json({ ok: false, error: error.message, code: error.code }, {
    status: error.status,
  }), correlationId);
}

async function writeRoute(ctx, admin, callback, auditAction) {
  const limited = await rateLimit(ctx, admin.user.id, "write", { write: true });
  if (limited) return correlated(limited, ctx.correlationId);
  const parsed = await readBody(ctx.request, ctx.correlationId);
  if (parsed.response) return parsed.response;
  const result = await callback(parsed.body || {});
  audit(ctx, admin.user, auditAction, result);
  return correlated(json({ ok: true, result }), ctx.correlationId);
}

export async function handleAdminFableChatData(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return null;
  const admin = await requireAdmin(request, env, { isSecure, correlationId });
  if (admin instanceof Response) return admin;

  try {
    if (pathname === `${PREFIX}/overview` && method === "GET") {
      const limited = await rateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      return correlated(json({ ok: true, statistics: await getFableChatAdminOverview(env) }), correlationId);
    }
    if (pathname === `${PREFIX}/conversations` && method === "GET") {
      const limited = await rateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      return correlated(json({
        ok: true,
        ...(await listFableChatAdminConversations(env, queryInput(url))),
      }), correlationId);
    }

    const conversationMatch = pathname.match(/^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)$/);
    if (conversationMatch) {
      const conversationId = normalizeAdminFableConversationId(conversationMatch[1]);
      if (method === "GET") {
        const limited = await rateLimit(ctx, admin.user.id, "read");
        if (limited) return correlated(limited, correlationId);
        const detail = await getFableChatAdminConversationDetail(env, conversationId);
        return detail ? correlated(json({ ok: true, ...detail }), correlationId) : notFound(correlationId);
      }
      // route-policy: admin.fable-chat-data.conversation.update
      if (method === "PATCH") {
        return await writeRoute(ctx, admin, async (body) => mutateFableChatAdminConversation(env, {
          actorAdminUserId: admin.user.id, conversationId,
          operation: String(body.operation || ""), body,
          idempotencyKey: idempotencyKey(request),
        }), "fable_chat_admin_conversation_updated");
      }
    }

    const collectionMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/(transcript|attempts|checkpoints|web-search|usage)$/
    );
    if (collectionMatch && method === "GET") {
      const limited = await rateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      const conversationId = normalizeAdminFableConversationId(collectionMatch[1]);
      const kind = collectionMatch[2];
      const input = queryInput(url);
      const result = kind === "transcript"
        ? await listFableChatAdminTranscript(env, conversationId, input)
        : kind === "attempts"
          ? await listFableChatAdminAttempts(env, conversationId, input)
          : kind === "checkpoints"
            ? await listFableChatAdminCheckpoints(env, conversationId, input)
            : kind === "web-search"
              ? await getFableChatAdminWebSearch(env, conversationId)
              : await listFableChatAdminBudgetUsage(env, conversationId, input);
      return result ? correlated(json({ ok: true, ...result }), correlationId) : notFound(correlationId);
    }

    const messageMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/messages\/([^/]+)$/
    );
    // route-policy: admin.fable-chat-data.message.update
    if (messageMatch && method === "PATCH") {
      const conversationId = normalizeAdminFableConversationId(messageMatch[1]);
      const messageId = normalizeAdminFableMessageId(messageMatch[2]);
      return await writeRoute(ctx, admin, async (body) => editFableChatAdminMessage(env, {
        actorAdminUserId: admin.user.id, conversationId, messageId, body,
        idempotencyKey: idempotencyKey(request),
      }), "fable_chat_admin_message_revised");
    }

    const turnDeleteMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/turns\/([^/]+)\/delete$/
    );
    // route-policy: admin.fable-chat-data.turn.delete
    if (turnDeleteMatch && method === "POST") {
      const conversationId = normalizeAdminFableConversationId(turnDeleteMatch[1]);
      const turnId = normalizeAdminFableTurnId(turnDeleteMatch[2]);
      return await writeRoute(ctx, admin, async (body) => reviseFableChatAdminTurn(env, {
        actorAdminUserId: admin.user.id, conversationId, turnId, action: "delete", body,
        idempotencyKey: idempotencyKey(request),
      }), "fable_chat_admin_turn_deleted");
    }
    const turnRestoreMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/turns\/([^/]+)\/restore$/
    );
    // route-policy: admin.fable-chat-data.turn.restore
    if (turnRestoreMatch && method === "POST") {
      const conversationId = normalizeAdminFableConversationId(turnRestoreMatch[1]);
      const turnId = normalizeAdminFableTurnId(turnRestoreMatch[2]);
      return await writeRoute(ctx, admin, async (body) => reviseFableChatAdminTurn(env, {
        actorAdminUserId: admin.user.id, conversationId, turnId, action: "restore", body,
        idempotencyKey: idempotencyKey(request),
      }), "fable_chat_admin_turn_restored");
    }

    const checkpointInvalidateMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/checkpoints\/([^/]+)\/invalidate$/
    );
    // route-policy: admin.fable-chat-data.checkpoint.invalidate
    if (checkpointInvalidateMatch && method === "POST") {
      const conversationId = normalizeAdminFableConversationId(checkpointInvalidateMatch[1]);
      const checkpointId = normalizeAdminFableCheckpointId(checkpointInvalidateMatch[2]);
      return await writeRoute(ctx, admin, async (body) => invalidateFableChatAdminCheckpoint(env, {
        actorAdminUserId: admin.user.id, conversationId, checkpointId, body,
        idempotencyKey: idempotencyKey(request),
      }), "fable_chat_admin_checkpoint_invalidated");
    }

    const checkpointRevealMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/checkpoints\/([^/]+)\/reveal$/
    );
    // route-policy: admin.fable-chat-data.checkpoint.reveal
    if (checkpointRevealMatch && method === "POST") {
      const limited = await rateLimit(ctx, admin.user.id, "reveal");
      if (limited) return correlated(limited, correlationId);
      const result = await revealFableChatAdminCheckpointSummary(
        env,
        normalizeAdminFableConversationId(checkpointRevealMatch[1]),
        normalizeAdminFableCheckpointId(checkpointRevealMatch[2])
      );
      if (!result) return notFound(correlationId);
      audit(ctx, admin.user, "fable_chat_admin_hidden_summary_revealed", {
        operation: "checkpoint_reveal",
        conversationId: checkpointRevealMatch[1],
        checkpointId: checkpointRevealMatch[2],
      });
      return correlated(json({ ok: true, ...result }), correlationId);
    }

    const rawMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/records\/([^/]+)\/([^/]+)$/
    );
    if (rawMatch && method === "GET") {
      const limited = await rateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      const result = await inspectFableChatAdminRawRecord(
        env, normalizeAdminFableConversationId(rawMatch[1]), rawMatch[2], rawMatch[3]
      );
      return result ? correlated(json({ ok: true, ...result }), correlationId) : notFound(correlationId);
    }

    const purgeMatch = pathname.match(
      /^\/api\/admin\/fable-chat-data\/conversations\/([^/]+)\/purge$/
    );
    // route-policy: admin.fable-chat-data.conversation.purge
    if (purgeMatch && method === "POST") {
      const conversationId = normalizeAdminFableConversationId(purgeMatch[1]);
      return await writeRoute(ctx, admin, async (body) => purgeFableChatAdminConversation(env, {
        actorAdminUserId: admin.user.id, conversationId, body,
        idempotencyKey: idempotencyKey(request),
      }), "fable_chat_admin_conversation_purged");
    }

    return null;
  } catch (error) {
    const response = errorResponse(error, correlationId);
    if (response) return response;
    throw error;
  }
}
