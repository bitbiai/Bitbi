import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { readJsonBody } from "../lib/request.js";
import { nowIso, randomTokenHex } from "../lib/tokens.js";
import { isRateLimited, rateLimitResponse } from "../lib/rate-limit.js";

const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_PROMPT_LENGTH = 1000;
const MIN_STEPS = 1;
const MAX_STEPS = 8; // flux-1-schnell documented max
const DEFAULT_STEPS = 4;
const GENERATION_LIMIT = 20; // per user per hour (in-memory rate limit)
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const DAILY_IMAGE_LIMIT = 10; // max successful generations per non-admin user per UTC day

// Parse a base64 string (plain or data-URI) into { base64, mimeType }
function parseBase64Image(str) {
  const dataUriMatch = str.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return { base64: dataUriMatch[2], mimeType: dataUriMatch[1] };
  }
  // Sanity check: base64 strings are long and contain only valid chars
  if (str.length > 100 && /^[A-Za-z0-9+/\n\r]+=*$/.test(str.slice(0, 200))) {
    return { base64: str, mimeType: "image/png" };
  }
  return null;
}

// Duck-type: convert buffer-like values to ArrayBuffer
async function toArrayBuffer(v) {
  if (v == null) return null;
  if (v instanceof ArrayBuffer) return v;
  if (typeof v.arrayBuffer === "function") {
    try { return await v.arrayBuffer(); } catch { /* fall through */ }
  }
  if (v.buffer instanceof ArrayBuffer && typeof v.byteLength === "number") {
    return v.buffer.byteLength === v.byteLength
      ? v.buffer
      : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  }
  if (typeof v.getReader === "function") {
    try { return await new Response(v).arrayBuffer(); } catch { /* fall through */ }
  }
  return null;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "folder";
}

// Helper: count today's generations for a user (UTC day boundary)
async function getDailyUsage(env, userId) {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dayStart = todayUtc + "T00:00:00.000Z";
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM ai_generation_log WHERE user_id = ? AND created_at >= ?"
  ).bind(userId, dayStart).first();
  return row ? row.cnt : 0;
}

// ── GET /api/ai/quota ──
async function handleQuota(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (session.user.role === "admin") {
    return json({ ok: true, data: { isAdmin: true } });
  }

  const usedToday = await getDailyUsage(env, session.user.id);
  const remaining = Math.max(0, DAILY_IMAGE_LIMIT - usedToday);
  return json({
    ok: true,
    data: {
      isAdmin: false,
      dailyLimit: DAILY_IMAGE_LIMIT,
      usedToday,
      remainingToday: remaining,
    },
  });
}

// ── POST /api/ai/generate-image ──
async function handleGenerateImage(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  // Rate limit per user (in-memory, per-isolate)
  if (isRateLimited(`ai-gen:${userId}`, GENERATION_LIMIT, GENERATION_WINDOW_MS)) {
    return rateLimitResponse();
  }

  // Daily generation limit for non-admin members (server-enforced via D1)
  if (!isAdmin) {
    const usedToday = await getDailyUsage(env, userId);
    if (usedToday >= DAILY_IMAGE_LIMIT) {
      return json(
        {
          ok: false,
          code: "DAILY_IMAGE_LIMIT_REACHED",
          error: `You've reached your daily image generation limit (${DAILY_IMAGE_LIMIT}/${DAILY_IMAGE_LIMIT}). Please come back tomorrow for more creations.`,
        },
        { status: 429 }
      );
    }
  }

  const body = await readJsonBody(request);
  if (!body || !body.prompt) {
    return json({ ok: false, error: "Prompt is required." }, { status: 400 });
  }

  const prompt = String(body.prompt).trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return json(
      { ok: false, error: `Prompt must be 1–${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 }
    );
  }

  let steps = DEFAULT_STEPS;
  if (body.steps !== undefined && body.steps !== null) {
    steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.floor(Number(body.steps))));
    if (isNaN(steps)) steps = DEFAULT_STEPS;
  }

  let seed = null;
  if (body.seed !== undefined && body.seed !== null) {
    seed = Math.floor(Number(body.seed));
    if (isNaN(seed) || seed < 0) seed = null;
  }

  const aiInput = { prompt, num_steps: steps };
  if (seed !== null) aiInput.seed = seed;

  let base64 = null;
  let mimeType = "image/png";

  try {
    const result = await env.AI.run(MODEL, aiInput);

    // Collect candidate values to try, in priority order
    const candidates = [];
    if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
      if (result.image != null) candidates.push(result.image);
      if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
      if (result.data != null) candidates.push(result.data);
    }
    candidates.push(result); // try the raw result last

    for (const v of candidates) {
      if (base64) break;

      // Case 1: string (base64 or data URI) — this is what flux-1-schnell returns in production
      if (typeof v === "string" && v.length > 0) {
        const parsed = parseBase64Image(v);
        if (parsed) {
          base64 = parsed.base64;
          mimeType = parsed.mimeType;
          break;
        }
      }

      // Case 2: binary (Uint8Array, ArrayBuffer, ReadableStream)
      const buf = await toArrayBuffer(v);
      if (buf && buf.byteLength > 0) {
        const bytes = new Uint8Array(buf);
        base64 = btoa(bytes.reduce((s, b) => s + String.fromCharCode(b), ""));
        break;
      }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return json({ ok: false, error: `Image generation failed: ${msg}` }, { status: 502 });
  }

  if (!base64) {
    return json({ ok: false, error: "No image was generated." }, { status: 502 });
  }

  // Log generation for quota tracking
  const logId = randomTokenHex(16);
  await env.DB.prepare(
    "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
  ).bind(logId, userId, nowIso()).run();

  return json({
    ok: true,
    data: {
      imageBase64: base64,
      mimeType,
      prompt,
      steps,
      seed,
      model: MODEL,
    },
  });
}

// ── GET /api/ai/folders ──
async function handleGetFolders(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const includeDeleting = url.searchParams.get("include_deleting") === "1";
  const statusFilter = includeDeleting ? "('active', 'deleting')" : "('active')";
  const cols = includeDeleting ? "id, name, slug, status, created_at" : "id, name, slug, created_at";

  const rows = await env.DB.prepare(
    `SELECT ${cols} FROM ai_folders WHERE user_id = ? AND status IN ${statusFilter} ORDER BY name ASC`
  ).bind(session.user.id).all();

  // Aggregate per-folder image counts (no row cap)
  const countRows = await env.DB.prepare(
    `SELECT folder_id, COUNT(*) AS cnt FROM ai_images WHERE user_id = ? GROUP BY folder_id`
  ).bind(session.user.id).all();

  const counts = {};
  let unfolderedCount = 0;
  for (const r of countRows.results) {
    if (r.folder_id === null) {
      unfolderedCount = r.cnt;
    } else {
      counts[r.folder_id] = r.cnt;
    }
  }

  return json({ ok: true, data: { folders: rows.results, counts, unfolderedCount } });
}

// ── POST /api/ai/folders ──
async function handleCreateFolder(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !body.name) {
    return json({ ok: false, error: "Folder name is required." }, { status: 400 });
  }

  const name = String(body.name).trim();
  if (name.length === 0 || name.length > 100) {
    return json({ ok: false, error: "Folder name must be 1–100 characters." }, { status: 400 });
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

// ── GET /api/ai/images ──
async function handleGetImages(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const folderId = url.searchParams.get("folder_id") || null;
  const onlyUnfoldered = url.searchParams.get("only_unfoldered") === "1";

  let query, params;
  if (onlyUnfoldered) {
    query = `SELECT id, folder_id, prompt, model, steps, seed, created_at
             FROM ai_images WHERE user_id = ? AND folder_id IS NULL
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  } else if (folderId) {
    query = `SELECT id, folder_id, prompt, model, steps, seed, created_at
             FROM ai_images WHERE user_id = ? AND folder_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id, folderId];
  } else {
    query = `SELECT id, folder_id, prompt, model, steps, seed, created_at
             FROM ai_images WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  }

  const rows = await env.DB.prepare(query).bind(...params).all();
  return json({ ok: true, data: { images: rows.results } });
}

// ── POST /api/ai/images/save ──
async function handleSaveImage(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !body.imageData || !body.prompt) {
    return json({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
  }

  // Validate optional folder ownership (only active folders accept saves)
  let folderId = null;
  let folderSlug = "unsorted";
  if (body.folder_id) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(body.folder_id, session.user.id).first();
    if (!folder) {
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    folderId = folder.id;
    folderSlug = folder.slug;
  }

  // Decode base64 data URI to bytes
  const match = String(body.imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    return json({ ok: false, error: "Invalid image data format." }, { status: 400 });
  }
  const savedMimeType = match[1];

  let imageBytes;
  try {
    const raw = atob(match[2]);
    imageBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) imageBytes[i] = raw.charCodeAt(i);
  } catch {
    return json({ ok: false, error: "Invalid base64 image data." }, { status: 400 });
  }

  // Validate image magic bytes (PNG, JPEG, or WebP)
  const isPng  = imageBytes.length >= 4 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
  const isJpeg = imageBytes.length >= 3 && imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
  const isWebp = imageBytes.length >= 12 && imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46 && imageBytes[8] === 0x57 && imageBytes[9] === 0x45 && imageBytes[10] === 0x42 && imageBytes[11] === 0x50;
  if (!isPng && !isJpeg && !isWebp) {
    return json({ ok: false, error: "Invalid image format." }, { status: 400 });
  }

  const imageId = randomTokenHex(16);
  const timestamp = Date.now();
  const random = randomTokenHex(4);
  const r2Key = `users/${session.user.id}/folders/${folderSlug}/${timestamp}-${random}.png`;
  const now = nowIso();

  // Store in R2
  await env.USER_IMAGES.put(r2Key, imageBytes.buffer, {
    httpMetadata: { contentType: savedMimeType },
  });

  // Store metadata in D1
  const prompt = String(body.prompt).slice(0, MAX_PROMPT_LENGTH);
  const model = String(body.model || MODEL).slice(0, 100);
  const steps = body.steps ? Math.floor(Number(body.steps)) : null;
  const seed = body.seed !== undefined && body.seed !== null ? Math.floor(Number(body.seed)) : null;

  let insertResult;
  try {
    if (folderId) {
      // Conditional insert: only succeeds if the folder is still active.
      // The status check and row insertion are a single atomic SQL statement,
      // so no concurrent folder delete can slip between check and insert.
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
      ).bind(imageId, session.user.id, folderId, r2Key, prompt, model, steps, seed, now,
             folderId, session.user.id).run();
    } else {
      // Unsorted save — no folder to race with
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(imageId, session.user.id, null, r2Key, prompt, model, steps, seed, now).run();
    }
  } catch (e) {
    // INSERT failed (e.g. FK violation from concurrent folder delete)
    try { await env.USER_IMAGES.delete(r2Key); } catch { /* best effort */ }
    return json({ ok: false, error: "Failed to save image. The folder may have been deleted." }, { status: 409 });
  }

  // If the conditional insert produced 0 rows the folder was deleted/deleting
  if (!insertResult.meta.changes) {
    try { await env.USER_IMAGES.delete(r2Key); } catch { /* best effort */ }
    return json({ ok: false, error: "Folder was deleted. Image not saved." }, { status: 404 });
  }

  return json({
    ok: true,
    data: { id: imageId, folder_id: folderId, prompt, model, steps, seed, created_at: now },
  }, { status: 201 });
}

// ── GET /api/ai/images/:id/file ──
async function handleGetImageFile(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const row = await env.DB.prepare(
    "SELECT r2_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Image file not found." }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

// ── DELETE /api/ai/folders/:id ──
async function handleDeleteFolder(ctx, folderId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  // Mark folder as 'deleting' — blocks concurrent saves because
  // handleSaveImage requires status = 'active'.
  // Also accepts folders already in 'deleting' (from a previously failed
  // delete attempt whose rollback did not succeed) so the retry can finish.
  const markResult = await env.DB.prepare(
    "UPDATE ai_folders SET status = 'deleting' WHERE id = ? AND user_id = ? AND status IN ('active', 'deleting')"
  ).bind(folderId, session.user.id).run();

  if (!markResult.meta.changes) {
    return json({ ok: false, error: "Folder not found." }, { status: 404 });
  }

  let r2Keys = [];
  try {
    // Snapshot images for R2 cleanup (folder row still exists, folder_id intact)
    const images = await env.DB.prepare(
      "SELECT r2_key FROM ai_images WHERE folder_id = ? AND user_id = ?"
    ).bind(folderId, session.user.id).all();
    r2Keys = (images.results || []).map(r => r.r2_key);

    // Atomically delete all image rows by folder_id predicate (no bind-limit
    // risk) and the folder row itself in a single batch transaction.
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM ai_images WHERE folder_id = ? AND user_id = ?"
      ).bind(folderId, session.user.id),
      env.DB.prepare(
        "DELETE FROM ai_folders WHERE id = ? AND user_id = ?"
      ).bind(folderId, session.user.id),
    ]);
  } catch (e) {
    // Snapshot or batch failed — folder row may still exist in 'deleting'.
    // Revert to 'active' so the folder is not permanently hidden.
    try {
      await env.DB.prepare(
        "UPDATE ai_folders SET status = 'active' WHERE id = ? AND user_id = ? AND status = 'deleting'"
      ).bind(folderId, session.user.id).run();
    } catch { /* rollback is best-effort; retry will re-enter via 'deleting' accept */ }
    return json({ ok: false, error: "Failed to delete folder. Please try again." }, { status: 500 });
  }

  // Best-effort R2 cleanup — DB deletion already succeeded, so a partial
  // R2 failure leaves orphaned blobs but no stuck folder state.
  for (const key of r2Keys) {
    try { await env.USER_IMAGES.delete(key); } catch { /* best effort */ }
  }

  return json({ ok: true });
}

// ── DELETE /api/ai/images/:id ──
async function handleDeleteImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const row = await env.DB.prepare(
    "SELECT r2_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  // Delete from R2 and D1
  await env.USER_IMAGES.delete(row.r2_key);
  await env.DB.prepare("DELETE FROM ai_images WHERE id = ?").bind(imageId).run();

  return json({ ok: true });
}

// ── PATCH /api/ai/images/bulk-move ──
async function handleBulkMove(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.image_ids) || body.image_ids.length === 0) {
    return json({ ok: false, error: "image_ids array is required." }, { status: 400 });
  }

  const imageIds = body.image_ids;
  if (imageIds.length > 50) {
    return json({ ok: false, error: "Cannot move more than 50 images at once." }, { status: 400 });
  }

  for (const id of imageIds) {
    if (typeof id !== "string" || !/^[a-f0-9]+$/.test(id)) {
      return json({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
  }

  const folderId = body.folder_id || null;
  if (folderId) {
    if (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId)) {
      return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
    }
    const folder = await env.DB.prepare(
      "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(folderId, session.user.id).first();
    if (!folder) {
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
  }

  // Advisory ownership pre-check — gives a clear 404 before the guarded write
  const placeholders = imageIds.map(() => "?").join(",");
  const owned = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).first();

  if (!owned || owned.cnt !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

  // CTE-guarded UPDATE: IDs bound once via VALUES, count guard ensures
  // all-or-nothing within a single atomic statement. If any image was
  // concurrently deleted between the advisory check and this statement,
  // the count mismatch causes zero rows to be updated.
  const valuesList = imageIds.map(() => "(?)").join(",");
  let result;
  if (folderId) {
    result = await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images SET folder_id = ?
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
    ).bind(...imageIds, folderId, session.user.id, session.user.id, folderId, session.user.id).run();
  } else {
    result = await env.DB.prepare(
      `WITH requested(id) AS (VALUES ${valuesList})
       UPDATE ai_images SET folder_id = NULL
       WHERE user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (SELECT COUNT(*) FROM requested) =
             (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
    ).bind(...imageIds, session.user.id, session.user.id).run();
  }

  if (!result.meta.changes || result.meta.changes !== imageIds.length) {
    return json(
      { ok: false, error: "Move failed. Some images may have been deleted or the folder removed." },
      { status: 409 }
    );
  }

  return json({ ok: true, data: { moved: imageIds.length } });
}

// ── POST /api/ai/images/bulk-delete ──
async function handleBulkDelete(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.image_ids) || body.image_ids.length === 0) {
    return json({ ok: false, error: "image_ids array is required." }, { status: 400 });
  }

  const imageIds = body.image_ids;
  if (imageIds.length > 50) {
    return json({ ok: false, error: "Cannot delete more than 50 images at once." }, { status: 400 });
  }

  for (const id of imageIds) {
    if (typeof id !== "string" || !/^[a-f0-9]+$/.test(id)) {
      return json({ ok: false, error: "Invalid image ID." }, { status: 400 });
    }
  }

  // Advisory pre-check — also captures r2_keys for inline R2 cleanup later
  const placeholders = imageIds.map(() => "?").join(",");
  const snapshot = await env.DB.prepare(
    `SELECT id, r2_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...imageIds, session.user.id).all();

  if (!snapshot.results || snapshot.results.length !== imageIds.length) {
    return json({ ok: false, error: "One or more images not found." }, { status: 404 });
  }

  // Atomic batch: queue creation + row deletion in ONE D1 transaction.
  //
  // Statement 1: INSERT cleanup jobs by SELECTing r2_keys from ai_images.
  //   The CTE count guard ensures this only inserts if ALL requested images
  //   exist and are owned. Runs first so it reads ai_images before deletion.
  //
  // Statement 2: DELETE the matching ai_images rows with the same guard.
  //   Within this transaction, statement 2 sees ai_images after statement 1
  //   read from it (statement 1 only inserted into a different table).
  //   The count guard evaluates identically — both affect N rows or 0 rows.
  //
  // Invariant: if ai_images rows are gone, their cleanup queue entries
  // definitely exist in the same committed transaction. No split-brain.
  const valuesList = imageIds.map(() => "(?)").join(",");
  const ts = nowIso();

  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ?
         FROM ai_images
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...imageIds, ts, session.user.id, session.user.id),

      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_images
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...imageIds, session.user.id, session.user.id),
    ]);
  } catch (e) {
    // Batch failed — transaction rolled back, nothing committed.
    console.error("Bulk delete: atomic batch failed", e);
    const msg = String(e).includes("no such table")
      ? "Service temporarily unavailable. Please try again later."
      : "Delete failed. Please try again.";
    return json({ ok: false, error: msg }, { status: 503 });
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== imageIds.length) {
    // CTE count guard failed — concurrent mutation. Both statements
    // affected zero rows within the same committed transaction.
    return json(
      { ok: false, error: "Delete failed. Some images may have already been removed." },
      { status: 409 }
    );
  }

  // Durable handoff complete — all deleted r2_keys have queue entries.
  // Inline R2 cleanup is best-effort optimization only.
  const cleanedKeys = [];
  for (const row of snapshot.results) {
    try {
      await env.USER_IMAGES.delete(row.r2_key);
      cleanedKeys.push(row.r2_key);
    } catch { /* leave queue entry for scheduled retry */ }
  }

  // Remove queue entries for blobs already cleaned up inline.
  // If this fails, the scheduled handler will re-delete idempotently.
  if (cleanedKeys.length > 0) {
    try {
      const ph = cleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
      ).bind(...cleanedKeys).run();
    } catch { /* non-critical — idempotent R2 delete on next scheduled run */ }
  }

  return json({ ok: true, data: { deleted } });
}

// ── Main dispatcher ──
export async function handleAI(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/ai/quota" && method === "GET") {
    return handleQuota(ctx);
  }
  if (pathname === "/api/ai/generate-image" && method === "POST") {
    return handleGenerateImage(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "GET") {
    return handleGetFolders(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "POST") {
    return handleCreateFolder(ctx);
  }
  if (pathname === "/api/ai/images" && method === "GET") {
    return handleGetImages(ctx);
  }
  if (pathname === "/api/ai/images/save" && method === "POST") {
    return handleSaveImage(ctx);
  }
  if (pathname === "/api/ai/images/bulk-move" && method === "PATCH") {
    return handleBulkMove(ctx);
  }
  if (pathname === "/api/ai/images/bulk-delete" && method === "POST") {
    return handleBulkDelete(ctx);
  }

  // DELETE /api/ai/folders/:id
  const folderDeleteMatch = pathname.match(/^\/api\/ai\/folders\/([a-f0-9]+)$/);
  if (folderDeleteMatch && method === "DELETE") {
    return handleDeleteFolder(ctx, folderDeleteMatch[1]);
  }

  // /api/ai/images/:id/file
  const fileMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetImageFile(ctx, fileMatch[1]);
  }

  // DELETE /api/ai/images/:id
  const deleteMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    return handleDeleteImage(ctx, deleteMatch[1]);
  }

  return null;
}
