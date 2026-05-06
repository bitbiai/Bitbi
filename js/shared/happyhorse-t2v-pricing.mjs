import {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
  creditValueUsd,
  creditsForProviderCostUsd,
  effectiveProfitMarginForCredits,
  requiredSellPriceUsdForProviderCost,
} from "./model-credit-pricing.mjs";

export const HAPPYHORSE_T2V_MODEL_ID = "alibaba/hh1-t2v";
export const HAPPYHORSE_T2V_MODEL_LABEL = "HappyHorse 1.0 T2V";
export const HAPPYHORSE_T2V_VENDOR = "Alibaba";

export const HAPPYHORSE_T2V_RESOLUTIONS = Object.freeze(["720P", "1080P"]);
export const HAPPYHORSE_T2V_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"]);
export const HAPPYHORSE_T2V_MIN_DURATION = 3;
export const HAPPYHORSE_T2V_MAX_DURATION = 15;
export const HAPPYHORSE_T2V_DEFAULT_DURATION = 5;
export const HAPPYHORSE_T2V_DEFAULT_RESOLUTION = "720P";
export const HAPPYHORSE_T2V_DEFAULT_RATIO = "16:9";
export const HAPPYHORSE_T2V_DEFAULT_WATERMARK = false;
export const HAPPYHORSE_T2V_MAX_PROMPT_LENGTH = 2500;
export const HAPPYHORSE_T2V_MAX_SEED = 2147483647;

export const BITBI_HAPPYHORSE_PRICING_USD_TO_EUR = BITBI_MODEL_PRICING_USD_TO_EUR;
export const BITBI_HAPPYHORSE_NET_EUR_PER_CREDIT = BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING;
export const BITBI_HAPPYHORSE_TARGET_PROFIT_MARGIN = BITBI_TARGET_PROFIT_MARGIN;

// Cloudflare's public model page currently links pricing to the dashboard rather
// than publishing this model's per-unit price. Keep the value centralized so it
// can be updated from the dashboard before any member-facing rollout.
export const HAPPYHORSE_T2V_PROVIDER_COST_USD_PER_SECOND = Object.freeze({
  "720P": 0.14,
  "1080P": 0.28,
});

const PRICING_VERSION = "happyhorse-1-0-t2v-v1";

function normalizeEnum(value, allowed, fallback, field) {
  const candidate = String(value || "").trim() || fallback;
  if (!allowed.includes(candidate)) {
    throw new Error(`Unsupported HappyHorse ${field}.`);
  }
  return candidate;
}

function normalizeDuration(value) {
  const parsed = Number(value ?? HAPPYHORSE_T2V_DEFAULT_DURATION);
  if (!Number.isInteger(parsed) || parsed < HAPPYHORSE_T2V_MIN_DURATION || parsed > HAPPYHORSE_T2V_MAX_DURATION) {
    throw new Error("Unsupported HappyHorse duration.");
  }
  return parsed;
}

export function normalizeHappyHorseT2vPricingInput(settings = {}) {
  return {
    modelId: HAPPYHORSE_T2V_MODEL_ID,
    resolution: normalizeEnum(
      settings.resolution,
      HAPPYHORSE_T2V_RESOLUTIONS,
      HAPPYHORSE_T2V_DEFAULT_RESOLUTION,
      "resolution"
    ),
    ratio: normalizeEnum(
      settings.ratio ?? settings.aspect_ratio,
      HAPPYHORSE_T2V_RATIOS,
      HAPPYHORSE_T2V_DEFAULT_RATIO,
      "ratio"
    ),
    duration: normalizeDuration(settings.duration),
    watermark: settings.watermark === true,
  };
}

export function calculateHappyHorseProviderCost(settings = {}) {
  const normalized = normalizeHappyHorseT2vPricingInput(settings);
  const costUsdPerSecond = HAPPYHORSE_T2V_PROVIDER_COST_USD_PER_SECOND[normalized.resolution];
  if (!Number.isFinite(costUsdPerSecond) || costUsdPerSecond <= 0) {
    throw new Error("HappyHorse provider pricing is not configured.");
  }
  return {
    providerCostUsd: costUsdPerSecond * normalized.duration,
    normalized: {
      ...normalized,
      costUsdPerSecond,
    },
  };
}

export function creditsForHappyHorseProviderCost(providerCostUsd) {
  return creditsForProviderCostUsd(providerCostUsd);
}

export function calculateHappyHorseT2vCreditPricing(settings = {}) {
  const provider = calculateHappyHorseProviderCost(settings);
  const providerCostUsd = provider.providerCostUsd;
  const minimumSellPriceUsd = requiredSellPriceUsdForProviderCost(providerCostUsd);
  const minimumSellPriceEur = minimumSellPriceUsd * BITBI_HAPPYHORSE_PRICING_USD_TO_EUR;
  const credits = creditsForHappyHorseProviderCost(providerCostUsd);
  const chargedValueEur = credits * BITBI_HAPPYHORSE_NET_EUR_PER_CREDIT;
  const chargedValueUsd = creditValueUsd(credits);
  const effectiveProfitMargin = effectiveProfitMarginForCredits(providerCostUsd, credits);

  return {
    modelId: HAPPYHORSE_T2V_MODEL_ID,
    credits,
    providerCostUsd,
    minimumSellPriceUsd,
    minimumSellPriceEur,
    chargedValueEur,
    chargedValueUsd,
    effectiveProfitMargin,
    normalized: provider.normalized,
    formula: {
      pricingVersion: PRICING_VERSION,
      billingMode: "duration_seconds_by_resolution",
      providerCostUsd: "duration * provider_cost_usd_per_second[resolution]",
      requiredUserPrice: "providerCost / (1 - 0.20)",
      rounding: "ceil(requiredUserPriceEur / netEurPerCredit)",
      usdToEur: BITBI_HAPPYHORSE_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_HAPPYHORSE_NET_EUR_PER_CREDIT,
      targetProfitMargin: BITBI_HAPPYHORSE_TARGET_PROFIT_MARGIN,
      pricingSource: "centralized_pending_cloudflare_dashboard_verification",
    },
  };
}

export function listHappyHorseT2vPricingMatrix() {
  const rows = [];
  for (const resolution of HAPPYHORSE_T2V_RESOLUTIONS) {
    for (const ratio of HAPPYHORSE_T2V_RATIOS) {
      for (let duration = HAPPYHORSE_T2V_MIN_DURATION; duration <= HAPPYHORSE_T2V_MAX_DURATION; duration += 1) {
        const pricing = calculateHappyHorseT2vCreditPricing({
          resolution,
          ratio,
          duration,
          watermark: HAPPYHORSE_T2V_DEFAULT_WATERMARK,
        });
        rows.push({
          modelSlug: "happyhorse-1-0-t2v",
          modelId: HAPPYHORSE_T2V_MODEL_ID,
          resolution,
          ratio,
          duration,
          watermarkAffectsCost: false,
          providerCostUsd: pricing.providerCostUsd,
          minimumSellPriceUsd: pricing.minimumSellPriceUsd,
          credits: pricing.credits,
          effectiveProfitMargin: pricing.effectiveProfitMargin,
        });
      }
    }
  }
  return rows;
}
