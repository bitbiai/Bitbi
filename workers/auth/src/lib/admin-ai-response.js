export function inferAdminAiErrorCode(status, message = "") {
  const normalized = String(message || "").toLowerCase();

  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 429) return "rate_limited";
  if (normalized.includes("not allowlisted")) return "model_not_allowed";
  if (normalized.includes("duplicates")) return "duplicate_models";
  if (normalized.includes("invalid json")) return "bad_request";
  if (status >= 502) return "upstream_error";
  if (status >= 500) return "internal_error";
  if (status === 400) return "validation_error";
  return "bad_request";
}

export async function withAdminAiCode(response) {
  if (!(response instanceof Response)) return response;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body || typeof body !== "object") {
    return response;
  }

  const nextCode = body.ok
    ? (
      body.code || (
        body.task === "compare" &&
        Array.isArray(body.result?.results) &&
        body.result.results.some((entry) => entry && entry.ok === false)
          ? "partial_success"
          : null
      )
    )
    : (body.code || inferAdminAiErrorCode(response.status, body.error));

  if (!nextCode || body.code === nextCode) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");

  return new Response(JSON.stringify({ ...body, code: nextCode }), {
    status: response.status,
    headers,
  });
}
