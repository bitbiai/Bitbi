import { LIMITS } from "./limits.js";

export class ValidationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.code = code;
  }
}

export async function readJsonBody(request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return await request.json();
  } catch {
    return null;
  }
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("JSON body must be an object.");
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${field} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function optionalInteger(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${field} must be an integer.`);
  }
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function optionalNumber(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a number.`);
  }
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function optionalDimension(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = optionalInteger(
    value,
    field,
    LIMITS.image.allowedDimensions[0],
    LIMITS.image.allowedDimensions[LIMITS.image.allowedDimensions.length - 1]
  );

  if (!LIMITS.image.allowedDimensions.includes(parsed)) {
    throw new ValidationError(
      `${field} must be one of ${LIMITS.image.allowedDimensions.join(", ")}.`
    );
  }

  return parsed;
}

function normalizeInputArray(input, field, maxItems, maxItemLength) {
  const values = typeof input === "string" ? [input] : input;
  if (!Array.isArray(values)) {
    throw new ValidationError(`${field} must be a string or an array of strings.`);
  }
  if (values.length === 0) {
    throw new ValidationError(`${field} must contain at least one item.`);
  }
  if (values.length > maxItems) {
    throw new ValidationError(`${field} must contain at most ${maxItems} items.`);
  }

  const normalized = values.map((entry, index) =>
    requiredString(entry, `${field}[${index}]`, maxItemLength)
  );

  return normalized;
}

export function validateTextBody(body) {
  const input = ensureObject(body);

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.text.maxPromptLength),
    system: optionalString(input.system, "system", LIMITS.text.maxSystemLength),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      LIMITS.text.maxTokens,
      LIMITS.text.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      LIMITS.text.minTemperature,
      LIMITS.text.maxTemperature,
      LIMITS.text.defaultTemperature
    ),
  };
}

export function validateImageBody(body) {
  const input = ensureObject(body);
  const width = optionalDimension(input.width, "width");
  const height = optionalDimension(input.height, "height");

  if ((width && !height) || (!width && height)) {
    throw new ValidationError("width and height must be provided together.");
  }

  if (width && height && width * height > LIMITS.image.maxPixels) {
    throw new ValidationError(
      `Image dimensions exceed the ${LIMITS.image.maxPixels} pixel safety cap.`
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.image.maxPromptLength),
    width,
    height,
    steps: optionalInteger(
      input.steps,
      "steps",
      LIMITS.image.minSteps,
      LIMITS.image.maxSteps,
      LIMITS.image.defaultSteps
    ),
    seed: optionalInteger(input.seed, "seed", 0, LIMITS.image.maxSeed, null),
  };
}

export function validateEmbeddingsBody(body) {
  const input = ensureObject(body);
  const values = normalizeInputArray(
    input.input,
    "input",
    LIMITS.embeddings.maxBatchSize,
    LIMITS.embeddings.maxItemLength
  );
  const totalChars = values.reduce((sum, value) => sum + value.length, 0);

  if (totalChars > LIMITS.embeddings.maxTotalChars) {
    throw new ValidationError(
      `input exceeds the total ${LIMITS.embeddings.maxTotalChars} character cap.`
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    input: values,
  };
}

export function validateCompareBody(body) {
  const input = ensureObject(body);
  const models = normalizeInputArray(input.models, "models", LIMITS.compare.maxModels, 120);
  const uniqueModels = new Set(models);

  if (models.length < LIMITS.compare.minModels) {
    throw new ValidationError(`models must contain at least ${LIMITS.compare.minModels} items.`);
  }
  if (uniqueModels.size !== models.length) {
    throw new ValidationError("models must not contain duplicates.");
  }

  return {
    models,
    prompt: requiredString(input.prompt, "prompt", LIMITS.compare.maxPromptLength),
    system: optionalString(input.system, "system", LIMITS.compare.maxSystemLength),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      LIMITS.compare.maxTokens,
      LIMITS.compare.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      LIMITS.compare.minTemperature,
      LIMITS.compare.maxTemperature,
      LIMITS.compare.defaultTemperature
    ),
  };
}
