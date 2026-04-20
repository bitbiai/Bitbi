import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso, randomTokenHex } from "../../lib/tokens.js";
import { buildAiImageCleanupQueueInsertSql } from "../../lib/ai-image-derivatives.js";
import {
  flattenAiImageKeys,
  hasControlCharacters,
  isMissingTextAssetTableError,
  slugify,
} from "./helpers.js";

const MAX_FOLDER_NAME_LENGTH = 100;

export async function handleCreateFolder(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !body.name) {
    return json({ ok: false, error: "Folder name is required." }, { status: 400 });
  }

  const name = String(body.name).trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) {
    return json({ ok: false, error: `Folder name must be 1–${MAX_FOLDER_NAME_LENGTH} characters.` }, { status: 400 });
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return json({ ok: false, error: "Folder name cannot contain control characters." }, { status: 400 });
  }

  const slug = slugify(name);
  const id = randomTokenHex(16);
  const now = nowIso();

  try {
    await env.DB.prepare(
      "INSERT INTO ai_folders (id, user_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, session.user.id, name, slug, now).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return json({ ok: false, error: "A folder with that name already exists." }, { status: 409 });
    }
    throw e;
  }

  return json({ ok: true, data: { id, name, slug, created_at: now } }, { status: 201 });
}

export async function handleRenameFolder(ctx, folderId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const name = String(body?.name || "").trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) {
    return json({ ok: false, error: `Folder name must be 1–${MAX_FOLDER_NAME_LENGTH} characters.` }, { status: 400 });
  }
  if (hasControlCharacters(name)) {
    return json({ ok: false, error: "Folder name cannot contain control characters." }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT id, name, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
  ).bind(folderId, session.user.id).first();

  if (!existing) {
    return json({ ok: false, error: "Folder not found." }, { status: 404 });
  }

  const nextSlug = slugify(name);
  if (existing.name === name && existing.slug === nextSlug) {
    return json({
      ok: true,
      data: {
        id: existing.id,
        name: existing.name,
        slug: existing.slug,
        unchanged: true,
      },
    });
  }

  try {
    await env.DB.prepare(
      "UPDATE ai_folders SET name = ?, slug = ? WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(name, nextSlug, folderId, session.user.id).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return json({ ok: false, error: "A folder with that name already exists." }, { status: 409 });
    }
    throw error;
  }

  return json({
    ok: true,
    data: {
      id: folderId,
      name,
      slug: nextSlug,
      unchanged: false,
    },
  });
}

export async function handleDeleteFolder(ctx, folderId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const markResult = await env.DB.prepare(
    "UPDATE ai_folders SET status = 'deleting' WHERE id = ? AND user_id = ? AND status IN ('active', 'deleting')"
  ).bind(folderId, session.user.id).run();

  if (!markResult.meta.changes) {
    return json({ ok: false, error: "Folder not found." }, { status: 404 });
  }

  let r2Keys = [];
  let textAssetsEnabled = true;
  const ts = nowIso();
  try {
    const images = await env.DB.prepare(
      "SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE folder_id = ? AND user_id = ?"
    ).bind(folderId, session.user.id).all();
    r2Keys = flattenAiImageKeys(images);

    try {
      const textAssets = await env.DB.prepare(
        "SELECT r2_key, poster_r2_key FROM ai_text_assets WHERE folder_id = ? AND user_id = ?"
      ).bind(folderId, session.user.id).all();
      for (const row of textAssets.results || []) {
        r2Keys.push(row.r2_key);
        if (row.poster_r2_key) r2Keys.push(row.poster_r2_key);
      }
    } catch (error) {
      if (isMissingTextAssetTableError(error)) {
        textAssetsEnabled = false;
      } else {
        throw error;
      }
    }

    const statements = [
      env.DB.prepare(
        buildAiImageCleanupQueueInsertSql("folder_id = ? AND user_id = ?")
      ).bind(folderId, session.user.id, ts, ts, ts),
    ];

    if (textAssetsEnabled) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
           SELECT r2_key, 'pending', ?
           FROM ai_text_assets
           WHERE folder_id = ? AND user_id = ?`
        ).bind(ts, folderId, session.user.id),
        env.DB.prepare(
          `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
           SELECT poster_r2_key, 'pending', ?
           FROM ai_text_assets
           WHERE folder_id = ? AND user_id = ? AND poster_r2_key IS NOT NULL`
        ).bind(ts, folderId, session.user.id)
      );
    }

    statements.push(
      env.DB.prepare("DELETE FROM ai_images WHERE folder_id = ? AND user_id = ?").bind(folderId, session.user.id)
    );

    if (textAssetsEnabled) {
      statements.push(
        env.DB.prepare("DELETE FROM ai_text_assets WHERE folder_id = ? AND user_id = ?").bind(folderId, session.user.id)
      );
    }

    statements.push(
      env.DB.prepare("DELETE FROM ai_folders WHERE id = ? AND user_id = ?").bind(folderId, session.user.id)
    );

    await env.DB.batch(statements);
  } catch (e) {
    try {
      await env.DB.prepare(
        "UPDATE ai_folders SET status = 'active' WHERE id = ? AND user_id = ? AND status = 'deleting'"
      ).bind(folderId, session.user.id).run();
    } catch {}
    const unavailable = String(e).includes("no such table");
    return json(
      { ok: false, error: unavailable ? "Service temporarily unavailable. Please try again later." : "Failed to delete folder. Please try again." },
      { status: unavailable ? 503 : 500 }
    );
  }

  const cleanedKeys = [];
  for (const key of r2Keys) {
    try {
      await env.USER_IMAGES.delete(key);
      cleanedKeys.push(key);
    } catch {}
  }

  if (cleanedKeys.length > 0) {
    try {
      const ph = cleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
      ).bind(...cleanedKeys).run();
    } catch {}
  }

  return json({ ok: true });
}
