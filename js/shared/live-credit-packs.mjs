export const BITBI_LIVE_CREDIT_PACKS = Object.freeze([
  Object.freeze({
    id: "live_credits_5000",
    name: "5000 Credit Pack",
    credits: 5000,
    amountCents: 999,
    currency: "eur",
    displayPrice: "9,99 €",
    active: true,
    sortOrder: 5000,
  }),
  Object.freeze({
    id: "live_credits_12000",
    name: "12000 Credit Pack",
    credits: 12000,
    amountCents: 1999,
    currency: "eur",
    displayPrice: "19,99 €",
    active: true,
    sortOrder: 12000,
  }),
]);

// Deterministic model-pricing basis derived from the static live pack catalog.
// This intentionally does not query Stripe or env-config at generation runtime:
// Workers must calculate billing deterministically before provider calls.
export const BITBI_MODEL_PRICING_STRIPE_FEE_RATE = 0.0075;
export const BITBI_MODEL_PRICING_STRIPE_FIXED_FEE_CENTS = 25;

export function netAmountCentsForCreditPack(pack, {
  stripeFeeRate = BITBI_MODEL_PRICING_STRIPE_FEE_RATE,
  stripeFixedFeeCents = BITBI_MODEL_PRICING_STRIPE_FIXED_FEE_CENTS,
} = {}) {
  const amountCents = Number(pack?.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  return amountCents - (amountCents * stripeFeeRate) - stripeFixedFeeCents;
}

export function netEurPerCreditForPack(pack, options = {}) {
  const credits = Number(pack?.credits);
  if (!Number.isFinite(credits) || credits <= 0) return Infinity;
  const netCents = netAmountCentsForCreditPack(pack, options);
  if (!Number.isFinite(netCents) || netCents <= 0) return Infinity;
  return (netCents / 100) / credits;
}

export function lowestNetEurPerCreditFromPacks(packs = BITBI_LIVE_CREDIT_PACKS, options = {}) {
  const values = (Array.isArray(packs) ? packs : [])
    .filter((pack) => pack?.active !== false && String(pack?.currency || "").toLowerCase() === "eur")
    .map((pack) => netEurPerCreditForPack(pack, options))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    throw new Error("No active EUR credit pack can define model pricing.");
  }
  return Math.min(...values);
}

export const BITBI_LOWEST_LIVE_PACK_NET_EUR_PER_CREDIT =
  lowestNetEurPerCreditFromPacks(BITBI_LIVE_CREDIT_PACKS);
