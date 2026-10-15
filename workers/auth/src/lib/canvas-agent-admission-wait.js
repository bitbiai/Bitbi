import { canvasAgentAuthority } from './canvas-agent-authority.js';
import { json } from './response.js';
import { withCorrelationId } from '../../../../js/shared/worker-observability.mjs';

// Call only at a generation route's definite, pre-dispatch rate-limit branch.
// A client header cannot grant this in-process authority. Provider refusals,
// unknown dispatch outcomes and storage retries must never use this signal.
export function canvasAgentAdmissionWaitResponse(env, windowMs, correlationId = null) {
    if (!canvasAgentAuthority(env)) return null;
    const now = Date.now();
    // The existing sensitive limiter uses fixed windows. Its public evaluator
    // returns only a boolean, so derive the next boundary without consuming a
    // second permit, changing quotas, or interpreting an HTTP provider error.
    const retryMs = now - now % windowMs + windowMs;
    return withCorrelationId(json({
        ok:false,
        error:'Production is waiting for the generation rate limit to reset.',
        code:'canvas_agent_admission_wait',
        data:{retryAt:new Date(retryMs).toISOString()},
    }, {status:429, headers:{'Retry-After':String(Math.ceil((retryMs - now) / 1000))}}), correlationId);
}
