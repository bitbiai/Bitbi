import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { readJsonBody } from "../lib/request.js";
import { addMinutesIso, nowIso, randomTokenHex } from "../lib/tokens.js";
import { isSharedRateLimited, rateLimitResponse } from "../lib/rate-limit.js";
import {
  AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS,
  AI_IMAGE_DERIVATIVE_VERSION,
  buildAiImageCleanupQueueInsertSql,
  buildAiImageDerivativeMessage,
  enqueueAiImageDerivativeJob,
  listAiImageObjectKeys,
  processAiImageDerivativeMessage,
  shouldAttemptOnDemandAiImageDerivative,
  toAiImageAssetRecord,
} from "../lib/ai-image-derivatives.js";
import { saveAdminAiTextAsset } from "../lib/ai-text-assets.js";
import aiImageModels from "../../../../js/shared/ai-image-models.mjs";
import {
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";

const {
  DEFAULT_AI_IMAGE_MODEL,
  resolveAiImageModel,
} = aiImageModels;

const MODEL = DEFAULT_AI_IMAGE_MODEL;
const MAX_PROMPT_LENGTH = 1000;
const MIN_STEPS = 1;
const MAX_STEPS = 8; // flux-1-schnell documented max
const DEFAULT_STEPS = 4;
const GENERATION_LIMIT = 20; // per user per hour (in-memory rate limit)
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const DAILY_IMAGE_LIMIT = 10; // max successful generations per non-admin user per UTC day
const QUOTA_RESERVATION_TTL_MINUTES = 60;
const AI_IMAGE_LIST_COLUMNS =
  "id, folder_id, prompt, model, steps, seed, created_at, visibility, published_at, thumb_key, medium_key, thumb_width, thumb_height, medium_width, medium_height, derivatives_status, derivatives_version";
const MAX_SAVED_AI_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SAVED_AI_IMAGE_WIDTH = 1024;
const MAX_SAVED_AI_IMAGE_HEIGHT = 1024;
const MAX_SAVED_AI_IMAGE_PIXELS = 1024 * 1024;

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

function isMissingTextAssetTableError(error) {
  return String(error || "").includes("no such table") && String(error || "").includes("ai_text_assets");
}

function sortByCreatedAtDesc(a, b) {
  return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
}

function flattenAiImageKeys(rows) {
  return (rows?.results || []).flatMap((row) => listAiImageObjectKeys(row));
}

function inferAiFileAssetType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.startsWith("audio/")) {
    return "sound";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  return "text";
}

function toAiFileAssetRecord(row) {
  return {
    id: row.id,
    asset_type: inferAiFileAssetType(row.mime_type),
    folder_id: row.folder_id,
    title: row.title,
    file_name: row.file_name,
    source_module: row.source_module,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    preview_text: row.preview_text,
    created_at: row.created_at,
    file_url: `/api/ai/text-assets/${row.id}/file`,
    visibility: row.visibility || "private",
    is_public: (row.visibility || "private") === "public",
    published_at: row.published_at ?? null,
  };
}

function isHexAssetId(value) {
  return typeof value === "string" && /^[a-f0-9]+$/.test(value);
}

function normalizeRequestedIds(body, fieldName, noun) {
  const ids = Array.isArray(body?.[fieldName]) ? body[fieldName] : null;
  if (!ids || ids.length === 0) {
    return { error: `${fieldName} array is required.` };
  }
  if (ids.length > 50) {
    return { error: `Cannot ${noun} more than 50 assets at once.` };
  }
  if (new Set(ids).size !== ids.length) {
    return { error: "Duplicate asset IDs are not allowed." };
  }
  for (const id of ids) {
    if (!isHexAssetId(id)) {
      return { error: "Invalid asset ID." };
    }
  }
  return { ids };
}

function buildRequestedValuesList(ids) {
  return ids.map(() => "(?)").join(",");
}

// D1 validates function names at prepare time, so use a built-in runtime
// error to abort the transaction only when the final-state guard fails.
function buildBatchAbortGuardSql(conditionSql) {
  return `SELECT CASE WHEN ${conditionSql} THEN 1 ELSE json_extract('[]', '$[') END`;
}

function isBulkStateGuardError(error) {
  return String(error).includes("bad JSON path");
}

function logBulkActionDiagnostic(action, details) {
  try {
    console.log(`[ai bulk ${action}] ${JSON.stringify(details)}`);
  } catch {
    console.log(`[ai bulk ${action}]`, details);
  }
}

function buildBulkMoveFinalStateGuardSql(userId, imageIds, fileIds, folderId) {
  const clauses = [];
  const bindings = [];

  if (imageIds.length > 0) {
    const placeholders = imageIds.map(() => "?").join(",");
    if (folderId) {
      clauses.push(
        `(SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND folder_id = ? AND id IN (${placeholders})) = ?`
      );
      bindings.push(userId, folderId, ...imageIds, imageIds.length);
    } else {
      clauses.push(
        `(SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND folder_id IS NULL AND id IN (${placeholders})) = ?`
      );
      bindings.push(userId, ...imageIds, imageIds.length);
    }
  }

  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => "?").join(",");
    if (folderId) {
      clauses.push(
        `(SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND folder_id = ? AND id IN (${placeholders})) = ?`
      );
      bindings.push(userId, folderId, ...fileIds, fileIds.length);
    } else {
      clauses.push(
        `(SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND folder_id IS NULL AND id IN (${placeholders})) = ?`
      );
      bindings.push(userId, ...fileIds, fileIds.length);
    }
  }

  return {
    sql: buildBatchAbortGuardSql(clauses.join(" AND ")),
    bindings,
  };
}

function buildBulkDeleteFinalStateGuardSql(userId, imageIds, fileIds) {
  const clauses = [];
  const bindings = [];

  if (imageIds.length > 0) {
    const placeholders = imageIds.map(() => "?").join(",");
    clauses.push(
      `(SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (${placeholders})) = 0`
    );
    bindings.push(userId, ...imageIds);
  }

  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => "?").join(",");
    clauses.push(
      `(SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (${placeholders})) = 0`
    );
    bindings.push(userId, ...fileIds);
  }

  return {
    sql: buildBatchAbortGuardSql(clauses.join(" AND ")),
    bindings,
  };
}

function buildCleanupQueueInsertValuesSql(keys) {
  return `INSERT INTO r2_cleanup_queue (r2_key, status, created_at) VALUES ${keys
    .map(() => "(?, 'pending', ?)")
    .join(", ")}`;
}

function buildCleanupQueueBindings(keys, createdAt) {
  return keys.flatMap((key) => [key, createdAt]);
}

function getQuotaDayStart(ts = nowIso()) {
  return ts.slice(0, 10) + "T00:00:00.000Z";
}

function quotaUnavailableResponse() {
  return json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  );
}

function buildAiImageInput(modelConfig, prompt, steps, seed) {
  if (modelConfig.requestMode === "multipart") {
    const form = new FormData();
    form.append("prompt", prompt);

    if (modelConfig.multipartDefaults?.width) {
      form.append("width", String(modelConfig.multipartDefaults.width));
    }
    if (modelConfig.multipartDefaults?.height) {
      form.append("height", String(modelConfig.multipartDefaults.height));
    }
    if (modelConfig.supportsSteps && steps !== null) {
      form.append("steps", String(steps));
    }
    if (modelConfig.supportsSeed && seed !== null) {
      form.append("seed", String(seed));
    }

    const response = new Response(form);
    const contentType = response.headers.get("content-type");
    const body = response.body;
    if (!contentType || !body) {
      throw new Error("Failed to encode multipart image request.");
    }

    return {
      payload: {
        multipart: {
          body,
          contentType,
        },
      },
      steps: modelConfig.supportsSteps ? steps : null,
      seed: modelConfig.supportsSeed ? seed : null,
    };
  }

  const payload = { prompt, num_steps: steps };
  if (seed !== null) payload.seed = seed;

  return {
    payload,
    steps,
    seed,
  };
}

async function deleteExpiredQuotaReservations(env, userId, dayStart, now) {
  await env.DB.prepare(
    "DELETE FROM ai_daily_quota_usage WHERE user_id = ? AND day_start = ? AND status = 'reserved' AND expires_at < ?"
  ).bind(userId, dayStart, now).run();
}

// Helper: count today's successful generations plus active reservations for a user.
async function getDailyUsage(env, userId, now = nowIso()) {
  const dayStart = getQuotaDayStart(now);
  await deleteExpiredQuotaReservations(env, userId, dayStart, now);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt
     FROM ai_daily_quota_usage
     WHERE user_id = ?
       AND day_start = ?
       AND (status = 'consumed' OR (status = 'reserved' AND expires_at >= ?))`
  ).bind(userId, dayStart, now).first();
  return row ? row.cnt : 0;
}

async function reserveDailyQuota(env, userId, now = nowIso()) {
  const dayStart = getQuotaDayStart(now);
  await deleteExpiredQuotaReservations(env, userId, dayStart, now);
  const expiresAt = addMinutesIso(QUOTA_RESERVATION_TTL_MINUTES);

  for (let slot = 1; slot <= DAILY_IMAGE_LIMIT; slot += 1) {
    const reservationId = randomTokenHex(16);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO ai_daily_quota_usage (id, user_id, day_start, slot, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?)`
    ).bind(
      reservationId,
      userId,
      dayStart,
      slot,
      now,
      expiresAt
    ).run();

    if (result?.meta?.changes > 0) {
      return { reservationId, dayStart };
    }
  }

  return null;
}

async function releaseQuotaReservation(env, reservationId) {
  if (!reservationId) return;
  await env.DB.prepare(
    "DELETE FROM ai_daily_quota_usage WHERE id = ? AND status = 'reserved'"
  ).bind(reservationId).run();
}

// ── GET /api/ai/quota ──
async function handleQuota(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (session.user.role === "admin") {
    return json({ ok: true, data: { isAdmin: true } });
  }

  let usedToday;
  try {
    usedToday = await getDailyUsage(env, session.user.id);
  } catch (e) {
    if (String(e).includes("no such table")) return quotaUnavailableResponse();
    throw e;
  }
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
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";
  let quotaReservationId = null;

  // Rate limit per user (in-memory, per-isolate)
  if (await isSharedRateLimited(env, "ai-generate-user", userId, GENERATION_LIMIT, GENERATION_WINDOW_MS)) {
    return rateLimitResponse();
  }

  const body = await readJsonBody(request);
  if (!body || !body.prompt) {
    return respond({ ok: false, error: "Prompt is required." }, { status: 400 });
  }

  const prompt = String(body.prompt).trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return respond(
      { ok: false, error: `Prompt must be 1–${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const requestedModel = body.model;
  const modelConfig = resolveAiImageModel(requestedModel);
  if (!modelConfig) {
    return respond({ ok: false, error: "Unsupported image model." }, { status: 400 });
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
  const aiRequest = buildAiImageInput(modelConfig, prompt, steps, seed);

  // Daily generation limit for non-admin members (server-enforced via D1)
  if (!isAdmin) {
    try {
      const reservation = await reserveDailyQuota(env, userId);
      if (!reservation) {
        return json(
          {
            ok: false,
            code: "DAILY_IMAGE_LIMIT_REACHED",
            error: `You've reached your daily image generation limit (${DAILY_IMAGE_LIMIT}/${DAILY_IMAGE_LIMIT}). Please come back tomorrow for more creations.`,
          },
          { status: 429 }
        );
      }
      quotaReservationId = reservation.reservationId;
    } catch (e) {
      if (String(e).includes("no such table")) return quotaUnavailableResponse();
      throw e;
    }
  }

  let base64 = null;
  let mimeType = "image/png";

  try {
    const result = await env.AI.run(modelConfig.id, aiRequest.payload);

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
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      request_mode: modelConfig.requestMode || "json",
      is_admin: isAdmin,
      ...getErrorFields(e),
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch { /* ignore */ }
    }
    return respond({ ok: false, error: "Image generation failed." }, { status: 502 });
  }

  if (!base64) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_empty_result",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      is_admin: isAdmin,
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch { /* ignore */ }
    }
    return respond({ ok: false, error: "No image was generated." }, { status: 502 });
  }

  // Log generation for quota tracking / history
  const logId = randomTokenHex(16);
  const completedAt = nowIso();
  try {
    if (quotaReservationId) {
      const results = await env.DB.batch([
        env.DB.prepare(
          "UPDATE ai_daily_quota_usage SET status = 'consumed', expires_at = NULL, consumed_at = ? WHERE id = ? AND status = 'reserved'"
        ).bind(completedAt, quotaReservationId),
        env.DB.prepare(
          "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
        ).bind(logId, userId, completedAt),
      ]);
      if (results?.[0]?.meta?.changes !== 1) {
        try {
          await env.DB.prepare("DELETE FROM ai_generation_log WHERE id = ?").bind(logId).run();
        } catch { /* ignore */ }
        logDiagnostic({
          service: "bitbi-auth",
          component: "ai-generate-image",
          event: "ai_generate_finalize_conflict",
          level: "error",
          correlationId,
          user_id: userId,
          model: modelConfig.id,
          quota_reservation_id: quotaReservationId,
        });
        return respond(
          { ok: false, error: "Image generation could not be finalized. Please try again." },
          { status: 500 }
        );
      }
    } else {
      await env.DB.prepare(
        "INSERT INTO ai_generation_log (id, user_id, created_at) VALUES (?, ?, ?)"
      ).bind(logId, userId, completedAt).run();
    }
  } catch (e) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-generate-image",
      event: "ai_generate_finalize_failed",
      level: "error",
      correlationId,
      user_id: userId,
      model: modelConfig.id,
      quota_reservation_id: quotaReservationId,
      ...getErrorFields(e),
    });
    if (quotaReservationId) {
      try { await releaseQuotaReservation(env, quotaReservationId); } catch { /* ignore */ }
    }
    return respond(
      { ok: false, error: "Image generation could not be finalized. Please try again." },
      { status: 500 }
    );
  }

  return respond({
    ok: true,
    data: {
      imageBase64: base64,
      mimeType,
      prompt,
      steps: aiRequest.steps,
      seed: aiRequest.seed,
      model: modelConfig.id,
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

  // Aggregate per-folder asset counts (images + text assets) without row caps.
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
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ? AND folder_id IS NULL
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  } else if (folderId) {
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ? AND folder_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id, folderId];
  } else {
    query = `SELECT ${AI_IMAGE_LIST_COLUMNS}
             FROM ai_images WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 200`;
    params = [session.user.id];
  }

  const rows = await env.DB.prepare(query).bind(...params).all();
  return json({
    ok: true,
    data: {
      images: (rows.results || []).map((row) => toAiImageAssetRecord(row)),
    },
  });
}

// ── GET /api/ai/assets ──
async function handleGetAssets(ctx) {
  const { request, env, url } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const folderId = url.searchParams.get("folder_id") || null;
  const onlyUnfoldered = url.searchParams.get("only_unfoldered") === "1";

  let imageQuery;
  let imageParams;
  let textQuery;
  let textParams;

  if (onlyUnfoldered) {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ? AND folder_id IS NULL
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at
                 FROM ai_text_assets WHERE user_id = ? AND folder_id IS NULL
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id];
  } else if (folderId) {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ? AND folder_id = ?
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id, folderId];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at
                 FROM ai_text_assets WHERE user_id = ? AND folder_id = ?
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id, folderId];
  } else {
    imageQuery = `SELECT ${AI_IMAGE_LIST_COLUMNS}
                  FROM ai_images WHERE user_id = ?
                  ORDER BY created_at DESC LIMIT 200`;
    imageParams = [session.user.id];
    textQuery = `SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, visibility, published_at
                 FROM ai_text_assets WHERE user_id = ?
                 ORDER BY created_at DESC LIMIT 200`;
    textParams = [session.user.id];
  }

  const imageRows = await env.DB.prepare(imageQuery).bind(...imageParams).all();
  let textRows = { results: [] };
  try {
    textRows = await env.DB.prepare(textQuery).bind(...textParams).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const assets = [
    ...(imageRows.results || []).map((row) => toAiImageAssetRecord(row, { assetType: "image" })),
    ...((textRows.results || []).map((row) => toAiFileAssetRecord(row))),
  ]
    .sort(sortByCreatedAtDesc)
    .slice(0, 200);

  return json({ ok: true, data: { assets } });
}

// ── PATCH /api/ai/images/:id/publication ──
async function handleUpdateImagePublication(ctx, imageId) {
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

// ── POST /api/ai/images/save ──
async function handleSaveImage(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || !body.imageData || !body.prompt) {
    return respond({ ok: false, error: "Image data and prompt are required." }, { status: 400 });
  }

  // Validate optional folder ownership (only active folders accept saves)
  let folderId = null;
  let folderSlug = "unsorted";
  if (body.folder_id) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(body.folder_id, session.user.id).first();
    if (!folder) {
      return respond({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    folderId = folder.id;
    folderSlug = folder.slug;
  }

  // Decode base64 data URI to bytes
  const match = String(body.imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    return respond({ ok: false, error: "Invalid image data format." }, { status: 400 });
  }
  const savedMimeType = match[1];

  let imageBytes;
  try {
    const raw = atob(match[2]);
    imageBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) imageBytes[i] = raw.charCodeAt(i);
  } catch {
    return respond({ ok: false, error: "Invalid base64 image data." }, { status: 400 });
  }

  if (imageBytes.byteLength > MAX_SAVED_AI_IMAGE_BYTES) {
    return respond({ ok: false, error: "Image data must be 10 MB or smaller." }, { status: 400 });
  }

  // Validate image magic bytes (PNG, JPEG, or WebP)
  const isPng  = imageBytes.length >= 4 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
  const isJpeg = imageBytes.length >= 3 && imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
  const isWebp = imageBytes.length >= 12 && imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46 && imageBytes[8] === 0x57 && imageBytes[9] === 0x45 && imageBytes[10] === 0x42 && imageBytes[11] === 0x50;
  if (!isPng && !isJpeg && !isWebp) {
    return respond({ ok: false, error: "Invalid image format." }, { status: 400 });
  }

  if (!env?.IMAGES || typeof env.IMAGES.info !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_inspection_unavailable",
      level: "error",
      correlationId,
      user_id: session.user.id,
    });
    return respond(
      { ok: false, error: "Image save is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  let imageInfo;
  try {
    imageInfo = await env.IMAGES.info(imageBytes);
  } catch {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }

  const width = Number(imageInfo?.width);
  const height = Number(imageInfo?.height);
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return respond({ ok: false, error: "Image dimensions could not be inspected." }, { status: 400 });
  }
  if (
    width > MAX_SAVED_AI_IMAGE_WIDTH ||
    height > MAX_SAVED_AI_IMAGE_HEIGHT ||
    pixels > MAX_SAVED_AI_IMAGE_PIXELS
  ) {
    return respond(
      {
        ok: false,
        error: `Saved image must be ${MAX_SAVED_AI_IMAGE_WIDTH}x${MAX_SAVED_AI_IMAGE_HEIGHT} pixels or smaller. Received ${width}x${height}.`,
      },
      { status: 400 }
    );
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
  logDiagnostic({
    service: "bitbi-auth",
    component: "ai-save-image",
    event: "ai_image_stored",
    correlationId,
    user_id: session.user.id,
    image_id: imageId,
    r2_key: r2Key,
    size_bytes: imageBytes.byteLength,
    mime_type: savedMimeType,
    width,
    height,
    folder_id: folderId,
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
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_metadata_insert_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
      ...getErrorFields(e),
    });
    return respond({ ok: false, error: "Failed to save image. The folder may have been deleted." }, { status: 409 });
  }

  // If the conditional insert produced 0 rows the folder was deleted/deleting
  if (!insertResult.meta.changes) {
    try { await env.USER_IMAGES.delete(r2Key); } catch { /* best effort */ }
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_folder_deleted_before_insert",
      level: "warn",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      folder_id: folderId,
      r2_key: r2Key,
    });
    return respond({ ok: false, error: "Folder was deleted. Image not saved." }, { status: 404 });
  }

  let derivativesEnqueued = true;
  try {
    const queued = await enqueueAiImageDerivativeJob(env, {
      imageId,
      userId: session.user.id,
      originalKey: r2Key,
      derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
      correlationId,
      trigger: "save",
    });
  } catch (error) {
    derivativesEnqueued = false;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-image",
      event: "ai_image_derivative_enqueue_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      image_id: imageId,
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      r2_key: r2Key,
      ...getErrorFields(error),
    });
    try {
      await env.DB.prepare(
        "UPDATE ai_images SET derivatives_error = ?, derivatives_attempted_at = ? WHERE id = ? AND user_id = ?"
      ).bind(
        String(error?.message || error || "Queue enqueue failed.").slice(0, 500),
        nowIso(),
        imageId,
        session.user.id
      ).run();
    } catch {
      // Best effort observability only.
    }
  }

  return respond({
    ok: true,
    data: {
      id: imageId,
      folder_id: folderId,
      prompt,
      model,
      steps,
      seed,
      created_at: now,
      derivatives_status: "pending",
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      derivatives_enqueued: derivativesEnqueued,
    },
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

async function handleGetImageDerivative(ctx, imageId, variant) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const select =
    variant === "thumb"
      ? "SELECT thumb_key AS derivative_key, thumb_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?"
      : "SELECT medium_key AS derivative_key, medium_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?";

  const row = await env.DB.prepare(select).bind(imageId, session.user.id).first();
  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  // Fast path: derivative already generated and stored in R2
  if (row.derivative_key) {
    const object = await env.USER_IMAGES.get(row.derivative_key);
    if (object) {
      const headers = new Headers();
      headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "image/webp");
      headers.set("Cache-Control", "private, max-age=3600");
      return new Response(object.body, { headers });
    }
  }

  // On-demand fallback: generate derivatives inline when the queue pipeline
  // has not delivered them (covers queue-consumer downtime, binding failures,
  // retry exhaustion, and any other asynchronous pipeline breakage).
  if (shouldAttemptOnDemandAiImageDerivative(row, { cooldownMs: AI_IMAGE_DERIVATIVE_ON_DEMAND_COOLDOWN_MS })) {
    try {
      const result = await processAiImageDerivativeMessage(
        env,
        buildAiImageDerivativeMessage({
          imageId,
          userId: session.user.id,
          originalKey: row.r2_key,
          derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
          trigger: "on_demand",
        }),
        { isLastAttempt: true }
      );

      if (result.status === "ready") {
        const derivativeKey = variant === "thumb" ? result.keys.thumb : result.keys.medium;
        const generated = await env.USER_IMAGES.get(derivativeKey);
        if (generated) {
          const headers = new Headers();
          headers.set("Content-Type", generated.httpMetadata?.contentType || "image/webp");
          headers.set("Cache-Control", "private, max-age=3600");
          return new Response(generated.body, { headers });
        }
      }
    } catch {
      // On-demand generation failed — fall through to 404
    }
  }

  return json({ ok: false, error: "Image preview not ready." }, { status: 404 });
}

// ── GET /api/ai/text-assets/:id/file ──
async function handleGetTextAssetFile(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key, file_name, mime_type FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Saved asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!row) {
    return json({ ok: false, error: "Saved asset not found." }, { status: 404 });
  }

  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) {
    return json({ ok: false, error: "Saved asset file not found." }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "text/plain; charset=utf-8");
  headers.set("Cache-Control", "private, max-age=3600");
  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (row.file_name) {
    headers.set("Content-Disposition", `inline; filename="${row.file_name}"`);
  }
  return new Response(object.body, { headers });
}

// ── POST /api/ai/audio/save ──
const MAX_AUDIO_TITLE_LENGTH = 120;

async function handleSaveAudio(ctx) {
  const { request, env } = ctx;
  const correlationId = ctx.correlationId || null;
  const respond = (body, init) => withCorrelationId(json(body, init), correlationId);
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  if (!body || (!body.audioBase64 && !body.audioUrl)) {
    return respond({ ok: false, error: "Audio data is required (audioBase64 or audioUrl)." }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  if (!title || title.length > MAX_AUDIO_TITLE_LENGTH) {
    return respond(
      { ok: false, error: `Title is required and must be at most ${MAX_AUDIO_TITLE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  if (body.audioBase64 && (typeof body.audioBase64 !== "string" || body.audioBase64.length === 0)) {
    return respond({ ok: false, error: "audioBase64 must be a non-empty string." }, { status: 400 });
  }

  if (body.audioUrl) {
    if (typeof body.audioUrl !== "string") {
      return respond({ ok: false, error: "audioUrl must be a string." }, { status: 400 });
    }
    try {
      const parsed = new URL(body.audioUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return respond({ ok: false, error: "audioUrl must be an HTTP(S) URL." }, { status: 400 });
      }
    } catch {
      return respond({ ok: false, error: "audioUrl must be a valid URL." }, { status: 400 });
    }
  }

  const mimeType = String(body.mimeType || "audio/mpeg").trim();
  if (!mimeType.startsWith("audio/")) {
    return respond({ ok: false, error: "mimeType must be an audio MIME type." }, { status: 400 });
  }

  const folderId = body.folder_id || null;
  if (folderId && (typeof folderId !== "string" || !/^[a-f0-9]+$/.test(folderId))) {
    return respond({ ok: false, error: "Invalid folder ID." }, { status: 400 });
  }

  const payload = {
    audioBase64: body.audioBase64 || null,
    audioUrl: body.audioUrl || null,
    mimeType,
    prompt: body.prompt ? String(body.prompt).slice(0, MAX_PROMPT_LENGTH) : null,
    model: body.model || null,
    mode: body.mode || null,
    lyricsMode: body.lyricsMode || null,
    bpm: body.bpm ?? null,
    key: body.key || null,
    lyricsPreview: body.lyricsPreview || null,
    durationMs: body.durationMs ?? null,
    sampleRate: body.sampleRate ?? null,
    channels: body.channels ?? null,
    bitrate: body.bitrate ?? null,
    sizeBytes: body.sizeBytes ?? null,
    traceId: body.traceId || null,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    elapsedMs: body.elapsedMs ?? null,
    receivedAt: body.receivedAt || null,
  };

  try {
    const saved = await saveAdminAiTextAsset(env, {
      userId: session.user.id,
      folderId,
      title,
      sourceModule: "music",
      payload,
    });

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_saved",
      correlationId,
      user_id: session.user.id,
      asset_id: saved.id,
      folder_id: saved.folder_id,
      size_bytes: saved.size_bytes,
    });

    return respond({ ok: true, data: saved }, { status: 201 });
  } catch (error) {
    const status = error?.status || 500;
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-save-audio",
      event: "ai_audio_save_failed",
      level: "error",
      correlationId,
      user_id: session.user.id,
      ...getErrorFields(error),
    });
    return respond(
      {
        ok: false,
        error: error?.message || "Audio save failed.",
        code: error?.code || (status >= 500 ? "internal_error" : "validation_error"),
      },
      { status }
    );
  }
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
  let textAssetsEnabled = true;
  const ts = nowIso();
  try {
    // Snapshot images for R2 cleanup (folder row still exists, folder_id intact)
    const images = await env.DB.prepare(
      "SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE folder_id = ? AND user_id = ?"
    ).bind(folderId, session.user.id).all();
    r2Keys = flattenAiImageKeys(images);

    try {
      const textAssets = await env.DB.prepare(
        "SELECT r2_key FROM ai_text_assets WHERE folder_id = ? AND user_id = ?"
      ).bind(folderId, session.user.id).all();
      r2Keys = r2Keys.concat((textAssets.results || []).map((row) => row.r2_key));
    } catch (error) {
      if (isMissingTextAssetTableError(error)) {
        textAssetsEnabled = false;
      } else {
        throw error;
      }
    }

    // Atomically queue blob cleanup, delete asset rows, then remove the folder.
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
    // Snapshot or batch failed — folder row may still exist in 'deleting'.
    // Revert to 'active' so the folder is not permanently hidden.
    try {
      await env.DB.prepare(
        "UPDATE ai_folders SET status = 'active' WHERE id = ? AND user_id = ? AND status = 'deleting'"
      ).bind(folderId, session.user.id).run();
    } catch { /* rollback is best-effort; retry will re-enter via 'deleting' accept */ }
    const unavailable = String(e).includes("no such table");
    return json(
      { ok: false, error: unavailable ? "Service temporarily unavailable. Please try again later." : "Failed to delete folder. Please try again." },
      { status: unavailable ? 503 : 500 }
    );
  }

  // Durable handoff complete. Inline R2 cleanup is best-effort only.
  const cleanedKeys = [];
  for (const key of r2Keys) {
    try {
      await env.USER_IMAGES.delete(key);
      cleanedKeys.push(key);
    } catch { /* leave queue entry for scheduled retry */ }
  }

  if (cleanedKeys.length > 0) {
    try {
      const ph = cleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
      ).bind(...cleanedKeys).run();
    } catch { /* non-critical — idempotent R2 delete on next scheduled run */ }
  }

  return json({ ok: true });
}

// ── DELETE /api/ai/images/:id ──
async function handleDeleteImage(ctx, imageId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const row = await env.DB.prepare(
    "SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE id = ? AND user_id = ?"
  ).bind(imageId, session.user.id).first();

  if (!row) {
    return json({ ok: false, error: "Image not found." }, { status: 404 });
  }

  const ts = nowIso();
  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(
        buildAiImageCleanupQueueInsertSql("id = ? AND user_id = ?")
      ).bind(imageId, session.user.id, ts, ts, ts),
      env.DB.prepare(
        "DELETE FROM ai_images WHERE id = ? AND user_id = ?"
      ).bind(imageId, session.user.id),
    ]);
  } catch (e) {
    const unavailable = String(e).includes("no such table");
    return json(
      { ok: false, error: unavailable ? "Service temporarily unavailable. Please try again later." : "Delete failed. Please try again." },
      { status: unavailable ? 503 : 500 }
    );
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== 1) {
    return json(
      { ok: false, error: "Delete failed. Image may have already been removed." },
      { status: 409 }
    );
  }

  try {
    const objectKeys = listAiImageObjectKeys(row);
    for (const key of objectKeys) {
      await env.USER_IMAGES.delete(key);
    }
    const ph = objectKeys.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${ph}) AND status = 'pending'`
    ).bind(...objectKeys).run();
  } catch { /* leave queue entry for scheduled retry */ }

  return json({ ok: true });
}

// ── PATCH /api/ai/text-assets/:id/publication ──
async function handleUpdateTextAssetPublication(ctx, assetId) {
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

// ── DELETE /api/ai/text-assets/:id ──
async function handleDeleteTextAsset(ctx, assetId) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r2_key FROM ai_text_assets WHERE id = ? AND user_id = ?"
    ).bind(assetId, session.user.id).first();
  } catch (error) {
    if (isMissingTextAssetTableError(error)) {
      return json({ ok: false, error: "Text asset service unavailable." }, { status: 503 });
    }
    throw error;
  }

  if (!row) {
    return json({ ok: false, error: "Text asset not found." }, { status: 404 });
  }

  const ts = nowIso();
  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ?
         FROM ai_text_assets
         WHERE id = ? AND user_id = ?`
      ).bind(ts, assetId, session.user.id),
      env.DB.prepare(
        "DELETE FROM ai_text_assets WHERE id = ? AND user_id = ?"
      ).bind(assetId, session.user.id),
    ]);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    return json(
      {
        ok: false,
        error: unavailable ? "Text asset service unavailable. Please try again later." : "Delete failed. Please try again.",
      },
      { status: unavailable ? 503 : 500 }
    );
  }

  const deleted = batchResults[1].meta.changes || 0;
  if (deleted !== 1) {
    return json(
      { ok: false, error: "Delete failed. Text asset may have already been removed." },
      { status: 409 }
    );
  }

  try {
    await env.USER_IMAGES.delete(row.r2_key);
    await env.DB.prepare(
      "DELETE FROM r2_cleanup_queue WHERE r2_key IN (?) AND status = 'pending'"
    ).bind(row.r2_key).run();
  } catch {
    // Leave queue entry for scheduled retry.
  }

  return json({ ok: true });
}

// ── PATCH /api/ai/assets/bulk-move ──
async function handleBulkMoveAssets(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const normalized = normalizeRequestedIds(body, "asset_ids", "move");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  const folderId = body.folder_id || null;
  const diagnostic = {
    asset_ids: assetIds,
    folder_id: folderId,
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    updated_ai_images_count: 0,
    updated_ai_text_assets_count: 0,
    folder_exists_owned: folderId ? false : null,
  };
  if (folderId) {
    if (!isHexAssetId(folderId)) {
      return json({ ok: false, error: "Invalid folder ID." }, { status: 400 });
    }
    const folder = await env.DB.prepare(
      "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(folderId, session.user.id).first();
    if (!folder) {
      logBulkActionDiagnostic("move", {
        ...diagnostic,
        branch: "folder_not_found",
      });
      return json({ ok: false, error: "Folder not found." }, { status: 404 });
    }
    diagnostic.folder_exists_owned = true;
  }

  const placeholders = assetIds.map(() => "?").join(",");
  const imageRows = await env.DB.prepare(
    `SELECT id FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...assetIds, session.user.id).all();

  let fileRows = { results: [] };
  try {
    fileRows = await env.DB.prepare(
      `SELECT id FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...assetIds, session.user.id).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const imageIds = (imageRows.results || []).map((row) => row.id);
  const fileIds = (fileRows.results || []).map((row) => row.id);
  diagnostic.matched_owned_ai_images_count = imageIds.length;
  diagnostic.matched_owned_ai_text_assets_count = fileIds.length;
  if (imageIds.length + fileIds.length !== assetIds.length) {
    logBulkActionDiagnostic("move", {
      ...diagnostic,
      branch: "asset_match_count_mismatch",
    });
    return json({ ok: false, error: "One or more assets not found." }, { status: 404 });
  }

  const statements = [];
  let imageUpdateIndex = -1;
  let fileUpdateIndex = -1;

  if (imageIds.length > 0) {
    const valuesList = buildRequestedValuesList(imageIds);
    if (folderId) {
      imageUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_images SET folder_id = ?
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
             AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
        ).bind(...imageIds, folderId, session.user.id, session.user.id, folderId, session.user.id)
      );
    } else {
      imageUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_images SET folder_id = NULL
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
        ).bind(...imageIds, session.user.id, session.user.id)
      );
    }
  }

  if (fileIds.length > 0) {
    const valuesList = buildRequestedValuesList(fileIds);
    if (folderId) {
      fileUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_text_assets SET folder_id = ?
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))
             AND EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
        ).bind(...fileIds, folderId, session.user.id, session.user.id, folderId, session.user.id)
      );
    } else {
      fileUpdateIndex = statements.length;
      statements.push(
        env.DB.prepare(
          `WITH requested(id) AS (VALUES ${valuesList})
           UPDATE ai_text_assets SET folder_id = NULL
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
        ).bind(...fileIds, session.user.id, session.user.id)
      );
    }
  }

  const finalStateGuard = buildBulkMoveFinalStateGuardSql(
    session.user.id,
    imageIds,
    fileIds,
    folderId
  );
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  let batchResults;
  try {
    batchResults = await env.DB.batch(statements);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    const stateGuardError = isBulkStateGuardError(error);
    logBulkActionDiagnostic("move", {
      ...diagnostic,
      branch: stateGuardError ? "final_state_guard_failed" : unavailable ? "service_unavailable" : "batch_error",
      error: String(error).slice(0, 500),
    });
    return json(
      {
        ok: false,
        error: unavailable
          ? "Service temporarily unavailable. Please try again later."
          : stateGuardError
            ? "Move failed. Some assets may have been deleted or the folder removed."
            : "Move failed. Please try again.",
      },
      { status: unavailable ? 503 : stateGuardError ? 409 : 500 }
    );
  }

  diagnostic.updated_ai_images_count = imageUpdateIndex >= 0
    ? (batchResults[imageUpdateIndex]?.meta?.changes || 0)
    : 0;
  diagnostic.updated_ai_text_assets_count = fileUpdateIndex >= 0
    ? (batchResults[fileUpdateIndex]?.meta?.changes || 0)
    : 0;
  logBulkActionDiagnostic("move", {
    ...diagnostic,
    branch: "success",
  });
  return json({ ok: true, data: { moved: assetIds.length } });
}

// ── POST /api/ai/assets/bulk-delete ──
async function handleBulkDeleteAssets(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const body = await readJsonBody(request);
  const normalized = normalizeRequestedIds(body, "asset_ids", "delete");
  if (normalized.error) {
    return json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const assetIds = normalized.ids;
  const diagnostic = {
    asset_ids: assetIds,
    matched_owned_ai_images_count: 0,
    matched_owned_ai_text_assets_count: 0,
    deleted_ai_images_count: 0,
    deleted_ai_text_assets_count: 0,
  };
  const placeholders = assetIds.map(() => "?").join(",");

  const imageSnapshot = await env.DB.prepare(
    `SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...assetIds, session.user.id).all();

  let fileSnapshot = { results: [] };
  try {
    fileSnapshot = await env.DB.prepare(
      `SELECT id, r2_key FROM ai_text_assets WHERE id IN (${placeholders}) AND user_id = ?`
    ).bind(...assetIds, session.user.id).all();
  } catch (error) {
    if (!isMissingTextAssetTableError(error)) {
      throw error;
    }
  }

  const imageRows = imageSnapshot.results || [];
  const fileRows = fileSnapshot.results || [];
  diagnostic.matched_owned_ai_images_count = imageRows.length;
  diagnostic.matched_owned_ai_text_assets_count = fileRows.length;
  if (imageRows.length + fileRows.length !== assetIds.length) {
    logBulkActionDiagnostic("delete", {
      ...diagnostic,
      branch: "asset_match_count_mismatch",
    });
    return json({ ok: false, error: "One or more assets not found." }, { status: 404 });
  }

  const imageIds = imageRows.map((row) => row.id);
  const fileIds = fileRows.map((row) => row.id);
  const cleanupKeys = Array.from(new Set([
    ...imageRows.flatMap((row) => listAiImageObjectKeys(row)),
    ...fileRows.map((row) => row.r2_key).filter(Boolean),
  ]));
  const ts = nowIso();
  const statements = [];
  let imageDeleteIndex = -1;
  let fileDeleteIndex = -1;

  if (cleanupKeys.length > 0) {
    statements.push(
      env.DB.prepare(
        buildCleanupQueueInsertValuesSql(cleanupKeys)
      ).bind(...buildCleanupQueueBindings(cleanupKeys, ts))
    );
  }

  if (imageIds.length > 0) {
    const valuesList = buildRequestedValuesList(imageIds);
    imageDeleteIndex = statements.length;
    statements.push(
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_images
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...imageIds, session.user.id, session.user.id)
    );
  }

  if (fileIds.length > 0) {
    const valuesList = buildRequestedValuesList(fileIds);
    fileDeleteIndex = statements.length;
    statements.push(
      env.DB.prepare(
        `WITH requested(id) AS (VALUES ${valuesList})
         DELETE FROM ai_text_assets
         WHERE user_id = ?
           AND id IN (SELECT id FROM requested)
           AND (SELECT COUNT(*) FROM requested) =
               (SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ? AND id IN (SELECT id FROM requested))`
      ).bind(...fileIds, session.user.id, session.user.id)
    );
  }

  const finalStateGuard = buildBulkDeleteFinalStateGuardSql(
    session.user.id,
    imageIds,
    fileIds
  );
  statements.push(
    env.DB.prepare(finalStateGuard.sql).bind(...finalStateGuard.bindings)
  );

  let batchResults;
  try {
    batchResults = await env.DB.batch(statements);
  } catch (error) {
    const unavailable = String(error).includes("no such table");
    const stateGuardError = isBulkStateGuardError(error);
    logBulkActionDiagnostic("delete", {
      ...diagnostic,
      branch: stateGuardError ? "final_state_guard_failed" : unavailable ? "service_unavailable" : "batch_error",
      error: String(error).slice(0, 500),
    });
    return json(
      {
        ok: false,
        error: unavailable
          ? "Service temporarily unavailable. Please try again later."
          : stateGuardError
            ? "Delete failed. Some assets may have already been removed."
            : "Delete failed. Please try again.",
      },
      { status: unavailable ? 503 : stateGuardError ? 409 : 500 }
    );
  }

  diagnostic.deleted_ai_images_count = imageDeleteIndex >= 0
    ? (batchResults[imageDeleteIndex]?.meta?.changes || 0)
    : 0;
  diagnostic.deleted_ai_text_assets_count = fileDeleteIndex >= 0
    ? (batchResults[fileDeleteIndex]?.meta?.changes || 0)
    : 0;
  logBulkActionDiagnostic("delete", {
    ...diagnostic,
    branch: "success",
  });
  const cleanedKeys = [];
  for (const row of imageRows) {
    for (const key of listAiImageObjectKeys(row)) {
      try {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      } catch {
        // Leave queue entry for scheduled retry.
      }
    }
  }

  for (const row of fileRows) {
    if (!row.r2_key) continue;
    try {
      await env.USER_IMAGES.delete(row.r2_key);
      cleanedKeys.push(row.r2_key);
    } catch {
      // Leave queue entry for scheduled retry.
    }
  }

  const uniqueCleanedKeys = Array.from(new Set(cleanedKeys));
  if (uniqueCleanedKeys.length > 0) {
    try {
      const placeholdersForKeys = uniqueCleanedKeys.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM r2_cleanup_queue WHERE r2_key IN (${placeholdersForKeys}) AND status = 'pending'`
      ).bind(...uniqueCleanedKeys).run();
    } catch {
      // Non-critical — queued retry stays safe and idempotent.
    }
  }

  return json({ ok: true, data: { deleted: assetIds.length } });
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
    `SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (${placeholders}) AND user_id = ?`
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
         , matches AS (
           SELECT r2_key, thumb_key, medium_key
           FROM ai_images
           WHERE user_id = ?
             AND id IN (SELECT id FROM requested)
             AND (SELECT COUNT(*) FROM requested) =
                 (SELECT COUNT(*) FROM ai_images WHERE user_id = ? AND id IN (SELECT id FROM requested))
         )
         INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ? FROM matches
         UNION ALL
         SELECT thumb_key, 'pending', ? FROM matches WHERE thumb_key IS NOT NULL
         UNION ALL
         SELECT medium_key, 'pending', ? FROM matches WHERE medium_key IS NOT NULL`
      ).bind(...imageIds, session.user.id, session.user.id, ts, ts, ts),

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
      for (const key of listAiImageObjectKeys(row)) {
        await env.USER_IMAGES.delete(key);
        cleanedKeys.push(key);
      }
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
  if (pathname === "/api/ai/assets" && method === "GET") {
    return handleGetAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-move" && method === "PATCH") {
    return handleBulkMoveAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-delete" && method === "POST") {
    return handleBulkDeleteAssets(ctx);
  }
  if (pathname === "/api/ai/images/save" && method === "POST") {
    return handleSaveImage(ctx);
  }
  if (pathname === "/api/ai/audio/save" && method === "POST") {
    return handleSaveAudio(ctx);
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

  const thumbMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/thumb$/);
  if (thumbMatch && method === "GET") {
    return handleGetImageDerivative(ctx, thumbMatch[1], "thumb");
  }

  const mediumMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/medium$/);
  if (mediumMatch && method === "GET") {
    return handleGetImageDerivative(ctx, mediumMatch[1], "medium");
  }

  const textFileMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/file$/);
  if (textFileMatch && method === "GET") {
    return handleGetTextAssetFile(ctx, textFileMatch[1]);
  }

  // DELETE /api/ai/images/:id
  const deleteMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    return handleDeleteImage(ctx, deleteMatch[1]);
  }

  const publicationMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/publication$/);
  if (publicationMatch && method === "PATCH") {
    return handleUpdateImagePublication(ctx, publicationMatch[1]);
  }

  const textPublicationMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/publication$/);
  if (textPublicationMatch && method === "PATCH") {
    return handleUpdateTextAssetPublication(ctx, textPublicationMatch[1]);
  }

  const textDeleteMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)$/);
  if (textDeleteMatch && method === "DELETE") {
    return handleDeleteTextAsset(ctx, textDeleteMatch[1]);
  }

  return null;
}
