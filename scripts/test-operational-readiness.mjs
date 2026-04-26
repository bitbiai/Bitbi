import assert from "node:assert/strict";
import {
  buildHealthTargets,
  evaluateHealthTargets,
  evaluateSecurityHeaders,
  sanitizeUrlForDisplay,
  validateOperationalReadinessFiles,
} from "./lib/operational-readiness.mjs";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: init.headers || { "content-type": "application/json" },
  });
}

{
  const targets = buildHealthTargets({
    args: ["--base-url", "https://bitbi.example/path?token=do-not-print"],
    env: {},
  });
  assert.deepEqual(
    targets.map((target) => [target.id, new URL(target.url).pathname]),
    [["auth", "/api/health"]]
  );
}

{
  const targets = buildHealthTargets({
    args: [
      "--ai-base-url",
      "https://ai.example/internal?token=do-not-print",
      "--contact-base-url",
      "https://contact.example/contact",
    ],
    env: {},
  });
  assert.deepEqual(
    targets.map((target) => [target.id, new URL(target.url).origin, new URL(target.url).pathname]),
    [
      ["ai", "https://ai.example", "/health"],
      ["contact", "https://contact.example", "/health"],
    ]
  );
}

{
  const targets = buildHealthTargets({
    args: [],
    env: { BITBI_BASE_URL: "https://bitbi.example" },
  });
  assert.deepEqual(
    targets.map((target) => [target.id, new URL(target.url).pathname]),
    [["auth", "/api/health"]]
  );
}

{
  const result = await evaluateHealthTargets({ targets: [], requireLive: false });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.checks[0].status, "SKIPPED");
}

{
  const result = await evaluateHealthTargets({ targets: [], requireLive: true });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.checks[0].status, "FAIL");
}

{
  const result = await evaluateHealthTargets({
    targets: [{ id: "auth", url: "https://auth.example/api/health?secret=not-printed" }],
    fetchImpl: async () => jsonResponse({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks[0].status, "PASS");
  assert(!result.checks[0].message.includes("not-printed"));
}

{
  const result = await evaluateHealthTargets({
    targets: [{ id: "auth", url: "https://auth.example/api/health" }],
    fetchImpl: async () => jsonResponse({ ok: false }, { status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].status, "FAIL");
}

{
  const result = await evaluateSecurityHeaders({ baseUrl: "", requireLive: false });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
}

{
  const result = await evaluateSecurityHeaders({ baseUrl: "", requireLive: true });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
}

{
  const headers = new Headers({
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  });
  const result = await evaluateSecurityHeaders({
    baseUrl: "https://bitbi.example/?token=not-printed",
    fetchImpl: async () => new Response("<!doctype html>", { status: 200, headers }),
  });
  assert.equal(result.ok, true);
  assert(result.checks.some((check) => check.id === "header:x-content-type-options" && check.status === "PASS"));
  assert(result.checks.some((check) => check.id === "header:content-security-policy" && check.status === "MANUAL"));
  assert(!result.checks.map((check) => check.message).join("\n").includes("not-printed"));
}

{
  const result = await evaluateSecurityHeaders({
    baseUrl: "https://bitbi.example/",
    fetchImpl: async () => new Response("<!doctype html>", { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert(result.checks.some((check) => check.id === "header:x-content-type-options" && check.status === "FAIL"));
}

{
  assert.equal(
    sanitizeUrlForDisplay("https://bitbi.example/path?secret=not-printed"),
    "https://bitbi.example"
  );
}

{
  const result = validateOperationalReadinessFiles({ repoRoot: process.cwd() });
  assert.equal(typeof result.ok, "boolean");
  assert(result.checks.length > 0);
}

console.log("Operational readiness tests passed.");
