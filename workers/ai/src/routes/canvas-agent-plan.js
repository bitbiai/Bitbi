import { readJsonBodyLimited, isRequestBodyError } from '../../../../js/shared/request-body.mjs';
import { stripAiCallerPolicyFromBody } from '../../../shared/ai-caller-policy.mjs';
import { GROK_4_7_MODEL_ID, CANVAS_AGENT_PLAN_INPUT_MAX_BYTES, CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES } from '../../../shared/canvas-agent-plan.mjs';
import { CanvasAgentProviderError, invokeCanvasAgentPlan, invokeCanvasAgentEvaluation, canvasAgentProviderReadiness,
  prepareCanvasAgentModel, normalizeCanvasAgentModel, CANVAS_AGENT_NORMALIZE_MAX_BYTES } from '../lib/canvas-agent-plan.js';
import { json, ok } from '../lib/responses.js';
import { CANVAS_ASSISTANT_MODELS, canvasAssistantModel } from '../../../../js/shared/canvas-assistant-models.mjs';

export const CANVAS_AGENT_INTERNAL_BODY_MAX_BYTES = CANVAS_AGENT_PLAN_INPUT_MAX_BYTES + 8192;
export const CANVAS_AGENT_EVALUATION_BODY_MAX_BYTES = CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES + 8192;
export const CANVAS_AGENT_PREPARE_BODY_MAX_BYTES = CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES + 8192;
export const CANVAS_AGENT_NORMALIZE_BODY_MAX_BYTES = CANVAS_AGENT_NORMALIZE_MAX_BYTES + 8192;
export function handleCanvasAgentReadiness({ env }) { return ok({ ...canvasAgentProviderReadiness(env),
  models: CANVAS_ASSISTANT_MODELS.map(model => canvasAgentProviderReadiness(env, model.modelId)) }); }
function failure(error, afterDispatch = false, preparationOnly = false) {
  const expected = error instanceof CanvasAgentProviderError;
  return json({ ok: false, error: 'Canvas planning could not complete.',
    code: expected ? error.code : isRequestBodyError(error) ? error.code : preparationOnly ? 'canvas_agent_prepare_failed' : 'canvas_agent_provider_outcome_unknown',
    outcome: preparationOnly ? 'not_submitted' : expected ? error.outcome : isRequestBodyError(error) && !afterDispatch ? 'not_submitted' : 'unknown',
    retryable: false,
    ...(expected && error.usage ? { usage: error.usage } : {}),
    ...(expected && error.usageDiagnostic ? { usageDiagnostic: error.usageDiagnostic } : {}),
    ...(expected && error.responseId ? { responseId: error.responseId } : {}),
    ...(expected && error.requestId ? { requestId: error.requestId, model: error.model || GROK_4_7_MODEL_ID } : {}),
  }, { status: expected || isRequestBodyError(error) ? error.status : 502 });
}
export async function handleCanvasAgentPlan({ request, env, correlationId, aiCallerPolicy }, evaluate = false) {
  try {
    if (!canvasAssistantModel(aiCallerPolicy?.callerPolicy?.model_id)) {
      throw new CanvasAgentProviderError('canvas_agent_caller_policy_invalid', { status: 403, outcome: 'not_submitted' });
    }
    const raw = await readJsonBodyLimited(request, { maxBytes: evaluate ? CANVAS_AGENT_EVALUATION_BODY_MAX_BYTES : CANVAS_AGENT_INTERNAL_BODY_MAX_BYTES });
    const { body } = stripAiCallerPolicyFromBody(raw);
    if (body?.model !== aiCallerPolicy.callerPolicy.model_id) throw new CanvasAgentProviderError('canvas_agent_caller_policy_invalid', { status: 403, outcome: 'not_submitted' });
    return ok(await (evaluate ? invokeCanvasAgentEvaluation : invokeCanvasAgentPlan)(env, body, { correlationId }));
  } catch (error) {
    return failure(error);
  }
}

async function handleCanvasAgentModel({ request, env, aiCallerPolicy }, normalize) {
  try {
    if (!canvasAssistantModel(aiCallerPolicy?.callerPolicy?.model_id)) {
      throw new CanvasAgentProviderError('canvas_agent_caller_policy_invalid', { status: 403, outcome: normalize ? 'unknown' : 'not_submitted' });
    }
    const raw = await readJsonBodyLimited(request, { maxBytes: normalize ? CANVAS_AGENT_NORMALIZE_BODY_MAX_BYTES : CANVAS_AGENT_PREPARE_BODY_MAX_BYTES });
    const { body } = stripAiCallerPolicyFromBody(raw);
    if ((normalize ? body?.context?.model || GROK_4_7_MODEL_ID : body?.input?.model) !== aiCallerPolicy.callerPolicy.model_id)
      throw new CanvasAgentProviderError('canvas_agent_caller_policy_invalid', { status: 403, outcome: normalize ? 'unknown' : 'not_submitted' });
    return ok(normalize ? normalizeCanvasAgentModel(body) : await prepareCanvasAgentModel(env, body));
  } catch (error) {
    return failure(error, normalize, !normalize);
  }
}
export const handleCanvasAgentPrepare = ctx => handleCanvasAgentModel(ctx, false);
export const handleCanvasAgentNormalize = ctx => handleCanvasAgentModel(ctx, true);
