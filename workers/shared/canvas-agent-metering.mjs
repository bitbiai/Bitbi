// Canvas Grok 4.7 on Cloudflare /ai/run (Chat Completions, background).
// Verified 2026-10-18:
// https://developers.cloudflare.com/ai/models/xai/grok-4.7/
// https://developers.cloudflare.com/ai-gateway/usage/rest-api/
// https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing
// Cloudflare's examples report visible completion separately from reasoning.
// Also recognize an inclusive completion only when the exact total proves it.
// The documented max_completion_tokens field is a request control; the docs do
// not establish enforcement across the background transport. Never repair a
// mismatch by clipping usage, dropping reasoning or trusting an unexplained sum.
import { CANVAS_GROK_CONTEXT_TOKENS } from '../../js/shared/canvas-grok-admission.mjs';
export { CANVAS_GROK_CONTEXT_TOKENS } from '../../js/shared/canvas-grok-admission.mjs';
export const CANVAS_GROK_METERING_VERSION = 'canvas-grok-4.7-usage-v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => Number.isSafeInteger(value) && value >= 0;
const optionalToken = value => value === undefined || token(value);

export function normalizeCanvasGrokUsage(raw) {
  if (!object(raw) || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key => token(raw[key]))) return null;
  if (raw.prompt_tokens_details !== undefined && !object(raw.prompt_tokens_details)
    || raw.completion_tokens_details !== undefined && !object(raw.completion_tokens_details)) return null;
  const input = raw.prompt_tokens, completion = raw.completion_tokens, total = raw.total_tokens;
  const prompt = raw.prompt_tokens_details || {}, output = raw.completion_tokens_details || {};
  if (!['cached_tokens', 'image_tokens', 'text_tokens', 'audio_tokens'].every(key => optionalToken(prompt[key]))
    || !['reasoning_tokens', 'audio_tokens', 'accepted_prediction_tokens', 'rejected_prediction_tokens'].every(key => optionalToken(output[key]))
    || !optionalToken(raw.num_sources_used) || total > CANVAS_GROK_CONTEXT_TOKENS) return null;
  const cached = prompt.cached_tokens || 0, image = prompt.image_tokens || 0, reasoning = output.reasoning_tokens || 0;
  // Some transports expose aliases at the root. They are not another billable
  // component; if supplied they must agree with this route's documented fields.
  if (raw.reasoning_tokens !== undefined && (!token(raw.reasoning_tokens) || output.reasoning_tokens === undefined || raw.reasoning_tokens !== reasoning)
    || raw.cached_tokens !== undefined && (!token(raw.cached_tokens) || prompt.cached_tokens === undefined || raw.cached_tokens !== cached)) return null;
  // Audio, predicted output and provider search are not enabled on this Canvas
  // transport. Do not silently price a new usage category as ordinary text.
  if (cached > input || image > input || (prompt.text_tokens || 0) + image > input
    || prompt.audio_tokens || output.audio_tokens || output.accepted_prediction_tokens
    || output.rejected_prediction_tokens || raw.num_sources_used) return null;
  let completionIncludesReasoning;
  if (total === input + completion + reasoning) completionIncludesReasoning = false;
  else if (reasoning <= completion && total === input + completion) completionIncludesReasoning = true;
  else return null;
  const ticks = raw.cost_in_usd_ticks;
  if (ticks !== undefined && !(typeof ticks === 'string' && /^\d{1,40}$/.test(ticks)) && !token(ticks)) return null;
  return {
    input_tokens: input,
    // Preserve the accepted receipt shape; billing consumes the validated units
    // below, not this provider-dependent completion field by itself.
    output_tokens: completion,
    cache_read_input_tokens: cached,
    output_tokens_details: { thinking_tokens: reasoning },
    provider: { prompt_tokens: input, completion_tokens: completion, total_tokens: total,
      cached_tokens: cached, image_tokens: image, reasoning_tokens: reasoning, sources_used: 0,
      ...(ticks === undefined ? {} : { cost_in_usd_ticks: String(ticks) }) },
    metering: { version: CANVAS_GROK_METERING_VERSION, completionIncludesReasoning,
      billableOutputTokens: total - input },
  };
}

// Revalidate historical normalized receipts as well as new ones. A stored total
// is not sufficient evidence unless its reported components reconcile exactly.
// No history is rewritten, and cached input remains part of the existing pinned
// input quantity; this change does not introduce a new cache discount or tariff.
export function canvasGrokUsageUnits(usage) {
  if (!object(usage) || !object(usage.provider)) return null;
  const provider = usage.provider;
  const checked = normalizeCanvasGrokUsage({ prompt_tokens: provider.prompt_tokens,
    completion_tokens: provider.completion_tokens, total_tokens: provider.total_tokens,
    prompt_tokens_details: { cached_tokens: provider.cached_tokens, image_tokens: provider.image_tokens },
    completion_tokens_details: { reasoning_tokens: provider.reasoning_tokens },
    num_sources_used: provider.sources_used, cost_in_usd_ticks: provider.cost_in_usd_ticks });
  if (!checked || usage.input_tokens !== checked.input_tokens || usage.output_tokens !== checked.output_tokens
    || usage.cache_read_input_tokens !== checked.cache_read_input_tokens
    || usage.output_tokens_details?.thinking_tokens !== checked.output_tokens_details.thinking_tokens) return null;
  if (usage.metering !== undefined && (!object(usage.metering)
    || Object.keys(usage.metering).sort().join(',') !== Object.keys(checked.metering).sort().join(',')
    || Object.entries(checked.metering).some(([key, value]) => usage.metering[key] !== value))) return null;
  return { inputToken: checked.input_tokens, outputToken: checked.metering.billableOutputTokens };
}

export function canvasGrokLimitDiagnostic(usage, requestedMaxCompletionTokens) {
  const units = canvasGrokUsageUnits(usage);
  if (!units || !Number.isSafeInteger(requestedMaxCompletionTokens) || requestedMaxCompletionTokens < 1) return null;
  return { version: CANVAS_GROK_METERING_VERSION, requestedMaxCompletionTokens,
    reportedCompletionTokens: usage.output_tokens, billableOutputTokens: units.outputToken,
    completionExceedsRequest: usage.output_tokens > requestedMaxCompletionTokens,
    billableOutputExceedsRequest: units.outputToken > requestedMaxCompletionTokens,
    enforcement: 'unverified_background_transport' };
}
