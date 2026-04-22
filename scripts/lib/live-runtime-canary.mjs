import fs from "node:fs";
import path from "node:path";
import {
  SECURE_ADMIN_MFA_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from "../../workers/auth/src/lib/cookies.js";
import { parseJsonc } from "./release-compat.mjs";

export const DEFAULT_AUTH_BASE_URL = "https://bitbi.ai";
export const DEFAULT_CONTACT_BASE_URL = "https://contact.bitbi.ai";
export const DEFAULT_TIMEOUT_MS = 10_000;

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const SAFE_ALLOWED_ORIGIN = "https://bitbi.ai";
const FORBIDDEN_ORIGIN = "https://evil.example";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLiveCanaryEnabled(env) {
  return ENABLED_VALUES.has(String(env.BITBI_LIVE_ENABLE || "").trim().toLowerCase());
}

function normalizeBaseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https.`);
  }
  if (url.pathname && url.pathname !== "/") {
    throw new Error(`${label} must not include a path.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not include a query string or fragment.`);
  }

  return url.origin;
}

function normalizeTimeoutMs(value) {
  if (!isNonEmptyString(value)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("BITBI_LIVE_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function containsSecureSessionCookie(cookieHeader) {
  return new RegExp(`(?:^|;\\s*)${SECURE_SESSION_COOKIE_NAME}=`).test(cookieHeader);
}

function containsNamedCookie(cookieHeader, cookieName) {
  return new RegExp(`(?:^|;\\s*)${cookieName}=`).test(cookieHeader);
}

function normalizeCookieHeader(value, label) {
  if (!isNonEmptyString(value)) return null;
  const header = String(value).trim();
  if (/[\r\n\u0000]/.test(header)) {
    throw new Error(`${label} must not contain control characters.`);
  }
  return header;
}

function normalizeSessionToken(value, label) {
  if (!isNonEmptyString(value)) return null;
  const token = String(value).trim();
  if (/[\s;=\r\n\u0000]/.test(token)) {
    throw new Error(`${label} must be a single session token without separators.`);
  }
  return token;
}

function resolveCookieCredential({
  cookieHeader,
  sessionToken,
  requireSecureCookie = false,
  label,
}) {
  const normalizedCookie = normalizeCookieHeader(cookieHeader, `${label} cookie`);
  const normalizedToken = normalizeSessionToken(sessionToken, `${label} session token`);

  if (normalizedCookie && normalizedToken) {
    throw new Error(`${label} credentials must provide either a cookie header or a session token, not both.`);
  }

  const header = normalizedCookie || (
    normalizedToken ? `${SECURE_SESSION_COOKIE_NAME}=${normalizedToken}` : null
  );

  if (requireSecureCookie && header && !containsSecureSessionCookie(header)) {
    throw new Error(`${label} credentials must include the secure ${SECURE_SESSION_COOKIE_NAME} cookie.`);
  }

  return header;
}

function resolveNamedCookieCredential({
  cookieHeader,
  sessionToken,
  cookieName,
  label,
}) {
  const normalizedCookie = normalizeCookieHeader(cookieHeader, `${label} cookie`);
  const normalizedToken = normalizeSessionToken(sessionToken, `${label} token`);
  if (normalizedCookie && normalizedToken) {
    throw new Error(`${label} must provide either a cookie header or a token, not both.`);
  }
  const header = normalizedCookie || (
    normalizedToken ? `${cookieName}=${normalizedToken}` : null
  );
  if (header && !containsNamedCookie(header, cookieName)) {
    throw new Error(`${label} must include the ${cookieName} cookie.`);
  }
  return header;
}

function loadReleaseManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, "config", "release-compat.json");
  return parseJsonc(fs.readFileSync(manifestPath, "utf8"), "release compatibility manifest");
}

function requireStringListEntry(values, expectedValue, label) {
  if (!Array.isArray(values) || !values.includes(expectedValue)) {
    throw new Error(`${label} is missing ${JSON.stringify(expectedValue)} in config/release-compat.json.`);
  }
}

function getAdminAiStaticPath(manifest, expectedPath) {
  const values = manifest?.adminAi?.staticAuthApiPaths || [];
  requireStringListEntry(values, expectedPath, "Admin AI release contract");
  return expectedPath;
}

function getLiteralRoutePath(manifest, routeEntry, label) {
  const values = manifest?.authIndexRoutes?.literalRoutes || [];
  requireStringListEntry(values, routeEntry, label);
  return routeEntry.replace(/^[A-Z]+\s+/, "");
}

function getMemberAiLiteralRoutePath(manifest, routeEntry) {
  const values = manifest?.memberAi?.authRoutes?.literalRoutes || [];
  requireStringListEntry(values, routeEntry, "Member AI release contract");
  return routeEntry.replace(/^[A-Z]+\s+/, "");
}

function buildUrl(baseUrl, routePath) {
  return new URL(routePath, `${baseUrl}/`).toString();
}

function jsonHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...extra,
  };
}

function createBaselineChecks(manifest, config) {
  const healthPath = getLiteralRoutePath(manifest, "GET /api/health", "Auth index release contract");
  const mePath = getLiteralRoutePath(manifest, "GET /api/me", "Auth index release contract");
  const logoutPath = getLiteralRoutePath(manifest, "POST /api/logout", "Auth index release contract");
  const memberAssetsPath = getMemberAiLiteralRoutePath(manifest, "GET /api/ai/assets");
  const adminAiModelsPath = `/api${getAdminAiStaticPath(manifest, "/admin/ai/models")}`;

  return [
    {
      id: "auth-health",
      suite: "baseline",
      method: "GET",
      url: buildUrl(config.authBaseUrl, healthPath),
      description: "auth health endpoint responds on the deployed auth worker",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== true || jsonBody.service !== "bitbi-auth") {
          throw new Error(`expected auth health contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "auth-me-anonymous",
      suite: "baseline",
      method: "GET",
      url: buildUrl(config.authBaseUrl, mePath),
      description: "anonymous /api/me returns the logged-out contract",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.loggedIn !== false || jsonBody.user !== null) {
          throw new Error(`expected anonymous me contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "auth-same-origin-guard",
      suite: "baseline",
      method: "POST",
      url: buildUrl(config.authBaseUrl, logoutPath),
      description: "state-changing auth requests fail without a trusted browser context",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 403) {
          throw new Error(`expected 403, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.error !== "Forbidden") {
          throw new Error(`expected same-origin guard contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "member-ai-unauthenticated",
      suite: "baseline",
      method: "GET",
      url: buildUrl(config.authBaseUrl, memberAssetsPath),
      description: "member AI routes reject anonymous reads",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 401) {
          throw new Error(`expected 401, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.error !== "Not authenticated.") {
          throw new Error(`expected unauthenticated member-AI contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "admin-route-unauthenticated",
      suite: "baseline",
      method: "GET",
      url: buildUrl(config.authBaseUrl, "/api/admin/me"),
      description: "admin auth routes reject anonymous access",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 401) {
          throw new Error(`expected 401, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.error !== "Not authenticated.") {
          throw new Error(`expected anonymous admin contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "admin-ai-unauthenticated",
      suite: "baseline",
      method: "GET",
      url: buildUrl(config.authBaseUrl, adminAiModelsPath),
      description: "admin AI wrapper routes reject anonymous access",
      headers: jsonHeaders(),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 401) {
          throw new Error(`expected 401, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.code !== "unauthorized") {
          throw new Error(`expected anonymous admin-AI contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "contact-options-cors",
      suite: "baseline",
      method: "OPTIONS",
      url: `${config.contactBaseUrl}/`,
      description: "contact worker answers preflight safely on the deployed custom domain",
      headers: {
        Origin: SAFE_ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      },
      assert({ response, bodySummary }) {
        if (response.status !== 204) {
          throw new Error(`expected 204, got ${response.status}; ${bodySummary}`);
        }
        const allowOrigin = response.headers.get("access-control-allow-origin");
        if (allowOrigin !== SAFE_ALLOWED_ORIGIN) {
          throw new Error(`expected Access-Control-Allow-Origin ${SAFE_ALLOWED_ORIGIN}, got ${JSON.stringify(allowOrigin)}.`);
        }
      },
    },
    {
      id: "contact-forbidden-origin",
      suite: "baseline",
      method: "POST",
      url: `${config.contactBaseUrl}/`,
      description: "contact submission rejects a foreign origin before any mail send path",
      headers: {
        Origin: FORBIDDEN_ORIGIN,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Canary Visitor",
        email: "canary@example.invalid",
        subject: "Blocked",
        message: "This request should be rejected before any side effect.",
        website: "",
      }),
      assert({ response, textBody, bodySummary }) {
        if (response.status !== 403) {
          throw new Error(`expected 403, got ${response.status}; ${bodySummary}`);
        }
        if (textBody !== "Forbidden") {
          throw new Error(`expected contact forbidden-origin contract, got ${bodySummary}`);
        }
      },
    },
  ];
}

function createMemberChecks(manifest, config) {
  const mePath = getLiteralRoutePath(manifest, "GET /api/me", "Auth index release contract");
  const profilePath = getLiteralRoutePath(manifest, "GET /api/profile", "Auth index release contract");
  const quotaPath = getMemberAiLiteralRoutePath(manifest, "GET /api/ai/quota");
  const adminAiModelsPath = `/api${getAdminAiStaticPath(manifest, "/admin/ai/models")}`;

  return [
    {
      id: "member-me-authenticated",
      suite: "member",
      method: "GET",
      url: buildUrl(config.authBaseUrl, mePath),
      description: "member session reads /api/me successfully",
      headers: jsonHeaders({ Cookie: config.memberCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.loggedIn !== true || !jsonBody.user || jsonBody.user.role === "admin") {
          throw new Error(`expected authenticated non-admin /api/me contract, got ${bodySummary}`);
        }
        if (config.memberExpectedEmail && jsonBody.user.email !== config.memberExpectedEmail) {
          throw new Error("member /api/me email did not match BITBI_LIVE_MEMBER_EMAIL.");
        }
      },
    },
    {
      id: "member-profile-read",
      suite: "member",
      method: "GET",
      url: buildUrl(config.authBaseUrl, profilePath),
      description: "member session reads profile/account data successfully",
      headers: jsonHeaders({ Cookie: config.memberCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== true || !jsonBody.profile || !jsonBody.account) {
          throw new Error(`expected profile read contract, got ${bodySummary}`);
        }
        if (config.memberExpectedEmail && jsonBody.account.email !== config.memberExpectedEmail) {
          throw new Error("member /api/profile email did not match BITBI_LIVE_MEMBER_EMAIL.");
        }
      },
    },
    {
      id: "member-quota-read",
      suite: "member",
      method: "GET",
      url: buildUrl(config.authBaseUrl, quotaPath),
      description: "member session reads quota without consuming credits",
      headers: jsonHeaders({ Cookie: config.memberCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== true || !jsonBody.data || jsonBody.data.isAdmin !== false) {
          throw new Error(`expected non-admin quota contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "member-admin-route-forbidden",
      suite: "member",
      method: "GET",
      url: buildUrl(config.authBaseUrl, "/api/admin/me"),
      description: "member session is rejected from admin-only auth routes",
      headers: jsonHeaders({ Cookie: config.memberCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 403) {
          throw new Error(`expected 403, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.error !== "Admin privileges required.") {
          throw new Error(`expected admin rejection contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "member-admin-ai-forbidden",
      suite: "member",
      method: "GET",
      url: buildUrl(config.authBaseUrl, adminAiModelsPath),
      description: "member session is rejected from admin AI wrapper routes",
      headers: jsonHeaders({ Cookie: config.memberCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 403) {
          throw new Error(`expected 403, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== false || jsonBody.code !== "forbidden") {
          throw new Error(`expected admin-AI forbidden contract, got ${bodySummary}`);
        }
      },
    },
  ];
}

function createAdminChecks(manifest, config) {
  const adminAiModelsPath = `/api${getAdminAiStaticPath(manifest, "/admin/ai/models")}`;

  return [
    {
      id: "admin-me-read",
      suite: "admin",
      method: "GET",
      url: buildUrl(config.authBaseUrl, "/api/admin/me"),
      description: "secure admin session reads admin identity successfully",
      headers: jsonHeaders({ Cookie: config.adminCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== true || !jsonBody.user || jsonBody.user.role !== "admin") {
          throw new Error(`expected authenticated admin contract, got ${bodySummary}`);
        }
        if (config.adminExpectedEmail && jsonBody.user.email !== config.adminExpectedEmail) {
          throw new Error("admin /api/admin/me email did not match BITBI_LIVE_ADMIN_EMAIL.");
        }
      },
    },
    {
      id: "admin-users-read",
      suite: "admin",
      method: "GET",
      url: buildUrl(config.authBaseUrl, "/api/admin/users?limit=1"),
      description: "secure admin session reads admin user listing successfully",
      headers: jsonHeaders({ Cookie: config.adminCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (!jsonBody || jsonBody.ok !== true || !Array.isArray(jsonBody.users) || jsonBody.applied_limit !== 1) {
          throw new Error(`expected admin users listing contract, got ${bodySummary}`);
        }
      },
    },
    {
      id: "admin-ai-models-read",
      suite: "admin",
      method: "GET",
      url: buildUrl(config.authBaseUrl, adminAiModelsPath),
      description: "secure admin session reaches the AI catalog through the auth wrapper",
      headers: jsonHeaders({ Cookie: config.adminCookieHeader }),
      assert({ response, jsonBody, bodySummary }) {
        if (response.status !== 200) {
          throw new Error(`expected 200, got ${response.status}; ${bodySummary}`);
        }
        if (
          !jsonBody ||
          jsonBody.ok !== true ||
          jsonBody.task !== "models" ||
          !jsonBody.models ||
          !Array.isArray(jsonBody.models.text) ||
          !Array.isArray(jsonBody.models.image) ||
          !Array.isArray(jsonBody.models.embeddings) ||
          !Array.isArray(jsonBody.models.music) ||
          !Array.isArray(jsonBody.models.video)
        ) {
          throw new Error(`expected admin AI models contract, got ${bodySummary}`);
        }
      },
    },
  ];
}

function summarizeJsonBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "json(non-object)";
  }

  const summary = {};
  for (const key of ["ok", "error", "code", "service", "task", "loggedIn"]) {
    if (key in body) summary[key] = body[key];
  }
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    for (const key of ["isAdmin", "dailyLimit", "usedToday", "remainingToday"]) {
      if (key in body.data) {
        summary[`data.${key}`] = body.data[key];
      }
    }
  }
  if (body.user && typeof body.user === "object" && !Array.isArray(body.user)) {
    if ("role" in body.user) summary["user.role"] = body.user.role;
  }
  if (body.account && typeof body.account === "object" && !Array.isArray(body.account)) {
    if ("role" in body.account) summary["account.role"] = body.account.role;
  }
  if (body.models && typeof body.models === "object" && !Array.isArray(body.models)) {
    summary["models.groups"] = Object.keys(body.models).sort().join(",");
  }
  if (Array.isArray(body.users)) {
    summary["users.count"] = body.users.length;
  }
  if ("applied_limit" in body) {
    summary.applied_limit = body.applied_limit;
  }

  const entries = Object.entries(summary);
  if (entries.length === 0) {
    return `json(keys=${Object.keys(body).sort().join(",") || "(none)"})`;
  }
  return `json(${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")})`;
}

async function readResponseBodySummary(response) {
  if (response.status === 204 || response.status === 205) {
    return {
      jsonBody: null,
      textBody: "",
      bodySummary: "empty",
    };
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text) {
    return {
      jsonBody: null,
      textBody: "",
      bodySummary: "empty",
    };
  }

  if (contentType.includes("application/json")) {
    try {
      const jsonBody = JSON.parse(text);
      return {
        jsonBody,
        textBody: null,
        bodySummary: summarizeJsonBody(jsonBody),
      };
    } catch {
      return {
        jsonBody: null,
        textBody: text,
        bodySummary: `invalid-json(length=${text.length})`,
      };
    }
  }

  return {
    jsonBody: null,
    textBody: text,
    bodySummary: `text(length=${text.length})`,
  };
}

function createLogger(logger) {
  if (typeof logger === "function") return logger;
  return () => {};
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function describeCheckStart(check) {
  return `[${check.suite}] ${check.method} ${check.url} — ${check.description}`;
}

function describeCheckResult(check, response, bodySummary) {
  return `[pass] ${check.id} ${check.method} ${check.url} -> ${response.status} ${bodySummary}`;
}

function describeCheckFailure(check, response, bodySummary, message) {
  return `[fail] ${check.id} ${check.method} ${check.url} -> ${response.status} ${bodySummary}; ${message}`;
}

export function createLiveRuntimeCanaryPlan({ repoRoot, env = process.env } = {}) {
  const manifest = loadReleaseManifest(repoRoot);
  const enabled = isLiveCanaryEnabled(env);
  const authBaseUrl = normalizeBaseUrl(env.BITBI_LIVE_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL, "BITBI_LIVE_AUTH_BASE_URL");
  const contactBaseUrl = normalizeBaseUrl(
    env.BITBI_LIVE_CONTACT_BASE_URL || DEFAULT_CONTACT_BASE_URL,
    "BITBI_LIVE_CONTACT_BASE_URL"
  );
  const timeoutMs = normalizeTimeoutMs(env.BITBI_LIVE_TIMEOUT_MS);

  const memberCookieHeader = resolveCookieCredential({
    cookieHeader: env.BITBI_LIVE_MEMBER_COOKIE,
    sessionToken: env.BITBI_LIVE_MEMBER_SESSION,
    label: "Member live-check",
  });
  const adminCookieHeader = resolveCookieCredential({
    cookieHeader: env.BITBI_LIVE_ADMIN_COOKIE,
    sessionToken: env.BITBI_LIVE_ADMIN_SESSION,
    requireSecureCookie: true,
    label: "Admin live-check",
  });
  const adminMfaCookieHeader = resolveNamedCookieCredential({
    cookieHeader: env.BITBI_LIVE_ADMIN_MFA_COOKIE,
    sessionToken: env.BITBI_LIVE_ADMIN_MFA_TOKEN,
    cookieName: SECURE_ADMIN_MFA_COOKIE_NAME,
    label: "Admin MFA live-check",
  });

  if (adminMfaCookieHeader && !adminCookieHeader) {
    throw new Error("BITBI_LIVE_ADMIN_MFA_COOKIE or BITBI_LIVE_ADMIN_MFA_TOKEN requires BITBI_LIVE_ADMIN_SESSION or BITBI_LIVE_ADMIN_COOKIE.");
  }

  const effectiveAdminCookieHeader = adminCookieHeader
    ? (
      adminMfaCookieHeader && !containsNamedCookie(adminCookieHeader, SECURE_ADMIN_MFA_COOKIE_NAME)
        ? `${adminCookieHeader}; ${adminMfaCookieHeader}`
        : adminCookieHeader
    )
    : null;
  const adminHasMfaProof = !!(
    effectiveAdminCookieHeader &&
    containsNamedCookie(effectiveAdminCookieHeader, SECURE_ADMIN_MFA_COOKIE_NAME)
  );

  if (isNonEmptyString(env.BITBI_LIVE_MEMBER_EMAIL) && !memberCookieHeader) {
    throw new Error("BITBI_LIVE_MEMBER_EMAIL requires BITBI_LIVE_MEMBER_SESSION or BITBI_LIVE_MEMBER_COOKIE.");
  }
  if (isNonEmptyString(env.BITBI_LIVE_ADMIN_EMAIL) && !effectiveAdminCookieHeader) {
    throw new Error("BITBI_LIVE_ADMIN_EMAIL requires BITBI_LIVE_ADMIN_SESSION or BITBI_LIVE_ADMIN_COOKIE.");
  }

  const plan = {
    enabled,
    timeoutMs,
    authBaseUrl,
    contactBaseUrl,
    memberCookieHeader,
    adminCookieHeader: effectiveAdminCookieHeader,
    adminHasMfaProof,
    memberExpectedEmail: isNonEmptyString(env.BITBI_LIVE_MEMBER_EMAIL) ? String(env.BITBI_LIVE_MEMBER_EMAIL).trim() : null,
    adminExpectedEmail: isNonEmptyString(env.BITBI_LIVE_ADMIN_EMAIL) ? String(env.BITBI_LIVE_ADMIN_EMAIL).trim() : null,
    manifest,
    suites: [],
  };

  if (!enabled) {
    plan.suites = [
      {
        id: "baseline",
        label: "Always-safe public/negative checks",
        checks: [],
        skipped: true,
        skippedReason:
          "Live runtime canary is disabled. Set BITBI_LIVE_ENABLE=1 to run deployed checks.",
      },
      {
        id: "member",
        label: "Optional authenticated member read-only checks",
        checks: [],
        skipped: true,
        skippedReason:
          "Live runtime canary is disabled. Set BITBI_LIVE_ENABLE=1 to evaluate member read-only checks.",
      },
      {
        id: "admin",
        label: "Optional authenticated admin read-only checks",
        checks: [],
        skipped: true,
        skippedReason:
          "Live runtime canary is disabled. Set BITBI_LIVE_ENABLE=1 to evaluate admin read-only checks.",
      },
    ];
    return plan;
  }

  plan.suites = [
    {
      id: "baseline",
      label: "Always-safe public/negative checks",
      skipped: false,
      checks: createBaselineChecks(manifest, plan),
    },
    memberCookieHeader
      ? {
          id: "member",
          label: "Optional authenticated member read-only checks",
          skipped: false,
          checks: createMemberChecks(manifest, plan),
        }
      : {
          id: "member",
          label: "Optional authenticated member read-only checks",
          skipped: true,
          checks: [],
          skippedReason:
            "Skipping member live checks because no BITBI_LIVE_MEMBER_SESSION or BITBI_LIVE_MEMBER_COOKIE was provided.",
        },
    effectiveAdminCookieHeader && adminHasMfaProof
      ? {
          id: "admin",
          label: "Optional authenticated admin read-only checks",
          skipped: false,
          checks: createAdminChecks(manifest, plan),
        }
      : effectiveAdminCookieHeader
        ? {
            id: "admin",
            label: "Optional authenticated admin read-only checks",
            skipped: true,
            checks: [],
            skippedReason:
              "Skipping admin live checks because BITBI_LIVE_ADMIN_MFA_TOKEN or BITBI_LIVE_ADMIN_MFA_COOKIE was not provided with the secure admin session.",
          }
      : {
          id: "admin",
          label: "Optional authenticated admin read-only checks",
          skipped: true,
          checks: [],
          skippedReason:
            "Skipping admin live checks because no BITBI_LIVE_ADMIN_SESSION or BITBI_LIVE_ADMIN_COOKIE was provided.",
        },
  ];

  return plan;
}

export async function runLiveRuntimeCanaryPlan(plan, options = {}) {
  const logger = createLogger(options.logger || console.log);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for live runtime canary checks.");
  }

  const result = {
    enabled: plan.enabled,
    passed: [],
    failed: [],
    skipped: [],
  };

  for (const suite of plan.suites) {
    if (suite.skipped) {
      result.skipped.push({
        suite: suite.id,
        reason: suite.skippedReason,
      });
      logger(`[skip] ${suite.id} — ${suite.skippedReason}`);
      continue;
    }

    for (const check of suite.checks) {
      logger(describeCheckStart(check));

      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          check.url,
          {
            method: check.method,
            headers: check.headers,
            body: check.body,
          },
          plan.timeoutMs
        );
        const { jsonBody, textBody, bodySummary } = await readResponseBodySummary(response);
        check.assert({ response, jsonBody, textBody, bodySummary, config: plan });
        result.passed.push({
          suite: suite.id,
          id: check.id,
          status: response.status,
          url: check.url,
          summary: bodySummary,
        });
        logger(describeCheckResult(check, response, bodySummary));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({
          suite: suite.id,
          id: check.id,
          url: check.url,
          message,
        });
        logger(`[fail] ${check.id} ${check.method} ${check.url}; ${message}`);
      }
    }
  }

  return result;
}
