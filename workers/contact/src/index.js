import { getClientIp, isSharedRateLimited } from './lib/rate-limit.js';

/**
 * Cloudflare Worker — Contact Form Handler
 * Receives POST from the contact form and sends email via Resend API.
 *
 * SETUP:
 * 1. Sign up at https://resend.com (free: 100 emails/day)
 * 2. Add & verify your domain (bitbi.ai) in Resend dashboard
 * 3. Create an API key in Resend
 * 4. Deploy this worker on Cloudflare:
 *    - Go to Cloudflare Dashboard > Workers & Pages > Create Worker
 *    - Paste this code and deploy
 *    - Add secret: Settings > Variables > RESEND_API_KEY = your key
 *    - Add route: contact.bitbi.ai/* -> this worker
 *      (or use Workers Routes under your bitbi.ai domain DNS settings)
 *    - In DNS, add a AAAA record for "contact" pointing to 100:: (proxied)
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

export default {
    async fetch(request, env) {
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

        /* Shared durable abuse gates with in-memory fallback */
        const ip = getClientIp(request);
        const burstLimited = await isSharedRateLimited(
            env,
            'contact-submit-ip-burst',
            ip,
            CONTACT_BURST_LIMIT,
            CONTACT_BURST_WINDOW_MS,
        );
        if (burstLimited) {
            return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
            });
        }

        const hourlyLimited = await isSharedRateLimited(
            env,
            'contact-submit-ip-hourly',
            ip,
            CONTACT_HOURLY_LIMIT,
            CONTACT_HOURLY_WINDOW_MS,
        );
        if (hourlyLimited) {
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

            const res = await fetch('https://api.resend.com/emails', {
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

            if (!res.ok) {
                const err = await res.text();
                console.error('Resend error:', err);
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
