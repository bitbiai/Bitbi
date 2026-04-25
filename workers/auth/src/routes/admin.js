import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";
import { getActivityRetentionMetadata } from "../lib/activity-archive.js";
import {
  evaluateSharedRateLimit,
  isProductionEnvironment,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  buildAdminMfaDeniedResponse,
  logAdminMfaDiagnostic,
} from "../lib/admin-mfa.js";
import {
  decodePaginationCursor,
  encodePaginationCursor,
  paginationErrorResponse,
  readCursorString,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { handleAdminAI } from "./admin-ai.js";
import { handleAdminMfa } from "./admin-mfa.js";
import { AiAssetLifecycleError, deleteAllUserAiAssets } from "./ai/lifecycle.js";

const ADMIN_USERS_CURSOR_TYPE = "admin_users";
const DEFAULT_ADMIN_USERS_LIMIT = 50;
const MAX_ADMIN_USERS_LIMIT = 100;

function normalizeAdminUserSearch(value) {
  return String(value || "").trim();
}

async function enforceAdminActionRateLimit(ctx) {
  const { request, env, pathname, method, correlationId } = ctx;
  const ip = getClientIp(request);
  const result = await evaluateSharedRateLimit(
    env,
    "admin-action-ip",
    ip,
    30,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-action",
      correlationId,
      requestInfo: { request, pathname, method },
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

export async function handleAdmin(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;

  const adminMfaResult = await handleAdminMfa(ctx);
  if (adminMfaResult) {
    return adminMfaResult;
  }

  const adminAiResult = await handleAdminAI(ctx);
  if (adminAiResult) {
    return adminAiResult;
  }

  // GET /api/admin/me
  if (pathname === "/api/admin/me" && method === "GET") {
    const result = await requireAdmin(request, env, {
      isSecure,
      correlationId,
      allowMfaBootstrap: true,
    });

    if (result instanceof Response) {
      return result;
    }

    if (result.adminMfa?.enforcementRequired && isProductionEnvironment(env)) {
      logAdminMfaDiagnostic({
        request,
        correlationId,
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
        correlationId,
        includeUser: true,
        isSecure,
      });
    }

    return json({
      ok: true,
      user: result.user,
    });
  }

  // GET /api/admin/users
  if (pathname === "/api/admin/users" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const appliedLimit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_USERS_LIMIT,
      maxValue: MAX_ADMIN_USERS_LIMIT,
    });
    const search = normalizeAdminUserSearch(url.searchParams.get("search"));

    let cursor = null;
    try {
      cursor = await decodePaginationCursor(env, url.searchParams.get("cursor"), ADMIN_USERS_CURSOR_TYPE);
      if (cursor) {
        cursor = {
          q: readCursorString(cursor, "q", { allowEmpty: true }),
          c: readCursorString(cursor, "c"),
          i: readCursorString(cursor, "i"),
        };
      }
    } catch {
      return paginationErrorResponse("Invalid cursor.");
    }
    if (cursor && cursor.q !== search) {
      return paginationErrorResponse("Invalid cursor.");
    }

    const conditions = [];
    const bindings = [];

    if (search) {
      conditions.push("email LIKE ?");
      bindings.push(`%${search}%`);
    }
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.c, cursor.c, cursor.i);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method
       FROM users
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(...bindings, appliedLimit + 1)
      .all();

    const resultRows = rows.results || [];
    const hasMore = resultRows.length > appliedLimit;
    const users = hasMore ? resultRows.slice(0, appliedLimit) : resultRows;
    const last = users[users.length - 1];

    return json({
      ok: true,
      users,
      next_cursor: hasMore
        ? await encodePaginationCursor(env, ADMIN_USERS_CURSOR_TYPE, {
            q: search,
            c: last.created_at,
            i: last.id,
          })
        : null,
      has_more: hasMore,
      applied_limit: appliedLimit,
    });
  }

  // PATCH /api/admin/users/:id/role
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/role") &&
    method === "PATCH"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "role"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const body = parsed.body;

    if (!body) {
      return json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const newRole = body.role;

    if (newRole !== "user" && newRole !== "admin") {
      return json(
        { ok: false, error: "Invalid role. Allowed: \"user\" or \"admin\"." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id && newRole !== "admin") {
      return json(
        { ok: false, error: "You cannot remove your own admin role." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();

    await env.DB.prepare(
      "UPDATE users SET role = ?, updated_at = ? WHERE id = ?"
    ).bind(newRole, now, targetUserId).run();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "change_role",
        targetUserId,
        meta: {
          role: newRole,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    const updatedUser = await env.DB.prepare(
      "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    return json({
      ok: true,
      user: updatedUser,
    });
  }

  // PATCH /api/admin/users/:id/status
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/status") &&
    method === "PATCH"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "status"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return parsed.response;
    const body = parsed.body;

    if (!body) {
      return json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const newStatus = body.status;

    if (newStatus !== "active" && newStatus !== "disabled") {
      return json(
        { ok: false, error: "Invalid status. Allowed: \"active\" or \"disabled\"." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id && newStatus === "disabled") {
      return json(
        { ok: false, error: "You cannot disable your own account." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();

    await env.DB.prepare(
      "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
    ).bind(newStatus, now, targetUserId).run();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "change_status",
        targetUserId,
        meta: {
          status: newStatus,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    const updatedUser = await env.DB.prepare(
      "SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    return json({
      ok: true,
      user: updatedUser,
    });
  }

  // POST /api/admin/users/:id/revoke-sessions
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/revoke-sessions") &&
    method === "POST"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "revoke-sessions"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id) {
      return json(
        { ok: false, error: "You cannot revoke your own sessions here." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const deleteResult = await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    )
      .bind(targetUserId)
      .run();

    const now = nowIso();

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "revoke_sessions",
        targetUserId,
        meta: {
          revokedSessions: deleteResult.meta.changes,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    return json({
      ok: true,
      revokedSessions: deleteResult.meta.changes,
      targetUserId,
    });
  }

  // GET /api/admin/stats
  if (pathname === "/api/admin/stats" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const row = await env.DB.prepare(
      `SELECT
         COUNT(*) AS totalUsers,
         COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins,
         COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS activeUsers,
         COALESCE(SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END), 0) AS disabledUsers,
         COALESCE(SUM(CASE WHEN email_verified_at IS NOT NULL
                    AND (verification_method IS NULL OR verification_method != 'legacy_auto')
              THEN 1 ELSE 0 END), 0) AS verifiedUsers,
         COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days')
              THEN 1 ELSE 0 END), 0) AS recentRegistrations
       FROM users`
    ).first();

    return json({
      ok: true,
      stats: {
        totalUsers: row.totalUsers,
        admins: row.admins,
        activeUsers: row.activeUsers,
        disabledUsers: row.disabledUsers,
        verifiedUsers: row.verifiedUsers,
        recentRegistrations: row.recentRegistrations,
      },
    });
  }

  // GET /api/admin/avatars/latest
  if (pathname === "/api/admin/avatars/latest" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const rows = await env.DB.prepare(
      `SELECT u.id, u.email, p.display_name, p.avatar_updated_at
       FROM profiles p
       INNER JOIN users u ON u.id = p.user_id
       WHERE COALESCE(p.has_avatar, 0) = 1
         AND p.avatar_updated_at IS NOT NULL
       ORDER BY p.avatar_updated_at DESC, p.user_id DESC
       LIMIT 4`
    ).all();

    if (!(rows.results || []).length) {
      return json({ ok: true, avatars: [] });
    }

    const avatars = (rows.results || []).map((row) => ({
      userId: row.id,
      email: row.email || null,
      displayName: row.display_name || null,
      uploadedAt: row.avatar_updated_at,
    }));

    return json({ ok: true, avatars });
  }

  // GET /api/admin/avatars/:userId (serve image)
  if (
    pathname.startsWith("/api/admin/avatars/") &&
    method === "GET"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const parts = pathname.split("/");
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 5) {
      return json({ ok: false, error: "Invalid path." }, { status: 400 });
    }

    const object = await env.PRIVATE_MEDIA.get(`avatars/${targetUserId}`);
    if (!object) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      object.httpMetadata?.contentType || "image/png"
    );
    if (object.size) headers.set("Content-Length", String(object.size));
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  }

  // DELETE /api/admin/users/:id
  if (
    pathname.startsWith("/api/admin/users/") &&
    method === "DELETE"
  ) {
    const result = await requireAdmin(request, env, { isSecure, correlationId });

    if (result instanceof Response) {
      return result;
    }

    const limited = await enforceAdminActionRateLimit(ctx);
    if (limited) return limited;

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 5) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    if (targetUserId === result.user.id) {
      return json(
        { ok: false, error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const targetUser = await env.DB.prepare(
      "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
    )
      .bind(targetUserId)
      .first();

    if (!targetUser) {
      return json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    const now = nowIso();
    try {
      await deleteAllUserAiAssets({
        env,
        userId: targetUserId,
        createdAt: now,
        additionalStatements: [
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId),
        ],
      });
    } catch (error) {
      if (!(error instanceof AiAssetLifecycleError)) {
        throw error;
      }
      return json(
        { ok: false, error: error.message },
        { status: error.status }
      );
    }

    // Avatar cleanup is best-effort because the destructive DB work already committed.
    try {
      await env.PRIVATE_MEDIA.delete(`avatars/${targetUserId}`);
    } catch (e) {
      console.error("Admin delete: avatar cleanup failed", e);
    }

    await enqueueAdminAuditEvent(
      env,
      {
        adminUserId: result.user.id,
        action: "delete_user",
        targetUserId,
        meta: {
          deletedUserId: targetUserId,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        },
        createdAt: now,
      },
      {
        correlationId,
        requestInfo: ctx,
        allowDirectFallback: true,
      }
    );

    return json({
      ok: true,
      deletedUserId: targetUserId,
    });
  }

  // GET /api/admin/activity
  if (pathname === "/api/admin/activity" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit")) || 50, 1),
      100
    );
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = url.searchParams.get("search") || null;

    const conditions = [];
    const bindings = [];

    if (cursorParam) {
      const sep = cursorParam.indexOf("|");
      if (sep === -1) {
        return json(
          { ok: false, error: "Invalid cursor format." },
          { status: 400 }
        );
      }
      const cursorTime = cursorParam.slice(0, sep);
      const cursorId = cursorParam.slice(sep + 1);
      conditions.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
      bindings.push(cursorTime, cursorTime, cursorId);
    }

    if (search) {
      const like = `%${search}%`;
      conditions.push("(au.email LIKE ? OR tu.email LIKE ? OR a.action LIKE ? OR a.meta_json LIKE ?)");
      bindings.push(like, like, like, like);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const entriesQuery = env.DB.prepare(
      `SELECT a.id, a.action, a.meta_json, a.created_at,
              a.admin_user_id, au.email AS admin_email,
              a.target_user_id, tu.email AS target_email
       FROM admin_audit_log a
       LEFT JOIN users au ON au.id = a.admin_user_id
       LEFT JOIN users tu ON tu.id = a.target_user_id
       ${whereClause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`
    ).bind(...bindings, limit + 1);

    const [entriesRes, countsRes] = await env.DB.batch([
      entriesQuery,
      env.DB.prepare(
        "SELECT action, COUNT(*) AS cnt FROM admin_audit_log GROUP BY action"
      ),
    ]);

    const rows = entriesRes.results;
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;

    // Backfill emails from identity snapshots when LEFT JOIN returns NULL
    for (const entry of entries) {
      if (!entry.target_email || !entry.admin_email) {
        try {
          const meta = JSON.parse(entry.meta_json || '{}');
          if (!entry.target_email && meta.target_email) entry.target_email = meta.target_email;
          if (!entry.admin_email && meta.actor_email) entry.admin_email = meta.actor_email;
        } catch {}
      }
    }

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = `${last.created_at}|${last.id}`;
    }

    const counts = {};
    for (const row of countsRes.results) {
      counts[row.action] = row.cnt;
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      counts,
      ...getActivityRetentionMetadata(),
    });
  }

  // GET /api/admin/user-activity
  if (pathname === "/api/admin/user-activity" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit")) || 50, 1),
      100
    );
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = url.searchParams.get("search") || null;

    const conditions = [];
    const bindings = [];

    if (cursorParam) {
      const sep = cursorParam.indexOf("|");
      if (sep === -1) {
        return json(
          { ok: false, error: "Invalid cursor format." },
          { status: 400 }
        );
      }
      const cursorTime = cursorParam.slice(0, sep);
      const cursorId = cursorParam.slice(sep + 1);
      conditions.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
      bindings.push(cursorTime, cursorTime, cursorId);
    }

    if (search) {
      const like = `%${search}%`;
      conditions.push("(u.email LIKE ? OR a.action LIKE ? OR a.meta_json LIKE ?)");
      bindings.push(like, like, like);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    let entriesRes;
    try {
      entriesRes = await env.DB.prepare(
        `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
                u.email AS user_email
         FROM user_activity_log a
         LEFT JOIN users u ON u.id = a.user_id
         ${whereClause}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ?`
      ).bind(...bindings, limit + 1).all();
    } catch (e) {
      // Graceful degradation if migration 0012 has not been applied
      if (String(e).includes("no such table")) {
        return json({
          ok: true,
          entries: [],
          nextCursor: null,
          unavailable: true,
          reason: "User activity logging not yet configured. Run migration 0012.",
          ...getActivityRetentionMetadata(),
        });
      }
      throw e;
    }

    const rows = entriesRes.results;
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;

    // Backfill email from meta if user was deleted
    for (const entry of entries) {
      if (!entry.user_email) {
        try {
          const meta = JSON.parse(entry.meta_json || '{}');
          if (meta.email) entry.user_email = meta.email;
        } catch {}
      }
    }

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = `${last.created_at}|${last.id}`;
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      ...getActivityRetentionMetadata(),
    });
  }

  return null;
}
