import { H3_MODEL, H3_ROLES, h3MediaType } from './minimax-h3.mjs';
// Keep a saved role visible after a media-type replacement, but never reinterpret
// that asset as the previous type. The Inspector and admission share this check.
export function canvasInputRoleMatches(role, kind) {
  const media={image_asset:'image',video_asset:'video',audio_asset:'audio'}[kind];
  return !media || H3_ROLES.includes(role) && h3MediaType(role)===media;
}
// A provider capability is not a Canvas integration. Only connected adapters
// are listed here; role/runnable policy remains owned by the model registry.
export function canvasVideoMethods(model, source) {
  if (!model?.runnable || model.capability !== 'video' || !source?.assetId || source.kind !== 'video_asset') return [];
  if (model.id === H3_MODEL) return ['reference_video', 'last_frame'];
  const methods = [];
  if (model.controls?.supportsImageInput) methods.push('last_frame');
  if (model.controls?.nativeVideoInput && model.controls?.supportsVideoInput) for (const operation of ['edit','extend']) if ((model.controls.availableOperations || model.controls.supportedOperations)?.includes(operation)) methods.push(operation);
  return methods;
}

export function canvasVideoContext(model, source) {
  return { modelId: model?.id, assetId: source?.assetId, runId: source?.runId || null, ...(!source?.runId && source?.sourceNodeId ? {nodeId:source.sourceNodeId} : {}) };
}

export function resolveCanvasVideoInput(model, source, config = {}) {
  const methods = canvasVideoMethods(model, source);
  const context = canvasVideoContext(model, source);
  const saved = config.videoInput;
  const matches = saved && Object.keys(context).every(key => saved[key] === context[key]);
  const invalidMethod = Boolean(matches && saved.method && !methods.includes(saved.method));
  const method = invalidMethod ? null : model?.id === H3_MODEL
    ? (saved?.modelId === H3_MODEL && methods.includes(saved.method) ? saved.method : 'reference_video') : methods.length === 1 ? methods[0] : matches && methods.includes(saved.method) ? saved.method : null;
  return { methods, method, invalidMethod, context, sourceVersion: matches ? saved.sourceVersion || null : null, frame: method === 'last_frame' && matches && saved.method === 'last_frame' ? saved.frame || null : null };
}
