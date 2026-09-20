import { H3_MODEL } from './minimax-h3.mjs';
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
  return { modelId: model?.id, assetId: source?.assetId, runId: source?.runId || null };
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
