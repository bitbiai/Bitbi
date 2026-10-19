import { CLAUDE_FABLE_5_MODEL_ID } from './admin-ai-contract.mjs';

// Canvas adapter eligibility, not another generation catalog. Source membership
// and prices remain owned by the existing platform catalogs. Runtime gates are
// server-side; an adapter declaration never proves configured account access.
export const CANVAS_ASSISTANT_MODEL_VERSION = 'canvas-assistant-models-1';
export const DEFAULT_CANVAS_ASSISTANT_MODEL = 'xai/grok-4.7';
export const CANVAS_FABLE_MODEL = CLAUDE_FABLE_5_MODEL_ID;
export const CANVAS_FABLE_ADMISSION_VERSION = 'canvas-fable-messages-1';
export const CANVAS_ASSISTANT_MODELS = Object.freeze([
  Object.freeze({ modelId: DEFAULT_CANVAS_ASSISTANT_MODEL, displayName: 'Grok 4.7', provider: 'xai',
    format: 'chat-completions', vision: true, contextTokens: 500000, requestOutputTokens: 16384,
    transport: 'cloudflare-background', meteringVersion: 'canvas-grok-4.7-usage-v1' }),
  Object.freeze({ modelId: CANVAS_FABLE_MODEL, displayName: 'Fable 5', provider: 'anthropic',
    format: 'anthropic-messages', vision: false, contextTokens: 1000000, requestOutputTokens: 16384,
    transport: 'cloudflare-background', meteringVersion: CANVAS_FABLE_ADMISSION_VERSION }),
]);
export const canvasAssistantModel = modelId => CANVAS_ASSISTANT_MODELS.find(model => model.modelId === modelId) || null;
export function canvasAssistantModelId(value) {
  const modelId = value == null ? DEFAULT_CANVAS_ASSISTANT_MODEL : value;
  if (!canvasAssistantModel(modelId)) throw Object.assign(new TypeError('canvas_agent_model_invalid'), { code: 'canvas_agent_model_invalid', status: 400 });
  return modelId;
}
