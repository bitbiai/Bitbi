import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectReadinessEvidence,
  renderReadinessEvidenceMarkdown,
  writeReadinessEvidenceMarkdown,
} from "./lib/readiness-evidence.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const secretValue = "super-secret-test-value-should-not-print";
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
assert.equal(evidence.release.latestAuthMigration, "0054_add_platform_budget_repair_actions.sql");
assert.equal(evidence.localChecks.mode, "skipped");
assert.equal(evidence.liveChecks.mode, "skipped");
assert(markdown.includes("Final verdict: **BLOCKED**"));
assert(markdown.includes("Latest auth D1 migration"));
assert(markdown.includes("0054_add_platform_budget_repair_actions.sql"));
assert(markdown.includes("`SESSION_SECRET` | present (value redacted)"));
assert(markdown.includes("`STRIPE_SECRET_KEY` | present (value redacted)"));
assert(markdown.includes("`STRIPE_WEBHOOK_SECRET` | missing"));
assert(markdown.includes("LIVE/STAGING") || markdown.includes("Live/Staging"));
assert(!markdown.includes(secretValue));
assert(!markdown.includes("https://example.invalid"));
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
  assert.equal(calls.length, 4);
  assert(calls.every((call) => call.options?.method === "GET"));
  assert(calls.every((call) => !call.url.includes(secretValue)));
  assert(calls.some((call) => call.url === "https://auth.example.test/api/health"));
  assert(calls.some((call) => call.url === "https://ai.example.test/health"));
  assert(calls.some((call) => call.url === "https://contact.example.test/health"));
  assert(liveMarkdown.includes("Evidence collected: **true**"));
  assert(liveMarkdown.includes("Operator review required: **true**"));
  assert(liveMarkdown.includes("Final verdict: **BLOCKED**"));
  assert(liveMarkdown.includes("Latest auth D1 migration"));
  assert(liveMarkdown.includes("0054_add_platform_budget_repair_actions.sql"));
  assert(liveMarkdown.includes("`Cache-Control`: `no-store`"));
  assert(!liveMarkdown.includes(secretValue));
  assert(!liveMarkdown.includes("Set-Cookie"));
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

console.log("Readiness evidence tests passed.");
