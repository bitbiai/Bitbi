import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { enqueueAdminAuditEvent } from "../lib/activity.js";
import { requireAdmin } from "../lib/session.js";
import {
  buildNewsPulseContentHash,
  getNewsPulseDisplaySettings,
  normalizeNewsPulseAdminIsoDate,
  normalizeNewsPulseAdminText,
  normalizeNewsPulseAdminUrl,
  normalizeNewsPulseLocale,
  normalizeNewsPulseSurface,
  setNewsPulseDisplaySettings,
} from "../lib/news-pulse.js";
import {
  getNewsPulseVisualThumbUrl,
  isNewsPulseVisualObjectKey,
} from "../lib/news-pulse-visuals.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  nowIso,
  sha256Hex,
} from "../lib/tokens.js";

const MIN_OPERATOR_REASON_LENGTH = 8;
const MAX_OPERATOR_REASON_LENGTH = 500;
const MAX_ADMIN_NEWS_PULSE_LIMIT = 100;
const DEFAULT_ADMIN_NEWS_PULSE_LIMIT = 50;
const MAX_DELETE_BATCH_SIZE = 50;
const DELETE_CONFIRMATION = "delete_news_pulse_items";
const ITEM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const VISUAL_STATUS_VALUES = new Set(["missing", "pending", "ready", "failed", "skipped"]);
const STATUS_VALUES = new Set(["active", "hidden"]);

function noMatch() {
  return null;
}

function isMissingNewsPulseSchema(error) {
  const message = String(error?.message || error || "");
  return message.includes("no such table") && (
    message.includes("news_pulse_items") ||
    message.includes("news_pulse_display_settings")
  );
}

function normalizeOperatorReason(value) {
  const reason = String(value || "").replace(/\s+/g, " ").trim();
  if (reason.length < MIN_OPERATOR_REASON_LENGTH) return null;
  return reason.slice(0, MAX_OPERATOR_REASON_LENGTH);
}

function idempotencyKeyOrResponse(request, action = "admin News Pulse mutation") {
  const key = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!key) {
    return {
      response: json(
        {
          ok: false,
          error: `Idempotency-Key is required for ${action}.`,
          code: "idempotency_key_required",
        },
        { status: 428 }
      ),
    };
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    return {
      response: json(
        { ok: false, error: "Invalid Idempotency-Key header.", code: "invalid_idempotency_key" },
        { status: 400 }
      ),
    };
  }
  return { key };
}

async function enforceAdminNewsPulseRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    "admin-news-pulse-action-ip",
    getClientIp(ctx.request),
    20,
    60_000,
    sensitiveRateLimitOptions({
      component: "admin-news-pulse",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function requireAdminForNewsPulse(ctx, { mutation = false, action = "admin News Pulse mutation" } = {}) {
  const result = await requireAdmin(ctx.request, ctx.env, {
    isSecure: ctx.isSecure,
    correlationId: ctx.correlationId,
  });
  if (result instanceof Response) return { response: result };
  let idempotencyKey = null;
  if (mutation) {
    const limited = await enforceAdminNewsPulseRateLimit(ctx);
    if (limited) return { response: limited };
    const idempotency = idempotencyKeyOrResponse(ctx.request, action);
    if (idempotency.response) return { response: idempotency.response };
    idempotencyKey = idempotency.key;
  }
  return { admin: result.user, idempotencyKey };
}

async function auditAdminNewsPulseAction(ctx, admin, action, meta = {}) {
  const now = nowIso();
  await enqueueAdminAuditEvent(
    ctx.env,
    {
      adminUserId: admin.id,
      action,
      targetUserId: null,
      meta,
      createdAt: now,
    },
    {
      correlationId: ctx.correlationId,
      requestInfo: ctx,
      allowDirectFallback: true,
    }
  );
}

function normalizeItemId(value) {
  const id = String(value || "").trim();
  return ITEM_ID_PATTERN.test(id) ? id : null;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function normalizeLimit(value) {
  const limit = Number(value || DEFAULT_ADMIN_NEWS_PULSE_LIMIT);
  if (!Number.isFinite(limit)) return DEFAULT_ADMIN_NEWS_PULSE_LIMIT;
  return Math.min(MAX_ADMIN_NEWS_PULSE_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeCursor(value) {
  const cursor = Number(value || 0);
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return Math.floor(cursor);
}

function serializeBoolean(value) {
  return value === true || Number(value) === 1;
}

function serializeNewsPulseItem(row, { now = new Date().toISOString(), includeDetail = false } = {}) {
  const expiresAt = row?.expires_at || null;
  const isExpired = Boolean(expiresAt && expiresAt <= now);
  const hasVisualObject = Boolean(row?.visual_object_key);
  const adminThumbUrl = hasVisualObject && isNewsPulseVisualObjectKey(row.visual_object_key)
    ? `/api/admin/news-pulse/thumbs/${encodeURIComponent(String(row.id || ""))}`
    : null;
  const serialized = {
    id: String(row?.id || ""),
    locale: normalizeNewsPulseLocale(row?.locale),
    title: String(row?.title || ""),
    summary: String(row?.summary || ""),
    source: String(row?.source || ""),
    url: String(row?.url || ""),
    category: String(row?.category || ""),
    status: row?.status === "hidden" ? "hidden" : "active",
    published_at: row?.published_at || null,
    expires_at: expiresAt,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    active: row?.status === "active" && !isExpired,
    expired: isExpired,
    visual_type: row?.visual_type || "icon",
    visual_status: row?.visual_status || "missing",
    has_visual_object: hasVisualObject,
    admin_thumb_url: adminThumbUrl,
    public_thumb_url: row?.visual_status === "ready" ? getNewsPulseVisualThumbUrl(row?.id) : null,
    visual_generated_at: row?.visual_generated_at || null,
    visual_error: row?.visual_error || null,
    visual_attempts: Number(row?.visual_attempts || 0),
  };
  if (includeDetail) {
    serialized.visual_object_key_redacted = hasVisualObject ? "news-pulse/thumbs/{item}.webp" : null;
    serialized.visual_prompt_present = Boolean(row?.visual_prompt);
  }
  return serialized;
}

async function buildOverview(ctx) {
  const now = new Date().toISOString();
  const visibility = await getNewsPulseDisplaySettings(ctx.env, { now });
  const overview = {
    visibility,
    counts: {
      total: 0,
      active: 0,
      hidden: 0,
      expired: 0,
      with_visual_object: 0,
    },
    by_locale: { en: { active: 0, hidden: 0, expired: 0 }, de: { active: 0, hidden: 0, expired: 0 } },
    by_visual_status: {},
    last_updated_at: null,
    bindings: {
      db: Boolean(ctx.env?.DB),
      user_images: Boolean(ctx.env?.USER_IMAGES),
    },
    schema: {
      items_available: Boolean(ctx.env?.DB),
      display_settings_available: visibility.schema_available,
    },
    generated_at: now,
  };
  if (!ctx.env?.DB) return overview;
  try {
    const result = await ctx.env.DB.prepare(
      `SELECT id, locale, status, expires_at, updated_at, visual_status, visual_object_key
       FROM news_pulse_items`
    ).all();
    for (const row of result?.results || []) {
      const locale = normalizeNewsPulseLocale(row?.locale);
      const expired = Boolean(row?.expires_at && row.expires_at <= now);
      overview.counts.total += 1;
      if (expired) {
        overview.counts.expired += 1;
        overview.by_locale[locale].expired += 1;
      } else if (row?.status === "hidden") {
        overview.counts.hidden += 1;
        overview.by_locale[locale].hidden += 1;
      } else {
        overview.counts.active += 1;
        overview.by_locale[locale].active += 1;
      }
      if (row?.visual_object_key) overview.counts.with_visual_object += 1;
      const visualStatus = row?.visual_status || "missing";
      overview.by_visual_status[visualStatus] = (overview.by_visual_status[visualStatus] || 0) + 1;
      if (row?.updated_at && (!overview.last_updated_at || row.updated_at > overview.last_updated_at)) {
        overview.last_updated_at = row.updated_at;
      }
    }
  } catch (error) {
    if (!isMissingNewsPulseSchema(error)) throw error;
    overview.schema.items_available = false;
  }
  return overview;
}

async function handleOverview(ctx) {
  const required = await requireAdminForNewsPulse(ctx);
  if (required.response) return required.response;
  return json({ ok: true, data: await buildOverview(ctx) });
}

async function handleVisibilityGet(ctx) {
  const required = await requireAdminForNewsPulse(ctx);
  if (required.response) return required.response;
  return json({ ok: true, data: await getNewsPulseDisplaySettings(ctx.env) });
}

async function handleVisibilityPatch(ctx) {
  const required = await requireAdminForNewsPulse(ctx, { mutation: true, action: "News Pulse visibility changes" });
  if (required.response) return required.response;
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const reason = normalizeOperatorReason(body.reason);
  if (!reason) {
    return json(
      { ok: false, error: "A reason of at least 8 characters is required.", code: "operator_reason_required" },
      { status: 400 }
    );
  }
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, "desktop_enabled")) {
    updates.desktopEnabled = body.desktop_enabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "mobile_enabled")) {
    updates.mobileEnabled = body.mobile_enabled === true;
  }
  if (updates.desktopEnabled === undefined && updates.mobileEnabled === undefined) {
    return json({ ok: false, error: "No visibility setting was provided.", code: "news_pulse_visibility_noop" }, { status: 400 });
  }
  const now = nowIso();
  const result = await setNewsPulseDisplaySettings(ctx.env, {
    ...updates,
    actorUserId: required.admin.id,
    reason,
    now,
  });
  await auditAdminNewsPulseAction(ctx, required.admin, "admin_news_pulse_visibility_updated", {
    desktop_enabled: updates.desktopEnabled,
    mobile_enabled: updates.mobileEnabled,
    idempotency_key_hash: await sha256Hex(required.idempotencyKey),
  });
  return json({ ok: true, data: result });
}

function buildListFilters(url) {
  const locale = String(url.searchParams.get("locale") || "all").trim().toLowerCase();
  const status = String(url.searchParams.get("status") || "active").trim().toLowerCase();
  const visualStatus = String(url.searchParams.get("visual_status") || "all").trim().toLowerCase();
  const surface = normalizeNewsPulseSurface(url.searchParams.get("surface"));
  return {
    locale: locale === "de" || locale === "en" ? locale : "all",
    status: ["active", "hidden", "expired", "all"].includes(status) ? status : "active",
    visualStatus: VISUAL_STATUS_VALUES.has(visualStatus) ? visualStatus : "all",
    surface,
    limit: normalizeLimit(url.searchParams.get("limit")),
    offset: normalizeCursor(url.searchParams.get("cursor")),
  };
}

async function handleItemsList(ctx) {
  const required = await requireAdminForNewsPulse(ctx);
  if (required.response) return required.response;
  if (!ctx.env?.DB) {
    return json({ ok: true, data: { items: [], has_more: false, next_cursor: null, schema_available: false } });
  }
  const now = new Date().toISOString();
  const filters = buildListFilters(ctx.url);
  const conditions = [];
  const bindings = [];
  if (filters.locale !== "all") {
    conditions.push("locale = ?");
    bindings.push(filters.locale);
  }
  if (filters.status === "active") {
    conditions.push("status = 'active'");
    conditions.push("(expires_at IS NULL OR expires_at > ?)");
    bindings.push(now);
  } else if (filters.status === "hidden") {
    conditions.push("status = 'hidden'");
  } else if (filters.status === "expired") {
    conditions.push("expires_at IS NOT NULL AND expires_at <= ?");
    bindings.push(now);
  }
  if (filters.visualStatus !== "all") {
    conditions.push("COALESCE(visual_status, 'missing') = ?");
    bindings.push(filters.visualStatus);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const result = await ctx.env.DB.prepare(
      `SELECT id, locale, title, summary, source, url, category, published_at, status, expires_at,
              visual_type, visual_status, visual_object_key, visual_thumb_url, visual_generated_at,
              visual_error, visual_attempts, created_at, updated_at
       FROM news_pulse_items
       ${whereClause}
       ORDER BY published_at DESC, updated_at DESC, id DESC
       LIMIT ? OFFSET ?`
    ).bind(...bindings, filters.limit + 1, filters.offset).all();
    const rows = result?.results || [];
    const hasMore = rows.length > filters.limit;
    return json({
      ok: true,
      data: {
        items: rows.slice(0, filters.limit).map((row) => serializeNewsPulseItem(row, { now })),
        has_more: hasMore,
        next_cursor: hasMore ? String(filters.offset + filters.limit) : null,
        schema_available: true,
        filters,
      },
    });
  } catch (error) {
    if (!isMissingNewsPulseSchema(error)) throw error;
    return json({ ok: true, data: { items: [], has_more: false, next_cursor: null, schema_available: false, filters } });
  }
}

async function fetchNewsPulseItem(env, id) {
  return env.DB.prepare(
    `SELECT id, locale, title, summary, source, url, category, published_at, status, expires_at,
            visual_type, visual_url, visual_prompt, visual_status, visual_object_key, visual_thumb_url,
            visual_generated_at, visual_error, visual_attempts, created_at, updated_at
     FROM news_pulse_items
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();
}

async function handleItemDetail(ctx, id) {
  const required = await requireAdminForNewsPulse(ctx);
  if (required.response) return required.response;
  if (!ctx.env?.DB) return json({ ok: false, error: "News Pulse storage is not configured.", code: "news_pulse_storage_missing" }, { status: 503 });
  const row = await fetchNewsPulseItem(ctx.env, id);
  if (!row) return json({ ok: false, error: "News Pulse item not found.", code: "news_pulse_item_not_found" }, { status: 404 });
  return json({ ok: true, data: { item: serializeNewsPulseItem(row, { includeDetail: true }) } });
}

function normalizeItemPatchBody(body) {
  const title = normalizeNewsPulseAdminText(body.title, { field: "title", maxLength: 160 });
  const summary = normalizeNewsPulseAdminText(body.summary, { field: "summary", maxLength: 240 });
  const source = normalizeNewsPulseAdminText(body.source, { field: "source", maxLength: 80 });
  const url = normalizeNewsPulseAdminUrl(body.url);
  const category = normalizeNewsPulseAdminText(body.category || "AI", { field: "category", maxLength: 48 });
  const publishedAt = normalizeNewsPulseAdminIsoDate(body.published_at, { field: "published_at" });
  const expiresAt = normalizeNewsPulseAdminIsoDate(body.expires_at, { field: "expires_at", required: false });
  const status = String(body.status || "active").trim().toLowerCase();
  if (!STATUS_VALUES.has(status)) {
    throw new Error("Invalid status.");
  }
  return {
    title,
    summary,
    source,
    url,
    category,
    publishedAt,
    expiresAt,
    status,
    resetVisual: body.reset_visual === true,
  };
}

async function handleItemPatch(ctx, id) {
  const required = await requireAdminForNewsPulse(ctx, { mutation: true, action: "News Pulse item edits" });
  if (required.response) return required.response;
  if (!ctx.env?.DB) return json({ ok: false, error: "News Pulse storage is not configured.", code: "news_pulse_storage_missing" }, { status: 503 });
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const reason = normalizeOperatorReason(body.reason);
  if (!reason) {
    return json({ ok: false, error: "A reason of at least 8 characters is required.", code: "operator_reason_required" }, { status: 400 });
  }
  let normalized;
  try {
    normalized = normalizeItemPatchBody(body);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Invalid News Pulse item fields.", code: "news_pulse_item_validation_failed" }, { status: 400 });
  }
  const existing = await fetchNewsPulseItem(ctx.env, id);
  if (!existing) return json({ ok: false, error: "News Pulse item not found.", code: "news_pulse_item_not_found" }, { status: 404 });
  const now = nowIso();
  const contentHash = await buildNewsPulseContentHash({
    locale: existing.locale,
    title: normalized.title,
    summary: normalized.summary,
    source: normalized.source,
    url: normalized.url,
    category: normalized.category,
    published_at: normalized.publishedAt,
    visual_type: existing.visual_type || "generated",
    visual_url: existing.visual_url || null,
  });
  if (normalized.resetVisual) {
    await ctx.env.DB.prepare(
      `UPDATE news_pulse_items
       SET title = ?, summary = ?, source = ?, url = ?, category = ?, published_at = ?,
           status = ?, expires_at = ?, content_hash = ?, updated_at = ?,
           visual_type = 'generated', visual_url = NULL, visual_prompt = NULL, visual_status = 'missing',
           visual_object_key = NULL, visual_thumb_url = NULL, visual_generated_at = NULL,
           visual_error = NULL, visual_attempts = 0, visual_updated_at = ?
       WHERE id = ?`
    ).bind(
      normalized.title,
      normalized.summary,
      normalized.source,
      normalized.url,
      normalized.category,
      normalized.publishedAt,
      normalized.status,
      normalized.expiresAt,
      contentHash,
      now,
      now,
      id
    ).run();
  } else {
    await ctx.env.DB.prepare(
      `UPDATE news_pulse_items
       SET title = ?, summary = ?, source = ?, url = ?, category = ?, published_at = ?,
           status = ?, expires_at = ?, content_hash = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      normalized.title,
      normalized.summary,
      normalized.source,
      normalized.url,
      normalized.category,
      normalized.publishedAt,
      normalized.status,
      normalized.expiresAt,
      contentHash,
      now,
      id
    ).run();
  }
  await auditAdminNewsPulseAction(ctx, required.admin, "admin_news_pulse_item_updated", {
    item_id_hash: await sha256Hex(id),
    status: normalized.status,
    reset_visual: normalized.resetVisual,
    idempotency_key_hash: await sha256Hex(required.idempotencyKey),
  });
  const updated = await fetchNewsPulseItem(ctx.env, id);
  return json({ ok: true, data: { item: serializeNewsPulseItem(updated, { includeDetail: true }) } });
}

async function handleItemsDelete(ctx) {
  const required = await requireAdminForNewsPulse(ctx, { mutation: true, action: "News Pulse item deletion" });
  if (required.response) return required.response;
  if (!ctx.env?.DB) return json({ ok: false, error: "News Pulse storage is not configured.", code: "news_pulse_storage_missing" }, { status: 503 });
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const reason = normalizeOperatorReason(body.reason);
  if (!reason) {
    return json({ ok: false, error: "A reason of at least 8 characters is required.", code: "operator_reason_required" }, { status: 400 });
  }
  if (body.confirmation !== DELETE_CONFIRMATION) {
    return json(
      { ok: false, error: "Deletion confirmation is required.", code: "news_pulse_delete_confirmation_required", required_confirmation: DELETE_CONFIRMATION },
      { status: 409 }
    );
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(normalizeItemId).filter(Boolean))]
    : [];
  if (!ids.length || ids.length > MAX_DELETE_BATCH_SIZE) {
    return json({ ok: false, error: `Select 1-${MAX_DELETE_BATCH_SIZE} valid News Pulse item ids.`, code: "news_pulse_delete_invalid_ids" }, { status: 400 });
  }

  const results = [];
  let deletedRows = 0;
  let deletedVisuals = 0;
  for (const id of ids) {
    const row = await fetchNewsPulseItem(ctx.env, id);
    if (!row) {
      results.push({ id, status: "not_found", row_deleted: false, visual_deleted: false });
      continue;
    }
    const visualKey = String(row.visual_object_key || "");
    let visualDeleteStatus = "not_present";
    if (visualKey) {
      if (isNewsPulseVisualObjectKey(visualKey) && ctx.env.USER_IMAGES) {
        try {
          await ctx.env.USER_IMAGES.delete(visualKey);
          deletedVisuals += 1;
          visualDeleteStatus = "deleted";
        } catch {
          results.push({ id, status: "failed", row_deleted: false, visual_deleted: false, visual_delete_status: "failed" });
          continue;
        }
      } else {
        visualDeleteStatus = "skipped_invalid_or_unconfigured";
      }
    }
    const deleteResult = await ctx.env.DB.prepare("DELETE FROM news_pulse_items WHERE id = ?").bind(id).run();
    const rowDeleted = Number(deleteResult?.meta?.changes || 0) > 0;
    if (rowDeleted) deletedRows += 1;
    results.push({
      id,
      status: rowDeleted ? "deleted" : "not_found",
      row_deleted: rowDeleted,
      visual_deleted: visualDeleteStatus === "deleted",
      visual_delete_status: visualDeleteStatus,
    });
  }

  const failedCount = results.filter((entry) => entry.status === "failed").length;
  await auditAdminNewsPulseAction(ctx, required.admin, "admin_news_pulse_items_deleted", {
    item_count: ids.length,
    deleted_rows: deletedRows,
    deleted_visuals: deletedVisuals,
    failed_count: failedCount,
    idempotency_key_hash: await sha256Hex(required.idempotencyKey),
  });

  return json({
    ok: failedCount === 0,
    data: {
      status: failedCount === 0 ? "completed" : "partial_failure",
      deleted_rows: deletedRows,
      deleted_visuals: deletedVisuals,
      failed_count: failedCount,
      results,
    },
  }, { status: failedCount === 0 ? 200 : 207 });
}

function adminThumbHeaders(object) {
  const headers = new Headers();
  headers.set("Content-Type", object?.httpMetadata?.contentType || "image/webp");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (Number.isFinite(object?.size) && object.size > 0) {
    headers.set("Content-Length", String(object.size));
  }
  return headers;
}

async function handleAdminThumb(ctx, id) {
  const required = await requireAdminForNewsPulse(ctx);
  if (required.response) return required.response;
  if (!ctx.env?.DB || !ctx.env.USER_IMAGES) return json({ ok: false, error: "Not found" }, { status: 404 });
  const row = await fetchNewsPulseItem(ctx.env, id);
  const objectKey = String(row?.visual_object_key || "");
  if (!isNewsPulseVisualObjectKey(objectKey)) return json({ ok: false, error: "Not found" }, { status: 404 });
  const object = await ctx.env.USER_IMAGES.get(objectKey);
  if (!object?.body) return json({ ok: false, error: "Not found" }, { status: 404 });
  return new Response(object.body, { status: 200, headers: adminThumbHeaders(object) });
}

export async function handleAdminNewsPulse(ctx) {
  const { pathname, method } = ctx;
  if (!pathname.startsWith("/api/admin/news-pulse")) return noMatch();

  if (pathname === "/api/admin/news-pulse/overview" && method === "GET") {
    return handleOverview(ctx);
  }
  if (pathname === "/api/admin/news-pulse/visibility" && method === "GET") {
    return handleVisibilityGet(ctx);
  }
  // route-policy: admin.news-pulse.visibility.update
  if (pathname === "/api/admin/news-pulse/visibility" && method === "PATCH") {
    return handleVisibilityPatch(ctx);
  }
  if (pathname === "/api/admin/news-pulse/items" && method === "GET") {
    return handleItemsList(ctx);
  }
  // route-policy: admin.news-pulse.items.delete
  if (pathname === "/api/admin/news-pulse/items" && method === "DELETE") {
    return handleItemsDelete(ctx);
  }
  const itemMatch = pathname.match(/^\/api\/admin\/news-pulse\/items\/([^/]+)$/);
  if (itemMatch) {
    const id = normalizeItemId(decodePathSegment(itemMatch[1]));
    if (!id) return json({ ok: false, error: "Invalid News Pulse item id.", code: "news_pulse_invalid_item_id" }, { status: 400 });
    if (method === "GET") return handleItemDetail(ctx, id);
    // route-policy: admin.news-pulse.items.update
    if (method === "PATCH") return handleItemPatch(ctx, id);
  }
  const thumbMatch = pathname.match(/^\/api\/admin\/news-pulse\/thumbs\/([^/]+)$/);
  if (thumbMatch && method === "GET") {
    const id = normalizeItemId(decodePathSegment(thumbMatch[1]));
    if (!id) return json({ ok: false, error: "Invalid News Pulse item id.", code: "news_pulse_invalid_item_id" }, { status: 400 });
    return handleAdminThumb(ctx, id);
  }
  return noMatch();
}
