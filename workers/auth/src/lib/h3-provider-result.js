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

export async function callH3Provider(env, model, payload, options, correlationId) {
  let response;
  try {
    const account = env.CLOUDFLARE_ACCOUNT_ID;
    const token = env.H3_CLOUDFLARE_API_TOKEN;
    if (model !== 'minimax/h3' || !/^[a-f0-9]{32}$/.test(account || '')
      || typeof token !== 'string' || !token.trim()) throw new Error('h3_transport_unavailable');
    // Exactly one REST dispatch; never retry/fall back to the binding after an
    // ambiguous response. The durable caller records intent before this call.
    // Keep model callback_url (not Gateway background/webhook options), and do
    // not forward binding-only options or credentials to the model input.
    response = await (env.__TEST_FETCH || fetch)(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`, {
      method: 'POST', redirect: 'manual', signal: options?.signal,
      // REST Gateway controls are headers, not the binding's options.gateway.
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'cf-aig-gateway-id': 'default', 'cf-aig-skip-cache': 'true',
        'cf-aig-collect-log': 'false', 'cf-aig-max-attempts': '1',
        'cf-aig-metadata': JSON.stringify({ ...options?.gateway?.metadata, bitbi_dispatch: correlationId }),
      },
      body: JSON.stringify({ model, input: payload }),
    });
  } catch (error) {
    // No response-local proof of rejection: retain the no-replay fence.
    throw h3Failure(h3Diagnostic(error, { correlationId }));
  }
  const context = { status: response.status, requestId: response.headers.get('cf-ai-req-id'),
    gatewayId: response.headers.get('cf-aig-log-id'), correlationId };
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw h3Failure(h3Diagnostic(null, context));
  }
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
  // REST adds the Cloudflare envelope and a run result around the H3 task.
  // Normalize only documented/retained shapes, preserving the task unchanged
  // for the existing identity, callback, terminal-status and billing guards.
  const run = body?.result;
  const taskResult = run?.result?.task ? run.result : run?.task ? run : body;
  if (response.ok && body?.success !== false && run?.success !== false
    && !run?.error && (run?.state === undefined || run.state === 'Completed')) return taskResult;
  const error = body?.errors?.[0] || run?.error || { code: body?.internalCode, message: body?.description };
  const diagnostic = h3Diagnostic(error, context);
  // A task identity contradicts rejection before inference, even with a known
  // validation code. Preserve the fence rather than releasing this reservation.
  if (body?.task?.id || run?.task?.id || run?.result?.task?.id) diagnostic.noInference = false;
  throw h3Failure(diagnostic);
}
