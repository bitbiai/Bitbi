function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "validation_error";
  return error;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizePrimitiveValue(value, field, maxStringLength) {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > maxStringLength) {
      throw validationError(`${field} must be at most ${maxStringLength} characters.`);
    }
    return value;
  }
  return undefined;
}

function sanitizeNestedValue(value, field, maxStringLength, stringifyNested) {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw validationError(
      `${field} must be a string, number, boolean, null, array, or object.`
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw validationError(`${field} must be JSON-serializable.`);
  }

  if (typeof serialized !== "string") {
    throw validationError(`${field} must be JSON-serializable.`);
  }
  if (serialized.length > maxStringLength) {
    throw validationError(`${field} must be at most ${maxStringLength} characters.`);
  }

  return stringifyNested ? serialized : JSON.parse(serialized);
}

export function sanitizeAssetMetadata(input, options = {}) {
  if (input === undefined || input === null) return null;

  const {
    field = "metadata",
    maxEntries = 24,
    maxKeyLength = 60,
    maxStringLength = 600,
    stringifyNested = true,
  } = options;

  if (!isPlainObject(input)) {
    throw validationError(`${field} must be an object.`);
  }

  const entries = Object.entries(input);
  if (entries.length > maxEntries) {
    throw validationError(`${field} must contain at most ${maxEntries} keys.`);
  }

  const normalized = {};
  for (const [rawKey, value] of entries) {
    const key = String(rawKey || "").trim();
    if (!key) {
      throw validationError(`${field}.key is required.`);
    }
    if (key.length > maxKeyLength) {
      throw validationError(`${field}.key must be at most ${maxKeyLength} characters.`);
    }

    const valueField = `${field}.${key}`;
    const primitive = sanitizePrimitiveValue(value, valueField, maxStringLength);
    normalized[key] = primitive !== undefined
      ? primitive
      : sanitizeNestedValue(value, valueField, maxStringLength, stringifyNested);
  }

  return normalized;
}
