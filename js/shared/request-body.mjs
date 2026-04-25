export class RequestBodyError extends Error {
  constructor(message, { status = 400, code = "bad_request", publicMessage = null } = {}) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage || message;
  }
}

export function isRequestBodyError(error) {
  return error instanceof RequestBodyError;
}

export function getContentLength(request) {
  const raw = request?.headers?.get?.("content-length");
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) {
    throw new RequestBodyError("Invalid Content-Length header.", {
      status: 400,
      code: "invalid_content_length",
      publicMessage: "Invalid request body.",
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RequestBodyError("Invalid Content-Length header.", {
      status: 400,
      code: "invalid_content_length",
      publicMessage: "Invalid request body.",
    });
  }
  return value;
}

export function rejectIfBodyTooLarge(request, maxBytes) {
  const contentLength = getContentLength(request);
  if (contentLength != null && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large.", {
      status: 413,
      code: "payload_too_large",
      publicMessage: "Payload too large.",
    });
  }
}

function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function contentTypeIsAllowed(request, allowedTypes) {
  const contentType = normalizeContentType(request?.headers?.get?.("content-type"));
  if (!contentType) return false;
  return allowedTypes.some((allowed) => contentType === String(allowed).toLowerCase());
}

export function assertContentType(request, allowedTypes) {
  if (!contentTypeIsAllowed(request, allowedTypes)) {
    throw new RequestBodyError("Unsupported media type.", {
      status: 415,
      code: "unsupported_media_type",
      publicMessage: "Unsupported media type.",
    });
  }
}

function normalizeChunk(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return new TextEncoder().encode(String(chunk ?? ""));
}

export async function readBodyBytesLimited(request, { maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer.");
  }
  rejectIfBodyTooLarge(request, maxBytes);

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = normalizeChunk(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new RequestBodyError("Request body is too large.", {
          status: 413,
          code: "payload_too_large",
          publicMessage: "Payload too large.",
        });
      }
      chunks.push(chunk);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readTextBodyLimited(request, { maxBytes, allowedTypes = null } = {}) {
  if (allowedTypes) assertContentType(request, allowedTypes);
  const bytes = await readBodyBytesLimited(request, { maxBytes });
  return new TextDecoder().decode(bytes);
}

export async function readJsonBodyLimited(
  request,
  {
    maxBytes,
    allowedTypes = ["application/json"],
    requiredContentType = true,
  } = {}
) {
  if (requiredContentType) {
    assertContentType(request, allowedTypes);
  } else if (!contentTypeIsAllowed(request, allowedTypes)) {
    return null;
  }

  const text = await readTextBodyLimited(request, { maxBytes });
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestBodyError("Invalid JSON body.", {
      status: 400,
      code: "invalid_json",
      publicMessage: "Invalid JSON body.",
    });
  }
}

export async function readFormDataLimited(
  request,
  {
    maxBytes,
    allowedTypes = ["multipart/form-data"],
  } = {}
) {
  assertContentType(request, allowedTypes);
  const bytes = await readBodyBytesLimited(request, { maxBytes });
  try {
    return await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes,
    }).formData();
  } catch {
    throw new RequestBodyError("Invalid form data.", {
      status: 400,
      code: "invalid_form_data",
      publicMessage: "Invalid form data.",
    });
  }
}
