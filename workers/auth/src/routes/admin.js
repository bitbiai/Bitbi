import { json } from "../lib/response.js";
import { readJsonBody } from "../lib/request.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";
import { isSharedRateLimited, getClientIp, rateLimitResponse } from "../lib/rate-limit.js";
import { handleAdminAI } from "./admin-ai.js";

function isMissingTextAssetTableError(error) {
  return String(error || "").includes("no such table") && String(error || "").includes("ai_text_assets");
}

function auditStatement(env, adminUserId, action, targetUserId, meta, now) {
  return env.DB.prepare(
    `INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    adminUserId,
    action,
    targetUserId,
    JSON.stringify(meta),
    now
  );
}

export async function handleAdmin(ctx) {
  const { request, env, url, pathname, method } = ctx;

  const adminAiResult = await handleAdminAI(ctx);
  if (adminAiResult) {
    return adminAiResult;
  }

  // GET /api/admin/me
  if (pathname === "/api/admin/me" && method === "GET") {
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    return json({
      ok: true,
      user: result.user,
    });
  }

  // GET /api/admin/users
  if (pathname === "/api/admin/users" && method === "GET") {
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    const search = url.searchParams.get("search");

    let rows;
    if (search) {
      rows = await env.DB.prepare(
        `
        SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method
        FROM users
        WHERE email LIKE ?
        ORDER BY created_at DESC
        LIMIT 100
        `
      )
        .bind(`%${search}%`)
        .all();
    } else {
      rows = await env.DB.prepare(
        `
        SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method
        FROM users
        ORDER BY created_at DESC
        LIMIT 100
        `
      )
        .all();
    }

    return json({
      ok: true,
      users: rows.results,
    });
  }

  // PATCH /api/admin/users/:id/role
  if (
    pathname.startsWith("/api/admin/users/") &&
    pathname.endsWith("/role") &&
    method === "PATCH"
  ) {
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    const ip = getClientIp(request);
    if (await isSharedRateLimited(env, "admin-action-ip", ip, 30, 900_000)) return rateLimitResponse();

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "role"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const body = await readJsonBody(request);

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

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET role = ?, updated_at = ? WHERE id = ?"
      ).bind(newRole, now, targetUserId),
      auditStatement(env, result.user.id, "change_role", targetUserId, {
        role: newRole,
        target_email: targetUser.email,
        target_role: targetUser.role,
        target_status: targetUser.status,
        actor_email: result.user.email,
      }, now),
    ]);

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
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    const ip = getClientIp(request);
    if (await isSharedRateLimited(env, "admin-action-ip", ip, 30, 900_000)) return rateLimitResponse();

    const parts = pathname.split("/");
    // ["", "api", "admin", "users", ":id", "status"]
    const targetUserId = parts[4];

    if (!targetUserId || parts.length !== 6) {
      return json(
        { ok: false, error: "Invalid path." },
        { status: 400 }
      );
    }

    const body = await readJsonBody(request);

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

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
      ).bind(newStatus, now, targetUserId),
      auditStatement(env, result.user.id, "change_status", targetUserId, {
        status: newStatus,
        target_email: targetUser.email,
        target_role: targetUser.role,
        target_status: targetUser.status,
        actor_email: result.user.email,
      }, now),
    ]);

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
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    const ip = getClientIp(request);
    if (await isSharedRateLimited(env, "admin-action-ip", ip, 30, 900_000)) return rateLimitResponse();

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

    await env.DB.prepare(
      `
      INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        crypto.randomUUID(),
        result.user.id,
        "revoke_sessions",
        targetUserId,
        JSON.stringify({
          revokedSessions: deleteResult.meta.changes,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        }),
        now
      )
      .run();

    return json({
      ok: true,
      revokedSessions: deleteResult.meta.changes,
      targetUserId,
    });
  }

  // GET /api/admin/stats
  if (pathname === "/api/admin/stats" && method === "GET") {
    const result = await requireAdmin(request, env);
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
    const result = await requireAdmin(request, env);
    if (result instanceof Response) return result;

    const listed = await env.PRIVATE_MEDIA.list({ prefix: "avatars/", limit: 1000 });

    if (!listed.objects.length) {
      return json({ ok: true, avatars: [] });
    }

    const newest = listed.objects
      .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
      .slice(0, 4);

    const userIds = newest.map((obj) => obj.key.replace("avatars/", ""));
    const placeholders = userIds.map(() => "?").join(",");
    const users = await env.DB.prepare(
      `SELECT u.id, u.email, p.display_name
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id IN (${placeholders})`
    )
      .bind(...userIds)
      .all();

    const userMap = new Map();
    for (const u of users.results) {
      userMap.set(u.id, u);
    }

    const avatars = newest.map((obj) => {
      const userId = obj.key.replace("avatars/", "");
      const user = userMap.get(userId);
      return {
        userId,
        email: user?.email || null,
        displayName: user?.display_name || null,
        uploadedAt: obj.uploaded.toISOString(),
      };
    });

    return json({ ok: true, avatars });
  }

  // GET /api/admin/avatars/:userId (serve image)
  if (
    pathname.startsWith("/api/admin/avatars/") &&
    method === "GET"
  ) {
    const result = await requireAdmin(request, env);
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
    const result = await requireAdmin(request, env);

    if (result instanceof Response) {
      return result;
    }

    const ip = getClientIp(request);
    if (await isSharedRateLimited(env, "admin-action-ip", ip, 30, 900_000)) return rateLimitResponse();

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
    let r2Keys = [];
    let textAssetsEnabled = true;
    try {
      const images = await env.DB.prepare(
        "SELECT r2_key FROM ai_images WHERE user_id = ?"
      ).bind(targetUserId).all();
      r2Keys = (images.results || []).map((row) => row.r2_key);

      try {
        const textAssets = await env.DB.prepare(
          "SELECT r2_key FROM ai_text_assets WHERE user_id = ?"
        ).bind(targetUserId).all();
        r2Keys = r2Keys.concat((textAssets.results || []).map((row) => row.r2_key));
      } catch (error) {
        if (isMissingTextAssetTableError(error)) {
          textAssetsEnabled = false;
        } else {
          throw error;
        }
      }

      const statements = [
        env.DB.prepare(
          `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
           SELECT r2_key, 'pending', ?
           FROM ai_images
           WHERE user_id = ?`
        ).bind(now, targetUserId),
        env.DB.prepare("DELETE FROM ai_images WHERE user_id = ?").bind(targetUserId),
      ];

      if (textAssetsEnabled) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
             SELECT r2_key, 'pending', ?
             FROM ai_text_assets
             WHERE user_id = ?`
          ).bind(now, targetUserId),
          env.DB.prepare("DELETE FROM ai_text_assets WHERE user_id = ?").bind(targetUserId)
        );
      }

      statements.push(
        env.DB.prepare("DELETE FROM ai_folders WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(targetUserId),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId),
        auditStatement(env, result.user.id, "delete_user", targetUserId, {
          deletedUserId: targetUserId,
          target_email: targetUser.email,
          target_role: targetUser.role,
          target_status: targetUser.status,
          actor_email: result.user.email,
        }, now),
      );

      await env.DB.batch(statements);
    } catch (e) {
      const unavailable = String(e).includes("no such table");
      return json(
        { ok: false, error: unavailable ? "Service temporarily unavailable. Please try again later." : "Failed to delete user. Please try again." },
        { status: unavailable ? 503 : 500 }
      );
    }

    // Avatar cleanup is best-effort because the destructive DB work already committed.
    try {
      await env.PRIVATE_MEDIA.delete(`avatars/${targetUserId}`);
    } catch (e) {
      console.error("Admin delete: avatar cleanup failed", e);
    }

    const cleanedKeys = [];
    for (const key of r2Keys) {
      try {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      } catch { /* leave queue entry for scheduled retry */ }
    }
    if (cleanedKeys.length > 0) {
      try {
        const ph = cleanedKeys.map(() => "?").join(",");
        await env.DB.prepare(
          `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
        ).bind(...cleanedKeys).run();
      } catch { /* non-critical — scheduled cleanup will retry idempotently */ }
    }

    return json({
      ok: true,
      deletedUserId: targetUserId,
    });
  }

  // GET /api/admin/activity
  if (pathname === "/api/admin/activity" && method === "GET") {
    const result = await requireAdmin(request, env);
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
    });
  }

  // GET /api/admin/user-activity
  if (pathname === "/api/admin/user-activity" && method === "GET") {
    const result = await requireAdmin(request, env);
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
    });
  }

  return null;
}
