import { GPT_IMAGE_25_MAX_AGGREGATE_REFERENCE_BYTES, GPT_IMAGE_25_MAX_REFERENCE_BYTES } from '../../js/shared/gpt-image-25-contract.mjs';
// Cloudflare adapter limits are application safeguards, not provider promises.
export const GPT_IMAGE_25_AGGREGATE_BYTES = GPT_IMAGE_25_MAX_AGGREGATE_REFERENCE_BYTES;
export const GPT_IMAGE_25_IMAGE_BYTES = GPT_IMAGE_25_MAX_REFERENCE_BYTES;
export const GPT_IMAGE_25_INTERNAL_JSON_BYTES = 24 * 1024 * 1024;
const types = new Set(['image/png', 'image/jpeg', 'image/webp']);
const receiptDiagnostic = Symbol('image25ReceiptDiagnostic');

export function image25DeliveryError(error, stage, context = {}) {
  const reason = /Invalid redirect value/.test(String(error?.message || '')) ? 'unsupported_redirect_mode'
    : ['AbortError', 'TimeoutError'].includes(error?.name) ? 'deadline'
      : error?.code === 'image_too_large' ? 'byte_limit'
        : error?.name === 'TypeError' ? 'transport_or_body' : 'invalid_output';
  return Object.assign(image25Error('generation_output_delivery_pending', 'The image was generated; delivery needs recovery. Do not generate again.', 502), {
    providerCompleted: true,
    providerDiagnostic: { ...image25Diagnostic(null, context), stage, reason,
      errorType: ['TypeError','AbortError','TimeoutError'].includes(error?.name) ? error.name : 'Error' },
  });
}

export function image25Error(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export async function readImage25Bytes(value, limit = GPT_IMAGE_25_IMAGE_BYTES, signal) {
  const body = value?.body || value;
  if (!body?.getReader) throw image25Error('image_unavailable', 'Image content is unavailable.', 409);
  const reader = body.getReader(), chunks = []; let size = 0;
  const abort = () => { Promise.resolve(reader.cancel(signal.reason)).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) { abort(); throw signal.reason; }
    for (;;) {
      const { value: bytes, done } = await reader.read(); if (done) break;
      if (signal?.aborted) throw signal.reason;
      size += bytes.byteLength;
      if (size > limit) { await reader.cancel(); throw image25Error('image_too_large', 'Image byte limit exceeded.', 413); }
      chunks.push(bytes);
    }
    if (signal?.aborted) throw signal.reason;
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function image25Mime(bytes, declared) {
  const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg' : bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
        && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80 ? 'image/webp' : null;
  if (!mime || (declared && mime !== declared)) throw image25Error('image_type_invalid', 'Image must contain matching PNG, JPEG, or WebP content.');
  return mime;
}

export function image25Base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function safeProviderUrl(value) {
  let url; try { url = new URL(value); } catch { throw image25Error('image_output_invalid', 'Provider returned an invalid image URI.', 502); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.')
    || /^(?:\d+\.){3}\d+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) {
    throw image25Error('image_output_invalid', 'Provider returned an unsafe image URI.', 502);
  }
  return url.href;
}

export async function image25Output(result, options = {}) {
  try { return await resolveImage25Output(result, options); }
  catch(error) {
    if(error.code==='generation_provider_outcome_unknown' || error.providerDiagnostic)throw error;
    const diagnostic=image25DeliveryError(error,'output_validate',result?.[receiptDiagnostic]);
    Object.assign(error,{providerCompleted:true,providerDiagnostic:diagnostic.providerDiagnostic});
    throw error;
  }
}

async function resolveImage25Output(result, { fetcher = fetch, signal, outputFormat } = {}) {
  // Accept both the documented direct schema and the Completed gateway envelope.
  if (result && Object.hasOwn(result, 'state') && result.state !== 'Completed') throw image25Error('generation_provider_outcome_unknown', 'Provider completion is unresolved. Do not resubmit.', 502);
  const value = result?.result?.image ?? result?.image;
  if (typeof value !== 'string') throw image25Error('image_output_invalid', 'Provider completed without a usable image.', 502);
  let bytes, mime;
  if (value.startsWith('data:')) {
    const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match || match[2].length > Math.ceil(GPT_IMAGE_25_IMAGE_BYTES / 3) * 4) throw image25Error('image_output_invalid', 'Provider returned invalid image data.', 502);
    let binary; try { binary = atob(match[2]); } catch { throw image25Error('image_output_invalid', 'Provider returned invalid image data.', 502); }
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); mime = match[1];
  } else {
    const url = safeProviderUrl(value);
    let response;
    try { response = await fetcher(url, { signal, redirect: 'manual' }); }
    catch (error) { throw image25DeliveryError(error, 'output_fetch', result[receiptDiagnostic]); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const error = image25DeliveryError(null, response.status >= 300 && response.status < 400 ? 'output_redirect_rejected' : 'output_http', { ...result[receiptDiagnostic], status:response.status });
      throw error;
    }
    mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!types.has(mime)) { await response.body?.cancel().catch(() => {}); throw image25Error('image_output_invalid', 'Provider returned an unsupported image type.', 502); }
    try { bytes = await readImage25Bytes(response, GPT_IMAGE_25_IMAGE_BYTES, signal); }
    catch (error) { throw image25DeliveryError(error, 'output_body', result[receiptDiagnostic]); }
  }
  if (bytes.byteLength > GPT_IMAGE_25_IMAGE_BYTES) throw image25Error('image_output_invalid', 'Provider image exceeds the application byte limit.', 502);
  image25Mime(bytes, mime);
  if (outputFormat && mime !== `image/${outputFormat}`) throw image25Error('image_output_format_mismatch', 'Provider output does not match the requested format.', 502);
  return { base64: image25Base64(bytes), mimeType: mime, imageUrl: null };
}

export function image25Diagnostic(error, context = {}) {
  const safeId = value => /^[a-zA-Z0-9_-]{8,128}$/.test(String(value || '')) ? value : null;
  const number = Number(error?.code ?? String(error?.message || '').match(/^(\d{4,5}):/)?.[1]);
  const code = Number.isInteger(number) && number >= 1000 && number <= 99999 ? number : null;
  const status = Number.isInteger(context.status) ? context.status : null;
  const noInference = status === 400 && [3003, 5004, 5007].includes(code);
  return { provider: 'cloudflare-ai', code, status, noInference,
    reason: noInference ? 'input_validation' : status === 401 || status === 403 ? 'credential_or_access' : status === 429 ? 'rate_limit' : 'unresolved',
    requestId: safeId(context.requestId), gatewayId: safeId(context.gatewayId), correlationId: safeId(context.correlationId) };
}

export async function callImage25Provider(ai, model, payload, options = {}, correlationId = null) {
  let response;
  try {
    response = await ai.run(model, payload, { ...options, returnRawResponse: true,
      gateway: { ...options.gateway, skipCache: true, collectLog: false, metadata: { ...options.gateway?.metadata, bitbi_dispatch: correlationId } } });
  } catch (error) { throw image25ProviderFailure(image25Diagnostic(error, { correlationId })); }
  if (!(response instanceof Response)) return response; // Native harness adapter.
  const context = { status: response.status, correlationId: response.headers.get('x-bitbi-dispatch-correlation') || correlationId, requestId: response.headers.get('cf-ai-req-id'), gatewayId: response.headers.get('cf-aig-log-id') };
  let body;
  try { body = JSON.parse(new TextDecoder().decode(await readImage25Bytes(response, GPT_IMAGE_25_INTERNAL_JSON_BYTES, options.signal))); }
  catch { throw image25ProviderFailure(image25Diagnostic(null, context)); }
  if (response.ok && body?.success !== false) {
    const result = body && Object.hasOwn(body, 'state') ? body : body?.result?.state || body?.result?.image ? body.result : body;
    if (result && typeof result === 'object') Object.defineProperty(result, receiptDiagnostic, {value:context});
    return result;
  }
  const diagnostic = image25Diagnostic(body?.errors?.[0] || body?.error, context);
  if (body?.image || body?.result?.image || body?.state) diagnostic.noInference = false;
  throw image25ProviderFailure(diagnostic);
}

function image25ProviderFailure(diagnostic) {
  return Object.assign(image25Error(diagnostic.noInference ? 'generation_provider_rejected' : 'generation_provider_outcome_unknown',
    diagnostic.noInference ? 'Provider rejected the image request before generation.' : 'Provider outcome is unresolved. Do not resubmit.', 502),
  { providerDiagnostic: diagnostic, confirmedRejection: diagnostic.noInference });
}
