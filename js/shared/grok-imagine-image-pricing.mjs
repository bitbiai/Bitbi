import {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
  creditValueUsd,
  creditsForProviderCostUsd,
  effectiveProfitMarginForCredits,
  requiredSellPriceUsdForProviderCost,
} from "./model-credit-pricing.mjs";

export {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
};

export const GROK_IMAGINE_IMAGE_MODEL_ID = "xai/grok-imagine-image";
export const GROK_IMAGINE_IMAGE_MODEL_LABEL = "Grok Imagine Image";
export const GROK_IMAGINE_IMAGE_VENDOR = "xAI";
export const GROK_IMAGINE_IMAGE_PROVIDER_LABEL = "Cloudflare AI Gateway";
export const GROK_IMAGINE_IMAGE_ALIASES = Object.freeze(["grok-imagine-image-2026-03-02"]);
export const GROK_IMAGINE_IMAGE_ASPECT_RATIOS = Object.freeze([
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "auto",
]);
export const GROK_IMAGINE_IMAGE_QUALITIES = Object.freeze(["low", "medium", "high"]);
export const GROK_IMAGINE_IMAGE_RESOLUTIONS = Object.freeze(["1k", "2k"]);
export const GROK_IMAGINE_IMAGE_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
export const GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES = 1;
export const GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES = 10;
export const GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES = 10;
export const GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES = 1;
export const GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO = "auto";
export const GROK_IMAGINE_IMAGE_DEFAULT_QUALITY = "medium";
export const GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION = "1k";
export const GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT = "b64_json";
export const GROK_IMAGINE_IMAGE_PROVIDER_OUTPUT_COST_USD_PER_IMAGE = 0.020;
export const GROK_IMAGINE_IMAGE_PROVIDER_INPUT_COST_USD_PER_IMAGE = 0.002;
export const GROK_IMAGINE_IMAGE_PRICING_SOURCE = "operator_requested_grok_imagine_image_pricing";

function normalizeOutputCount(value) {
  const outputCount = Number(value ?? GROK_IMAGINE_IMAGE_DEFAULT_OUTPUT_IMAGES);
  if (
    !Number.isInteger(outputCount)
    || outputCount < GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES
    || outputCount > GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES
  ) {
    throw new Error("Unsupported Grok Imagine Image output count.");
  }
  return outputCount;
}

function normalizeEnum(value, allowed, fallback, label) {
  const normalized = String(value || "").trim() || fallback;
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported Grok Imagine Image ${label}.`);
  }
  return normalized;
}

function boundedSourceArray(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES);
}

function hasMediaObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeInputImageMetadata(settings = {}) {
  const hasPrimaryImage =
    settings.hasPrimaryImage === true
    || hasMediaObject(settings.image)
    || hasMediaObject(settings.source_image)
    || hasMediaObject(settings.sourceImage);
  const sourceImages = boundedSourceArray(
    Array.isArray(settings.source_images)
      ? settings.source_images
      : Array.isArray(settings.sourceImages)
        ? settings.sourceImages
        : Array.isArray(settings.images)
          ? settings.images
          : []
  );
  const sourceImagesCount = Number.isInteger(Number(settings.sourceImagesCount))
    ? Math.min(Math.max(0, Number(settings.sourceImagesCount)), GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES)
    : sourceImages.length;
  const hasMask =
    settings.hasMask === true
    || hasMediaObject(settings.mask)
    || hasMediaObject(settings.source_mask)
    || hasMediaObject(settings.sourceMask);
  return {
    hasPrimaryImage,
    sourceImagesCount,
    hasMask,
    inputImageCount: (hasPrimaryImage ? 1 : 0) + sourceImagesCount + (hasMask ? 1 : 0),
  };
}

export function isGrokImagineImageModelId(modelId) {
  return String(modelId || "").trim() === GROK_IMAGINE_IMAGE_MODEL_ID;
}

export function normalizeGrokImagineImagePricingInput(settings = {}) {
  const inputMetadata = normalizeInputImageMetadata(settings);
  return {
    modelId: GROK_IMAGINE_IMAGE_MODEL_ID,
    n: normalizeOutputCount(settings.n ?? settings.outputCount),
    inputImageCount: inputMetadata.inputImageCount,
    aspectRatio: normalizeEnum(
      settings.aspect_ratio ?? settings.aspectRatio,
      GROK_IMAGINE_IMAGE_ASPECT_RATIOS,
      GROK_IMAGINE_IMAGE_DEFAULT_ASPECT_RATIO,
      "aspect ratio"
    ),
    quality: normalizeEnum(
      settings.quality,
      GROK_IMAGINE_IMAGE_QUALITIES,
      GROK_IMAGINE_IMAGE_DEFAULT_QUALITY,
      "quality"
    ),
    resolution: normalizeEnum(
      settings.resolution,
      GROK_IMAGINE_IMAGE_RESOLUTIONS,
      GROK_IMAGINE_IMAGE_DEFAULT_RESOLUTION,
      "resolution"
    ),
    responseFormat: normalizeEnum(
      settings.response_format ?? settings.responseFormat,
      GROK_IMAGINE_IMAGE_RESPONSE_FORMATS,
      GROK_IMAGINE_IMAGE_DEFAULT_RESPONSE_FORMAT,
      "response format"
    ),
    hasPrimaryImage: inputMetadata.hasPrimaryImage,
    sourceImagesCount: inputMetadata.sourceImagesCount,
    hasMask: inputMetadata.hasMask,
  };
}

export function calculateGrokImagineImageCreditPricing(settings = {}) {
  const normalized = normalizeGrokImagineImagePricingInput(settings);
  const providerCostUsd =
    (normalized.n * GROK_IMAGINE_IMAGE_PROVIDER_OUTPUT_COST_USD_PER_IMAGE)
    + (normalized.inputImageCount * GROK_IMAGINE_IMAGE_PROVIDER_INPUT_COST_USD_PER_IMAGE);
  const credits = creditsForProviderCostUsd(providerCostUsd);
  const minimumSellPriceUsd = requiredSellPriceUsdForProviderCost(providerCostUsd);
  const chargedValueUsd = creditValueUsd(credits);
  const effectiveProfitMargin = effectiveProfitMarginForCredits(providerCostUsd, credits);

  return {
    modelId: GROK_IMAGINE_IMAGE_MODEL_ID,
    credits,
    providerCostUsd,
    internalCostUsd: null,
    minimumSellPriceUsd,
    chargedValueUsd,
    effectiveProfitMargin,
    normalized,
    formula: {
      pricingVersion: "grok-imagine-image-v1",
      billingMode: "cloudflare_ai_gateway_unified_billing_output_and_input_images",
      providerCostUsd: "(outputImageCount * outputCostUsdPerImage) + (inputImageCount * inputCostUsdPerImage)",
      outputCostUsdPerImage: GROK_IMAGINE_IMAGE_PROVIDER_OUTPUT_COST_USD_PER_IMAGE,
      inputCostUsdPerImage: GROK_IMAGINE_IMAGE_PROVIDER_INPUT_COST_USD_PER_IMAGE,
      pricingSource: GROK_IMAGINE_IMAGE_PRICING_SOURCE,
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
      requiredUserPrice: "providerCost / (1 - targetProfitMargin)",
      rounding: "ceil(requiredUserPriceEur / netEurPerCredit)",
    },
  };
}

export function listGrokImagineImagePricingMatrix() {
  const rows = [];
  for (let n = GROK_IMAGINE_IMAGE_MIN_OUTPUT_IMAGES; n <= GROK_IMAGINE_IMAGE_MAX_OUTPUT_IMAGES; n += 1) {
    for (let inputImageCount = 0; inputImageCount <= GROK_IMAGINE_IMAGE_MAX_INPUT_IMAGES + 2; inputImageCount += 1) {
      const pricing = calculateGrokImagineImageCreditPricing({
        n,
        sourceImagesCount: inputImageCount,
      });
      rows.push({
        modelId: GROK_IMAGINE_IMAGE_MODEL_ID,
        n,
        inputImageCount: pricing.normalized.inputImageCount,
        providerCostUsd: pricing.providerCostUsd,
        credits: pricing.credits,
        effectiveProfitMargin: pricing.effectiveProfitMargin,
      });
    }
  }
  return rows;
}
