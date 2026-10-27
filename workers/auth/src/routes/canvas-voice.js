import { readJsonBodyOrResponse, BODY_LIMITS } from '../lib/request.js';
import { enforceSensitiveUserRateLimit } from '../lib/sensitive-write-limit.js';
import { readCanvasVoiceSettings, saveCanvasVoiceSettings, requireCanvasVoiceOwner, canvasVoiceAvailability } from '../lib/canvas-voice-settings.js';
import { agentFail } from '../lib/canvas-agent-store.js';
import { nowIso } from '../lib/tokens.js';
import { quoteCanvasVoiceSession, admitCanvasVoiceSession, readOwnedCanvasVoiceSession } from '../lib/canvas-voice-accounting.js';
import { forwardCanvasVoiceOwner } from '../lib/canvas-voice-owner.js';

export async function handleCanvasVoice(ctx, session) {
    const match = ctx.pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/agent\/voice(?:\/(settings|quote|sessions|sessions\/([a-f0-9]{32})\/(stop|socket)))?$/);
    if (!match) return null;
    // WebSocket handshakes are GETs, so the ordinary write-only CSRF check
    // does not cover them. The browser adapter uses this exact public origin.
    if (match[4] === 'socket' && (ctx.method !== 'GET'
        || ctx.request.headers.get('Origin') !== new URL(ctx.request.url).origin
        || ctx.request.headers.get('Sec-Fetch-Site') === 'cross-site'
        || ctx.request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')) agentFail('canvas_voice_origin_forbidden', 403);
    const userId = session.user.id, projectId = match[1];
    await requireCanvasVoiceOwner(ctx.env, userId, projectId);
    const respond = data => Response.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
    // route-policy: account.canvas.voice.read
    if (ctx.method === 'GET' && !match[2]) return respond(await readCanvasVoiceSettings(ctx.env, userId, projectId));
    if (ctx.method !== 'POST' && match[4] !== 'socket') return null;
    const limited = await enforceSensitiveUserRateLimit(ctx, { userId, scope: 'canvas-voice-user', maxRequests: 60, windowMs: 3600000, component: 'canvas-voice' });
    if (limited) return limited;
    const requireAvailable = () => { const availability = canvasVoiceAvailability(ctx.env); if (!availability.available) agentFail(availability.code, 503); };
    if (match[4] === 'socket') {
        requireAvailable();
        const scope = { userId, projectId, sessionId: match[3] };
        await readOwnedCanvasVoiceSession(ctx.env, scope);
        return forwardCanvasVoiceOwner(ctx.env, scope, 'connect');
    }
    const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    // route-policy: account.canvas.voice.settings
    if (ctx.method === 'POST' && match[2] === 'settings') return respond(await saveCanvasVoiceSettings(ctx.env, userId, projectId, parsed.body, ctx.request.headers.get('Idempotency-Key')));
    // Stop is safe even while admission is pending: its durable tombstone stops
    // a delayed POST from opening a provider connection after the user cancels.
    // route-policy: account.canvas.voice.stop
    if (ctx.method === 'POST' && match[4] === 'stop') {
        if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body) || Object.keys(parsed.body).length || ctx.request.headers.get('Idempotency-Key') !== match[3]) agentFail('canvas_voice_input_invalid', 400);
        const prior = await ctx.env.DB.prepare('SELECT user_id,project_id,1 AS admitted FROM canvas_voice_sessions WHERE id=? UNION ALL SELECT user_id,project_id,0 AS admitted FROM canvas_voice_stop_requests WHERE session_id=?').bind(match[3], match[3]).all();
        if (prior.results.some(row => row.user_id !== userId || row.project_id !== projectId)) agentFail('canvas_voice_session_not_found', 404);
        await ctx.env.DB.batch([
            ctx.env.DB.prepare(`SELECT CASE WHEN NOT EXISTS(
              SELECT 1 FROM canvas_voice_sessions WHERE id=? AND (user_id!=? OR project_id!=?)
              UNION ALL SELECT 1 FROM canvas_voice_stop_requests WHERE session_id=? AND (user_id!=? OR project_id!=?)
              ) THEN 1 ELSE json_extract('[]','$[') END`).bind(match[3], userId, projectId, match[3], userId, projectId),
            ctx.env.DB.prepare('INSERT OR IGNORE INTO canvas_voice_stop_requests(session_id,project_id,user_id,created_at) VALUES(?,?,?,?)').bind(match[3], projectId, userId, nowIso()),
            ctx.env.DB.prepare("UPDATE canvas_voice_sessions SET stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=?").bind(nowIso(), match[3], userId, projectId),
        ]);
        const owned = prior.results.some(row => row.admitted === 1);
        if (owned) {
            // The owner observes/terminates the original socket. A durable stop
            // request itself is never evidence of provider completion.
            const result = await forwardCanvasVoiceOwner(ctx.env, { userId, projectId, sessionId: match[3] }, 'stop');
            return result;
        }
        return respond({ stopped: false, stopRequested: true });
    }
    // route-policy: account.canvas.voice.quote
    if (ctx.method === 'POST' && match[2] === 'quote') {
        requireAvailable();
        return respond({ quote: await quoteCanvasVoiceSession(ctx.env, { userId, projectId, input: parsed.body }) });
    }
    // route-policy: account.canvas.voice.session
    if (ctx.method === 'POST' && match[2] === 'sessions') {
        requireAvailable();
        return respond(await admitCanvasVoiceSession(ctx.env, { userId, projectId, authSessionId: session.sessionId,
            input: parsed.body, idempotencyKey: ctx.request.headers.get('Idempotency-Key') }));
    }
    return null;
}
