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
const FROM_EMAIL = 'contact@bitbi.ai';

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
        }

        if (origin !== ALLOWED_ORIGIN) {
            return new Response('Forbidden', { status: 403 });
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

            /* Basic email format validation */
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
                    from: `${name} <${FROM_EMAIL}>`,
                    to: [TO_EMAIL],
                    reply_to: email,
                    subject: subject || `Contact from ${name}`,
                    text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject || '(none)'}\n\n${message}`,
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
