import { sha256Hex } from "../../lib/tokens.js";
import { image25Mime, GPT_IMAGE_25_IMAGE_BYTES } from '../../../../shared/gpt-image-25.mjs';
import {
  getAiSaveReferenceSigningSecret,
  getAiSaveReferenceSigningSecretCandidates,
} from "../../lib/security-secrets.js";

export const AI_GENERATED_SAVE_REFERENCE_VERSION = 1;
export const AI_GENERATED_SAVE_REFERENCE_TYPE = "ai_generated_image_save";
export const AI_GENERATED_SAVE_REFERENCE_TTL_MINUTES = 30;
export const AI_GENERATED_SAVE_REFERENCE_TTL_MS = AI_GENERATED_SAVE_REFERENCE_TTL_MINUTES * 60_000;
export const AI_GENERATED_TEMP_OBJECT_PREFIX = "tmp/ai-generated/";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const signingKeyCache = new Map();

export class AiGeneratedSaveReferenceError extends Error {
  constructor(
    message = "Invalid save reference.",
    { status = 400, code = "INVALID_SAVE_REFERENCE", reason = "invalid" } = {}
  ) {
    super(message);
    this.name = "AiGeneratedSaveReferenceError";
    this.status = status;
    this.code = code;
    this.reason = reason;
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
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }
  if (padding === 0) return normalized;
  return normalized + "=".repeat(4 - padding);
}

function stableStringify(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => [key, value[key]]);
  return JSON.stringify(Object.fromEntries(entries));
}

async function getSigningKey(secret) {
  const cacheKey = String(secret || "");
  if (!cacheKey) {
    throw new Error("Missing generated image save reference signing secret.");
  }
  if (!signingKeyCache.has(cacheKey)) {
    signingKeyCache.set(
      cacheKey,
      crypto.subtle.importKey(
        "raw",
        textEncoder.encode(`ai-generated-save-reference:${cacheKey}`),
        {
          name: "HMAC",
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"]
      )
    );
  }
  return signingKeyCache.get(cacheKey);
}

async function signBody(secret, body) {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(stableStringify(body))
  );
  return toBase64Url(bytesToBase64(new Uint8Array(signature)));
}

async function buildUserBindingWithSecret(secret, userId) {
  return (await sha256Hex(`ai-generated-save-reference:${secret}:${String(userId || "")}`))
    .slice(0, 32);
}

async function buildUserBinding(env, userId) {
  return buildUserBindingWithSecret(getAiSaveReferenceSigningSecret(env), userId);
}

export function buildAiGeneratedTempOriginalKey(userId, tempId) {
  return `${AI_GENERATED_TEMP_OBJECT_PREFIX}${String(userId || "")}/${String(tempId || "")}`;
}

export function isAiGeneratedTempObjectExpired(uploadedAt, now = Date.now()) {
  const uploadedMs = uploadedAt instanceof Date
    ? uploadedAt.getTime()
    : Date.parse(String(uploadedAt || ""));
  if (!Number.isFinite(uploadedMs)) return false;
  return uploadedMs <= now - AI_GENERATED_SAVE_REFERENCE_TTL_MS;
}

function decodeBase64ToBytes(base64) {
  if (typeof base64 !== "string" || !base64) {
    throw new Error("Invalid generated image payload.");
  }
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export async function encodeAiGeneratedSaveReference(env, { userId, tempId, expiresAt } = {}) {
  const normalizedTempId = String(tempId || "").trim();
  if (!normalizedTempId || normalizedTempId.length > 200) {
    throw new Error("Invalid generated image temp ID.");
  }
  const expiresMs = Number.isFinite(Number(expiresAt))
    ? Number(expiresAt)
    : Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(expiresMs)) {
    throw new Error("Invalid generated image save reference expiration.");
  }

  const unsignedBody = {
    v: AI_GENERATED_SAVE_REFERENCE_VERSION,
    t: AI_GENERATED_SAVE_REFERENCE_TYPE,
    exp: Math.floor(expiresMs),
    temp_id: normalizedTempId,
    sub: await buildUserBinding(env, userId),
  };
  const body = {
    ...unsignedBody,
    sig: await signBody(getAiSaveReferenceSigningSecret(env), unsignedBody),
  };
  return toBase64Url(bytesToBase64(textEncoder.encode(JSON.stringify(body))));
}

export async function createAiGeneratedSaveReferenceFromBase64(
  env,
  {
    userId,
    imageBase64,
    mimeType = "image/png",
    generationMetadata = null,
    expiresAt = Date.now() + AI_GENERATED_SAVE_REFERENCE_TTL_MS,
  } = {}
) {
  const tempId = crypto.randomUUID();
  const tempKey = buildAiGeneratedTempOriginalKey(userId, tempId);
  const imageBytes = decodeBase64ToBytes(imageBase64);
  if (generationMetadata) {
    if (imageBytes.byteLength > GPT_IMAGE_25_IMAGE_BYTES) throw new AiGeneratedSaveReferenceError('Generated image exceeds the application byte limit.', { status: 502, code: 'image_output_invalid' });
    image25Mime(imageBytes, mimeType);
    if (!env.IMAGES?.info) throw new AiGeneratedSaveReferenceError('Image inspection is unavailable.', { status: 503, code: 'images_binding_unavailable' });
    let info;
    try { info = await env.IMAGES.info(imageBytes); }
    catch { throw new AiGeneratedSaveReferenceError('Generated image could not be decoded.', { status: 502, code: 'image_output_invalid' }); }
    const width = Number(info?.width), height = Number(info?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) throw new AiGeneratedSaveReferenceError('Generated image dimensions are invalid.', { status: 502, code: 'image_output_invalid' });
    generationMetadata = { ...generationMetadata, width, height, mimeType };
  }
  await env.USER_IMAGES.put(tempKey, imageBytes.buffer, {
    httpMetadata: { contentType: mimeType || "image/png" },
    ...(generationMetadata ? { customMetadata: { generation: JSON.stringify(generationMetadata) } } : {}),
  });
  return {
    tempKey,
    saveReference: await encodeAiGeneratedSaveReference(env, {
      userId,
      tempId,
      expiresAt,
    }),
  };
}

export async function decodeAiGeneratedSaveReference(env, reference, { userId, now = Date.now() } = {}) {
  if (typeof reference !== "string" || !reference || reference.length > 500) {
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(textDecoder.decode(base64ToBytes(fromBase64Url(reference))));
  } catch {
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }

  const signature = parsed.sig;
  const expiresAt = Number(parsed.exp);
  const tempId = String(parsed.temp_id || "");
  if (
    parsed.v !== AI_GENERATED_SAVE_REFERENCE_VERSION ||
    parsed.t !== AI_GENERATED_SAVE_REFERENCE_TYPE ||
    typeof signature !== "string" ||
    !signature ||
    !Number.isFinite(expiresAt) ||
    !tempId
  ) {
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }

  const { sig: _ignoredSignature, ...unsignedBody } = parsed;
  let matchedCandidate = null;
  for (const candidate of getAiSaveReferenceSigningSecretCandidates(env)) {
    const expectedSignature = await signBody(candidate.secret, unsignedBody);
    if (signature === expectedSignature) {
      matchedCandidate = candidate;
      break;
    }
  }
  if (!matchedCandidate) {
    throw new AiGeneratedSaveReferenceError("Invalid save reference.", {
      reason: "malformed",
    });
  }

  const expectedSubject = await buildUserBindingWithSecret(matchedCandidate.secret, userId);
  if (parsed.sub !== expectedSubject) {
    throw new AiGeneratedSaveReferenceError(
      "Generated image is no longer available. Please generate it again.",
      {
        status: 404,
        code: "SAVE_REFERENCE_UNAVAILABLE",
        reason: "user_mismatch",
      }
    );
  }

  if (expiresAt <= now) {
    throw new AiGeneratedSaveReferenceError(
      "Generated image reference expired. Please generate the image again.",
      {
        status: 410,
        code: "SAVE_REFERENCE_EXPIRED",
        reason: "expired",
      }
    );
  }

  return {
    tempId,
    expiresAt: new Date(expiresAt).toISOString(),
    tempKey: buildAiGeneratedTempOriginalKey(userId, tempId),
  };
}
