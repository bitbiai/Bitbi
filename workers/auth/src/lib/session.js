import { json } from "./response.js";
import { getSessionTokenFromCookies, parseCookies } from "./cookies.js";
import { nowIso, sha256Hex } from "./tokens.js";

export async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = getSessionTokenFromCookies(cookies);

  if (!sessionToken) {
    return null;
  }

  const tokenHash = await sha256Hex(`${sessionToken}:${env.SESSION_SECRET}`);
  const currentTime = nowIso();

  const sessionRow = await env.DB.prepare(
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

  if (!sessionRow) {
    return null;
  }

  // Only update last_seen_at if older than 5 minutes to reduce write load
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  if (!sessionRow.last_seen_at || sessionRow.last_seen_at < fiveMinAgo) {
    await env.DB.prepare(
      `UPDATE sessions SET last_seen_at = ? WHERE id = ?`
    )
      .bind(currentTime, sessionRow.session_id)
      .run();
  }

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

export async function requireAdmin(request, env) {
  const result = await requireUser(request, env);

  if (result instanceof Response) {
    return result;
  }

  if (result.user.role !== "admin") {
    return json(
      { ok: false, error: "Admin privileges required." },
      { status: 403 }
    );
  }

  return result;
}
