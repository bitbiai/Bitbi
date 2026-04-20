import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { readJsonBody } from "../../lib/request.js";
import { nowIso } from "../../lib/tokens.js";
import { isMissingTextAssetTableError } from "./helpers.js";

export async function handleUpdateImagePublication(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const visibility = String(body?.visibility || "").trim().toLowerCase();
  if (visibility !== "public" && visibility !== "private") {
    return json({ ok: false, error: "Invalid visibility." }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT id, visibility, published_at FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!existing) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const publishedAt = visibility === "public"
    ? (existing.visibility === "public" && existing.published_at ? existing.published_at : nowIso())
    : null;

  await env.DB.prepare(
    "UPDATE ai_images SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
  ).bind(visibility, publishedAt, imageId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: imageId,
      visibility,
      is_public: visibility === "public",
      published_at: publishedAt,
    },
  });
}

export async function handleUpdateTextAssetPublication(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const visibility = String(body?.visibility || "").trim().toLowerCase();
  if (visibility !== "public" && visibility !== "private") {
    return json({ ok: false, error: "Invalid visibility." }, { status: 400 });
  }

  let existing;
  try {
    existing = await env.DB.prepare(
      "SELECT id, visibility, published_at FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!existing) {
    return json({ ok: false, error: "Asset not found." }, { status: 404 });
  }

  const publishedAt = visibility === "public"
    ? (existing.visibility === "public" && existing.published_at ? existing.published_at : nowIso())
    : null;

  await env.DB.prepare(
    "UPDATE ai_text_assets SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?"
  ).bind(visibility, publishedAt, assetId, session.user.id).run();

  return json({
    ok: true,
    data: {
      id: assetId,
      visibility,
      is_public: visibility === "public",
      published_at: publishedAt,
    },
  });
}
