import policy from '../../config/website-assistant.json' with { type: 'json' };
import { assistantContractVersion } from '../../workers/shared/website-assistant-contract-version.mjs';

// Synthetic admission only. Production imports config/website-assistant.json,
// whose access, prices, spending approval and acceptance remain unconfirmed.
export function testAssistantPolicy(knowledgeVersion) {
  return { ...structuredClone(policy), accessConfirmed: true, accessVerifiedAt: '2026-01-01', processingTermsReviewed: true,
    pricing: { currency: 'USD', unit: 'million_tokens', inputUsdMicrosPerMillion: 100000,
      outputUsdMicrosPerMillion: 200000, source: 'https://example.invalid/test-rates', verifiedAt: '2026-01-01', validUntil: '2100-01-01' },
    spendingApproval: { testApproved: true, reference: 'test-only-no-spending-authority', model: policy.model,
      dailyUsdMicros: 1000000, monthlyUsdMicros: 5000000, expiresAt: '2100-01-01' },
    acceptance: { realProvider: true, en: true, de: true, model: policy.model,
      contractVersion: assistantContractVersion,
      knowledgeVersion, sourceSha: 'a'.repeat(40), verifiedAt: '2026-01-01' },
  };
}

export function testAssistantStream({ chunks = ['Use Generate Lab.', ' Check the estimate before generating.'], usage = { prompt_tokens: 120, completion_tokens: 20 }, complete = true } = {}) {
  const encoder = new TextEncoder();
  return new ReadableStream({ start(controller) {
    for (const response of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response })}\n\n`));
    if (usage) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ usage })}\n\n`));
    if (complete) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
  } });
}
