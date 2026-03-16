import { json } from "../lib/response.js";
import { readJsonBody } from "../lib/request.js";
import { nowIso } from "../lib/tokens.js";
import { requireAdmin } from "../lib/session.js";

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
        SELECT id, email, role, status, created_at, updated_at, email_verified_at
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
        SELECT id, email, role, status, created_at, updated_at, email_verified_at
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
      "SELECT id FROM users WHERE id = ? LIMIT 1"
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
      auditStatement(env, result.user.id, "change_role", targetUserId, { role: newRole }, now),
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
      "SELECT id FROM users WHERE id = ? LIMIT 1"
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
      auditStatement(env, result.user.id, "change_status", targetUserId, { status: newStatus }, now),
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
      "SELECT id FROM users WHERE id = ? LIMIT 1"
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
        JSON.stringify({ revokedSessions: deleteResult.meta.changes }),
        now
      )
      .run();

    return json({
      ok: true,
      revokedSessions: deleteResult.meta.changes,
      targetUserId,
    });
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
      "SELECT id FROM users WHERE id = ? LIMIT 1"
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
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
      env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(targetUserId),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetUserId),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId),
      auditStatement(env, result.user.id, "delete_user", targetUserId, { deletedUserId: targetUserId }, now),
    ]);

    // Clean up avatar from R2 (idempotent, no error if absent)
    await env.PRIVATE_MEDIA.delete(`avatars/${targetUserId}`);

    return json({
      ok: true,
      deletedUserId: targetUserId,
    });
  }

  return null;
}
