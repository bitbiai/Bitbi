import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export const ACTIVITY_HOT_RETENTION_DAYS = 90;
export const ACTIVITY_ARCHIVE_MAX_ROWS_PER_CHUNK = 250;
export const ACTIVITY_ARCHIVE_MAX_CHUNKS_PER_TABLE = 2;
export const AUDIT_ARCHIVE_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

const ACTIVITY_ARCHIVE_SCHEMA_VERSION = 1;

const ACTIVITY_ARCHIVE_TABLES = Object.freeze([
  {
    table: "admin_audit_log",
    keyPrefix: "admin-audit-log",
    selectSql:
      "SELECT id, admin_user_id, action, target_user_id, meta_json, created_at FROM admin_audit_log WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?",
    deleteSqlPrefix: "DELETE FROM admin_audit_log WHERE id IN (",
  },
  {
    table: "user_activity_log",
    keyPrefix: "user-activity-log",
    selectSql:
      "SELECT id, user_id, action, meta_json, ip_address, created_at FROM user_activity_log WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?",
    deleteSqlPrefix: "DELETE FROM user_activity_log WHERE id IN (",
  },
]);

function isProductionEnvironment(env) {
  return String(env?.BITBI_ENV || "").trim().toLowerCase() === "production";
}

function subtractDaysIso(referenceIso, days) {
  const parsed = Date.parse(referenceIso);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base - days * 24 * 60 * 60 * 1000).toISOString();
}

function toArchiveDay(createdAt) {
  return typeof createdAt === "string" ? createdAt.slice(0, 10) : null;
}

function sanitizeKeySegment(value) {
  return String(value || "")
    .trim()
    .replace(/[:.]/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 96);
}

function buildArchiveKey(config, rows) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const day = toArchiveDay(first?.created_at) || "unknown-day";
  const [year = "0000", month = "00", date = "00"] = day.split("-");
  const firstStamp = sanitizeKeySegment(first?.created_at || "start");
  const lastStamp = sanitizeKeySegment(last?.created_at || "end");
  const firstId = sanitizeKeySegment(first?.id || "first");
  const lastId = sanitizeKeySegment(last?.id || "last");
  return `${config.keyPrefix}/${year}/${month}/${date}/${firstStamp}--${lastStamp}--${firstId}--${lastId}.jsonl`;
}

function buildArchiveBody(config, rows, archivedAt) {
  return rows
    .map((row) =>
      JSON.stringify({
        archive_schema: ACTIVITY_ARCHIVE_SCHEMA_VERSION,
        table: config.table,
        archived_at: archivedAt,
        ...row,
      })
    )
    .join("\n");
}

function ensureArchiveBucket(env) {
  const bucket = env?.AUDIT_ARCHIVE;
  if (!bucket || typeof bucket.put !== "function") {
    throw new Error("AUDIT_ARCHIVE binding is unavailable.");
  }
  return bucket;
}

async function listArchiveCandidates(env, config, cutoffIso) {
  const result = await env.DB.prepare(config.selectSql)
    .bind(cutoffIso, ACTIVITY_ARCHIVE_MAX_ROWS_PER_CHUNK)
    .all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) return [];
  const firstDay = toArchiveDay(rows[0]?.created_at);
  if (!firstDay) return [];
  return rows.filter((row) => toArchiveDay(row?.created_at) === firstDay);
}

async function pruneArchivedRows(env, config, rows) {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (ids.length === 0) {
    return { changes: 0 };
  }
  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`${config.deleteSqlPrefix}${placeholders})`)
    .bind(...ids)
    .run();
  await env.DB.prepare(
    `DELETE FROM activity_search_index
     WHERE source_table = ?
       AND source_event_id IN (${placeholders})`
  )
    .bind(config.table, ...ids)
    .run();
  return result?.meta || { changes: 0 };
}

async function archiveTableChunk(env, config, cutoffIso) {
  const bucket = ensureArchiveBucket(env);
  const rows = await listArchiveCandidates(env, config, cutoffIso);
  if (rows.length === 0) return null;

  const startedAt = Date.now();
  const archivedAt = new Date().toISOString();
  const archiveKey = buildArchiveKey(config, rows);
  const archiveBody = buildArchiveBody(config, rows, archivedAt);

  await bucket.put(archiveKey, archiveBody, {
    httpMetadata: {
      contentType: AUDIT_ARCHIVE_CONTENT_TYPE,
    },
  });

  const pruneMeta = await pruneArchivedRows(env, config, rows);
  const prunedCount = Number(pruneMeta?.changes) || 0;

  logDiagnostic({
    service: "bitbi-auth",
    component: "scheduled-activity-archive",
    event: "activity_archive_chunk_completed",
    level: prunedCount === rows.length ? "info" : "warn",
    table: config.table,
    archive_key: archiveKey,
    archive_day: toArchiveDay(rows[0]?.created_at),
    row_count: rows.length,
    pruned_count: prunedCount,
    oldest_created_at: rows[0]?.created_at || null,
    newest_created_at: rows[rows.length - 1]?.created_at || null,
    duration_ms: getDurationMs(startedAt),
  });

  return {
    table: config.table,
    archiveKey,
    rowCount: rows.length,
    prunedCount,
  };
}

export function getActivityRetentionCutoff(referenceIso) {
  return subtractDaysIso(referenceIso || new Date().toISOString(), ACTIVITY_HOT_RETENTION_DAYS);
}

export function getActivityRetentionMetadata(referenceIso) {
  return {
    retentionCutoff: getActivityRetentionCutoff(referenceIso),
    retentionDays: ACTIVITY_HOT_RETENTION_DAYS,
  };
}

export async function archiveColdActivityLogs(env, { nowIso }) {
  const cutoffIso = getActivityRetentionCutoff(nowIso);
  const production = isProductionEnvironment(env);
  const summary = {
    archivedTables: [],
    archiveKeys: [],
    archivedRowCount: 0,
    prunedRowCount: 0,
  };

  for (const config of ACTIVITY_ARCHIVE_TABLES) {
    for (let index = 0; index < ACTIVITY_ARCHIVE_MAX_CHUNKS_PER_TABLE; index += 1) {
      try {
        const archived = await archiveTableChunk(env, config, cutoffIso);
        if (!archived) break;
        summary.archivedTables.push(config.table);
        summary.archiveKeys.push(archived.archiveKey);
        summary.archivedRowCount += archived.rowCount;
        summary.prunedRowCount += archived.prunedCount;
      } catch (error) {
        const message = String(error?.message || "");
        if (message.includes("no such table") && !production) {
          logDiagnostic({
            service: "bitbi-auth",
            component: "scheduled-activity-archive",
            event: "activity_archive_table_unavailable",
            level: "warn",
            table: config.table,
            ...getErrorFields(error),
          });
          break;
        }
        logDiagnostic({
          service: "bitbi-auth",
          component: "scheduled-activity-archive",
          event: "activity_archive_chunk_failed",
          level: "error",
          table: config.table,
          ...getErrorFields(error),
        });
        throw error;
      }
    }
  }

  return summary;
}
