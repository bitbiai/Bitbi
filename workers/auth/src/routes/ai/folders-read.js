import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import { getUserAssetStorageUsageSnapshot } from "../../lib/asset-storage-quota.js";
import { isMissingTextAssetTableError } from "./helpers.js";

export async function handleGetFolders(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const includeDeleting = url.searchParams.get("include_deleting") === "1";
  const statusFilter = includeDeleting ? "('active', 'deleting')" : "('active')";
  const cols = includeDeleting ? "id, name, slug, status, created_at" : "id, name, slug, created_at";

  const rows = await env.DB.prepare(
    `SELECT ${cols} FROM ai_folders WHERE user_id = ? AND status IN ${statusFilter} ORDER BY name ASC`
  ).bind(session.user.id).all();

  const imageCountRows = await env.DB.prepare(
    `SELECT folder_id, COUNT(*) AS cnt FROM ai_images WHERE user_id = ? GROUP BY folder_id`
  ).bind(session.user.id).all();

  let textCountRows = { results: [] };
  try {
    textCountRows = await env.DB.prepare(
      `SELECT folder_id, COUNT(*) AS cnt FROM ai_text_assets WHERE user_id = ? GROUP BY folder_id`
    ).bind(session.user.id).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const counts = {};
  let unfolderedCount = 0;
  for (const r of imageCountRows.results) {
    if (r.folder_id === null) {
      unfolderedCount += r.cnt;
    } else {
      counts[r.folder_id] = (counts[r.folder_id] || 0) + r.cnt;
    }
  }
  for (const r of textCountRows.results || []) {
    if (r.folder_id === null) {
      unfolderedCount += r.cnt;
    } else {
      counts[r.folder_id] = (counts[r.folder_id] || 0) + r.cnt;
    }
  }

  let storageUsage = null;
  try {
    storageUsage = await getUserAssetStorageUsageSnapshot(env, session.user.id);
  } catch {
    storageUsage = null;
  }

  const data = { folders: rows.results, counts, unfolderedCount };
  if (storageUsage) data.storageUsage = storageUsage;

  return json({ ok: true, data });
}
