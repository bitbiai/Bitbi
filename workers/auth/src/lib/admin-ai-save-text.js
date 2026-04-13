import { json } from "./response.js";
import { sanitizeAssetMetadata } from "./ai-asset-metadata.js";
import { saveAdminAiTextAsset } from "./ai-text-assets.js";
import {
  ADMIN_AI_LIMITS as LIMITS,
  ADMIN_AI_LIVE_AGENT_LIMITS as LIVE_AGENT_LIMITS,
  AdminAiValidationError as InputError,
} from "../../../../js/shared/admin-ai-contract.mjs";
import {
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

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

function inputErrorResponse(error, correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  ), correlationId);
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

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
}

function ensurePlainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${field} must be an object.`, 400, "validation_error");
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
  try {
    return sanitizeAssetMetadata(value, {
      field,
      maxEntries: SAVE_TEXT_ASSET_LIMITS.maxUsageKeys,
      maxKeyLength: SAVE_TEXT_ASSET_LIMITS.maxUsageKeyLength,
      maxStringLength: SAVE_TEXT_ASSET_LIMITS.maxUsageStringLength,
      stringifyNested: false,
    });
  } catch (error) {
    throw new InputError(
      error?.message || `${field} is invalid.`,
      error?.status || 400,
      error?.code || "validation_error"
    );
  }
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
    system: optionalString(input.system, "data.system", LIMITS.text.maxSystemLength),
    prompt: requiredString(input.prompt, "data.prompt", LIMITS.text.maxPromptLength),
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
    prompt: requiredString(input.prompt, "data.prompt", LIMITS.compare.maxPromptLength),
    system: optionalString(input.system, "data.system", LIMITS.compare.maxSystemLength),
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

export async function handleAdminAiSaveTextAssetRequest({
  env,
  adminUserId,
  body,
  correlationId,
}) {
  try {
    const input = validateSaveTextAssetPayload(body);
    const saved = await saveAdminAiTextAsset(env, {
      userId: adminUserId,
      folderId: input.folderId,
      title: input.title,
      sourceModule: input.sourceModule,
      payload: input.payload,
    });
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-save-text-asset",
      event: "admin_ai_text_asset_saved",
      correlationId,
      admin_user_id: adminUserId,
      asset_id: saved.id,
      folder_id: saved.folder_id,
      source_module: saved.source_module,
    });
    return withCorrelationId(json({ ok: true, data: saved }, { status: 201 }), correlationId);
  } catch (error) {
    if (error instanceof InputError) return inputErrorResponse(error, correlationId);
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-save-text-asset",
      event: "admin_ai_text_asset_save_failed",
      level: "error",
      correlationId,
      admin_user_id: adminUserId,
      ...getErrorFields(error),
    });
    return withCorrelationId(storageErrorResponse(error), correlationId);
  }
}
