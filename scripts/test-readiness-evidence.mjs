import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectReadinessEvidence,
  renderReadinessEvidenceMarkdown,
  writeReadinessEvidenceMarkdown,
} from "./lib/readiness-evidence.mjs";
import {
  assertBillingEvidenceIsRedacted,
  createBillingCanaryEvidenceSkeleton,
  renderBillingCanaryEvidenceMarkdown,
  writeBillingCanaryEvidence,
} from "./lib/billing-canary-evidence.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const releaseCompat = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "config", "release-compat.json"), "utf8")
);
const expectedLatestAuthMigration = releaseCompat.release.schemaCheckpoints.auth.latest;
const secretValue = "super-secret-test-value-should-not-print";

function markdownHttpUrls(markdownText) {
  const urls = [];
  const candidates = String(markdownText || "").split(/[\s<>()\[\]`"'|]+/);
  for (const candidate of candidates) {
    const trimmed = candidate.replace(/[.,;!?]+$/g, "");
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      urls.push(parsed);
    }
  }
  return urls;
}

function markdownContainsUrlOrigin(markdownText, expectedUrl) {
  const expected = new URL(expectedUrl);
  return markdownHttpUrls(markdownText).some((url) => (
    url.protocol === expected.protocol &&
    url.hostname === expected.hostname &&
    url.port === expected.port
  ));
}

const evidence = await collectReadinessEvidence({
  repoRoot,
  env: {
    SESSION_SECRET: secretValue,
    STRIPE_SECRET_KEY: secretValue,
    BITBI_READINESS_LIVE_BASE_URL: "https://example.invalid",
  },
});
const markdown = renderReadinessEvidenceMarkdown(evidence);

assert.equal(evidence.verdict, "BLOCKED");
assert.equal(evidence.release.latestAuthMigration, expectedLatestAuthMigration);
assert.equal(evidence.localChecks.mode, "skipped");
assert.equal(evidence.localSafetyContracts.every((entry) => entry.status === "PASS"), true);
assert.equal(evidence.liveChecks.mode, "skipped");
assert(markdown.includes("Final verdict: **BLOCKED**"));
assert(markdown.includes("Latest auth D1 migration"));
assert(markdown.includes(expectedLatestAuthMigration));
assert(markdown.includes("Local Safety Canary Contracts"));
assert(markdown.includes("auth-ai-caller-policy-release-contract"));
assert(markdown.includes("fetch-metadata-cross-site-write-guard"));
assert(markdown.includes("`SESSION_SECRET` | present (value redacted)"));
assert(markdown.includes("`STRIPE_SECRET_KEY` | present (value redacted)"));
assert(markdown.includes("`STRIPE_WEBHOOK_SECRET` | missing"));
assert(markdown.includes("LIVE/STAGING") || markdown.includes("Live/Staging"));
assert(!markdown.includes(secretValue));
assert.equal(markdownContainsUrlOrigin(markdown, "https://example.invalid"), false);
assert(markdown.includes("SKIPPED: Live/staging checks are skipped"));

{
  let fetchCalled = false;
  const withoutUrls = await collectReadinessEvidence({
    repoRoot,
    includeLive: true,
    fetchImpl() {
      fetchCalled = true;
      throw new Error("fetch should not be called without explicit URLs");
    },
  });
  assert.equal(fetchCalled, false);
  assert.equal(withoutUrls.verdict, "BLOCKED");
  assert.equal(withoutUrls.evidenceCollected, false);
  assert.equal(withoutUrls.operatorReviewRequired, true);
  assert.equal(withoutUrls.liveChecks.mode, "skipped");
  assert.match(withoutUrls.liveChecks.reason, /no explicit URLs/i);
}

{
  const calls = [];
  const liveEvidence = await collectReadinessEvidence({
    repoRoot,
    includeLive: true,
    urls: {
      staticUrl: `https://static.example.test/path?token=${secretValue}`,
      authWorkerUrl: `https://auth.example.test/anything?token=${secretValue}`,
      aiWorkerUrl: "https://ai.example.test",
      contactWorkerUrl: "https://contact.example.test",
    },
    env: {
      STRIPE_LIVE_SECRET_KEY: secretValue,
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (url.includes("__readiness_missing_route__")) {
        return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const body = JSON.stringify({
        ok: true,
        service: url.includes("auth")
          ? "bitbi-auth"
          : url.includes("ai")
            ? "bitbi-ai"
            : "bitbi-contact",
        status: "ok",
        secret: secretValue,
      });
      return new Response(body, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "X-Content-Type-Options": "nosniff",
          "Set-Cookie": `session=${secretValue}`,
        },
      });
    },
  });
  const liveMarkdown = renderReadinessEvidenceMarkdown(liveEvidence);
  assert.equal(liveEvidence.verdict, "BLOCKED");
  assert.equal(liveEvidence.evidenceCollected, true);
  assert.equal(liveEvidence.operatorReviewRequired, true);
  assert.equal(liveEvidence.liveChecks.mode, "checked");
  assert.equal(calls.length, 5);
  assert(calls.every((call) => call.options?.method === "GET"));
  assert(calls.every((call) => !call.url.includes(secretValue)));
  assert(calls.some((call) => call.url === "https://auth.example.test/api/health"));
  assert(calls.some((call) => call.url === "https://auth.example.test/api/__readiness_missing_route__"));
  assert(calls.some((call) => call.url === "https://ai.example.test/health"));
  assert(calls.some((call) => call.url === "https://contact.example.test/health"));
  assert(liveMarkdown.includes("Evidence collected: **true**"));
  assert(liveMarkdown.includes("Operator review required: **true**"));
  assert(liveMarkdown.includes("Final verdict: **BLOCKED**"));
  assert(liveMarkdown.includes("Latest auth D1 migration"));
  assert(liveMarkdown.includes(expectedLatestAuthMigration));
  assert(liveMarkdown.includes("`Cache-Control`: `no-store`"));
  assert(!liveMarkdown.includes(secretValue));
  assert(!liveMarkdown.includes("Set-Cookie"));
}

{
  const calls = [];
  const adminPending = await collectReadinessEvidence({
    repoRoot,
    includeLive: true,
    urls: {
      adminReadinessUrl: `https://bitbi.ai/api/admin/readiness/status?token=${secretValue}`,
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      throw new Error("fetch should not be called without admin readiness cookie");
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(adminPending.liveChecks.mode, "checked");
  assert(adminPending.liveChecks.results.some((result) =>
    result.id === "admin-readiness-status" &&
    result.mode === "skipped" &&
    /BITBI_READINESS_ADMIN_COOKIE/.test(result.reason)
  ));
}

{
  const calls = [];
  const adminCookie = `__Host-bitbi_session=${secretValue}; __Host-bitbi_admin_mfa=${secretValue}`;
  const adminEvidence = await collectReadinessEvidence({
    repoRoot,
    includeLive: true,
    urls: {
      adminReadinessUrl: `https://bitbi.ai/api/admin/readiness/status?token=${secretValue}`,
    },
    env: {
      BITBI_READINESS_ADMIN_COOKIE: adminCookie,
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (url.endsWith("/api/admin/readiness/status")) {
        return new Response(JSON.stringify({
        ok: true,
        version: "omega-p1-readiness-dashboard-v1",
        releaseTruth: {
          latestAuthMigration: expectedLatestAuthMigration,
          deployVerificationRequired: true,
        },
        liveEvidenceState: {
          status: "live_evidence_pending",
        },
        runtimeSafetyGates: [
          {
            id: "legacy_media_reset_confirmed_execution",
            enabled: false,
          },
        ],
        blockedClaims: [
          { id: "production_readiness", status: "blocked" },
        ],
        secret: secretValue,
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Set-Cookie": `session=${secretValue}`,
          },
        });
      }
      return new Response(JSON.stringify({ ok: true, status: "blocked", secret: secretValue }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Set-Cookie": `session=${secretValue}`,
        },
      });
    },
  });
  const adminMarkdown = renderReadinessEvidenceMarkdown(adminEvidence);
  assert.equal(calls.length, 4);
  assert(calls.every((call) => call.options?.method === "GET"));
  assert(calls.every((call) => call.options?.headers?.Cookie === adminCookie));
  assert(calls.every((call) => !call.url.includes(secretValue)));
  assert(calls.some((call) => call.url.endsWith("/api/admin/billing/evidence/status")));
  assert(calls.some((call) => call.url.endsWith("/api/admin/operations/timeline")));
  assert(calls.some((call) => call.url.endsWith("/api/admin/tenant-assets/domains/evidence")));
  assert(adminEvidence.liveChecks.results.some((result) =>
    result.id === "admin-readiness-status" &&
    result.mode === "checked" &&
    result.json.fields.latestAuthMigration === expectedLatestAuthMigration &&
    result.json.fields.resetConfirmedExecutionEnabled === false
  ));
  assert(adminMarkdown.includes("latestAuthMigration"));
  assert(adminMarkdown.includes("resetConfirmedExecutionEnabled=false"));
  assert(!adminMarkdown.includes(secretValue));
  assert(!adminMarkdown.includes("Set-Cookie"));
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-readiness-output-"));
  assert.throws(
    () => writeReadinessEvidenceMarkdown(tmp, "outside.md", "blocked"),
    /docs\/production-readiness\/evidence/
  );
  const output = "docs/production-readiness/evidence/2026-05-15-staging-readiness.md";
  const relativePath = writeReadinessEvidenceMarkdown(tmp, output, "first");
  assert.equal(relativePath, output);
  assert.equal(fs.readFileSync(path.join(tmp, output), "utf8"), "first");
  assert.throws(
    () => writeReadinessEvidenceMarkdown(tmp, output, "second"),
    /already exists/
  );
  writeReadinessEvidenceMarkdown(tmp, output, "second", { force: true });
  assert.equal(fs.readFileSync(path.join(tmp, output), "utf8"), "second");
}

{
  const rawSecret = "sk_live_billing_canary_should_not_print";
  const rawWebhookSecret = "whsec_billing_canary_should_not_print";
  const rawSignature = "Stripe-Signature t=1,v1=unsafe";
  let fetchCalled = false;
  const skeleton = createBillingCanaryEvidenceSkeleton({
    env: {
      STRIPE_LIVE_SECRET_KEY: rawSecret,
      STRIPE_LIVE_WEBHOOK_SECRET: rawWebhookSecret,
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: "price_live_canary_123456",
    },
    operatorFields: {
      operator: "Billing Operator",
      notes: `Do not render ${rawSecret} or ${rawSignature}`,
      rawPayload: { payment_method: "pm_card_should_not_print" },
    },
    fetchImpl() {
      fetchCalled = true;
    },
  });
  const billingMarkdown = renderBillingCanaryEvidenceMarkdown(skeleton);
  assert.equal(fetchCalled, false);
  assert.equal(skeleton.productionReadiness, "blocked");
  assert.equal(skeleton.liveBillingReadiness, "blocked");
  assert.equal(skeleton.stripeCallsMade, false);
	  assert.equal(skeleton.checkoutSessionCreated, false);
	  assert.equal(skeleton.creditMutationPerformed, false);
	  assert.equal(skeleton.nextOperatorActions.length, 6);
	  assert(skeleton.requiredEvidence.every((entry) => entry.status === "pending_operator_evidence"));
	  assert(billingMarkdown.includes("Final verdict: **BLOCKED**"));
	  assert(billingMarkdown.includes("Next Operator Actions"));
	  assert(billingMarkdown.includes("Export Admin -> Finance -> Live Billing redacted status"));
	  assert(billingMarkdown.includes("Live credit-pack checkout canary"));
  assert(billingMarkdown.includes("invoice.paid subscription credit grant evidence"));
  assert(billingMarkdown.includes("Stripe Customer Portal session canary"));
  assert(billingMarkdown.includes("Stripe Tax/invoice configuration review"));
  assert(billingMarkdown.includes("present (value redacted)"));
  assert(!billingMarkdown.includes(rawSecret));
  assert(!billingMarkdown.includes(rawWebhookSecret));
  assert(!billingMarkdown.includes(rawSignature));
  assert(!billingMarkdown.includes("pm_card_should_not_print"));
  assertBillingEvidenceIsRedacted(billingMarkdown);
  assert.throws(
    () => assertBillingEvidenceIsRedacted(`unsafe ${rawSecret}`),
    /raw secret/
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-billing-evidence-output-"));
  const output = "docs/production-readiness/evidence/2026-05-18-billing-canary.md";
  const relativePath = writeBillingCanaryEvidence(tmp, output, billingMarkdown);
  assert.equal(relativePath, output);
  assert.equal(fs.readFileSync(path.join(tmp, output), "utf8"), billingMarkdown);
  assert.throws(
    () => writeBillingCanaryEvidence(tmp, "billing-canary.md", billingMarkdown),
    /docs\/production-readiness\/evidence/
  );

  const imported = createBillingCanaryEvidenceSkeleton({
    adminStatus: {
      version: "omega-p1-live-billing-readiness-v1",
      generatedAt: "2026-05-18T16:05:00.000Z",
      liveBillingReadiness: "blocked",
      stripeCallsMade: false,
	      evidenceChecklist: [
	        { id: "customer_portal_session_canary", status: "pending_operator_evidence" },
	        { id: "tax_invoice_configuration_review", status: "pending_operator_review" },
	      ],
	      nextOperatorActions: [
	        {
	          id: "export_redacted_status",
	          label: `Export status without ${rawWebhookSecret}`,
	          safeAction: "Download sanitized evidence only.",
	        },
	      ],
	      secretValue: rawSecret,
	    },
	  });
	  const importedMarkdown = renderBillingCanaryEvidenceMarkdown(imported);
	  assert(importedMarkdown.includes("Imported Admin Status"));
	  assert(importedMarkdown.includes("omega-p1-live-billing-readiness-v1"));
	  assert(importedMarkdown.includes("Export status without [redacted]"));
	  assert(!importedMarkdown.includes(rawSecret));
	  assert(!importedMarkdown.includes(rawWebhookSecret));
	  assertBillingEvidenceIsRedacted(importedMarkdown);
	}

console.log("Readiness evidence tests passed.");
