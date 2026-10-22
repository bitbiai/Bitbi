// Presentation and validation only; server-owned revisions and D1 admission
// enforce spending. Null is uncapped within the project cap. Zero is zero.
export const CANVAS_MEDIA_POLICY_VERSION = 1;
export const CANVAS_MEDIA_POLICY_MAX_MODELS = 100;
const fail = () => { throw Object.assign(new Error('canvas_agent_media_policy_invalid'), { code: 'canvas_agent_media_policy_invalid', status: 400 }); };
export function normalizeCanvasMediaPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['mode', 'models'].includes(key))
    || !['automatic', 'selected'].includes(value.mode) || !Array.isArray(value.models)
    || value.models.length > CANVAS_MEDIA_POLICY_MAX_MODELS || value.mode === 'automatic' && value.models.length) fail();
  const ids = new Set();
  const models = value.models.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'creditLimit,modelId'
      || typeof item.modelId !== 'string' || !/^(?:@cf\/)?[a-z0-9][a-z0-9._/-]{1,179}$/.test(item.modelId) || ids.has(item.modelId)
      || item.creditLimit !== null && (!Number.isSafeInteger(item.creditLimit) || item.creditLimit < 0 || item.creditLimit > 100000)) fail();
    ids.add(item.modelId); return { modelId: item.modelId, creditLimit: item.creditLimit };
  }).sort((a, b) => a.modelId.localeCompare(b.modelId));
  return { mode: value.mode, models };
}
export const canvasMediaPolicyAllows = (policy, modelId) => policy.mode === 'automatic' || policy.models.some(item => item.modelId === modelId);
