import { json } from "./response.js";

const CURSOR_VERSION = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const cursorKeyCache = new Map();

export class PaginationValidationError extends Error {
  constructor(message = "Invalid cursor.") {
    super(message);
    this.name = "PaginationValidationError";
    this.status = 400;
    this.code = "validation_error";
  }
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 1) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  if (padding === 0) return normalized;
  return normalized + "=".repeat(4 - padding);
}

function stableCursorStringify(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => [key, value[key]]);
  return JSON.stringify(Object.fromEntries(entries));
}

async function getCursorSigningKey(secret) {
  const cacheKey = String(secret || "");
  if (!cacheKey) {
    throw new Error("Missing SESSION_SECRET for cursor signing.");
  }
  if (!cursorKeyCache.has(cacheKey)) {
    cursorKeyCache.set(
      cacheKey,
      crypto.subtle.importKey(
        "raw",
        textEncoder.encode(`pagination:${cacheKey}`),
        {
          name: "HMAC",
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"]
      )
    );
  }
  return cursorKeyCache.get(cacheKey);
}

async function signCursorBody(secret, body) {
  const key = await getCursorSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(stableCursorStringify(body))
  );
  return toBase64Url(bytesToBase64(new Uint8Array(signature)));
}

export function resolvePaginationLimit(value, { defaultValue, maxValue, minValue = 1 }) {
  const fallback = Math.min(Math.max(Number(defaultValue) || minValue, minValue), maxValue);
  if (value === null || value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.floor(parsed);
  return Math.min(Math.max(normalized, minValue), maxValue);
}

export async function encodePaginationCursor(env, type, payload = {}) {
  const unsignedBody = {
    v: CURSOR_VERSION,
    t: type,
    ...payload,
  };
  const body = {
    ...unsignedBody,
    sig: await signCursorBody(env?.SESSION_SECRET, unsignedBody),
  };
  return toBase64Url(bytesToBase64(textEncoder.encode(JSON.stringify(body))));
}

export async function decodePaginationCursor(env, cursor, expectedType) {
  if (!cursor) return null;
  if (typeof cursor !== "string" || cursor.length > 500) {
    throw new PaginationValidationError("Invalid cursor.");
  }

  try {
    const parsed = JSON.parse(textDecoder.decode(base64ToBytes(fromBase64Url(cursor))));
    if (!parsed || typeof parsed !== "object") {
      throw new PaginationValidationError("Invalid cursor.");
    }
    const signature = parsed.sig;
    if (typeof signature !== "string" || !signature) {
      throw new PaginationValidationError("Invalid cursor.");
    }
    const { sig: _ignoredSignature, ...unsignedBody } = parsed;
    if (unsignedBody.v !== CURSOR_VERSION || unsignedBody.t !== expectedType) {
      throw new PaginationValidationError("Invalid cursor.");
    }
    const expectedSignature = await signCursorBody(env?.SESSION_SECRET, unsignedBody);
    if (signature !== expectedSignature) {
      throw new PaginationValidationError("Invalid cursor.");
    }
    return unsignedBody;
  } catch (error) {
    if (error instanceof PaginationValidationError) throw error;
    throw new PaginationValidationError("Invalid cursor.");
  }
}

export function readCursorString(cursor, key, { allowEmpty = false, maxLength = 200 } = {}) {
  const value = cursor?.[key];
  if (typeof value !== "string") {
    throw new PaginationValidationError("Invalid cursor.");
  }
  if (!allowEmpty && !value) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  if (value.length > maxLength) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  return value;
}

export function readCursorInteger(cursor, key, { min = null, max = null } = {}) {
  const value = cursor?.[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  if (min !== null && value < min) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  if (max !== null && value > max) {
    throw new PaginationValidationError("Invalid cursor.");
  }
  return value;
}

export function paginationErrorResponse(message = "Invalid cursor.") {
  return json(
    {
      ok: false,
      error: message,
      code: "validation_error",
    },
    { status: 400 }
  );
}
