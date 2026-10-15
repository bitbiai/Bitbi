import {
  GROK_4_7_MODEL_ID, CANVAS_AGENT_PLAN_VERSION, CANVAS_AGENT_PLAN_SCHEMA,
  CANVAS_AGENT_PLAN_SYSTEM, CANVAS_AGENT_PLAN_INPUT_MAX_BYTES, CANVAS_AGENT_PLAN_MAX_BYTES,
  CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS, validateCanvasAgentPlan,
  CANVAS_AGENT_EVALUATION_SCHEMA, CANVAS_AGENT_EVALUATION_SYSTEM, CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS,
  CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES, CANVAS_AGENT_EVALUATION_FRAME_TOTAL_BYTES, validateCanvasAgentEvaluation,
} from '../../../shared/canvas-agent-plan.mjs';
import { normalizeGrokUsage } from './openai-chat-stream.js';
import { runWithGenerationTimeout } from './generation-timeout.js';

export class CanvasAgentProviderError extends Error {
  constructor(code, { status = 502, outcome = 'unknown', usage = null, responseId = null } = {}) {
    super(code);
    this.name = 'CanvasAgentProviderError';
    Object.assign(this, { code, status, outcome, usage, responseId, retryable: false });
  }
}
const invalid = code => { throw new CanvasAgentProviderError(code, { status: 400, outcome: 'not_submitted' }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const revision = value => Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value);
export function validateCanvasAgentPlanInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['version', 'model', 'requestId', 'brief', 'targetDurationSeconds',
    'toleranceSeconds', 'capabilityRevision', 'capabilities', 'projectRevision', 'currentProject', 'privacyUser', 'promptCacheKey'].includes(key))) invalid('canvas_agent_input_invalid');
  if (input.version !== CANVAS_AGENT_PLAN_VERSION || input.model !== GROK_4_7_MODEL_ID) invalid('canvas_agent_model_invalid');
  // A model prompt cannot supply or default a missing duration. The auth caller
  // must have recorded the user's duration or explicit delegation before here.
  if (!Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds < 1 || input.targetDurationSeconds > 600) invalid('canvas_agent_duration_required');
  if (!Number.isFinite(input.toleranceSeconds) || input.toleranceSeconds < .04 || input.toleranceSeconds > 2) invalid('canvas_agent_tolerance_invalid');
  if (typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 12000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.brief)) invalid('canvas_agent_brief_invalid');
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(input.requestId || '') || !revision(input.projectRevision) || !revision(input.capabilityRevision)) invalid('canvas_agent_identity_invalid');
  if (!/^(?:cau|vau)_[a-f0-9]{64}$/.test(input.privacyUser || '') || !/^(?:cap|gpc)_[a-f0-9]{64}$/.test(input.promptCacheKey || '')) invalid('canvas_agent_privacy_identity_invalid');
  if (!object(input.currentProject) || !Array.isArray(input.currentProject.nodes) || input.currentProject.nodes.length > 120
    || !(object(input.capabilities) || Array.isArray(input.capabilities))) invalid('canvas_agent_context_invalid');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CANVAS_AGENT_PLAN_INPUT_MAX_BYTES) invalid('canvas_agent_input_too_large');
  return structuredClone(input);
}

export function canvasAgentProviderReadiness(env) {
  if (env?.ENABLE_GROK_4_7 !== 'true') return { available: false, reason: 'canvas_agent_model_disabled', model: GROK_4_7_MODEL_ID, accountAccess: 'unverified' };
  if (typeof env?.AI?.run !== 'function') return { available: false, reason: 'ai_binding_missing', model: GROK_4_7_MODEL_ID, accountAccess: 'unverified' };
  return { available: true, reason: null, model: GROK_4_7_MODEL_ID, accountAccess: 'unverified' };
}

export function buildCanvasAgentPlanPayload(input) {
  const { brief, targetDurationSeconds, toleranceSeconds, capabilityRevision, capabilities, projectRevision, currentProject } = input;
  return {
    messages: [{ role: 'system', content: CANVAS_AGENT_PLAN_SYSTEM }, { role: 'user', content: JSON.stringify({
      brief, targetDurationSeconds, toleranceSeconds, capabilityRevision, capabilities, projectRevision, currentProject,
    }) }],
    reasoning_effort: 'medium', max_completion_tokens: CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'bitbi_canvas_production_v1', strict: true, schema: CANVAS_AGENT_PLAN_SCHEMA } },
    stream: false, user: input.privacyUser, prompt_cache_key: input.promptCacheKey,
  };
}

function checkedUsage(value) {
  if (!object(value) || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    || value.total_tokens < value.prompt_tokens + value.completion_tokens) return null;
  for (const [group, key] of [['prompt_tokens_details', 'cached_tokens'], ['completion_tokens_details', 'reasoning_tokens']]) {
    if (value[group]?.[key] !== undefined && (!Number.isSafeInteger(value[group][key]) || value[group][key] < 0)) return null;
  }
  if ((value.prompt_tokens_details?.cached_tokens || 0) > value.prompt_tokens) return null;
  return normalizeGrokUsage(value);
}

function normalizeCanvasStructuredResponse(raw, validate, invalidCode) {
  const response = object(raw?.result) ? raw.result : raw;
  const usage = checkedUsage(response?.usage);
  const responseId = typeof response?.id === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(response.id) ? response.id : null;
  const rejected = code => { throw new CanvasAgentProviderError(code, { outcome: 'completed', usage, responseId }); };
  if (!object(response) || !['grok-4.7', GROK_4_7_MODEL_ID].includes(response.model)
    || !responseId || response.error || response.object !== 'chat.completion'
    || !Array.isArray(response.choices) || response.choices.length !== 1) rejected('canvas_agent_provider_response_invalid');
  const choice = response.choices[0], message = choice?.message;
  if (message?.refusal || choice?.finish_reason === 'content_filter') rejected('canvas_agent_provider_refused');
  if (choice?.finish_reason === 'length') rejected('canvas_agent_output_limit');
  if (choice?.finish_reason !== 'stop' || message?.role !== 'assistant' || message.tool_calls?.length
    || typeof message.content !== 'string' || new TextEncoder().encode(message.content).byteLength > CANVAS_AGENT_PLAN_MAX_BYTES) rejected('canvas_agent_provider_response_invalid');
  if (!usage) rejected('canvas_agent_provider_usage_missing');
  let value;
  try {
    value = validate(JSON.parse(message.content));
  } catch { rejected(invalidCode); }
  // Hidden reasoning and arbitrary provider fields never enter Canvas history.
  return { value, usage, responseId, model: GROK_4_7_MODEL_ID, outcome: 'completed' };
}
export function normalizeCanvasAgentPlanResponse(raw, input) {
  const { value, ...receipt } = normalizeCanvasStructuredResponse(raw, plan => validateCanvasAgentPlan(plan, {
    targetDurationSeconds: input.targetDurationSeconds, toleranceSeconds: input.toleranceSeconds,
    existingNodeIds: input.currentProject.nodes.map(node => node.id),
  }), 'canvas_agent_plan_invalid');
  return { plan: value, ...receipt };
}

export async function invokeCanvasAgentPlan(env, rawInput, { correlationId, signal } = {}) {
  const input = validateCanvasAgentPlanInput(rawInput);
  const readiness = canvasAgentProviderReadiness(env);
  if (!readiness.available) throw new CanvasAgentProviderError(readiness.reason, { status: 503, outcome: 'not_submitted' });
  try {
    // One submission only. The owning durable run persists its attempt before
    // calling this adapter; requestId is correlation, not a provider replay claim.
    const output = await runWithGenerationTimeout(providerSignal => env.AI.run(GROK_4_7_MODEL_ID, buildCanvasAgentPlanPayload(input), {
      signal: providerSignal,
      gateway: { id: env.AI_GATEWAY_ID || 'default', skipCache: true, collectLog: false,
        metadata: { surface: 'canvas-agent-plan', model_id: GROK_4_7_MODEL_ID, provider: 'xai',
          request_id: input.requestId, ...(typeof correlationId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(correlationId) ? { correlation_id: correlationId } : {}) } },
    }), { signal, timeoutMs: 180000 });
    return normalizeCanvasAgentPlanResponse(output, input);
  } catch (error) {
    if (error instanceof CanvasAgentProviderError) throw error;
    // HTTP failures and timeouts can occur after acceptance. No speculative
    // release or new paid attempt; the durable caller must reconcile/review.
    throw new CanvasAgentProviderError(error?.code === 'generation_timeout' ? 'canvas_agent_provider_timeout' : 'canvas_agent_provider_outcome_unknown');
  }
}

export function validateCanvasAgentEvaluationInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['version', 'model', 'requestId', 'brief', 'privacyUser', 'promptCacheKey', 'frames'].includes(key))) invalid('canvas_agent_input_invalid');
  if (input.version !== 1 || input.model !== GROK_4_7_MODEL_ID) invalid('canvas_agent_model_invalid');
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(input.requestId || '') || !/^(?:cau|vau)_[a-f0-9]{64}$/.test(input.privacyUser || '') || !/^(?:cap|gpc)_[a-f0-9]{64}$/.test(input.promptCacheKey || '')) invalid('canvas_agent_identity_invalid');
  if (typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 12000 || !Array.isArray(input.frames) || input.frames.length < 1 || input.frames.length > 8) invalid('canvas_agent_evaluation_input_invalid');
  const counts = new Map(); let total = 0;
  for (const frame of input.frames) {
    if (!object(frame) || Object.keys(frame).some(key => !['nodeId', 'timeSeconds', 'requirement', 'imageData'].includes(key))
      || !/^[a-f0-9]{32}$/.test(frame.nodeId || '') || typeof frame.requirement !== 'string' || !frame.requirement.trim() || frame.requirement.length > 2000
      || !Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0 || frame.timeSeconds > 600
      || typeof frame.imageData !== 'string' || frame.imageData.length > 96 * 1024 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.imageData)) invalid('canvas_agent_evaluation_input_invalid');
    total += frame.imageData.length; counts.set(frame.nodeId, (counts.get(frame.nodeId) || 0) + 1);
    if (counts.get(frame.nodeId) > 2) invalid('canvas_agent_evaluation_sample_limit');
  }
  if (total > CANVAS_AGENT_EVALUATION_FRAME_TOTAL_BYTES || new TextEncoder().encode(JSON.stringify(input)).byteLength > CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES) invalid('canvas_agent_input_too_large');
  return structuredClone(input);
}
export function buildCanvasAgentEvaluationPayload(input) {
  return { messages: [{ role: 'system', content: CANVAS_AGENT_EVALUATION_SYSTEM }, { role: 'user', content: [
    { type: 'text', text: JSON.stringify({ brief: input.brief, frames: input.frames.map(({ imageData, ...frame }) => frame) }) },
    ...input.frames.flatMap(frame => [{ type: 'text', text: JSON.stringify({ nodeId: frame.nodeId, timeSeconds: frame.timeSeconds }) }, { type: 'image_url', image_url: { url: frame.imageData } }]),
  ] }], reasoning_effort: 'low', max_completion_tokens: CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'bitbi_canvas_evaluation_v1', strict: true, schema: CANVAS_AGENT_EVALUATION_SCHEMA } },
    stream: false, user: input.privacyUser, prompt_cache_key: input.promptCacheKey };
}
export async function invokeCanvasAgentEvaluation(env, rawInput, { signal, correlationId } = {}) {
  const input = validateCanvasAgentEvaluationInput(rawInput), ready = canvasAgentProviderReadiness(env);
  if (!ready.available) throw new CanvasAgentProviderError(ready.reason, { status: 503, outcome: 'not_submitted' });
  try {
    const raw = await runWithGenerationTimeout(providerSignal => env.AI.run(GROK_4_7_MODEL_ID, buildCanvasAgentEvaluationPayload(input), {
      signal: providerSignal, gateway: { id: env.AI_GATEWAY_ID || 'default', skipCache: true, collectLog: false,
        metadata: { surface: 'canvas-agent-evaluation', model_id: GROK_4_7_MODEL_ID, provider: 'xai', request_id: input.requestId,
          ...(typeof correlationId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(correlationId) ? { correlation_id: correlationId } : {}) } },
    }), { signal, timeoutMs: 180000 });
    const { value, ...receipt } = normalizeCanvasStructuredResponse(raw, value => validateCanvasAgentEvaluation(value, input.frames), 'canvas_agent_evaluation_invalid');
    return { evaluation: value, ...receipt };
  } catch (error) {
    if (error instanceof CanvasAgentProviderError) throw error;
    throw new CanvasAgentProviderError(error?.code === 'generation_timeout' ? 'canvas_agent_provider_timeout' : 'canvas_agent_provider_outcome_unknown');
  }
}
