export const GPT_IMAGE_2_MODEL_ID = "openai/gpt-image-2";

export const GPT_IMAGE_2_QUALITY_OPTIONS = Object.freeze(["low", "medium", "high", "auto"]);
export const GPT_IMAGE_2_SIZE_OPTIONS = Object.freeze(["1024x1024", "1024x1536", "1536x1024", "auto"]);
export const GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS = Object.freeze(["png", "webp", "jpeg"]);
export const GPT_IMAGE_2_BACKGROUND_OPTIONS = Object.freeze(["auto", "opaque"]);

const DEFAULT_QUALITY = "medium";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_OUTPUT_FORMAT = "png";
const DEFAULT_BACKGROUND = "auto";

const BASE_CREDITS = Object.freeze({
  low: Object.freeze({
    "1024x1024": 10,
    "1024x1536": 10,
    "1536x1024": 10,
  }),
  medium: Object.freeze({
    "1024x1024": 50,
    "1024x1536": 40,
    "1536x1024": 40,
  }),
  high: Object.freeze({
    "1024x1024": 200,
    "1024x1536": 150,
    "1536x1024": 150,
  }),
});

const BASE_PROVIDER_COST_USD = Object.freeze({
  low: Object.freeze({
    "1024x1024": 0.006,
    "1024x1536": 0.005,
    "1536x1024": 0.005,
  }),
  medium: Object.freeze({
    "1024x1024": 0.053,
    "1024x1536": 0.041,
    "1536x1024": 0.041,
  }),
  high: Object.freeze({
    "1024x1024": 0.211,
    "1024x1536": 0.165,
    "1536x1024": 0.165,
  }),
  auto: 0.211,
});

function normalizeEnum(value, allowed, fallback, field) {
  const candidate = String(value || "").trim() || fallback;
  if (!allowed.includes(candidate)) {
    throw new Error(`Unsupported GPT Image 2 ${field}.`);
  }
  return candidate;
}

function normalizeReferenceImageCount(params = {}) {
  if (Number.isInteger(params.referenceImageCount)) {
    return Math.max(0, params.referenceImageCount);
  }
  if (Array.isArray(params.referenceImages)) {
    return params.referenceImages.length;
  }
  if (Array.isArray(params.images)) {
    return params.images.length;
  }
  return 0;
}

export function normalizeGptImage2PricingInput(params = {}) {
  const quality = normalizeEnum(params.quality, GPT_IMAGE_2_QUALITY_OPTIONS, DEFAULT_QUALITY, "quality");
  const size = normalizeEnum(params.size, GPT_IMAGE_2_SIZE_OPTIONS, DEFAULT_SIZE, "size");
  const outputFormat = normalizeEnum(
    params.outputFormat ?? params.output_format,
    GPT_IMAGE_2_OUTPUT_FORMAT_OPTIONS,
    DEFAULT_OUTPUT_FORMAT,
    "output format"
  );
  const background = normalizeEnum(params.background, GPT_IMAGE_2_BACKGROUND_OPTIONS, DEFAULT_BACKGROUND, "background");
  return {
    quality,
    size,
    outputFormat,
    background,
    referenceImageCount: normalizeReferenceImageCount(params),
  };
}

export function calculateGptImage2CreditCost(params = {}) {
  const normalized = normalizeGptImage2PricingInput(params);
  const usesAutoBase = normalized.quality === "auto" || normalized.size === "auto";
  const baseCredits = usesAutoBase
    ? 200
    : BASE_CREDITS[normalized.quality]?.[normalized.size];
  if (!Number.isFinite(baseCredits)) {
    throw new Error("Unsupported GPT Image 2 quality/size combination.");
  }

  const referenceImageSurchargeCredits =
    normalized.referenceImageCount * (normalized.quality === "high" || normalized.quality === "auto" ? 50 : 25);
  const credits = baseCredits + referenceImageSurchargeCredits;
  const providerCostUsd = usesAutoBase
    ? BASE_PROVIDER_COST_USD.auto
    : BASE_PROVIDER_COST_USD[normalized.quality]?.[normalized.size] || BASE_PROVIDER_COST_USD.auto;

  return {
    modelId: GPT_IMAGE_2_MODEL_ID,
    credits,
    providerCostUsd,
    normalized: {
      ...normalized,
      baseCredits,
      referenceImageSurchargeCredits,
    },
    formula: {
      pricingVersion: "gpt-image-2-v1",
      billingMode: "cloudflare_ai_gateway_unified_billing",
      baseCreditSchedule: "fixed_by_quality_size",
      referenceImageSurcharge: "25_low_medium_50_high_auto",
    },
  };
}
