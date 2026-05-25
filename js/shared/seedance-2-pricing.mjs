import {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  creditValueUsd,
  effectiveProfitMarginForCredits,
} from "./model-credit-pricing.mjs";

export {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
};

export const SEEDANCE_2_FAST_MODEL_ID = "bytedance/seedance-2.0-fast";
export const SEEDANCE_2_MODEL_ID = "bytedance/seedance-2.0";

export const SEEDANCE_2_RESOLUTIONS = Object.freeze(["720p", "1080p"]);
export const SEEDANCE_2_ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"]);
export const SEEDANCE_2_MIN_DURATION = 4;
export const SEEDANCE_2_MAX_DURATION = 12;
export const SEEDANCE_2_DEFAULT_DURATION = 5;
export const SEEDANCE_2_DEFAULT_RESOLUTION = "720p";
export const SEEDANCE_2_DEFAULT_ASPECT_RATIO = "16:9";
export const SEEDANCE_2_PRICE_MARKUP = 0.20;

// Operator-approved Seedance pricing, 2026-05-25.
export const SEEDANCE_2_PROVIDER_RATES_USD_PER_SECOND = Object.freeze({
  [SEEDANCE_2_FAST_MODEL_ID]: Object.freeze({
    default: 0.08,
    "720p": 0.08,
    "1080p": 0.17,
  }),
  [SEEDANCE_2_MODEL_ID]: Object.freeze({
    default: 0.22,
    "720p": 0.22,
    "1080p": 0.55,
  }),
});

function normalizeModelId(modelId) {
  const id = String(modelId || "").trim();
  if (!Object.prototype.hasOwnProperty.call(SEEDANCE_2_PROVIDER_RATES_USD_PER_SECOND, id)) {
    throw new Error("Unsupported Seedance model.");
  }
  return id;
}

function normalizeDuration(value) {
  const duration = Number(value ?? SEEDANCE_2_DEFAULT_DURATION);
  if (!Number.isInteger(duration) || duration < SEEDANCE_2_MIN_DURATION || duration > SEEDANCE_2_MAX_DURATION) {
    throw new Error("Unsupported Seedance duration.");
  }
  return duration;
}

function normalizeResolution(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      resolution: SEEDANCE_2_DEFAULT_RESOLUTION,
      pricingResolution: "default",
    };
  }
  if (!SEEDANCE_2_RESOLUTIONS.includes(raw)) {
    throw new Error("Unsupported Seedance resolution.");
  }
  return {
    resolution: raw,
    pricingResolution: raw,
  };
}

function normalizeAspectRatio(value) {
  const aspectRatio = String(value || "").trim() || SEEDANCE_2_DEFAULT_ASPECT_RATIO;
  if (!SEEDANCE_2_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error("Unsupported Seedance aspect ratio.");
  }
  return aspectRatio;
}

function creditsForInternalCostUsd(internalCostUsd) {
  const cost = Number(internalCostUsd);
  if (!Number.isFinite(cost) || cost <= 0) return 1;
  const requiredNetEur = cost * BITBI_MODEL_PRICING_USD_TO_EUR;
  return Math.max(1, Math.ceil(requiredNetEur / BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING));
}

export function isSeedance2ModelId(modelId) {
  const id = String(modelId || "").trim();
  return id === SEEDANCE_2_FAST_MODEL_ID || id === SEEDANCE_2_MODEL_ID;
}

export function normalizeSeedance2PricingInput(modelId, settings = {}) {
  const id = normalizeModelId(modelId);
  const resolution = normalizeResolution(settings.resolution);
  return {
    modelId: id,
    duration: normalizeDuration(settings.duration),
    aspectRatio: normalizeAspectRatio(settings.aspect_ratio ?? settings.ratio),
    resolution: resolution.resolution,
    pricingResolution: resolution.pricingResolution,
  };
}

export function calculateSeedance2CreditPricing(modelId, settings = {}) {
  const normalized = normalizeSeedance2PricingInput(modelId, settings);
  const rates = SEEDANCE_2_PROVIDER_RATES_USD_PER_SECOND[normalized.modelId];
  const rateUsdPerSecond = rates[normalized.pricingResolution];
  if (!Number.isFinite(rateUsdPerSecond) || rateUsdPerSecond <= 0) {
    throw new Error("Seedance provider pricing is not configured.");
  }

  const providerCostUsd = normalized.duration * rateUsdPerSecond;
  const internalCostUsd = providerCostUsd * (1 + SEEDANCE_2_PRICE_MARKUP);
  const credits = creditsForInternalCostUsd(internalCostUsd);
  const chargedValueUsd = creditValueUsd(credits);
  const effectiveProfitMargin = effectiveProfitMarginForCredits(providerCostUsd, credits);

  return {
    modelId: normalized.modelId,
    credits,
    providerCostUsd,
    internalCostUsd,
    chargedValueUsd,
    effectiveProfitMargin,
    normalized: {
      ...normalized,
      rateUsdPerSecond,
    },
    formula: {
      pricingVersion: "seedance-2-operator-approved-2026-05-25",
      billingMode: "duration_seconds_by_resolution",
      providerCostUsd: "durationSeconds * providerRateUsdPerSecond",
      internalCostUsd: "providerCostUsd * 1.20",
      rounding: "ceil(internalCostUsdEur / netEurPerCredit)",
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      markup: SEEDANCE_2_PRICE_MARKUP,
      pricingSource: "operator_approved_seedance_pricing_2026_05_25",
    },
  };
}

export function listSeedance2PricingMatrix() {
  const rows = [];
  for (const modelId of [SEEDANCE_2_FAST_MODEL_ID, SEEDANCE_2_MODEL_ID]) {
    for (const resolution of SEEDANCE_2_RESOLUTIONS) {
      for (const aspectRatio of SEEDANCE_2_ASPECT_RATIOS) {
        for (let duration = SEEDANCE_2_MIN_DURATION; duration <= SEEDANCE_2_MAX_DURATION; duration += 1) {
          const pricing = calculateSeedance2CreditPricing(modelId, {
            duration,
            resolution,
            aspect_ratio: aspectRatio,
          });
          rows.push({
            modelId,
            duration,
            resolution,
            aspectRatio,
            aspectRatioAffectsCost: false,
            providerCostUsd: pricing.providerCostUsd,
            internalCostUsd: pricing.internalCostUsd,
            credits: pricing.credits,
            effectiveProfitMargin: pricing.effectiveProfitMargin,
          });
        }
      }
    }
  }
  return rows;
}
