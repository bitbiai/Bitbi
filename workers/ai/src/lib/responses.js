import {
  normalizeFableChatMemoryRejectionCategory,
} from "../../../shared/fable-chat-memory-contract.mjs";

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
  if (init.diagnosticCategory) {
    body.diagnosticCategory = normalizeFableChatMemoryRejectionCategory(
      init.diagnosticCategory
    );
  }

  return json(body, init);
}

export function notFound() {
  return errorResponse("Not found", { status: 404, code: "not_found" });
}

export function methodNotAllowed(allowed) {
  return errorResponse("Method not allowed.", {
    status: 405,
    code: "method_not_allowed",
    headers: {
      allow: allowed.join(", "),
    },
  });
}

export function fromError(error, fallbackMessage) {
  if (error?.name === "ValidationError") {
    return errorResponse(error.message, {
      status: error.status || 400,
      code: error.code || "validation_error",
    });
  }

  if (error?.code === "generation_timeout") {
    return errorResponse(error.message || fallbackMessage, {
      status: error.status || 504,
      code: "generation_timeout",
    });
  }

  if (error?.code === "unified_billing_unavailable") {
    return errorResponse(error.message || fallbackMessage, {
      status: error.status || 503,
      code: "unified_billing_unavailable",
    });
  }

  if (error?.code === "provider_invalid_replayed_context") {
    return errorResponse("Fable request context is invalid.", {
      status: 400,
      code: "provider_invalid_replayed_context",
    });
  }

  if (error?.rejectionCategory) {
    return errorResponse(fallbackMessage, {
      status: error.status || 502,
      code: "upstream_error",
      diagnosticCategory: error.rejectionCategory,
    });
  }

  const status = error?.status || 502;
  return errorResponse(fallbackMessage, {
    status,
    code: status >= 500 ? "upstream_error" : "internal_error",
  });
}
