// Only our fixed database constraints become public decision errors. Provider
// text and unknown database exceptions never become client-visible messages.
export const CANVAS_MEDIA_CONSTRAINT_CODES = Object.freeze([
  'canvas_agent_media_policy_changed', 'canvas_agent_media_model_not_allowed',
  'canvas_agent_media_limit_exceeded', 'canvas_agent_media_limit_below_committed',
  'canvas_agent_project_budget_required', 'canvas_agent_budget_exceeded',
]);
export function canvasMediaConstraintError(error) {
  const chain = []; for (let item = error; item && chain.length < 3; item = item.cause) chain.push(item);
  if (!chain.some(item => ['SQLITE_ERROR', 'ERR_SQLITE_ERROR', 'D1_ERROR'].includes(item.code)
    || /^D1_ERROR:/.test(String(item.message || '')))) return error;
  const text = chain.map(item => String(item.message || '').slice(0, 2000)).join('\n');
  const code = CANVAS_MEDIA_CONSTRAINT_CODES.find(value => new RegExp(`\\b${value}\\b`).test(text));
  return code ? Object.assign(new Error(code, { cause: error }), { code, status: 409 }) : error;
}
