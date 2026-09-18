// A provider capability is not a Canvas integration. Only connected adapters
// are listed here; role/runnable policy remains owned by the model registry.
export function canvasVideoMethods(model, source) {
  if (!model?.runnable || model.capability !== 'video' || !source?.assetId || source.kind !== 'video_asset') return [];
  const methods = [];
  if (model.controls?.supportsImageInput) methods.push('last_frame');
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
  const method = methods.length === 1 ? methods[0] : matches && methods.includes(saved.method) ? saved.method : null;
  return { methods, method, context, frame: method === 'last_frame' && matches && saved.method === 'last_frame' ? saved.frame || null : null };
}
