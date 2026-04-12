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
    throw new ValidationError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${field} is required.`, 400, "validation_error");
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalInteger(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${field} must be an integer.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
  }
  return parsed;
}

function optionalNumber(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a number.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
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
      `${field} must be one of ${LIMITS.image.allowedDimensions.join(", ")}.`,
      400,
      "validation_error"
    );
  }

  return parsed;
}

function normalizeInputArray(input, field, maxItems, maxItemLength) {
  const values = typeof input === "string" ? [input] : input;
  if (!Array.isArray(values)) {
    throw new ValidationError(`${field} must be a string or an array of strings.`, 400, "validation_error");
  }
  if (values.length === 0) {
    throw new ValidationError(`${field} must contain at least one item.`, 400, "validation_error");
  }
  if (values.length > maxItems) {
    throw new ValidationError(`${field} must contain at most ${maxItems} items.`, 400, "validation_error");
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

function optionalStructuredPrompt(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError(`${field} must be a JSON object.`, 400, "validation_error");
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${field} contains invalid JSON.`, 400, "validation_error");
  }

  return trimmed;
}

function validateReferenceImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("referenceImages must be an array.", 400, "validation_error");
  }
  if (value.length > LIMITS.image.maxReferenceImages) {
    throw new ValidationError(
      `referenceImages must contain at most ${LIMITS.image.maxReferenceImages} items.`,
      400,
      "validation_error"
    );
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.startsWith("data:")) {
      throw new ValidationError(
        `referenceImages[${index}] must be a data URI string.`,
        400,
        "validation_error"
      );
    }
    const commaIndex = item.indexOf(",");
    if (commaIndex === -1) {
      throw new ValidationError(
        `referenceImages[${index}] is not a valid data URI.`,
        400,
        "validation_error"
      );
    }
    const base64 = item.slice(commaIndex + 1);
    const estimatedBytes = Math.ceil(base64.length * 0.75);
    if (estimatedBytes > LIMITS.image.maxReferenceImageBytes) {
      throw new ValidationError(
        `referenceImages[${index}] exceeds the ${LIMITS.image.maxReferenceImageBytes} byte size limit.`,
        400,
        "validation_error"
      );
    }
    return item;
  });
}

export function validateImageBody(body) {
  const input = ensureObject(body);
  const width = optionalDimension(input.width, "width");
  const height = optionalDimension(input.height, "height");

  if ((width && !height) || (!width && height)) {
    throw new ValidationError("width and height must be provided together.", 400, "validation_error");
  }

  if (width && height && width * height > LIMITS.image.maxPixels) {
    throw new ValidationError(
      `Image dimensions exceed the ${LIMITS.image.maxPixels} pixel safety cap.`,
      400,
      "validation_error"
    );
  }

  const structuredPrompt = optionalStructuredPrompt(
    input.structuredPrompt,
    "structuredPrompt",
    LIMITS.image.maxStructuredPromptLength
  );

  const referenceImages = validateReferenceImages(input.referenceImages);

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: structuredPrompt
      ? optionalString(input.prompt, "prompt", LIMITS.image.maxPromptLength)
      : requiredString(input.prompt, "prompt", LIMITS.image.maxPromptLength),
    structuredPrompt,
    promptMode: structuredPrompt ? "structured" : "standard",
    width,
    height,
    steps: optionalInteger(
      input.steps,
      "steps",
      LIMITS.image.minSteps,
      LIMITS.image.maxSteps,
      null
    ),
    seed: optionalInteger(input.seed, "seed", 0, LIMITS.image.maxSeed, null),
    guidance: optionalNumber(
      input.guidance,
      "guidance",
      LIMITS.image.minGuidance,
      LIMITS.image.maxGuidance,
      null
    ),
    referenceImages,
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
      `input exceeds the total ${LIMITS.embeddings.maxTotalChars} character cap.`,
      400,
      "validation_error"
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
    throw new ValidationError(`models must contain at least ${LIMITS.compare.minModels} items.`, 400, "validation_error");
  }
  if (uniqueModels.size !== models.length) {
    throw new ValidationError("models must not contain duplicates.", 400, "duplicate_models");
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
