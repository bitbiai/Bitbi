import { CANVAS_AGENT_DIALOGUE_VERSION, CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES, CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS,
  CANVAS_AGENT_DIALOGUE_SCHEMA, validateCanvasAgentBrief, canvasAgentDialogueMessages } from '../../../shared/canvas-agent-dialogue.mjs';
import { validateCanvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const invalid = code => { throw Object.assign(new TypeError(code), { code, status: 400, outcome: 'not_submitted' }); };
export function validateCanvasAgentDialogueInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['version', 'model', 'requestId', 'locale', 'conversationRevision', 'briefRevision',
    'projectRevision', 'message', 'brief', 'recentMessages', 'capabilities', 'currentProject', 'privacyUser', 'promptCacheKey', 'policy'].includes(key))) invalid('canvas_agent_dialogue_input_invalid');
  if (input.version !== CANVAS_AGENT_DIALOGUE_VERSION || input.model !== 'xai/grok-4.7') invalid('canvas_agent_model_invalid');
  if (!safeId(input.requestId) || !['en', 'de'].includes(input.locale)
    || ![input.conversationRevision, input.briefRevision, input.projectRevision].every(revision)) invalid('canvas_agent_dialogue_identity_invalid');
  if (!/^(?:cau|vau)_[a-f0-9]{64}$/.test(input.privacyUser || '') || !/^(?:cap|gpc)_[a-f0-9]{64}$/.test(input.promptCacheKey || '')) invalid('canvas_agent_privacy_identity_invalid');
  if (!object(input.message) || Object.keys(input.message).some(key => !['id', 'text'].includes(key))
    || !safeId(input.message.id) || !text(input.message.text, 6000)) invalid('canvas_agent_dialogue_message_invalid');
  validateCanvasAgentBrief(input.brief);
  if (input.brief.revision !== input.briefRevision) invalid('canvas_agent_brief_revision_invalid');
  if (!Array.isArray(input.recentMessages) || input.recentMessages.length > 12
    || input.recentMessages.some(message => !object(message) || Object.keys(message).some(key => !['id', 'role', 'text'].includes(key))
      || !safeId(message.id) || !['user', 'assistant'].includes(message.role) || !text(message.text, 6000))
    || new Set(input.recentMessages.map(message => message.id)).size !== input.recentMessages.length
    || input.recentMessages.some(message => message.id === input.message.id)) invalid('canvas_agent_dialogue_history_invalid');
  if (!object(input.currentProject) || !(object(input.capabilities) || Array.isArray(input.capabilities))) invalid('canvas_agent_context_invalid');
  if (input.policy !== undefined) validateCanvasAgentPolicyIdentity(input.policy);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES) invalid('canvas_agent_dialogue_context_limit');
  return structuredClone(input);
}
export function buildCanvasAgentDialoguePayload(input) {
  return { messages: canvasAgentDialogueMessages(input), reasoning_effort: 'low', max_completion_tokens: CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'bitbi_canvas_dialogue_v1', strict: true, schema: CANVAS_AGENT_DIALOGUE_SCHEMA } },
    stream: false, user: input.privacyUser, prompt_cache_key: input.promptCacheKey };
}
export function canvasAgentDialogueContext(input) {
  return { dialogue: true, conversationRevision: input.conversationRevision, briefRevision: input.briefRevision,
    projectRevision: input.projectRevision, messageId: input.message.id };
}
export function validateCanvasAgentDialogueContext(context) {
  if (!object(context) || Object.keys(context).some(key => !['dialogue', 'conversationRevision', 'briefRevision', 'projectRevision', 'messageId'].includes(key))
    || context.dialogue !== true || ![context.conversationRevision, context.briefRevision, context.projectRevision].every(revision)
    || !safeId(context.messageId)) invalid('canvas_agent_normalization_context_invalid');
  return structuredClone(context);
}
