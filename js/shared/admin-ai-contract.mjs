export class AdminAiValidationError extends Error {
  constructor(message, status = 400, code = "validation_error") {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.code = code;
  }
}

export const FLUX_2_DEV_MODEL_ID = "@cf/black-forest-labs/flux-2-dev";
export const FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE = 512;

export const ADMIN_AI_LIMITS = {
  text: {
    maxPromptLength: 4000,
    maxSystemLength: 1200,
    defaultMaxTokens: 300,
    maxTokens: 1200,
    defaultTemperature: 0.7,
    minTemperature: 0,
    maxTemperature: 2,
  },
  image: {
    maxPromptLength: 2048,
    maxStructuredPromptLength: 8192,
    defaultSteps: 4,
    minSteps: 1,
    maxSteps: 50,
    minGuidance: 1,
    maxGuidance: 20,
    allowedDimensions: [256, 512, 768, 1024],
    maxPixels: 1024 * 1024,
    maxSeed: 2147483647,
    maxReferenceImages: 4,
    maxReferenceImageBytes: 10 * 1024 * 1024,
  },
  embeddings: {
    maxBatchSize: 8,
    maxItemLength: 2000,
    maxTotalChars: 8000,
  },
  compare: {
    minModels: 2,
    maxModels: 3,
    maxPromptLength: 4000,
    maxSystemLength: 1200,
    defaultMaxTokens: 250,
    maxTokens: 600,
    defaultTemperature: 0.7,
    minTemperature: 0,
    maxTemperature: 2,
  },
};

export const ADMIN_AI_IMAGE_CAPABILITY_FALLBACK = {
  supportsSeed: true,
  supportsSteps: true,
  supportsDimensions: false,
  supportsGuidance: false,
  supportsStructuredPrompt: false,
  supportsReferenceImages: false,
  maxReferenceImages: 0,
  maxSteps: 8,
  defaultSteps: 4,
  minGuidance: null,
  maxGuidance: null,
  defaultGuidance: null,
};

export const ADMIN_AI_LIVE_AGENT_LIMITS = {
  maxMessages: 40,
  maxSystemLength: 1200,
  maxMessageLength: 4000,
};

export const ADMIN_AI_LIVE_AGENT_MODEL = {
  id: "@cf/google/gemma-4-26b-a4b-it",
  label: "Gemma 4 26B A4B",
  vendor: "Google",
};

const TEXT_MODELS = {
  "@cf/meta/llama-3.1-8b-instruct-fast": {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    task: "text",
    label: "Llama 3.1 8B Instruct Fast",
    vendor: "Meta",
    inputFormat: "messages",
    defaultMaxTokens: 300,
    maxTokens: 800,
    description: "Fast, low-cost text generation for quick iteration.",
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    task: "text",
    label: "Llama 3.3 70B Instruct FP8 Fast",
    vendor: "Meta",
    inputFormat: "messages",
    defaultMaxTokens: 400,
    maxTokens: 1000,
    description: "Higher-capability text model for richer comparisons.",
  },
  "@cf/google/gemma-4-26b-a4b-it": {
    id: "@cf/google/gemma-4-26b-a4b-it",
    task: "text",
    label: "Gemma 4 26B A4B",
    vendor: "Google",
    inputFormat: "messages",
    defaultMaxTokens: 400,
    maxTokens: 1000,
    description: "Balanced conversational text model aligned with the live agent surface.",
  },
  "@cf/openai/gpt-oss-20b": {
    id: "@cf/openai/gpt-oss-20b",
    task: "text",
    label: "GPT OSS 20B",
    vendor: "OpenAI",
    inputFormat: "messages",
    defaultMaxTokens: 400,
    maxTokens: 1000,
    reasoningEffort: "low",
    description: "Balanced text model with better reasoning than the fast tier.",
  },
  "@cf/openai/gpt-oss-120b": {
    id: "@cf/openai/gpt-oss-120b",
    task: "text",
    label: "GPT OSS 120B",
    vendor: "OpenAI",
    inputFormat: "messages",
    defaultMaxTokens: 500,
    maxTokens: 1200,
    reasoningEffort: "medium",
    description: "Highest-capability text preset in the v1 lab allowlist.",
  },
};

const IMAGE_MODELS = {
  "@cf/black-forest-labs/flux-1-schnell": {
    id: "@cf/black-forest-labs/flux-1-schnell",
    task: "image",
    label: "FLUX.1 Schnell",
    vendor: "Black Forest Labs",
    inputFormat: "json",
    supportsSeed: true,
    supportsSteps: true,
    supportsDimensions: false,
    defaultSteps: 4,
    maxSteps: 8,
    defaultMimeType: "image/jpeg",
    description: "Fast image generation using prompt, seed, and steps.",
  },
  "@cf/black-forest-labs/flux-2-klein-9b": {
    id: "@cf/black-forest-labs/flux-2-klein-9b",
    task: "image",
    label: "FLUX.2 Klein 9B",
    vendor: "Black Forest Labs",
    inputFormat: "multipart",
    supportsSeed: false,
    supportsSteps: false,
    supportsDimensions: true,
    defaultSize: { width: 1024, height: 1024 },
    defaultMimeType: "image/jpeg",
    description: "Multipart image generation with prompt and bounded dimensions.",
  },
  [FLUX_2_DEV_MODEL_ID]: {
    id: FLUX_2_DEV_MODEL_ID,
    task: "image",
    label: "FLUX.2 Dev",
    vendor: "Black Forest Labs",
    inputFormat: "multipart",
    supportsSeed: true,
    supportsSteps: true,
    supportsDimensions: true,
    supportsGuidance: true,
    supportsStructuredPrompt: true,
    supportsReferenceImages: true,
    maxReferenceImages: 4,
    defaultSteps: 20,
    maxSteps: 50,
    defaultGuidance: 7.5,
    minGuidance: 1,
    maxGuidance: 20,
    defaultSize: { width: 1024, height: 1024 },
    defaultMimeType: "image/jpeg",
    description: "Higher-capability multipart image generation for admin experiments.",
  },
};

const EMBEDDING_MODELS = {
  "@cf/baai/bge-m3": {
    id: "@cf/baai/bge-m3",
    task: "embeddings",
    label: "BGE M3",
    vendor: "BAAI",
    dimensions: 1024,
    description: "Default multilingual embedding model for general experiments.",
  },
  "@cf/google/embeddinggemma-300m": {
    id: "@cf/google/embeddinggemma-300m",
    task: "embeddings",
    label: "EmbeddingGemma 300M",
    vendor: "Google",
    description: "Lightweight multilingual embedding alternative.",
  },
};

const PRESETS = {
  fast: {
    name: "fast",
    task: "text",
    label: "Fast Text",
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    description: "Low-cost and low-latency text generation.",
  },
  balanced: {
    name: "balanced",
    task: "text",
    label: "Balanced Text",
    model: "@cf/openai/gpt-oss-20b",
    description: "General-purpose text preset for most admin testing.",
  },
  best: {
    name: "best",
    task: "text",
    label: "Best Text",
    model: "@cf/openai/gpt-oss-120b",
    description: "Highest-capability text preset in the initial allowlist.",
  },
  image_fast: {
    name: "image_fast",
    task: "image",
    label: "Fast Image",
    model: "@cf/black-forest-labs/flux-1-schnell",
    description: "Fast image generation aligned with the existing production image model.",
  },
  embedding_default: {
    name: "embedding_default",
    task: "embeddings",
    label: "Default Embeddings",
    model: "@cf/baai/bge-m3",
    description: "Default multilingual embeddings preset.",
  },
};

export const ADMIN_AI_DEFAULT_PRESETS = {
  text: "balanced",
  image: "image_fast",
  embeddings: "embedding_default",
};

export const ADMIN_AI_DEFAULT_COMPARE_MODELS = {
  modelA: "@cf/meta/llama-3.1-8b-instruct-fast",
  modelB: "@cf/openai/gpt-oss-20b",
};

const REGISTRY = {
  text: TEXT_MODELS,
  image: IMAGE_MODELS,
  embeddings: EMBEDDING_MODELS,
};

function invalidSelection(message, code = "validation_error") {
  return new AdminAiValidationError(message, 400, code);
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdminAiValidationError(`${field} is required.`, 400, "validation_error");
  }
  if (trimmed.length > maxLength) {
    throw new AdminAiValidationError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "validation_error"
    );
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AdminAiValidationError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "validation_error"
    );
  }
  return trimmed;
}

function optionalInteger(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new AdminAiValidationError(`${field} must be an integer.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new AdminAiValidationError(
      `${field} must be between ${min} and ${max}.`,
      400,
      "validation_error"
    );
  }
  return parsed;
}

function optionalNumber(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AdminAiValidationError(`${field} must be a number.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new AdminAiValidationError(
      `${field} must be between ${min} and ${max}.`,
      400,
      "validation_error"
    );
  }
  return parsed;
}

function optionalDimension(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = optionalInteger(
    value,
    field,
    ADMIN_AI_LIMITS.image.allowedDimensions[0],
    ADMIN_AI_LIMITS.image.allowedDimensions[ADMIN_AI_LIMITS.image.allowedDimensions.length - 1]
  );
  if (!ADMIN_AI_LIMITS.image.allowedDimensions.includes(parsed)) {
    throw new AdminAiValidationError(
      `${field} must be one of ${ADMIN_AI_LIMITS.image.allowedDimensions.join(", ")}.`,
      400,
      "validation_error"
    );
  }
  return parsed;
}

function normalizeInputArray(input, field, maxItems, maxItemLength) {
  const values = typeof input === "string" ? [input] : input;
  if (!Array.isArray(values)) {
    throw new AdminAiValidationError(
      `${field} must be a string or an array of strings.`,
      400,
      "validation_error"
    );
  }
  if (values.length === 0) {
    throw new AdminAiValidationError(
      `${field} must contain at least one item.`,
      400,
      "validation_error"
    );
  }
  if (values.length > maxItems) {
    throw new AdminAiValidationError(
      `${field} must contain at most ${maxItems} items.`,
      400,
      "validation_error"
    );
  }
  return values.map((entry, index) => requiredString(entry, `${field}[${index}]`, maxItemLength));
}

function optionalStructuredPrompt(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AdminAiValidationError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "validation_error"
    );
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AdminAiValidationError(`${field} must be a JSON object.`, 400, "validation_error");
    }
  } catch (error) {
    if (error instanceof AdminAiValidationError) throw error;
    throw new AdminAiValidationError(`${field} contains invalid JSON.`, 400, "validation_error");
  }
  return trimmed;
}

function validateReferenceImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AdminAiValidationError("referenceImages must be an array.", 400, "validation_error");
  }
  if (value.length > ADMIN_AI_LIMITS.image.maxReferenceImages) {
    throw new AdminAiValidationError(
      `referenceImages must contain at most ${ADMIN_AI_LIMITS.image.maxReferenceImages} items.`,
      400,
      "validation_error"
    );
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.startsWith("data:")) {
      throw new AdminAiValidationError(
        `referenceImages[${index}] must be a data URI string.`,
        400,
        "validation_error"
      );
    }
    const commaIndex = item.indexOf(",");
    if (commaIndex === -1) {
      throw new AdminAiValidationError(
        `referenceImages[${index}] is not a valid data URI.`,
        400,
        "validation_error"
      );
    }
    const base64 = item.slice(commaIndex + 1);
    const estimatedBytes = Math.ceil(base64.length * 0.75);
    if (estimatedBytes > ADMIN_AI_LIMITS.image.maxReferenceImageBytes) {
      throw new AdminAiValidationError(
        `referenceImages[${index}] exceeds the ${ADMIN_AI_LIMITS.image.maxReferenceImageBytes} byte size limit.`,
        400,
        "validation_error"
      );
    }
    return item;
  });
}

function dataUriToBytes(dataUri, field) {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) {
    throw new AdminAiValidationError(`${field} is not a valid data URI.`, 400, "validation_error");
  }

  let binary;
  try {
    binary = atob(dataUri.slice(commaIndex + 1));
  } catch {
    throw new AdminAiValidationError(`${field} is not a valid base64 image.`, 400, "validation_error");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getRegistryForTask(task) {
  const registry = REGISTRY[task];
  if (!registry) {
    throw invalidSelection(`Unsupported AI task "${task}".`, "bad_request");
  }
  return registry;
}

function toPublicModel(model) {
  const pub = {
    id: model.id,
    task: model.task,
    label: model.label,
    vendor: model.vendor,
    description: model.description,
  };
  if (model.task === "image") {
    pub.capabilities = {
      supportsSeed: !!model.supportsSeed,
      supportsSteps: !!model.supportsSteps,
      supportsDimensions: !!model.supportsDimensions,
      supportsGuidance: !!model.supportsGuidance,
      supportsStructuredPrompt: !!model.supportsStructuredPrompt,
      supportsReferenceImages: !!model.supportsReferenceImages,
      maxReferenceImages: model.maxReferenceImages || 0,
      maxSteps: model.maxSteps || null,
      defaultSteps: model.defaultSteps || null,
      minGuidance: model.minGuidance || null,
      maxGuidance: model.maxGuidance || null,
      defaultGuidance: model.defaultGuidance || null,
    };
  }
  return pub;
}

function toPublicPreset(preset) {
  return {
    name: preset.name,
    task: preset.task,
    label: preset.label,
    model: preset.model,
    description: preset.description,
  };
}

export function listAdminAiCatalog() {
  return {
    presets: Object.values(PRESETS).map(toPublicPreset),
    models: {
      text: Object.values(TEXT_MODELS).map(toPublicModel),
      image: Object.values(IMAGE_MODELS).map(toPublicModel),
      embeddings: Object.values(EMBEDDING_MODELS).map(toPublicModel),
    },
    future: {
      speech: {
        enabled: false,
        note: "Speech support is scaffold-only in v1 and not yet routed through the auth worker.",
      },
    },
  };
}

export function getAdminAiModelSummary(model) {
  return toPublicModel(model);
}

export function resolveAdminAiModelSelection(task, selection = {}) {
  const registry = getRegistryForTask(task);
  const warnings = [];
  let preset = selection.preset ? PRESETS[selection.preset] : null;

  if (selection.preset && (!preset || preset.task !== task)) {
    throw invalidSelection(
      `Preset "${selection.preset}" is not valid for task "${task}".`,
      "validation_error"
    );
  }

  if (!preset && !selection.model) {
    preset = PRESETS[ADMIN_AI_DEFAULT_PRESETS[task]];
  }

  let model = selection.model ? registry[selection.model] : null;
  if (selection.model && !model) {
    throw invalidSelection(
      `Model "${selection.model}" is not allowlisted for task "${task}".`,
      "model_not_allowed"
    );
  }

  if (!model && preset) {
    model = registry[preset.model];
  }

  if (!model) {
    throw invalidSelection(`A model selection is required for task "${task}".`, "validation_error");
  }

  if (selection.model && preset && selection.model !== preset.model) {
    warnings.push(`Explicit model "${selection.model}" overrides preset "${preset.name}".`);
  }

  return {
    model,
    preset: preset ? preset.name : null,
    warnings,
  };
}

export function resolveAdminAiCompareModels(modelIds) {
  const registry = getRegistryForTask("text");
  return modelIds.map((modelId) => {
    const model = registry[modelId];
    if (!model) {
      throw invalidSelection(
        `Model "${modelId}" is not allowlisted for task "text".`,
        "model_not_allowed"
      );
    }
    return model;
  });
}

export function validateAdminAiTextBody(body) {
  const input = ensureObject(body);
  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.text.maxPromptLength),
    system: optionalString(input.system, "system", ADMIN_AI_LIMITS.text.maxSystemLength),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      ADMIN_AI_LIMITS.text.maxTokens,
      ADMIN_AI_LIMITS.text.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      ADMIN_AI_LIMITS.text.minTemperature,
      ADMIN_AI_LIMITS.text.maxTemperature,
      ADMIN_AI_LIMITS.text.defaultTemperature
    ),
  };
}

export function validateAdminAiImageBody(body) {
  const input = ensureObject(body);
  const width = optionalDimension(input.width, "width");
  const height = optionalDimension(input.height, "height");

  if ((width && !height) || (!width && height)) {
    throw new AdminAiValidationError(
      "width and height must be provided together.",
      400,
      "validation_error"
    );
  }

  if (width && height && width * height > ADMIN_AI_LIMITS.image.maxPixels) {
    throw new AdminAiValidationError(
      `Image dimensions exceed the ${ADMIN_AI_LIMITS.image.maxPixels} pixel safety cap.`,
      400,
      "validation_error"
    );
  }

  const structuredPrompt = optionalStructuredPrompt(
    input.structuredPrompt,
    "structuredPrompt",
    ADMIN_AI_LIMITS.image.maxStructuredPromptLength
  );
  const referenceImages = validateReferenceImages(input.referenceImages);

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: structuredPrompt
      ? optionalString(input.prompt, "prompt", ADMIN_AI_LIMITS.image.maxPromptLength)
      : requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.image.maxPromptLength),
    structuredPrompt,
    promptMode: structuredPrompt ? "structured" : "standard",
    width,
    height,
    steps: optionalInteger(
      input.steps,
      "steps",
      ADMIN_AI_LIMITS.image.minSteps,
      ADMIN_AI_LIMITS.image.maxSteps,
      null
    ),
    seed: optionalInteger(input.seed, "seed", 0, ADMIN_AI_LIMITS.image.maxSeed, null),
    guidance: optionalNumber(
      input.guidance,
      "guidance",
      ADMIN_AI_LIMITS.image.minGuidance,
      ADMIN_AI_LIMITS.image.maxGuidance,
      null
    ),
    referenceImages,
  };
}

export function validateAdminAiEmbeddingsBody(body) {
  const input = ensureObject(body);
  const values = normalizeInputArray(
    input.input,
    "input",
    ADMIN_AI_LIMITS.embeddings.maxBatchSize,
    ADMIN_AI_LIMITS.embeddings.maxItemLength
  );
  const totalChars = values.reduce((sum, value) => sum + value.length, 0);
  if (totalChars > ADMIN_AI_LIMITS.embeddings.maxTotalChars) {
    throw new AdminAiValidationError(
      `input exceeds the total ${ADMIN_AI_LIMITS.embeddings.maxTotalChars} character cap.`,
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

export function validateAdminAiCompareBody(body) {
  const input = ensureObject(body);
  const models = normalizeInputArray(
    input.models,
    "models",
    ADMIN_AI_LIMITS.compare.maxModels,
    120
  );
  if (models.length < ADMIN_AI_LIMITS.compare.minModels) {
    throw new AdminAiValidationError(
      `models must contain at least ${ADMIN_AI_LIMITS.compare.minModels} items.`,
      400,
      "validation_error"
    );
  }
  if (new Set(models).size !== models.length) {
    throw new AdminAiValidationError("models must not contain duplicates.", 400, "duplicate_models");
  }
  return {
    models,
    prompt: requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.compare.maxPromptLength),
    system: optionalString(input.system, "system", ADMIN_AI_LIMITS.compare.maxSystemLength),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      ADMIN_AI_LIMITS.compare.maxTokens,
      ADMIN_AI_LIMITS.compare.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      ADMIN_AI_LIMITS.compare.minTemperature,
      ADMIN_AI_LIMITS.compare.maxTemperature,
      ADMIN_AI_LIMITS.compare.defaultTemperature
    ),
  };
}

export function validateAdminAiLiveAgentBody(body) {
  const input = ensureObject(body);
  const messages = input.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AdminAiValidationError("messages must be a non-empty array.", 400, "validation_error");
  }
  if (messages.length > ADMIN_AI_LIVE_AGENT_LIMITS.maxMessages) {
    throw new AdminAiValidationError(
      `messages must contain at most ${ADMIN_AI_LIVE_AGENT_LIMITS.maxMessages} items.`,
      400,
      "validation_error"
    );
  }

  const validated = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      throw new AdminAiValidationError(`messages[${i}] must be an object.`, 400, "validation_error");
    }
    const role = msg.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new AdminAiValidationError(
        `messages[${i}].role must be "system", "user", or "assistant".`,
        400,
        "validation_error"
      );
    }
    if (typeof msg.content !== "string") {
      throw new AdminAiValidationError(
        `messages[${i}].content must be a string.`,
        400,
        "validation_error"
      );
    }
    const maxLen =
      role === "system"
        ? ADMIN_AI_LIVE_AGENT_LIMITS.maxSystemLength
        : ADMIN_AI_LIVE_AGENT_LIMITS.maxMessageLength;
    const trimmed = msg.content.trim();
    if (!trimmed) {
      throw new AdminAiValidationError(
        `messages[${i}].content must not be empty.`,
        400,
        "validation_error"
      );
    }
    if (trimmed.length > maxLen) {
      throw new AdminAiValidationError(
        `messages[${i}].content must be at most ${maxLen} characters.`,
        400,
        "validation_error"
      );
    }
    validated.push({ role, content: trimmed });
  }

  if (!validated.some((entry) => entry.role === "user")) {
    throw new AdminAiValidationError(
      "messages must include at least one user message.",
      400,
      "validation_error"
    );
  }

  return { messages: validated };
}

export async function validateFlux2DevReferenceImageDimensions(env, input) {
  if (input?.model !== FLUX_2_DEV_MODEL_ID || !Array.isArray(input.referenceImages) || input.referenceImages.length === 0) {
    return;
  }
  if (!env?.IMAGES || typeof env.IMAGES.info !== "function") {
    throw new Error("Images binding is unavailable for FLUX.2 Dev reference image validation.");
  }

  for (const [index, dataUri] of input.referenceImages.entries()) {
    const field = `referenceImages[${index}]`;
    const bytes = dataUriToBytes(dataUri, field);
    let info;
    try {
      info = await env.IMAGES.info(bytes);
    } catch {
      throw new AdminAiValidationError(
        `${field} could not be inspected for dimensions.`,
        400,
        "validation_error"
      );
    }
    const width = Number(info?.width);
    const height = Number(info?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new AdminAiValidationError(
        `${field} could not be inspected for dimensions.`,
        400,
        "validation_error"
      );
    }
    if (
      width >= FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE ||
      height >= FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE
    ) {
      throw new AdminAiValidationError(
        `${field} must be smaller than 512x512 for ${FLUX_2_DEV_MODEL_ID}. Received ${width}x${height}.`,
        400,
        "validation_error"
      );
    }
  }
}

function dataUriToBlob(dataUri) {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) return null;
  const meta = dataUri.slice(0, commaIndex);
  const base64 = dataUri.slice(commaIndex + 1);
  const mimeMatch = meta.match(/^data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function buildAdminAiMultipartImageRequest(model, input) {
  const form = new FormData();

  if (input.structuredPrompt) {
    form.append("prompt", input.structuredPrompt);
  } else {
    form.append("prompt", input.prompt);
  }

  const width = input.width || model.defaultSize?.width || null;
  const height = input.height || model.defaultSize?.height || null;

  if (width && height) {
    form.append("width", String(width));
    form.append("height", String(height));
  }

  if (model.supportsSteps && input.steps !== null && input.steps !== undefined) {
    form.append("steps", String(input.steps));
  }

  if (model.supportsSeed && input.seed !== null && input.seed !== undefined) {
    form.append("seed", String(input.seed));
  }

  if (model.supportsGuidance && input.guidance !== null && input.guidance !== undefined) {
    form.append("guidance", String(input.guidance));
  }

  if (model.supportsReferenceImages && Array.isArray(input.referenceImages)) {
    input.referenceImages.forEach((refImg, index) => {
      const blob = dataUriToBlob(refImg);
      if (!blob) return;
      const fieldName = model.id === FLUX_2_DEV_MODEL_ID ? `input_image_${index}` : "image";
      form.append(fieldName, blob, `reference-${index}`);
    });
  }

  const response = new Response(form);
  const contentType = response.headers.get("content-type");
  const body = response.body;
  if (!contentType || !body) {
    throw new Error("Failed to encode multipart image request.");
  }

  return {
    payload: {
      multipart: {
        body,
        contentType,
      },
    },
    appliedSteps: model.supportsSteps ? input.steps : null,
    appliedSeed: model.supportsSeed ? input.seed : null,
    appliedGuidance: model.supportsGuidance ? input.guidance : null,
    appliedSize: width && height ? { width, height } : null,
  };
}
