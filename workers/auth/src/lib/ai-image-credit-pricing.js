export const BITBI_MODEL_PRICING_USD_TO_EUR = 0.855176;
export const BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING = 0.00163250625;
export const BITBI_TARGET_PROFIT_MARGIN = 0.20;

export const FLUX_1_SCHNELL_IMAGE_MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";
export const FLUX_2_KLEIN_IMAGE_MODEL_IDS = Object.freeze([
  "@cf/black-forest-labs/flux-2-klein-9b",
  "black-forest-labs/flux-2-klein-9b",
]);

const CREDIT_PRICING_REVENUE_FACTOR = 1 - BITBI_TARGET_PROFIT_MARGIN;
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

function creditsForProviderCost(providerCostUsd) {
  const costUsd = Number(providerCostUsd);
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 1;
  const requiredNetEur = (costUsd * BITBI_MODEL_PRICING_USD_TO_EUR) / CREDIT_PRICING_REVENUE_FACTOR;
  const credits = Math.ceil(requiredNetEur / BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING);
  return Math.max(1, credits);
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
  };
}

export function isPricedAiImageModel(modelId) {
  const id = String(modelId || "").trim();
  return id === FLUX_1_SCHNELL_IMAGE_MODEL_ID
    || FLUX_2_KLEIN_IMAGE_MODEL_IDS.includes(id);
}

export function calculateAiImageCreditCost(modelId, params = {}) {
  const id = String(modelId || "").trim();
  let pricing = null;
  if (id === FLUX_1_SCHNELL_IMAGE_MODEL_ID) {
    pricing = flux1SchnellCost(params);
  } else if (FLUX_2_KLEIN_IMAGE_MODEL_IDS.includes(id)) {
    pricing = flux2KleinCost(params);
  } else {
    return null;
  }

  return {
    modelId: id,
    credits: creditsForProviderCost(pricing.providerCostUsd),
    providerCostUsd: pricing.providerCostUsd,
    normalized: pricing.normalized,
    formula: {
      usdToEur: BITBI_MODEL_PRICING_USD_TO_EUR,
      netEurPerCredit: BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
      targetProfitMargin: BITBI_TARGET_PROFIT_MARGIN,
    },
  };
}
