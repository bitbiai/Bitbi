/* ============================================================
   BITBI — Profile routes: GET + PATCH /api/profile
   ============================================================ */

import { json } from "../lib/response.js";
import { readJsonBody, isValidUrl } from "../lib/request.js";
import { requireUser } from "../lib/session.js";
import { nowIso } from "../lib/tokens.js";

function stripHtml(str) {
  return str
    .replace(/<[^>]*>?/g, "")       // tags including unclosed
    .replace(/&[#a-zA-Z0-9]+;/g, "") // HTML entities
    .replace(/javascript:/gi, "")    // protocol handlers
    .replace(/on\w+\s*=/gi, "");     // event handlers
}

const FIELD_LIMITS = {
  display_name: 50,
  bio: 300,
  website: 300,
  youtube_url: 300,
};

const URL_FIELDS = ["website", "youtube_url"];

/* ── GET /api/profile ── */
export async function handleGetProfile(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;

  const row = await env.DB.prepare(
    `SELECT u.email, u.role, u.created_at, u.email_verified_at, u.verification_method,
            p.display_name, p.bio, p.website, p.youtube_url
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?`
  )
    .bind(userId)
    .first();

  return json({
    ok: true,
    profile: {
      display_name: row.display_name || "",
      bio: row.bio || "",
      website: row.website || "",
      youtube_url: row.youtube_url || "",
    },
    account: {
      email: row.email,
      role: row.role,
      created_at: row.created_at,
      email_verified: !!row.email_verified_at,
      verification_method: row.verification_method || null,
    },
  });
}

/* ── PATCH /api/profile ── */
export async function handleUpdateProfile(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body) {
    return json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const fields = {};

  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    if (key in body) {
      const val = stripHtml(String(body[key] ?? "")).trim();
      if (val.length > max) {
        return json(
          { ok: false, error: `${key} must be at most ${max} characters.` },
          { status: 400 }
        );
      }
      fields[key] = val;
    }
  }

  if (Object.keys(fields).length === 0) {
    return json(
      { ok: false, error: "No valid fields to update." },
      { status: 400 }
    );
  }

  // Validate URL fields
  for (const urlField of URL_FIELDS) {
    if (fields[urlField] && !isValidUrl(fields[urlField])) {
      return json(
        { ok: false, error: `${urlField} must be a valid https:// URL.` },
        { status: 400 }
      );
    }
  }

  const userId = session.user.id;
  const now = nowIso();

  // Read current profile to merge with partial update
  const current = await env.DB.prepare(
    "SELECT display_name, bio, website, youtube_url, created_at FROM profiles WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  const merged = {
    display_name: fields.display_name ?? current?.display_name ?? "",
    bio: fields.bio ?? current?.bio ?? "",
    website: fields.website ?? current?.website ?? "",
    youtube_url: fields.youtube_url ?? current?.youtube_url ?? "",
  };

  await env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, bio, website, youtube_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       bio          = excluded.bio,
       website      = excluded.website,
       youtube_url  = excluded.youtube_url,
       updated_at   = excluded.updated_at`
  )
    .bind(
      userId,
      merged.display_name,
      merged.bio,
      merged.website,
      merged.youtube_url,
      now,
      now
    )
    .run();

  return json({
    ok: true,
    message: "Profile updated.",
    profile: merged,
  });
}
