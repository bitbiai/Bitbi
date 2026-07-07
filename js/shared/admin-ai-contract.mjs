import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
} from "./remote-media-policy.mjs";
import {
  GPT_IMAGE_2_BACKGROUND_OPTIONS,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
  GPT_IMAGE_2_QUALITY_OPTIONS,
  GPT_IMAGE_2_SIZE_OPTIONS,
} from "./gpt-image-2-pricing.mjs";
import {
  GROK_IMAGINE_IMAGE_ALIASES,
  GROK_IMAGINE_IMAGE_ASPECT_RATIOS,
  GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT,
  GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MODEL_ID,
  GROK_IMAGINE_IMAGE_MODEL_LABEL,
  GROK_IMAGINE_IMAGE_PROVIDER_LABEL,
  GROK_IMAGINE_IMAGE_QUALITIES,
  GROK_IMAGINE_IMAGE_RESOLUTIONS,
  GROK_IMAGINE_IMAGE_RESPONSE_FORMATS,
  GROK_IMAGINE_IMAGE_VENDOR,
  calculateGrokImagineImageCreditPricing,
} from "./grok-imagine-image-pricing.mjs";
import {
  HAPPYHORSE_T2V_DEFAULT_DURATION,
  HAPPYHORSE_T2V_DEFAULT_RATIO,
  HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
  HAPPYHORSE_T2V_DEFAULT_WATERMARK,
  HAPPYHORSE_T2V_MAX_DURATION,
  HAPPYHORSE_T2V_MAX_PROMPT_LENGTH,
  HAPPYHORSE_T2V_MIN_DURATION,
  HAPPYHORSE_T2V_MODEL_ID,
  HAPPYHORSE_T2V_RATIOS,
  HAPPYHORSE_T2V_RESOLUTIONS,
  HAPPYHORSE_T2V_VENDOR,
  HAPPYHORSE_T2V_MODEL_LABEL,
} from "./happyhorse-t2v-pricing.mjs";
import {
  SEEDANCE_2_ASPECT_RATIOS,
  SEEDANCE_2_DEFAULT_ASPECT_RATIO,
  SEEDANCE_2_DEFAULT_DURATION,
  SEEDANCE_2_DEFAULT_RESOLUTION,
  SEEDANCE_2_FAST_RESOLUTIONS,
  SEEDANCE_2_FAST_MODEL_ID,
  SEEDANCE_2_MAX_DURATION,
  SEEDANCE_2_MIN_DURATION,
  SEEDANCE_2_MODEL_ID,
  SEEDANCE_2_RESOLUTIONS,
  calculateSeedance2CreditPricing,
} from "./seedance-2-pricing.mjs";
import {
  GROK_IMAGINE_VIDEO_ASPECT_RATIOS,
  GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_VIDEO_DEFAULT_DURATION,
  GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION,
  GROK_IMAGINE_VIDEO_MAX_DURATION,
  GROK_IMAGINE_VIDEO_MIN_DURATION,
  GROK_IMAGINE_VIDEO_MODEL_ID,
  GROK_IMAGINE_VIDEO_OPERATIONS,
  GROK_IMAGINE_VIDEO_RESOLUTIONS,
  GROK_IMAGINE_VIDEO_SIZES,
  calculateGrokImagineVideoCreditPricing,
} from "./grok-imagine-video-pricing.mjs";
import {
  GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_LABEL,
  GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_SIZES,
  GROK_IMAGINE_VIDEO_15_PREVIEW_VENDOR,
  calculateGrokImagineVideo15PreviewCreditPricing,
} from "./grok-imagine-video-15-preview-pricing.mjs";

export {
  GPT_IMAGE_2_BACKGROUND_OPTIONS,
  GPT_IMAGE_2_MODEL_ID,
  GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
  GPT_IMAGE_2_QUALITY_OPTIONS,
  GPT_IMAGE_2_SIZE_OPTIONS,
} from "./gpt-image-2-pricing.mjs";
export {
  GROK_IMAGINE_IMAGE_ALIASES,
  GROK_IMAGINE_IMAGE_ASPECT_RATIOS,
  GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_DEFAULT_QUALITY,
  GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION,
  GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT,
  GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES,
  GROK_IMAGINE_IMAGE_MODEL_ID,
  GROK_IMAGINE_IMAGE_MODEL_LABEL,
  GROK_IMAGINE_IMAGE_PROVIDER_LABEL,
  GROK_IMAGINE_IMAGE_QUALITIES,
  GROK_IMAGINE_IMAGE_RESOLUTIONS,
  GROK_IMAGINE_IMAGE_RESPONSE_FORMATS,
  GROK_IMAGINE_IMAGE_VENDOR,
} from "./grok-imagine-image-pricing.mjs";
export {
  HAPPYHORSE_T2V_MODEL_ID,
  HAPPYHORSE_T2V_MODEL_LABEL,
  HAPPYHORSE_T2V_RATIOS,
  HAPPYHORSE_T2V_RESOLUTIONS,
} from "./happyhorse-t2v-pricing.mjs";
export {
  GROK_IMAGINE_VIDEO_ASPECT_RATIOS,
  GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_VIDEO_DEFAULT_DURATION,
  GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION,
  GROK_IMAGINE_VIDEO_MAX_DURATION,
  GROK_IMAGINE_VIDEO_MIN_DURATION,
  GROK_IMAGINE_VIDEO_MODEL_ID,
  GROK_IMAGINE_VIDEO_OPERATIONS,
  GROK_IMAGINE_VIDEO_RESOLUTIONS,
  GROK_IMAGINE_VIDEO_SIZES,
} from "./grok-imagine-video-pricing.mjs";
export {
  GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID,
  GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_LABEL,
  GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS,
  GROK_IMAGINE_VIDEO_15_PREVIEW_SIZES,
  GROK_IMAGINE_VIDEO_15_PREVIEW_VENDOR,
} from "./grok-imagine-video-15-preview-pricing.mjs";

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
export const FLUX_2_MAX_MODEL_ID = "black-forest-labs/flux-2-max";
export const FLUX_2_MAX_MIN_DIMENSION = 64;
export const FLUX_2_MAX_MAX_DIMENSION = 2048;
// Cloudflare accepts dimensions >=64px. BITBI caps FLUX.2 Max at 4MP for admin-lab cost safety.
export const FLUX_2_MAX_MAX_PIXELS = FLUX_2_MAX_MAX_DIMENSION * FLUX_2_MAX_MAX_DIMENSION;
export const FLUX_2_MAX_DEFAULT_WIDTH = 1024;
export const FLUX_2_MAX_DEFAULT_HEIGHT = 1024;
export const FLUX_2_MAX_MAX_REFERENCE_IMAGES = 8;
export const FLUX_2_MAX_OUTPUT_FORMAT_OPTIONS = ["jpeg", "png", "webp"];
export const FLUX_2_MAX_DEFAULT_OUTPUT_FORMAT = "jpeg";
export const FLUX_2_MAX_MIN_SAFETY_TOLERANCE = 0;
export const FLUX_2_MAX_MAX_SAFETY_TOLERANCE = 5;
export const FLUX_2_MAX_DEFAULT_SAFETY_TOLERANCE = 2;
export const ADMIN_AI_MUSIC_MODEL_ID = "minimax/music-2.6";
export const CLAUDE_FABLE_5_MODEL_ID = "anthropic/claude-fable-5";
export const ADMIN_AI_VIDEO_MODEL_ID = "pixverse/v6";
export const ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID = "vidu/q3-pro";
export const ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID = HAPPYHORSE_T2V_MODEL_ID;
export const ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID = SEEDANCE_2_FAST_MODEL_ID;
export const ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID = SEEDANCE_2_MODEL_ID;
export const ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID = GROK_IMAGINE_VIDEO_MODEL_ID;
export const ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID = GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID;
export const ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID = GROK_IMAGINE_IMAGE_MODEL_ID;
export const ADMIN_AI_VIDEO_PRICING_REQUIRED_CODE = "model_pricing_required";
export const ADMIN_AI_VIDEO_PRICING_REQUIRED_MESSAGE =
  "Pricing is not configured for this admin Video AI model. Configure verified Cloudflare pricing before generation.";
export const ADMIN_AI_MUSIC_KEYS = [
  "C Major",
  "C# Major",
  "D Major",
  "Eb Major",
  "E Major",
  "F Major",
  "F# Major",
  "G Major",
  "Ab Major",
  "A Major",
  "Bb Major",
  "B Major",
  "C Minor",
  "C# Minor",
  "D Minor",
  "Eb Minor",
  "E Minor",
  "F Minor",
  "F# Minor",
  "G Minor",
  "Ab Minor",
  "A Minor",
  "Bb Minor",
  "B Minor",
];

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
  music: {
    maxPromptLength: 2000,
    maxLyricsLength: 3500,
    minBpm: 40,
    maxBpm: 240,
  },
  video: {
    maxPromptLength: 5000,
    maxNegativePromptLength: 2048,
    minDuration: 1,
    maxDuration: 16,
    allowedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
    allowedQualities: ["360p", "540p", "720p", "1080p"],
    allowedResolutions: ["540p", "720p", "1080p"],
    maxSeed: 2147483647,
    maxImageInputBytes: 10 * 1024 * 1024,
    maxRemoteImageUrlLength: 2048,
    models: {
      [ADMIN_AI_VIDEO_MODEL_ID]: {
        maxPromptLength: 2048,
        maxNegativePromptLength: 2048,
        minDuration: 1,
        maxDuration: 15,
        allowedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
        allowedQualities: ["360p", "540p", "720p", "1080p"],
        defaultDuration: 5,
        defaultAspectRatio: "16:9",
        defaultQuality: "720p",
        defaultGenerateAudio: true,
      },
      [ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID]: {
        maxPromptLength: 5000,
        minDuration: 1,
        maxDuration: 16,
        allowedAspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"],
        allowedResolutions: ["540p", "720p", "1080p"],
        defaultDuration: 5,
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        defaultAudio: true,
      },
      [ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID]: {
        maxPromptLength: HAPPYHORSE_T2V_MAX_PROMPT_LENGTH,
        minDuration: HAPPYHORSE_T2V_MIN_DURATION,
        maxDuration: HAPPYHORSE_T2V_MAX_DURATION,
        allowedAspectRatios: HAPPYHORSE_T2V_RATIOS,
        allowedResolutions: HAPPYHORSE_T2V_RESOLUTIONS,
        defaultDuration: HAPPYHORSE_T2V_DEFAULT_DURATION,
        defaultAspectRatio: HAPPYHORSE_T2V_DEFAULT_RATIO,
        defaultResolution: HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
        defaultWatermark: HAPPYHORSE_T2V_DEFAULT_WATERMARK,
      },
      [ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID]: {
        maxPromptLength: 5000,
        minDuration: SEEDANCE_2_MIN_DURATION,
        maxDuration: SEEDANCE_2_MAX_DURATION,
        allowedAspectRatios: SEEDANCE_2_ASPECT_RATIOS,
        allowedResolutions: SEEDANCE_2_FAST_RESOLUTIONS,
        defaultDuration: SEEDANCE_2_DEFAULT_DURATION,
        defaultAspectRatio: SEEDANCE_2_DEFAULT_ASPECT_RATIO,
        defaultResolution: SEEDANCE_2_DEFAULT_RESOLUTION,
      },
      [ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID]: {
        maxPromptLength: 5000,
        minDuration: SEEDANCE_2_MIN_DURATION,
        maxDuration: SEEDANCE_2_MAX_DURATION,
        allowedAspectRatios: SEEDANCE_2_ASPECT_RATIOS,
        allowedResolutions: SEEDANCE_2_RESOLUTIONS,
        defaultDuration: SEEDANCE_2_DEFAULT_DURATION,
        defaultAspectRatio: SEEDANCE_2_DEFAULT_ASPECT_RATIO,
        defaultResolution: SEEDANCE_2_DEFAULT_RESOLUTION,
      },
      [ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID]: {
        maxPromptLength: 5000,
        minDuration: GROK_IMAGINE_VIDEO_MIN_DURATION,
        maxDuration: GROK_IMAGINE_VIDEO_MAX_DURATION,
        allowedAspectRatios: GROK_IMAGINE_VIDEO_ASPECT_RATIOS,
        allowedResolutions: GROK_IMAGINE_VIDEO_RESOLUTIONS,
        allowedSizes: GROK_IMAGINE_VIDEO_SIZES,
        allowedOperations: GROK_IMAGINE_VIDEO_OPERATIONS,
        defaultDuration: GROK_IMAGINE_VIDEO_DEFAULT_DURATION,
        defaultAspectRatio: GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO,
        defaultResolution: GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION,
      },
      [ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID]: {
        maxPromptLength: 5000,
        minDuration: GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION,
        maxDuration: GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION,
        allowedAspectRatios: GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS,
        allowedResolutions: GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS,
        allowedSizes: GROK_IMAGINE_VIDEO_15_PREVIEW_SIZES,
        allowedOperations: GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS,
        maxReferenceImages: GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES,
        defaultDuration: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION,
        defaultAspectRatio: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO,
        defaultResolution: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION,
      },
    },
  },
};

export const ADMIN_AI_IMAGE_CAPABILITY_FALLBACK = {
  supportsSeed: true,
  supportsSteps: true,
  supportsDimensions: false,
  supportsGuidance: false,
  supportsStructuredPrompt: false,
  supportsReferenceImages: false,
  supportsQuality: false,
  supportsSize: false,
  supportsOutputFormat: false,
  supportsBackground: false,
  supportsTransparentBackground: false,
  supportsSafetyTolerance: false,
  supportsAspectRatio: false,
  supportsResolution: false,
  supportsResponseFormat: false,
  supportsOutputCount: false,
  supportsPrimaryImageInput: false,
  supportsMaskImage: false,
  supportsUserTag: false,
  maxReferenceImages: 0,
  maxSteps: 8,
  defaultSteps: 4,
  minDimension: null,
  maxDimension: null,
  maxPixels: null,
  minGuidance: null,
  maxGuidance: null,
  defaultGuidance: null,
  minSafetyTolerance: null,
  maxSafetyTolerance: null,
  defaultSafetyTolerance: null,
  qualityOptions: [],
  sizeOptions: [],
  outputFormatOptions: [],
  backgroundOptions: [],
  aspectRatioOptions: [],
  resolutionOptions: [],
  responseFormatOptions: [],
  defaultQuality: null,
  defaultSize: null,
  defaultOutputFormat: null,
  defaultBackground: null,
  defaultAspectRatio: null,
  defaultResolution: null,
  defaultResponseFormat: null,
  defaultOutputCount: null,
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

export function isAdminAiVideoSeedanceModelId(modelId) {
  const id = String(modelId || "").trim();
  return id === ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID
    || id === ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID;
}

export function isAdminAiVideoGrokImagineModelId(modelId) {
  const id = String(modelId || "").trim();
  return id === ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID
    || id === ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID;
}

export function isAdminAiVideoGrokImagine15PreviewModelId(modelId) {
  return String(modelId || "").trim() === ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID;
}

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
  [CLAUDE_FABLE_5_MODEL_ID]: {
    id: CLAUDE_FABLE_5_MODEL_ID,
    task: "text",
    type: "text",
    modality: "text",
    label: "Claude Fable 5",
    shortLabel: "Fable 5",
    vendor: "Anthropic",
    provider: "Anthropic",
    family: "Claude",
    inputFormat: "anthropic-messages",
    requestFormat: "anthropic-messages",
    architecture: "Transformer",
    adaptiveThinking: true,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    defaultMaxTokens: 1024,
    maxTokens: 128_000,
    pricingPerMillionTokens: {
      input: 10,
      output: 50,
      cachedInput: 1,
      cacheCreation: 12.5,
      currency: "USD",
    },
    billing: {
      provider: "cloudflare-unified-billing",
      requiresProviderApiKey: false,
      requiresCloudflareAiGatewayCredits: true,
    },
    thirdParty: true,
    costClass: "high",
    adminOnly: true,
    description: "Anthropic text model via Cloudflare AI Gateway Unified Billing with adaptive thinking and a large context window.",
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
  [GPT_IMAGE_2_MODEL_ID]: {
    id: GPT_IMAGE_2_MODEL_ID,
    task: "image",
    label: "GPT Image 2",
    vendor: "OpenAI",
    providerLabel: "OpenAI via Cloudflare AI Gateway",
    inputFormat: "gpt-image-2",
    proxied: true,
    supportsSeed: false,
    supportsSteps: false,
    supportsDimensions: false,
    supportsGuidance: false,
    supportsStructuredPrompt: false,
    supportsReferenceImages: true,
    maxReferenceImages: 16,
    supportsQuality: true,
    supportsSize: true,
    supportsOutputFormat: true,
    supportsBackground: true,
    supportsTransparentBackground: false,
    qualityOptions: GPT_IMAGE_2_QUALITY_OPTIONS,
    sizeOptions: GPT_IMAGE_2_SIZE_OPTIONS,
    outputFormatOptions: GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
    backgroundOptions: GPT_IMAGE_2_BACKGROUND_OPTIONS,
    defaultQuality: "medium",
    defaultSize: "1024x1024",
    defaultOutputFormat: "png",
    defaultBackground: "auto",
    defaultMimeType: "image/png",
    description: "OpenAI image generation and editing via Cloudflare AI Gateway.",
  },
  [ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID]: {
    id: ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID,
    task: "image",
    label: GROK_IMAGINE_IMAGE_MODEL_LABEL,
    vendor: GROK_IMAGINE_IMAGE_VENDOR,
    providerLabel: GROK_IMAGINE_IMAGE_PROVIDER_LABEL,
    inputFormat: "grok-imagine-image",
    proxied: true,
    adminOnly: true,
    pricingRequired: false,
    generationEnabled: true,
    aliases: GROK_IMAGINE_IMAGE_ALIASES,
    supportsSeed: false,
    supportsSteps: false,
    supportsDimensions: false,
    supportsGuidance: false,
    supportsStructuredPrompt: false,
    supportsReferenceImages: true,
    maxReferenceImages: GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES,
    supportsPrimaryImageInput: true,
    supportsMaskImage: true,
    supportsOutputCount: true,
    supportsQuality: true,
    supportsResolution: true,
    supportsAspectRatio: true,
    supportsResponseFormat: true,
    supportsUserTag: true,
    aspectRatioOptions: GROK_IMAGINE_IMAGE_ASPECT_RATIOS,
    qualityOptions: GROK_IMAGINE_IMAGE_QUALITIES,
    resolutionOptions: GROK_IMAGINE_IMAGE_RESOLUTIONS,
    responseFormatOptions: GROK_IMAGINE_IMAGE_RESPONSE_FORMATS,
    defaultAspectRatio: GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO,
    defaultQuality: GROK_IMAGINE_IMAGE_DEFAULT_QUALITY,
    defaultResolution: GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION,
    defaultResponseFormat: GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT,
    defaultOutputCount: GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES,
    minOutputCount: GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES,
    maxOutputCount: GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES,
    defaultMimeType: "image/png",
    description: "Admin-only xAI image generation and image-guided editing via Cloudflare AI Gateway Unified Billing with operator-approved pricing.",
  },
  [FLUX_2_MAX_MODEL_ID]: {
    id: FLUX_2_MAX_MODEL_ID,
    task: "image",
    label: "FLUX.2 Max",
    vendor: "Black Forest Labs",
    providerLabel: "Cloudflare AI Gateway",
    inputFormat: "flux-2-max",
    proxied: true,
    adminOnly: true,
    supportsSeed: true,
    supportsSteps: false,
    supportsDimensions: true,
    supportsGuidance: false,
    supportsStructuredPrompt: false,
    supportsReferenceImages: true,
    maxReferenceImages: FLUX_2_MAX_MAX_REFERENCE_IMAGES,
    minDimension: FLUX_2_MAX_MIN_DIMENSION,
    maxDimension: FLUX_2_MAX_MAX_DIMENSION,
    maxPixels: FLUX_2_MAX_MAX_PIXELS,
    defaultSize: { width: FLUX_2_MAX_DEFAULT_WIDTH, height: FLUX_2_MAX_DEFAULT_HEIGHT },
    supportsOutputFormat: true,
    outputFormatOptions: FLUX_2_MAX_OUTPUT_FORMAT_OPTIONS,
    defaultOutputFormat: FLUX_2_MAX_DEFAULT_OUTPUT_FORMAT,
    supportsSafetyTolerance: true,
    minSafetyTolerance: FLUX_2_MAX_MIN_SAFETY_TOLERANCE,
    maxSafetyTolerance: FLUX_2_MAX_MAX_SAFETY_TOLERANCE,
    defaultSafetyTolerance: FLUX_2_MAX_DEFAULT_SAFETY_TOLERANCE,
    defaultMimeType: "image/jpeg",
    description: "Admin-only FLUX.2 Max image generation and editing via Cloudflare AI Gateway.",
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

const MUSIC_MODELS = {
  [ADMIN_AI_MUSIC_MODEL_ID]: {
    id: ADMIN_AI_MUSIC_MODEL_ID,
    task: "music",
    label: "Music 2.6",
    vendor: "MiniMax",
    inputFormat: "json",
    proxied: true,
    supportsInstrumental: true,
    supportsLyricsOptimizer: true,
    description: "Prompt-driven music generation with vocal, instrumental, and auto-lyrics support.",
  },
};

const VIDEO_MODELS = {
  [ADMIN_AI_VIDEO_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_MODEL_ID,
    task: "video",
    label: "Pixverse V6",
    vendor: "Pixverse",
    inputFormat: "json",
    proxied: true,
    supportsImageInput: true,
    supportsEndImage: false,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsAudioToggle: true,
    supportsPromptlessImageMode: false,
    resolutionField: "quality",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].maxPromptLength,
    maxNegativePromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].maxNegativePromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].allowedAspectRatios,
    allowedQualities: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_MODEL_ID].allowedQualities,
    defaultDuration: 5,
    defaultAspectRatio: "16:9",
    defaultQuality: "720p",
    defaultGenerateAudio: true,
    defaultPreset: "video_studio",
    description: "Text-to-video and image-to-video generation with configurable duration, quality, and aspect ratio.",
  },
  [ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
    task: "video",
    label: "Vidu Q3 Pro",
    vendor: "Vidu",
    inputFormat: "json",
    proxied: true,
    supportsImageInput: true,
    supportsEndImage: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudioToggle: true,
    supportsPromptlessImageMode: true,
    resolutionField: "resolution",
    aspectRatioMode: "text_only",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID].allowedResolutions,
    defaultDuration: 5,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultGenerateAudio: true,
    defaultPreset: "video_vidu_q3_pro",
    description: "Text-to-video, image-to-video, and start/end-frame-to-video generation with duration, resolution, and audio controls.",
  },
  [ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID,
    task: "video",
    label: HAPPYHORSE_T2V_MODEL_LABEL,
    vendor: HAPPYHORSE_T2V_VENDOR,
    inputFormat: "json",
    proxied: true,
    supportsImageInput: false,
    supportsEndImage: false,
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsAudioToggle: false,
    supportsWatermark: true,
    supportsPromptlessImageMode: false,
    resolutionField: "resolution",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID].allowedResolutions,
    defaultDuration: HAPPYHORSE_T2V_DEFAULT_DURATION,
    defaultAspectRatio: HAPPYHORSE_T2V_DEFAULT_RATIO,
    defaultResolution: HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
    defaultGenerateAudio: HAPPYHORSE_T2V_DEFAULT_WATERMARK,
    defaultWatermark: HAPPYHORSE_T2V_DEFAULT_WATERMARK,
    defaultPreset: "video_happyhorse_1_0_t2v",
    description: "Admin-only Cloudflare Workers AI text-to-video generation with prompt, resolution, ratio, duration, seed, and watermark controls.",
  },
  [ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID,
    task: "video",
    label: "Seedance 2.0 Fast",
    vendor: "ByteDance",
    providerLabel: "Cloudflare AI Gateway",
    inputFormat: "json",
    proxied: true,
    adminOnly: true,
    pricingRequired: false,
    costDiscoveryEnabled: false,
    costDiscoveryFlag: null,
    generationEnabled: true,
    unavailableCode: null,
    unavailableMessage: null,
    supportsImageInput: false,
    supportsEndImage: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudioToggle: false,
    supportsWatermark: false,
    supportsPromptlessImageMode: false,
    resolutionField: "resolution",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID].allowedResolutions,
    defaultDuration: SEEDANCE_2_DEFAULT_DURATION,
    defaultAspectRatio: SEEDANCE_2_DEFAULT_ASPECT_RATIO,
    defaultResolution: SEEDANCE_2_DEFAULT_RESOLUTION,
    defaultGenerateAudio: false,
    defaultPreset: "video_seedance_2_fast",
    description: "Admin-only Cloudflare/AI Gateway Seedance 2.0 Fast video generation with operator-approved pricing.",
  },
  [ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID,
    task: "video",
    label: "Seedance 2.0",
    vendor: "ByteDance",
    providerLabel: "Cloudflare AI Gateway",
    inputFormat: "json",
    proxied: true,
    adminOnly: true,
    pricingRequired: false,
    costDiscoveryEnabled: false,
    costDiscoveryFlag: null,
    generationEnabled: true,
    unavailableCode: null,
    unavailableMessage: null,
    supportsImageInput: false,
    supportsEndImage: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudioToggle: false,
    supportsWatermark: false,
    supportsPromptlessImageMode: false,
    resolutionField: "resolution",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID].allowedResolutions,
    defaultDuration: SEEDANCE_2_DEFAULT_DURATION,
    defaultAspectRatio: SEEDANCE_2_DEFAULT_ASPECT_RATIO,
    defaultResolution: SEEDANCE_2_DEFAULT_RESOLUTION,
    defaultGenerateAudio: false,
    defaultPreset: "video_seedance_2",
    description: "Admin-only Cloudflare/AI Gateway Seedance 2.0 video generation with operator-approved pricing.",
  },
  [ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID,
    task: "video",
    label: "Grok Imagine Video",
    vendor: "xAI",
    providerLabel: "Cloudflare AI Gateway",
    inputFormat: "grok-imagine-video",
    proxied: true,
    adminOnly: true,
    pricingRequired: false,
    costDiscoveryEnabled: false,
    costDiscoveryFlag: null,
    generationEnabled: true,
    unavailableCode: null,
    unavailableMessage: null,
    supportedOperations: ["generate"],
    supportsImageInput: false,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsEndImage: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudioToggle: false,
    supportsWatermark: false,
    supportsPromptlessImageMode: false,
    resolutionField: "resolution",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].allowedResolutions,
    allowedSizes: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID].allowedSizes,
    defaultDuration: GROK_IMAGINE_VIDEO_DEFAULT_DURATION,
    defaultAspectRatio: GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO,
    defaultResolution: GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION,
    defaultGenerateAudio: false,
    defaultPreset: "video_grok_imagine",
    description: "Admin-only xAI Grok Imagine Video via Cloudflare AI Gateway Unified Billing and platform admin lab budget controls.",
  },
  [ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID]: {
    id: ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
    task: "video",
    label: GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_LABEL,
    vendor: GROK_IMAGINE_VIDEO_15_PREVIEW_VENDOR,
    providerLabel: "Cloudflare AI Gateway",
    inputFormat: "grok-imagine-video-1.5-preview",
    proxied: true,
    adminOnly: true,
    pricingRequired: false,
    costDiscoveryEnabled: false,
    costDiscoveryFlag: null,
    generationEnabled: true,
    unavailableCode: null,
    unavailableMessage: null,
    supportedOperations: GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS,
    supportsImageInput: true,
    supportsVideoInput: true,
    supportsReferenceImages: true,
    maxReferenceImages: GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES,
    supportsOutputUploadUrl: true,
    supportsSize: true,
    supportsEndImage: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudioToggle: false,
    supportsWatermark: false,
    supportsPromptlessImageMode: false,
    resolutionField: "resolution",
    aspectRatioMode: "always",
    maxPromptLength: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].maxPromptLength,
    minDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].minDuration,
    maxDuration: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].maxDuration,
    allowedAspectRatios: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].allowedAspectRatios,
    allowedResolutions: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].allowedResolutions,
    allowedSizes: ADMIN_AI_LIMITS.video.models[ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID].allowedSizes,
    defaultDuration: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION,
    defaultAspectRatio: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO,
    defaultResolution: GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION,
    defaultGenerateAudio: false,
    defaultPreset: "video_grok_imagine_15_preview",
    description: "Admin-only xAI Grok Imagine Video 1.5 Preview via Cloudflare AI Gateway Unified Billing with generate, edit, and extend operations.",
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
  image_grok_imagine: {
    name: "image_grok_imagine",
    task: "image",
    label: GROK_IMAGINE_IMAGE_MODEL_LABEL,
    model: ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID,
    description: "Admin-only Grok Imagine Image preset through Cloudflare AI Gateway Unified Billing.",
  },
  embedding_default: {
    name: "embedding_default",
    task: "embeddings",
    label: "Default Embeddings",
    model: "@cf/baai/bge-m3",
    description: "Default multilingual embeddings preset.",
  },
  music_studio: {
    name: "music_studio",
    task: "music",
    label: "Music Studio",
    model: ADMIN_AI_MUSIC_MODEL_ID,
    description: "MiniMax Music 2.6 preset for admin-only studio generation.",
  },
  video_studio: {
    name: "video_studio",
    task: "video",
    label: "Video Studio",
    model: ADMIN_AI_VIDEO_MODEL_ID,
    description: "Pixverse V6 preset for admin-only video generation.",
  },
  video_vidu_q3_pro: {
    name: "video_vidu_q3_pro",
    task: "video",
    label: "Vidu Q3 Pro",
    model: ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
    description: "Vidu Q3 Pro preset for admin-only video generation.",
  },
  video_happyhorse_1_0_t2v: {
    name: "video_happyhorse_1_0_t2v",
    task: "video",
    label: HAPPYHORSE_T2V_MODEL_LABEL,
    model: ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID,
    description: "HappyHorse 1.0 T2V preset for admin-only Cloudflare Workers AI generation.",
  },
  video_seedance_2_fast: {
    name: "video_seedance_2_fast",
    task: "video",
    label: "Seedance 2.0 Fast",
    model: ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID,
    description: "Admin-only Seedance 2.0 Fast preset with operator-approved video pricing.",
  },
  video_seedance_2: {
    name: "video_seedance_2",
    task: "video",
    label: "Seedance 2.0",
    model: ADMIN_AI_VIDEO_SEEDANCE_2_MODEL_ID,
    description: "Admin-only Seedance 2.0 preset with operator-approved video pricing.",
  },
  video_grok_imagine: {
    name: "video_grok_imagine",
    task: "video",
    label: "Grok Imagine Video",
    model: ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID,
    description: "Admin-only xAI Grok Imagine Video preset through Cloudflare AI Gateway Unified Billing.",
  },
  video_grok_imagine_15_preview: {
    name: "video_grok_imagine_15_preview",
    task: "video",
    label: GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_LABEL,
    model: ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID,
    description: "Admin-only Grok Imagine Video 1.5 Preview preset through Cloudflare AI Gateway Unified Billing.",
  },
};

export const ADMIN_AI_DEFAULT_PRESETS = {
  text: "balanced",
  image: "image_fast",
  embeddings: "embedding_default",
  music: "music_studio",
  video: "video_studio",
};

export const ADMIN_AI_DEFAULT_COMPARE_MODELS = {
  modelA: "@cf/meta/llama-3.1-8b-instruct-fast",
  modelB: "@cf/openai/gpt-oss-20b",
};

const REGISTRY = {
  text: TEXT_MODELS,
  image: IMAGE_MODELS,
  embeddings: EMBEDDING_MODELS,
  music: MUSIC_MODELS,
  video: VIDEO_MODELS,
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

function optionalBoolean(value, field, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value !== "boolean") {
    throw new AdminAiValidationError(`${field} must be a boolean.`, 400, "validation_error");
  }
  return value;
}

function optionalEnum(value, field, allowed, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }
  const trimmed = value.trim();
  if (!trimmed) return defaultValue;
  if (!allowed.includes(trimmed)) {
    throw new AdminAiValidationError(
      `${field} must be one of ${allowed.join(", ")}.`,
      400,
      "validation_error"
    );
  }
  return trimmed;
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

function optionalBoundedDimension(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return optionalInteger(value, field, min, max, defaultValue);
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

function validateReferenceImages(value, {
  maxItems = ADMIN_AI_LIMITS.image.maxReferenceImages,
  allowedMimeTypes = null,
} = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AdminAiValidationError("referenceImages must be an array.", 400, "validation_error");
  }
  if (value.length > maxItems) {
    throw new AdminAiValidationError(
      `referenceImages must contain at most ${maxItems} items.`,
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
    const meta = item.slice(0, commaIndex);
    const mimeMatch = meta.match(/^data:([^;,]+)(?:;base64)?$/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : "";
    if (allowedMimeTypes && !allowedMimeTypes.includes(mimeType)) {
      throw new AdminAiValidationError(
        `referenceImages[${index}] must be a PNG, JPEG, or WebP data URI.`,
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

function assertOnlyAllowedFields(input, allowedFields, modelId) {
  const extras = Object.keys(input).filter((key) => !allowedFields.includes(key));
  if (extras.length === 0) return;

  const [field] = extras;
  throw new AdminAiValidationError(
    modelId
      ? `${field} is not supported by model "${modelId}".`
      : `${field} is not supported.`,
    400,
    "validation_error"
  );
}

function optionalVideoImageReference(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:image/")) {
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex === -1) {
      throw new AdminAiValidationError(`${field} is not a valid data URI.`, 400, "validation_error");
    }
    const base64 = trimmed.slice(commaIndex + 1);
    const estimatedBytes = Math.ceil(base64.length * 0.75);
    if (estimatedBytes > ADMIN_AI_LIMITS.video.maxImageInputBytes) {
      throw new AdminAiValidationError(
        `${field} exceeds the ${ADMIN_AI_LIMITS.video.maxImageInputBytes} byte size limit.`,
        400,
        "validation_error"
      );
    }
    return trimmed;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    throw attachRemoteMediaPolicyContext(
      new AdminAiValidationError(
        buildRemoteMediaUrlRejectedMessage(
          field,
          "Upload the source frame as a data URI image instead."
        ),
        400,
        REMOTE_MEDIA_URL_POLICY_CODE
      ),
      trimmed,
      {
        field,
        reason: "remote_video_input_url_rejected",
      }
    );
  }

  throw new AdminAiValidationError(
    `${field} must be a data URI image.`,
    400,
    "validation_error"
  );
}

function normalizeAdminAiPreviewHttpsUrl(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminAiValidationError(`${field} must be a URL string.`, 400, "validation_error");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > ADMIN_AI_LIMITS.video.maxRemoteImageUrlLength) {
    throw new AdminAiValidationError(
      `${field} must be at most ${ADMIN_AI_LIMITS.video.maxRemoteImageUrlLength} characters.`,
      400,
      "validation_error"
    );
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AdminAiValidationError(`${field} must be a valid https URL.`, 400, "validation_error");
  }
  if (parsed.protocol !== "https:") {
    throw new AdminAiValidationError(`${field} must use https.`, 400, "validation_error");
  }
  if (parsed.username || parsed.password) {
    throw new AdminAiValidationError(`${field} must not include credentials.`, 400, "validation_error");
  }
  parsed.hash = "";
  return parsed.toString();
}

function optionalGrokPreviewUrlObject(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const url = normalizeAdminAiPreviewHttpsUrl(value, field);
    return url ? { url } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an object with a url string.`, 400, "validation_error");
  }
  const url = normalizeAdminAiPreviewHttpsUrl(value.url, `${field}.url`);
  return url ? { url } : null;
}

function optionalGrokPreviewOutputObject(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const uploadUrl = normalizeAdminAiPreviewHttpsUrl(value, field);
    return uploadUrl ? { upload_url: uploadUrl } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an object with an upload_url string.`, 400, "validation_error");
  }
  const uploadUrl = normalizeAdminAiPreviewHttpsUrl(value.upload_url, `${field}.upload_url`);
  return uploadUrl ? { upload_url: uploadUrl } : null;
}

function optionalGrokPreviewReferenceImages(value, field, maxItems) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an array.`, 400, "validation_error");
  }
  if (value.length > maxItems) {
    throw new AdminAiValidationError(
      `${field} must contain at most ${maxItems} items.`,
      400,
      "validation_error"
    );
  }
  return value.map((entry, index) => {
    const normalized = optionalGrokPreviewUrlObject(entry, `${field}[${index}]`);
    if (!normalized) {
      throw new AdminAiValidationError(
        `${field}[${index}].url is required.`,
        400,
        "validation_error"
      );
    }
    return normalized;
  });
}

function normalizeGrokPreviewSourceVideo(value, field = "source_video") {
  if (value === undefined || value === null || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an object.`, 400, "validation_error");
  }
  const sourceType = typeof value.source_type === "string"
    ? value.source_type.trim()
    : typeof value.sourceType === "string"
      ? value.sourceType.trim()
      : "";
  if (!["saved_asset", "memvid"].includes(sourceType)) {
    throw new AdminAiValidationError(
      `${field}.source_type must be saved_asset or memvid.`,
      400,
      "validation_error"
    );
  }
  const assetId = typeof value.asset_id === "string"
    ? value.asset_id.trim()
    : typeof value.assetId === "string"
      ? value.assetId.trim()
      : "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) {
    throw new AdminAiValidationError(
      `${field}.asset_id is invalid.`,
      400,
      "validation_error"
    );
  }
  return {
    source_type: sourceType,
    asset_id: assetId,
  };
}

function normalizeGrokPreviewSourceImage(value, field = "source_image") {
  if (value === undefined || value === null || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an object.`, 400, "validation_error");
  }
  const sourceType = typeof value.source_type === "string"
    ? value.source_type.trim()
    : typeof value.sourceType === "string"
      ? value.sourceType.trim()
      : "";
  if (!["saved_asset", "mempic"].includes(sourceType)) {
    throw new AdminAiValidationError(
      `${field}.source_type must be saved_asset or mempic.`,
      400,
      "validation_error"
    );
  }
  const assetId = typeof value.asset_id === "string"
    ? value.asset_id.trim()
    : typeof value.assetId === "string"
      ? value.assetId.trim()
      : "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) {
    throw new AdminAiValidationError(
      `${field}.asset_id is invalid.`,
      400,
      "validation_error"
    );
  }
  return {
    source_type: sourceType,
    asset_id: assetId,
  };
}

function normalizeGrokImageUrlObject(value, field) {
  const object = optionalGrokPreviewUrlObject(value, field);
  if (!object) return null;
  const type = optionalString(value?.type, `${field}.type`, 80);
  return type ? { ...object, type } : object;
}

function normalizeGrokImageUrlObjectArray(value, field, maxItems) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an array.`, 400, "validation_error");
  }
  if (value.length > maxItems) {
    throw new AdminAiValidationError(
      `${field} must contain at most ${maxItems} items.`,
      400,
      "validation_error"
    );
  }
  return value.map((entry, index) => {
    const normalized = normalizeGrokImageUrlObject(entry, `${field}[${index}]`);
    if (!normalized) {
      throw new AdminAiValidationError(
        `${field}[${index}].url is required.`,
        400,
        "validation_error"
      );
    }
    return normalized;
  });
}

function normalizeGrokPreviewSourceImageArray(value, field = "source_images", maxItems = 10) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw new AdminAiValidationError(`${field} must be an array.`, 400, "validation_error");
  }
  if (value.length > maxItems) {
    throw new AdminAiValidationError(
      `${field} must contain at most ${maxItems} items.`,
      400,
      "validation_error"
    );
  }
  return value.map((entry, index) => normalizeGrokPreviewSourceImage(entry, `${field}[${index}]`));
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function getAdminAiVideoModelSpec(modelId = ADMIN_AI_VIDEO_MODEL_ID) {
  return VIDEO_MODELS[modelId] || VIDEO_MODELS[ADMIN_AI_VIDEO_MODEL_ID];
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
    providerLabel: model.providerLabel || model.vendor,
    description: model.description,
  };
  if (model.task === "text") {
    pub.type = model.type || "text";
    pub.modality = model.modality || "text";
    pub.shortLabel = model.shortLabel || model.label;
    pub.provider = model.provider || model.vendor;
    pub.family = model.family || null;
    pub.requestFormat = model.requestFormat || model.inputFormat || "messages";
    pub.architecture = model.architecture || null;
    pub.adaptiveThinking = model.adaptiveThinking === true;
    pub.contextWindowTokens = model.contextWindowTokens || null;
    pub.maxOutputTokens = model.maxOutputTokens || model.maxTokens || null;
    pub.defaultMaxTokens = model.defaultMaxTokens || ADMIN_AI_LIMITS.text.defaultMaxTokens;
    pub.pricingPerMillionTokens = model.pricingPerMillionTokens
      ? { ...model.pricingPerMillionTokens }
      : null;
    pub.billing = model.billing ? { ...model.billing } : null;
    pub.thirdParty = model.thirdParty === true;
    pub.costClass = model.costClass || null;
    pub.adminOnly = model.adminOnly === true;
  }
  if (model.task === "image") {
    pub.capabilities = {
      supportsSeed: !!model.supportsSeed,
      supportsSteps: !!model.supportsSteps,
      supportsDimensions: !!model.supportsDimensions,
      supportsGuidance: !!model.supportsGuidance,
      supportsStructuredPrompt: !!model.supportsStructuredPrompt,
      supportsReferenceImages: !!model.supportsReferenceImages,
      supportsQuality: !!model.supportsQuality,
      supportsSize: !!model.supportsSize,
      supportsOutputFormat: !!model.supportsOutputFormat,
      supportsBackground: !!model.supportsBackground,
      supportsTransparentBackground: !!model.supportsTransparentBackground,
      supportsSafetyTolerance: !!model.supportsSafetyTolerance,
      supportsAspectRatio: !!model.supportsAspectRatio,
      supportsResolution: !!model.supportsResolution,
      supportsResponseFormat: !!model.supportsResponseFormat,
      supportsOutputCount: !!model.supportsOutputCount,
      supportsPrimaryImageInput: !!model.supportsPrimaryImageInput,
      supportsMaskImage: !!model.supportsMaskImage,
      supportsUserTag: !!model.supportsUserTag,
      maxReferenceImages: model.maxReferenceImages || 0,
      minOutputCount: model.minOutputCount ?? null,
      maxOutputCount: model.maxOutputCount ?? null,
      maxSteps: model.maxSteps || null,
      defaultSteps: model.defaultSteps || null,
      minDimension: model.minDimension || null,
      maxDimension: model.maxDimension || null,
      maxPixels: model.maxPixels || null,
      minGuidance: model.minGuidance || null,
      maxGuidance: model.maxGuidance || null,
      defaultGuidance: model.defaultGuidance || null,
      minSafetyTolerance: model.minSafetyTolerance ?? null,
      maxSafetyTolerance: model.maxSafetyTolerance ?? null,
      defaultSafetyTolerance: model.defaultSafetyTolerance ?? null,
      qualityOptions: Array.isArray(model.qualityOptions) ? [...model.qualityOptions] : [],
      sizeOptions: Array.isArray(model.sizeOptions) ? [...model.sizeOptions] : [],
      outputFormatOptions: Array.isArray(model.outputFormatOptions) ? [...model.outputFormatOptions] : [],
      backgroundOptions: Array.isArray(model.backgroundOptions) ? [...model.backgroundOptions] : [],
      aspectRatioOptions: Array.isArray(model.aspectRatioOptions) ? [...model.aspectRatioOptions] : [],
      resolutionOptions: Array.isArray(model.resolutionOptions) ? [...model.resolutionOptions] : [],
      responseFormatOptions: Array.isArray(model.responseFormatOptions) ? [...model.responseFormatOptions] : [],
      defaultQuality: model.defaultQuality || null,
      defaultSize: model.defaultSize || null,
      defaultOutputFormat: model.defaultOutputFormat || null,
      defaultBackground: model.defaultBackground || null,
      defaultAspectRatio: model.defaultAspectRatio || null,
      defaultResolution: model.defaultResolution || null,
      defaultResponseFormat: model.defaultResponseFormat || null,
      defaultOutputCount: model.defaultOutputCount ?? null,
      proxied: !!model.proxied,
      adminOnly: model.adminOnly === true,
      generationEnabled: model.generationEnabled !== false,
    };
  }
  if (model.task === "video") {
    pub.capabilities = {
      supportsImageInput: !!model.supportsImageInput,
      supportsVideoInput: !!model.supportsVideoInput,
      supportsReferenceImages: !!model.supportsReferenceImages,
      maxReferenceImages: model.maxReferenceImages || 0,
      supportsOutputUploadUrl: !!model.supportsOutputUploadUrl,
      supportsSize: !!model.supportsSize,
      supportsEndImage: !!model.supportsEndImage,
      supportsNegativePrompt: !!model.supportsNegativePrompt,
      supportsSeed: !!model.supportsSeed,
      supportsAudioToggle: !!model.supportsAudioToggle,
      supportsWatermark: !!model.supportsWatermark,
      supportsPromptlessImageMode: !!model.supportsPromptlessImageMode,
      resolutionField: model.resolutionField || "quality",
      aspectRatioMode: model.aspectRatioMode || "always",
      maxPromptLength: model.maxPromptLength || ADMIN_AI_LIMITS.video.maxPromptLength,
      maxNegativePromptLength: model.maxNegativePromptLength || null,
      minDuration: model.minDuration || 1,
      maxDuration: model.maxDuration || 16,
      aspectRatios: Array.isArray(model.allowedAspectRatios) ? [...model.allowedAspectRatios] : [],
      qualityOptions: Array.isArray(model.allowedQualities) ? [...model.allowedQualities] : [],
      resolutionOptions: Array.isArray(model.allowedResolutions) ? [...model.allowedResolutions] : [],
      sizeOptions: Array.isArray(model.allowedSizes) ? [...model.allowedSizes] : [],
      supportedOperations: Array.isArray(model.supportedOperations) ? [...model.supportedOperations] : [],
      defaultDuration: model.defaultDuration || 5,
      defaultAspectRatio: model.defaultAspectRatio || "16:9",
      defaultQuality: model.defaultQuality || "720p",
      defaultResolution: model.defaultResolution || null,
      defaultGenerateAudio: model.defaultGenerateAudio !== false,
      defaultWatermark: model.defaultWatermark === true,
      defaultPreset: model.defaultPreset || null,
      adminOnly: model.adminOnly === true,
      pricingRequired: model.pricingRequired === true,
      costDiscoveryEnabled: model.costDiscoveryEnabled === true,
      costDiscoveryFlag: model.costDiscoveryFlag || null,
      generationEnabled: model.generationEnabled !== false,
      unavailableCode: model.unavailableCode || null,
      unavailableMessage: model.unavailableMessage || null,
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
      music: Object.values(MUSIC_MODELS).map(toPublicModel),
      video: Object.values(VIDEO_MODELS).map(toPublicModel),
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

export function validateAdminAiImageBody(body, options = {}) {
  const input = ensureObject(body);
  const allowResolvedGrokImageMediaUrls = options?.allowResolvedGrokImageMediaUrls === true;
  const preset = optionalString(input.preset, "preset", 64);
  const model = optionalString(input.model, "model", 120);
  const selection = resolveAdminAiModelSelection("image", { preset, model });
  const selectedModel = selection.model;

  if (selectedModel.id === ADMIN_AI_IMAGE_GROK_IMAGINE_MODEL_ID) {
    const commonFields = [
      "preset",
      "model",
      "prompt",
      "aspect_ratio",
      "aspectRatio",
      "quality",
      "resolution",
      "response_format",
      "responseFormat",
      "n",
      "user",
    ];
    assertOnlyAllowedFields(
      input,
      allowResolvedGrokImageMediaUrls
        ? commonFields.concat(["image", "images", "mask"])
        : commonFields.concat([
            "source_image",
            "sourceImage",
            "source_images",
            "sourceImages",
            "source_mask",
            "sourceMask",
            "organization_id",
            "organizationId",
          ]),
      selectedModel.id
    );

    const prompt = requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.image.maxPromptLength);
    const aspect_ratio = optionalEnum(
      input.aspect_ratio ?? input.aspectRatio,
      "aspect_ratio",
      GROK_IMAGINE_IMAGE_ASPECT_RATIOS,
      GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO
    );
    const quality = optionalEnum(
      input.quality,
      "quality",
      GROK_IMAGINE_IMAGE_QUALITIES,
      GROK_IMAGINE_IMAGE_DEFAULT_QUALITY
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      GROK_IMAGINE_IMAGE_RESOLUTIONS,
      GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION
    );
    const response_format = optionalEnum(
      input.response_format ?? input.responseFormat,
      "response_format",
      GROK_IMAGINE_IMAGE_RESPONSE_FORMATS,
      GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT
    );
    const n = optionalInteger(
      input.n,
      "n",
      GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES,
      GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES,
      GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES
    );
    const user = optionalString(input.user, "user", 120);

    const image = allowResolvedGrokImageMediaUrls
      ? normalizeGrokImageUrlObject(input.image, "image")
      : null;
    const images = allowResolvedGrokImageMediaUrls
      ? normalizeGrokImageUrlObjectArray(input.images, "images", GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES)
      : [];
    const mask = allowResolvedGrokImageMediaUrls
      ? normalizeGrokImageUrlObject(input.mask, "mask")
      : null;
    const source_image = !allowResolvedGrokImageMediaUrls
      ? normalizeGrokPreviewSourceImage(
          firstNonEmptyValue(input.source_image, input.sourceImage),
          "source_image"
        )
      : null;
    const source_images = !allowResolvedGrokImageMediaUrls
      ? normalizeGrokPreviewSourceImageArray(
          firstNonEmptyValue(input.source_images, input.sourceImages),
          "source_images",
          GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES
        )
      : [];
    const source_mask = !allowResolvedGrokImageMediaUrls
      ? normalizeGrokPreviewSourceImage(
          firstNonEmptyValue(input.source_mask, input.sourceMask),
          "source_mask"
        )
      : null;

    try {
      calculateGrokImagineImageCreditPricing({
        n,
        aspect_ratio,
        quality,
        resolution,
        response_format,
        ...(allowResolvedGrokImageMediaUrls
          ? { image, images, mask }
          : { source_image, source_images, source_mask }),
      });
    } catch {
      throw new AdminAiValidationError(
        "Pricing is not configured for this admin Image AI model.",
        409,
        "model_pricing_required"
      );
    }

    const validated = {
      preset,
      model,
      prompt,
      aspect_ratio,
      quality,
      resolution,
      response_format,
      n,
    };
    if (user) validated.user = user;
    if (allowResolvedGrokImageMediaUrls) {
      if (image) validated.image = image;
      if (images.length > 0) validated.images = images;
      if (mask) validated.mask = mask;
    } else {
      if (source_image) validated.source_image = source_image;
      if (source_images.length > 0) validated.source_images = source_images;
      if (source_mask) validated.source_mask = source_mask;
    }
    return validated;
  }

  if (selectedModel.id === GPT_IMAGE_2_MODEL_ID) {
    if (typeof input.background === "string" && input.background.trim() === "transparent") {
      throw new AdminAiValidationError(
        "Transparent background is not supported by GPT Image 2.",
        400,
        "validation_error"
      );
    }
    const outputFormatValue =
      input.outputFormat === undefined || input.outputFormat === null || input.outputFormat === ""
        ? input.output_format
        : input.outputFormat;

    return {
      preset,
      model,
      prompt: requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.image.maxPromptLength),
      quality: optionalEnum(input.quality, "quality", GPT_IMAGE_2_QUALITY_OPTIONS, selectedModel.defaultQuality),
      size: optionalEnum(input.size, "size", GPT_IMAGE_2_SIZE_OPTIONS, selectedModel.defaultSize),
      outputFormat: optionalEnum(
        outputFormatValue,
        "outputFormat",
        GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
        selectedModel.defaultOutputFormat
      ),
      background: optionalEnum(
        input.background,
        "background",
        GPT_IMAGE_2_BACKGROUND_OPTIONS,
        selectedModel.defaultBackground
      ),
      referenceImages: validateReferenceImages(input.referenceImages, {
        maxItems: selectedModel.maxReferenceImages,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      }),
    };
  }

  if (selectedModel.id === FLUX_2_MAX_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "width",
        "height",
        "seed",
        "outputFormat",
        "output_format",
        "safetyTolerance",
        "safety_tolerance",
        "referenceImages",
        "organization_id",
      ],
      selectedModel.id
    );
    const hasWidth = input.width !== undefined && input.width !== null && input.width !== "";
    const hasHeight = input.height !== undefined && input.height !== null && input.height !== "";
    if (hasWidth !== hasHeight) {
      throw new AdminAiValidationError(
        "width and height must be provided together.",
        400,
        "validation_error"
      );
    }
    const width = optionalBoundedDimension(
      input.width,
      "width",
      FLUX_2_MAX_MIN_DIMENSION,
      FLUX_2_MAX_MAX_DIMENSION,
      FLUX_2_MAX_DEFAULT_WIDTH
    );
    const height = optionalBoundedDimension(
      input.height,
      "height",
      FLUX_2_MAX_MIN_DIMENSION,
      FLUX_2_MAX_MAX_DIMENSION,
      FLUX_2_MAX_DEFAULT_HEIGHT
    );
    if (width * height > FLUX_2_MAX_MAX_PIXELS) {
      throw new AdminAiValidationError(
        `Image dimensions exceed the ${FLUX_2_MAX_MAX_PIXELS} pixel safety cap.`,
        400,
        "validation_error"
      );
    }
    const outputFormatValue =
      input.outputFormat === undefined || input.outputFormat === null || input.outputFormat === ""
        ? input.output_format
        : input.outputFormat;
    const safetyToleranceValue =
      input.safetyTolerance === undefined || input.safetyTolerance === null || input.safetyTolerance === ""
        ? input.safety_tolerance
        : input.safetyTolerance;

    return {
      preset,
      model,
      prompt: requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.image.maxPromptLength),
      width,
      height,
      seed: optionalInteger(input.seed, "seed", 0, ADMIN_AI_LIMITS.image.maxSeed, null),
      outputFormat: optionalEnum(
        outputFormatValue,
        "outputFormat",
        FLUX_2_MAX_OUTPUT_FORMAT_OPTIONS,
        FLUX_2_MAX_DEFAULT_OUTPUT_FORMAT
      ),
      safetyTolerance: optionalInteger(
        safetyToleranceValue,
        "safetyTolerance",
        FLUX_2_MAX_MIN_SAFETY_TOLERANCE,
        FLUX_2_MAX_MAX_SAFETY_TOLERANCE,
        FLUX_2_MAX_DEFAULT_SAFETY_TOLERANCE
      ),
      referenceImages: validateReferenceImages(input.referenceImages, {
        maxItems: FLUX_2_MAX_MAX_REFERENCE_IMAGES,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      }),
    };
  }

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
  const referenceImages = validateReferenceImages(input.referenceImages, {
    maxItems: selectedModel.maxReferenceImages || ADMIN_AI_LIMITS.image.maxReferenceImages,
  });

  return {
    preset,
    model,
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

export function validateAdminAiMusicBody(body) {
  const input = ensureObject(body);
  const mode = optionalEnum(input.mode, "mode", ["vocals", "instrumental"], "vocals");
  const lyricsMode = optionalEnum(input.lyricsMode, "lyricsMode", ["custom", "auto"], "custom");
  const prompt = requiredString(input.prompt, "prompt", ADMIN_AI_LIMITS.music.maxPromptLength);
  const lyrics = optionalString(input.lyrics, "lyrics", ADMIN_AI_LIMITS.music.maxLyricsLength);
  const bpm = optionalInteger(
    input.bpm,
    "bpm",
    ADMIN_AI_LIMITS.music.minBpm,
    ADMIN_AI_LIMITS.music.maxBpm,
    null
  );
  const key = optionalEnum(input.key, "key", ADMIN_AI_MUSIC_KEYS, null);

  if (mode === "vocals" && lyricsMode === "custom" && !lyrics) {
    throw new AdminAiValidationError(
      "lyrics are required when using custom lyrics mode.",
      400,
      "validation_error"
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt,
    mode,
    lyricsMode,
    lyrics: mode === "instrumental" || lyricsMode === "auto" ? null : lyrics,
    bpm,
    key,
  };
}

export function validateAdminAiVideoBody(body, options = {}) {
  const input = ensureObject(body);
  const allowResolvedGrokPreviewMediaUrls = options?.allowResolvedGrokPreviewMediaUrls === true;
  const preset = optionalString(input.preset, "preset", 64);
  const model = optionalString(input.model, "model", 120);
  const selection = resolveAdminAiModelSelection("video", { preset, model });
  const selectedModel = selection.model;

  if (
    selectedModel.generationEnabled === false
    || selectedModel.pricingRequired === true
  ) {
    throw new AdminAiValidationError(
      selectedModel.unavailableMessage || ADMIN_AI_VIDEO_PRICING_REQUIRED_MESSAGE,
      409,
      selectedModel.unavailableCode || ADMIN_AI_VIDEO_PRICING_REQUIRED_CODE
    );
  }

  if (selectedModel.id === ADMIN_AI_VIDEO_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "negative_prompt",
        "image_input",
        "duration",
        "aspect_ratio",
        "quality",
        "seed",
        "generate_audio",
      ],
      selectedModel.id
    );

    const prompt = requiredString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const negative_prompt = optionalString(
      input.negative_prompt,
      "negative_prompt",
      selectedModel.maxNegativePromptLength
    );
    const image_input = optionalVideoImageReference(input.image_input, "image_input");
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const aspect_ratio = optionalEnum(
      input.aspect_ratio,
      "aspect_ratio",
      selectedModel.allowedAspectRatios,
      selectedModel.defaultAspectRatio
    );
    const quality = optionalEnum(
      input.quality,
      "quality",
      selectedModel.allowedQualities,
      selectedModel.defaultQuality
    );
    const seed = optionalInteger(input.seed, "seed", 0, ADMIN_AI_LIMITS.video.maxSeed, null);
    const generate_audio = optionalBoolean(
      input.generate_audio,
      "generate_audio",
      selectedModel.defaultGenerateAudio
    );

    return {
      preset,
      model,
      prompt,
      negative_prompt,
      image_input,
      duration,
      aspect_ratio,
      quality,
      seed,
      generate_audio,
    };
  }

  if (selectedModel.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "start_image",
        "end_image",
        "duration",
        "aspect_ratio",
        "resolution",
        "audio",
        "gateway_mode",
      ],
      selectedModel.id
    );

    const prompt = optionalString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const start_image = optionalVideoImageReference(input.start_image, "start_image");
    const end_image = optionalVideoImageReference(input.end_image, "end_image");
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      selectedModel.allowedResolutions,
      selectedModel.defaultResolution
    );
    const audio = optionalBoolean(input.audio, "audio", selectedModel.defaultGenerateAudio);
    const gateway_mode = optionalEnum(input.gateway_mode, "gateway_mode", ["on", "off"], null);

    const hasFrameInput = !!start_image || !!end_image;
    if (end_image && !start_image) {
      throw new AdminAiValidationError(
        "end_image requires start_image.",
        400,
        "validation_error"
      );
    }
    if (!prompt && !start_image) {
      throw new AdminAiValidationError(
        "prompt is required when no start_image is provided.",
        400,
        "validation_error"
      );
    }
    if (
      hasFrameInput
      && input.aspect_ratio !== undefined
      && input.aspect_ratio !== null
      && input.aspect_ratio !== ""
    ) {
      throw new AdminAiValidationError(
        "aspect_ratio is only supported for text-to-video on vidu/q3-pro.",
        400,
        "validation_error"
      );
    }

    return {
      preset,
      model,
      prompt,
      start_image,
      end_image,
      duration,
      resolution,
      audio,
      gateway_mode,
      aspect_ratio: hasFrameInput
        ? null
        : optionalEnum(
            input.aspect_ratio,
            "aspect_ratio",
            selectedModel.allowedAspectRatios,
            selectedModel.defaultAspectRatio
          ),
    };
  }

  if (isAdminAiVideoSeedanceModelId(selectedModel.id)) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "duration",
        "aspect_ratio",
        "resolution",
      ],
      selectedModel.id
    );

    const prompt = requiredString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const aspect_ratio = optionalEnum(
      input.aspect_ratio,
      "aspect_ratio",
      selectedModel.allowedAspectRatios,
      selectedModel.defaultAspectRatio
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      selectedModel.allowedResolutions,
      selectedModel.defaultResolution
    );
    try {
      calculateSeedance2CreditPricing(selectedModel.id, {
        duration,
        aspect_ratio,
        resolution,
      });
    } catch {
      throw new AdminAiValidationError(
        selectedModel.unavailableMessage || ADMIN_AI_VIDEO_PRICING_REQUIRED_MESSAGE,
        409,
        selectedModel.unavailableCode || ADMIN_AI_VIDEO_PRICING_REQUIRED_CODE
      );
    }

    return {
      preset,
      model,
      prompt,
      duration,
      aspect_ratio,
      resolution,
    };
  }

  if (selectedModel.id === ADMIN_AI_VIDEO_GROK_IMAGINE_15_PREVIEW_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "_operation",
        "operation",
        "duration",
        "aspect_ratio",
        "resolution",
        "size",
        "image",
        "image_url",
        "imageInput",
        "video",
        "video_url",
        "videoInput",
        "source_image",
        "sourceImage",
        "source_video",
        "sourceVideo",
        "reference_images",
        "referenceImages",
        "output",
        "output_upload_url",
        "user",
      ],
      selectedModel.id
    );

    const operation = optionalEnum(
      input._operation ?? input.operation,
      "_operation",
      selectedModel.supportedOperations,
      "generate"
    );
    const prompt = requiredString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const aspect_ratio = optionalEnum(
      input.aspect_ratio,
      "aspect_ratio",
      selectedModel.allowedAspectRatios,
      selectedModel.defaultAspectRatio
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      selectedModel.allowedResolutions,
      selectedModel.defaultResolution
    );
    const size = optionalEnum(input.size, "size", selectedModel.allowedSizes, null);
    const image = optionalGrokPreviewUrlObject(
      firstNonEmptyValue(input.image, input.image_url, input.imageInput),
      "image"
    );
    const video = optionalGrokPreviewUrlObject(
      firstNonEmptyValue(input.video, input.video_url, input.videoInput),
      "video"
    );
    const source_image = normalizeGrokPreviewSourceImage(
      firstNonEmptyValue(input.source_image, input.sourceImage),
      "source_image"
    );
    const source_video = normalizeGrokPreviewSourceVideo(
      firstNonEmptyValue(input.source_video, input.sourceVideo),
      "source_video"
    );
    const reference_images = optionalGrokPreviewReferenceImages(
      firstNonEmptyValue(input.reference_images, input.referenceImages),
      "reference_images",
      selectedModel.maxReferenceImages
    );
    const output = optionalGrokPreviewOutputObject(
      firstNonEmptyValue(input.output, input.output_upload_url),
      "output"
    );
    const user = optionalString(input.user, "user", 120);
    const hasBrowserImageUrlInput = input.image !== undefined || input.image_url !== undefined || input.imageInput !== undefined;
    const hasBrowserVideoUrlInput = input.video !== undefined || input.video_url !== undefined || input.videoInput !== undefined;
    const hasReferenceImageInput = input.reference_images !== undefined || input.referenceImages !== undefined;

    if (!allowResolvedGrokPreviewMediaUrls && hasReferenceImageInput) {
      throw new AdminAiValidationError(
        "reference_images are not accepted for Grok Imagine Video 1.5 Preview. Choose an internal source image.",
        400,
        "validation_error"
      );
    }

    if (operation === "generate" && !allowResolvedGrokPreviewMediaUrls && hasBrowserImageUrlInput) {
      throw new AdminAiValidationError(
        "image.url is not accepted for generate operations. Choose an internal source_image.",
        400,
        "validation_error"
      );
    }
    if (operation === "generate" && video) {
      throw new AdminAiValidationError(
        "video.url is only supported for edit and extend operations.",
        400,
        "validation_error"
      );
    }
    if (operation === "generate" && source_video) {
      throw new AdminAiValidationError(
        "source_video is only supported for edit and extend operations.",
        400,
        "validation_error"
      );
    }
    if (operation === "generate" && !allowResolvedGrokPreviewMediaUrls && !source_image) {
      throw new AdminAiValidationError(
        "Grok Imagine Video 1.5 Preview requires an internal image source for generate. Text-only video generation is not supported by the provider.",
        400,
        "validation_error"
      );
    }
    if (operation === "generate" && allowResolvedGrokPreviewMediaUrls && !image) {
      throw new AdminAiValidationError(
        "image.url is required for generate operations.",
        400,
        "validation_error"
      );
    }

    if ((operation === "edit" || operation === "extend") && source_image) {
      throw new AdminAiValidationError(
        "source_image is only supported for generate operations.",
        400,
        "validation_error"
      );
    }
    if ((operation === "edit" || operation === "extend") && !allowResolvedGrokPreviewMediaUrls && hasBrowserVideoUrlInput) {
      throw new AdminAiValidationError(
        operation === "edit"
          ? "video.url is not accepted for edit operations. Choose an internal source_video."
          : "video.url is not accepted for extend operations. Choose an internal source_video.",
        400,
        "validation_error"
      );
    }
    if ((operation === "edit" || operation === "extend") && image) {
      throw new AdminAiValidationError(
        "image.url is only supported for generate operations.",
        400,
        "validation_error"
      );
    }
    if ((operation === "edit" || operation === "extend") && !allowResolvedGrokPreviewMediaUrls && !source_video) {
      throw new AdminAiValidationError(
        `source_video is required for ${operation} operations.`,
        400,
        "validation_error"
      );
    }
    if ((operation === "edit" || operation === "extend") && allowResolvedGrokPreviewMediaUrls && !video) {
      throw new AdminAiValidationError(
        `video.url is required for ${operation} operations.`,
        400,
        "validation_error"
      );
    }

    const hasImageInput = allowResolvedGrokPreviewMediaUrls ? !!image : !!source_image;
    const hasVideoInput = allowResolvedGrokPreviewMediaUrls ? !!video : !!source_video;
    try {
      calculateGrokImagineVideo15PreviewCreditPricing({
        _operation: operation,
        duration,
        aspect_ratio,
        resolution,
        size,
        hasImageInput,
        hasVideoInput,
        referenceImageCount: allowResolvedGrokPreviewMediaUrls ? reference_images.length : 0,
        outputUploadUrlPresent: !!output,
      });
    } catch {
      throw new AdminAiValidationError(
        selectedModel.unavailableMessage || ADMIN_AI_VIDEO_PRICING_REQUIRED_MESSAGE,
        409,
        selectedModel.unavailableCode || ADMIN_AI_VIDEO_PRICING_REQUIRED_CODE
      );
    }

    const validated = {
      preset,
      model,
      prompt,
      _operation: operation,
      duration,
      aspect_ratio,
      resolution,
    };
    if (size) validated.size = size;
    if (allowResolvedGrokPreviewMediaUrls && image) validated.image = image;
    if (allowResolvedGrokPreviewMediaUrls && video) validated.video = video;
    if (!allowResolvedGrokPreviewMediaUrls && source_image) validated.source_image = source_image;
    if (!allowResolvedGrokPreviewMediaUrls && source_video) validated.source_video = source_video;
    if (allowResolvedGrokPreviewMediaUrls && reference_images.length > 0) validated.reference_images = reference_images;
    if (output) validated.output = output;
    if (user) validated.user = user;
    return validated;
  }

  if (selectedModel.id === ADMIN_AI_VIDEO_GROK_IMAGINE_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "_operation",
        "duration",
        "aspect_ratio",
        "resolution",
      ],
      selectedModel.id
    );

    const operation = optionalEnum(
      input._operation,
      "_operation",
      ["generate"],
      "generate"
    );
    const prompt = requiredString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const aspect_ratio = optionalEnum(
      input.aspect_ratio,
      "aspect_ratio",
      selectedModel.allowedAspectRatios,
      selectedModel.defaultAspectRatio
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      selectedModel.allowedResolutions,
      selectedModel.defaultResolution
    );
    try {
      calculateGrokImagineVideoCreditPricing({
        duration,
        aspect_ratio,
        resolution,
      });
    } catch {
      throw new AdminAiValidationError(
        selectedModel.unavailableMessage || ADMIN_AI_VIDEO_PRICING_REQUIRED_MESSAGE,
        409,
        selectedModel.unavailableCode || ADMIN_AI_VIDEO_PRICING_REQUIRED_CODE
      );
    }

    return {
      preset,
      model,
      prompt,
      _operation: operation,
      duration,
      aspect_ratio,
      resolution,
    };
  }

  if (selectedModel.id === ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID) {
    assertOnlyAllowedFields(
      input,
      [
        "preset",
        "model",
        "prompt",
        "duration",
        "ratio",
        "resolution",
        "seed",
        "watermark",
      ],
      selectedModel.id
    );

    const prompt = requiredString(input.prompt, "prompt", selectedModel.maxPromptLength);
    const duration = optionalInteger(
      input.duration,
      "duration",
      selectedModel.minDuration,
      selectedModel.maxDuration,
      selectedModel.defaultDuration
    );
    const ratio = optionalEnum(
      input.ratio,
      "ratio",
      selectedModel.allowedAspectRatios,
      selectedModel.defaultAspectRatio
    );
    const resolution = optionalEnum(
      input.resolution,
      "resolution",
      selectedModel.allowedResolutions,
      selectedModel.defaultResolution
    );
    const seed = optionalInteger(input.seed, "seed", 0, ADMIN_AI_LIMITS.video.maxSeed, null);
    const watermark = optionalBoolean(input.watermark, "watermark", selectedModel.defaultWatermark === true);

    return {
      preset,
      model,
      prompt,
      duration,
      ratio,
      resolution,
      seed,
      watermark,
    };
  }

  throw new AdminAiValidationError(
    `Unsupported video model "${selectedModel.id}".`,
    400,
    "model_not_allowed"
  );
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

export async function inspectFlux2MaxReferenceImagePricingDimensions(env, input) {
  if (input?.model !== FLUX_2_MAX_MODEL_ID) return null;
  const referenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];
  if (referenceImages.length === 0) {
    return {
      inputImageMegapixels: 0,
      inputImages: [],
      referenceImageCount: 0,
    };
  }
  if (!env?.IMAGES || typeof env.IMAGES.info !== "function") {
    throw new AdminAiValidationError(
      "Images binding is unavailable for FLUX.2 Max reference image pricing.",
      503,
      "images_binding_unavailable"
    );
  }

  const inputImages = [];
  let inputImageMegapixels = 0;
  for (const [index, dataUri] of referenceImages.entries()) {
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
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    inputImages.push({ width: roundedWidth, height: roundedHeight });
    inputImageMegapixels += (roundedWidth * roundedHeight) / 1_048_576;
  }

  return {
    inputImageMegapixels,
    inputImages,
    referenceImageCount: inputImages.length,
  };
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

export function buildAdminAiGptImage2Request(model, input) {
  const payload = {
    prompt: String(input.prompt || "").trim(),
    quality: input.quality || model.defaultQuality || "medium",
    size: input.size || model.defaultSize || "1024x1024",
    output_format: input.outputFormat || model.defaultOutputFormat || "png",
    background: input.background || model.defaultBackground || "auto",
  };

  if (Array.isArray(input.referenceImages) && input.referenceImages.length > 0) {
    payload.images = input.referenceImages;
  }

  return {
    payload,
    appliedQuality: payload.quality,
    appliedSize: payload.size,
    appliedOutputFormat: payload.output_format,
    appliedBackground: payload.background,
    referenceImageCount: payload.images?.length || 0,
  };
}

export function buildAdminAiGrokImagineImageRequest(model, input) {
  const payload = {
    prompt: String(input.prompt || "").trim(),
    aspect_ratio: input.aspect_ratio || model.defaultAspectRatio || GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO,
    quality: input.quality || model.defaultQuality || GROK_IMAGINE_IMAGE_DEFAULT_QUALITY,
    resolution: input.resolution || model.defaultResolution || GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION,
    response_format:
      input.response_format || model.defaultResponseFormat || GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT,
    n: input.n || model.defaultOutputCount || GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES,
  };
  if (input.user) payload.user = String(input.user).trim();
  if (input.image) payload.image = input.image;
  if (Array.isArray(input.images) && input.images.length > 0) payload.images = input.images;
  if (input.mask) payload.mask = input.mask;

  return {
    payload,
    appliedQuality: payload.quality,
    appliedResolution: payload.resolution,
    appliedAspectRatio: payload.aspect_ratio,
    appliedResponseFormat: payload.response_format,
    appliedOutputCount: payload.n,
    referenceImageCount: payload.images?.length || 0,
    inputImageCount: (payload.image ? 1 : 0) + (payload.images?.length || 0) + (payload.mask ? 1 : 0),
    hasPrimaryImage: !!payload.image,
    hasMask: !!payload.mask,
  };
}

export function buildAdminAiFlux2MaxRequest(model, input) {
  const width = input.width || model.defaultSize?.width || FLUX_2_MAX_DEFAULT_WIDTH;
  const height = input.height || model.defaultSize?.height || FLUX_2_MAX_DEFAULT_HEIGHT;
  const outputFormat = input.outputFormat || model.defaultOutputFormat || FLUX_2_MAX_DEFAULT_OUTPUT_FORMAT;
  const safetyTolerance = input.safetyTolerance ?? model.defaultSafetyTolerance ?? FLUX_2_MAX_DEFAULT_SAFETY_TOLERANCE;
  const payload = {
    prompt: String(input.prompt || "").trim(),
    width,
    height,
    output_format: outputFormat,
    safety_tolerance: safetyTolerance,
  };

  if (input.seed !== null && input.seed !== undefined && input.seed !== "") {
    payload.seed = input.seed;
  }
  if (Array.isArray(input.referenceImages) && input.referenceImages.length > 0) {
    payload.input_images = input.referenceImages;
  }

  return {
    payload,
    appliedSize: { width, height },
    appliedSeed: payload.seed ?? null,
    appliedOutputFormat: outputFormat,
    appliedSafetyTolerance: safetyTolerance,
    referenceImageCount: payload.input_images?.length || 0,
  };
}
