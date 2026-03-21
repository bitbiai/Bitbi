// src/index.js
const ALLOWED_ORIGIN = "https://bitbi.ai";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=5&sparkline=true";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const res = await fetch(COINGECKO_URL, {
        headers: {
          Accept: "application/json",
          "x-cg-demo-api-key": env.COINGECKO_API_KEY
        }
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Upstream error" }), {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }

      const data = await res.json();
      const filtered = data.filter(c => c.symbol?.toLowerCase() !== 'usdt').slice(0, 4);

      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          ...corsHeaders
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Proxy error" }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
  }
};