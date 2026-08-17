import {
  GROK_4_6_MODEL_ID,
  GROK_BASE_SYSTEM_PROMPT,
  GROK_CONTEXT_FORMAT_VERSION,
  GROK_CONTEXT_INPUT_TOKEN_CAP,
  GROK_MAX_CONTEXT_PRIOR_TURNS,
  GROK_MAX_IMAGE_BYTES,
  GROK_MAX_IMAGES_PER_MESSAGE,
  GROK_MAX_TOTAL_IMAGE_BYTES,
  GROK_PROMPT_CACHE_FORMAT_VERSION,
  GROK_PROTOCOL_SAFETY_TOKENS,
  GROK_PROVIDER_STATE_FORMAT_VERSION,
  GROK_SYSTEM_PROMPT_VERSION,
  GROK_TOOL_REGISTRY_VERSION,
  defaultGrokProviderSettings,
  normalizeGrokProviderSettings,
  stableJsonStringify,
} from "../../../shared/grok-chat-contract.mjs";
import {
  FABLE_CHAT_SYSTEM_PRESETS,
  FABLE_CHAT_SYSTEM_PRESET_VERSION,
} from "../../../shared/fable-chat-contract.mjs";
import { buildFableChatSystemWithMemory } from "./fable-chat-memory.js";
import { estimateFableChatMemoryTextTokens } from "../../../shared/fable-chat-memory-contract.mjs";
import { sha256Hex } from "./tokens.js";

const ATTACHMENT_ID_PATTERN = /^fba_[a-f0-9]{32}$/;
const SAFE_TOOL_CALL_ID_PATTERN = /^(?:call-|call_)[A-Za-z0-9_-]{1,180}$/;
const SAFE_TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TEXT_ENCODER = new TextEncoder();

export class GrokChatContextError extends Error {
  constructor(message, { status = 400, code = "grok_chat_context_invalid" } = {}) {
    super(message);
    this.name = "GrokChatContextError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeGrokAttachmentIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > GROK_MAX_IMAGES_PER_MESSAGE) {
    throw new GrokChatContextError("attachments must be a bounded array.", {
      code: "validation_error",
    });
  }
  const ids = value.map((entry) => String(entry || "").trim());
  if (ids.some((id) => !ATTACHMENT_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    throw new GrokChatContextError("attachments are invalid.", { code: "validation_error" });
  }
  return ids;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStoredToolCalls(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return null;
  const calls = [];
  for (const entry of value) {
    const id = String(entry?.id || "").trim();
    const name = String(entry?.function?.name || "").trim();
    const args = entry?.function?.arguments;
    if (!SAFE_TOOL_CALL_ID_PATTERN.test(id) || !SAFE_TOOL_NAME_PATTERN.test(name)
      || typeof args !== "string" || TEXT_ENCODER.encode(args).byteLength > 16 * 1024) {
      return null;
    }
    calls.push({ id, type: "function", function: { name, arguments: args } });
  }
  return calls;
}

function projectStoredProviderState(value, visibleAssistantContent) {
  const state = parseJsonObject(value);
  if (state.formatVersion !== "openai-chat-completions-state-v1" || !Array.isArray(state.messages)) {
    return [{ role: "assistant", content: visibleAssistantContent }];
  }
  const projected = [];
  const openCalls = new Set();
  for (const raw of state.messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [
      { role: "assistant", content: visibleAssistantContent },
    ];
    if (raw.role === "assistant") {
      const content = raw.content == null ? null : String(raw.content);
      if (content != null && (content.length > 524_288
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content))) {
        return [{ role: "assistant", content: visibleAssistantContent }];
      }
      const toolCalls = raw.tool_calls == null ? null : normalizeStoredToolCalls(raw.tool_calls);
      if (raw.tool_calls != null && !toolCalls) {
        return [{ role: "assistant", content: visibleAssistantContent }];
      }
      toolCalls?.forEach((call) => openCalls.add(call.id));
      projected.push({
        role: "assistant",
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    if (raw.role === "tool") {
      const id = String(raw.tool_call_id || "").trim();
      const content = raw.content;
      if (!openCalls.has(id) || typeof content !== "string"
        || TEXT_ENCODER.encode(content).byteLength > 32 * 1024) {
        return [{ role: "assistant", content: visibleAssistantContent }];
      }
      openCalls.delete(id);
      projected.push({ role: "tool", tool_call_id: id, content });
      continue;
    }
    return [{ role: "assistant", content: visibleAssistantContent }];
  }
  if (openCalls.size > 0 || projected.length === 0) {
    return [{ role: "assistant", content: visibleAssistantContent }];
  }
  const last = projected[projected.length - 1];
  if (last.role !== "assistant" || String(last.content || "").trim() !== visibleAssistantContent.trim()) {
    return [{ role: "assistant", content: visibleAssistantContent }];
  }
  return projected;
}

function presetInstruction(id, version) {
  const preset = FABLE_CHAT_SYSTEM_PRESETS[id] || FABLE_CHAT_SYSTEM_PRESETS.general;
  if (Number(version) !== FABLE_CHAT_SYSTEM_PRESET_VERSION) {
    throw new GrokChatContextError("The stored system preset is unavailable.", {
      status: 503,
      code: "fable_chat_context_unavailable",
    });
  }
  return preset.instruction;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function sha256AttachmentBytes(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadAttachmentBlocks(env, adminUserId, conversationId, attachmentIds) {
  if (attachmentIds.length === 0) return { blocks: [], identities: [] };
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.get !== "function") {
    throw new GrokChatContextError("Private image storage is unavailable.", {
      status: 503,
      code: "grok_attachment_storage_unavailable",
    });
  }
  const placeholders = attachmentIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id, r2_key, mime_type, byte_size, width, height, sha256, state
       FROM fable_chat_attachments
      WHERE conversation_id = ? AND admin_user_id = ? AND model_id = ?
        AND deleted_at IS NULL AND id IN (${placeholders})`
  ).bind(conversationId, adminUserId, GROK_4_6_MODEL_ID, ...attachmentIds).all();
  const byId = new Map((rows?.results || []).map((row) => [row.id, row]));
  if (byId.size !== attachmentIds.length) {
    throw new GrokChatContextError("An attachment is unavailable.", {
      status: 404,
      code: "grok_attachment_not_found",
    });
  }
  const blocks = [];
  const identities = [];
  let totalImageBytes = 0;
  for (const id of attachmentIds) {
    const row = byId.get(id);
    if (!row || !["pending", "attached"].includes(row.state)
      || !["image/png", "image/jpeg", "image/webp"].includes(row.mime_type)
      || Number(row.byte_size) < 1 || Number(row.byte_size) > GROK_MAX_IMAGE_BYTES) {
      throw new GrokChatContextError("An attachment is invalid.", {
        code: "grok_attachment_invalid",
      });
    }
    totalImageBytes += Number(row.byte_size);
    if (totalImageBytes > GROK_MAX_TOTAL_IMAGE_BYTES) {
      throw new GrokChatContextError("The combined attachment payload is too large.", {
        status: 413,
        code: "grok_attachment_payload_too_large",
      });
    }
    const object = await env.USER_IMAGES.get(row.r2_key);
    if (!object) {
      throw new GrokChatContextError("An attachment is unavailable.", {
        status: 503,
        code: "grok_attachment_storage_unavailable",
      });
    }
    const buffer = await object.arrayBuffer();
    const digest = await sha256AttachmentBytes(buffer);
    if (buffer.byteLength !== Number(row.byte_size) || buffer.byteLength > GROK_MAX_IMAGE_BYTES
      || digest !== row.sha256) {
      throw new GrokChatContextError("An attachment failed integrity validation.", {
        status: 503,
        code: "grok_attachment_integrity_failed",
      });
    }
    blocks.push({
      type: "image_url",
      image_url: {
        url: `data:${row.mime_type};base64,${arrayBufferToBase64(buffer)}`,
        detail: "auto",
      },
    });
    identities.push({
      id: row.id,
      sha256: row.sha256,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      width: Number(row.width),
      height: Number(row.height),
    });
  }
  return { blocks, identities };
}

function turnTokenEstimate(row, providerMessages) {
  return 24
    + estimateFableChatMemoryTextTokens(row.user_content)
    + estimateFableChatMemoryTextTokens(row.assistant_content)
    + providerMessages.reduce((sum, message) => (
      sum + estimateFableChatMemoryTextTokens(message.content || "")
      + estimateFableChatMemoryTextTokens(message.tool_calls ? JSON.stringify(message.tool_calls) : "")
    ), 0);
}

export async function buildGrokChatModelContext(env, {
  adminUserId,
  conversationId,
  currentMessage,
  settings,
  memorySelection,
  attachmentIds = [],
}) {
  const conversation = await env.DB.prepare(
    `SELECT id, model_id, system_preset_id, system_preset_version, memory_mode,
            provider_settings_json, provider_settings_version
       FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(conversationId, adminUserId).first();
  if (!conversation || conversation.model_id !== GROK_4_6_MODEL_ID) {
    throw new GrokChatContextError("Conversation not found.", { status: 404, code: "not_found" });
  }
  let providerSettings;
  try {
    providerSettings = normalizeGrokProviderSettings(
      parseJsonObject(conversation.provider_settings_json),
      { base: defaultGrokProviderSettings() }
    );
  } catch {
    throw new GrokChatContextError("Stored Grok settings are invalid.", {
      status: 503,
      code: "fable_chat_context_unavailable",
    });
  }
  if (settings && stableJsonStringify(settings.providerSettings) !== stableJsonStringify(providerSettings)) {
    throw new GrokChatContextError("Conversation settings changed before context was prepared.", {
      status: 409,
      code: "fable_chat_settings_conflict",
    });
  }
  const selectedMemory = memorySelection || {
    mode: conversation.memory_mode || "standard",
    contractVersion: 1,
    checkpointId: null,
    checkpointVersion: 0,
    coverageTurnOrder: -1,
    summary: null,
  };
  const systemBase = `${GROK_BASE_SYSTEM_PROMPT}\n\n${presetInstruction(
    conversation.system_preset_id,
    conversation.system_preset_version
  )}`;
  const system = buildFableChatSystemWithMemory(systemBase, selectedMemory);
  const rows = await env.DB.prepare(
    `SELECT um.turn_order,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = um.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1),
              um.content) AS user_content,
            COALESCE((SELECT r.content FROM fable_chat_admin_message_revisions r
              WHERE r.message_id = am.id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1),
              am.content) AS assistant_content,
            CASE WHEN EXISTS (
              SELECT 1 FROM fable_chat_admin_message_revisions r
               WHERE r.message_id IN (um.id, am.id)
            ) THEN NULL ELSE ps.state_json END AS provider_state_json
       FROM fable_chat_turns t
       INNER JOIN fable_chat_messages um ON um.id = t.user_message_id
       INNER JOIN fable_chat_messages am ON am.id = t.assistant_message_id
       LEFT JOIN fable_chat_provider_states ps ON ps.message_id = am.id
      WHERE t.conversation_id = ? AND t.admin_user_id = ? AND t.model_id = ?
        AND t.status = 'succeeded' AND um.state = 'succeeded' AND am.state = 'succeeded'
        AND COALESCE((SELECT CASE tr.action WHEN 'delete' THEN 1 ELSE 0 END
          FROM fable_chat_admin_turn_revisions tr WHERE tr.turn_id = t.id
          ORDER BY tr.revision_number DESC, tr.id DESC LIMIT 1), 0) = 0
      ORDER BY um.turn_order DESC, t.id DESC LIMIT ?`
  ).bind(
    conversationId,
    adminUserId,
    GROK_4_6_MODEL_ID,
    GROK_MAX_CONTEXT_PRIOR_TURNS
  ).all();
  const currentAttachments = await loadAttachmentBlocks(
    env,
    adminUserId,
    conversationId,
    normalizeGrokAttachmentIds(attachmentIds)
  );
  const currentBlocks = currentAttachments.blocks;
  const currentUserContent = currentBlocks.length > 0
    ? [...currentBlocks, { type: "text", text: currentMessage }]
    : currentMessage;
  const outputReserve = providerSettings.maxCompletionTokens;
  const effectiveInputTokenLimit = Math.min(
    GROK_CONTEXT_INPUT_TOKEN_CAP,
    131_072 - outputReserve - GROK_PROTOCOL_SAFETY_TOKENS
  );
  let estimatedTokens = estimateFableChatMemoryTextTokens(system)
    + estimateFableChatMemoryTextTokens(currentMessage)
    + currentBlocks.length * 2_048
    + 32;
  const selectedNewestFirst = [];
  for (const row of rows?.results || []) {
    if (Number(row.turn_order) <= Number(selectedMemory.coverageTurnOrder ?? -1)) continue;
    const providerMessages = projectStoredProviderState(
      row.provider_state_json,
      row.assistant_content
    );
    const estimate = turnTokenEstimate(row, providerMessages);
    if (estimatedTokens + estimate > effectiveInputTokenLimit) continue;
    estimatedTokens += estimate;
    selectedNewestFirst.push({ row, providerMessages, estimate });
  }
  const messages = [{ role: "system", content: system }];
  for (const selected of selectedNewestFirst.reverse()) {
    messages.push({ role: "user", content: selected.row.user_content });
    messages.push(...selected.providerMessages);
  }
  messages.push({ role: "user", content: currentUserContent });
  const fingerprintSettings = {
    model: GROK_4_6_MODEL_ID,
    contextFormatVersion: GROK_CONTEXT_FORMAT_VERSION,
    promptCacheFormatVersion: GROK_PROMPT_CACHE_FORMAT_VERSION,
    providerStateFormatVersion: GROK_PROVIDER_STATE_FORMAT_VERSION,
    systemPromptVersion: GROK_SYSTEM_PROMPT_VERSION,
    toolRegistryVersion: GROK_TOOL_REGISTRY_VERSION,
    systemPresetId: conversation.system_preset_id,
    systemPresetVersion: Number(conversation.system_preset_version),
    providerSettings,
  };
  const cacheIdentity = await sha256Hex(
    `grok-cache\n${conversationId}\n${stableJsonStringify(fingerprintSettings)}`
  );
  const privacyIdentity = await sha256Hex(`van-ark-user\n${adminUserId}\n${GROK_4_6_MODEL_ID}`);
  return {
    model: GROK_4_6_MODEL_ID,
    messages,
    settings: providerSettings,
    promptCacheKey: `gpc_${cacheIdentity}`,
    privacyUser: `vau_${privacyIdentity}`,
    contextFormatVersion: GROK_CONTEXT_FORMAT_VERSION,
    attachmentIds: normalizeGrokAttachmentIds(attachmentIds),
    attachmentIdentities: currentAttachments.identities,
    memoryMode: selectedMemory.mode,
    memorySelection: selectedMemory,
    context: {
      contextFormatVersion: GROK_CONTEXT_FORMAT_VERSION,
      estimatorVersion: "provider-weighted-grok-v1",
      includedTurns: selectedNewestFirst.length,
      omittedTurns: Math.max(0, (rows?.results || []).length - selectedNewestFirst.length),
      characterCount: messages.reduce((sum, entry) => (
        sum + (typeof entry.content === "string" ? entry.content.length : 0)
      ), 0),
      estimatedInputTokens: estimatedTokens,
      effectiveInputTokenLimit,
      outputReserveTokens: outputReserve,
      protocolSafetyTokens: GROK_PROTOCOL_SAFETY_TOKENS,
      estimatedTotalEnvelopeTokens: estimatedTokens + outputReserve + GROK_PROTOCOL_SAFETY_TOKENS,
      attachmentCount: currentAttachments.identities.length,
      cacheBreakpoint: {
        enabled: true,
        policy: "automatic",
        keyVersion: GROK_PROMPT_CACHE_FORMAT_VERSION,
        providerStateFormatVersion: GROK_PROVIDER_STATE_FORMAT_VERSION,
        systemPromptVersion: GROK_SYSTEM_PROMPT_VERSION,
        toolRegistryVersion: GROK_TOOL_REGISTRY_VERSION,
      },
      predictedCacheWriteTokens: 0,
      memory: {
        mode: selectedMemory.mode,
        contractVersion: selectedMemory.contractVersion,
        checkpointId: selectedMemory.checkpointId,
        checkpointVersion: selectedMemory.checkpointVersion,
        coverageTurnOrder: selectedMemory.coverageTurnOrder,
      },
      webReplay: {
        version: 1,
        prunedThroughTurnOrder: -1,
        prunedThroughMessageId: null,
        prunedAt: null,
        advanced: false,
      },
    },
  };
}
