import { resolveCanvasVideoInput } from '../../../../js/shared/canvas-video-input.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';
import { sha256Hex } from './tokens.js';
import { handleSaveImage } from '../routes/ai/images-write.js';

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

export async function ownedCanvasVideo(env, userId, assetId, expectedVersion = null) {
  const row = await env.DB.prepare("SELECT id, r2_key, mime_type, size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ? AND source_module = 'video' LIMIT 1").bind(assetId, userId).first();
  if (!row?.r2_key) fail('video_source_unavailable', 'The connected video is not available to this account.', 404);
  const head = await env.USER_IMAGES.head(row.r2_key);
  if (!head || !['video/mp4', 'video/quicktime', 'video/mov'].includes(row.mime_type)) fail('video_source_unavailable', 'The connected original must be an available MP4 or MOV.');
  if (!head.size || head.size > 50_000_000) fail('video_source_too_large', 'Connected video must be at most 50 MB.');
  const version = await sha256Hex(`${row.id}:${row.r2_key}:${head.etag}:${head.size}`);
  if (expectedVersion && expectedVersion !== version) fail('video_source_changed', 'The connected original changed; prepare its input again.');
  return { ...row, version, etag: head.etag, size: head.size };
}

// Config remains small; only this owner-checked save path can attach a frame.
// Client-supplied image IDs and provider IDs never establish provenance.
export async function prepareCanvasVideoEdge(ctx, user, edge, proposed, imageData) {
  const config = { ...proposed };
  if (!config.videoInput) return config;
  if (config.videoInput.method !== 'last_frame') fail('video_method_invalid', 'Canvas only supports the last decoded frame as video input.');
  const rows = await ctx.env.DB.prepare(`SELECT id, type, model_id, asset_id, output_json FROM canvas_nodes
    WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL AND id IN (?, ?)`)
    .bind(edge.project_id, user.id, edge.source_node_id, edge.target_node_id).all();
  const source = rows.results?.find(row => row.id === edge.source_node_id);
  const target = rows.results?.find(row => row.id === edge.target_node_id);
  if (!source || !target || target.type !== 'video_generation') fail('video_connection_invalid', 'This video connection is unavailable.');
  const output = parse(source.output_json);
  const value = { kind: 'video_asset', assetId: source.asset_id || output.assetId || output.asset?.id, runId: output.runId || null };
  const model = getCanvasModelForRole(target.model_id, user.role);
  const selected = resolveCanvasVideoInput(model, value, config);
  if (!Object.keys(selected.context).every(key => config.videoInput[key] === selected.context[key])) fail('video_source_changed', 'The connected video or target model changed.');
  if (!selected.method) fail('video_method_required', 'Select a valid method for the current video and model.');
  const owned = await ownedCanvasVideo(ctx.env, user.id, value.assetId);
  const prior = parse(edge.config_json).videoInput;
  config.videoInput = { ...selected.context, method: selected.method };
  const same = prior && Object.keys(config.videoInput).every(key => prior[key] === config.videoInput[key]);
  if (same && prior.frame?.version === owned.version) config.videoInput.frame = prior.frame;
  if (imageData !== undefined) {
    if (selected.method !== 'last_frame') fail('video_method_invalid', 'A frame belongs only to the start-image method.');
    const imageId = (await sha256Hex(`canvas-frame:${user.id}:${edge.project_id}:${edge.id}:${owned.version}:${value.runId}`)).slice(0, 32);
    const request = new Request(new URL('/api/ai/images/save', ctx.request.url), {
      method: 'POST', headers: ctx.request.headers,
      body: JSON.stringify({ imageData, prompt: 'Canvas video last frame', title: 'Canvas video last frame' }),
    });
    const response = await handleSaveImage({ ...ctx, request, canvasImageId: imageId });
    const result = await response.json();
    if (!response.ok || !result.ok) fail('video_frame_save_failed', 'The decoded frame could not be saved.', response.status);
    config.videoInput.frame = { imageId, version: owned.version, previewUrl: `/api/ai/images/${imageId}/file` };
  }
  return config;
}

export async function applyCanvasVideoInput(env, userId, resolution, body, loadImage) {
  if (!resolution.videoReferences.length) return;
  if (resolution.videoReferences.length !== 1 || resolution.imageReferences.length) fail('video_source_ambiguous', 'Connect exactly one video source without a competing image input.');
  const source = resolution.videoReferences[0], selected = source.videoInput;
  if (!selected?.method) fail('video_method_required', 'Select how to use the connected video.');
  if (selected.method !== 'last_frame') fail('video_method_invalid', 'Canvas only supports last-frame input.');
  if (!selected.frame?.imageId) fail('video_frame_required', 'Prepare the last decoded frame before running.');
  await ownedCanvasVideo(env, userId, source.assetId, selected.frame.version);
  const image = await loadImage(env, userId, selected.frame.imageId);
  if (!image) fail('video_frame_unavailable', 'Prepare the source frame again; its saved image is unavailable.');
  body.image_input = image;
}
