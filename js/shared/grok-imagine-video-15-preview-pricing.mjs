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

export const GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID = "xai/grok-imagine-video-1.5-preview";
export const GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_LABEL = "Grok Imagine Video 1.5 Preview";
export const GROK_IMAGINE_VIDEO_15_PREVIEW_VENDOR = "xAI";
export const GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS = Object.freeze(["generate", "edit", "extend"]);
export const GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS = Object.freeze([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
]);
export const GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS = Object.freeze(["480p", "720p"]);
export const GROK_IMAGINE_VIDEO_15_PREVIEW_SIZES = Object.freeze([
  "848x480",
  "1696x960",
  "1280x720",
  "1920x1080",
]);
export const GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES = 10;
export const GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION = 1;
export const GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION = 15;
export const GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION = 5;
export const GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO = "16:9";
export const GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION = "480p";
export const GROK_IMAGINE_VIDEO_15_PREVIEW_PROVIDER_RATE_USD_PER_SECOND_BY_RESOLUTION =
  Object.freeze({
    "480p": 0.08,
    "720p": 0.14,
  });
export const GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_PROVIDER_RATE_USD_PER_SECOND = 0.08;

function normalizeDuration(value) {
  const duration = Number(value ?? GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_DURATION);
  if (
    !Number.isInteger(duration)
    || duration < GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION
    || duration > GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION
  ) {
    throw new Error("Unsupported Grok Imagine Video 1.5 Preview duration.");
  }
  return duration;
}

function normalizeAspectRatio(value) {
  const aspectRatio =
    String(value || "").trim() || GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_ASPECT_RATIO;
  if (!GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error("Unsupported Grok Imagine Video 1.5 Preview aspect ratio.");
  }
  return aspectRatio;
}

function normalizeResolution(value) {
  const resolution =
    String(value || "").trim() || GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_RESOLUTION;
  if (!GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS.includes(resolution)) {
    throw new Error("Unsupported Grok Imagine Video 1.5 Preview resolution.");
  }
  return resolution;
}

function normalizeOperation(value) {
  const operation = String(value || "").trim() || "generate";
  if (!GROK_IMAGINE_VIDEO_15_PREVIEW_OPERATIONS.includes(operation)) {
    throw new Error("Unsupported Grok Imagine Video 1.5 Preview operation.");
  }
  return operation;
}

function normalizeSize(value) {
  const size = String(value || "").trim();
  if (!size) return null;
  if (!GROK_IMAGINE_VIDEO_15_PREVIEW_SIZES.includes(size)) {
    throw new Error("Unsupported Grok Imagine Video 1.5 Preview size.");
  }
  return size;
}

function booleanFlag(value) {
  return value === true;
}

function normalizeReferenceImageCount(settings = {}) {
  if (Number.isInteger(Number(settings.referenceImageCount))) {
    return Math.min(
      Math.max(0, Number(settings.referenceImageCount)),
      GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES
    );
  }
  const direct = Array.isArray(settings.reference_images)
    ? settings.reference_images
    : Array.isArray(settings.referenceImages)
      ? settings.referenceImages
      : [];
  return Math.min(direct.length, GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_REFERENCE_IMAGES);
}

export function isGrokImagineVideo15PreviewModelId(modelId) {
  return String(modelId || "").trim() === GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID;
}

export function normalizeGrokImagineVideo15PreviewPricingInput(settings = {}) {
  const resolution = normalizeResolution(settings.resolution);
  const rateUsdPerSecond =
    GROK_IMAGINE_VIDEO_15_PREVIEW_PROVIDER_RATE_USD_PER_SECOND_BY_RESOLUTION[resolution]
    || GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_PROVIDER_RATE_USD_PER_SECOND;
  return {
    modelId: GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID,
    operation: normalizeOperation(settings._operation ?? settings.operation),
    duration: normalizeDuration(settings.duration),
    aspectRatio: normalizeAspectRatio(settings.aspect_ratio ?? settings.aspectRatio ?? settings.ratio),
    resolution,
    size: normalizeSize(settings.size),
    hasImageInput: booleanFlag(settings.hasImageInput) || !!settings.image || !!settings.image_url,
    hasVideoInput: booleanFlag(settings.hasVideoInput) || !!settings.video || !!settings.video_url,
    referenceImageCount: normalizeReferenceImageCount(settings),
    outputUploadUrlPresent:
      booleanFlag(settings.outputUploadUrlPresent)
      || !!settings.output?.upload_url
      || !!settings.output_upload_url,
    rateUsdPerSecond,
  };
}

export function calculateGrokImagineVideo15PreviewCreditPricing(settings = {}) {
  const normalized = normalizeGrokImagineVideo15PreviewPricingInput(settings);
  const providerCostUsd = normalized.duration * normalized.rateUsdPerSecond;
  const credits = creditsForProviderCostUsd(providerCostUsd);
  const minimumSellPriceUsd = requiredSellPriceUsdForProviderCost(providerCostUsd);
  const chargedValueUsd = creditValueUsd(credits);
  const effectiveProfitMargin = effectiveProfitMarginForCredits(providerCostUsd, credits);

  return {
    modelId: GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID,
    credits,
    providerCostUsd,
    internalCostUsd: null,
    minimumSellPriceUsd,
    chargedValueUsd,
    effectiveProfitMargin,
    normalized,
    formula: {
      pricingVersion: "grok-imagine-video-1-5-preview-v1",
      billingMode: "cloudflare_ai_gateway_unified_billing_duration_seconds_resolution",
      providerCostUsd: "durationSeconds * providerRateUsdPerSecondByResolution[resolution]",
      providerRateUsdPerSecondByResolution:
        GROK_IMAGINE_VIDEO_15_PREVIEW_PROVIDER_RATE_USD_PER_SECOND_BY_RESOLUTION,
      defaultRateUsdPerSecond:
        GROK_IMAGINE_VIDEO_15_PREVIEW_DEFAULT_PROVIDER_RATE_USD_PER_SECOND,
      pricingSource: "operator_requested_grok_imagine_video_1_5_preview_pricing_2026_06_04",
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
      requiredUserPrice: "providerCost / (1 - targetProfitMargin)",
      rounding: "ceil(requiredUserPriceEur / netEurPerCredit)",
    },
  };
}

export function listGrokImagineVideo15PreviewPricingMatrix() {
  const rows = [];
  for (const resolution of GROK_IMAGINE_VIDEO_15_PREVIEW_RESOLUTIONS) {
    for (const aspectRatio of GROK_IMAGINE_VIDEO_15_PREVIEW_ASPECT_RATIOS) {
      for (
        let duration = GROK_IMAGINE_VIDEO_15_PREVIEW_MIN_DURATION;
        duration <= GROK_IMAGINE_VIDEO_15_PREVIEW_MAX_DURATION;
        duration += 1
      ) {
        const pricing = calculateGrokImagineVideo15PreviewCreditPricing({
          duration,
          resolution,
          aspect_ratio: aspectRatio,
        });
        rows.push({
          modelId: GROK_IMAGINE_VIDEO_15_PREVIEW_MODEL_ID,
          duration,
          resolution,
          aspectRatio,
          rateUsdPerSecond: pricing.normalized.rateUsdPerSecond,
          providerCostUsd: pricing.providerCostUsd,
          credits: pricing.credits,
          effectiveProfitMargin: pricing.effectiveProfitMargin,
        });
      }
    }
  }
  return rows;
}
