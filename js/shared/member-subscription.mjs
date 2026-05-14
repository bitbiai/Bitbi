export const BITBI_MEMBER_SUBSCRIPTION = Object.freeze({
  id: "bitbi_pro_monthly",
  name: "BITBI Pro",
  allowanceCredits: 6000,
  storageLimitBytes: 5 * 1024 * 1024 * 1024,
  amountCents: 999,
  currency: "eur",
  displayPrice: "9,99 €",
  interval: "month",
});

export const BITBI_MEMBER_SUBSCRIPTION_CREDIT_ALLOWANCE =
  BITBI_MEMBER_SUBSCRIPTION.allowanceCredits;

export const BITBI_MEMBER_SUBSCRIPTION_STORAGE_LIMIT_BYTES =
  BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes;
