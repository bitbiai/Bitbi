import { ownedCanvasVideo } from './canvas-video-input.js';
import { AdminAiValidationError, validateAdminAiVideoBody } from '../../../../js/shared/admin-ai-contract.mjs';
import { sha256Hex } from './tokens.js';

const API = 'https://app-api.pixverse.ai/openapi/v2';
const error = (code, status = 502) => Object.assign(new Error(code), { code, status });
const providerId = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw error('pixverse_invalid_provider_id');
  return value;
};

// No arbitrary URL, cookie forwarding, raw response logging or AI binding
// pseudo-operation. Ai-trace-id is stable for a submission, fresh for reads.
async function call(env, path, { traceId, body, form } = {}) {
  const headers = { 'API-KEY': env.PIXVERSE_API_KEY, 'Ai-trace-id': traceId || crypto.randomUUID() };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await (env.__TEST_FETCH || fetch)(`${API}${path}`, {
    method: body || form ? 'POST' : 'GET', headers, body: form || (body ? JSON.stringify(body) : undefined),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw error('pixverse_transport_error');
  const reader = response.body?.getReader();
  if (!reader) throw error('pixverse_response_invalid');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) { await reader.cancel(); throw error('pixverse_response_invalid'); }
    chunks.push(value);
  }
  const text = await new Blob(chunks).text();
  let data; try { data = JSON.parse(text); } catch { throw error('pixverse_response_invalid'); }
  if (data.ErrCode !== 0 || !data.Resp) throw error('pixverse_request_rejected');
  return data.Resp;
}

// Called only after the existing Admin route has authenticated/authorized the
// administrator. Persist the source version before queueing; never accept a URL.
export async function validateAdminPixverseExtension(env, user, body) {
  if (body.model !== 'pixverse/v6' || body.operation !== 'extend') return validateAdminAiVideoBody(body);
  const { operation, source_asset_id, ...base } = body;
  if (!env.PIXVERSE_API_KEY) throw new AdminAiValidationError('Direct PixVerse access is not configured.', 503, 'pixverse_extension_unavailable');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(source_asset_id || '') || base.image_input) throw new AdminAiValidationError('Choose an owned video asset without an image input.', 400, 'invalid_video_source');
  const validated = validateAdminAiVideoBody(base);
  let source;
  try { source = await ownedCanvasVideo(env, user.id, source_asset_id); }
  catch (e) { throw new AdminAiValidationError(e.message, e.status, e.code); }
  return { ...validated, operation, source_asset_id, source_version: source.version };
}

// Admin jobs own dispatch fencing, task-ID persistence, retry/poll bounds,
// result receipts, R2 ingest and budget settlement. No member-credit adapter.
export async function invokePixverseExtension(env, input, userId, jobId, taskId = null) {
  if (!env.PIXVERSE_API_KEY) throw error('pixverse_extension_unavailable', 503);
  if (!taskId) {
    const source = await ownedCanvasVideo(env, userId, input.source_asset_id, input.source_version);
    const object = await env.USER_IMAGES.get(source.r2_key);
    if (!object || object.size !== source.size || object.etag !== source.etag) throw error('video_source_unavailable');
    const bytes = await new Response(object.body).arrayBuffer();
    if (bytes.byteLength !== source.size) throw error('video_source_changed');
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: source.mime_type }), source.mime_type === 'video/mp4' ? 'source.mp4' : 'source.mov');
    const uploaded = await call(env, '/media/upload', { form, traceId: await trace(jobId, 'upload') });
    if (uploaded.media_type !== 'video') throw error('pixverse_uploaded_media_invalid');
    const body = { video_media_id: providerId(uploaded.media_id), model: 'v6', prompt: input.prompt,
      duration: input.duration, quality: input.quality, generate_audio_switch: input.generate_audio };
    if (input.negative_prompt) body.negative_prompt = input.negative_prompt;
    if (input.seed !== null && input.seed !== undefined) body.seed = input.seed;
    const submitted = await call(env, '/video/extend/generate', { body, traceId: await trace(jobId, 'extend') });
    return { status: 'provider_pending', providerTaskId: String(providerId(submitted.video_id)), retryAfterSeconds: 30 };
  }
  const id = providerId(Number(taskId));
  const result = await call(env, `/video/result/${id}`);
  if (Number(result.id) !== id) throw error('pixverse_result_identity_mismatch');
  if ([6, 7, 8].includes(result.status)) return { status: 'failed', providerTaskId: String(id) };
  if (result.status !== 1) return { status: 'provider_pending', providerTaskId: String(id), retryAfterSeconds: 30 };
  if (typeof result.url !== 'string') throw error('pixverse_result_invalid');
  // Existing Admin output ingest enforces remote media validation and limits.
  return { status: 'succeeded', providerTaskId: String(id), videoUrl: result.url,
    outputWidth: result.outputWidth, outputHeight: result.outputHeight };
}

async function trace(job, operation) {
  const hex = await sha256Hex(`pixverse:${job}:${operation}`);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
