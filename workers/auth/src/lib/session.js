import { json } from "./response.js";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  getSessionTokenFromCookies,
  parseCookies,
} from "./cookies.js";
import { addDaysIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { isProductionEnvironment } from "./rate-limit.js";
import {
  buildAdminMfaDeniedResponse,
  getAdminMfaAccessState,
  logAdminMfaDiagnostic,
  logAdminMfaUnhandledFailure,
} from "./admin-mfa.js";
import {
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import {
  getSessionHashSecret,
  getSessionHashSecretCandidates,
} from "./security-secrets.js";

const SESSION_TOUCH_WINDOW_MS = 10 * 60_000;

function getSessionTouchThreshold(currentTime) {
  return new Date(Date.parse(currentTime) - SESSION_TOUCH_WINDOW_MS).toISOString();
}

async function touchSessionIfStale(env, sessionRow, currentTime) {
  const staleBefore = getSessionTouchThreshold(currentTime);
  if (sessionRow.last_seen_at && sessionRow.last_seen_at >= staleBefore) {
    return;
  }

  await env.DB.prepare(
    `UPDATE sessions
     SET last_seen_at = ?
     WHERE id = ?
       AND (last_seen_at IS NULL OR last_seen_at < ?)`
  )
    .bind(currentTime, sessionRow.session_id, staleBefore)
    .run();
}

async function hashSessionTokenWithSecret(sessionToken, secret) {
  return sha256Hex(`${sessionToken}:${secret}`);
}

export async function hashSessionToken(env, sessionToken) {
  return hashSessionTokenWithSecret(sessionToken, getSessionHashSecret(env));
}

export async function hashSessionTokenCandidates(env, sessionToken) {
  const candidates = [];
  for (const candidate of getSessionHashSecretCandidates(env)) {
    candidates.push({
      ...candidate,
      tokenHash: await hashSessionTokenWithSecret(sessionToken, candidate.secret),
    });
  }
  return candidates;
}

async function findSessionRow(env, tokenHash, currentTime) {
  return env.DB.prepare(
    `
    SELECT
      sessions.id AS session_id,
      sessions.user_id AS user_id,
      sessions.expires_at AS expires_at,
      sessions.last_seen_at AS last_seen_at,
      users.email AS email,
      users.created_at AS created_at,
      users.status AS status,
      users.role AS role,
      users.verification_method AS verification_method
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
      AND users.status = 'active'
    LIMIT 1
    `
  )
    .bind(tokenHash, currentTime)
    .first();
}

async function upgradeLegacySessionHash(env, sessionRow, legacyTokenHash, currentTokenHash) {
  if (!sessionRow?.session_id || legacyTokenHash === currentTokenHash) {
    return;
  }
  try {
    await env.DB.prepare(
      `UPDATE sessions
       SET token_hash = ?
       WHERE id = ?
         AND token_hash = ?`
    )
      .bind(currentTokenHash, sessionRow.session_id, legacyTokenHash)
      .run();
  } catch {
    // Keep the legacy session valid for its natural expiry if opportunistic migration fails.
  }
}

export async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = getSessionTokenFromCookies(cookies);

  if (!sessionToken) {
    return null;
  }

  const currentTime = nowIso();
  const candidates = await hashSessionTokenCandidates(env, sessionToken);
  const currentHash = candidates[0]?.tokenHash || null;
  let sessionRow = null;
  let matchedCandidate = null;
  for (const candidate of candidates) {
    sessionRow = await findSessionRow(env, candidate.tokenHash, currentTime);
    if (sessionRow) {
      matchedCandidate = candidate;
      break;
    }
  }

  if (!sessionRow) {
    return null;
  }

  if (matchedCandidate?.legacy && currentHash) {
    await upgradeLegacySessionHash(env, sessionRow, matchedCandidate.tokenHash, currentHash);
  }

  await touchSessionIfStale(env, sessionRow, currentTime);

  return {
    sessionId: sessionRow.session_id,
    user: {
      id: sessionRow.user_id,
      email: sessionRow.email,
      createdAt: sessionRow.created_at,
      status: sessionRow.status,
      role: sessionRow.role,
      verificationMethod: sessionRow.verification_method,
    },
  };
}

export async function createSession(env, userId) {
  const sessionToken = randomTokenHex(32);
  const tokenHash = await hashSessionToken(env, sessionToken);
  const sessionId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = addDaysIso(30);

  await env.DB.prepare(
    `
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  )
    .bind(sessionId, userId, tokenHash, createdAt, expiresAt, createdAt)
    .run();

  return {
    sessionId,
    sessionToken,
    createdAt,
    expiresAt,
  };
}

export async function requireUser(request, env) {
  const session = await getSessionUser(request, env);

  if (!session) {
    return json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  if (session.user.status !== "active") {
    return json(
      { ok: false, error: "This account is not active." },
      { status: 403 }
    );
  }

  return session;
}

function adminSecureSessionResponse(correlationId = null) {
  return withCorrelationId(json(
    { ok: false, error: "Admin access requires a secure session." },
    { status: 403 }
  ), correlationId);
}

function hasSecureAdminSessionCookie(request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return !!cookies?.[SECURE_SESSION_COOKIE_NAME];
}

function hasLegacyAdminSessionCookie(request) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return !!cookies?.[LEGACY_SESSION_COOKIE_NAME];
}

function logAdminSessionPolicyRejection(request, correlationId, session, reason) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-auth",
    event: "admin_session_policy_rejected",
    level: "warn",
    correlationId,
    admin_user_id: session?.user?.id || null,
    failure_reason: reason,
    status: 403,
    ...getRequestLogFields(request),
  });
}

function logAdminAuthRejection(request, correlationId, session, reason, status) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "admin-auth",
    event: "admin_auth_rejected",
    level: status >= 500 ? "error" : "warn",
    correlationId,
    admin_user_id: session?.user?.id || null,
    user_role: session?.user?.role || null,
    failure_reason: reason,
    status,
    ...getRequestLogFields(request),
  });
}

export async function requireAdmin(request, env, options = {}) {
  const result = await requireUser(request, env);

  if (result instanceof Response) {
    if (result.status === 401) {
      logAdminAuthRejection(request, options.correlationId || null, null, "not_authenticated", 401);
    } else if (result.status === 403) {
      logAdminAuthRejection(request, options.correlationId || null, null, "user_not_active", 403);
    }
    return withCorrelationId(result, options.correlationId || null);
  }

  if (result.user.role !== "admin") {
    logAdminAuthRejection(request, options.correlationId || null, result, "not_admin", 403);
    return withCorrelationId(json(
      { ok: false, error: "Admin privileges required." },
      { status: 403 }
    ), options.correlationId || null);
  }

  if (options.enforceSecureSession !== false && isProductionEnvironment(env)) {
    if (options.isSecure !== true) {
      logAdminSessionPolicyRejection(request, options.correlationId || null, result, "insecure_transport");
      return adminSecureSessionResponse(options.correlationId || null);
    }
    if (!hasSecureAdminSessionCookie(request)) {
      const reason = hasLegacyAdminSessionCookie(request)
        ? "legacy_cookie_only"
        : "secure_cookie_missing";
      logAdminSessionPolicyRejection(request, options.correlationId || null, result, reason);
      return adminSecureSessionResponse(options.correlationId || null);
    }
  }

  const shouldEvaluateAdminMfa = options.allowMfaBootstrap === true || isProductionEnvironment(env);
  if (!shouldEvaluateAdminMfa) {
    return result;
  }

  try {
    result.adminMfa = await getAdminMfaAccessState(request, env, result);
  } catch (error) {
    logAdminMfaUnhandledFailure(request, options.correlationId || null, result.user.id, error);
    return withCorrelationId(json(
      { ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" },
      { status: 503 }
    ), options.correlationId || null);
  }

  if (isProductionEnvironment(env) && result.adminMfa?.enforcementRequired && options.allowMfaBootstrap !== true) {
    logAdminMfaDiagnostic({
      request,
      correlationId: options.correlationId || null,
      adminUserId: result.user.id,
      event: "admin_mfa_access_rejected",
      level: "warn",
      failureReason: result.adminMfa.failureReason,
      status: 403,
      setupPending: result.adminMfa.setupPending,
      recoveryCodesRemaining: result.adminMfa.recoveryCodesRemaining,
    });
    return buildAdminMfaDeniedResponse({
      session: result,
      mfaState: result.adminMfa,
      correlationId: options.correlationId || null,
      isSecure: options.isSecure === true,
    });
  }

  return result;
}
