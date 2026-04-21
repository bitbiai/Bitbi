export const PUBLIC_MEDIA_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const PUBLIC_MEDIA_ALIAS_CACHE_CONTROL = "no-store";

export function buildPublicMediaHeaders(contentType, size, { immutable = false } = {}) {
  const headers = new Headers();
  headers.set("Content-Type", contentType || "application/octet-stream");
  headers.set(
    "Cache-Control",
    immutable ? PUBLIC_MEDIA_IMMUTABLE_CACHE_CONTROL : PUBLIC_MEDIA_ALIAS_CACHE_CONTROL
  );
  headers.set("X-Content-Type-Options", "nosniff");
  if (Number.isFinite(size) && size > 0) {
    headers.set("Content-Length", String(size));
  }
  return headers;
}

export function buildPublicMediaAliasRedirect(location) {
  const headers = new Headers();
  headers.set("Location", location);
  headers.set("Cache-Control", PUBLIC_MEDIA_ALIAS_CACHE_CONTROL);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(null, {
    status: 302,
    headers,
  });
}
