// Keep transport diagnostics separate from outcome certainty. In particular,
// HTTP 400 does not prove that a paid task was never accepted.
// Cloudflare's documented pre-inference validation errors:
// https://developers.cloudflare.com/workers-ai/platform/errors/
const rejected = new Map([[3003, 400], [5004, 400], [5007, 400]]);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;
const reasons = [
  ['callback_verification', /callback.{0,32}(?:verification|verify|challenge)/i],
  ['reference_download', /(?:download|fetch).{0,32}(?:video|image|audio|reference|url)/i],
  ['media_format', /(?:unsupported|invalid).{0,16}(?:codec|media format|video format)/i],
  ['input_validation', /(?:invalid parameter|invalid input|validation error|missing required)/i],
];

export function h3Diagnostic(error, { status = null, requestId = null, gatewayId = null, correlationId = null } = {}) {
  // Provider prose is inspected in memory only; none is logged or retained.
  const text = typeof error?.message === 'string' ? error.message.slice(0,8192) : '';
  const number = Number(error?.code ?? text.match(/^(\d{4,5}):/)?.[1]);
  const code = Number.isSafeInteger(number) && number >= 1000 && number <= 99999 ? number : null;
  return { provider: 'cloudflare-ai', code, status: Number.isInteger(status) ? status : null,
    reason: reasons.find(([, pattern]) => pattern.test(text))?.[0] || 'unclassified',
    requestId: safeId(requestId), gatewayId: safeId(gatewayId), correlationId: safeId(correlationId),
    noInference: rejected.has(code) && rejected.get(code) === status };
}

export function h3Failure(diagnostic, durable = false) {
  return Object.assign(new Error(durable ? 'generation_provider_rejected' : 'generation_provider_call_outcome_unknown'), {
    code: durable ? 'generation_provider_rejected' : 'generation_provider_call_outcome_unknown',
    providerDiagnostic: diagnostic, confirmedRejection: durable && diagnostic.noInference === true,
  });
}

export function recordVideoLateError(usagePolicy, error) {
  return usagePolicy?.recordLateOutcome?.(error?.confirmedRejection === true ? 'failed' : 'unknown', error?.code);
}

export async function callH3Provider(ai, model, payload, options, correlationId) {
  let response;
  try {
    // Response-local IDs avoid mutable AI-binding lastRequestId state when
    // different accepted jobs run concurrently. Content logging remains off.
    response = await ai.run(model, payload, { ...options, returnRawResponse: true,
      gateway: { ...options?.gateway, skipCache: true, collectLog: false,
        metadata: { ...options?.gateway?.metadata, bitbi_dispatch: correlationId } } });
  } catch (error) {
    // A thrown binding/network error has no independently associated response.
    throw h3Failure(h3Diagnostic(error, { correlationId }));
  }
  if (!(response instanceof Response)) return response; // Synthetic binding / parsed adapter.
  const context = { status: response.status, requestId: response.headers.get('cf-ai-req-id'),
    gatewayId: response.headers.get('cf-aig-log-id'), correlationId };
  let body;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing response');
    const chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 131072) { await reader.cancel(); throw new Error('response too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw h3Failure(h3Diagnostic(null, context)); }
  if (response.ok && body?.success !== false) return body?.result?.task ? body.result : body;
  const error = body?.errors?.[0] || { code: body?.internalCode, message: body?.description };
  const diagnostic = h3Diagnostic(error, context);
  // A task identity contradicts rejection before inference, even with a known
  // validation code. Preserve the fence rather than releasing this reservation.
  if (body?.task?.id || body?.result?.task?.id) diagnostic.noInference = false;
  throw h3Failure(diagnostic);
}
