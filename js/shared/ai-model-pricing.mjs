import {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
  creditsForProviderCostUsd,
} from "./model-credit-pricing.mjs";
import {
  GPT_IMAGE_2_MODEL_ID,
  calculateGptImage2CreditCost,
} from "./gpt-image-2-pricing.mjs";
import {
  PIXVERSE_V6_MODEL_ID,
  calculatePixverseV6CreditPricing,
} from "./pixverse-v6-pricing.mjs";
import {
  HAPPYHORSE_T2V_MODEL_ID,
  calculateHappyHorseT2vCreditPricing,
} from "./happyhorse-t2v-pricing.mjs";
import {
  MINIMAX_MUSIC_2_6_MODEL_ID,
  calculateMinimaxMusic26CreditCost,
} from "./music-2-6-pricing.mjs";

export {
  GPT_IMAGE_2_MODEL_ID,
  PIXVERSE_V6_MODEL_ID,
  HAPPYHORSE_T2V_MODEL_ID,
  MINIMAX_MUSIC_2_6_MODEL_ID,
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
};

export const AI_MODEL_MEDIA_TYPES = Object.freeze({
  image: "image",
  video: "video",
  music: "music",
});

export const FLUX_1_SCHNELL_IMAGE_MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";
export const FLUX_2_KLEIN_IMAGE_MODEL_IDS = Object.freeze([
  "@cf/black-forest-labs/flux-2-klein-9b",
  "black-forest-labs/flux-2-klein-9b",
]);

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const MAX_DIMENSION = 4096;
const MAX_INPUT_IMAGE_MP = 32;

const FLUX_1_SCHNELL = Object.freeze({
  defaultSteps: 4,
  minSteps: 1,
  maxSteps: 8,
  costUsdPer512Tile: 0.0000528,
  costUsdPerStep: 0.0001056,
});

const FLUX_2_KLEIN = Object.freeze({
  firstOutputMpCostUsd: 0.015,
  subsequentOutputMpCostUsd: 0.002,
  inputImageMpCostUsd: 0.002,
});

function positiveFiniteNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) return fallback;
  return Math.min(number, max);
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Math.round(positiveFiniteNumber(value, fallback, { min, max }));
  return Math.min(Math.max(number, min), max);
}

function normalizedDimensions(params = {}) {
  return {
    width: positiveInteger(params.width, DEFAULT_WIDTH, { min: 1, max: MAX_DIMENSION }),
    height: positiveInteger(params.height, DEFAULT_HEIGHT, { min: 1, max: MAX_DIMENSION }),
  };
}

function normalizeInputImageMegapixels(params = {}) {
  const direct = Array.isArray(params.inputImageMegapixels)
    ? params.inputImageMegapixels
    : Array.isArray(params.inputImageMp)
      ? params.inputImageMp
      : [];
  if (direct.length > 0) {
    return direct.reduce((sum, value) => {
      const mp = positiveFiniteNumber(value, 0, { min: 0, max: MAX_INPUT_IMAGE_MP });
      return sum + mp;
    }, 0);
  }

  const images = Array.isArray(params.inputImages) ? params.inputImages : [];
  return images.reduce((sum, image) => {
    const width = positiveInteger(image?.width, 0, { min: 0, max: MAX_DIMENSION });
    const height = positiveInteger(image?.height, 0, { min: 0, max: MAX_DIMENSION });
    if (!width || !height) return sum;
    return sum + ((width * height) / 1_048_576);
  }, 0);
}

function flux1SchnellCost(params = {}) {
  const { width, height } = normalizedDimensions(params);
  const steps = positiveInteger(params.steps, FLUX_1_SCHNELL.defaultSteps, {
    min: FLUX_1_SCHNELL.minSteps,
    max: FLUX_1_SCHNELL.maxSteps,
  });
  const tileCount = Math.ceil(width / 512) * Math.ceil(height / 512);
  const providerCostUsd = (tileCount * FLUX_1_SCHNELL.costUsdPer512Tile)
    + (steps * FLUX_1_SCHNELL.costUsdPerStep);
  return {
    providerCostUsd,
    normalized: { width, height, steps, tileCount },
    formula: {
      pricingVersion: "flux-1-schnell-v1",
      billingMode: "provider_cost_tiles_steps",
    },
  };
}

function flux2KleinCost(params = {}) {
  const { width, height } = normalizedDimensions(params);
  const outputMp = (width * height) / 1_048_576;
  const outputCostUsd = FLUX_2_KLEIN.firstOutputMpCostUsd
    + Math.max(outputMp - 1, 0) * FLUX_2_KLEIN.subsequentOutputMpCostUsd;
  const inputImageMegapixels = normalizeInputImageMegapixels(params);
  const inputImageCostUsd = inputImageMegapixels * FLUX_2_KLEIN.inputImageMpCostUsd;
  return {
    providerCostUsd: outputCostUsd + inputImageCostUsd,
    normalized: {
      width,
      height,
      outputMp,
      inputImageMegapixels,
    },
    formula: {
      pricingVersion: "flux-2-klein-v1",
      billingMode: "provider_cost_output_mp_input_mp",
    },
  };
}

function priceProviderCostModel(modelId, pricing) {
  return {
    modelId,
    credits: creditsForProviderCostUsd(pricing.providerCostUsd),
    providerCostUsd: pricing.providerCostUsd,
    normalized: pricing.normalized,
    formula: {
      ...pricing.formula,
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
      requiredUserPrice: "providerCost / (1 - targetProfitMargin)",
      rounding: "ceil(requiredUserPriceEur / netEurPerCredit)",
    },
  };
}

export function isPricedAiImageModel(modelId) {
  const id = String(modelId || "").trim();
  return id === FLUX_1_SCHNELL_IMAGE_MODEL_ID
    || FLUX_2_KLEIN_IMAGE_MODEL_IDS.includes(id)
    || id === GPT_IMAGE_2_MODEL_ID;
}

export function calculateAiImageCreditCost(modelId, params = {}) {
  const id = String(modelId || "").trim();
  if (id === GPT_IMAGE_2_MODEL_ID) {
    return calculateGptImage2CreditCost(params);
  }
  if (id === FLUX_1_SCHNELL_IMAGE_MODEL_ID) {
    return priceProviderCostModel(id, flux1SchnellCost(params));
  }
  if (FLUX_2_KLEIN_IMAGE_MODEL_IDS.includes(id)) {
    return priceProviderCostModel(id, flux2KleinCost(params));
  }
  return null;
}

export function calculateAiVideoCreditCost(modelId, params = {}) {
  const id = String(modelId || "").trim();
  if (id === PIXVERSE_V6_MODEL_ID) {
    return calculatePixverseV6CreditPricing(params);
  }
  if (id === HAPPYHORSE_T2V_MODEL_ID) {
    return calculateHappyHorseT2vCreditPricing(params);
  }
  return null;
}

export function calculateAiMusicCreditCost(modelId, params = {}) {
  const id = String(modelId || "").trim();
  if (id === MINIMAX_MUSIC_2_6_MODEL_ID) {
    return calculateMinimaxMusic26CreditCost(params);
  }
  return null;
}

export function calculateAiModelCreditCost({ mediaType, modelId, params = {} } = {}) {
  const type = String(mediaType || "").trim();
  if (type === AI_MODEL_MEDIA_TYPES.image) return calculateAiImageCreditCost(modelId, params);
  if (type === AI_MODEL_MEDIA_TYPES.video) return calculateAiVideoCreditCost(modelId, params);
  if (type === AI_MODEL_MEDIA_TYPES.music) return calculateAiMusicCreditCost(modelId, params);

  return calculateAiImageCreditCost(modelId, params)
    || calculateAiVideoCreditCost(modelId, params)
    || calculateAiMusicCreditCost(modelId, params);
}
