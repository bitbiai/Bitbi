// Server-selected Canvas admission policy, not a provider request parameter.
// Cloudflare publishes a 500k Grok 4.7 context; xAI publishes no separate text
// output limit. Until background max_completion_tokens enforcement is verified,
// quote the worst feasible input/output split within that context. Keep sending
// the existing smaller request control. This is conservative credit admission,
// not proof that a provider can never violate its documented resource contract.
// https://developers.cloudflare.com/ai/models/xai/grok-4.7/
// https://docs.x.ai/developers/grok-4-7
export const CANVAS_GROK_ADMISSION_VERSION = 'canvas-grok-context-v1';
export const CANVAS_GROK_CONTEXT_TOKENS = 500_000;
export const CANVAS_GROK_LONG_CONTEXT_THRESHOLD = 200_000;

export function canvasGrokAdmissionPricePoints(inputTokenBound) {
  if (!Number.isSafeInteger(inputTokenBound) || inputTokenBound < 1 || inputTokenBound > CANVAS_GROK_CONTEXT_TOKENS) {
    throw new TypeError('Invalid Canvas Grok input bound.');
  }
  // Both factory prices and existing custom token rates are linear within a
  // context tier. Its endpoints suffice; include each side of the tier jump.
  return [...new Set([0, inputTokenBound, CANVAS_GROK_LONG_CONTEXT_THRESHOLD - 1, CANVAS_GROK_LONG_CONTEXT_THRESHOLD]
    .filter(input => input <= inputTokenBound))].map(inputToken => ({ inputToken, outputToken: CANVAS_GROK_CONTEXT_TOKENS - inputToken }));
}
