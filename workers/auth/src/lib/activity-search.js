export const ACTIVITY_SEARCH_INDEX_TABLE = "activity_search_index";
export const USER_ACTIVITY_LOG_TABLE = "user_activity_log";
export const ADMIN_AUDIT_LOG_TABLE = "admin_audit_log";
export const ADMIN_ACTIVITY_CURSOR_TYPE = "admin_activity";
export const ADMIN_USER_ACTIVITY_CURSOR_TYPE = "admin_user_activity";
export const ACTIVITY_CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_SEARCH_LENGTH = 100;
const EMAIL_KEYS = Object.freeze(["email", "actor_email", "target_email", "user_email"]);
const ENTITY_ID_KEYS = Object.freeze([
  "entity_id",
  "target_user_id",
  "deletedUserId",
  "image_id",
  "imageId",
  "folder_id",
  "folderId",
  "asset_id",
  "assetId",
  "job_id",
  "jobId",
  "source_image_id",
]);
const SAFE_META_FIELDS_BY_ACTION = Object.freeze({
  change_role: ["role"],
  change_status: ["status"],
  revoke_sessions: ["revokedSessions"],
  delete_user: ["target_role", "target_status"],
  register: ["email"],
  update_profile: ["fields"],
  upload_avatar: ["type"],
  select_avatar_saved_asset: ["type", "source_image_id"],
});
const SAFE_GENERIC_META_FIELDS = Object.freeze([
  "status",
  "result",
  "reason",
  "entity_type",
  "entity_id",
  "fields",
  "type",
]);

function parseMetaJson(metaJson) {
  if (!metaJson || typeof metaJson !== "string") return {};
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 320 ? normalized : null;
}

function normalizeToken(value, { maxLength = 160 } = {}) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function firstNormalizedMetaValue(meta, keys, normalizer = normalizeToken) {
  for (const key of keys) {
    const normalized = normalizer(meta?.[key]);
    if (normalized) return normalized;
  }
  return null;
}

function inferEntityType(meta, fallbackId) {
  const explicit = normalizeToken(meta?.entity_type, { maxLength: 64 });
  if (explicit) return explicit;
  if (fallbackId || meta?.target_user_id || meta?.deletedUserId) return "user";
  if (meta?.image_id || meta?.imageId || meta?.source_image_id) return "image";
  if (meta?.folder_id || meta?.folderId) return "folder";
  if (meta?.asset_id || meta?.assetId) return "asset";
  if (meta?.job_id || meta?.jobId) return "job";
  return null;
}

function sanitizeScalar(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .slice(0, 8);
    return normalized.length > 0 ? normalized : null;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, 240) : null;
  }
  return null;
}

export function sanitizeActivityMetaJson(action, metaJson) {
  const meta = parseMetaJson(metaJson);
  const allowed = SAFE_META_FIELDS_BY_ACTION[action] || SAFE_GENERIC_META_FIELDS;
  const out = {};
  for (const key of allowed) {
    const value = sanitizeScalar(meta[key]);
    if (value != null) out[key] = value;
  }
  return JSON.stringify(out);
}

export function normalizeActivitySearchTerm(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.slice(0, MAX_SEARCH_LENGTH);
}

export function buildActivitySearchRange(term) {
  const normalized = normalizeActivitySearchTerm(term);
  if (!normalized) return null;
  return [normalized, `${normalized}\uffff`];
}

export async function buildActivitySearchFilterHash(sourceTable, searchTerm) {
  const body = `${sourceTable}:${normalizeActivitySearchTerm(searchTerm)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildActivitySearchRecord(event) {
  const meta = parseMetaJson(event?.meta_json);
  const sourceTable = String(event?.table || "");
  const actionNorm = normalizeToken(event?.action, { maxLength: 120 }) || "unknown";
  const isAdminAudit = sourceTable === ADMIN_AUDIT_LOG_TABLE;
  const actorUserId = isAdminAudit ? event?.admin_user_id : event?.user_id;
  const targetUserId = isAdminAudit ? event?.target_user_id : null;
  const actorEmail = isAdminAudit
    ? normalizeEmail(meta.actor_email)
    : firstNormalizedMetaValue(meta, ["email", "user_email"], normalizeEmail);
  const targetEmail = isAdminAudit
    ? normalizeEmail(meta.target_email)
    : normalizeEmail(meta.target_email);
  const entityId = firstNormalizedMetaValue(meta, ENTITY_ID_KEYS, (input) => normalizeToken(input, { maxLength: 160 }))
    || normalizeToken(targetUserId, { maxLength: 160 });
  const entityType = inferEntityType(meta, targetUserId);
  return {
    source_table: sourceTable,
    source_event_id: String(event?.event_id || ""),
    actor_user_id: actorUserId ? String(actorUserId) : null,
    actor_email_norm: actorEmail,
    target_user_id: targetUserId ? String(targetUserId) : null,
    target_email_norm: targetEmail,
    action_norm: actionNorm,
    entity_type: entityType,
    entity_id: entityId,
    summary: null,
    created_at: String(event?.created_at || ""),
  };
}

export function buildActivitySearchIndexInsertStatement(env, event, { ignoreConflicts = false } = {}) {
  const verb = ignoreConflicts ? "INSERT OR IGNORE" : "INSERT";
  const record = buildActivitySearchRecord(event);
  return env.DB.prepare(
    `${verb} INTO activity_search_index (
       source_table,
       source_event_id,
       actor_user_id,
       actor_email_norm,
       target_user_id,
       target_email_norm,
       action_norm,
       entity_type,
       entity_id,
       summary,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.source_table,
    record.source_event_id,
    record.actor_user_id,
    record.actor_email_norm,
    record.target_user_id,
    record.target_email_norm,
    record.action_norm,
    record.entity_type,
    record.entity_id,
    record.summary,
    record.created_at
  );
}
