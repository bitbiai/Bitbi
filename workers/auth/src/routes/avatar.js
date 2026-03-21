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

// Validate file content matches declared MIME type via magic bytes
async function validateImageBytes(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 12) return { valid: false, buffer };

  let valid = false;

  if (file.type === "image/jpeg") {
    // JPEG: FF D8 FF
    valid = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  } else if (file.type === "image/png") {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    valid =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0D &&
      bytes[5] === 0x0A &&
      bytes[6] === 0x1A &&
      bytes[7] === 0x0A;
  } else if (file.type === "image/webp") {
    // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
    valid =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
  }

  return { valid, buffer };
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

  // Validate magic bytes match declared MIME type
  const { valid, buffer } = await validateImageBytes(file);
  if (!valid) {
    return json(
      { ok: false, error: "File content does not match the declared type." },
      { status: 400 }
    );
  }

  // Use the already-read buffer (arrayBuffer() consumed the stream)
  await env.PRIVATE_MEDIA.put(avatarKey(session.user.id), buffer, {
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
