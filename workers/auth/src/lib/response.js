export function json(data, init = {}) {
  // HeadersInit may be a Headers object or an iterable of pairs. Object spread
  // drops those entries, including separate Set-Cookie fields used to clear MFA.
  const headers = new Headers(init.headers);
  for (const [name, value] of [
    ["content-type", "application/json; charset=utf-8"],
    ["cache-control", "no-store"],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
  ]) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers,
  });
}
