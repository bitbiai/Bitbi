import {
  RequestBodyError,
  getContentLength,
  isRequestBodyError,
  readFormDataLimited,
  readJsonBodyLimited,
  readTextBodyLimited,
  rejectIfBodyTooLarge,
} from "../../../../js/shared/request-body.mjs";
import { json } from "./response.js";

export {
  RequestBodyError,
  getContentLength,
  isRequestBodyError,
  readFormDataLimited,
  readJsonBodyLimited,
  readTextBodyLimited,
  rejectIfBodyTooLarge,
};

export const BODY_LIMITS = Object.freeze({
  smallJson: 32 * 1024,
  authJson: 64 * 1024,
  adminJson: 512 * 1024,
  adminVideoJobJson: 512 * 1024,
  aiGenerateJson: 32 * 1024,
  aiGenerateImageJson: 15 * 1024 * 1024,
  aiGenerateVideoJson: 15 * 1024 * 1024,
  aiSaveImageJson: 15 * 1024 * 1024,
  aiSaveAudioJson: 18 * 1024 * 1024,
  aiSaveVideoPosterJson: 4 * 1024 * 1024,
  billingWebhookRaw: 128 * 1024,
  avatarJson: 32 * 1024,
  avatarMultipart: 3 * 1024 * 1024,
});

export function requestBodyErrorResponse(error) {
  const status = Number(error?.status || 400);
  const code = error?.code === "invalid_json" ? "bad_request" : (error?.code || "bad_request");
  return json(
    {
      ok: false,
      error: error?.publicMessage || "Invalid request body.",
      code,
    },
    { status }
  );
}

export async function readJsonBodyOrResponse(request, {
  maxBytes = BODY_LIMITS.authJson,
  requiredContentType = true,
} = {}) {
  try {
    return {
      body: await readJsonBodyLimited(request, { maxBytes, requiredContentType }),
      response: null,
    };
  } catch (error) {
    if (isRequestBodyError(error)) {
      return {
        body: null,
        response: requestBodyErrorResponse(error),
      };
    }
    throw error;
  }
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  if (typeof email !== "string") return false;

  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;

  for (const char of trimmed) {
    if (char !== char.trim()) return false;
  }

  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf("@") || atIndex === trimmed.length - 1) {
    return false;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }

  return domain.split(".").every(Boolean);
}

export async function readJsonBody(request) {
  try {
    return await readJsonBodyLimited(request, {
      maxBytes: BODY_LIMITS.authJson,
      requiredContentType: false,
    });
  } catch {
    return null;
  }
}

export function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
