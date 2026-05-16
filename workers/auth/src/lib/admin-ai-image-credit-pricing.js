import {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
  FLUX_1_SCHNELL_IMAGE_MODEL_ID,
  FLUX_2_KLEIN_IMAGE_MODEL_IDS,
  GPT_IMAGE_2_MODEL_ID,
  calculateAiImageCreditCost,
  isPricedAiImageModel,
} from "./ai-image-credit-pricing.js";

export {
  BITBI_MODEL_PRICING_USD_TO_EUR,
  BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING,
  BITBI_TARGET_PROFIT_MARGIN,
  FLUX_1_SCHNELL_IMAGE_MODEL_ID as ADMIN_IMAGE_TEST_FLUX_1_SCHNELL_MODEL_ID,
  FLUX_2_KLEIN_IMAGE_MODEL_IDS as ADMIN_IMAGE_TEST_FLUX_2_KLEIN_MODEL_IDS,
  GPT_IMAGE_2_MODEL_ID as ADMIN_IMAGE_TEST_GPT_IMAGE_2_MODEL_ID,
  calculateAiImageCreditCost as calculateAdminImageTestCreditCost,
  isPricedAiImageModel as isChargeableAdminImageTestModel,
};

export const ADMIN_IMAGE_TEST_FLUX_2_DEV_MODEL_ID = "@cf/black-forest-labs/flux-2-dev";
export const ADMIN_IMAGE_TEST_UNMETERED_KILL_SWITCH = "ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS";

export const ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS = Object.freeze({
  CHARGED_ADMIN_ORG_CREDIT: "charged_admin_org_credit",
  EXPLICIT_UNMETERED_ADMIN: "explicit_unmetered_admin",
  BLOCKED_UNSUPPORTED: "blocked_unsupported",
});

function providerFamilyForAdminImageModel(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (id.includes("openai") || id.includes("gpt-image")) return "openai";
  if (id.includes("black-forest-labs") || id.includes("flux")) return "bfl";
  return "ai_worker";
}

function chargedBranch(modelId) {
  return Object.freeze({
    modelId,
    providerFamily: providerFamilyForAdminImageModel(modelId),
    supportStatus: "supported_priced",
    budgetClassification: ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.CHARGED_ADMIN_ORG_CREDIT,
    providerCostBearing: true,
    requiredActorBoundary: "platform_admin_with_selected_organization",
    idempotencyPolicy: "required",
    callerPolicyStatus: "budget_policy_enforced",
    budgetScope: "admin_org_credit_account",
    killSwitchTarget: providerFamilyForAdminImageModel(modelId) === "openai"
      ? "ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET"
      : "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET",
    modelResolverKey: "admin.image.priced_model_catalog",
    notes: "Existing charged Admin image-test path; selected organization credits, Idempotency-Key, no-charge-on-provider-failure, and exactly-once debit remain unchanged.",
  });
}

const CHARGED_MODEL_IDS = Object.freeze([
  FLUX_1_SCHNELL_IMAGE_MODEL_ID,
  ...FLUX_2_KLEIN_IMAGE_MODEL_IDS,
  GPT_IMAGE_2_MODEL_ID,
]);

const CHARGED_BRANCHES = Object.freeze(CHARGED_MODEL_IDS.map(chargedBranch));

const EXPLICIT_UNMETERED_BRANCHES = Object.freeze([
  Object.freeze({
    modelId: ADMIN_IMAGE_TEST_FLUX_2_DEV_MODEL_ID,
    providerFamily: "bfl",
    supportStatus: "supported_admin_exception",
    budgetClassification: ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.EXPLICIT_UNMETERED_ADMIN,
    providerCostBearing: true,
    requiredActorBoundary: "admin_only_lab_exception",
    idempotencyPolicy: "optional",
    callerPolicyStatus: "explicit_unmetered",
    budgetScope: "explicit_unmetered_admin",
    killSwitchTarget: ADMIN_IMAGE_TEST_UNMETERED_KILL_SWITCH,
    modelResolverKey: "admin.image.explicit_unmetered_model_registry",
    unmeteredJustification: "FLUX.2 Dev is retained as a narrow admin-only lab exception for structured prompt/reference-image experiments while pricing, live budget caps, and runtime kill-switch enforcement remain future work.",
    notes: "No credits are debited and no durable replay/idempotency is claimed; Phase 4.14 makes the exception explicit, budget-visible, and caller-policy-tagged.",
  }),
]);

const CLASSIFICATION_BY_MODEL_ID = new Map([
  ...CHARGED_BRANCHES.map((branch) => [branch.modelId, branch]),
  ...EXPLICIT_UNMETERED_BRANCHES.map((branch) => [branch.modelId, branch]),
]);

export function getAdminImageTestBranchClassification(modelId) {
  const id = String(modelId || "").trim();
  return CLASSIFICATION_BY_MODEL_ID.get(id) || Object.freeze({
    modelId: id || null,
    providerFamily: providerFamilyForAdminImageModel(id),
    supportStatus: "not_allowlisted_or_unbudgeted",
    budgetClassification: ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.BLOCKED_UNSUPPORTED,
    providerCostBearing: false,
    requiredActorBoundary: "blocked_before_provider_call",
    idempotencyPolicy: "not_applicable",
    callerPolicyStatus: "not_applicable",
    budgetScope: null,
    killSwitchTarget: null,
    modelResolverKey: "admin.image.model_registry",
    notes: "Admin image model is not explicitly classified for provider execution and must be blocked before AI Worker/provider calls.",
  });
}

export function listAdminImageTestBranchClassifications() {
  return Object.freeze([...CHARGED_BRANCHES, ...EXPLICIT_UNMETERED_BRANCHES]);
}

export function isExplicitUnmeteredAdminImageTestModel(modelId) {
  return getAdminImageTestBranchClassification(modelId).budgetClassification
    === ADMIN_IMAGE_TEST_BUDGET_CLASSIFICATIONS.EXPLICIT_UNMETERED_ADMIN;
}
