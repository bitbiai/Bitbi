import { FABLE_CHAT_MODEL_ID } from "./fable-chat-contract.mjs";

export const GROK_4_6_MODEL_ID = "xai/grok-4.6";
export const CHAT_MODEL_CONTRACT_VERSION = 1;
export const CHAT_PROVIDER_STATE_VERSION = 1;
export const GROK_CONTEXT_FORMAT_VERSION = "openai-chat-completions-v1";
export const GROK_PROVIDER_STATE_FORMAT_VERSION = "openai-chat-completions-state-v1";
export const GROK_PROMPT_CACHE_FORMAT_VERSION = 1;

export const CHAT_MODEL_IDS = Object.freeze([
  FABLE_CHAT_MODEL_ID,
  GROK_4_6_MODEL_ID,
]);

const CHAT_MODEL_ID_SET = new Set(CHAT_MODEL_IDS);

export const CHAT_MODELS = Object.freeze({
  [FABLE_CHAT_MODEL_ID]: Object.freeze({
    id: FABLE_CHAT_MODEL_ID,
    provider: "anthropic",
    label: "Fable 5",
    enabledBy: null,
    contextFormatVersion: "native-anthropic-turns-v3",
    providerStateFormatVersion: "anthropic-content-v2",
    capabilities: Object.freeze({
      streaming: true,
      reasoning: true,
      reasoningEfforts: Object.freeze(["medium", "high", "xhigh", "max"]),
      images: false,
      functionCalling: true,
      structuredOutputs: false,
      webSearch: true,
      webFetch: true,
      promptCache: "explicit_ttl",
      memory: true,
    }),
  }),
  [GROK_4_6_MODEL_ID]: Object.freeze({
    id: GROK_4_6_MODEL_ID,
    provider: "xai",
    label: "Grok 4.6",
    enabledBy: "ENABLE_GROK_4_6",
    contextFormatVersion: GROK_CONTEXT_FORMAT_VERSION,
    providerStateFormatVersion: GROK_PROVIDER_STATE_FORMAT_VERSION,
    capabilities: Object.freeze({
      streaming: true,
      reasoning: true,
      reasoningEfforts: Object.freeze(["low", "medium", "high"]),
      images: true,
      functionCalling: true,
      structuredOutputs: true,
      webSearch: true,
      webFetch: false,
      promptCache: "automatic",
      memory: true,
    }),
  }),
});

export function normalizeChatModelId(value, {
  defaultModel = FABLE_CHAT_MODEL_ID,
} = {}) {
  const normalized = value == null || value === ""
    ? defaultModel
    : String(value).trim();
  if (!CHAT_MODEL_ID_SET.has(normalized)) {
    throw new TypeError("model is not supported.");
  }
  return normalized;
}

export function isGrokChatModel(modelId) {
  return normalizeChatModelId(modelId) === GROK_4_6_MODEL_ID;
}

export function isChatModelEnabled(env, modelId) {
  const model = CHAT_MODELS[normalizeChatModelId(modelId)];
  if (!model.enabledBy) return true;
  return String(env?.[model.enabledBy] || "").trim().toLowerCase() === "true";
}

export function getChatModel(modelId) {
  return CHAT_MODELS[normalizeChatModelId(modelId)];
}

export function getPublicChatModel(modelId, env) {
  const model = getChatModel(modelId);
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    enabled: isChatModelEnabled(env, model.id),
    capabilities: model.capabilities,
  };
}

export function listPublicChatModels(env) {
  return CHAT_MODEL_IDS.map((modelId) => getPublicChatModel(modelId, env));
}
