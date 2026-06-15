import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  isRequestBodyError,
  readFormDataLimited,
  readJsonBodyOrResponse,
  requestBodyErrorResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { requireAdmin } from "../lib/session.js";
import { nowIso, sha256Hex } from "../lib/tokens.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";

const MAX_LIST_LIMIT = 250;
const DEFAULT_LIST_LIMIT = 100;
const MAX_BATCH_ITEMS = 25;
const MAX_KEY_LENGTH = 1024;
const MAX_REASON_LENGTH = 500;
const MIN_REASON_LENGTH = 8;
const DELETE_CONFIRMATION = "DELETE R2 OBJECTS";
const FOLDER_SENTINEL_NAME = ".keep";
const HIDDEN_SENTINEL_RE = /(?:^|\/)\.keep$/;

const R2_BUCKETS = Object.freeze({
  USER_IMAGES: Object.freeze({
    id: "USER_IMAGES",
    binding: "USER_IMAGES",
    displayName: "bitbi-user-images",
    description: "Generated member/admin media and derivatives stored by BITBI.",
    capabilities: ["list", "read", "write", "delete", "copy", "move", "preview"],
    risk: "app-managed-media",
  }),
  PRIVATE_MEDIA: Object.freeze({
    id: "PRIVATE_MEDIA",
    binding: "PRIVATE_MEDIA",
    displayName: "bitbi-private-media",
    description: "Private profile/avatar and internal media objects.",
    capabilities: ["list", "read", "write", "delete", "copy", "move", "preview"],
    risk: "private-media",
  }),
  AUDIT_ARCHIVE: Object.freeze({
    id: "AUDIT_ARCHIVE",
    binding: "AUDIT_ARCHIVE",
    displayName: "bitbi-audit-archive",
    description: "Private audit and evidence archives.",
    capabilities: ["list", "read", "write", "delete", "copy", "move", "preview"],
    risk: "audit-archive",
  }),
});

const APP_LINK_PROBES = Object.freeze([
  { table: "ai_images", column: "r2_key", domain: "AI image original", ownerColumn: "user_id", rowLabel: "image" },
  { table: "ai_images", column: "thumb_key", domain: "AI image thumbnail", ownerColumn: "user_id", rowLabel: "image derivative" },
  { table: "ai_images", column: "medium_key", domain: "AI image medium derivative", ownerColumn: "user_id", rowLabel: "image derivative" },
  { table: "ai_text_assets", column: "r2_key", domain: "AI text/media asset", ownerColumn: "user_id", rowLabel: "text/media asset" },
  { table: "ai_text_assets", column: "poster_r2_key", domain: "AI text/media poster", ownerColumn: "user_id", rowLabel: "poster derivative" },
  { table: "ai_video_jobs", column: "output_r2_key", domain: "AI video job output", ownerColumn: "user_id", rowLabel: "video job" },
  { table: "ai_video_jobs", column: "poster_r2_key", domain: "AI video job poster", ownerColumn: "user_id", rowLabel: "video job poster" },
  { table: "homepage_hero_video_uploads", column: "r2_key", domain: "Homepage hero source upload", ownerColumn: "uploaded_by_user_id", rowLabel: "hero source" },
  { table: "homepage_hero_video_uploads", column: "poster_r2_key", domain: "Homepage hero source poster", ownerColumn: "uploaded_by_user_id", rowLabel: "hero source poster" },
  { table: "homepage_hero_video_derivatives", column: "file_r2_key", domain: "Homepage hero derivative", ownerColumn: "updated_by_user_id", rowLabel: "hero derivative" },
  { table: "homepage_hero_video_derivatives", column: "poster_r2_key", domain: "Homepage hero derivative poster", ownerColumn: "updated_by_user_id", rowLabel: "hero derivative poster" },
  { table: "homepage_hero_video_derivatives", column: "source_r2_key", domain: "Homepage hero derivative source", ownerColumn: "source_user_id", rowLabel: "hero source reference" },
  { table: "memvid_stream_previews", column: "source_r2_key", domain: "Memvid stream preview source", ownerColumn: "user_id", rowLabel: "stream preview" },
  { table: "data_export_archives", column: "r2_key", domain: "Data lifecycle export archive", ownerColumn: "subject_user_id", rowLabel: "data export archive" },
  { table: "data_lifecycle_request_items", column: "r2_key", domain: "Data lifecycle request item", ownerColumn: "subject_user_id", rowLabel: "data lifecycle item" },
]);

function isAdminR2Route(pathname) {
  return pathname === "/api/admin/r2/buckets"
    || pathname === "/api/admin/r2/objects"
    || pathname === "/api/admin/r2/objects/detail"
    || pathname === "/api/admin/r2/objects/file"
    || pathname === "/api/admin/r2/objects/upload"
    || pathname === "/api/admin/r2/folders"
    || pathname === "/api/admin/r2/objects/copy"
    || pathname === "/api/admin/r2/objects/move"
    || pathname === "/api/admin/r2/objects/delete";
}

function badRequest(error, code = "admin_r2_bad_request", status = 400, extra = {}) {
  return json({ ok: false, error, code, ...extra }, { status });
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value || ""));
}

function normalizeR2Path(value, { allowEmpty = true, folder = false } = {}) {
  let text = String(value || "").trim().replace(/\\/g, "/");
  while (text.startsWith("/")) text = text.slice(1);
  text = text.replace(/\/{2,}/g, "/");
  if (folder && text && !text.endsWith("/")) text += "/";
  if (!allowEmpty && !text) return null;
  if (text.length > MAX_KEY_LENGTH || hasControlCharacters(text)) return null;
  const parts = text.split("/");
  if (parts.some((part) => part === "." || part === "..")) return null;
  return text;
}

function basename(key) {
  const clean = String(key || "").replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index >= 0 ? clean.slice(index + 1) : clean;
}

function dirname(key) {
  const clean = String(key || "").replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index >= 0 ? `${clean.slice(0, index + 1)}` : "";
}

function contentTypeForName(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "json") return "application/json";
  if (ext === "csv") return "text/csv; charset=utf-8";
  if (ext === "txt" || ext === "md") return "text/plain; charset=utf-8";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function parsePositiveLimit(value, fallback = DEFAULT_LIST_LIMIT) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function resolveBucket(env, bucketId) {
  const id = String(bucketId || "").trim().toUpperCase();
  const config = R2_BUCKETS[id] || null;
  if (!config || !env?.[config.binding]) return null;
  return {
    ...config,
    bucket: env[config.binding],
  };
}

function availableBuckets(env) {
  return Object.values(R2_BUCKETS)
    .filter((entry) => !!env?.[entry.binding])
    .map((entry) => ({
      id: entry.id,
      binding: entry.binding,
      displayName: entry.displayName,
      description: entry.description,
      capabilities: entry.capabilities,
      risk: entry.risk,
    }));
}

function buildBreadcrumbs(prefix) {
  const clean = normalizeR2Path(prefix, { allowEmpty: true, folder: true }) || "";
  const crumbs = [{ label: "Root", prefix: "" }];
  let current = "";
  for (const part of clean.split("/").filter(Boolean)) {
    current += `${part}/`;
    crumbs.push({ label: part, prefix: current });
  }
  return crumbs;
}

function extractUserIdFromPrefix(value) {
  const text = String(value || "");
  const match = text.match(/^(?:users|avatars)\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : null;
}

function shortId(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function redactedKeySummary(key) {
  const text = String(key || "");
  if (!text) return "";
  const parts = text.split("/");
  if (parts.length <= 2) return shortId(text);
  return `${parts[0]}/${parts[1]}/.../${shortId(parts.at(-1))}`;
}

function schemaUnavailable(error) {
  const message = String(error?.message || error || "");
  return /no such table|no such column|SQLITE_ERROR|D1_ERROR/i.test(message);
}

async function getUserDisplay(env, userId, cache = new Map()) {
  const id = String(userId || "").trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  let user = null;
  let profile = null;
  try {
    user = await env.DB.prepare("SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1").bind(id).first();
  } catch (error) {
    if (!schemaUnavailable(error)) throw error;
  }
  try {
    profile = await env.DB.prepare("SELECT display_name FROM profiles WHERE user_id = ? LIMIT 1").bind(id).first();
  } catch (error) {
    if (!schemaUnavailable(error)) throw error;
  }
  const displayName = String(profile?.display_name || "").trim();
  const email = String(user?.email || "").trim();
  const label = displayName || email || shortId(id);
  const result = {
    userId: id,
    displayName: displayName || null,
    email: email || null,
    label: label || shortId(id),
    canonicalPrefix: null,
  };
  cache.set(id, result);
  return result;
}

async function ownerLabelForKey(env, key, cache) {
  const userId = extractUserIdFromPrefix(key);
  if (!userId) return null;
  const display = await getUserDisplay(env, userId, cache);
  if (!display) return { userId, label: shortId(userId), canonicalPrefix: null };
  return { ...display, canonicalPrefix: key.match(/^(?:users|avatars)\/[^/]+\//)?.[0] || null };
}

async function detectR2ObjectAppLinks(env, key) {
  const links = [];
  if (!env?.DB) {
    return { linked: false, links, risk: "unlinked" };
  }
  for (const probe of APP_LINK_PROBES) {
    try {
      const row = await env.DB.prepare(
        `SELECT id, ${probe.ownerColumn} AS owner_user_id FROM ${probe.table} WHERE ${probe.column} = ? LIMIT 1`
      ).bind(key).first();
      if (row?.id) {
        links.push({
          domain: probe.domain,
          table: probe.table,
          column: probe.column,
          rowId: row.id,
          ownerUserId: row.owner_user_id || null,
          label: probe.rowLabel,
          risk: probe.table === "data_export_archives" ? "audit-archive" : "app-managed",
        });
      }
    } catch (error) {
      if (!schemaUnavailable(error)) throw error;
    }
  }
  return {
    linked: links.length > 0,
    links,
    risk: links.length > 0 ? links[0].risk : "unlinked",
  };
}

async function buildObjectSummary(env, bucketConfig, object, userCache) {
  const key = object.key;
  const owner = await ownerLabelForKey(env, key, userCache);
  const appLink = await detectR2ObjectAppLinks(env, key);
  const contentType = object.httpMetadata?.contentType || object.customMetadata?.contentType || contentTypeForName(key);
  return {
    type: "object",
    bucket: bucketConfig.id,
    key,
    name: basename(key),
    prefix: dirname(key),
    size: Number(object.size || 0),
    uploaded: object.uploaded ? new Date(object.uploaded).toISOString() : null,
    lastModified: object.uploaded ? new Date(object.uploaded).toISOString() : null,
    etag: object.etag || null,
    httpEtag: object.httpEtag || null,
    contentType,
    owner,
    appLink,
    previewable: canPreviewContentType(contentType),
  };
}

function canPreviewContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  return type.startsWith("image/")
    || type.startsWith("audio/")
    || type.startsWith("video/")
    || type.startsWith("text/")
    || type === "application/json"
    || type === "application/pdf";
}

async function buildFolderSummary(env, bucketConfig, prefix, userCache) {
  const owner = await ownerLabelForKey(env, prefix, userCache);
  return {
    type: "folder",
    bucket: bucketConfig.id,
    prefix,
    key: prefix,
    name: basename(prefix) || prefix,
    owner,
  };
}

function normalizeReason(value) {
  const reason = String(value || "").replace(/\s+/g, " ").trim();
  if (reason.length < MIN_REASON_LENGTH) return null;
  return reason.slice(0, MAX_REASON_LENGTH);
}

async function requireMutationGuard(ctx, body, { action, destructive = false } = {}) {
  const rawKey = String(ctx.request.headers.get("Idempotency-Key") || "").trim();
  if (!rawKey) {
    return { response: badRequest("Idempotency-Key is required for R2 object mutations.", "admin_r2_idempotency_required", 428) };
  }
  if (rawKey.length > 200) {
    return { response: badRequest("Idempotency-Key is too long.", "admin_r2_idempotency_invalid", 400) };
  }
  const reason = normalizeReason(body?.reason || body?.operatorReason);
  if (!reason) {
    return { response: badRequest(`An operator reason of at least ${MIN_REASON_LENGTH} characters is required.`, "admin_r2_reason_required", 400) };
  }
  if (destructive && (body?.confirm !== true || body?.confirmation !== DELETE_CONFIRMATION)) {
    return { response: badRequest("Explicit delete confirmation is required.", "admin_r2_delete_confirmation_required", 409) };
  }
  return {
    reason,
    idempotencyKeyHash: await sha256Hex(rawKey),
    action,
  };
}

async function auditR2Action(ctx, adminUser, action, meta = {}) {
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: adminUser.id,
      action,
      targetUserId: null,
      meta: {
        ...meta,
        actor_email: adminUser.email,
        raw_key_included: false,
      },
      createdAt: nowIso(),
    },
    {
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

async function enforceAdminR2RateLimit(ctx, { write = false } = {}) {
  const { request, env, pathname, method, correlationId } = ctx;
  const result = await evaluateSharedRateLimit(
    env,
    write ? "admin-r2-write-ip" : "admin-r2-read-ip",
    getClientIp(request),
    write ? 40 : 90,
    15 * 60_000,
    sensitiveRateLimitOptions({
      component: write ? "admin-r2-write" : "admin-r2-read",
      correlationId,
      requestInfo: { request, pathname, method },
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

function parseByteRange(rangeHeader, size) {
  const totalSize = Number(size);
  if (!rangeHeader || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const value = String(rangeHeader).trim();
  if (!value.toLowerCase().startsWith("bytes=")) return { invalid: true };
  const spec = value.slice(6).trim();
  if (!spec || spec.includes(",")) return { invalid: true };
  const [rawStart, rawEnd] = spec.split("-");
  if (rawStart === undefined || rawEnd === undefined) return { invalid: true };
  let start;
  let end;
  if (rawStart === "") {
    if (!/^\d+$/.test(rawEnd)) return { invalid: true };
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    if (!/^\d+$/.test(rawStart) || (rawEnd !== "" && !/^\d+$/.test(rawEnd))) return { invalid: true };
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === "" ? totalSize - 1 : Number.parseInt(rawEnd, 10);
  }
  if (start < 0 || end < start || start >= totalSize) return { invalid: true };
  return { start, end: Math.min(end, totalSize - 1), size: totalSize };
}

function unsatisfiableRangeResponse(size) {
  const headers = new Headers();
  headers.set("Content-Range", `bytes */${Number(size) || 0}`);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(null, { status: 416, headers });
}

function safeContentDisposition(filename, download) {
  const clean = basename(filename).replace(/["\r\n]/g, "_") || "object";
  return `${download ? "attachment" : "inline"}; filename="${clean}"`;
}

function targetKeyFromItem(item, targetPrefix) {
  const explicit = normalizeR2Path(item?.targetKey || item?.target_key, { allowEmpty: false });
  if (explicit) return explicit;
  const key = normalizeR2Path(item?.key, { allowEmpty: false });
  const prefix = normalizeR2Path(targetPrefix || "", { allowEmpty: true, folder: !!targetPrefix }) || "";
  return key ? `${prefix}${basename(key)}` : null;
}

async function ensureUnlinkedForDangerousAction(env, key) {
  const appLink = await detectR2ObjectAppLinks(env, key);
  if (appLink.linked) {
    return {
      blocked: true,
      appLink,
      error: "This object is linked to BITBI application data. Raw R2 rename, move, or delete is blocked to avoid broken D1 references.",
      code: "admin_r2_app_linked_object_blocked",
    };
  }
  return { blocked: false, appLink };
}

async function handleBuckets(ctx) {
  return json({
    ok: true,
    data: {
      buckets: availableBuckets(ctx.env),
      unavailableBuckets: Object.values(R2_BUCKETS)
        .filter((entry) => !ctx.env?.[entry.binding])
        .map((entry) => ({ id: entry.id, binding: entry.binding, displayName: entry.displayName })),
      publicMediaBindingAvailable: false,
      uploadMaxBytes: BODY_LIMITS.adminR2Upload,
    },
  });
}

async function handleListObjects(ctx) {
  const { env, url } = ctx;
  const resolved = resolveBucket(env, url.searchParams.get("bucket"));
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const prefix = normalizeR2Path(url.searchParams.get("prefix") || "", { allowEmpty: true, folder: !!url.searchParams.get("prefix") });
  if (prefix == null) return badRequest("Invalid prefix.", "admin_r2_invalid_prefix");
  const delimiter = url.searchParams.get("delimiter") || "/";
  const cursor = url.searchParams.get("cursor") || undefined;
  const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
  const limit = parsePositiveLimit(url.searchParams.get("limit"));

  const listed = await resolved.bucket.list({
    prefix,
    delimiter: delimiter === "/" ? "/" : undefined,
    cursor,
    limit,
  });
  const userCache = new Map();
  const rawFolders = Array.from(new Set((listed.delimitedPrefixes || []).filter(Boolean)))
    .filter((folderPrefix) => !HIDDEN_SENTINEL_RE.test(folderPrefix));
  let folders = [];
  for (const folderPrefix of rawFolders) {
    folders.push(await buildFolderSummary(env, resolved, folderPrefix, userCache));
  }
  let objects = [];
  for (const object of listed.objects || []) {
    if (!object?.key || HIDDEN_SENTINEL_RE.test(object.key)) continue;
    objects.push(await buildObjectSummary(env, resolved, object, userCache));
  }
  if (search) {
    const matches = (item) => [
      item.key,
      item.prefix,
      item.name,
      item.owner?.label,
      item.owner?.email,
      item.owner?.displayName,
      item.owner?.userId,
    ].some((value) => String(value || "").toLowerCase().includes(search));
    folders = folders.filter(matches);
    objects = objects.filter(matches);
  }
  return json({
    ok: true,
    data: {
      bucket: { id: resolved.id, displayName: resolved.displayName, risk: resolved.risk },
      prefix,
      breadcrumbs: buildBreadcrumbs(prefix),
      folders,
      objects,
      cursor: listed.cursor || null,
      truncated: listed.truncated === true,
      hasMore: listed.truncated === true || !!listed.cursor,
      limit,
      search: search || null,
      publicMediaBindingAvailable: false,
    },
  });
}

async function handleDetail(ctx) {
  const { env, url } = ctx;
  const resolved = resolveBucket(env, url.searchParams.get("bucket"));
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const key = normalizeR2Path(url.searchParams.get("key"), { allowEmpty: false });
  if (!key) return badRequest("Invalid object key.", "admin_r2_invalid_key");
  const object = await resolved.bucket.head(key);
  if (!object) return badRequest("Object not found.", "admin_r2_object_not_found", 404);
  const summary = await buildObjectSummary(env, resolved, { ...object, key }, new Map());
  return json({
    ok: true,
    data: {
      object: summary,
      rawKeyVisibleToAdmin: true,
      previewUrl: `/api/admin/r2/objects/file?bucket=${encodeURIComponent(resolved.id)}&key=${encodeURIComponent(key)}&download=0`,
      downloadUrl: `/api/admin/r2/objects/file?bucket=${encodeURIComponent(resolved.id)}&key=${encodeURIComponent(key)}&download=1`,
    },
  });
}

async function handleFile(ctx) {
  const { request, env, url } = ctx;
  const resolved = resolveBucket(env, url.searchParams.get("bucket"));
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const key = normalizeR2Path(url.searchParams.get("key"), { allowEmpty: false });
  if (!key) return badRequest("Invalid object key.", "admin_r2_invalid_key");
  const download = url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
  const head = await resolved.bucket.head(key);
  if (!head) return badRequest("Object not found.", "admin_r2_object_not_found", 404);
  const range = parseByteRange(request.headers.get("Range"), head.size);
  if (range?.invalid) return unsatisfiableRangeResponse(head.size || 0);
  const object = range
    ? await resolved.bucket.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } })
    : await resolved.bucket.get(key);
  if (!object) return badRequest("Object not found.", "admin_r2_object_not_found", 404);
  const contentType = object.httpMetadata?.contentType || head.httpMetadata?.contentType || contentTypeForName(key);
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", safeContentDisposition(key, download));
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  const length = range ? range.end - range.start + 1 : object.size;
  if (length) headers.set("Content-Length", String(length));
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${range.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

async function handleUpload(ctx, session) {
  let formData;
  try {
    formData = await readFormDataLimited(ctx.request, { maxBytes: BODY_LIMITS.adminR2Upload });
  } catch (error) {
    if (isRequestBodyError(error)) return requestBodyErrorResponse(error);
    throw error;
  }
  const body = Object.fromEntries(formData.entries());
  const guard = await requireMutationGuard(ctx, body, { action: "upload" });
  if (guard.response) return guard.response;
  const resolved = resolveBucket(ctx.env, body.bucket);
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("Upload file is required.", "admin_r2_upload_file_required");
  if (file.size > BODY_LIMITS.adminR2Upload) return badRequest("Upload is too large.", "admin_r2_upload_too_large", 413);
  const prefix = normalizeR2Path(body.prefix || "", { allowEmpty: true, folder: !!body.prefix });
  const requestedKey = normalizeR2Path(body.key || "", { allowEmpty: true });
  const key = requestedKey || `${prefix || ""}${normalizeR2Path(file.name, { allowEmpty: false })}`;
  if (!key || HIDDEN_SENTINEL_RE.test(key)) return badRequest("Invalid upload key.", "admin_r2_invalid_key");
  if (body.overwrite !== "true" && body.overwrite !== true) {
    const existing = await resolved.bucket.head(key);
    if (existing) return badRequest("Object already exists. Enable overwrite to replace it.", "admin_r2_object_exists", 409);
  }
  await resolved.bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || contentTypeForName(key) },
    customMetadata: {
      uploaded_by: "admin-r2-explorer",
      uploaded_at: nowIso(),
    },
  });
  const keyHash = await sha256Hex(key);
  await auditR2Action(ctx, session.user, "admin_r2_object_uploaded", {
    bucket: resolved.id,
    key_hash: keyHash,
    key_summary: redactedKeySummary(key),
    size_bytes: file.size,
    content_type: file.type || contentTypeForName(key),
    reason: guard.reason,
    idempotency_key_hash: guard.idempotencyKeyHash,
  });
  return json({ ok: true, data: { bucket: resolved.id, key, size: file.size, keyHash } });
}

async function handleCreateFolder(ctx, session) {
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const guard = await requireMutationGuard(ctx, parsed.body, { action: "create_folder" });
  if (guard.response) return guard.response;
  const resolved = resolveBucket(ctx.env, parsed.body?.bucket);
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const prefix = normalizeR2Path(parsed.body?.prefix, { allowEmpty: false, folder: true });
  if (!prefix) return badRequest("Invalid folder prefix.", "admin_r2_invalid_prefix");
  const sentinelKey = `${prefix}${FOLDER_SENTINEL_NAME}`;
  await resolved.bucket.put(sentinelKey, "", {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { sentinel: "bitbi-admin-r2-folder", created_at: nowIso() },
  });
  await auditR2Action(ctx, session.user, "admin_r2_folder_created", {
    bucket: resolved.id,
    prefix_hash: await sha256Hex(prefix),
    prefix_summary: redactedKeySummary(prefix),
    reason: guard.reason,
    idempotency_key_hash: guard.idempotencyKeyHash,
  });
  return json({ ok: true, data: { bucket: resolved.id, prefix } });
}

async function copyOneObject(env, source, target, item, targetPrefix) {
  const key = normalizeR2Path(item?.key, { allowEmpty: false });
  const targetKey = targetKeyFromItem(item, targetPrefix);
  if (!key || !targetKey || HIDDEN_SENTINEL_RE.test(targetKey)) {
    return { key: key || null, ok: false, code: "admin_r2_invalid_key", error: "Invalid source or target key." };
  }
  const object = await source.bucket.get(key);
  if (!object) return { key, targetKey, ok: false, code: "admin_r2_object_not_found", error: "Object not found." };
  const exists = await target.bucket.head(targetKey);
  if (exists && item?.overwrite !== true) {
    return { key, targetKey, ok: false, code: "admin_r2_target_exists", error: "Target object already exists." };
  }
  await target.bucket.put(targetKey, object.body, {
    httpMetadata: object.httpMetadata || { contentType: contentTypeForName(targetKey) },
    customMetadata: object.customMetadata || {},
  });
  return { key, targetKey, ok: true };
}

async function handleCopy(ctx, session) {
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const guard = await requireMutationGuard(ctx, parsed.body, { action: "copy" });
  if (guard.response) return guard.response;
  const source = resolveBucket(ctx.env, parsed.body?.sourceBucket || parsed.body?.bucket);
  const target = resolveBucket(ctx.env, parsed.body?.targetBucket || parsed.body?.bucket || parsed.body?.sourceBucket);
  if (!source || !target) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const items = Array.isArray(parsed.body?.items) ? parsed.body.items.slice(0, MAX_BATCH_ITEMS) : [];
  if (!items.length) return badRequest("At least one object is required.", "admin_r2_items_required");
  const targetPrefix = normalizeR2Path(parsed.body?.targetPrefix || "", { allowEmpty: true, folder: !!parsed.body?.targetPrefix });
  if (targetPrefix == null) return badRequest("Invalid target prefix.", "admin_r2_invalid_prefix");
  const results = [];
  for (const item of items) results.push(await copyOneObject(ctx.env, source, target, item, targetPrefix));
  await auditR2Action(ctx, session.user, "admin_r2_objects_copied", {
    source_bucket: source.id,
    target_bucket: target.id,
    item_count: items.length,
    success_count: results.filter((item) => item.ok).length,
    reason: guard.reason,
    idempotency_key_hash: guard.idempotencyKeyHash,
  });
  return json({ ok: true, data: { results } });
}

async function handleMove(ctx, session) {
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const guard = await requireMutationGuard(ctx, parsed.body, { action: "move" });
  if (guard.response) return guard.response;
  const source = resolveBucket(ctx.env, parsed.body?.sourceBucket || parsed.body?.bucket);
  const target = resolveBucket(ctx.env, parsed.body?.targetBucket || parsed.body?.bucket || parsed.body?.sourceBucket);
  if (!source || !target) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const items = Array.isArray(parsed.body?.items) ? parsed.body.items.slice(0, MAX_BATCH_ITEMS) : [];
  if (!items.length) return badRequest("At least one object is required.", "admin_r2_items_required");
  const targetPrefix = normalizeR2Path(parsed.body?.targetPrefix || "", { allowEmpty: true, folder: !!parsed.body?.targetPrefix });
  if (targetPrefix == null) return badRequest("Invalid target prefix.", "admin_r2_invalid_prefix");
  const results = [];
  for (const item of items) {
    const key = normalizeR2Path(item?.key, { allowEmpty: false });
    if (!key) {
      results.push({ key: null, ok: false, code: "admin_r2_invalid_key", error: "Invalid source key." });
      continue;
    }
    const linkGuard = await ensureUnlinkedForDangerousAction(ctx.env, key);
    if (linkGuard.blocked) {
      results.push({ key, ok: false, code: linkGuard.code, error: linkGuard.error, appLink: linkGuard.appLink });
      continue;
    }
    const copied = await copyOneObject(ctx.env, source, target, item, targetPrefix);
    if (copied.ok) await source.bucket.delete(key);
    results.push(copied);
  }
  await auditR2Action(ctx, session.user, "admin_r2_objects_moved", {
    source_bucket: source.id,
    target_bucket: target.id,
    item_count: items.length,
    success_count: results.filter((item) => item.ok).length,
    reason: guard.reason,
    idempotency_key_hash: guard.idempotencyKeyHash,
  });
  return json({ ok: true, data: { results } });
}

async function handleDelete(ctx, session) {
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.adminJson });
  if (parsed.response) return parsed.response;
  const guard = await requireMutationGuard(ctx, parsed.body, { action: "delete", destructive: true });
  if (guard.response) return guard.response;
  const resolved = resolveBucket(ctx.env, parsed.body?.bucket);
  if (!resolved) return badRequest("Unknown or unavailable R2 bucket.", "admin_r2_bucket_not_found", 404);
  const items = Array.isArray(parsed.body?.items) ? parsed.body.items.slice(0, MAX_BATCH_ITEMS) : [];
  if (!items.length) return badRequest("At least one object is required.", "admin_r2_items_required");
  const results = [];
  for (const item of items) {
    const key = normalizeR2Path(item?.key, { allowEmpty: false });
    if (!key || key.endsWith("/") || HIDDEN_SENTINEL_RE.test(key)) {
      results.push({ key: key || null, ok: false, code: "admin_r2_invalid_key", error: "Invalid delete key." });
      continue;
    }
    const echoBucket = String(item?.bucket || parsed.body?.bucket || "").trim().toUpperCase();
    if (echoBucket && echoBucket !== resolved.id) {
      results.push({ key, ok: false, code: "admin_r2_target_mismatch", error: "Delete target bucket mismatch." });
      continue;
    }
    const linkGuard = await ensureUnlinkedForDangerousAction(ctx.env, key);
    if (linkGuard.blocked) {
      results.push({ key, ok: false, code: linkGuard.code, error: linkGuard.error, appLink: linkGuard.appLink });
      continue;
    }
    const existing = await resolved.bucket.head(key);
    if (!existing) {
      results.push({ key, ok: false, code: "admin_r2_object_not_found", error: "Object not found." });
      continue;
    }
    await resolved.bucket.delete(key);
    results.push({ key, ok: true });
  }
  await auditR2Action(ctx, session.user, "admin_r2_objects_deleted", {
    bucket: resolved.id,
    item_count: items.length,
    success_count: results.filter((item) => item.ok).length,
    reason: guard.reason,
    idempotency_key_hash: guard.idempotencyKeyHash,
  });
  return json({ ok: true, data: { results } });
}

export async function handleAdminR2Explorer(ctx) {
  const { request, pathname, method, env, isSecure, correlationId } = ctx;
  if (!isAdminR2Route(pathname)) return null;
  const session = await requireAdmin(request, env, { isSecure, correlationId });
  if (session instanceof Response) return session;
  const limited = await enforceAdminR2RateLimit(ctx, { write: method !== "GET" && method !== "HEAD" });
  if (limited) return limited;

  // route-policy: admin.r2.buckets.list
  if (pathname === "/api/admin/r2/buckets" && method === "GET") return handleBuckets(ctx);
  // route-policy: admin.r2.objects.list
  if (pathname === "/api/admin/r2/objects" && method === "GET") return handleListObjects(ctx);
  // route-policy: admin.r2.objects.detail
  if (pathname === "/api/admin/r2/objects/detail" && method === "GET") return handleDetail(ctx);
  // route-policy: admin.r2.objects.file
  if (pathname === "/api/admin/r2/objects/file" && method === "GET") return handleFile(ctx);
  // route-policy: admin.r2.objects.upload
  if (pathname === "/api/admin/r2/objects/upload" && method === "POST") return handleUpload(ctx, session);
  // route-policy: admin.r2.folders.create
  if (pathname === "/api/admin/r2/folders" && method === "POST") return handleCreateFolder(ctx, session);
  // route-policy: admin.r2.objects.copy
  if (pathname === "/api/admin/r2/objects/copy" && method === "POST") return handleCopy(ctx, session);
  // route-policy: admin.r2.objects.move
  if (pathname === "/api/admin/r2/objects/move" && method === "POST") return handleMove(ctx, session);
  // route-policy: admin.r2.objects.delete
  if (pathname === "/api/admin/r2/objects/delete" && method === "POST") return handleDelete(ctx, session);
  return null;
}

export const __test__ = {
  DELETE_CONFIRMATION,
  normalizeR2Path,
  buildBreadcrumbs,
  extractUserIdFromPrefix,
  detectR2ObjectAppLinks,
};
