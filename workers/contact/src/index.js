import { evaluateSharedRateLimit, getClientIp } from './lib/rate-limit.js';
import {
    getCorrelationId,
    getDurationMs,
    getErrorFields,
    getRequestLogFields,
    logDiagnostic,
} from '../../../js/shared/worker-observability.mjs';
export { ContactPublicRateLimiterDurableObject } from './lib/public-rate-limiter-do.js';

/**
 * Contact form worker for `https://contact.bitbi.ai`.
 * Depends on `RESEND_API_KEY` plus Durable Object binding `PUBLIC_RATE_LIMITER`
 * for shared contact abuse counters. Production contact abuse protection now
 * fails closed if that binding is unavailable.
 */

const ALLOWED_ORIGIN = 'https://bitbi.ai';
const TO_EMAIL = 'bit@bitbi.ai';
const FROM_EMAIL = 'contact@contact.bitbi.ai';
const CONTACT_BURST_LIMIT = 3;
const CONTACT_BURST_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_HOURLY_LIMIT = 5;
const CONTACT_HOURLY_WINDOW_MS = 60 * 60 * 1000;

/* Strip control characters (CR, LF, NUL, etc.) from values used in email headers */
function sanitizeHeaderValue(str) {
    return str.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
    };
}

function protectionsUnavailableResponse(origin) {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable. Please try again later.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const correlationId = getCorrelationId(request);
        const requestInfo = { request, pathname, method: request.method };
        const origin = request.headers.get('Origin') || '';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', {
                status: 405,
                headers: {
                    ...corsHeaders(origin),
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Allow': 'POST, OPTIONS',
                },
            });
        }

        if (origin !== ALLOWED_ORIGIN) {
            return new Response('Forbidden', {
                status: 403,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        }

        /* Shared durable abuse gates fail closed in production when protection infra is unavailable */
        const startedAt = Date.now();
        const ip = getClientIp(request);
        const burstLimit = await evaluateSharedRateLimit(
            env,
            'contact-submit-ip-burst',
            ip,
            CONTACT_BURST_LIMIT,
            CONTACT_BURST_WINDOW_MS,
            {
                backend: 'durable_object',
                failClosedInProduction: true,
                logBlockedEvent: true,
                component: 'contact-submit',
                correlationId,
                requestInfo,
            },
        );
        if (burstLimit.unavailable) {
            return protectionsUnavailableResponse(origin);
        }
        if (burstLimit.limited) {
            return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
            });
        }

        const hourlyLimit = await evaluateSharedRateLimit(
            env,
            'contact-submit-ip-hourly',
            ip,
            CONTACT_HOURLY_LIMIT,
            CONTACT_HOURLY_WINDOW_MS,
            {
                backend: 'durable_object',
                failClosedInProduction: true,
                logBlockedEvent: true,
                component: 'contact-submit',
                correlationId,
                requestInfo,
            },
        );
        if (hourlyLimit.unavailable) {
            return protectionsUnavailableResponse(origin);
        }
        if (hourlyLimit.limited) {
            return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
            });
        }

        try {
            const { name, email, subject, message, website } = await request.json();

            /* Honeypot — bots fill this hidden field; silently discard */
            if (website) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
                });
            }

            if (!name || !email || !message) {
                return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
                });
            }

            /* Field length limits */
            const trimName = String(name).slice(0, 101);
            const trimEmail = String(email).slice(0, 255);
            const trimSubject = String(subject || '').slice(0, 201);
            const trimMessage = String(message).slice(0, 5001);
            if (trimName.length > 100 || trimEmail.length > 254 || trimSubject.length > 200 || trimMessage.length > 5000) {
                return new Response(JSON.stringify({ error: 'One or more fields exceed the maximum allowed length' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
                });
            }

            /* Sanitize header-bound fields (prevent CR/LF header injection) */
            const safeName = sanitizeHeaderValue(trimName);
            const safeEmail = sanitizeHeaderValue(trimEmail);
            const safeSubject = sanitizeHeaderValue(trimSubject);

            /* Basic email format validation */
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
                return new Response(JSON.stringify({ error: 'Invalid email format' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
                });
            }

            let res;
            try {
                res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: `${safeName} <${FROM_EMAIL}>`,
                        to: [TO_EMAIL],
                        replyTo: [safeEmail],
                        subject: safeSubject || `Contact from ${safeName}`,
                        text: `Name: ${safeName}\nEmail: ${safeEmail}\nSubject: ${safeSubject || '(none)'}\n\n${trimMessage}`,
                    }),
                });
            } catch (error) {
                logDiagnostic({
                    service: 'bitbi-contact',
                    component: 'contact-submit',
                    event: 'contact_submit_upstream_error',
                    level: 'error',
                    correlationId,
                    provider: 'resend',
                    failure_reason: 'network_error',
                    duration_ms: getDurationMs(startedAt),
                    ...getRequestLogFields(requestInfo),
                    ...getErrorFields(error, { includeMessage: false }),
                });
                throw error;
            }

            if (!res.ok) {
                logDiagnostic({
                    service: 'bitbi-contact',
                    component: 'contact-submit',
                    event: 'contact_submit_upstream_error',
                    level: 'error',
                    correlationId,
                    provider: 'resend',
                    failure_reason: 'upstream_rejected',
                    status: 502,
                    upstream_status: res.status,
                    upstream_content_type: res.headers.get('content-type') || null,
                    duration_ms: getDurationMs(startedAt),
                    ...getRequestLogFields(requestInfo),
                });
                return new Response(JSON.stringify({ error: 'Email send failed' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
                });
            }

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid request' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
            });
        }
    },
};
