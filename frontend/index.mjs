// This is not the dormant Pages _worker.js. No server-side locale inference:
// explicit URLs and the existing browser preference logic retain ownership.
export default {
  async fetch(request, env) {
    try {
      const response = await serve(request, env);
      // Fixed codes only: never include URLs, headers, bodies or error objects.
      // Cloudflare performs the configured 10% sampling, not another random gate.
      if (response.status >= 500) console.error('frontend_asset_response_error');
      else if (response.status === 404) console.warn('frontend_not_found');
      return response;
    } catch {
      console.error('frontend_asset_fetch_failed');
      return new Response(request.method === 'HEAD' ? null : 'Internal server error', {
        status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  },
};

async function serve(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.bitbi.ai') {
      url.hostname = 'bitbi.ai'; url.protocol = 'https:'; url.port = '';
      return new Response(null, { status: 301, headers: { Location: url.href } });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // Production /api/* is still served by the separate, more-specific Auth
      // route. Preview has no backend and must never proxy production cookies.
      return Response.json({ error: 'API_NOT_AVAILABLE_ON_STATIC_HOST' }, {
        status: 404, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    // Document requests run here for www canonicalization; resource prefixes
    // stay asset-first. Never perform geographic/language redirects.
    const exact = await env.ASSETS.fetch(request);
    if (exact.status !== 404) return exact;
    // Resolve real directory indexes, not a catch-all SPA/homepage.
    const originalPath = url.pathname;
    url.pathname = `${originalPath.replace(/\/$/, '')}/index.html`;
    const index = await env.ASSETS.fetch(new Request(url, request));
    if (index.status === 200) {
      if (!originalPath.endsWith('/')) {
        url.pathname = `${originalPath}/`;
        return new Response(null, { status: 301, headers: { Location: url.href } });
      }
      return index;
    }
    return new Response(request.method === 'HEAD' ? null : 'Not found', {
      status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
