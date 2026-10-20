import { listCanvasNotifications, readCanvasNotifications, recordCanvasClientNotification } from '../lib/canvas-notifications.js';
import { readJsonBodyOrResponse, BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { withCorrelationId } from '../../../../js/shared/worker-observability.mjs';

export async function handleCanvasNotifications(ctx,userId) {
    const match = ctx.pathname.match(/^\/api\/account\/canvas\/notifications(?:\/(read|client))?$/);
    if (!match) return null;
    const respond = (body,status=200) => withCorrelationId(Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}}),ctx.correlationId || null);
    try {
        if (ctx.method === 'GET' && !match[1]) {
            const query = new URL(ctx.request.url).searchParams;
            return respond({ok:true,data:await listCanvasNotifications(ctx.env,userId,{cursor:query.get('cursor'),limit:query.has('limit')?Number(query.get('limit')):40,projectId:query.get('projectId')})});
        }
        if (ctx.method !== 'POST' || !match[1]) return respond({ok:false,code:'method_not_allowed'},405);
        const limited = await enforceSensitiveUserRateLimit(ctx,{userId,scope:'canvas-notifications-write-user',maxRequests:240,windowMs:3600000,component:'canvas-notifications'});
        if (limited) return limited;
        const parsed = await readJsonBodyOrResponse(ctx.request,{maxBytes:BODY_LIMITS.smallJson});
        if (parsed.response) return parsed.response;
        // route-policy: account.canvas.notifications.read-markers
        if (ctx.method === 'POST' && match[1] === 'read') return respond({ok:true,data:await readCanvasNotifications(ctx.env,userId,parsed.body)});
        // route-policy: account.canvas.notifications.client
        if (ctx.method === 'POST' && match[1] === 'client') return respond({ok:true,data:await recordCanvasClientNotification(ctx.env,userId,parsed.body)},201);
        return respond({ok:false,code:'method_not_allowed'},405);
    } catch (error) {
        const status = error.status >= 400 && error.status <= 499 ? error.status : 500;
        return respond({ok:false,code:status === 500 ? 'canvas_notifications_unavailable' : error.code},status);
    }
}
