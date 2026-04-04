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
const GENERATION_LIMIT = 20; // per user per hour
const GENERATION_WINDOW_MS = 60 * 60 * 1000;

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

// ── POST /api/ai/generate-image ──
async function handleGenerateImage(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;

  // Rate limit per user
  if (isRateLimited(`ai-gen:${userId}`, GENERATION_LIMIT, GENERATION_WINDOW_MS)) {
    return rateLimitResponse();
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
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const rows = await env.DB.prepare(
    "SELECT id, name, slug, created_at FROM ai_folders WHERE user_id = ? ORDER BY name ASC"
  ).bind(session.user.id).all();

  return json({ ok: true, data: { folders: rows.results } });
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

  let query, params;
  if (folderId) {
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

  // Validate optional folder ownership
  let folderId = null;
  let folderSlug = "unsorted";
  if (body.folder_id) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ?"
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

  await env.DB.prepare(
    `INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(imageId, session.user.id, folderId, r2Key, prompt, model, steps, seed, now).run();

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

// ── Main dispatcher ──
export async function handleAI(ctx) {
  const { pathname, method } = ctx;

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
