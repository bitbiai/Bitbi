import { readJsonBodyLimited, isRequestBodyError } from '../../../../js/shared/request-body.mjs';
import { stripAiCallerPolicyFromBody } from '../../../shared/ai-caller-policy.mjs';
import { GROK_4_7_MODEL_ID, CANVAS_AGENT_PLAN_INPUT_MAX_BYTES, CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES } from '../../../shared/canvas-agent-plan.mjs';
import { CanvasAgentProviderError, invokeCanvasAgentPlan, invokeCanvasAgentEvaluation, canvasAgentProviderReadiness } from '../lib/canvas-agent-plan.js';
import { json, ok } from '../lib/responses.js';

export const CANVAS_AGENT_INTERNAL_BODY_MAX_BYTES = CANVAS_AGENT_PLAN_INPUT_MAX_BYTES + 8192;
export const CANVAS_AGENT_EVALUATION_BODY_MAX_BYTES = CANVAS_AGENT_EVALUATION_INPUT_MAX_BYTES + 8192;
export function handleCanvasAgentReadiness({ env }) { return ok(canvasAgentProviderReadiness(env)); }
export async function handleCanvasAgentPlan({ request, env, correlationId, aiCallerPolicy }, evaluate = false) {
  try {
    if (aiCallerPolicy?.callerPolicy?.model_id !== GROK_4_7_MODEL_ID) {
      throw new CanvasAgentProviderError('canvas_agent_caller_policy_invalid', { status: 403, outcome: 'not_submitted' });
    }
    const raw = await readJsonBodyLimited(request, { maxBytes: evaluate ? CANVAS_AGENT_EVALUATION_BODY_MAX_BYTES : CANVAS_AGENT_INTERNAL_BODY_MAX_BYTES });
    const { body } = stripAiCallerPolicyFromBody(raw);
    return ok(await (evaluate ? invokeCanvasAgentEvaluation : invokeCanvasAgentPlan)(env, body, { correlationId }));
  } catch (error) {
    const expected = error instanceof CanvasAgentProviderError;
    return json({ ok: false, error: 'Canvas planning could not complete.',
      code: expected ? error.code : isRequestBodyError(error) ? error.code : 'canvas_agent_provider_outcome_unknown',
      outcome: expected ? error.outcome : isRequestBodyError(error) ? 'not_submitted' : 'unknown',
      retryable: false,
      ...(expected && error.usage ? { usage: error.usage } : {}),
      ...(expected && error.responseId ? { responseId: error.responseId } : {}),
    }, { status: expected || isRequestBodyError(error) ? error.status : 502 });
  }
}
