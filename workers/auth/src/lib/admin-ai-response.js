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

export function normalizeAdminAiResponseBody(body, status = 200) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
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
    : (body.code || inferAdminAiErrorCode(status, body.error));

  return !nextCode || body.code === nextCode
    ? body
    : { ...body, code: nextCode };
}

export async function consumeAdminAiJsonResponseOnce(response) {
  if (!(response instanceof Response)) {
    return {
      body: {
        ok: false,
        error: "AI lab returned an invalid response.",
        code: "upstream_error",
      },
      headers: new Headers(),
      ok: false,
      status: 502,
      statusText: "",
    };
  }

  const headers = new Headers(response.headers);
  try {
    const body = await response.json();
    return {
      body: normalizeAdminAiResponseBody(body, response.status),
      headers,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch {
    return {
      body: {
        ok: false,
        error: "AI lab returned an invalid JSON response.",
        code: "upstream_error",
      },
      headers,
      ok: false,
      status: response.ok ? 502 : response.status,
      statusText: response.ok ? "" : response.statusText,
    };
  }
}

export async function withAdminAiCode(response) {
  if (!(response instanceof Response)) return response;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const normalizedBody = normalizeAdminAiResponseBody(body, response.status);
  if (normalizedBody === body) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");

  return new Response(JSON.stringify(normalizedBody), {
    status: response.status,
    headers,
  });
}
