import fs from "node:fs";
import path from "node:path";

const EVIDENCE_OUTPUT_DIR = "docs/production-readiness/evidence";

const BILLING_LIVE_ENV_NAMES = Object.freeze([
  "ENABLE_LIVE_STRIPE_CREDIT_PACKS",
  "ENABLE_LIVE_STRIPE_SUBSCRIPTIONS",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_LIVE_CHECKOUT_SUCCESS_URL",
  "STRIPE_LIVE_CHECKOUT_CANCEL_URL",
  "STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL",
  "STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL",
  "STRIPE_MODE",
]);

const REQUIRED_EVIDENCE = Object.freeze([
  ["live_credit_pack_checkout_canary", "Live credit-pack checkout canary"],
  ["live_subscription_checkout_canary", "Live subscription checkout canary"],
  ["webhook_receipt", "Verified webhook receipt evidence"],
  ["duplicate_webhook_idempotency", "Duplicate webhook idempotency evidence"],
  ["wrong_price_id_rejection", "Wrong Price ID rejection evidence"],
  ["missing_webhook_secret_fail_closed", "Missing webhook secret fail-closed evidence"],
  ["no_credit_before_webhook", "No-credit-before-webhook evidence"],
  ["invoice_paid_subscription_grant", "invoice.paid subscription credit grant evidence"],
  ["refund_dispute_failure_review", "Refund/dispute/payment-failure review evidence"],
  ["raw_payload_signature_secret_redaction", "No raw payload/signature/secret rendering evidence"],
]);

const SENSITIVE_KEY_PATTERN = /secret|token|password|signature|raw|payload|authorization|cookie|session|payment_?method|card|source/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec|Stripe-Signature|Bearer\s+|pm_[A-Za-z0-9]|card=|token=|secret=|password=)[A-Za-z0-9_:=+./-]*/i;
const SENSITIVE_VALUE_REDACT_PATTERN = /\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec|Stripe-Signature|Bearer\s+|pm_[A-Za-z0-9]|card=|token=|secret=|password=)[A-Za-z0-9_:=+./-]*/gi;

function envPresence(env, names) {
  return names.map((name) => ({
    name,
    present: Object.prototype.hasOwnProperty.call(env, name) && String(env[name] || "").trim() !== "",
    value: "[redacted]",
  }));
}

function sanitizeEvidenceValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeEvidenceValue);
  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeEvidenceValue(nested);
    }
    return out;
  }
  const text = String(value);
  return SENSITIVE_VALUE_PATTERN.test(text) ? text.replace(SENSITIVE_VALUE_REDACT_PATTERN, "[redacted]") : value;
}

export function createBillingCanaryEvidenceSkeleton({
  env = process.env,
  generatedAt = new Date().toISOString(),
  operatorFields = {},
} = {}) {
  return {
    reportVersion: "current-baseline-billing-canary-evidence-v1",
    generatedAt,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    status: "blocked_pending_operator_evidence",
    mode: "local_template_only",
    stripeCallsMade: false,
    checkoutSessionCreated: false,
    webhookSent: false,
    creditMutationPerformed: false,
    subscriptionMutationPerformed: false,
    refundIssued: false,
    livePaymentTriggered: false,
    operatorFields: sanitizeEvidenceValue({
      operator: "",
      environment: "",
      evidenceDate: "",
      notes: "",
      artifactPaths: [],
      ...operatorFields,
    }),
    configPresence: envPresence(env, BILLING_LIVE_ENV_NAMES),
    requiredEvidence: REQUIRED_EVIDENCE.map(([id, label]) => ({
      id,
      label,
      status: "pending_operator_evidence",
      evidencePath: "",
      notes: "",
    })),
    safetyAssertions: [
      "This skeleton performs no Stripe calls.",
      "This skeleton creates no checkout sessions.",
      "This skeleton sends no webhooks.",
      "This skeleton grants, reverses, or claws back no credits.",
      "This skeleton mutates no subscriptions, refunds, disputes, Cloudflare, D1, R2, Queues, GitHub, or provider state.",
      "Raw Stripe payloads, signatures, webhook secrets, API keys, payment methods, cookies, and session tokens must not be pasted into evidence.",
      "Live billing readiness remains blocked until operator canary evidence is attached, sanitized, and reviewed.",
    ],
    operatorChecklist: [
      "Attach sanitized live credit-pack checkout canary evidence.",
      "Attach sanitized live subscription checkout canary evidence.",
      "Attach verified webhook receipt and duplicate idempotency evidence.",
      "Attach wrong Price ID rejection and missing webhook secret fail-closed evidence.",
      "Attach no-credit-before-webhook and invoice.paid grant evidence.",
      "Attach refund/dispute/payment-failure review-only evidence.",
      "Confirm raw payloads, signatures, secrets, payment methods, cookies, and session tokens are absent.",
    ],
  };
}

function formatPresenceRows(rows) {
  return rows
    .map((entry) => `| \`${entry.name}\` | ${entry.present ? "present (value redacted)" : "missing"} |`)
    .join("\n");
}

export function renderBillingCanaryEvidenceMarkdown(evidence) {
  const requiredRows = evidence.requiredEvidence
    .map((entry) => `| ${entry.id} | ${entry.label} | ${entry.status} | ${entry.evidencePath || "operator to fill"} |`)
    .join("\n");
  const assertions = evidence.safetyAssertions.map((item) => `- ${item}`).join("\n");
  const checklist = evidence.operatorChecklist.map((item) => `- [ ] ${item}`).join("\n");
  return `# Billing Canary Evidence Skeleton

Generated: ${evidence.generatedAt}

Final verdict: **BLOCKED**

- Production readiness: **${evidence.productionReadiness}**
- Live billing readiness: **${evidence.liveBillingReadiness}**
- Mode: **${evidence.mode}**
- Stripe calls made: **${evidence.stripeCallsMade}**
- Checkout session created: **${evidence.checkoutSessionCreated}**
- Webhook sent: **${evidence.webhookSent}**
- Credit mutation performed: **${evidence.creditMutationPerformed}**
- Subscription mutation performed: **${evidence.subscriptionMutationPerformed}**
- Refund issued: **${evidence.refundIssued}**

## Live Billing Config Presence

| Name | Status |
| --- | --- |
${formatPresenceRows(evidence.configPresence)}

## Required Evidence

| Evidence | Label | Status | Artifact |
| --- | --- | --- | --- |
${requiredRows}

## Operator Fields

| Field | Value |
| --- | --- |
| Operator | ${evidence.operatorFields.operator || "operator to fill"} |
| Environment | ${evidence.operatorFields.environment || "operator to fill"} |
| Evidence date | ${evidence.operatorFields.evidenceDate || "operator to fill"} |
| Notes | ${evidence.operatorFields.notes || "operator to fill"} |

## Safety Assertions

${assertions}

## Operator Checklist

${checklist}
`;
}

export function assertBillingEvidenceIsRedacted(text) {
  if (SENSITIVE_VALUE_PATTERN.test(String(text || ""))) {
    throw new Error("Billing evidence output contains a raw secret, signature, token, or payment method value.");
  }
  return true;
}

export function resolveBillingEvidenceOutputPath(repoRoot, outputPath, { force = false } = {}) {
  if (!outputPath) throw new Error("An output path is required.");
  const allowedRoot = path.resolve(repoRoot, EVIDENCE_OUTPUT_DIR);
  const target = path.resolve(repoRoot, outputPath);
  if (target !== allowedRoot && !target.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Output path must be under ${EVIDENCE_OUTPUT_DIR}/`);
  }
  if (fs.existsSync(target) && !force) {
    throw new Error("Output file already exists. Pass --force to overwrite.");
  }
  return target;
}

export function writeBillingCanaryEvidence(repoRoot, outputPath, content, { force = false } = {}) {
  const target = resolveBillingEvidenceOutputPath(repoRoot, outputPath, { force });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}
