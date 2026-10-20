import {
  GROK_4_7_MODEL_ID, CANVAS_AGENT_PLAN_VERSION, CANVAS_AGENT_PLAN_SCHEMA,
  CANVAS_AGENT_PLAN_INPUT_MAX_BYTES, CANVAS_AGENT_PLAN_MAX_BYTES,
  CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS, validateCanvasAgentPlan,
  CANVAS_AGENT_EVALUATION_SCHEMA, CANVAS_AGENT_EVALUATION_SYSTEM, CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS,
  CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES, CANVAS_AGENT_EVALUATION_FRAME_TOTAL_BYTES, validateCanvasAgentEvaluation,
  CANVAS_AGENT_REASONING_SUMMARY_DELIVERY, canvasAgentReasoningSummary,
  canvasAgentPlanSystem,
} from '../../../shared/canvas-agent-plan.mjs';
import { CANVAS_AGENT_DIALOGUE_VERSION, CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS, validateCanvasAgentDialogue } from '../../../shared/canvas-agent-dialogue.mjs';
import { CANVAS_AGENT_POLICY_VERSION, canvasAgentSystem, canvasAgentPolicyIdentity, validateCanvasAgentPolicyIdentity } from '../../../shared/canvas-agent/manifest.mjs';
import { validateCanvasAgentDialogueInput, buildCanvasAgentDialoguePayload, canvasAgentDialogueContext,
  validateCanvasAgentDialogueContext } from './canvas-agent-dialogue.js';
import { normalizeCanvasGrokUsage, canvasGrokLimitDiagnostic, CANVAS_GROK_METERING_VERSION } from '../../../shared/canvas-agent-metering.mjs';
import { runWithGenerationTimeout } from './generation-timeout.js';
import { CANVAS_ASSISTANT_MODEL_VERSION, CANVAS_FABLE_MODEL, CANVAS_FABLE_ADMISSION_VERSION, canvasAssistantModel, canvasAssistantModelId } from '../../../../js/shared/canvas-assistant-models.mjs';
import { canvasFablePayload, canvasFableResponse } from '../../../shared/canvas-assistant-fable.mjs';

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
export const CANVAS_AGENT_MODEL_PROTOCOL_VERSION = 1;
export const CANVAS_AGENT_NORMALIZE_MAX_BYTES = 512 * 1024;
function validateBudget(budget) {
  const fields = ['capCredits', 'chargedCredits', 'reservedCredits', 'pendingOutcomeCredits', 'committedCredits', 'remainingCredits', 'allocatedCredits', 'revision'];
  if (!object(budget) || Object.keys(budget).some(key => ![...fields, 'planningCeilingCredits'].includes(key))
    || fields.some(key => !Number.isSafeInteger(budget[key]) || budget[key] < 0) || budget.capCredits < 1
    || budget.planningCeilingCredits !== undefined && (!Number.isSafeInteger(budget.planningCeilingCredits) || budget.planningCeilingCredits < 0)
    || budget.chargedCredits > budget.committedCredits || budget.reservedCredits > budget.committedCredits
    || budget.pendingOutcomeCredits > budget.reservedCredits || budget.remainingCredits !== Math.max(0, budget.capCredits - budget.committedCredits)) invalid('canvas_agent_budget_context_invalid');
}
function validateRepair(repair) {
  if (!object(repair) || Object.keys(repair).some(key => !['attempt', 'issues', 'previousPlan'].includes(key))
    || !Number.isSafeInteger(repair.attempt) || repair.attempt < 1 || repair.attempt > 2
    || !Array.isArray(repair.issues) || !repair.issues.length || repair.issues.length > 16
    || !object(repair.previousPlan) || new TextEncoder().encode(JSON.stringify(repair.previousPlan)).byteLength > CANVAS_AGENT_PLAN_MAX_BYTES) invalid('canvas_agent_repair_context_invalid');
  for (const issue of repair.issues) {
    if (!object(issue) || Object.keys(issue).some(key => !['code', 'nodeKey', 'modelId', 'field', 'message', 'allowed'].includes(key))
      || typeof issue.code !== 'string' || !/^[a-z0-9_]{1,100}$/.test(issue.code)
      || ['nodeKey', 'modelId', 'field'].some(key => issue[key] !== undefined && (typeof issue[key] !== 'string' || !issue[key].length || issue[key].length > 180 || /[\u0000-\u001f\u007f]/.test(issue[key])))
      || issue.message !== undefined && (typeof issue.message !== 'string' || !issue.message.length || issue.message.length > 800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(issue.message))
      || issue.allowed !== undefined && (!Array.isArray(issue.allowed) || issue.allowed.length > 16 || issue.allowed.some(value => typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)))) invalid('canvas_agent_repair_context_invalid');
  }
}
export function validateCanvasAgentPlanInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['version', 'model', 'requestId', 'brief', 'targetDurationSeconds',
    'toleranceSeconds', 'durationMode', 'budget', 'repair', 'capabilityRevision', 'capabilities', 'projectRevision', 'currentProject', 'privacyUser', 'promptCacheKey', 'policy'].includes(key))) invalid('canvas_agent_input_invalid');
  if (input.version !== CANVAS_AGENT_PLAN_VERSION || !canvasAssistantModel(input.model)) invalid('canvas_agent_model_invalid');
  // Creative duration belongs to the new authorized production contract. Keep
  // old accepted contexts valid for late reconciliation and legacy callers.
  if (input.durationMode !== undefined && !['creative', 'exact'].includes(input.durationMode)) invalid('canvas_agent_duration_mode_invalid');
  const creative = input.durationMode === 'creative';
  if (!(creative && input.targetDurationSeconds == null)
    && (!Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds < 1 || input.targetDurationSeconds > (creative ? 180 : 600))) invalid('canvas_agent_duration_required');
  if (!(creative && input.toleranceSeconds === undefined)
    && (!Number.isFinite(input.toleranceSeconds) || input.toleranceSeconds < .04 || input.toleranceSeconds > 2)) invalid('canvas_agent_tolerance_invalid');
  if (creative || input.budget !== undefined) validateBudget(input.budget);
  if (input.repair !== undefined) validateRepair(input.repair);
  if (input.policy !== undefined) { try { validateCanvasAgentPolicyIdentity(input.policy); } catch { invalid('canvas_agent_policy_identity_invalid'); } }
  if (typeof input.brief !== 'string' || !input.brief.trim() || input.brief.length > 12000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.brief)) invalid('canvas_agent_brief_invalid');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(input.requestId) || !revision(input.projectRevision) || !revision(input.capabilityRevision)) invalid('canvas_agent_identity_invalid');
  if (!/^(?:cau|vau)_[a-f0-9]{64}$/.test(input.privacyUser || '') || !/^(?:cap|gpc)_[a-f0-9]{64}$/.test(input.promptCacheKey || '')) invalid('canvas_agent_privacy_identity_invalid');
  if (!object(input.currentProject) || !Array.isArray(input.currentProject.nodes) || input.currentProject.nodes.length > 120
    || !(object(input.capabilities) || Array.isArray(input.capabilities))) invalid('canvas_agent_context_invalid');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CANVAS_AGENT_PLAN_INPUT_MAX_BYTES) invalid('canvas_agent_input_too_large');
  return structuredClone(input);
}

export function canvasAgentProviderReadiness(env, modelId = GROK_4_7_MODEL_ID) {
  const descriptor = canvasAssistantModel(modelId);
  const contract = { model: modelId, accountAccess: 'unverified', protocolVersion: CANVAS_AGENT_MODEL_PROTOCOL_VERSION,
    transport: 'cloudflare-background', reasoningSummaryDelivery: CANVAS_AGENT_REASONING_SUMMARY_DELIVERY,
    dialogueVersion: CANVAS_AGENT_DIALOGUE_VERSION, policyVersion: CANVAS_AGENT_POLICY_VERSION };
  if (!descriptor) return { available: false, reason: 'canvas_agent_model_invalid', ...contract };
  if (modelId === GROK_4_7_MODEL_ID && env?.ENABLE_GROK_4_7 !== 'true') return { available: false, reason: 'canvas_agent_model_disabled', ...contract };
  if (typeof env?.AI?.run !== 'function') return { available: false, reason: 'ai_binding_missing', ...contract };
  return { available: true, reason: null, ...contract };
}

export function buildCanvasAgentPlanPayload(input) {
  const { brief, targetDurationSeconds, toleranceSeconds, durationMode, budget, repair, capabilityRevision, capabilities, projectRevision, currentProject } = input;
  const payload = {
    messages: [{ role: 'system', content: canvasAgentPlanSystem(input) }, { role: 'user', content: JSON.stringify({
      brief, targetDurationSeconds, toleranceSeconds, durationMode, budget, repair, capabilityRevision, capabilities, projectRevision, currentProject,
    }) }],
    reasoning_effort: 'medium', max_completion_tokens: CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'bitbi_canvas_production_v1', strict: true, schema: CANVAS_AGENT_PLAN_SCHEMA } },
    stream: false, user: input.privacyUser, prompt_cache_key: input.promptCacheKey,
  };
  return input.model === CANVAS_FABLE_MODEL ? canvasFablePayload(payload.messages, CANVAS_AGENT_PLAN_SCHEMA, CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS) : payload;
}

function normalizeCanvasStructuredResponse(raw, validate, invalidCode, modelId = GROK_4_7_MODEL_ID) {
  if (modelId === CANVAS_FABLE_MODEL) {
    const result = canvasFableResponse(raw);
    const reject = code => { throw new CanvasAgentProviderError(code, { outcome: 'completed', usage: result.usage, responseId: result.responseId }); };
    if (result.error) reject(result.error);
    if (new TextEncoder().encode(result.text).byteLength > CANVAS_AGENT_PLAN_MAX_BYTES) reject('canvas_agent_provider_response_invalid');
    let value; try { value = validate(JSON.parse(result.text)); } catch { reject(invalidCode); }
    return { value, usage: result.usage, responseId: result.responseId, model: modelId, outcome: 'completed' };
  }
  const response = object(raw?.result) ? raw.result : raw;
  const usage = normalizeCanvasGrokUsage(response?.usage);
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
  // Only the documented readable Grok 4.7 summary is projected, as a completed
  // snapshot. Hidden/encrypted fields and arbitrary provider payloads stay out.
  const reasoningSummary = canvasAgentReasoningSummary(response);
  return { value, usage, responseId, model: GROK_4_7_MODEL_ID, outcome: 'completed', ...(reasoningSummary ? { reasoningSummary } : {}) };
}
export function normalizeCanvasAgentPlanResponse(raw, input) {
  const { value, ...receipt } = normalizeCanvasStructuredResponse(raw, plan => validateCanvasAgentPlan(plan, {
    targetDurationSeconds: input.targetDurationSeconds, toleranceSeconds: input.toleranceSeconds,
    durationMode: input.durationMode,
    existingNodeIds: input.currentProject.nodes.map(node => node.id),
  }), 'canvas_agent_plan_invalid', input.model);
  return { plan: value, ...receipt };
}

async function checkedPolicy(input, phase) {
  const version = input.policy?.version || (phase === 'briefing' && input.version === 1 ? 'canvas-policy-1' : CANVAS_AGENT_POLICY_VERSION);
  // The no-action v1 contract and the action-capable v2 contract are distinct.
  // Preserve accepted v2/policy-2 requests without pairing a newer schema with
  // the historical policy that explicitly grants no action proposals.
  if (phase === 'briefing' && (input.version === 1 ? version !== 'canvas-policy-1' : version === 'canvas-policy-1')) invalid('canvas_agent_policy_changed');
  if (input.model === CANVAS_FABLE_MODEL && !['canvas-policy-3',CANVAS_AGENT_POLICY_VERSION].includes(version)) invalid('canvas_agent_policy_changed');
  let policy;
  try { policy = await canvasAgentPolicyIdentity(phase, version); } catch { invalid('canvas_agent_policy_changed'); }
  if (input.policy !== undefined && JSON.stringify(input.policy) !== JSON.stringify(policy)) invalid('canvas_agent_policy_changed');
  return policy;
}

export async function invokeCanvasAgentPlan(env, rawInput, { correlationId, signal } = {}) {
  const input = validateCanvasAgentPlanInput(rawInput);
  const readiness = canvasAgentProviderReadiness(env, input.model);
  if (!readiness.available) throw new CanvasAgentProviderError(readiness.reason, { status: 503, outcome: 'not_submitted' });
  const policy = await checkedPolicy(input, input.repair ? 'correction' : 'planning');
  try {
    // One submission only. The owning durable run persists its attempt before
    // calling this adapter; requestId is correlation, not a provider replay claim.
    const output = await runWithGenerationTimeout(providerSignal => env.AI.run(input.model, buildCanvasAgentPlanPayload(input), {
      signal: providerSignal,
      gateway: { id: env.AI_GATEWAY_ID || 'default', skipCache: true, collectLog: false,
        metadata: { surface: 'canvas-agent-plan', model_id: input.model, provider: canvasAssistantModel(input.model).provider,
          request_id: input.requestId, ...(typeof correlationId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(correlationId) ? { correlation_id: correlationId } : {}) } },
    }), { signal });
    return { ...normalizeCanvasAgentPlanResponse(output, input), policy };
  } catch (error) {
    if (error instanceof CanvasAgentProviderError) throw error;
    // HTTP failures and timeouts can occur after acceptance. No speculative
    // release or new paid attempt; the durable caller must reconcile/review.
    throw new CanvasAgentProviderError(error?.code === 'generation_timeout' ? 'canvas_agent_provider_timeout' : 'canvas_agent_provider_outcome_unknown');
  }
}

export function validateCanvasAgentEvaluationInput(input) {
  if (!object(input) || Object.keys(input).some(key => !['version', 'model', 'requestId', 'brief', 'privacyUser', 'promptCacheKey', 'frames', 'policy'].includes(key))) invalid('canvas_agent_input_invalid');
  if (input.version !== 1 || !canvasAssistantModel(input.model)?.vision) invalid('canvas_agent_model_invalid');
  if (input.policy !== undefined) { try { validateCanvasAgentPolicyIdentity(input.policy); } catch { invalid('canvas_agent_policy_identity_invalid'); } }
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(input.requestId) || !/^(?:cau|vau)_[a-f0-9]{64}$/.test(input.privacyUser || '') || !/^(?:cap|gpc)_[a-f0-9]{64}$/.test(input.promptCacheKey || '')) invalid('canvas_agent_identity_invalid');
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
  return { messages: [{ role: 'system', content: canvasAgentSystem('evaluation', input.policy?.version) }, { role: 'user', content: [
    { type: 'text', text: JSON.stringify({ brief: input.brief, frames: input.frames.map(({ imageData, ...frame }) => frame) }) },
    ...input.frames.flatMap(frame => [{ type: 'text', text: JSON.stringify({ nodeId: frame.nodeId, timeSeconds: frame.timeSeconds }) }, { type: 'image_url', image_url: { url: frame.imageData } }]),
  ] }], reasoning_effort: 'low', max_completion_tokens: CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_schema', json_schema: { name: 'bitbi_canvas_evaluation_v1', strict: true, schema: CANVAS_AGENT_EVALUATION_SCHEMA } },
    stream: false, user: input.privacyUser, prompt_cache_key: input.promptCacheKey };
}
export async function invokeCanvasAgentEvaluation(env, rawInput, { signal, correlationId } = {}) {
  const input = validateCanvasAgentEvaluationInput(rawInput), ready = canvasAgentProviderReadiness(env, input.model);
  if (!ready.available) throw new CanvasAgentProviderError(ready.reason, { status: 503, outcome: 'not_submitted' });
  const policy = await checkedPolicy(input, 'evaluation');
  try {
    const raw = await runWithGenerationTimeout(providerSignal => env.AI.run(input.model, buildCanvasAgentEvaluationPayload(input), {
      signal: providerSignal, gateway: { id: env.AI_GATEWAY_ID || 'default', skipCache: true, collectLog: false,
        metadata: { surface: 'canvas-agent-evaluation', model_id: input.model, provider: canvasAssistantModel(input.model).provider, request_id: input.requestId,
          ...(typeof correlationId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(correlationId) ? { correlation_id: correlationId } : {}) } },
    }), { signal });
    const { value, ...receipt } = normalizeCanvasStructuredResponse(raw, value => validateCanvasAgentEvaluation(value, input.frames), 'canvas_agent_evaluation_invalid');
    return { evaluation: value, ...receipt, policy };
  } catch (error) {
    if (error instanceof CanvasAgentProviderError) throw error;
    throw new CanvasAgentProviderError(error?.code === 'generation_timeout' ? 'canvas_agent_provider_timeout' : 'canvas_agent_provider_outcome_unknown');
  }
}

function validateNormalizationContext(kind, context) {
  const reject = () => { throw new CanvasAgentProviderError('canvas_agent_normalization_context_invalid', { status: 400 }); };
  if (!object(context)) reject();
  const policy = context.policy;
  const model = context.model ?? GROK_4_7_MODEL_ID;
  if (!canvasAssistantModel(model) || context.modelContractVersion !== undefined && context.modelContractVersion !== CANVAS_ASSISTANT_MODEL_VERSION
    || model === CANVAS_FABLE_MODEL && (context.modelContractVersion !== CANVAS_ASSISTANT_MODEL_VERSION || kind === 'evaluate')) reject();
  context = Object.fromEntries(Object.entries(context).filter(([key]) => !['model', 'modelContractVersion'].includes(key)));
  const metering = context.metering;
  if (metering !== undefined) {
    const limit = kind === 'plan' ? CANVAS_AGENT_PLAN_MAX_OUTPUT_TOKENS
      : kind === 'dialogue' ? CANVAS_AGENT_DIALOGUE_MAX_OUTPUT_TOKENS : CANVAS_AGENT_EVALUATION_MAX_OUTPUT_TOKENS;
    if (!object(metering) || Object.keys(metering).sort().join(',') !== 'maxCompletionTokens,version'
      || metering.version !== (model === CANVAS_FABLE_MODEL ? CANVAS_FABLE_ADMISSION_VERSION : CANVAS_GROK_METERING_VERSION) || metering.maxCompletionTokens !== limit) reject();
    context = Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'metering'));
  }
  if (policy !== undefined) {
    try { validateCanvasAgentPolicyIdentity(policy); } catch { reject(); }
    context = Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'policy'));
  }
  if (kind === 'plan') {
    const creative = context.durationMode === 'creative';
    if (Object.keys(context).some(key => !['targetDurationSeconds', 'toleranceSeconds', 'durationMode', 'existingNodeIds'].includes(key))
      || context.durationMode !== undefined && !['creative', 'exact'].includes(context.durationMode)
      || !(creative && context.targetDurationSeconds === null) && (!Number.isFinite(context.targetDurationSeconds) || context.targetDurationSeconds < 1 || context.targetDurationSeconds > (creative ? 180 : 600))
      || !(creative && context.toleranceSeconds === undefined) && (!Number.isFinite(context.toleranceSeconds) || context.toleranceSeconds < .04 || context.toleranceSeconds > 2)
      || !Array.isArray(context.existingNodeIds) || context.existingNodeIds.length > 120
      || context.existingNodeIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
      || new Set(context.existingNodeIds).size !== context.existingNodeIds.length) reject();
  } else if (kind === 'evaluate') {
    if (Object.keys(context).some(key => key !== 'frames') || !Array.isArray(context.frames)
      || context.frames.length < 1 || context.frames.length > 8) reject();
    const counts = new Map();
    for (const frame of context.frames) {
      if (!object(frame) || Object.keys(frame).some(key => !['nodeId', 'timeSeconds'].includes(key))
        || typeof frame.nodeId !== 'string' || !/^[a-f0-9]{32}$/.test(frame.nodeId)
        || !Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0 || frame.timeSeconds > 600) reject();
      counts.set(frame.nodeId, (counts.get(frame.nodeId) || 0) + 1);
      if (counts.get(frame.nodeId) > 2) reject();
    }
  } else if (kind === 'dialogue') {
    try { context = validateCanvasAgentDialogueContext(context); } catch { reject(); }
  } else reject();
  return structuredClone({ ...context, model, ...(policy !== undefined ? { policy } : {}), ...(metering !== undefined ? { metering } : {}) });
}

// Auth owns durable dispatch, the background webhook and the original usage
// attempt. These signed adapters perform no provider call and retain no frames.
// https://developers.cloudflare.com/ai-gateway/usage/rest-api/
export async function prepareCanvasAgentModel(env, envelope) {
  if (!object(envelope) || Object.keys(envelope).some(key => !['kind', 'input'].includes(key))
    || !['plan', 'evaluate', 'dialogue'].includes(envelope.kind)) invalid('canvas_agent_input_invalid');
  const { kind } = envelope;
  let input;
  try { input = (kind === 'plan' ? validateCanvasAgentPlanInput : kind === 'dialogue' ? validateCanvasAgentDialogueInput : validateCanvasAgentEvaluationInput)(envelope.input); }
  catch (error) { if (error instanceof CanvasAgentProviderError) throw error; invalid(error?.code || 'canvas_agent_input_invalid'); }
  const ready = canvasAgentProviderReadiness(env, input.model);
  if (!ready.available) throw new CanvasAgentProviderError(ready.reason, { status: 503, outcome: 'not_submitted' });
  const phase = kind === 'dialogue' ? 'briefing' : kind === 'evaluate' ? 'evaluation' : input.repair ? 'correction' : 'planning';
  const policy = await checkedPolicy(input, phase);
  const validationContext = kind === 'plan'
    ? { targetDurationSeconds: input.targetDurationSeconds ?? null, ...(input.toleranceSeconds !== undefined ? { toleranceSeconds: input.toleranceSeconds } : {}),
      ...(input.durationMode !== undefined ? { durationMode: input.durationMode } : {}), existingNodeIds: input.currentProject.nodes.map(node => node?.id) }
    : kind === 'dialogue' ? canvasAgentDialogueContext(input) : { frames: input.frames.map(({ nodeId, timeSeconds }) => ({ nodeId, timeSeconds })) };
  const providerInput = (kind === 'plan' ? buildCanvasAgentPlanPayload : kind === 'dialogue' ? buildCanvasAgentDialoguePayload : buildCanvasAgentEvaluationPayload)(input);
  const context = { ...validationContext, policy, model: input.model, modelContractVersion: CANVAS_ASSISTANT_MODEL_VERSION, metering: {
    version: canvasAssistantModel(input.model).meteringVersion, maxCompletionTokens: providerInput.max_completion_tokens ?? providerInput.max_tokens,
  } };
  try { validateNormalizationContext(kind, context); }
  catch { invalid('canvas_agent_context_invalid'); }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return { protocolVersion: CANVAS_AGENT_MODEL_PROTOCOL_VERSION, model: input.model,
    input: providerInput,
    requestId: input.requestId, inputDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), context, policy };
}

export function normalizeCanvasAgentModel(envelope) {
  // Validation is deliberately independent of current model enablement. A
  // disabled model must still allow already accepted work to be accounted for.
  if (!object(envelope) || Object.keys(envelope).some(key => !['kind', 'requestId', 'context', 'response'].includes(key))
    || !['plan', 'evaluate', 'dialogue'].includes(envelope.kind) || typeof envelope.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{8,96}$/.test(envelope.requestId) || !object(envelope.response)) {
    throw new CanvasAgentProviderError('canvas_agent_normalization_input_invalid', { status: 400 });
  }
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > CANVAS_AGENT_NORMALIZE_MAX_BYTES) {
    throw new CanvasAgentProviderError('canvas_agent_normalization_input_too_large', { status: 413 });
  }
  const context = validateNormalizationContext(envelope.kind, envelope.context);
  const plan = envelope.kind === 'plan', dialogue = envelope.kind === 'dialogue';
  try {
    const { value, ...receipt } = normalizeCanvasStructuredResponse(envelope.response,
      result => plan ? validateCanvasAgentPlan(result, context) : dialogue ? validateCanvasAgentDialogue(result, context) : validateCanvasAgentEvaluation(result, context.frames),
      plan ? 'canvas_agent_plan_invalid' : dialogue ? 'canvas_agent_dialogue_invalid' : 'canvas_agent_evaluation_invalid', context.model);
    // Briefing never projects provider reasoning into a pretend conversation.
    if (dialogue) delete receipt.reasoningSummary;
    return { [plan ? 'plan' : dialogue ? 'dialogue' : 'evaluation']: value, ...receipt, requestId: envelope.requestId,
      ...(context.metering && context.model === GROK_4_7_MODEL_ID ? { usageDiagnostic: canvasGrokLimitDiagnostic(receipt.usage, context.metering.maxCompletionTokens) } : {}),
      ...(context.policy ? { policy: context.policy } : {}) };
  } catch (error) {
    if (error instanceof CanvasAgentProviderError && error.outcome === 'completed') {
      Object.assign(error, { requestId: envelope.requestId, model: context.model });
      if (context.metering && context.model === GROK_4_7_MODEL_ID && error.usage) error.usageDiagnostic = canvasGrokLimitDiagnostic(error.usage, context.metering.maxCompletionTokens);
    }
    throw error;
  }
}
