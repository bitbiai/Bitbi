export const BITBI_CORRELATION_HEADER = "x-bitbi-correlation-id";

function generateCorrelationId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function isSafeCorrelationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function normalizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry)).filter((entry) => entry !== undefined);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeValue(entry);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }
    return out;
  }
  return String(value);
}

function getRequestFromSource(source) {
  if (source instanceof Request) return source;
  return source?.request instanceof Request ? source.request : null;
}

function getRequestMethod(source) {
  if (typeof source?.method === "string" && source.method) {
    return source.method;
  }
  const request = getRequestFromSource(source);
  return typeof request?.method === "string" && request.method ? request.method : null;
}

function getRequestPath(source) {
  if (typeof source?.pathname === "string" && source.pathname) {
    return source.pathname;
  }
  const request = getRequestFromSource(source);
  if (!request) return null;
  try {
    return new URL(request.url).pathname || null;
  } catch {
    return null;
  }
}

export function getCorrelationId(source) {
  const request = source instanceof Request ? source : source?.request;
  const headerValue = request?.headers?.get?.(BITBI_CORRELATION_HEADER);
  if (isSafeCorrelationId(headerValue)) {
    return headerValue;
  }
  return generateCorrelationId();
}

export function getRequestLogFields(source) {
  return normalizeValue({
    request_method: getRequestMethod(source),
    request_path: getRequestPath(source),
  });
}

export function getDurationMs(startedAtMs) {
  const startedAt = Number(startedAtMs);
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Date.now() - startedAt);
}

export function withCorrelationId(response, correlationId) {
  if (!(response instanceof Response) || !isSafeCorrelationId(correlationId)) {
    return response;
  }
  if (response.headers.get(BITBI_CORRELATION_HEADER) === correlationId || response.bodyUsed) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(BITBI_CORRELATION_HEADER, correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function getErrorFields(error, options = {}) {
  if (!error) return {};
  const includeMessage = options?.includeMessage !== false;
  return normalizeValue({
    error_name: error.name || null,
    error_message: includeMessage ? (error.message || String(error)) : undefined,
    error_code: error.code || null,
    error_status: error.status || null,
  });
}

export function buildDiagnosticEvent({
  service,
  component,
  event,
  level = "info",
  correlationId = null,
  ...fields
}) {
  return normalizeValue({
    ts: new Date().toISOString(),
    service,
    component,
    event,
    level,
    correlation_id: correlationId || null,
    ...fields,
  });
}

export function logDiagnostic({
  service,
  component,
  event,
  level = "info",
  correlationId = null,
  ...fields
}) {
  const entry = buildDiagnosticEvent({
    service,
    component,
    event,
    level,
    correlationId,
    ...fields,
  });
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logger(JSON.stringify(entry));
  return entry;
}
