import { readJsonBody } from "../lib/request.js";
import { json } from "../lib/response.js";
import { isSharedRateLimited, getClientIp } from "../lib/rate-limit.js";
import { requireAdmin } from "../lib/session.js";
import { withAdminAiCode } from "../lib/admin-ai-response.js";
import {
  AI_IMAGE_DERIVATIVE_VERSION,
  enqueueAiImageDerivativeJob,
  listAiImagesNeedingDerivativeWork,
} from "../lib/ai-image-derivatives.js";
import { saveAdminAiTextAsset } from "../lib/ai-text-assets.js";

const AI_LAB_BASE_URL = "https://bitbi-ai.internal";

const LIMITS = {
  text: {
    promptMax: 4000,
    systemMax: 1200,
    maxTokens: 1200,
    defaultMaxTokens: 300,
    minTemperature: 0,
    maxTemperature: 2,
    defaultTemperature: 0.7,
  },
  image: {
    promptMax: 2048,
    minSteps: 1,
    maxSteps: 8,
    defaultSteps: 4,
    allowedDimensions: [256, 512, 768, 1024],
    maxPixels: 1024 * 1024,
    maxSeed: 2147483647,
  },
  embeddings: {
    maxBatchSize: 8,
    maxItemLength: 2000,
    maxTotalChars: 8000,
  },
  compare: {
    minModels: 2,
    maxModels: 3,
    promptMax: 4000,
    systemMax: 1200,
    maxTokens: 600,
    defaultMaxTokens: 250,
    minTemperature: 0,
    maxTemperature: 2,
    defaultTemperature: 0.7,
  },
};

class InputError extends Error {
  constructor(message, status = 400, code = "validation_error") {
    super(message);
    this.name = "InputError";
    this.status = status;
    this.code = code;
  }
}

function inputErrorResponse(error) {
  return json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  );
}

function serviceUnavailableResponse() {
  return json(
    {
      ok: false,
      error: "AI lab service unavailable.",
      code: "upstream_error",
    },
    { status: 503 }
  );
}

function adminAiRateLimitResponse() {
  return json(
    {
      ok: false,
      error: "Too many requests. Please try again later.",
      code: "rate_limited",
    },
    { status: 429 }
  );
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new InputError(`${field} is required.`, 400, "validation_error");
  }
  if (trimmed.length > maxLength) {
    throw new InputError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new InputError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalInteger(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InputError(`${field} must be an integer.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new InputError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
  }
  return parsed;
}

function optionalNumber(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InputError(`${field} must be a number.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new InputError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
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
    throw new InputError(
      `${field} must be one of ${LIMITS.image.allowedDimensions.join(", ")}.`,
      400,
      "validation_error"
    );
  }

  return parsed;
}

function normalizeStringArray(value, field, minItems, maxItems, maxItemLength) {
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values)) {
    throw new InputError(`${field} must be a string or an array of strings.`, 400, "validation_error");
  }
  if (values.length < minItems) {
    throw new InputError(`${field} must contain at least ${minItems} item(s).`, 400, "validation_error");
  }
  if (values.length > maxItems) {
    throw new InputError(`${field} must contain at most ${maxItems} item(s).`, 400, "validation_error");
  }

  return values.map((entry, index) => requiredString(entry, `${field}[${index}]`, maxItemLength));
}

function validateTextPayload(body) {
  const input = ensureObject(body);

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.text.promptMax),
    system: optionalString(input.system, "system", LIMITS.text.systemMax),
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

function validateImagePayload(body) {
  const input = ensureObject(body);
  const width = optionalDimension(input.width, "width");
  const height = optionalDimension(input.height, "height");

  if ((width && !height) || (!width && height)) {
    throw new InputError("width and height must be provided together.", 400, "validation_error");
  }

  if (width && height && width * height > LIMITS.image.maxPixels) {
    throw new InputError(
      `Image dimensions exceed the ${LIMITS.image.maxPixels} pixel safety cap.`,
      400,
      "validation_error"
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.image.promptMax),
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

function validateEmbeddingsPayload(body) {
  const input = ensureObject(body);
  const values = normalizeStringArray(
    input.input,
    "input",
    1,
    LIMITS.embeddings.maxBatchSize,
    LIMITS.embeddings.maxItemLength
  );
  const totalChars = values.reduce((sum, value) => sum + value.length, 0);

  if (totalChars > LIMITS.embeddings.maxTotalChars) {
    throw new InputError(
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

function validateComparePayload(body) {
  const input = ensureObject(body);
  const models = normalizeStringArray(
    input.models,
    "models",
    LIMITS.compare.minModels,
    LIMITS.compare.maxModels,
    120
  );

  if (new Set(models).size !== models.length) {
    throw new InputError("models must not contain duplicates.", 400, "duplicate_models");
  }

  return {
    models,
    prompt: requiredString(input.prompt, "prompt", LIMITS.compare.promptMax),
    system: optionalString(input.system, "system", LIMITS.compare.systemMax),
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

const LIVE_AGENT_LIMITS = {
  maxMessages: 40,
  maxSystemLength: 1200,
  maxMessageLength: 4000,
};

const SAVE_TEXT_ASSET_LIMITS = {
  titleMax: 120,
  maxWarnings: 12,
  warningLength: 240,
  maxResultLength: 24_000,
  maxUsageKeys: 24,
  maxUsageKeyLength: 60,
  maxUsageStringLength: 600,
  maxEmbeddingVectors: 8,
  maxEmbeddingDimensions: 2048,
  maxEmbeddingValues: 12_000,
  maxCompareResults: 3,
  maxDiffItems: 8,
  maxDiffItemLength: 400,
  maxTranscriptMessages: 60,
};

const SAVEABLE_TEXT_MODULES = new Set(["text", "embeddings", "compare", "live_agent"]);

function validateLiveAgentPayload(body) {
  const input = ensureObject(body);
  const messages = input.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new InputError("messages must be a non-empty array.", 400, "validation_error");
  }
  if (messages.length > LIVE_AGENT_LIMITS.maxMessages) {
    throw new InputError(
      `messages must contain at most ${LIVE_AGENT_LIMITS.maxMessages} items.`,
      400,
      "validation_error"
    );
  }

  const validated = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      throw new InputError(`messages[${i}] must be an object.`, 400, "validation_error");
    }

    const role = msg.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new InputError(
        `messages[${i}].role must be "system", "user", or "assistant".`,
        400,
        "validation_error"
      );
    }

    if (typeof msg.content !== "string") {
      throw new InputError(`messages[${i}].content must be a string.`, 400, "validation_error");
    }

    const maxLen = role === "system" ? LIVE_AGENT_LIMITS.maxSystemLength : LIVE_AGENT_LIMITS.maxMessageLength;
    const trimmed = msg.content.trim();
    if (!trimmed) {
      throw new InputError(`messages[${i}].content must not be empty.`, 400, "validation_error");
    }
    if (trimmed.length > maxLen) {
      throw new InputError(
        `messages[${i}].content must be at most ${maxLen} characters.`,
        400,
        "validation_error"
      );
    }

    validated.push({ role, content: trimmed });
  }

  if (!validated.some((m) => m.role === "user")) {
    throw new InputError("messages must include at least one user message.", 400, "validation_error");
  }

  return { messages: validated };
}

function ensurePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${field} must be an object.`, 400, "validation_error");
  }
  return value;
}

function optionalIsoString(value, field) {
  const normalized = optionalString(value, field, 64);
  if (!normalized) return null;
  if (Number.isNaN(Date.parse(normalized))) {
    throw new InputError(`${field} must be a valid ISO timestamp.`, 400, "validation_error");
  }
  return normalized;
}

function optionalWarnings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new InputError("warnings must be an array of strings.", 400, "validation_error");
  }
  if (value.length > SAVE_TEXT_ASSET_LIMITS.maxWarnings) {
    throw new InputError(
      `warnings must contain at most ${SAVE_TEXT_ASSET_LIMITS.maxWarnings} items.`,
      400,
      "validation_error"
    );
  }

  return value.map((warning, index) =>
    requiredString(warning, `warnings[${index}]`, SAVE_TEXT_ASSET_LIMITS.warningLength)
  );
}

function optionalModelSummary(value, field = "model") {
  if (value === undefined || value === null) return null;
  const model = ensurePlainObject(value, field);

  return {
    id: optionalString(model.id, `${field}.id`, 160),
    label: optionalString(model.label, `${field}.label`, 160),
    vendor: optionalString(model.vendor, `${field}.vendor`, 120),
  };
}

function optionalUsageSummary(value, field = "usage") {
  if (value === undefined || value === null) return null;
  const usage = ensurePlainObject(value, field);
  const entries = Object.entries(usage);

  if (entries.length > SAVE_TEXT_ASSET_LIMITS.maxUsageKeys) {
    throw new InputError(
      `${field} must contain at most ${SAVE_TEXT_ASSET_LIMITS.maxUsageKeys} keys.`,
      400,
      "validation_error"
    );
  }

  const normalized = {};
  for (const [key, entryValue] of entries) {
    const safeKey = requiredString(key, `${field}.key`, SAVE_TEXT_ASSET_LIMITS.maxUsageKeyLength);
    if (
      typeof entryValue !== "string" &&
      typeof entryValue !== "number" &&
      typeof entryValue !== "boolean" &&
      entryValue !== null
    ) {
      throw new InputError(
        `${field}.${safeKey} must be a string, number, boolean, or null.`,
        400,
        "validation_error"
      );
    }
    if (typeof entryValue === "string" && entryValue.length > SAVE_TEXT_ASSET_LIMITS.maxUsageStringLength) {
      throw new InputError(
        `${field}.${safeKey} must be at most ${SAVE_TEXT_ASSET_LIMITS.maxUsageStringLength} characters.`,
        400,
        "validation_error"
      );
    }
    normalized[safeKey] = entryValue;
  }

  return normalized;
}

function optionalHexId(value, field) {
  const normalized = optionalString(value, field, 64);
  if (!normalized) return null;
  if (!/^[a-f0-9]+$/.test(normalized)) {
    throw new InputError(`${field} is invalid.`, 400, "validation_error");
  }
  return normalized;
}

function validateSavedTextData(data) {
  const input = ensurePlainObject(data, "data");
  return {
    preset: optionalString(input.preset, "data.preset", 64),
    model: optionalModelSummary(input.model, "data.model"),
    system: optionalString(input.system, "data.system", LIMITS.text.systemMax),
    prompt: requiredString(input.prompt, "data.prompt", LIMITS.text.promptMax),
    output: requiredString(input.output, "data.output", SAVE_TEXT_ASSET_LIMITS.maxResultLength),
    maxTokens: optionalInteger(input.maxTokens, "data.maxTokens", 1, LIMITS.text.maxTokens, null),
    temperature: optionalNumber(
      input.temperature,
      "data.temperature",
      LIMITS.text.minTemperature,
      LIMITS.text.maxTemperature,
      null
    ),
    usage: optionalUsageSummary(input.usage, "data.usage"),
    warnings: optionalWarnings(input.warnings),
    elapsedMs: optionalInteger(input.elapsedMs, "data.elapsedMs", 0, 600_000, null),
    receivedAt: optionalIsoString(input.receivedAt, "data.receivedAt"),
  };
}

function validateSavedEmbeddingsData(data) {
  const input = ensurePlainObject(data, "data");
  const inputItems = normalizeStringArray(
    input.inputItems,
    "data.inputItems",
    1,
    LIMITS.embeddings.maxBatchSize,
    LIMITS.embeddings.maxItemLength
  );
  const totalInputChars = inputItems.reduce((sum, item) => sum + item.length, 0);
  if (totalInputChars > LIMITS.embeddings.maxTotalChars) {
    throw new InputError(
      `data.inputItems exceed the total ${LIMITS.embeddings.maxTotalChars} character cap.`,
      400,
      "validation_error"
    );
  }

  if (!Array.isArray(input.vectors) || input.vectors.length === 0) {
    throw new InputError("data.vectors must be a non-empty array.", 400, "validation_error");
  }
  if (input.vectors.length > SAVE_TEXT_ASSET_LIMITS.maxEmbeddingVectors) {
    throw new InputError(
      `data.vectors must contain at most ${SAVE_TEXT_ASSET_LIMITS.maxEmbeddingVectors} vectors.`,
      400,
      "validation_error"
    );
  }

  let totalValues = 0;
  const vectors = input.vectors.map((vector, index) => {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new InputError(`data.vectors[${index}] must be a non-empty number array.`, 400, "validation_error");
    }
    if (vector.length > SAVE_TEXT_ASSET_LIMITS.maxEmbeddingDimensions) {
      throw new InputError(
        `data.vectors[${index}] exceeds the ${SAVE_TEXT_ASSET_LIMITS.maxEmbeddingDimensions} dimension cap.`,
        400,
        "validation_error"
      );
    }
    totalValues += vector.length;
    return vector.map((value, valueIndex) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new InputError(
          `data.vectors[${index}][${valueIndex}] must be a finite number.`,
          400,
          "validation_error"
        );
      }
      return parsed;
    });
  });

  if (totalValues > SAVE_TEXT_ASSET_LIMITS.maxEmbeddingValues) {
    throw new InputError(
      `data.vectors exceed the ${SAVE_TEXT_ASSET_LIMITS.maxEmbeddingValues} value cap.`,
      400,
      "validation_error"
    );
  }

  let shape = null;
  if (input.shape !== undefined && input.shape !== null) {
    if (!Array.isArray(input.shape)) {
      throw new InputError("data.shape must be an array of integers.", 400, "validation_error");
    }
    if (input.shape.length < 1 || input.shape.length > 4) {
      throw new InputError("data.shape must contain between 1 and 4 integers.", 400, "validation_error");
    }
    shape = input.shape.map((item, index) => {
      const parsed = Number(item);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > SAVE_TEXT_ASSET_LIMITS.maxEmbeddingDimensions) {
        throw new InputError(
          `data.shape[${index}] must be an integer between 1 and ${SAVE_TEXT_ASSET_LIMITS.maxEmbeddingDimensions}.`,
          400,
          "validation_error"
        );
      }
      return parsed;
    });
  }

  return {
    preset: optionalString(input.preset, "data.preset", 64),
    model: optionalModelSummary(input.model, "data.model"),
    inputItems,
    vectors,
    dimensions: optionalInteger(input.dimensions, "data.dimensions", 1, SAVE_TEXT_ASSET_LIMITS.maxEmbeddingDimensions, null),
    count: optionalInteger(input.count, "data.count", 1, SAVE_TEXT_ASSET_LIMITS.maxEmbeddingVectors, vectors.length),
    shape,
    pooling: optionalString(input.pooling, "data.pooling", 80),
    warnings: optionalWarnings(input.warnings),
    elapsedMs: optionalInteger(input.elapsedMs, "data.elapsedMs", 0, 600_000, null),
    receivedAt: optionalIsoString(input.receivedAt, "data.receivedAt"),
  };
}

function validateSavedCompareResults(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > SAVE_TEXT_ASSET_LIMITS.maxCompareResults) {
    throw new InputError(
      `data.results must contain between 2 and ${SAVE_TEXT_ASSET_LIMITS.maxCompareResults} items.`,
      400,
      "validation_error"
    );
  }

  return value.map((entry, index) => {
    const result = ensurePlainObject(entry, `data.results[${index}]`);
    if (typeof result.ok !== "boolean") {
      throw new InputError(`data.results[${index}].ok must be a boolean.`, 400, "validation_error");
    }

    return {
      ok: result.ok,
      model: optionalModelSummary(result.model, `data.results[${index}].model`),
      text: result.ok
        ? requiredString(result.text, `data.results[${index}].text`, SAVE_TEXT_ASSET_LIMITS.maxResultLength)
        : optionalString(result.text, `data.results[${index}].text`, SAVE_TEXT_ASSET_LIMITS.maxResultLength),
      error: result.ok
        ? optionalString(result.error, `data.results[${index}].error`, 1200)
        : requiredString(result.error, `data.results[${index}].error`, 1200),
      usage: optionalUsageSummary(result.usage, `data.results[${index}].usage`),
      elapsedMs: optionalInteger(result.elapsedMs, `data.results[${index}].elapsedMs`, 0, 600_000, null),
    };
  });
}

function optionalDiffSummary(value) {
  if (value === undefined || value === null) return null;
  const diff = ensurePlainObject(value, "data.diffSummary");

  function normalizeItems(items, field) {
    if (items === undefined || items === null) return [];
    return normalizeStringArray(
      items,
      field,
      0,
      SAVE_TEXT_ASSET_LIMITS.maxDiffItems,
      SAVE_TEXT_ASSET_LIMITS.maxDiffItemLength
    );
  }

  return {
    identical: !!diff.identical,
    shared: normalizeItems(diff.shared, "data.diffSummary.shared"),
    onlyA: normalizeItems(diff.onlyA, "data.diffSummary.onlyA"),
    onlyB: normalizeItems(diff.onlyB, "data.diffSummary.onlyB"),
  };
}

function validateSavedCompareData(data) {
  const input = ensurePlainObject(data, "data");
  return {
    prompt: requiredString(input.prompt, "data.prompt", LIMITS.compare.promptMax),
    system: optionalString(input.system, "data.system", LIMITS.compare.systemMax),
    maxTokens: optionalInteger(input.maxTokens, "data.maxTokens", 1, LIMITS.compare.maxTokens, null),
    temperature: optionalNumber(
      input.temperature,
      "data.temperature",
      LIMITS.compare.minTemperature,
      LIMITS.compare.maxTemperature,
      null
    ),
    elapsedMs: optionalInteger(input.elapsedMs, "data.elapsedMs", 0, 600_000, null),
    receivedAt: optionalIsoString(input.receivedAt, "data.receivedAt"),
    warnings: optionalWarnings(input.warnings),
    diffSummary: optionalDiffSummary(input.diffSummary),
    results: validateSavedCompareResults(input.results),
  };
}

function validateSavedLiveAgentData(data) {
  const input = ensurePlainObject(data, "data");
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];

  if (transcript.length === 0) {
    throw new InputError("data.transcript must be a non-empty array.", 400, "validation_error");
  }
  if (transcript.length > SAVE_TEXT_ASSET_LIMITS.maxTranscriptMessages) {
    throw new InputError(
      `data.transcript must contain at most ${SAVE_TEXT_ASSET_LIMITS.maxTranscriptMessages} items.`,
      400,
      "validation_error"
    );
  }

  const normalizedTranscript = transcript.map((entry, index) => {
    const msg = ensurePlainObject(entry, `data.transcript[${index}]`);
    const role = requiredString(msg.role, `data.transcript[${index}].role`, 24).toLowerCase();
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new InputError(
        `data.transcript[${index}].role must be "system", "user", or "assistant".`,
        400,
        "validation_error"
      );
    }
    const maxLen = role === "system" ? LIVE_AGENT_LIMITS.maxSystemLength : LIVE_AGENT_LIMITS.maxMessageLength;
    return {
      role,
      content: requiredString(msg.content, `data.transcript[${index}].content`, maxLen),
    };
  });

  return {
    model: optionalModelSummary(input.model, "data.model"),
    system: optionalString(input.system, "data.system", LIVE_AGENT_LIMITS.maxSystemLength),
    transcript: normalizedTranscript,
    finalResponse: optionalString(input.finalResponse, "data.finalResponse", SAVE_TEXT_ASSET_LIMITS.maxResultLength),
    receivedAt: optionalIsoString(input.receivedAt, "data.receivedAt"),
    warnings: optionalWarnings(input.warnings),
  };
}

function validateSaveTextAssetPayload(body) {
  const input = ensureObject(body);
  const title = requiredString(input.title, "title", SAVE_TEXT_ASSET_LIMITS.titleMax);
  const folderId = optionalHexId(input.folderId, "folderId");
  const sourceModule = requiredString(input.sourceModule, "sourceModule", 32);

  if (!SAVEABLE_TEXT_MODULES.has(sourceModule)) {
    throw new InputError("sourceModule is invalid.", 400, "validation_error");
  }

  let payload;
  switch (sourceModule) {
    case "text":
      payload = validateSavedTextData(input.data);
      break;
    case "embeddings":
      payload = validateSavedEmbeddingsData(input.data);
      break;
    case "compare":
      payload = validateSavedCompareData(input.data);
      break;
    case "live_agent":
      payload = validateSavedLiveAgentData(input.data);
      break;
    default:
      throw new InputError("sourceModule is invalid.", 400, "validation_error");
  }

  return {
    title,
    folderId,
    sourceModule,
    payload,
  };
}

function validateImageDerivativeBackfillPayload(body) {
  const input = body == null ? {} : ensureObject(body);
  if (
    input.includeFailed !== undefined &&
    input.includeFailed !== null &&
    typeof input.includeFailed !== "boolean"
  ) {
    throw new InputError("includeFailed must be a boolean.", 400, "validation_error");
  }
  return {
    limit: optionalInteger(input.limit, "limit", 1, 100, 50),
    cursor: optionalString(input.cursor, "cursor", 200),
    includeFailed: input.includeFailed !== false,
  };
}

function storageErrorResponse(error) {
  const status = error?.status || 500;
  return json(
    {
      ok: false,
      error: error?.message || "Save failed.",
      code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
    },
    { status }
  );
}

async function proxyLiveAgentToAiLab(env, payload, adminUser) {
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    return serviceUnavailableResponse();
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}/internal/ai/live-agent`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          accept: "text/event-stream",
          "x-bitbi-admin-user-id": adminUser.id,
          "x-bitbi-admin-user-email": adminUser.email,
        },
        body: JSON.stringify(payload),
      })
    );
  } catch (error) {
    console.error("Admin AI live-agent proxy request failed", error);
    return serviceUnavailableResponse();
  }

  // Stream responses pass through directly; JSON error responses go through normalisation
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return response;
  }

  return withAdminAiCode(response);
}

async function proxyToAiLab(env, path, init, adminUser) {
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    return serviceUnavailableResponse();
  }

  const headers = new Headers({
    accept: "application/json",
    "x-bitbi-admin-user-id": adminUser.id,
    "x-bitbi-admin-user-email": adminUser.email,
  });

  if (init.body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}${path}`, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      })
    );
  } catch (error) {
    console.error("Admin AI proxy request failed", error);
    return serviceUnavailableResponse();
  }

  return withAdminAiCode(response);
}

async function rateLimitAdminAi(request, env, scope, maxRequests, windowMs) {
  const ip = getClientIp(request);
  if (await isSharedRateLimited(env, scope, ip, maxRequests, windowMs)) {
    return adminAiRateLimitResponse();
  }
  return null;
}

export async function handleAdminAI(ctx) {
  const { request, env, pathname, method } = ctx;

  if (!pathname.startsWith("/api/admin/ai/")) {
    return null;
  }

  const result = await requireAdmin(request, env);
  if (result instanceof Response) {
    return withAdminAiCode(result);
  }

  if (pathname === "/api/admin/ai/models" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-models-ip", 60, 600_000);
    if (limited) return limited;
    return proxyToAiLab(env, "/internal/ai/models", { method: "GET" }, result.user);
  }

  if (pathname === "/api/admin/ai/test-text" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-text-ip", 30, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-text",
        { method: "POST", body: validateTextPayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-image" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-image-ip", 10, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-image",
        { method: "POST", body: validateImagePayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-embeddings-ip", 20, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-embeddings",
        { method: "POST", body: validateEmbeddingsPayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/compare" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-compare-ip", 15, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/compare",
        { method: "POST", body: validateComparePayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/live-agent" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-liveagent-ip", 20, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyLiveAgentToAiLab(env, validateLiveAgentPayload(body), result.user);
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/image-derivatives/backfill" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-derivative-backfill-ip", 20, 600_000);
    if (limited) return limited;

    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await readJsonBody(request) : {};
    if (contentType.includes("application/json") && !body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      const input = validateImageDerivativeBackfillPayload(body);
      const page = await listAiImagesNeedingDerivativeWork(env, {
        limit: input.limit,
        cursor: input.cursor,
        includeFailed: input.includeFailed,
        targetVersion: AI_IMAGE_DERIVATIVE_VERSION,
      });

      let enqueued = 0;
      for (const row of page.rows) {
        await enqueueAiImageDerivativeJob(env, {
          imageId: row.id,
          userId: row.user_id,
          originalKey: row.r2_key,
          derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
          trigger: "backfill",
        });
        enqueued += 1;
      }

      console.log(
        `AI image derivative backfill queued=${enqueued} scanned=${page.rows.length} version=${AI_IMAGE_DERIVATIVE_VERSION} has_more=${page.hasMore}`
      );

      return json({
        ok: true,
        data: {
          scanned: page.rows.length,
          enqueued,
          has_more: page.hasMore,
          next_cursor: page.nextCursor,
          derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
        },
      });
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      if (String(error?.message || error).includes("Invalid cursor.")) {
        return json({ ok: false, error: "Invalid cursor.", code: "validation_error" }, { status: 400 });
      }
      console.error("Admin AI derivative backfill failed", error);
      return json(
        {
          ok: false,
          error: "Derivative backfill enqueue failed.",
          code: "derivative_backfill_failed",
        },
        { status: 503 }
      );
    }
  }

  if (pathname === "/api/admin/ai/save-text-asset" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-save-text-ip", 25, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      const input = validateSaveTextAssetPayload(body);
      const saved = await saveAdminAiTextAsset(env, {
        userId: result.user.id,
        folderId: input.folderId,
        title: input.title,
        sourceModule: input.sourceModule,
        payload: input.payload,
      });
      return json({ ok: true, data: saved }, { status: 201 });
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      return storageErrorResponse(error);
    }
  }

  if (pathname.startsWith("/api/admin/ai/")) {
    return json(
      {
        ok: false,
        error: "Not found",
        code: "not_found",
      },
      { status: 404 }
    );
  }

  return null;
}
