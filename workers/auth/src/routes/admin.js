import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";
import {
  getActivityRetentionCutoff,
  getActivityRetentionMetadata,
} from "../lib/activity-archive.js";
import {
  ACTIVITY_CURSOR_TTL_MS,
  ADMIN_AUDIT_LOG_TABLE,
  ADMIN_ACTIVITY_CURSOR_TYPE,
  ADMIN_USER_ACTIVITY_CURSOR_TYPE,
  USER_ACTIVITY_LOG_TABLE,
  buildActivitySearchFilterHash,
  buildActivitySearchRange,
  normalizeActivitySearchTerm,
  sanitizeActivityMetaJson,
} from "../lib/activity-search.js";
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
  readCursorInteger,
  resolvePaginationLimit,
} from "../lib/pagination.js";
import { handleAdminAI } from "./admin-ai.js";
import { handleAdminDataLifecycle } from "./admin-data-lifecycle.js";
import { handleAdminMfa } from "./admin-mfa.js";
import { AiAssetLifecycleError, deleteAllUserAiAssets } from "./ai/lifecycle.js";

const ADMIN_USERS_CURSOR_TYPE = "admin_users";
const DEFAULT_ADMIN_USERS_LIMIT = 50;
const MAX_ADMIN_USERS_LIMIT = 100;
const DEFAULT_ADMIN_ACTIVITY_LIMIT = 50;
const MAX_ADMIN_ACTIVITY_LIMIT = 100;

function normalizeAdminUserSearch(value) {
  return String(value || "").trim();
}

function normalizeActivityEntry(entry, actorEmailField, targetEmailField = null) {
  const normalized = {
    ...entry,
    meta_json: sanitizeActivityMetaJson(entry.action, entry.meta_json),
  };
  const fallback = (() => {
    try {
      return JSON.parse(entry.meta_json || "{}");
    } catch {
      return {};
    }
  })();
  if (actorEmailField && !normalized[actorEmailField]) {
    normalized[actorEmailField] = fallback.actor_email || fallback.email || null;
  }
  if (targetEmailField && !normalized[targetEmailField]) {
    normalized[targetEmailField] = fallback.target_email || null;
  }
  return normalized;
}

function appendActivitySearchConditions(conditions, bindings, search) {
  const range = buildActivitySearchRange(search);
  if (!range) return false;
  const [start, end] = range;
  conditions.push(`(
    (idx.action_norm >= ? AND idx.action_norm < ?)
    OR (idx.actor_email_norm >= ? AND idx.actor_email_norm < ?)
    OR (idx.target_email_norm >= ? AND idx.target_email_norm < ?)
    OR (idx.entity_id >= ? AND idx.entity_id < ?)
  )`);
  bindings.push(start, end, start, end, start, end, start, end);
  return true;
}

function appendActivityCursorCondition(conditions, bindings, cursor, { createdColumn, idColumn }) {
  if (!cursor) return;
  conditions.push(`(${createdColumn} < ? OR (${createdColumn} = ? AND ${idColumn} < ?))`);
  bindings.push(cursor.c, cursor.c, cursor.i);
}

async function decodeActivityCursorOrResponse(env, cursorParam, cursorType, expectedFilterHash) {
  if (!cursorParam) return { cursor: null };
  try {
    const decoded = await decodePaginationCursor(env, cursorParam, cursorType);
    const cursor = {
      c: readCursorString(decoded, "c"),
      i: readCursorString(decoded, "i"),
      q: readCursorString(decoded, "q", { allowEmpty: true, maxLength: 80 }),
      exp: readCursorInteger(decoded, "exp", { min: 1 }),
    };
    if (cursor.q !== expectedFilterHash || cursor.exp <= Date.now()) {
      return { response: paginationErrorResponse("Invalid cursor.") };
    }
    return { cursor };
  } catch {
    return { response: paginationErrorResponse("Invalid cursor.") };
  }
}

async function encodeActivityCursor(env, cursorType, filterHash, last) {
  return encodePaginationCursor(env, cursorType, {
    c: last.created_at,
    i: last.id,
    q: filterHash,
    exp: Date.now() + ACTIVITY_CURSOR_TTL_MS,
  });
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

  const dataLifecycleResult = await handleAdminDataLifecycle(ctx);
  if (dataLifecycleResult) {
    return dataLifecycleResult;
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
  // route-policy: admin.users.role.update
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
  // route-policy: admin.users.status.update
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
  // route-policy: admin.users.sessions.revoke
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
  // route-policy: admin.users.delete
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

    const limit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_ACTIVITY_LIMIT,
      maxValue: MAX_ADMIN_ACTIVITY_LIMIT,
    });
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = normalizeActivitySearchTerm(url.searchParams.get("search"));
    const filterHash = await buildActivitySearchFilterHash(ADMIN_AUDIT_LOG_TABLE, search);
    const cutoffIso = getActivityRetentionCutoff();

    const cursorResult = await decodeActivityCursorOrResponse(
      env,
      cursorParam,
      ADMIN_ACTIVITY_CURSOR_TYPE,
      filterHash
    );
    if (cursorResult.response) return cursorResult.response;
    const cursor = cursorResult.cursor;

    const entriesQuery = (() => {
      const conditions = [];
      const bindings = [];

      if (search) {
        conditions.push(`idx.source_table = '${ADMIN_AUDIT_LOG_TABLE}'`);
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "idx.created_at",
          idColumn: "idx.source_event_id",
        });
        appendActivitySearchConditions(conditions, bindings, search);
        return env.DB.prepare(
          `SELECT a.id, a.action, a.meta_json, a.created_at,
                  a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email,
                  a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email
           FROM activity_search_index idx
           JOIN admin_audit_log a ON a.id = idx.source_event_id
           LEFT JOIN users au ON au.id = a.admin_user_id
           LEFT JOIN users tu ON tu.id = a.target_user_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY idx.created_at DESC, idx.source_event_id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      }

      appendActivityCursorCondition(conditions, bindings, cursor, {
        createdColumn: "a.created_at",
        idColumn: "a.id",
      });
      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return env.DB.prepare(
        `SELECT a.id, a.action, a.meta_json, a.created_at,
                a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email,
                a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email
         FROM admin_audit_log a
         LEFT JOIN activity_search_index idx
           ON idx.source_table = 'admin_audit_log'
          AND idx.source_event_id = a.id
         LEFT JOIN users au ON au.id = a.admin_user_id
         LEFT JOIN users tu ON tu.id = a.target_user_id
         ${whereClause}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ?`
      ).bind(...bindings, limit + 1);
    })();

    const [entriesRes, countsRes] = await env.DB.batch([
      entriesQuery,
      env.DB.prepare(
        `SELECT action, COUNT(*) AS cnt
         FROM admin_audit_log
         WHERE created_at >= ?
         GROUP BY action`
      ).bind(cutoffIso),
    ]);

    const rows = entriesRes.results || [];
    const hasMore = rows.length > limit;
    const entries = (hasMore ? rows.slice(0, limit) : rows)
      .map((entry) => normalizeActivityEntry(entry, "admin_email", "target_email"));

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = await encodeActivityCursor(env, ADMIN_ACTIVITY_CURSOR_TYPE, filterHash, last);
    }

    const counts = {};
    for (const row of countsRes.results || []) {
      counts[row.action] = row.cnt;
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      counts,
      searchMode: search ? "indexed_prefix" : "recent",
      ...getActivityRetentionMetadata(),
    });
  }

  // GET /api/admin/user-activity
  if (pathname === "/api/admin/user-activity" && method === "GET") {
    const result = await requireAdmin(request, env, { isSecure, correlationId });
    if (result instanceof Response) return result;

    const limit = resolvePaginationLimit(url.searchParams.get("limit"), {
      defaultValue: DEFAULT_ADMIN_ACTIVITY_LIMIT,
      maxValue: MAX_ADMIN_ACTIVITY_LIMIT,
    });
    const cursorParam = url.searchParams.get("cursor") || null;
    const search = normalizeActivitySearchTerm(url.searchParams.get("search"));
    const filterHash = await buildActivitySearchFilterHash(USER_ACTIVITY_LOG_TABLE, search);

    const cursorResult = await decodeActivityCursorOrResponse(
      env,
      cursorParam,
      ADMIN_USER_ACTIVITY_CURSOR_TYPE,
      filterHash
    );
    if (cursorResult.response) return cursorResult.response;
    const cursor = cursorResult.cursor;

    let entriesRes;
    try {
      const conditions = [];
      const bindings = [];
      let entriesQuery;

      if (search) {
        conditions.push(`idx.source_table = '${USER_ACTIVITY_LOG_TABLE}'`);
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "idx.created_at",
          idColumn: "idx.source_event_id",
        });
        appendActivitySearchConditions(conditions, bindings, search);
        entriesQuery = env.DB.prepare(
          `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
                  COALESCE(u.email, idx.actor_email_norm) AS user_email
           FROM activity_search_index idx
           JOIN user_activity_log a ON a.id = idx.source_event_id
           LEFT JOIN users u ON u.id = a.user_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY idx.created_at DESC, idx.source_event_id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      } else {
        appendActivityCursorCondition(conditions, bindings, cursor, {
          createdColumn: "a.created_at",
          idColumn: "a.id",
        });
        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        entriesQuery = env.DB.prepare(
          `SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at,
                  COALESCE(u.email, idx.actor_email_norm) AS user_email
           FROM user_activity_log a
           LEFT JOIN activity_search_index idx
             ON idx.source_table = 'user_activity_log'
            AND idx.source_event_id = a.id
           LEFT JOIN users u ON u.id = a.user_id
           ${whereClause}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT ?`
        ).bind(...bindings, limit + 1);
      }

      entriesRes = await entriesQuery.all();
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

    const rows = entriesRes.results || [];
    const hasMore = rows.length > limit;
    const entries = (hasMore ? rows.slice(0, limit) : rows)
      .map((entry) => normalizeActivityEntry(entry, "user_email"));

    let nextCursor = null;
    if (hasMore && entries.length > 0) {
      const last = entries[entries.length - 1];
      nextCursor = await encodeActivityCursor(env, ADMIN_USER_ACTIVITY_CURSOR_TYPE, filterHash, last);
    }

    return json({
      ok: true,
      entries,
      nextCursor,
      searchMode: search ? "indexed_prefix" : "recent",
      ...getActivityRetentionMetadata(),
    });
  }

  return null;
}
