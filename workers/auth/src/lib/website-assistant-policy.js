import policy from '../../../../config/website-assistant.json' with { type: 'json' };
import { assistantContractVersion } from '../../../shared/website-assistant-contract-version.mjs';

export const ASSISTANT_POLICY = Object.freeze(policy);
export const ASSISTANT_MODELS = Object.freeze({
  '@cf/swiss-ai/apertus-v1.5-8b': { contextTokens: 262144 },
  '@cf/utter-project/eurollm-9b-it': { contextTokens: 32000 },
});
const positive = (n, maximum) => Number.isSafeInteger(n) && n > 0 && n <= maximum;

// An application/catalog entry is not entitlement. Unknown prices, approvals,
// terms and real acceptance deliberately keep this public feature unavailable.
export function assistantAdmission(env, candidate = ASSISTANT_POLICY, { privateAcceptance = false, knowledgeVersion, now = Date.now() } = {}) {
  const closed = { ready: false };
  // Durable Admin mode owns activation; the historical deployment flag is retired.
  if (candidate.version !== 1 ||
      !ASSISTANT_MODELS[candidate.model] || candidate.accessConfirmed !== true ||
      candidate.processingTermsReviewed !== true || candidate.euOnlyRequired !== false ||
      !Number.isFinite(Date.parse(candidate.accessVerifiedAt)) || Date.parse(candidate.accessVerifiedAt) > now) return closed;
  const { pricing, spendingApproval: approval, limits, acceptance } = candidate;
  if (!pricing || pricing.currency !== 'USD' || pricing.unit !== 'million_tokens' ||
      !positive(pricing.inputUsdMicrosPerMillion, 1e12) || !positive(pricing.outputUsdMicrosPerMillion, 1e12) ||
      !/^https:\/\/[^\s]+$/.test(pricing.source || '') ||
      !Number.isFinite(Date.parse(pricing.verifiedAt)) || !Number.isFinite(Date.parse(pricing.validUntil)) ||
      Date.parse(pricing.verifiedAt) > now || Date.parse(pricing.validUntil) <= now ||
      !approval || !/^[a-zA-Z0-9_.-]{1,80}$/.test(approval.reference || '') || approval.model !== candidate.model ||
      !positive(approval.dailyUsdMicros, 100e6) || !positive(approval.monthlyUsdMicros, 1000e6) ||
      approval.dailyUsdMicros > approval.monthlyUsdMicros || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now) return closed;
  if (!limits || !positive(limits.inputChars, 2000) || !positive(limits.historyMessages, 6) ||
      !positive(limits.historyChars, 6000) || !positive(limits.outputTokens, 512) ||
      !positive(limits.outputChars, 8000) || !positive(limits.requestsPerMinute, 6) ||
      !positive(limits.dailyRequests, 1000) || !positive(limits.concurrentRequests, 10) ||
      !positive(limits.timeoutMs, 30000)) return closed;
  if (privateAcceptance && approval.testApproved !== true) return closed;
  if (!privateAcceptance && (!acceptance || acceptance.model !== candidate.model ||
      assistantContractVersion === 'wa1-unreviewed' || acceptance.contractVersion !== assistantContractVersion ||
      acceptance.knowledgeVersion !== knowledgeVersion || acceptance.realProvider !== true ||
      acceptance.en !== true || acceptance.de !== true || !/^[a-f0-9]{40}$/.test(acceptance.sourceSha || '') ||
      !Number.isFinite(Date.parse(acceptance.verifiedAt)) || Date.parse(acceptance.verifiedAt) > now)) return closed;
  // Until the gated model's tokenizer/template contract is verified, reserve
  // its entire context at the input rate plus the bounded output. This is a
  // ceiling, not measured usage or a per-message price forecast.
  const reservationMicros = Math.ceil((ASSISTANT_MODELS[candidate.model].contextTokens * pricing.inputUsdMicrosPerMillion +
    limits.outputTokens * pricing.outputUsdMicrosPerMillion) / 1e6);
  if (!positive(reservationMicros, approval.dailyUsdMicros)) return closed;
  return { ready: true, model: candidate.model, pricing, limits, reservationMicros, budgetLimits: {
    dailyMicros: approval.dailyUsdMicros, monthlyMicros: approval.monthlyUsdMicros, leaseMs: 120000,
    dailyRequests: limits.dailyRequests, concurrentRequests: limits.concurrentRequests,
  } };
}

export function measuredAssistantCost(usage, admission) {
  if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || !Number.isSafeInteger(usage.completion_tokens) ||
      usage.prompt_tokens <= 0 || usage.completion_tokens <= 0 ||
      usage.prompt_tokens > ASSISTANT_MODELS[admission.model].contextTokens ||
      usage.completion_tokens > admission.limits.outputTokens) return null;
  return Math.ceil((usage.prompt_tokens * admission.pricing.inputUsdMicrosPerMillion +
    usage.completion_tokens * admission.pricing.outputUsdMicrosPerMillion) / 1e6);
}

// Administrative diagnostics describe missing evidence; they perform no model
// call and never turn configuration presence into an access/health claim.
export function assistantReadiness(env, candidate, options = {}) {
  const admission = assistantAdmission(env, candidate, options);
  const blockers = [];
  const add = (code, message) => blockers.push({ code, message });
  const now = options.now ?? Date.now();
  if (typeof env?.AI?.run !== 'function') add('ai_binding_missing', 'The Workers AI binding is unavailable.');
  if (!env?.PUBLIC_RATE_LIMITER) add('budget_binding_missing', 'Durable budget storage is unavailable.');
  if (!ASSISTANT_MODELS[candidate.model]) add('model_unapproved', 'The selected model is not approved.');
  if (candidate.accessConfirmed !== true || !Number.isFinite(Date.parse(candidate.accessVerifiedAt)) || Date.parse(candidate.accessVerifiedAt) > now) add('access_unverified', 'Account access to the selected model has not been verified.');
  if (candidate.processingTermsReviewed !== true) add('terms_unreviewed', 'Applicable processing terms have not been reviewed.');
  if (candidate.euOnlyRequired !== false) add('processing_region', 'An EU-only processing requirement is unresolved.');
  if (!candidate.pricing || Date.parse(candidate.pricing.validUntil) <= now || !Number.isFinite(Date.parse(candidate.pricing.validUntil))) add('pricing_unverified', 'Current model token prices have not been verified or have expired.');
  if (!candidate.spendingApproval || Date.parse(candidate.spendingApproval.expiresAt) <= now || !Number.isFinite(Date.parse(candidate.spendingApproval.expiresAt))) add('budget_unapproved', 'An applicable, current spending budget has not been approved.');
  if (options.privateAcceptance && candidate.spendingApproval?.testApproved !== true) add('test_budget_unapproved', 'An explicit real-response test budget has not been approved.');
  if (!options.privateAcceptance && (!candidate.acceptance || candidate.acceptance.realProvider !== true ||
      candidate.acceptance.en !== true || candidate.acceptance.de !== true || candidate.acceptance.model !== candidate.model ||
      candidate.acceptance.knowledgeVersion !== options.knowledgeVersion || candidate.acceptance.contractVersion !== assistantContractVersion)) add('acceptance_pending', 'Real German and English model acceptance is missing or stale for these inputs.');
  if (!admission.ready && !blockers.length) add('readiness_invalid', 'Required readiness, pricing, limits or approval evidence is invalid.');
  return { ...admission, ready: admission.ready && !blockers.length, blockers };
}
