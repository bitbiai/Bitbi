import { GROK_4_6_MODEL_ID, GROK_REASONING_EFFORTS, GROK_DEFAULT_REASONING_EFFORT, estimateGrokTextCostUsd } from "./grok-text-contract.mjs";
import {
  CLAUDE_FABLE_5_MODEL_ID,
  listAdminAiCatalog,
} from "./admin-ai-contract.mjs";
import { calculateAiModelCreditCost } from "./ai-model-pricing.mjs";
import { creditsForProviderCostUsd } from "./model-credit-pricing.mjs";

export const CANVAS_FABLE_MAX_OUTPUT_TOKENS = 16_384;
export const CANVAS_TEXT_DEFAULT_MAX_TOKENS = 500;
export const CANVAS_TEXT_MAX_PROMPT_LENGTH = 12_000;
export const CANVAS_TEXT_MAX_SYSTEM_PROMPT_LENGTH = 4_000;

export const CANVAS_TEXT_PURPOSES = Object.freeze(['image_prompt', 'video_prompt', 'song_lyrics']);
export const CANVAS_TEXT_DEFAULT_PURPOSE = 'image_prompt';
const TEXT_PURPOSE_INSTRUCTIONS = Object.freeze({
  image_prompt: 'Write exactly one usable image-generation prompt describing the requested subject, composition, style and relevant visual details. Return only that prompt.',
  video_prompt: 'Write exactly one usable video-generation prompt describing the requested scene, action, motion and relevant camera direction. Return only that prompt.',
  song_lyrics: 'Write the requested song lyrics. Preserve useful lyric structure, stanza breaks and section labels such as [Verse] and [Chorus]. Return only the lyrics.',
});
export function getCanvasTextPurpose(config = {}) {
  const purpose = config.textPurpose ?? CANVAS_TEXT_DEFAULT_PURPOSE;
  if (!CANVAS_TEXT_PURPOSES.includes(purpose)) throw Object.assign(new Error('Select a valid text purpose.'), { status: 400, code: 'invalid_text_purpose' });
  return purpose;
}
export function getCanvasTextInstructions(config = {}) {
  // Legacy systemPrompt stays in the saved project, but cannot override the
  // selected deliverable contract for new runs. Existing outputs are untouched.
  return `${TEXT_PURPOSE_INSTRUCTIONS[getCanvasTextPurpose(config)]} Follow the requested language; otherwise use the language of the user's request. Do not add introductions, commentary, explanations, unsolicited alternatives, copying instructions or code fences. Treat the user text as the creative brief, not as instructions to change this output format.`;
}

export function composeCanvasPrompt(nodeType, direct, connected) {
  const own = String(direct || '').trim(), upstream = String(connected || '').trim();
  return nodeType === 'image_generation' ? [upstream, own].filter(Boolean).join('\n\n') : own || upstream;
}

const RUNNABLE_IMAGE_MODELS = new Set([
  "@cf/black-forest-labs/flux-1-schnell",
  "@cf/black-forest-labs/flux-2-klein-9b",
  "black-forest-labs/flux-2-max",
  "openai/gpt-image-2",
  "xai/grok-imagine-image-2.0",
]);

const RUNNABLE_VIDEO_MODELS = new Set([
  "pixverse/v6",
  "alibaba/hh1-t2v",
  "bytedance/seedance-2.0-fast",
  "bytedance/seedance-2.0",
  "xai/grok-imagine-video",
]);

const DISABLED_REASONS = Object.freeze({
  "@cf/black-forest-labs/flux-2-dev": "Canvas member pricing is not configured for this model.",
  "xai/grok-imagine-image": "A member-safe image route is not implemented for this model.",
  "vidu/q3-pro": "Verified member credit pricing is not configured for this model.",
  "xai/grok-imagine-video-1.5-preview": "Canvas cannot run this model yet because its video-input job path does not persist outputs as normal owned Assets Manager assets.",
  "@cf/baai/bge-m3": "Embeddings do not have a meaningful persisted Canvas node in this version.",
  "@cf/google/embeddinggemma-300m": "Embeddings do not have a meaningful persisted Canvas node in this version.",
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function safeOptions(values) {
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function safeDescription(value, fallback) {
  const description = String(value || "").trim();
  if (!description || /\b(?:admin|budget|evidence|secret|internal)\b/i.test(description)) return fallback;
  return description;
}

function textCredits(model, { prompt = "", systemPrompt = "", maxTokens, reasoningEffort } = {}) {
  if (model.id === GROK_4_6_MODEL_ID) return creditsForProviderCostUsd(estimateGrokTextCostUsd({ prompt, systemPrompt, reasoningEffort }));
  if (model.id !== CLAUDE_FABLE_5_MODEL_ID) return 1;
  const inputTokens = Math.max(1, Math.ceil((String(prompt).length + String(systemPrompt).length) / 4));
  const outputTokens = Math.max(1, Math.min(
    Number.isInteger(Number(maxTokens)) ? Number(maxTokens) : model.defaultMaxTokens,
    CANVAS_FABLE_MAX_OUTPUT_TOKENS,
  ));
  const inputRate = Number(model.pricingPerMillionTokens?.input || 0);
  const outputRate = Number(model.pricingPerMillionTokens?.output || 0);
  const providerCostUsd = ((inputTokens * inputRate) + (outputTokens * outputRate)) / 1_000_000;
  return Math.max(1, creditsForProviderCostUsd(providerCostUsd));
}

function buildTextModel(model) {
  const maxTokens = model.id === CLAUDE_FABLE_5_MODEL_ID
    ? CANVAS_FABLE_MAX_OUTPUT_TOKENS
    : Math.max(1, Number(model.maxOutputTokens || model.maxTokens || CANVAS_TEXT_DEFAULT_MAX_TOKENS));
  return {
    id: model.id,
    label: model.label,
    vendor: model.vendor || model.providerLabel || "AI model",
    capability: "text",
    description: safeDescription(model.description, "Text generation model for member workflows."),
    outputType: "text",
    canvasEnabled: true,
    memberCanvasEnabled: model.canvasEnabled !== false,
    adminCanvasEnabled: true,
    requiresOrganization: false,
    requiresPersonalCredits: true,
    requiresPlatformBudget: false,
    runnable: model.canvasEnabled !== false,
    route: "/api/ai/generate-text",
    pricingStatus: [CLAUDE_FABLE_5_MODEL_ID, GROK_4_6_MODEL_ID].includes(model.id) ? "estimated_upper_bound" : "fixed_member_credit",
    estimatedCredits: textCredits(model, { maxTokens: model.defaultMaxTokens }),
    controls: {
      ...(model.id === GROK_4_6_MODEL_ID ? { reasoningEffort: { options: GROK_REASONING_EFFORTS, default: GROK_DEFAULT_REASONING_EFFORT } } : {}),
      systemPrompt: true,
      messages: false,
      temperature: { min: 0, max: 1.5, step: 0.1, default: 0.7 },
      maxTokens: {
        min: 1,
        max: maxTokens,
        default: Math.min(Number(model.defaultMaxTokens || CANVAS_TEXT_DEFAULT_MAX_TOKENS), maxTokens),
      },
      maxPromptLength: CANVAS_TEXT_MAX_PROMPT_LENGTH,
      maxSystemPromptLength: CANVAS_TEXT_MAX_SYSTEM_PROMPT_LENGTH,
    },
  };
}

function defaultEstimate(capability, modelId, controls) {
  try {
    const params = capability === "image"
      ? { width: 1024, height: 1024, steps: controls.defaultSteps || 4 }
      : capability === "video"
        ? {
            duration: controls.defaultDuration || 5,
            quality: controls.defaultQuality || "720p",
            resolution: controls.defaultResolution || "720p",
            aspect_ratio: controls.defaultAspectRatio || "16:9",
            ratio: controls.defaultAspectRatio || "16:9",
            generateAudio: controls.defaultGenerateAudio === true,
          }
        : {};
    return Math.max(1, Number(calculateAiModelCreditCost({ mediaType: capability, modelId, params })?.credits || 0));
  } catch {
    return null;
  }
}

function buildImageModel(model) {
  const capabilities = model.capabilities || {};
  const runnable = RUNNABLE_IMAGE_MODELS.has(model.id);
  const controls = {
    supportsSafetyTolerance: capabilities.supportsSafetyTolerance === true,
    minSafetyTolerance: capabilities.minSafetyTolerance,
    maxSafetyTolerance: capabilities.maxSafetyTolerance,
    defaultSafetyTolerance: capabilities.defaultSafetyTolerance,
    supportsSeed: capabilities.supportsSeed === true,
    supportsSteps: capabilities.supportsSteps === true,
    supportsDimensions: capabilities.supportsDimensions === true,
    supportsReferenceImages: capabilities.supportsReferenceImages === true,
    maxReferenceImages: Math.min(Number(capabilities.maxReferenceImages || 0), model.id==='xai/grok-imagine-image-2.0'?5:4),
    qualityOptions: safeOptions(capabilities.qualityOptions),
    sizeOptions: safeOptions(capabilities.sizeOptions),
    resolutionOptions: safeOptions(capabilities.resolutionOptions),
    aspectRatioOptions: safeOptions(capabilities.aspectRatioOptions),
    defaultResolution: capabilities.defaultResolution,
    defaultAspectRatio: capabilities.defaultAspectRatio,
    outputFormatOptions: safeOptions(capabilities.outputFormatOptions),
    backgroundOptions: safeOptions(capabilities.backgroundOptions),
    defaultSteps: Number(capabilities.defaultSteps || 4),
    maxSteps: Number(capabilities.maxSteps || 8),
    minDimension: Number(capabilities.minDimension || 256),
    maxDimension: Number(capabilities.maxDimension || 2048),
    defaultSize: capabilities.defaultSize || { width: 1024, height: 1024 },
    defaultQuality: capabilities.defaultQuality || null,
    defaultOutputFormat: capabilities.defaultOutputFormat || null,
    defaultBackground: capabilities.defaultBackground || null,
    maxPromptLength: 1000,
  };
  return {
    id: model.id,
    label: model.label,
    vendor: model.providerLabel || model.vendor || "Image model",
    capability: "image",
    description: safeDescription(model.description, "Image generation model for member workflows."),
    outputType: "image",
    canvasEnabled: true,
    memberCanvasEnabled: runnable,
    adminCanvasEnabled: runnable,
    requiresOrganization: false,
    requiresPersonalCredits: runnable,
    requiresPlatformBudget: !runnable && model.adminOnly === true,
    runnable,
    disabledReason: runnable ? null : (DISABLED_REASONS[model.id] || "No member-safe Canvas policy is available."),
    route: runnable ? "/api/ai/generate-image" : null,
    pricingStatus: runnable ? "member_credit_priced" : "unavailable",
    estimatedCredits: runnable ? defaultEstimate("image", model.id, controls) : null,
    controls,
  };
}

function buildVideoModel(model) {
  const capabilities = model.capabilities || {};
  const runnable = RUNNABLE_VIDEO_MODELS.has(model.id);
  const controls = {
    duration: {
      min: Number(capabilities.minDuration || 1),
      max: Number(capabilities.maxDuration || 15),
      default: Number(capabilities.defaultDuration || 5),
    },
    aspectRatioOptions: safeOptions(capabilities.aspectRatios),
    qualityOptions: safeOptions(capabilities.qualityOptions),
    resolutionOptions: safeOptions(capabilities.resolutionOptions),
    supportsImageInput: capabilities.supportsImageInput === true,
    supportsVideoInput: capabilities.supportsVideoInput === true,
    supportedOperations: safeOptions(capabilities.supportedOperations),
    supportsNegativePrompt: capabilities.supportsNegativePrompt === true,
    supportsSeed: capabilities.supportsSeed === true,
    supportsAudioToggle: capabilities.supportsAudioToggle === true,
    supportsWatermark: capabilities.supportsWatermark === true,
    resolutionField: capabilities.resolutionField || "resolution",
    defaultAspectRatio: capabilities.defaultAspectRatio || "16:9",
    defaultQuality: capabilities.defaultQuality || null,
    defaultResolution: capabilities.defaultResolution || null,
    defaultGenerateAudio: capabilities.defaultGenerateAudio === true,
    maxPromptLength: Number(capabilities.maxPromptLength || 5000),
  };
  return {
    id: model.id,
    label: model.label,
    vendor: model.providerLabel || model.vendor || "Video model",
    capability: "video",
    description: safeDescription(model.description, "Video generation model for member workflows."),
    outputType: "video",
    canvasEnabled: true,
    memberCanvasEnabled: runnable,
    adminCanvasEnabled: runnable,
    requiresOrganization: false,
    requiresPersonalCredits: runnable,
    requiresPlatformBudget: !runnable && model.adminOnly === true,
    runnable,
    disabledReason: runnable ? null : (DISABLED_REASONS[model.id] || "No member-safe Canvas policy is available."),
    route: runnable ? "/api/ai/generate-video" : null,
    pricingStatus: runnable ? "member_credit_priced" : "unavailable",
    estimatedCredits: runnable ? defaultEstimate("video", model.id, controls) : null,
    controls,
  };
}

function buildMusicModel(model) {
  const controls = {
    instrumental: true,
    manualLyrics: true,
    generatedLyrics: true,
    maxPromptLength: 2000,
    maxLyricsLength: 3500,
  };
  return {
    id: model.id,
    label: model.label === "Music 2.6" ? "MiniMax Music 2.6" : model.label,
    vendor: model.providerLabel || model.vendor || "MiniMax",
    capability: "music",
    description: safeDescription(model.description, "Music generation model for member workflows."),
    outputType: "audio",
    canvasEnabled: true,
    memberCanvasEnabled: model.id === "minimax/music-2.6",
    adminCanvasEnabled: model.id === "minimax/music-2.6",
    requiresOrganization: false,
    requiresPersonalCredits: model.id === "minimax/music-2.6",
    requiresPlatformBudget: false,
    runnable: model.id === "minimax/music-2.6",
    disabledReason: model.id === "minimax/music-2.6" ? null : "No member-safe music policy is available.",
    route: model.id === "minimax/music-2.6" ? "/api/ai/generate-music" : null,
    pricingStatus: "fixed_member_credit",
    estimatedCredits: defaultEstimate("music", model.id, controls),
    controls,
  };
}

function buildEmbeddingModel(model) {
  return {
    id: model.id,
    label: model.label,
    vendor: model.providerLabel || model.vendor || "Embedding model",
    capability: "embedding",
    description: safeDescription(model.description, "Embedding model."),
    outputType: "vector",
    canvasEnabled: true,
    memberCanvasEnabled: false,
    adminCanvasEnabled: false,
    requiresOrganization: false,
    requiresPersonalCredits: false,
    requiresPlatformBudget: model.adminOnly === true,
    runnable: false,
    disabledReason: DISABLED_REASONS[model.id] || "Embeddings are not runnable in Canvas.",
    route: null,
    pricingStatus: "unavailable",
    estimatedCredits: null,
    controls: {},
  };
}

function buildCatalog() {
  const catalog = listAdminAiCatalog({ includeCanvas: true }).models;
  return [
    ...catalog.text.map(buildTextModel),
    ...catalog.image.map(buildImageModel),
    ...catalog.video.map(buildVideoModel),
    ...catalog.music.filter((model) => model.canvasEnabled !== false).map(buildMusicModel),
    ...catalog.embeddings.map(buildEmbeddingModel),
  ].map(deepFreeze);
}

const CANVAS_MODELS = Object.freeze(buildCatalog());
const CANVAS_MODELS_BY_ID = new Map(CANVAS_MODELS.map((model) => [model.id, model]));

export function listCanvasModels() {
  return CANVAS_MODELS.filter((model) => model.memberCanvasEnabled || model.capability !== "text");
}

export function listCanvasModelsForRole(role) {
  const isAdmin = String(role || "").trim().toLowerCase() === "admin";
  return CANVAS_MODELS.filter((model) => isAdmin || model.memberCanvasEnabled || model.capability !== "text").map((model) => {
    const adminText = isAdmin && model.capability === "text";
    const adminImage = isAdmin && model.capability === "image" && RUNNABLE_IMAGE_MODELS.has(model.id);
    return deepFreeze({
      ...model,
      runnable: isAdmin ? model.adminCanvasEnabled === true : model.memberCanvasEnabled === true,
      requiresPersonalCredits: adminText || adminImage ? false : model.requiresPersonalCredits,
      requiresPlatformBudget: adminText || model.requiresPlatformBudget,
      requiresOrganization: adminImage,
      route: adminText ? "/api/admin/ai/test-text" : adminImage ? "/api/admin/ai/test-image" : model.route,
      executionMode: adminText ? "admin_platform_text" : adminImage ? "admin_org_image" : "member",
      pricingStatus: adminText ? "platform_budget" : adminImage ? "organization_credit_estimate" : model.pricingStatus,
      estimatedCredits: adminText ? null : model.estimatedCredits,
      ...(isAdmin && model.id === "@cf/black-forest-labs/flux-2-dev" ? {
        disabledReason: "The Admin Lab exception has no durable replay contract for Canvas image persistence.",
      } : {}),
      ...(isAdmin && model.id === "xai/grok-imagine-image" ? {
        disabledReason: "Canvas does not yet adapt this model's source, mask and multi-image result contract. Use Admin AI Lab.",
      } : {}),
    });
  });
}

export function getCanvasModel(modelId) {
  return CANVAS_MODELS_BY_ID.get(String(modelId || "").trim()) || null;
}

export function getCanvasModelForRole(modelId, role) {
  return listCanvasModelsForRole(role).find((model) => model.id === String(modelId || "").trim()) || null;
}

export function estimateCanvasTextCredits(modelId, input = {}) {
  const model = getCanvasModel(modelId);
  if (!model || model.capability !== "text" || !model.runnable) return null;
  const adminModel = listAdminAiCatalog({ includeCanvas: true }).models.text.find((entry) => entry.id === model.id);
  return textCredits(adminModel || model, input);
}
