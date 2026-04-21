import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso, randomTokenHex } from "../../lib/tokens.js";
import {
  hasControlCharacters,
  slugify,
} from "./helpers.js";
import { AiAssetLifecycleError, deleteUserAiFolder } from "./lifecycle.js";

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

  try {
    await deleteUserAiFolder({
      env,
      userId: session.user.id,
      folderId,
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

  return json({ ok: true });
}
