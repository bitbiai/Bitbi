import { json } from '../lib/response.js';
import { readJsonBodyOrResponse, BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { canvasMediaPolicyView, saveCanvasMediaPolicy } from '../lib/canvas-agent-media-policy.js';

export async function handleCanvasMediaPolicy(ctx, session) {
  const match = ctx.pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/agent\/media-policy$/);
  if (!match) return null;
  const respond = data => json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  // route-policy: account.canvas.agent.media-policy.read
  if (ctx.method === 'GET') return respond(await canvasMediaPolicyView(ctx.env, match[1], session.user.id));
  // route-policy: account.canvas.agent.media-policy.save
  if (ctx.method === 'PUT') {
    const limited = await enforceSensitiveUserRateLimit(ctx, { userId: session.user.id, scope: 'canvas-agent-write-user', maxRequests: 30, windowMs: 3600000, component: 'canvas-agent' });
    if (limited) return limited;
    const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    return respond(await saveCanvasMediaPolicy(ctx.env, match[1], session.user.id, parsed.body, ctx.request.headers.get('Idempotency-Key')));
  }
  return null;
}
