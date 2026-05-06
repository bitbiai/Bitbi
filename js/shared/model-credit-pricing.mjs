import { BITBI_LOWEST_LIVE_PACK_NET_EUR_PER_CREDIT } from "./live-credit-packs.mjs";

export const BITBI_MODEL_PRICING_USD_TO_EUR = 0.855176;
export const BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING = BITBI_LOWEST_LIVE_PACK_NET_EUR_PER_CREDIT;
export const BITBI_TARGET_PROFIT_MARGIN = 0.20;

export function requiredSellPriceUsdForProviderCost(providerCostUsd, targetProfitMargin = BITBI_TARGET_PROFIT_MARGIN) {
  const costUsd = Number(providerCostUsd);
  const margin = Number(targetProfitMargin);
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) {
    throw new Error("Target profit margin must be between 0 and 1.");
  }
  return costUsd / (1 - margin);
}

export function creditsForProviderCostUsd(providerCostUsd, {
  usdToEur = BITBI_MODEL_PRICING_USD_TO_EUR,
  netEurPerCredit = BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  targetProfitMargin = BITBI_TARGET_PROFIT_MARGIN,
} = {}) {
  const minimumSellPriceUsd = requiredSellPriceUsdForProviderCost(providerCostUsd, targetProfitMargin);
  if (minimumSellPriceUsd <= 0) return 1;
  const requiredNetEur = minimumSellPriceUsd * usdToEur;
  return Math.max(1, Math.ceil(requiredNetEur / netEurPerCredit));
}

export function creditValueUsd(credits, {
  usdToEur = BITBI_MODEL_PRICING_USD_TO_EUR,
  netEurPerCredit = BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
} = {}) {
  const count = Number(credits);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return (count * netEurPerCredit) / usdToEur;
}

export function effectiveProfitMarginForCredits(providerCostUsd, credits, options = {}) {
  const chargedValueUsd = creditValueUsd(credits, options);
  if (chargedValueUsd <= 0) return 0;
  return (chargedValueUsd - Number(providerCostUsd || 0)) / chargedValueUsd;
}
