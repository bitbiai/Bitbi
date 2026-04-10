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
  "@cf/black-forest-labs/flux-2-dev": {
    id: "@cf/black-forest-labs/flux-2-dev",
    task: "image",
    label: "FLUX.2 Dev",
    vendor: "Black Forest Labs",
    inputFormat: "multipart",
    supportsSeed: false,
    supportsSteps: false,
    supportsDimensions: true,
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

const DEFAULT_PRESETS = {
  text: "balanced",
  image: "image_fast",
  embeddings: "embedding_default",
};

const REGISTRY = {
  text: TEXT_MODELS,
  image: IMAGE_MODELS,
  embeddings: EMBEDDING_MODELS,
};

function invalidSelection(message, code = "validation_error") {
  const error = new Error(message);
  error.name = "ValidationError";
  error.status = 400;
  error.code = code;
  return error;
}

function toPublicModel(model) {
  return {
    id: model.id,
    task: model.task,
    label: model.label,
    vendor: model.vendor,
    description: model.description,
  };
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

function getRegistryForTask(task) {
  const registry = REGISTRY[task];
  if (!registry) {
    throw invalidSelection(`Unsupported AI task "${task}".`, "bad_request");
  }
  return registry;
}

export function listCatalog() {
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

export function getModelSummary(model) {
  return toPublicModel(model);
}

export function resolveModelSelection(task, selection = {}) {
  const registry = getRegistryForTask(task);
  const warnings = [];
  let preset = selection.preset ? PRESETS[selection.preset] : null;

  if (selection.preset && (!preset || preset.task !== task)) {
    throw invalidSelection(`Preset "${selection.preset}" is not valid for task "${task}".`, "validation_error");
  }

  if (!preset && !selection.model) {
    preset = PRESETS[DEFAULT_PRESETS[task]];
  }

  let model = selection.model ? registry[selection.model] : null;
  if (selection.model && !model) {
    throw invalidSelection(`Model "${selection.model}" is not allowlisted for task "${task}".`, "model_not_allowed");
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

export function resolveCompareModels(modelIds) {
  const registry = getRegistryForTask("text");
  return modelIds.map((modelId) => {
    const model = registry[modelId];
    if (!model) {
      throw invalidSelection(`Model "${modelId}" is not allowlisted for task "text".`, "model_not_allowed");
    }
    return model;
  });
}
