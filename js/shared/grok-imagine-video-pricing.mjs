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

export const GROK_IMAGINE_VIDEO_MODEL_ID = "xai/grok-imagine-video";
export const GROK_IMAGINE_VIDEO_ASPECT_RATIOS = Object.freeze([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
]);
export const GROK_IMAGINE_VIDEO_RESOLUTIONS = Object.freeze(["480p", "720p"]);
export const GROK_IMAGINE_VIDEO_SIZES = Object.freeze([
  "848x480",
  "1696x960",
  "1280x720",
  "1920x1080",
]);
export const GROK_IMAGINE_VIDEO_OPERATIONS = Object.freeze(["generate", "edit", "extend"]);
export const GROK_IMAGINE_VIDEO_MIN_DURATION = 1;
export const GROK_IMAGINE_VIDEO_MAX_DURATION = 15;
export const GROK_IMAGINE_VIDEO_DEFAULT_DURATION = 5;
export const GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO = "16:9";
export const GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION = "720p";
export const GROK_IMAGINE_VIDEO_PROVIDER_RATE_USD_PER_SECOND = 0.05;

function normalizeDuration(value) {
  const duration = Number(value ?? GROK_IMAGINE_VIDEO_DEFAULT_DURATION);
  if (
    !Number.isInteger(duration)
    || duration < GROK_IMAGINE_VIDEO_MIN_DURATION
    || duration > GROK_IMAGINE_VIDEO_MAX_DURATION
  ) {
    throw new Error("Unsupported Grok Imagine Video duration.");
  }
  return duration;
}

function normalizeAspectRatio(value) {
  const aspectRatio = String(value || "").trim() || GROK_IMAGINE_VIDEO_DEFAULT_ASPECT_RATIO;
  if (!GROK_IMAGINE_VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error("Unsupported Grok Imagine Video aspect ratio.");
  }
  return aspectRatio;
}

function normalizeResolution(value) {
  const resolution = String(value || "").trim() || GROK_IMAGINE_VIDEO_DEFAULT_RESOLUTION;
  if (!GROK_IMAGINE_VIDEO_RESOLUTIONS.includes(resolution)) {
    throw new Error("Unsupported Grok Imagine Video resolution.");
  }
  return resolution;
}

function normalizeSize(value) {
  const size = String(value || "").trim();
  if (!size) return null;
  if (!GROK_IMAGINE_VIDEO_SIZES.includes(size)) {
    throw new Error("Unsupported Grok Imagine Video size.");
  }
  return size;
}

export function isGrokImagineVideoModelId(modelId) {
  return String(modelId || "").trim() === GROK_IMAGINE_VIDEO_MODEL_ID;
}

export function normalizeGrokImagineVideoPricingInput(settings = {}) {
  return {
    modelId: GROK_IMAGINE_VIDEO_MODEL_ID,
    duration: normalizeDuration(settings.duration),
    aspectRatio: normalizeAspectRatio(settings.aspect_ratio ?? settings.ratio),
    resolution: normalizeResolution(settings.resolution),
    size: normalizeSize(settings.size),
    rateUsdPerSecond: GROK_IMAGINE_VIDEO_PROVIDER_RATE_USD_PER_SECOND,
  };
}

export function calculateGrokImagineVideoCreditPricing(settings = {}) {
  const normalized = normalizeGrokImagineVideoPricingInput(settings);
  const providerCostUsd = normalized.duration * normalized.rateUsdPerSecond;
  const credits = creditsForProviderCostUsd(providerCostUsd);
  const minimumSellPriceUsd = requiredSellPriceUsdForProviderCost(providerCostUsd);
  const chargedValueUsd = creditValueUsd(credits);
  const effectiveProfitMargin = effectiveProfitMarginForCredits(providerCostUsd, credits);

  return {
    modelId: GROK_IMAGINE_VIDEO_MODEL_ID,
    credits,
    providerCostUsd,
    internalCostUsd: null,
    minimumSellPriceUsd,
    chargedValueUsd,
    effectiveProfitMargin,
    normalized,
    formula: {
      pricingVersion: "grok-imagine-video-v1",
      billingMode: "cloudflare_ai_gateway_unified_billing_duration_seconds",
      providerCostUsd: "durationSeconds * providerRateUsdPerSecond",
      rateUsdPerSecond: GROK_IMAGINE_VIDEO_PROVIDER_RATE_USD_PER_SECOND,
      pricingSource: "operator_requested_grok_imagine_video_pricing_2026_05_31",
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
      requiredUserPrice: "providerCost / (1 - targetProfitMargin)",
      rounding: "ceil(requiredUserPriceEur / netEurPerCredit)",
    },
  };
}

export function listGrokImagineVideoPricingMatrix() {
  const rows = [];
  for (const resolution of GROK_IMAGINE_VIDEO_RESOLUTIONS) {
    for (const aspectRatio of GROK_IMAGINE_VIDEO_ASPECT_RATIOS) {
      for (
        let duration = GROK_IMAGINE_VIDEO_MIN_DURATION;
        duration <= GROK_IMAGINE_VIDEO_MAX_DURATION;
        duration += 1
      ) {
        const pricing = calculateGrokImagineVideoCreditPricing({
          duration,
          resolution,
          aspect_ratio: aspectRatio,
        });
        rows.push({
          modelId: GROK_IMAGINE_VIDEO_MODEL_ID,
          duration,
          resolution,
          aspectRatio,
          providerCostUsd: pricing.providerCostUsd,
          credits: pricing.credits,
          effectiveProfitMargin: pricing.effectiveProfitMargin,
        });
      }
    }
  }
  return rows;
}
