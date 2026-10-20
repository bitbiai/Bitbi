import { canvasAgentSystem } from './canvas-agent/manifest.mjs';
import { CANVAS_AGENT_ACTION_SCHEMA, validateCanvasAgentActions } from './canvas-agent-actions.mjs';
import { CANVAS_GROK_ADMISSION_VERSION } from '../../js/shared/canvas-grok-admission.mjs';
import { canvasAssistantModelId, CANVAS_FABLE_MODEL, CANVAS_FABLE_ADMISSION_VERSION } from '../../js/shared/canvas-assistant-models.mjs';
import { canvasFablePayload } from './canvas-assistant-fable.mjs';

export const CANVAS_AGENT_DIALOGUE_VERSION = 2;
export const CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES = 64 * 1024;
export const CANVAS_AGENT_DIALOGUE_MAX_BYTES = 24 * 1024;
export const CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS = 4096;
const CANVAS_AGENT_BRIEF_FIELDS_V1 = Object.freeze(['story', 'characters', 'setting', 'chronology', 'style', 'mood', 'pacing',
  'format', 'camera', 'audio', 'mustHaves', 'exclusions', 'audience', 'motivation', 'delegatedChoices']);
export const CANVAS_AGENT_BRIEF_FIELDS = Object.freeze([...CANVAS_AGENT_BRIEF_FIELDS_V1, 'latestInstruction']);
export const CANVAS_AGENT_BRIEF_PROVENANCE = Object.freeze(['user_stated', 'delegated', 'assistant_proposed', 'corrected', 'unresolved']);
const str = (maxLength, minLength = 0) => ({ type: 'string', maxLength, minLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const oneOf = values => ({ type: 'string', enum: values });
export const CANVAS_AGENT_DIALOGUE_SCHEMA_V1 = obj({
  text: str(6000, 1), scope: oneOf(['canvas', 'mixed', 'off_topic']),
  intent: oneOf(['continue', 'ready', 'save', 'cancel', 'status']),
  updates: list(obj({ field: oneOf([...CANVAS_AGENT_BRIEF_FIELDS_V1, 'duration']), value: str(1000),
    provenance: oneOf(CANVAS_AGENT_BRIEF_PROVENANCE), sourceMessageId: str(96, 8) }), 16),
  questions: list(str(800, 1), 2),
});
export const CANVAS_AGENT_DIALOGUE_SCHEMA = obj({ ...CANVAS_AGENT_DIALOGUE_SCHEMA_V1.properties,
  updates: list(obj({ field: oneOf([...CANVAS_AGENT_BRIEF_FIELDS, 'duration']), value: str(1000),
    provenance: oneOf(CANVAS_AGENT_BRIEF_PROVENANCE), sourceMessageId: str(96, 8) }), 16),
  actions: list(CANVAS_AGENT_ACTION_SCHEMA, 4) });
export const canvasAgentDialogueSchema = version => version === 1 ? CANVAS_AGENT_DIALOGUE_SCHEMA_V1 : CANVAS_AGENT_DIALOGUE_SCHEMA;
export const CANVAS_AGENT_DIALOGUE_SYSTEM = canvasAgentSystem('briefing');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const fail = (code = 'canvas_agent_dialogue_invalid') => { throw Object.assign(new TypeError(code), { code, status: 400, outcome: 'not_submitted' }); };

export function validateCanvasAgentBrief(value) {
  if (!exact(value, ['version', 'fields', 'duration', 'openQuestions', 'revision']) || value.version !== 1 || !revision(value.revision)
    || !object(value.fields) || Object.keys(value.fields).some(key => !CANVAS_AGENT_BRIEF_FIELDS.includes(key))
    || !Array.isArray(value.openQuestions) || value.openQuestions.length > 8 || value.openQuestions.some(question => !safeText(question, 800, 1))) fail('canvas_agent_brief_context_invalid');
  for (const entry of Object.values(value.fields)) {
    if (!exact(entry, ['value', 'provenance', 'sourceMessageId', 'revision']) || !safeText(entry.value, 1000)
      || !CANVAS_AGENT_BRIEF_PROVENANCE.includes(entry.provenance) || !safeId(entry.sourceMessageId)
      || !revision(entry.revision) || entry.revision > value.revision) fail('canvas_agent_brief_context_invalid');
  }
  const duration = value.duration;
  if (!exact(duration, ['targetDurationSeconds', 'choice', 'asked', 'sourceMessageId']) || typeof duration.asked !== 'boolean'
    || ![null, 'explicit', 'delegated'].includes(duration.choice)
    || duration.targetDurationSeconds !== null && (!Number.isFinite(duration.targetDurationSeconds) || duration.targetDurationSeconds < 1 || duration.targetDurationSeconds > 180)
    || duration.sourceMessageId !== null && !safeId(duration.sourceMessageId)
    || duration.choice === null && (duration.targetDurationSeconds !== null || duration.sourceMessageId !== null)
    || duration.choice !== null && duration.sourceMessageId === null
    || duration.choice === 'explicit' && duration.targetDurationSeconds === null) fail('canvas_agent_brief_context_invalid');
  return structuredClone(value);
}

export function validateCanvasAgentDialogue(value, { messageId, dialogueVersion, projectRevision, explanation = false } = {}) {
  const version = dialogueVersion ?? (Object.hasOwn(value || {}, 'actions') ? 2 : 1);
  if (![1, 2].includes(version) || !exact(value, ['text', 'scope', 'intent', 'updates', 'questions', ...(version === 2 ? ['actions'] : [])]) || !safeText(value.text, 6000, 1)
    || !['canvas', 'mixed', 'off_topic'].includes(value.scope) || !['continue', 'ready', 'save', 'cancel', 'status'].includes(value.intent)
    || !Array.isArray(value.updates) || value.updates.length > 16 || !Array.isArray(value.questions) || value.questions.length > 2
    || value.questions.some(question => !safeText(question, 800, 1))) fail();
  for (const update of value.updates) {
    if (!exact(update, ['field', 'value', 'provenance', 'sourceMessageId']) || ![...(version === 1 ? CANVAS_AGENT_BRIEF_FIELDS_V1 : CANVAS_AGENT_BRIEF_FIELDS), 'duration'].includes(update.field)
      || !safeText(update.value, 1000) || !CANVAS_AGENT_BRIEF_PROVENANCE.includes(update.provenance) || !safeId(update.sourceMessageId)
      || messageId !== undefined && update.sourceMessageId !== messageId) fail();
  }
  if (new Set(value.updates.map(update => update.field)).size !== value.updates.length
    || ['status'].includes(value.intent) && value.updates.length || value.scope === 'off_topic' && (value.updates.length || value.intent !== 'continue')
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > CANVAS_AGENT_DIALOGUE_MAX_BYTES) fail();
  if (version === 2) {
    validateCanvasAgentActions(value.actions, {projectRevision});
    if (value.scope === 'off_topic' && value.actions.length) fail();
  }
  if (explanation && (version !== 2 || value.scope !== 'canvas' || value.intent !== 'status'
    || value.updates.length || value.questions.length || value.actions.length)) fail();
  return structuredClone(value);
}

// Shared by quote admission and the AI adapter. No second approximate prompt
// or omitted history/schema: these exact strings become provider messages.
export function canvasAgentDialogueMessages(input) {
  const { locale, conversationRevision, briefRevision, projectRevision, message, brief, recentMessages, capabilities, currentProject } = input;
  const phase = input.policy?.phase === 'explanation' ? 'explanation' : 'briefing';
  return [{ role: 'system', content: canvasAgentSystem(phase, input.policy?.version || (input.version === 1 ? 'canvas-policy-1' : undefined)) }, { role: 'user', content: JSON.stringify({
    locale, conversationRevision, briefRevision, projectRevision, message, brief, recentMessages, capabilities, currentProject,
  }) }];
}
export function dialoguePriceInput(input) {
  const messages = canvasAgentDialogueMessages(input);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CANVAS_AGENT_DIALOGUE_INPUT_MAX_BYTES) fail('canvas_agent_dialogue_context_limit');
  const model = canvasAssistantModelId(input.model);
  if (model === CANVAS_FABLE_MODEL) {
    const payload = canvasFablePayload(messages, canvasAgentDialogueSchema(input.version), CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS, 'low');
    return { model, prompt: JSON.stringify(payload.messages), system: payload.system + JSON.stringify(payload.output_config.format.schema),
      maxTokens: payload.max_tokens, canvasFableAdmission: CANVAS_FABLE_ADMISSION_VERSION };
  }
  return { model, prompt: messages[1].content,
    system: messages[0].content + JSON.stringify(canvasAgentDialogueSchema(input.version)), maxTokens: CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS,
    canvasGrokAdmission: CANVAS_GROK_ADMISSION_VERSION };
}

export const validateCanvasAgentDialogueReply = validateCanvasAgentDialogue;
