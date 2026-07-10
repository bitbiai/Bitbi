import { enqueueAdminAuditEvent } from "../lib/activity.js";
import {
  admitFableChatBudgetUsage,
  FABLE_CHAT_INTERNAL_PATH,
  prepareFableChatBudget,
} from "../lib/fable-chat-budget.js";
import {
  FABLE_CHAT_MODEL_ID,
  FableChatError,
  beginFableChatTurn,
  buildFableChatModelContext,
  buildFableChatRequestFingerprint,
  createFableChatConversation,
  deleteFableChatConversation,
  expireFableChatTurnIfStale,
  expireStaleFableChatTurns,
  finalizeFableChatTurn,
  getFableChatConversation,
  getFableChatTurnByIdempotencyKey,
  getFableChatTurnResult,
  listFableChatConversations,
  listFableChatMessages,
  markFableChatTurnFailed,
  markFableChatTurnRunning,
  markFableChatTurnUnknown,
  normalizeFableChatConversationId,
  normalizeFableChatIdempotencyKey,
  renameFableChatConversation,
  validateCreateFableChatBody,
  validateRenameFableChatBody,
  validateSendFableChatBody,
} from "../lib/fable-chat.js";
import { proxyToAiLab } from "../lib/admin-ai-proxy.js";
import {
  AdminPlatformBudgetSwitchError,
} from "../lib/admin-platform-budget-switches.js";
import { PaginationValidationError } from "../lib/pagination.js";
import { PlatformBudgetCapError } from "../lib/platform-budget-caps.js";
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
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

const ROUTE_PREFIX = "/api/admin/fable-chat";

function correlated(response, correlationId) {
  return withCorrelationId(response, correlationId);
}

function notFound(correlationId) {
  return correlated(json({
    ok: false,
    error: "Not found",
    code: "not_found",
  }, { status: 404 }), correlationId);
}

function publicFailureType(code) {
  const value = String(code || "").toLowerCase();
  if (value.includes("rate") || value.includes("limit") || value.includes("cap_exceeded")) {
    return "rate_limited";
  }
  if (value.includes("timeout")) return "request_timeout";
  if (value.includes("interrupted")) return "interrupted";
  if (value.includes("unified_billing") || value.includes("upstream") || value.includes("provider")) {
    return "provider_unavailable";
  }
  return "generation_failed";
}

function failedTurnResponse(turn, correlationId, { status = 409 } = {}) {
  const failureType = publicFailureType(turn?.errorCode);
  const messages = {
    rate_limited: "Chat is temporarily rate limited. Retry with a new request.",
    request_timeout: "The response timed out. Retry with a new request.",
    interrupted: "The previous request was interrupted. Retry with a new request.",
    provider_unavailable: "Claude Fable is temporarily unavailable. Retry with a new request.",
    generation_failed: "The response could not be completed. Retry with a new request.",
  };
  return correlated(json({
    ok: false,
    error: messages[failureType],
    code: "fable_chat_turn_failed",
    failureType,
    retryable: true,
    retryMessageId: turn?.userMessageId || null,
    turn: turn ? { id: turn.id, status: "failed" } : null,
  }, { status }), correlationId);
}

function inProgressResponse(turn, correlationId) {
  return correlated(json({
    ok: false,
    error: "This message is already being processed.",
    code: "fable_chat_message_in_progress",
    retryable: false,
    turn: turn ? { id: turn.id, status: turn.status } : null,
  }, {
    status: 409,
    headers: { "retry-after": "3" },
  }), correlationId);
}

function unknownTurnResponse(turn, correlationId, { status = 409 } = {}) {
  return correlated(json({
    ok: false,
    error: "The provider outcome is unknown. This message cannot be retried automatically.",
    code: "fable_chat_provider_outcome_unknown",
    failureType: "provider_outcome_unknown",
    retryable: false,
    turn: turn ? { id: turn.id, status: "unknown" } : null,
  }, { status }), correlationId);
}

function contextForBrowser(context) {
  return {
    olderTurnsOmitted: context?.olderTurnsOmitted === true,
    omittedTurns: Number(context?.omittedTurns || 0),
  };
}

async function successResponse(env, adminUserId, conversationId, result, correlationId, {
  replayed = false,
} = {}) {
  const conversation = await getFableChatConversation(env, adminUserId, conversationId);
  if (!conversation || !result) return notFound(correlationId);
  return correlated(json({
    ok: true,
    conversation,
    turn: result.turn,
    messages: result.messages,
    context: contextForBrowser(result.context),
    idempotentReplay: replayed,
  }), correlationId);
}

function fableChatErrorResponse(error, correlationId) {
  if (error instanceof PaginationValidationError) {
    return correlated(json({
      ok: false,
      error: "Invalid cursor.",
      code: "validation_error",
    }, { status: 400 }), correlationId);
  }
  if (error instanceof FableChatError) {
    return correlated(json({
      ok: false,
      error: error.message,
      code: error.code,
    }, { status: error.status }), correlationId);
  }
  if (error instanceof PlatformBudgetCapError) {
    const exceeded = error.code === "platform_budget_cap_exceeded";
    return correlated(json({
      ok: false,
      error: exceeded
        ? "Chat is temporarily rate limited. Please try again later."
        : "Chat budget controls are temporarily unavailable.",
      code: exceeded ? "rate_limited" : "fable_chat_budget_unavailable",
    }, { status: exceeded ? 429 : 503 }), correlationId);
  }
  if (error instanceof AdminPlatformBudgetSwitchError) {
    return correlated(json({
      ok: false,
      error: "Chat is currently unavailable.",
      code: "fable_chat_disabled",
    }, { status: error.status || 503 }), correlationId);
  }
  return null;
}

async function readChatJsonBody(request, correlationId) {
  const parsed = await readJsonBodyOrResponse(request, {
    maxBytes: BODY_LIMITS.fableChatJson,
    requiredContentType: true,
  });
  if (parsed.response) {
    return { body: null, response: correlated(parsed.response, correlationId) };
  }
  return { body: parsed.body, response: null };
}

async function enforceFableChatRateLimit(ctx, adminUserId, operation, {
  adminMax = 60,
  ipMax = 120,
  windowMs = 10 * 60_000,
} = {}) {
  const ip = getClientIp(ctx.request);
  const requestInfo = { request: ctx.request, pathname: ctx.pathname, method: ctx.method };
  for (const [scope, key, maxRequests] of [
    [`admin-fable-chat-${operation}-admin`, adminUserId, adminMax],
    [`admin-fable-chat-${operation}-ip`, ip, ipMax],
  ]) {
    const result = await evaluateSharedRateLimit(
      ctx.env,
      scope,
      key,
      maxRequests,
      windowMs,
      sensitiveRateLimitOptions({
        component: "admin-fable-chat",
        correlationId: ctx.correlationId,
        requestInfo,
      })
    );
    if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId);
    if (result.limited) return rateLimitResponse();
  }
  return null;
}

function auditFableChat(ctx, adminUser, action, {
  conversationId = null,
  turnId = null,
  status = null,
  contextOmittedTurns = null,
} = {}) {
  const promise = enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      meta: {
        conversation_id: conversationId,
        turn_id: turnId,
        status,
        model_id: FABLE_CHAT_MODEL_ID,
        context_omitted_turns: contextOmittedTurns,
      },
    },
    {
      correlationId: ctx.correlationId,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
  if (ctx.execCtx?.waitUntil) ctx.execCtx.waitUntil(promise);
}

async function handleExistingSend(ctx, adminUser, conversationId, turn, requestFingerprint) {
  const { env, correlationId } = ctx;
  if (turn.requestFingerprint !== requestFingerprint) {
    throw new FableChatError("Idempotency-Key conflicts with a different chat request.", {
      status: 409,
      code: "idempotency_conflict",
    });
  }
  const current = await expireFableChatTurnIfStale(env, turn);
  if (turn.status !== "unknown" && current.status === "unknown") {
    auditFableChat(ctx, adminUser, "fable_chat_message_outcome_unknown", {
      conversationId,
      turnId: current.id,
      status: "unknown",
    });
  }
  if (current.status === "succeeded") {
    const result = await getFableChatTurnResult(env, adminUser.id, conversationId, current.id);
    return successResponse(env, adminUser.id, conversationId, result, correlationId, {
      replayed: true,
    });
  }
  if (current.status === "failed") return failedTurnResponse(current, correlationId);
  if (current.status === "unknown") return unknownTurnResponse(current, correlationId);
  return inProgressResponse(current, correlationId);
}

async function handleSend(ctx, adminUser, conversationId) {
  const { request, env, correlationId } = ctx;
  const parsed = await readChatJsonBody(request, correlationId);
  if (parsed.response) return parsed.response;
  const input = validateSendFableChatBody(parsed.body);
  const idempotencyKey = normalizeFableChatIdempotencyKey(request.headers.get("Idempotency-Key"));
  const requestFingerprint = await buildFableChatRequestFingerprint({
    conversationId,
    message: input.message,
    retryMessageId: input.retryMessageId,
  });
  const expiredTurns = await expireStaleFableChatTurns(env, adminUser.id, conversationId);
  for (const expiredTurn of expiredTurns) {
    auditFableChat(ctx, adminUser, "fable_chat_message_outcome_unknown", {
      conversationId,
      turnId: expiredTurn.id,
      status: "unknown",
    });
  }
  const existing = await getFableChatTurnByIdempotencyKey(
    env,
    adminUser.id,
    conversationId,
    idempotencyKey
  );
  if (existing) {
    return handleExistingSend(ctx, adminUser, conversationId, existing, requestFingerprint);
  }

  const limited = await enforceFableChatRateLimit(ctx, adminUser.id, "send", {
    adminMax: 30,
    ipMax: 60,
  });
  if (limited) return correlated(limited, correlationId);

  const budget = await prepareFableChatBudget({
    env,
    adminUser,
    conversationId,
    message: input.message,
    retryMessageId: input.retryMessageId,
    requestFingerprint,
    correlationId,
  });
  const attempt = await beginFableChatTurn(env, {
    adminUserId: adminUser.id,
    conversationId,
    idempotencyKey,
    requestFingerprint,
    message: input.message,
    retryMessageId: input.retryMessageId,
  });
  if (attempt.kind !== "created") {
    return handleExistingSend(
      ctx,
      adminUser,
      conversationId,
      attempt.turn,
      requestFingerprint
    );
  }

  let turn = attempt.turn;
  let finalized = false;
  let providerStarted = false;
  try {
    await admitFableChatBudgetUsage({
      env,
      adminUserId: adminUser.id,
      turnId: turn.id,
      idempotencyKeyHash: turn.idempotencyKeyHash,
      requestFingerprint,
      units: budget.units,
    });
    turn = await markFableChatTurnRunning(env, turn.id);
    const modelContext = await buildFableChatModelContext(env, {
      adminUserId: adminUser.id,
      conversationId,
      currentMessage: input.message,
    });
    providerStarted = true;
    const providerResponse = await proxyToAiLab(
      env,
      FABLE_CHAT_INTERNAL_PATH,
      {
        method: "POST",
        body: {
          messages: modelContext.messages,
          system: modelContext.system,
          maxTokens: modelContext.maxTokens,
        },
        callerPolicy: budget.callerPolicy,
      },
      adminUser,
      correlationId,
      ctx
    );
    let providerBody = null;
    try {
      providerBody = await providerResponse.clone().json();
    } catch {
      providerBody = null;
    }
    if (!providerResponse.ok || providerBody?.ok !== true) {
      const errorCode = providerBody?.code || `provider_status_${providerResponse.status}`;
      const unknownOutcome = providerResponse.status >= 500;
      turn = unknownOutcome
        ? await markFableChatTurnUnknown(env, turn.id, errorCode)
        : await markFableChatTurnFailed(env, turn.id, errorCode);
      auditFableChat(ctx, adminUser, unknownOutcome
        ? "fable_chat_message_outcome_unknown"
        : "fable_chat_message_failed", {
        conversationId,
        turnId: turn.id,
        status: turn.status,
      });
      return unknownOutcome
        ? unknownTurnResponse(turn, correlationId, {
            status: [502, 503, 504].includes(providerResponse.status)
              ? providerResponse.status
              : 503,
          })
        : failedTurnResponse(turn, correlationId, {
        status: [429, 502, 503, 504].includes(providerResponse.status)
          ? providerResponse.status
          : 502,
      });
    }
    const result = await finalizeFableChatTurn(env, turn.id, {
      assistantContent: providerBody?.result?.text,
      context: modelContext.context,
      providerModel: providerBody?.result?.responseModel || providerBody?.model?.id || null,
      stopReason: providerBody?.result?.stopReason || null,
      stopSequence: providerBody?.result?.stopSequence || null,
      usage: providerBody?.result?.usage || null,
      gatewayMetadata: providerBody?.result?.gatewayMetadata || null,
    });
    finalized = true;
    turn = result.turn;
    auditFableChat(ctx, adminUser, "fable_chat_message_succeeded", {
      conversationId,
      turnId: turn.id,
      status: "succeeded",
      contextOmittedTurns: result.context.omittedTurns,
    });
    return successResponse(env, adminUser.id, conversationId, result, correlationId);
  } catch (error) {
    if (!finalized) {
      try {
        turn = providerStarted
          ? await markFableChatTurnUnknown(
              env,
              turn.id,
              error?.code || "provider_outcome_unknown"
            )
          : await markFableChatTurnFailed(env, turn.id, error?.code || "generation_failed");
      } catch {
        // The original failure is reported without exposing a secondary persistence error.
      }
      auditFableChat(ctx, adminUser, providerStarted
        ? "fable_chat_message_outcome_unknown"
        : "fable_chat_message_failed", {
        conversationId,
        turnId: turn?.id || attempt.turn.id,
        status: providerStarted ? "unknown" : "failed",
      });
      if (providerStarted && turn?.status === "unknown") {
        return unknownTurnResponse(turn, correlationId, {
          status: Number(error?.status) === 504 ? 504 : 503,
        });
      }
    }
    throw error;
  }
}

export async function handleAdminFableChat(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;

  const admin = await requireAdmin(request, env, { isSecure, correlationId });
  if (admin instanceof Response) return admin;

  try {
    if (pathname === `${ROUTE_PREFIX}/conversations` && method === "GET") {
      const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      const page = await listFableChatConversations(env, admin.user.id, {
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
      });
      return correlated(json({ ok: true, ...page }), correlationId);
    }

    // route-policy: admin.fable-chat.conversations.create
    if (pathname === `${ROUTE_PREFIX}/conversations` && method === "POST") {
      const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "write", {
        adminMax: 40,
        ipMax: 80,
      });
      if (limited) return correlated(limited, correlationId);
      const parsed = await readChatJsonBody(request, correlationId);
      if (parsed.response) return parsed.response;
      validateCreateFableChatBody(parsed.body);
      const conversation = await createFableChatConversation(env, admin.user.id);
      auditFableChat(ctx, admin.user, "fable_chat_conversation_created", {
        conversationId: conversation.id,
        status: "created",
      });
      return correlated(json({ ok: true, conversation }, { status: 201 }), correlationId);
    }

    const messageMatch = pathname.match(/^\/api\/admin\/fable-chat\/conversations\/([^/]+)\/messages$/);
    // route-policy: admin.fable-chat.messages.send
    if (messageMatch && method === "POST") {
      return await handleSend(ctx, admin.user, normalizeFableChatConversationId(messageMatch[1]));
    }

    const conversationMatch = pathname.match(/^\/api\/admin\/fable-chat\/conversations\/([^/]+)$/);
    if (!conversationMatch) return null;
    const conversationId = normalizeFableChatConversationId(conversationMatch[1]);

    if (method === "GET") {
      const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "read");
      if (limited) return correlated(limited, correlationId);
      const expiredTurns = await expireStaleFableChatTurns(env, admin.user.id, conversationId);
      for (const expiredTurn of expiredTurns) {
        auditFableChat(ctx, admin.user, "fable_chat_message_outcome_unknown", {
          conversationId,
          turnId: expiredTurn.id,
          status: "unknown",
        });
      }
      const page = await listFableChatMessages(env, admin.user.id, conversationId, {
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
      });
      if (!page) return notFound(correlationId);
      return correlated(json({ ok: true, ...page }), correlationId);
    }

    // route-policy: admin.fable-chat.conversations.rename
    if (method === "PATCH") {
      const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "write", {
        adminMax: 60,
        ipMax: 120,
      });
      if (limited) return correlated(limited, correlationId);
      const parsed = await readChatJsonBody(request, correlationId);
      if (parsed.response) return parsed.response;
      const input = validateRenameFableChatBody(parsed.body);
      const conversation = await renameFableChatConversation(
        env,
        admin.user.id,
        conversationId,
        input.title
      );
      if (!conversation) return notFound(correlationId);
      auditFableChat(ctx, admin.user, "fable_chat_conversation_renamed", {
        conversationId,
        status: "renamed",
      });
      return correlated(json({ ok: true, conversation }), correlationId);
    }

    // route-policy: admin.fable-chat.conversations.delete
    if (method === "DELETE") {
      const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "write", {
        adminMax: 40,
        ipMax: 80,
      });
      if (limited) return correlated(limited, correlationId);
      const expiredTurns = await expireStaleFableChatTurns(env, admin.user.id, conversationId);
      for (const expiredTurn of expiredTurns) {
        auditFableChat(ctx, admin.user, "fable_chat_message_outcome_unknown", {
          conversationId,
          turnId: expiredTurn.id,
          status: "unknown",
        });
      }
      const deleted = await deleteFableChatConversation(env, admin.user.id, conversationId);
      if (!deleted) return notFound(correlationId);
      if (deleted.active) {
        throw new FableChatError("A message is still being processed.", {
          status: 409,
          code: "fable_chat_message_in_progress",
        });
      }
      auditFableChat(ctx, admin.user, "fable_chat_conversation_deleted", {
        conversationId,
        status: "deleted",
      });
      return correlated(json({ ok: true, deleted: true }), correlationId);
    }

    return null;
  } catch (error) {
    const expected = fableChatErrorResponse(error, correlationId);
    if (expected) return expected;
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-fable-chat",
      event: "admin_fable_chat_request_failed",
      level: "error",
      correlationId,
      admin_user_id: admin.user.id,
      ...getRequestLogFields({ request, pathname, method }),
      ...getErrorFields(error, { includeMessage: false }),
    });
    return correlated(json({
      ok: false,
      error: "Chat is temporarily unavailable.",
      code: "fable_chat_unavailable",
    }, { status: 503 }), correlationId);
  }
}
