// Shared one-shot limits; chat imports the same reasoning contract.
export const GROK_4_6_MODEL_ID = "xai/grok-4.6";
export const GROK_REASONING_EFFORTS = Object.freeze(["low", "medium", "high"]);
export const GROK_DEFAULT_REASONING_EFFORT = "medium";
export const GROK_REASONING_OUTPUT_TOKENS = Object.freeze({ low: 8192, medium: 16384, high: 32768 });
export function normalizeGrokReasoningEffort(value) {
  const normalized = String(value || "").trim();
  if (!GROK_REASONING_EFFORTS.includes(normalized)) throw Object.assign(new TypeError("reasoningEffort must be low, medium, or high."), { status: 400, code: "validation_error" });
  return normalized;
}
export function getGrokMaxCompletionTokens(effort) {
  return GROK_REASONING_OUTPUT_TOKENS[normalizeGrokReasoningEffort(effort)];
}
// Verified 2026-09-19: docs.x.ai/developers/models/grok-4.6;
// developers.cloudflare.com/ai-gateway/features/unified-billing/ (5% funding fee).
// Completion allowance includes visible output AND billable reasoning.
export const GROK_TEXT_PRICING = Object.freeze({ input: 2, cachedInput: .5, output: 6, fundingMultiplier: 1.05 });
export function estimateGrokTextCostUsd({ prompt = "", systemPrompt = "", reasoningEffort = GROK_DEFAULT_REASONING_EFFORT } = {}) {
  // UTF-8 bytes conservatively bound text tokens; reserve protocol overhead too.
  const inputTokens = new TextEncoder().encode(String(prompt) + String(systemPrompt)).length + 4096;
  return (inputTokens * GROK_TEXT_PRICING.input + getGrokMaxCompletionTokens(reasoningEffort) * GROK_TEXT_PRICING.output) / 1e6 * GROK_TEXT_PRICING.fundingMultiplier;
}
