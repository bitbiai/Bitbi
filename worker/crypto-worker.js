/**
 * Cloudflare Worker — CoinGecko Proxy
 * Proxies crypto market data so the browser never contacts CoinGecko directly.
 *
 * SETUP:
 * 1. Deploy this worker on Cloudflare Workers
 * 2. Add route: api.bitbi.ai/crypto -> this worker
 * 3. In DNS, add a AAAA record for "api" pointing to 100:: (proxied)
 */

const ALLOWED_ORIGIN = 'https://bitbi.ai';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=5&sparkline=true';

export default {
    async fetch(request) {
        const origin = request.headers.get('Origin') || '';
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (request.method !== 'GET') {
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        try {
            const res = await fetch(COINGECKO_URL, {
                headers: { 'Accept': 'application/json' },
            });

            if (!res.ok) {
                return new Response(JSON.stringify({ error: 'Upstream error' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }

            const data = await res.text();
            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=60',
                    ...corsHeaders,
                },
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Proxy error' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }
    },
};
