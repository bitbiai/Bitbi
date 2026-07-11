import { enqueueAdminAuditEvent } from "../lib/activity.js";
import {
  admitFableChatBudgetUsage,
  FABLE_CHAT_INTERNAL_PATH,
  FABLE_CHAT_INTERNAL_STREAM_PATH,
  prepareFableChatBudget,
  recordFableChatBudgetOutcome,
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
  getFableChatConversationSettings,
  getFableChatTurnByIdempotencyKey,
  getFableChatTurnResult,
  listFableChatConversations,
  listFableChatMessages,
  markFableChatTurnFailed,
  markFableChatTurnRunning,
  markFableChatTurnUnknown,
  matchesFableChatTurnRequest,
  normalizeFableChatConversationId,
  normalizeFableChatIdempotencyKey,
  renameFableChatConversation,
  validateCreateFableChatBody,
  validateRenameFableChatBody,
  validateSendFableChatBody,
  validateUpdateFableChatSettingsBody,
  updateFableChatConversationSettings,
} from "../lib/fable-chat.js";
import {
  proxyFableChatStreamToAiLab,
  proxyToAiLab,
} from "../lib/admin-ai-proxy.js";
import {
  FableChatInternalStreamError,
  consumeInternalFableChatStream,
  encodeFableChatBrowserEvent,
  fableChatStreamResponse,
} from "../lib/fable-chat-stream.js";
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
    estimatedInputTokens: Number(context?.estimatedInputTokens || 0),
    effectiveInputTokenLimit: Number(context?.effectiveInputTokenLimit || 0),
    estimatorVersion: context?.estimatorVersion || null,
    cacheApplied: context?.cacheBreakpoint?.enabled === true,
  };
}

function internalFableChatPayload(modelContext) {
  return {
    messages: modelContext.messages,
    effort: modelContext.effort,
    maxTokens: modelContext.maxTokens,
    systemPresetId: modelContext.systemPresetId,
    systemPresetVersion: modelContext.systemPresetVersion,
    thinkingDisplay: modelContext.thinkingDisplay,
    promptCachePolicy: modelContext.promptCachePolicy,
    promptCacheVersion: modelContext.promptCacheVersion,
    contextFormatVersion: modelContext.context.contextFormatVersion,
    webSearchEnabled: modelContext.webSearchEnabled,
    webSearchMaxUses: modelContext.webSearchMaxUses,
    webSearchContractVersion: modelContext.webSearchContractVersion,
  };
}

async function successPayload(env, adminUserId, conversationId, result, {
  replayed = false,
} = {}) {
  const conversation = await getFableChatConversation(env, adminUserId, conversationId);
  if (!conversation || !result) return null;
  return {
    ok: true,
    conversation,
    turn: result.turn,
    messages: result.messages,
    context: contextForBrowser(result.context),
    idempotentReplay: replayed,
  };
}

async function successResponse(env, adminUserId, conversationId, result, correlationId, {
  replayed = false,
} = {}) {
  const payload = await successPayload(env, adminUserId, conversationId, result, { replayed });
  if (!payload) return notFound(correlationId);
  return correlated(json(payload), correlationId);
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
  effort = null,
  effectiveMaxOutputTokens = null,
  estimatedInputBucket = null,
  webSearchEnabled = null,
  webSearchRequestCount = null,
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
        effort,
        effective_max_output_tokens: effectiveMaxOutputTokens,
        estimated_input_bucket_tokens: estimatedInputBucket,
        web_search_enabled: webSearchEnabled,
        web_search_request_count: webSearchRequestCount,
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

async function recordBudgetOutcomeSafely(ctx, turnId, outcome) {
  try {
    await recordFableChatBudgetOutcome(ctx.env, turnId, outcome);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-fable-chat-budget",
      event: "admin_fable_chat_budget_outcome_update_failed",
      level: "error",
      correlationId: ctx.correlationId,
      turn_id: turnId,
      ...getErrorFields(error, { includeMessage: false }),
    });
  }
}

async function resolveExistingSend(
  ctx,
  adminUser,
  conversationId,
  turn,
  requestFingerprint,
  { streamMode = false, message, retryMessageId = null, settings } = {}
) {
  const { env, correlationId } = ctx;
  if (!await matchesFableChatTurnRequest(turn, requestFingerprint, {
    conversationId,
    message,
    retryMessageId,
    settings,
  })) {
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
    if (streamMode) return { kind: "replay", result };
    return {
      kind: "response",
      response: await successResponse(env, adminUser.id, conversationId, result, correlationId, {
        replayed: true,
      }),
    };
  }
  if (current.status === "failed") {
    return { kind: "response", response: failedTurnResponse(current, correlationId) };
  }
  if (current.status === "unknown") {
    return { kind: "response", response: unknownTurnResponse(current, correlationId) };
  }
  return { kind: "response", response: inProgressResponse(current, correlationId) };
}

async function prepareSend(ctx, adminUser, conversationId, { streamMode = false } = {}) {
  const { request, env, correlationId } = ctx;
  const parsed = await readChatJsonBody(request, correlationId);
  if (parsed.response) return { kind: "response", response: parsed.response };
  const input = validateSendFableChatBody(parsed.body);
  const idempotencyKey = normalizeFableChatIdempotencyKey(request.headers.get("Idempotency-Key"));
  const settings = await getFableChatConversationSettings(env, adminUser.id, conversationId);
  if (!settings) return { kind: "response", response: notFound(correlationId) };
  const requestFingerprint = await buildFableChatRequestFingerprint({
    conversationId,
    message: input.message,
    retryMessageId: input.retryMessageId,
    settings,
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
    return resolveExistingSend(
      ctx,
      adminUser,
      conversationId,
      existing,
      requestFingerprint,
      {
        streamMode,
        message: input.message,
        retryMessageId: input.retryMessageId,
        settings,
      }
    );
  }

  const limited = await enforceFableChatRateLimit(ctx, adminUser.id, "send", {
    adminMax: 30,
    ipMax: 60,
  });
  if (limited) return { kind: "response", response: correlated(limited, correlationId) };

  const modelContext = await buildFableChatModelContext(env, {
    adminUserId: adminUser.id,
    conversationId,
    currentMessage: input.message,
    settings,
  });
  const budget = await prepareFableChatBudget({
    env,
    adminUser,
    conversationId,
    message: input.message,
    retryMessageId: input.retryMessageId,
    requestFingerprint,
    settings,
    context: modelContext.context,
    correlationId,
  });
  const attempt = await beginFableChatTurn(env, {
    adminUserId: adminUser.id,
    conversationId,
    idempotencyKey,
    requestFingerprint,
    message: input.message,
    retryMessageId: input.retryMessageId,
    settings,
    context: modelContext.context,
  });
  if (attempt.kind !== "created") {
    return resolveExistingSend(
      ctx,
      adminUser,
      conversationId,
      attempt.turn,
      requestFingerprint,
      {
        streamMode,
        message: input.message,
        retryMessageId: input.retryMessageId,
        settings,
      }
    );
  }

  let turn = attempt.turn;
  try {
    await admitFableChatBudgetUsage({
      env,
      adminUserId: adminUser.id,
      turnId: turn.id,
      idempotencyKeyHash: turn.idempotencyKeyHash,
      requestFingerprint,
      units: budget.units,
      metadata: budget.metadata,
    });
    turn = await markFableChatTurnRunning(env, turn.id);
  } catch (error) {
    try {
      turn = await markFableChatTurnFailed(env, turn.id, error?.code || "generation_failed");
    } catch {
      // Preserve the original admission error without exposing a persistence detail.
    }
    await recordBudgetOutcomeSafely(ctx, turn?.id || attempt.turn.id, { finalState: "failed" });
    auditFableChat(ctx, adminUser, "fable_chat_message_failed", {
      conversationId,
      turnId: turn?.id || attempt.turn.id,
      status: "failed",
      effort: settings.effort,
      effectiveMaxOutputTokens: settings.effectiveMaxOutputTokens,
      estimatedInputBucket: budget.metadata.estimated_input_bucket_tokens,
      webSearchEnabled: settings.webSearchEnabled,
    });
    throw error;
  }
  return {
    kind: "running",
    input,
    settings,
    modelContext,
    budget,
    turn,
  };
}

async function recordProviderHttpFailure(
  ctx,
  adminUser,
  conversationId,
  prepared,
  providerResponse,
  providerBody
) {
  const errorCode = providerBody?.code || `provider_status_${providerResponse.status}`;
  const unknownOutcome = providerResponse.status >= 500;
  const turn = unknownOutcome
    ? await markFableChatTurnUnknown(ctx.env, prepared.turn.id, errorCode)
    : await markFableChatTurnFailed(ctx.env, prepared.turn.id, errorCode);
  await recordBudgetOutcomeSafely(ctx, turn.id, {
    finalState: unknownOutcome ? "unknown" : "failed",
  });
  auditFableChat(ctx, adminUser, unknownOutcome
    ? "fable_chat_message_outcome_unknown"
    : "fable_chat_message_failed", {
    conversationId,
    turnId: turn.id,
    status: turn.status,
    effort: prepared.settings.effort,
    effectiveMaxOutputTokens: prepared.settings.effectiveMaxOutputTokens,
    estimatedInputBucket: prepared.budget.metadata.estimated_input_bucket_tokens,
    webSearchEnabled: prepared.settings.webSearchEnabled,
  });
  return unknownOutcome
    ? unknownTurnResponse(turn, ctx.correlationId, {
        status: [502, 503, 504].includes(providerResponse.status)
          ? providerResponse.status
          : 503,
      })
    : failedTurnResponse(turn, ctx.correlationId, {
        status: [429, 502, 503, 504].includes(providerResponse.status)
          ? providerResponse.status
          : 502,
      });
}

async function handleSend(ctx, adminUser, conversationId) {
  const prepared = await prepareSend(ctx, adminUser, conversationId);
  if (prepared.kind === "response") return prepared.response;
  let { turn } = prepared;
  let finalized = false;
  let providerStarted = false;
  try {
    providerStarted = true;
    const providerResponse = await proxyToAiLab(
      ctx.env,
      FABLE_CHAT_INTERNAL_PATH,
      {
        method: "POST",
        body: internalFableChatPayload(prepared.modelContext),
        callerPolicy: prepared.budget.callerPolicy,
      },
      adminUser,
      ctx.correlationId,
      ctx
    );
    let providerBody = null;
    try {
      providerBody = await providerResponse.clone().json();
    } catch {
      providerBody = null;
    }
    if (!providerResponse.ok || providerBody?.ok !== true) {
      return recordProviderHttpFailure(
        ctx,
        adminUser,
        conversationId,
        prepared,
        providerResponse,
        providerBody
      );
    }
    const result = await finalizeFableChatTurn(ctx.env, turn.id, {
      assistantContent: providerBody?.result?.text,
      providerBlocks: providerBody?.result?.providerBlocks,
      context: prepared.modelContext.context,
      providerModel: providerBody?.result?.responseModel || providerBody?.model?.id || null,
      stopReason: providerBody?.result?.stopReason || null,
      stopSequence: providerBody?.result?.stopSequence || null,
      usage: providerBody?.result?.usage || null,
      gatewayMetadata: providerBody?.result?.gatewayMetadata || null,
      providerDurationMs: providerBody?.elapsedMs,
      webSearchRequestCount: providerBody?.result?.webSearchRequestCount,
      webSearchResultCount: providerBody?.result?.webSearchResultCount,
    });
    finalized = true;
    turn = result.turn;
    await recordBudgetOutcomeSafely(ctx, turn.id, {
      finalState: "succeeded",
      stopReason: providerBody?.result?.stopReason || null,
      durationMs: providerBody?.elapsedMs,
      outputTruncated: result.turn.outputTruncated === true,
      usage: providerBody?.result?.usage || null,
      webSearchRequestCount: result.turn.webSearchRequestCount,
    });
    auditFableChat(ctx, adminUser, "fable_chat_message_succeeded", {
      conversationId,
      turnId: turn.id,
      status: "succeeded",
      contextOmittedTurns: result.context.omittedTurns,
      effort: prepared.settings.effort,
      effectiveMaxOutputTokens: prepared.settings.effectiveMaxOutputTokens,
      estimatedInputBucket: prepared.budget.metadata.estimated_input_bucket_tokens,
      webSearchEnabled: prepared.settings.webSearchEnabled,
      webSearchRequestCount: result.turn.webSearchRequestCount,
    });
    return successResponse(ctx.env, adminUser.id, conversationId, result, ctx.correlationId);
  } catch (error) {
    if (!finalized) {
      try {
        turn = providerStarted
          ? await markFableChatTurnUnknown(ctx.env, turn.id, error?.code || "provider_outcome_unknown")
          : await markFableChatTurnFailed(ctx.env, turn.id, error?.code || "generation_failed");
      } catch {
        // Preserve the original failure without exposing a secondary persistence detail.
      }
      await recordBudgetOutcomeSafely(ctx, turn?.id || prepared.turn.id, {
        finalState: providerStarted ? "unknown" : "failed",
      });
      auditFableChat(ctx, adminUser, providerStarted
        ? "fable_chat_message_outcome_unknown"
        : "fable_chat_message_failed", {
        conversationId,
        turnId: turn?.id || prepared.turn.id,
        status: providerStarted ? "unknown" : "failed",
        effort: prepared.settings.effort,
        effectiveMaxOutputTokens: prepared.settings.effectiveMaxOutputTokens,
        webSearchEnabled: prepared.settings.webSearchEnabled,
      });
      if (providerStarted && turn?.status === "unknown") {
        return unknownTurnResponse(turn, ctx.correlationId, {
          status: Number(error?.status) === 504 ? 504 : 503,
        });
      }
    }
    throw error;
  }
}

function replayStreamResponse(ctx, adminUser, conversationId, result) {
  const stream = new ReadableStream({
    start(controller) {
      const processing = (async () => {
        controller.enqueue(encodeFableChatBrowserEvent("accepted", { replayed: true }));
        const assistant = result?.messages?.find((message) => message.role === "assistant") || null;
        if (assistant?.reasoningSummary) {
          controller.enqueue(encodeFableChatBrowserEvent("thinking_delta", {
            text: assistant.reasoningSummary,
          }));
        }
        if (result?.turn?.webSearchRequestCount > 0) {
          controller.enqueue(encodeFableChatBrowserEvent("web_search_started", { replayed: true }));
        }
        if (assistant?.content) {
          controller.enqueue(encodeFableChatBrowserEvent("text_delta", { text: assistant.content }));
        }
        const payload = await successPayload(ctx.env, adminUser.id, conversationId, result, {
          replayed: true,
        });
        if (!payload) throw new Error("Stored Fable chat result is unavailable.");
        controller.enqueue(encodeFableChatBrowserEvent("final", payload));
        controller.close();
      })().catch(() => {
        try {
          controller.enqueue(encodeFableChatBrowserEvent("error", {
            ok: false,
            error: "The stored response could not be loaded. Refresh this conversation.",
            code: "fable_chat_refresh_required",
            retryable: false,
          }));
          controller.close();
        } catch {
          // The client disconnected while the durable replay was being loaded.
        }
      });
      if (ctx.execCtx?.waitUntil) ctx.execCtx.waitUntil(processing);
    },
  });
  return correlated(fableChatStreamResponse(stream), ctx.correlationId);
}

function liveStreamResponse(ctx, adminUser, conversationId, prepared, internalStream) {
  let clientCanceled = false;
  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (event, data) => {
        if (clientCanceled) return;
        try {
          controller.enqueue(encodeFableChatBrowserEvent(event, data));
        } catch {
          clientCanceled = true;
        }
      };
      const processing = (async () => {
        let turn = prepared.turn;
        let durablyFinalized = false;
        try {
          const complete = await consumeInternalFableChatStream(internalStream, {
            onAccepted: () => enqueue("accepted", { replayed: false, turn: { id: turn.id } }),
            onThinkingDelta: (text) => enqueue("thinking_delta", { text }),
            onTextDelta: (text) => enqueue("text_delta", { text }),
            onWebSearchStarted: () => enqueue("web_search_started", { ok: true }),
            onKeepalive: () => enqueue("keepalive", { ok: true }),
          });
          const result = await finalizeFableChatTurn(ctx.env, turn.id, {
            assistantContent: complete.text,
            providerBlocks: complete.providerBlocks,
            context: prepared.modelContext.context,
            providerModel: complete.responseModel || null,
            stopReason: complete.stopReason || null,
            stopSequence: complete.stopSequence || null,
            usage: complete.usage || null,
            gatewayMetadata: null,
            providerDurationMs: complete.durationMs,
            webSearchRequestCount: complete.webSearchRequestCount,
            webSearchResultCount: complete.webSearchResultCount,
          });
          turn = result.turn;
          durablyFinalized = true;
          await recordBudgetOutcomeSafely(ctx, turn.id, {
            finalState: "succeeded",
            stopReason: complete.stopReason || null,
            durationMs: complete.durationMs,
            outputTruncated: result.turn.outputTruncated === true,
            usage: complete.usage || null,
            webSearchRequestCount: result.turn.webSearchRequestCount,
          });
          auditFableChat(ctx, adminUser, "fable_chat_message_succeeded", {
            conversationId,
            turnId: turn.id,
            status: "succeeded",
            contextOmittedTurns: result.context.omittedTurns,
            effort: prepared.settings.effort,
            effectiveMaxOutputTokens: prepared.settings.effectiveMaxOutputTokens,
            estimatedInputBucket: prepared.budget.metadata.estimated_input_bucket_tokens,
            webSearchEnabled: prepared.settings.webSearchEnabled,
            webSearchRequestCount: result.turn.webSearchRequestCount,
          });
          const payload = await successPayload(ctx.env, adminUser.id, conversationId, result);
          if (!payload) throw new FableChatInternalStreamError("Durable chat result is unavailable.");
          enqueue("final", payload);
        } catch (error) {
          if (durablyFinalized) {
            enqueue("error", {
              ok: false,
              error: "The response was saved. Refresh this conversation to load it.",
              code: "fable_chat_refresh_required",
              retryable: false,
              turn: { id: turn.id, status: "succeeded" },
            });
            return;
          }
          const failed = error instanceof FableChatInternalStreamError && error.outcome === "failed";
          try {
            turn = failed
              ? await markFableChatTurnFailed(ctx.env, turn.id, error.code)
              : await markFableChatTurnUnknown(ctx.env, turn.id, error?.code || "provider_outcome_unknown");
          } catch {
            // A stale running row is later converted to unknown; never execute the provider again here.
          }
          await recordBudgetOutcomeSafely(ctx, turn?.id || prepared.turn.id, {
            finalState: failed ? "failed" : "unknown",
          });
          auditFableChat(ctx, adminUser, failed
            ? "fable_chat_message_failed"
            : "fable_chat_message_outcome_unknown", {
            conversationId,
            turnId: turn?.id || prepared.turn.id,
            status: failed ? "failed" : "unknown",
            effort: prepared.settings.effort,
            effectiveMaxOutputTokens: prepared.settings.effectiveMaxOutputTokens,
            webSearchEnabled: prepared.settings.webSearchEnabled,
          });
          enqueue("error", failed ? {
            ok: false,
            error: "Claude Fable could not complete this response. Retry with a new request.",
            code: "fable_chat_turn_failed",
            retryable: true,
            retryMessageId: turn?.userMessageId || prepared.turn.userMessageId,
            turn: { id: turn?.id || prepared.turn.id, status: "failed" },
          } : {
            ok: false,
            error: "The provider outcome is unknown. This message cannot be retried automatically.",
            code: "fable_chat_provider_outcome_unknown",
            retryable: false,
            turn: { id: turn?.id || prepared.turn.id, status: "unknown" },
          });
        } finally {
          if (!clientCanceled) {
            try {
              controller.close();
            } catch {
              // The browser disconnected after provider admission; durable processing already decided state.
            }
          }
        }
      })();
      if (ctx.execCtx?.waitUntil) ctx.execCtx.waitUntil(processing);
    },
    cancel() {
      clientCanceled = true;
    },
  });
  return correlated(fableChatStreamResponse(stream), ctx.correlationId);
}

async function handleStreamSend(ctx, adminUser, conversationId) {
  const prepared = await prepareSend(ctx, adminUser, conversationId, { streamMode: true });
  if (prepared.kind === "response") return prepared.response;
  if (prepared.kind === "replay") {
    return replayStreamResponse(ctx, adminUser, conversationId, prepared.result);
  }
  const providerResponse = await proxyFableChatStreamToAiLab(
    ctx.env,
    FABLE_CHAT_INTERNAL_STREAM_PATH,
    internalFableChatPayload(prepared.modelContext),
    adminUser,
    ctx.correlationId,
    ctx,
    prepared.budget.callerPolicy
  );
  const contentType = providerResponse.headers.get("content-type") || "";
  if (!providerResponse.ok || !contentType.includes("text/event-stream")) {
    let providerBody = null;
    try {
      providerBody = await providerResponse.clone().json();
    } catch {
      providerBody = null;
    }
    return recordProviderHttpFailure(
      ctx,
      adminUser,
      conversationId,
      prepared,
      providerResponse.ok
        ? new Response(null, { status: 503 })
        : providerResponse,
      providerBody
    );
  }
  return liveStreamResponse(ctx, adminUser, conversationId, prepared, providerResponse.body);
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
      const settings = validateCreateFableChatBody(parsed.body);
      const conversation = await createFableChatConversation(env, admin.user.id, settings);
      auditFableChat(ctx, admin.user, "fable_chat_conversation_created", {
        conversationId: conversation.id,
        status: "created",
      });
      return correlated(json({ ok: true, conversation }, { status: 201 }), correlationId);
    }

    const streamMessageMatch = pathname.match(
      /^\/api\/admin\/fable-chat\/conversations\/([^/]+)\/messages\/stream$/
    );
    // route-policy: admin.fable-chat.messages.stream
    if (streamMessageMatch && method === "POST") {
      return await handleStreamSend(
        ctx,
        admin.user,
        normalizeFableChatConversationId(streamMessageMatch[1])
      );
    }

    const messageMatch = pathname.match(/^\/api\/admin\/fable-chat\/conversations\/([^/]+)\/messages$/);
    // route-policy: admin.fable-chat.messages.send
    if (messageMatch && method === "POST") {
      return await handleSend(ctx, admin.user, normalizeFableChatConversationId(messageMatch[1]));
    }

    const settingsMatch = pathname.match(
      /^\/api\/admin\/fable-chat\/conversations\/([^/]+)\/settings$/
    );
    if (settingsMatch) {
      const conversationId = normalizeFableChatConversationId(settingsMatch[1]);
      if (method === "GET") {
        const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "read");
        if (limited) return correlated(limited, correlationId);
        const conversation = await getFableChatConversation(env, admin.user.id, conversationId);
        if (!conversation) return notFound(correlationId);
        return correlated(json({ ok: true, settings: conversation.settings }), correlationId);
      }
      // route-policy: admin.fable-chat.conversations.settings.update
      if (method === "PATCH") {
        const limited = await enforceFableChatRateLimit(ctx, admin.user.id, "write", {
          adminMax: 60,
          ipMax: 120,
        });
        if (limited) return correlated(limited, correlationId);
        const parsed = await readChatJsonBody(request, correlationId);
        if (parsed.response) return parsed.response;
        const input = validateUpdateFableChatSettingsBody(parsed.body);
        const expiredTurns = await expireStaleFableChatTurns(env, admin.user.id, conversationId);
        for (const expiredTurn of expiredTurns) {
          auditFableChat(ctx, admin.user, "fable_chat_message_outcome_unknown", {
            conversationId,
            turnId: expiredTurn.id,
            status: "unknown",
          });
        }
        const conversation = await updateFableChatConversationSettings(
          env,
          admin.user.id,
          conversationId,
          input
        );
        if (!conversation) return notFound(correlationId);
        auditFableChat(ctx, admin.user, "fable_chat_conversation_settings_updated", {
          conversationId,
          status: "updated",
          effort: conversation.settings.effort,
          effectiveMaxOutputTokens: conversation.settings.effectiveMaxOutputTokens,
        });
        return correlated(json({ ok: true, settings: conversation.settings }), correlationId);
      }
      return null;
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
