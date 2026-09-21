import { requireAdmin, requireUser } from '../lib/session.js';
import { json } from '../lib/response.js';
import { BODY_LIMITS, readJsonBodyOrResponse } from '../lib/request.js';
import { AppearanceError, getAppearance, saveAppearance } from '../lib/appearance-settings.js';
import { evaluateSharedRateLimit, rateLimitResponse, rateLimitUnavailableResponse, sensitiveRateLimitOptions } from '../lib/rate-limit.js';

const reply = appearance => json({ ok: true, appearance }, { headers: { 'Cache-Control': 'no-store' } });

export async function handleAppearance(ctx) {
    const { request, env, pathname, method, isSecure, correlationId } = ctx;
    if (!['/api/appearance', '/api/admin/appearance', '/api/account/appearance'].includes(pathname)) return null;
    try {
        if (pathname === '/api/appearance' && method === 'GET') return reply(await getAppearance(env));
        // This endpoint intentionally has no write implementation. Neither an
        // existing preference nor an arbitrary request can activate personal mode.
        if (pathname === '/api/account/appearance' && ['PUT', 'PATCH', 'POST'].includes(method)) {
            const session = await requireUser(request, env);
            if (session instanceof Response) return session;
            return json({ ok: false, code: 'appearance_personal_disabled', error: 'Personal appearance preferences are not enabled.' }, { status: 403 });
        }
        if (pathname !== '/api/admin/appearance' || !['GET', 'PATCH'].includes(method)) return null;
        const session = await requireAdmin(request, env, { isSecure, correlationId });
        if (session instanceof Response) return session;
        if (method === 'GET') return reply(await getAppearance(env, { admin: true }));
        const limit = await evaluateSharedRateLimit(env, 'appearance-admin-write', session.user.id, 30, 600_000,
            sensitiveRateLimitOptions({ component: 'appearance', correlationId, requestInfo: { request, pathname, method } }));
        if (limit.unavailable) return rateLimitUnavailableResponse(correlationId);
        if (limit.limited) return rateLimitResponse();
        const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
        if (parsed.response) return parsed.response;
        return reply(await saveAppearance(env, session.user, parsed.body));
    } catch (error) {
        if (error instanceof AppearanceError) return json({ ok: false, error: error.message, code: error.code }, { status: error.status });
        return json({ ok: false, error: 'Appearance settings are temporarily unavailable.', code: 'appearance_unavailable' }, { status: 503 });
    }
}
