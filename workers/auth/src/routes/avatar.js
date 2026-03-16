/* ============================================================
   BITBI — Avatar routes: GET/POST/DELETE /api/profile/avatar
   ============================================================ */

import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { isRateLimited, getClientIp, rateLimitResponse } from "../lib/rate-limit.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

function avatarKey(userId) {
  return `avatars/${userId}`;
}

/* ── GET /api/profile/avatar ── */
export async function handleGetAvatar(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const object = await env.PRIVATE_MEDIA.get(avatarKey(session.user.id));

  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
}

/* ── POST /api/profile/avatar ── */
export async function handleUploadAvatar(ctx) {
  const { request, env } = ctx;

  const ip = getClientIp(request);
  if (isRateLimited(`avatar-upload:${ip}`, 10, 3_600_000)) {
    return rateLimitResponse();
  }

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("avatar");

  if (!file || typeof file === "string") {
    return json({ ok: false, error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return json(
      { ok: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return json(
      { ok: false, error: "File too large. Maximum size is 2 MB." },
      { status: 400 }
    );
  }

  await env.PRIVATE_MEDIA.put(avatarKey(session.user.id), file, {
    httpMetadata: { contentType: file.type },
  });

  return json({ ok: true, message: "Avatar uploaded." });
}

/* ── DELETE /api/profile/avatar ── */
export async function handleDeleteAvatar(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  await env.PRIVATE_MEDIA.delete(avatarKey(session.user.id));

  return json({ ok: true, message: "Avatar removed." });
}
