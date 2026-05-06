import {
  LOCALE_ROUTING_VARY,
  getGeoRedirectLocation,
  isDocumentRoute,
} from "./js/shared/locale-routing.mjs";

function withVary(response) {
  const headers = new Headers(response.headers);
  const existing = headers.get("Vary");
  const parts = new Set(
    `${existing || ""}, ${LOCALE_ROUTING_VARY}`
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  headers.set("Vary", Array.from(parts).join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const redirectLocation = getGeoRedirectLocation(request);
    if (redirectLocation) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectLocation,
          Vary: LOCALE_ROUTING_VARY,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    if (isDocumentRoute(url.pathname)) return withVary(response);
    return response;
  },
};
