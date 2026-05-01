import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveRuntimeCanaryPlan,
  runLiveRuntimeCanaryPlan,
} from "./lib/live-runtime-canary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function createCurrentContractFetch() {
  return async (url, init = {}) => {
    const requestUrl = String(url);
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    const cookie = headers.get("Cookie") || "";
    const origin = headers.get("Origin");

    const isMember = cookie.includes("__Host-bitbi_session=member-token");
    const isAdmin = cookie.includes("__Host-bitbi_session=admin-token");
    const hasAdminMfa = cookie.includes("__Host-bitbi_admin_mfa=admin-mfa-token");
    const isVerifiedAdmin = isAdmin && hasAdminMfa;

    if (requestUrl === "https://bitbi.ai/api/health" && method === "GET") {
      return jsonResponse({ ok: true, service: "bitbi-auth", message: "Auth worker is live" });
    }

    if (requestUrl === "https://bitbi.ai/api/me" && method === "GET") {
      if (isAdmin) {
        return jsonResponse({
          loggedIn: true,
          user: {
            id: "admin-1",
            email: "admin@example.com",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "active",
            role: "admin",
            verificationMethod: "email_verified",
            display_name: "Admin",
            has_avatar: false,
            avatar_url: null,
          },
        });
      }
      if (isMember) {
        return jsonResponse({
          loggedIn: true,
          user: {
            id: "member-1",
            email: "member@example.com",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "active",
            role: "user",
            verificationMethod: "email_verified",
            display_name: "Member",
            has_avatar: false,
            avatar_url: null,
          },
        });
      }
      return jsonResponse({ loggedIn: false, user: null });
    }

    if (requestUrl === "https://bitbi.ai/api/logout" && method === "POST") {
      assert.equal(origin, null);
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }

    if (requestUrl === "https://bitbi.ai/api/ai/assets" && method === "GET") {
      if (!cookie) return jsonResponse({ ok: false, error: "Not authenticated." }, 401);
      return jsonResponse({ ok: true, assets: [], next_cursor: null, has_more: false, applied_limit: 20 });
    }

    if (requestUrl === "https://bitbi.ai/api/profile" && method === "GET") {
      if (!isMember) {
        return jsonResponse({ ok: false, error: "Not authenticated." }, 401);
      }
      return jsonResponse({
        ok: true,
        profile: {
          display_name: "Member",
          bio: "",
          website: "",
          youtube_url: "",
        },
        account: {
          email: "member@example.com",
          role: "user",
          created_at: "2026-01-01T00:00:00.000Z",
          email_verified: true,
          verification_method: "email_verified",
        },
      });
    }

    if (requestUrl === "https://bitbi.ai/api/ai/quota" && method === "GET") {
      if (!isMember) {
        return jsonResponse({ ok: false, error: "Not authenticated." }, 401);
      }
      return jsonResponse({
        ok: true,
        data: {
          isAdmin: false,
          creditBalance: 8,
          dailyCreditAllowance: 10,
          dailyTopUp: {
            dayStart: "2026-05-01T00:00:00.000Z",
            grantedCredits: 0,
            reused: true,
          },
        },
      });
    }

    if (requestUrl === "https://bitbi.ai/api/admin/me" && method === "GET") {
      if (!cookie) return jsonResponse({ ok: false, error: "Not authenticated." }, 401);
      if (isMember) return jsonResponse({ ok: false, error: "Admin privileges required." }, 403);
      if (isAdmin && !hasAdminMfa) {
        return jsonResponse({
          ok: false,
          error: "Admin MFA verification required.",
          code: "admin_mfa_required",
          mfa: {
            enrolled: true,
            verified: false,
            setupPending: false,
            recoveryCodesRemaining: 8,
            method: "totp",
          },
        }, 403);
      }
      if (isVerifiedAdmin) {
        return jsonResponse({
          ok: true,
          user: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
            status: "active",
          },
        });
      }
    }

    if (requestUrl === "https://bitbi.ai/api/admin/users?limit=1" && method === "GET") {
      if (isVerifiedAdmin) {
        return jsonResponse({
          ok: true,
          users: [
            {
              id: "admin-1",
              email: "admin@example.com",
              role: "admin",
              status: "active",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
              email_verified_at: "2026-01-01T00:00:00.000Z",
              verification_method: "email_verified",
            },
          ],
          next_cursor: null,
          has_more: false,
          applied_limit: 1,
        });
      }
    }

    if (requestUrl === "https://bitbi.ai/api/admin/ai/models" && method === "GET") {
      if (!cookie) return jsonResponse({ ok: false, error: "Not authenticated.", code: "unauthorized" }, 401);
      if (isMember) return jsonResponse({ ok: false, error: "Admin privileges required.", code: "forbidden" }, 403);
      if (isAdmin && !hasAdminMfa) {
        return jsonResponse({ ok: false, error: "Admin MFA verification required.", code: "admin_mfa_required" }, 403);
      }
      if (isVerifiedAdmin) {
        return jsonResponse({
          ok: true,
          task: "models",
          models: {
            text: [{ id: "@cf/google/gemma-4-26b-a4b-it" }],
            image: [{ id: "@cf/black-forest-labs/flux-1-schnell" }],
            embeddings: [{ id: "@cf/baai/bge-base-en-v1.5" }],
            music: [{ id: "minimax/music-2.6" }],
            video: [{ id: "pixverse/v6" }],
          },
          presets: [],
        });
      }
    }

    if (requestUrl === "https://contact.bitbi.ai/" && method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "https://bitbi.ai",
        },
      });
    }

    if (requestUrl === "https://contact.bitbi.ai/" && method === "POST") {
      assert.equal(origin, "https://evil.example");
      return new Response("Forbidden", { status: 403 });
    }

    throw new Error(`Unexpected live canary request: ${method} ${requestUrl}`);
  };
}

{
  const plan = createLiveRuntimeCanaryPlan({ repoRoot, env: {} });
  assert.equal(plan.enabled, false);
  assert.equal(plan.suites.length, 3);
  assert(plan.suites.every((suite) => suite.skipped === true));
  assert.match(plan.suites[0].skippedReason, /BITBI_LIVE_ENABLE=1/);
}

assert.throws(
  () =>
    createLiveRuntimeCanaryPlan({
      repoRoot,
      env: {
        BITBI_LIVE_ENABLE: "1",
        BITBI_LIVE_AUTH_BASE_URL: "not-a-url",
      },
    }),
  /BITBI_LIVE_AUTH_BASE_URL/
);

assert.throws(
  () =>
    createLiveRuntimeCanaryPlan({
      repoRoot,
      env: {
        BITBI_LIVE_ENABLE: "1",
        BITBI_LIVE_ADMIN_COOKIE: "bitbi_session=legacy-admin-token",
      },
    }),
  /secure __Host-bitbi_session cookie/
);

assert.throws(
  () =>
    createLiveRuntimeCanaryPlan({
      repoRoot,
      env: {
        BITBI_LIVE_ENABLE: "1",
        BITBI_LIVE_MEMBER_EMAIL: "member@example.com",
      },
    }),
  /BITBI_LIVE_MEMBER_EMAIL requires/
);

{
  const plan = createLiveRuntimeCanaryPlan({
    repoRoot,
    env: {
      BITBI_LIVE_ENABLE: "1",
    },
  });
  assert.equal(plan.enabled, true);
  assert.equal(plan.authBaseUrl, "https://bitbi.ai");
  assert.equal(plan.contactBaseUrl, "https://contact.bitbi.ai");
  assert.deepEqual(
    plan.suites.map((suite) => [suite.id, suite.skipped, suite.checks.length]),
    [
      ["baseline", false, 8],
      ["member", true, 0],
      ["admin", true, 0],
    ]
  );
  assert(plan.suites[0].checks.some((check) => check.id === "admin-ai-unauthenticated"));
  assert(plan.suites[0].checks.some((check) => check.id === "contact-forbidden-origin"));
}

{
  const plan = createLiveRuntimeCanaryPlan({
    repoRoot,
    env: {
      BITBI_LIVE_ENABLE: "1",
      BITBI_LIVE_ADMIN_SESSION: "admin-token",
    },
  });

  assert.equal(plan.suites.find((suite) => suite.id === "admin")?.skipped, true);
  assert.match(
    plan.suites.find((suite) => suite.id === "admin")?.skippedReason || "",
    /BITBI_LIVE_ADMIN_MFA_TOKEN/
  );
}

{
  const plan = createLiveRuntimeCanaryPlan({
    repoRoot,
    env: {
      BITBI_LIVE_ENABLE: "1",
      BITBI_LIVE_MEMBER_SESSION: "member-token",
      BITBI_LIVE_MEMBER_EMAIL: "member@example.com",
      BITBI_LIVE_ADMIN_SESSION: "admin-token",
      BITBI_LIVE_ADMIN_MFA_TOKEN: "admin-mfa-token",
      BITBI_LIVE_ADMIN_EMAIL: "admin@example.com",
    },
  });

  const result = await runLiveRuntimeCanaryPlan(plan, {
    fetchImpl: createCurrentContractFetch(),
    logger: () => {},
  });

  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.passed.length, 16);
}

{
  const plan = createLiveRuntimeCanaryPlan({
    repoRoot,
    env: {
      BITBI_LIVE_ENABLE: "1",
    },
  });

  const result = await runLiveRuntimeCanaryPlan(plan, {
    fetchImpl: async (url, init = {}) => {
      if (String(url) === "https://bitbi.ai/api/health" && String(init.method || "GET").toUpperCase() === "GET") {
        return new Response("Not found", { status: 404 });
      }
      return createCurrentContractFetch()(url, init);
    },
    logger: () => {},
  });

  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, "auth-health");
  assert.match(result.failed[0].message, /expected 200, got 404/);
  assert.equal(result.passed.length, 7);
}

console.log("Live runtime canary tests passed.");
