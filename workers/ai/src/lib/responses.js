export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...init.headers,
    },
  });
}

export function ok(payload, init = {}) {
  return json(
    {
      ok: true,
      ...payload,
    },
    init
  );
}

export function errorResponse(error, init = {}) {
  const body = {
    ok: false,
    error,
  };

  if (init.code) body.code = init.code;
  if (init.warnings?.length) body.warnings = init.warnings;

  return json(body, init);
}

export function notFound() {
  return errorResponse("Not found", { status: 404 });
}

export function methodNotAllowed(allowed) {
  return errorResponse("Method not allowed.", {
    status: 405,
    headers: {
      allow: allowed.join(", "),
    },
  });
}

export function fromError(error, fallbackMessage) {
  if (error?.name === "ValidationError") {
    return errorResponse(error.message, {
      status: error.status || 400,
      code: error.code,
    });
  }

  const message = error?.message ? `${fallbackMessage}: ${error.message}` : fallbackMessage;
  return errorResponse(message, { status: error?.status || 502 });
}
