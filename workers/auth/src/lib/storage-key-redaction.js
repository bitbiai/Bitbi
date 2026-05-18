import { sha256Hex } from "./tokens.js";

export function classifyStorageObjectKey(key) {
  const value = String(key || "").trim();
  if (!value) return "missing";
  if (value.startsWith("data-exports/")) return "data_export_archive";
  if (value.startsWith("avatars/")) return "profile_avatar";
  if (value.startsWith("users/")) {
    return "user_media";
  }
  if (value.startsWith("ai-generated-temp/")) return "temporary_ai_media";
  if (value.startsWith("cleanup/")) return "cleanup_queue_test_or_internal";
  return "private_object";
}

export async function redactStorageObjectKey(key, { bucket = null, keyType = null } = {}) {
  if (!key) {
    return {
      bucket,
      keyClass: "missing",
      keyType: keyType || null,
      keySha256: null,
      internalKeyIncluded: false,
    };
  }
  return {
    bucket,
    keyClass: classifyStorageObjectKey(key),
    keyType: keyType || null,
    keySha256: await sha256Hex(String(key)),
    internalKeyIncluded: false,
  };
}

export async function storageKeyLogFields(key, { fieldPrefix = "storage_key" } = {}) {
  const redacted = await redactStorageObjectKey(key);
  return {
    [`${fieldPrefix}_class`]: redacted.keyClass,
    [`${fieldPrefix}_sha256`]: redacted.keySha256,
    [`${fieldPrefix}_included`]: false,
  };
}

export async function sanitizeStorageEvidenceSummary(summary, forbiddenKeys = []) {
  const replacements = new Map();
  for (const key of forbiddenKeys.filter(Boolean)) {
    replacements.set(String(key), await redactStorageObjectKey(key));
  }
  return sanitizeStorageEvidenceValue(summary, replacements);
}

function sanitizeStorageEvidenceValue(value, replacements, depth = 0) {
  if (depth > 6) return null;
  if (value == null) return value;
  if (typeof value === "string") {
    return replacements.has(value) ? replacements.get(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeStorageEvidenceValue(entry, replacements, depth + 1));
  }
  if (typeof value !== "object") return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(r2_?key|key|objectKey|storageKey|originalKey|thumbKey|mediumKey|posterR2Key|outputR2Key)$/i.test(key)) {
      if (typeof entry === "string" && replacements.has(entry)) {
        out[`${key}Redacted`] = replacements.get(entry);
      } else {
        out[`${key}Included`] = false;
      }
      continue;
    }
    out[key] = sanitizeStorageEvidenceValue(entry, replacements, depth + 1);
  }
  return out;
}
