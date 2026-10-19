import { CANVAS_FABLE_ADMISSION_VERSION, CANVAS_FABLE_MODEL } from '../../js/shared/canvas-assistant-models.mjs';

// Verified 2026-10-19, exact CF route uses native Anthropic Messages:
// https://developers.cloudflare.com/ai/models/anthropic/claude-fable-5/
// https://developers.cloudflare.com/ai-gateway/usage/rest-api/
// https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// No provider-private replay, tool registration, cache creation or Admin prompt.
// Native structured outputs support Fable5, with a subset of JSON Schema. Keep
// the original full application schema as the independent acceptance boundary.
export function canvasFableSchema(schema) {
  const unsupported = new Set(['minimum','maximum','minLength','maxLength','maxItems','pattern']);
  const projected={},constraints=[];
  for(const [key,value]of Object.entries(schema)){
    if(unsupported.has(key)||key==='minItems'&&![0,1].includes(value)){constraints.push(`${key}: ${value}`);continue;}
    if(key==='properties')projected[key]=Object.fromEntries(Object.entries(value).map(([name,field])=>[name,canvasFableSchema(field)]));
    else if(key==='items')projected[key]=canvasFableSchema(value);
    else if(key==='anyOf')projected[key]=value.map(canvasFableSchema);
    else projected[key]=structuredClone(value);
  }
  if(constraints.length)projected.description=[projected.description,'Application constraints: '+constraints.join('; ')].filter(Boolean).join('\n');
  return projected;
}
export function canvasFablePayload(messages, schema, maxTokens, effort = 'medium') {
  if (!Array.isArray(messages) || messages.length !== 2 || messages[0].role !== 'system' || messages[1].role !== 'user'
    || !messages.every(message => typeof message.content === 'string') || !Number.isSafeInteger(maxTokens)
    || maxTokens < 1 || maxTokens > 16384 || !['low', 'medium'].includes(effort)) throw new TypeError('canvas_agent_context_invalid');
  return { system: messages[0].content,
    messages: [{ role: 'user', content: messages[1].content }], max_tokens: maxTokens,
    output_config: { effort, format:{type:'json_schema',schema:canvasFableSchema(schema)} }, thinking: { type: 'adaptive' }, stream: false };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => Number.isSafeInteger(value) && value >= 0;
export function normalizeCanvasFableUsage(raw) {
  if (!object(raw) || !token(raw.input_tokens) || !token(raw.output_tokens)
    || raw.input_tokens + raw.output_tokens > 1000000) return null;
  if (raw.total_tokens !== undefined && raw.total_tokens !== raw.input_tokens + raw.output_tokens
    || raw.output_tokens_details !== undefined && (!object(raw.output_tokens_details)
      || Object.entries(raw.output_tokens_details).some(([key,value]) => key !== 'thinking_tokens' || !token(value) || value > raw.output_tokens))) return null;
  // Prompt caching is deliberately absent from this adapter. A new billed
  // category is review-required; do not price it as uncached input or omit it.
  for (const name of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (raw[name] !== undefined && (!token(raw[name]) || raw[name] !== 0)) return null;
  }
  if (raw.cache_creation !== undefined && (!object(raw.cache_creation)
    || Object.values(raw.cache_creation).some(value => !token(value) || value !== 0))) return null;
  if (raw.server_tool_use !== undefined && (!object(raw.server_tool_use)
    || Object.values(raw.server_tool_use).some(value => !token(value) || value !== 0))) return null;
  // output_tokens already includes billed adaptive thinking. Never add a
  // visible or hidden thinking block length to provider metering.
  return { input_tokens: raw.input_tokens, output_tokens: raw.output_tokens,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    metering: { version: CANVAS_FABLE_ADMISSION_VERSION, outputIncludesThinking: true } };
}
export function canvasFableUsageUnits(usage) {
  const checked = normalizeCanvasFableUsage(usage);
  if (!checked || JSON.stringify(usage.metering) !== JSON.stringify(checked.metering)) return null;
  return { inputToken: checked.input_tokens, outputToken: checked.output_tokens };
}
export function canvasFableResponse(raw) {
  const response = object(raw?.result) ? raw.result : raw;
  const usage = normalizeCanvasFableUsage(response?.usage);
  const responseId = typeof response?.id === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(response.id) ? response.id : null;
  const result = { usage, responseId, model: CANVAS_FABLE_MODEL };
  if (!object(response) || response.type !== 'message' || response.role !== 'assistant'
    || !['claude-fable-5', CANVAS_FABLE_MODEL].includes(response.model) || !responseId || response.error
    || !Array.isArray(response.content) || !response.content.length) return { ...result, error: 'canvas_agent_provider_response_invalid' };
  if (response.stop_reason === 'refusal' || response.content.some(block => block?.type === 'refusal')) return { ...result, error: 'canvas_agent_provider_refused' };
  if (response.stop_reason === 'max_tokens') return { ...result, error: 'canvas_agent_output_limit' };
  if (response.stop_reason !== 'end_turn' || response.content.some(block => !object(block)
    || !['text', 'thinking', 'redacted_thinking'].includes(block.type)
    || block.type === 'text' && typeof block.text !== 'string')) return { ...result, error: 'canvas_agent_provider_response_invalid' };
  if (!usage) return { ...result, error: 'canvas_agent_provider_usage_missing' };
  return { ...result, text: response.content.filter(block => block.type === 'text').map(block => block.text).join('') };
}
