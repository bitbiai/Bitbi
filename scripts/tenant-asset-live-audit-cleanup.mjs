#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DB_NAME = "bitbi-auth-db";
const AUTH_WRANGLER_CONFIG = "workers/auth/wrangler.jsonc";
const CONFIRMATION_PHRASE = "DELETE ONLY UNASSIGNABLE TENANT ASSET LEGACY DATA";
const REPORT_DIR = "docs/audits/tenant-asset-center-live-cleanup";
const MAX_REF_ROWS_PER_COLUMN = 20000;
const DEFAULT_R2_CHECK_LIMIT = 60;
const PRIOR_TEST_EMAILS = Object.freeze(["ziegenbart@bk.ru", "sanctum@kiandex.com"]);
const PRIOR_TEST_USER_IDS = Object.freeze([
  "86f0add4-8dbc-46a5-ac5d-0a3d8cf6ae2b",
  "a0449616-f654-413f-83e0-0f401fd1ec2c",
]);

const R2_BUCKETS = Object.freeze({
  USER_IMAGES: { binding: "USER_IMAGES", bucketName: "bitbi-user-images" },
  PRIVATE_MEDIA: { binding: "PRIVATE_MEDIA", bucketName: "bitbi-private-media" },
  AUDIT_ARCHIVE: { binding: "AUDIT_ARCHIVE", bucketName: "bitbi-audit-archive" },
  PUBLIC_MEDIA: { binding: "PUBLIC_MEDIA", bucketName: "bitbi-public-media", repoBound: false },
});

const SKIP_TABLES = new Set(["sqlite_sequence", "_cf_KV"]);
const SENSITIVE_COLUMN_RE = /token|secret|password|cookie|signature|raw|body|payload(?!_summary)|authorization|session|mfa|recovery|hash/i;
const EMAIL_COLUMN_RE = /(^|_)email$/i;
const USER_REF_COLUMN_RE = /(^|_)user_id$|^admin_user_id$|^target_user_id$|^actor_user_id$|^author_user_id$|^subject_user_id$|^requested_by_admin_id$|^approved_by_admin_id$|^closed_by_user_id$|^closed_by_admin_id$|^completed_by_user_id$|^completed_by_admin_id$|^rejected_by_admin_id$|^uploaded_by_user_id$|^updated_by_user_id$|^source_user_id$|^archived_by_user_id$|^restored_by_user_id$|^purged_by_user_id$|^created_by_user_id$|^owning_user_id$/i;
const OWNER_REF_COLUMN_RE = /user_id$|created_by_user_id$|owning_user_id$|subject_user_id$|source_user_id$|uploaded_by_user_id$|updated_by_user_id$/i;
const R2_KEY_COLUMN_RE = /(^r2_key$|_r2_key$|^thumb_key$|^medium_key$|^poster_key$|^poster_r2_key$|^output_r2_key$|^file_r2_key$|^source_r2_key$|^visual_object_key$|^storage_key$|^object_key$|^archive_key$|^export_key$)/i;
const SIZE_COLUMN_RE = /(^|_)size_bytes$|^original_size_bytes$|^poster_size_bytes$|^output_size_bytes$/i;
const STATUS_COLUMN_RE = /status|state|visibility|source_module|published_at|created_at|updated_at|deleted_at|expires_at/i;
const USER_REFERENCE_INTEGRITY_TABLES = new Set([
  "ai_folders",
  "ai_images",
  "ai_text_assets",
  "ai_video_jobs",
  "profiles",
  "favorites",
  "public_media_comments",
  "public_media_likes",
  "profile_follows",
  "user_asset_storage_usage",
  "data_lifecycle_requests",
  "data_lifecycle_request_items",
  "data_export_archives",
  "homepage_hero_video_uploads",
  "homepage_hero_video_derivatives",
  "memvid_stream_previews",
  "member_ai_usage_attempts",
  "ai_usage_attempts",
  "admin_ai_usage_attempts",
  "news_pulse_items",
  "r2_cleanup_queue",
  "ai_asset_manual_review_items",
  "tenant_asset_media_reset_actions",
]);

function usage() {
  return `Usage:
  node scripts/tenant-asset-live-audit-cleanup.mjs [--dry-run]
  node scripts/tenant-asset-live-audit-cleanup.mjs --execute --confirm "${CONFIRMATION_PHRASE}"

Options:
  --evidence-dir <path>          Local raw evidence directory. Defaults under .local/operator-evidence/.
  --protected-allowlist <path>   Existing protected allowlist JSON. If omitted, one is created from live users.
  --execute                      Execute safe cleanup only if every gate passes. Dry-run is default.
  --dry-run                      Inventory and plan only.
  --confirm <phrase>             Required for --execute. Exact phrase: ${CONFIRMATION_PHRASE}
  --remote                       Use remote Cloudflare D1/R2. Default: true.
  --skip-r2-existence-check      Do not read D1-referenced R2 objects to /dev/null.
  --r2-check-limit <n>           Max D1-referenced R2 keys to existence-check. Default ${DEFAULT_R2_CHECK_LIMIT}.
  --limit <n>                    Max rows per r2-key column inventory. Default ${MAX_REF_ROWS_PER_COLUMN}.
  --batch-size <n>               Cleanup batch size placeholder for future execution. Default 50.
  --backup-r2-candidates <bool>  Require R2 backup before execute. Default true.
  --json-report                  Print compact JSON summary to stdout.

The script writes raw evidence only to .local/ and redacted summaries to ${REPORT_DIR}/. It never deletes protected-account data.`;
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseArgs(argv) {
  const options = {
    evidenceDir: null,
    protectedAllowlistPath: null,
    execute: false,
    confirm: "",
    remote: true,
    skipR2ExistenceCheck: false,
    r2CheckLimit: DEFAULT_R2_CHECK_LIMIT,
    limit: MAX_REF_ROWS_PER_COLUMN,
    batchSize: 50,
    backupR2Candidates: true,
    jsonReport: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.execute = false;
    else if (arg === "--execute") options.execute = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--skip-r2-existence-check") options.skipR2ExistenceCheck = true;
    else if (arg === "--json-report") options.jsonReport = true;
    else if (arg === "--evidence-dir") options.evidenceDir = argv[++index];
    else if (arg === "--protected-allowlist") options.protectedAllowlistPath = argv[++index];
    else if (arg === "--confirm") options.confirm = argv[++index] || "";
    else if (arg === "--backup-r2-candidates") options.backupR2Candidates = parseBoolean(argv[++index], true);
    else if (arg === "--r2-check-limit") options.r2CheckLimit = parseNonNegativeInteger(argv[++index], "--r2-check-limit");
    else if (arg === "--limit") options.limit = parseNonNegativeInteger(argv[++index], "--limit");
    else if (arg === "--batch-size") options.batchSize = parseNonNegativeInteger(argv[++index], "--batch-size");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.execute && options.confirm !== CONFIRMATION_PHRASE) {
    throw new Error(`--execute requires --confirm "${CONFIRMATION_PHRASE}"`);
  }
  if (options.r2CheckLimit > 2000) throw new Error("--r2-check-limit is capped at 2000 for operator safety.");
  if (options.limit > 100000) throw new Error("--limit is capped at 100000 for operator safety.");
  if (options.batchSize > 500) throw new Error("--batch-size is capped at 500 for operator safety.");
  return options;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer.`);
  return parsed;
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function shortId(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function redactEmail(value) {
  const text = String(value || "");
  const [local, domain] = text.split("@");
  if (!local || !domain) return text ? `[email:${sha256Hex(text).slice(0, 10)}]` : "";
  return `${local.slice(0, 2)}***@${domain}`;
}

function redactedKey(key) {
  const text = String(key || "");
  if (!text) return "";
  const parts = text.split("/");
  if (parts.length <= 2) return shortId(text);
  return `${parts[0]}/${parts[1]}/.../${shortId(parts.at(-1))}`;
}

function redactValue(key, value) {
  if (value == null) return value;
  if (EMAIL_COLUMN_RE.test(key)) return redactEmail(value);
  if (R2_KEY_COLUMN_RE.test(key)) return redactedKey(value);
  if (SENSITIVE_COLUMN_RE.test(key)) return `[redacted:${sha256Hex(value).slice(0, 12)}]`;
  return value;
}

function redactRow(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, redactValue(key, value)]));
}

function quoteSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdent(value) {
  const text = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) throw new Error(`Unsafe SQL identifier: ${text}`);
  return `"${text}"`;
}

function commandLog(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function run(command, args, { cwd = process.cwd(), allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const message = [
      `Command failed (${result.status}): ${commandLog(command, args)}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join("\n");
    throw new Error(message);
  }
  return result;
}

function parseWranglerJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return [];
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start));
}

function wranglerArgs(base) {
  return ["wrangler", ...base, "--config", AUTH_WRANGLER_CONFIG];
}

function d1ModeArgs(options) {
  return options.remote ? ["--remote"] : ["--local"];
}

function queryD1(sql, options) {
  const result = run("npx", wranglerArgs([
    "d1",
    "execute",
    DB_NAME,
    ...d1ModeArgs(options),
    "--command",
    sql,
    "--json",
  ]));
  const payload = parseWranglerJson(result.stdout);
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first?.success) throw new Error(`D1 query failed: ${sql.slice(0, 240)}`);
  return first.results || [];
}

function exportD1(outputPath, options) {
  return run("npx", wranglerArgs([
    "d1",
    "export",
    DB_NAME,
    ...d1ModeArgs(options),
    "--output",
    outputPath,
    "--skip-confirmation",
  ]), { allowFailure: true });
}

function r2ObjectPath(bucketName, key) {
  return `${bucketName}/${key}`;
}

function checkR2Object(bucketName, key) {
  const result = run("npx", wranglerArgs([
    "r2",
    "object",
    "get",
    r2ObjectPath(bucketName, key),
    "--remote",
    "--file",
    process.platform === "win32" ? "NUL" : "/dev/null",
  ]), { allowFailure: true });
  return {
    exists: result.status === 0,
    status: result.status,
    stderr: result.stderr?.trim() || "",
  };
}

function listR2Buckets() {
  const result = run("npx", wranglerArgs(["r2", "bucket", "list"]), { allowFailure: true });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    buckets: Array.from(String(result.stdout || "").matchAll(/^name:\s+(.+)$/gm)).map((match) => match[1].trim()),
  };
}

function localR2CredentialStatus() {
  const names = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CF_ACCOUNT_ID",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "CLOUDFLARE_API_TOKEN",
  ];
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function loadReleaseLatest() {
  const release = JSON.parse(fs.readFileSync("config/release-compat.json", "utf8"));
  return release?.release?.schemaCheckpoints?.auth?.latest || "unknown";
}

function loadWranglerR2Bindings() {
  const text = fs.readFileSync(AUTH_WRANGLER_CONFIG, "utf8");
  const withoutComments = text.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(withoutComments);
  return (parsed.r2_buckets || []).map((entry) => ({
    binding: entry.binding,
    bucketName: entry.bucket_name,
    remote: entry.remote === true,
  }));
}

function columnNames(columns) {
  return columns.map((column) => column.name);
}

function hasColumn(columns, column) {
  return columnNames(columns).includes(column);
}

function buildSelectColumns(columns) {
  const names = columnNames(columns);
  const wanted = [
    "id",
    "user_id",
    "owner_user_id",
    "owning_user_id",
    "created_by_user_id",
    "subject_user_id",
    "source_user_id",
    "uploaded_by_user_id",
    "updated_by_user_id",
    "folder_id",
    "asset_id",
    "image_id",
    "job_id",
    "media_id",
    "source_module",
    "visibility",
    "status",
    "state",
    "created_at",
    "updated_at",
    "published_at",
    "expires_at",
    "size_bytes",
    "poster_size_bytes",
    "output_size_bytes",
    "original_size_bytes",
  ].filter((name) => names.includes(name));
  return Array.from(new Set(wanted));
}

function inferBucket({ table, column, row }) {
  if (hasOwn(row, "r2_bucket") && row.r2_bucket) {
    const raw = String(row.r2_bucket).trim();
    if (R2_BUCKETS[raw]) return raw;
    const byBucketName = Object.entries(R2_BUCKETS).find(([, entry]) => entry.bucketName === raw);
    if (byBucketName) return byBucketName[0];
  }
  if (table === "profiles" || String(column).includes("avatar")) return "PRIVATE_MEDIA";
  if (table.includes("data_export") || table.includes("audit") || String(column).includes("archive") || String(column).includes("storage_key")) return "AUDIT_ARCHIVE";
  return "USER_IMAGES";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function ownerIdsFromRow(row = {}) {
  const ids = [];
  for (const [key, value] of Object.entries(row)) {
    if (OWNER_REF_COLUMN_RE.test(key) && value) ids.push(String(value));
  }
  return Array.from(new Set(ids));
}

function classifyReference(ref, { protectedUserIds, allUserIds, deletedUserIds }) {
  const owners = ownerIdsFromRow(ref.row || {});
  const key = String(ref.key || "");
  if (ref.table === "news_pulse_items") return "news_pulse_asset";
  if (ref.table === "homepage_hero_video_derivatives" || ref.table === "homepage_hero_video_uploads") {
    return owners.some((id) => protectedUserIds.has(id))
      ? "protected_homepage_hero_asset_or_derivative"
      : "platform_admin_generated_asset";
  }
  if (ref.table === "platform_budget_evidence_archives") return "audit_evidence_archive";
  if (owners.some((id) => protectedUserIds.has(id))) {
    if (ref.bucket === "PRIVATE_MEDIA") return "protected_user_avatar";
    if (["thumb_key", "medium_key"].includes(ref.column)) return "protected_user_derivative";
    if (ref.column === "poster_r2_key") return "protected_user_poster";
    return "protected_user_source_asset";
  }
  if (PRIOR_TEST_USER_IDS.some((id) => key.includes(id) || owners.includes(id))) return "prior_test_account_residue_delete_candidate";
  if (owners.some((id) => deletedUserIds.has(id))) return "d1_deleted_user_reference_blocker";
  if (owners.length && owners.every((id) => !allUserIds.has(id))) return "d1_orphan_delete_candidate";
  if (ref.bucket === "AUDIT_ARCHIVE") return "audit_or_legal_retention_keep";
  if (ref.table === "r2_cleanup_queue") return "ai_usage_temp_or_replay_current";
  if (!owners.length) return "unknown_blocker_keep";
  return "current_and_valid";
}

async function loadSchema(options) {
  const sqliteRows = queryD1(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    options
  );
  const tables = sqliteRows.filter((row) => row.type === "table" && !SKIP_TABLES.has(row.name)).map((row) => row.name);
  const schema = { sqliteMaster: sqliteRows, tables: {} };
  for (const table of tables) {
    schema.tables[table] = {
      columns: queryD1(`PRAGMA table_info(${quoteIdent(table)})`, options),
      indexes: queryD1(`PRAGMA index_list(${quoteIdent(table)})`, options),
      foreignKeys: queryD1(`PRAGMA foreign_key_list(${quoteIdent(table)})`, options),
      sql: sqliteRows.find((row) => row.type === "table" && row.name === table)?.sql || "",
    };
  }
  return schema;
}

function identifySchemaColumns(schema) {
  const result = [];
  for (const [table, info] of Object.entries(schema.tables)) {
    const columns = info.columns || [];
    const r2Columns = columns.filter((column) => R2_KEY_COLUMN_RE.test(column.name)).map((column) => column.name);
    const userColumns = columns.filter((column) => USER_REF_COLUMN_RE.test(column.name)).map((column) => column.name);
    const emailColumns = columns.filter((column) => EMAIL_COLUMN_RE.test(column.name)).map((column) => column.name);
    const sizeColumns = columns.filter((column) => SIZE_COLUMN_RE.test(column.name)).map((column) => column.name);
    const statusColumns = columns.filter((column) => STATUS_COLUMN_RE.test(column.name)).map((column) => column.name);
    if (r2Columns.length || userColumns.length || emailColumns.length || sizeColumns.length || statusColumns.length) {
      result.push({ table, r2Columns, userColumns, emailColumns, sizeColumns, statusColumns });
    }
  }
  return result;
}

async function collectRowCounts(schema, options) {
  const counts = {};
  const tables = Object.keys(schema.tables);
  for (let index = 0; index < tables.length; index += 40) {
    const chunk = tables.slice(index, index + 40);
    try {
      const rows = queryD1(
        chunk.map((table) => `SELECT ${quoteSql(table)} AS table_name, COUNT(*) AS count FROM ${quoteIdent(table)}`).join(" UNION ALL "),
        options
      );
      for (const row of rows) counts[row.table_name] = Number(row.count || 0);
    } catch (error) {
      for (const table of chunk) counts[table] = { error: String(error?.message || error).slice(0, 200) };
    }
  }
  return counts;
}

function collectRowCountsFromExport(schema, exportPath) {
  const counts = Object.fromEntries(Object.keys(schema.tables).map((table) => [table, 0]));
  if (!exportPath || !fs.existsSync(exportPath)) return counts;
  const text = fs.readFileSync(exportPath, "utf8");
  const insertRe = /^INSERT INTO "([^"]+)"/gm;
  let match;
  while ((match = insertRe.exec(text))) {
    const table = match[1];
    if (Object.prototype.hasOwnProperty.call(counts, table)) counts[table] += 1;
  }
  return counts;
}

async function collectUsers(options) {
  const rows = queryD1(
    `SELECT users.id,
            users.email,
            users.role,
            users.status,
            users.created_at,
            profiles.display_name,
            profiles.has_avatar,
            profiles.avatar_updated_at
     FROM users
     LEFT JOIN profiles ON profiles.user_id = users.id
     ORDER BY lower(users.email)`,
    options
  );
  const active = rows.filter((row) => String(row.status || "").toLowerCase() !== "deleted");
  const deleted = rows.filter((row) => String(row.status || "").toLowerCase() === "deleted");
  const priorTestRows = queryD1(
    `SELECT id, email, role, status FROM users WHERE lower(email) IN (${PRIOR_TEST_EMAILS.map(quoteSql).join(",")}) ORDER BY lower(email)`,
    options
  );
  return { rows, active, deleted, priorTestRows };
}

function buildProtectedAllowlist(users, evidenceDir, suppliedPath = null) {
  if (suppliedPath) {
    const allowlist = JSON.parse(fs.readFileSync(suppliedPath, "utf8"));
    return {
      source: suppliedPath,
      allowlist,
    };
  }
  const allowlist = {
    generatedAt: new Date().toISOString(),
    source: "live_d1_users_profiles",
    protectedUsers: users.active.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      displayName: row.display_name || null,
      hasAvatar: Number(row.has_avatar) === 1,
      avatarUpdatedAt: row.avatar_updated_at || null,
    })),
  };
  const filePath = path.join(evidenceDir, "protected-allowlist.json");
  writeJson(filePath, allowlist);
  return { source: filePath, allowlist };
}

async function collectUserReferenceIntegrity(schema, users, options) {
  const userIds = new Set(users.rows.map((row) => row.id));
  const deletedUserIds = new Set(users.deleted.map((row) => row.id));
  const checks = [];
  for (const [table, info] of Object.entries(schema.tables)) {
    if (!USER_REFERENCE_INTEGRITY_TABLES.has(table)) continue;
    for (const column of (info.columns || []).map((entry) => entry.name).filter((name) => USER_REF_COLUMN_RE.test(name))) {
      try {
        const rows = queryD1(
          `SELECT ${quoteIdent(column)} AS value, COUNT(*) AS count
           FROM ${quoteIdent(table)}
           WHERE ${quoteIdent(column)} IS NOT NULL AND ${quoteIdent(column)} != ''
           GROUP BY ${quoteIdent(column)}
           ORDER BY count DESC
           LIMIT 500`,
          options
        );
        const missing = rows.filter((row) => !userIds.has(row.value));
        const deleted = rows.filter((row) => deletedUserIds.has(row.value));
        const priorTest = rows.filter((row) => PRIOR_TEST_USER_IDS.includes(row.value));
        checks.push({
          table,
          column,
          distinctReferencedUsers: rows.length,
          totalRows: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
          missingCount: missing.reduce((sum, row) => sum + Number(row.count || 0), 0),
          deletedUserReferenceCount: deleted.reduce((sum, row) => sum + Number(row.count || 0), 0),
          priorTestReferenceCount: priorTest.reduce((sum, row) => sum + Number(row.count || 0), 0),
          missingValues: missing.slice(0, 20).map((row) => ({ userId: shortId(row.value), count: Number(row.count || 0) })),
        });
      } catch (error) {
        checks.push({ table, column, error: String(error?.message || error).slice(0, 200) });
      }
    }
  }
  return checks;
}

async function collectR2References(schema, options) {
  const refs = [];
  for (const [table, info] of Object.entries(schema.tables)) {
    const columns = info.columns || [];
    const columnNamesSet = new Set(columnNames(columns));
    const r2Columns = columns.filter((column) => R2_KEY_COLUMN_RE.test(column.name)).map((column) => column.name);
    if (!r2Columns.length) continue;
    const baseColumns = buildSelectColumns(columns);
    if (columnNamesSet.has("r2_bucket") && !baseColumns.includes("r2_bucket")) baseColumns.push("r2_bucket");
    const selectColumns = Array.from(new Set([...baseColumns, ...r2Columns]));
    const whereClause = r2Columns.map((column) => `(${quoteIdent(column)} IS NOT NULL AND ${quoteIdent(column)} != '')`).join(" OR ");
    try {
      const rows = queryD1(
        `SELECT ${selectColumns.map(quoteIdent).join(", ")}
         FROM ${quoteIdent(table)}
         WHERE ${whereClause}
         LIMIT ${Math.max(1, Math.min(options.limit, MAX_REF_ROWS_PER_COLUMN))}`,
        options
      );
      for (const row of rows) {
        for (const column of r2Columns) {
          const key = row[column];
          if (!key) continue;
          refs.push({
            table,
            column,
            key,
            bucket: inferBucket({ table, column, row }),
            row,
          });
        }
      }
    } catch (error) {
      for (const column of r2Columns) {
        refs.push({ table, column, key: null, bucket: null, row: {}, error: String(error?.message || error).slice(0, 200) });
      }
    }
  }
  if (schema.tables.profiles) {
    const profileColumns = schema.tables.profiles.columns || [];
    if (hasColumn(profileColumns, "has_avatar") && hasColumn(profileColumns, "user_id")) {
      const rows = queryD1(
        "SELECT user_id, display_name, has_avatar, avatar_updated_at FROM profiles WHERE COALESCE(has_avatar, 0) = 1 LIMIT 10000",
        options
      );
      for (const row of rows) {
        refs.push({
          table: "profiles",
          column: "avatar_r2_key_implied",
          key: `avatars/${row.user_id}`,
          bucket: "PRIVATE_MEDIA",
          row,
          implied: true,
        });
      }
    }
  }
  return refs;
}

function dedupeR2Refs(refs) {
  const map = new Map();
  for (const ref of refs) {
    if (!ref?.bucket || !ref?.key) continue;
    const id = `${ref.bucket}:${ref.key}`;
    const existing = map.get(id);
    if (existing) {
      existing.references.push({ table: ref.table, column: ref.column, rowId: ref.row?.id || ref.row?.user_id || null });
      existing.referenceCount += 1;
      existing.categories = Array.from(new Set([...existing.categories, ref.category].filter(Boolean)));
      continue;
    }
    map.set(id, {
      bucket: ref.bucket,
      key: ref.key,
      references: [{ table: ref.table, column: ref.column, rowId: ref.row?.id || ref.row?.user_id || null }],
      referenceCount: 1,
      categories: [ref.category].filter(Boolean),
    });
  }
  return Array.from(map.values());
}

function summarizeBy(items, keySelector) {
  const counts = {};
  for (const item of items || []) {
    const key = keySelector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function r2BucketName(bucketId) {
  return R2_BUCKETS[bucketId]?.bucketName || bucketId;
}

function verifyR2References(refs, options) {
  if (options.skipR2ExistenceCheck) {
    return {
      skipped: true,
      reason: "operator_requested_skip",
      checked: [],
      missing: [],
    };
  }
  const unique = dedupeR2Refs(refs).slice(0, options.r2CheckLimit);
  const checked = [];
  for (const ref of unique) {
    const bucketName = r2BucketName(ref.bucket);
    if (!bucketName || ref.bucket === "PUBLIC_MEDIA") {
      checked.push({ ...ref, checked: false, exists: null, reason: "bucket_unavailable_from_repo_binding" });
      continue;
    }
    const result = checkR2Object(bucketName, ref.key);
    checked.push({
      ...ref,
      keyHash: sha256Hex(ref.key),
      keyRedacted: redactedKey(ref.key),
      checked: true,
      exists: result.exists,
      status: result.status,
      errorClass: result.exists ? null : String(result.stderr || "").slice(0, 180),
    });
  }
  return {
    skipped: false,
    checked,
    missing: checked.filter((item) => item.checked && item.exists === false),
    uncheckedRemaining: Math.max(0, dedupeR2Refs(refs).length - unique.length),
  };
}

async function collectStorageAccounting(schema, users, options) {
  const protectedIds = users.active.map((row) => row.id);
  const result = {
    perProtectedUser: [],
    tableAvailable: Boolean(schema.tables.user_asset_storage_usage),
  };
  for (const userId of protectedIds) {
    const image = schema.tables.ai_images
      ? queryD1(
        `SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS bytes
         FROM ai_images WHERE user_id = ${quoteSql(userId)}`,
        options
      )[0]
      : { count: 0, bytes: 0 };
    const text = schema.tables.ai_text_assets
      ? queryD1(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(COALESCE(size_bytes, 0) + COALESCE(poster_size_bytes, 0)), 0) AS bytes
         FROM ai_text_assets WHERE user_id = ${quoteSql(userId)}`,
        options
      )[0]
      : { count: 0, bytes: 0 };
    const stored = schema.tables.user_asset_storage_usage
      ? queryD1(
        `SELECT used_bytes, updated_at FROM user_asset_storage_usage WHERE user_id = ${quoteSql(userId)} LIMIT 1`,
        options
      )[0] || null
      : null;
    result.perProtectedUser.push({
      userId,
      imageCount: Number(image.count || 0),
      imageBytes: Number(image.bytes || 0),
      textAssetCount: Number(text.count || 0),
      textAssetBytes: Number(text.bytes || 0),
      knownD1Bytes: Number(image.bytes || 0) + Number(text.bytes || 0),
      recordedUsageBytes: stored ? Number(stored.used_bytes || 0) : null,
      recordedUsageUpdatedAt: stored?.updated_at || null,
      deltaBytes: stored ? Number(stored.used_bytes || 0) - (Number(image.bytes || 0) + Number(text.bytes || 0)) : null,
    });
  }
  return result;
}

async function collectPublicMediaSummary(schema, options) {
  const summary = {};
  if (schema.tables.ai_images) {
    summary.mempics = queryD1(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN thumb_key IS NULL OR medium_key IS NULL THEN 1 ELSE 0 END) AS missing_derivatives FROM ai_images WHERE visibility = 'public'",
      options
    )[0] || { total: 0, missing_derivatives: 0 };
  }
  if (schema.tables.ai_text_assets) {
    summary.memvids = queryD1(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN poster_r2_key IS NULL THEN 1 ELSE 0 END) AS missing_posters FROM ai_text_assets WHERE visibility = 'public' AND source_module = 'video'",
      options
    )[0] || { total: 0, missing_posters: 0 };
    summary.memtracks = queryD1(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN poster_r2_key IS NULL THEN 1 ELSE 0 END) AS missing_posters FROM ai_text_assets WHERE visibility = 'public' AND source_module = 'music'",
      options
    )[0] || { total: 0, missing_posters: 0 };
  }
  if (schema.tables.public_media_comments) {
    summary.comments = queryD1("SELECT COUNT(*) AS total FROM public_media_comments", options)[0] || { total: 0 };
  }
  if (schema.tables.public_media_likes) {
    summary.likes = queryD1("SELECT COUNT(*) AS total FROM public_media_likes", options)[0] || { total: 0 };
  }
  if (schema.tables.profile_follows) {
    summary.follows = queryD1("SELECT COUNT(*) AS total FROM profile_follows", options)[0] || { total: 0 };
  }
  return summary;
}

function buildDeletePlan(classifiedRefs, relationship, gates) {
  const candidates = classifiedRefs.filter((ref) => [
    "legacy_unassignable_delete_candidate",
    "orphaned_r2_delete_candidate",
    "d1_orphan_delete_candidate",
    "prior_test_account_residue_delete_candidate",
  ].includes(ref.category));
  const blocked = classifiedRefs.filter((ref) => [
    "unknown_blocker_keep",
    "d1_deleted_user_reference_blocker",
  ].includes(ref.category));
  const plan = {
    dryRun: true,
    executeEligible: false,
    reason: "execution_blocked_until_full_r2_inventory_and_candidate_backup_are_available",
    d1MutationsPlanned: [],
    r2BackupPlanned: [],
    r2DeleteCandidates: candidates.map((ref) => ({
      bucket: ref.bucket,
      keyHash: sha256Hex(ref.key || ""),
      keyRedacted: redactedKey(ref.key || ""),
      category: ref.category,
      table: ref.table,
      column: ref.column,
    })),
    blockedCandidates: blocked.map((ref) => ({
      bucket: ref.bucket,
      keyHash: ref.key ? sha256Hex(ref.key) : null,
      keyRedacted: redactedKey(ref.key || ""),
      category: ref.category,
      table: ref.table,
      column: ref.column,
      reason: ref.category === "unknown_blocker_keep"
        ? "owner/source cannot be proven from current D1 evidence"
        : "references an existing deleted/anonymized user row and needs retention review",
    })),
    gates,
    relationshipSummary: {
      r2ReferencedObjects: relationship.uniqueR2ReferenceCount,
      missingCheckedObjects: relationship.r2Verification?.missing?.length || 0,
      uncheckedRemaining: relationship.r2Verification?.uncheckedRemaining || 0,
    },
  };
  return plan;
}

function markdownTable(headers, rows) {
  const safeRows = rows.length ? rows : [headers.map(() => "-")];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...safeRows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\n/g, " ")).join(" | ")} |`),
  ].join("\n");
}

function renderD1InventoryReport(context) {
  const topTables = Object.entries(context.rowCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 25)
    .map(([table, count]) => [table, typeof count === "object" ? "error" : count]);
  const users = context.users.rows.map((row) => [
    shortId(row.id),
    redactEmail(row.email),
    row.role,
    row.status,
    row.display_name || "-",
    Number(row.has_avatar) === 1 ? "yes" : "no",
  ]);
  return `# D1 Inventory Report

Generated: ${context.generatedAt}

## Scope

- Remote D1 database: \`${DB_NAME}\`
- Latest auth migration in release contract: \`${context.releaseLatest}\`
- Mutation mode: dry-run inventory only
- Exact prior test emails checked: ${PRIOR_TEST_EMAILS.map((email) => `\`${redactEmail(email)}\``).join(", ")}

## Users / Profiles

${markdownTable(["User", "Email", "Role", "Status", "Display", "Avatar"], users)}

Active/non-deleted protected accounts found: **${context.users.active.length}**.
Deleted/anonymized user rows retained in D1: **${context.users.deleted.length}**.
Exact prior test email rows currently present: **${context.users.priorTestRows.length}**.

## Row Counts

Tables discovered: **${Object.keys(context.schema.tables).length}**.

${markdownTable(["Table", "Rows"], topTables)}

Raw schema, row counts, and user/profile rows are stored only under \`${context.evidenceDir}\`.
`;
}

function renderSchemaIndexReport(context) {
  const rows = context.schemaColumns.map((entry) => [
    entry.table,
    entry.userColumns.join(", ") || "-",
    entry.r2Columns.join(", ") || "-",
    entry.emailColumns.join(", ") || "-",
    entry.sizeColumns.join(", ") || "-",
  ]);
  return `# D1 Schema And Index Report

Generated: ${context.generatedAt}

## Reference-Relevant Columns

${markdownTable(["Table", "User refs", "R2/object keys", "Emails", "Size fields"], rows)}

## Index Coverage Summary

${markdownTable(
    ["Table", "Indexes", "Foreign keys"],
    Object.entries(context.schema.tables).map(([table, info]) => [
      table,
      (info.indexes || []).map((index) => index.name).join(", ") || "-",
      (info.foreignKeys || []).length,
    ]).slice(0, 80)
  )}
`;
}

function renderR2InventoryReport(context) {
  const bindingRows = context.r2Bindings.map((entry) => [
    entry.binding,
    entry.bucketName,
    entry.remote ? "yes" : "no",
  ]);
  const liveRows = context.r2BucketList.buckets.map((bucket) => [
    bucket,
    Object.values(R2_BUCKETS).some((entry) => entry.bucketName === bucket && entry.repoBound !== false) ? "repo-bound" : "dashboard-visible / not bound",
  ]);
  const categoryRows = Object.entries(context.r2CategoryCounts).sort().map(([category, count]) => [category, count]);
  return `# R2 Inventory Report

Generated: ${context.generatedAt}

## Repo Bindings

${markdownTable(["Binding", "Bucket", "Remote"], bindingRows)}

## Live Buckets Visible To Wrangler

${markdownTable(["Bucket", "Repo status"], liveRows)}

\`bitbi-public-media\` is visible in the Cloudflare account when Wrangler lists buckets, but it is not declared as an Auth Worker R2 binding. It was not added by this audit.

## Full Bucket Listing Status

Full object enumeration through local credentials is **${context.fullR2ListingAvailable ? "available" : "not available"}**.

Credential presence check (values never printed): \`${JSON.stringify(context.r2CredentialStatus)}\`

Because the local environment has no R2 S3/API credentials and Wrangler exposes no object-list command, this run inventories D1-referenced keys plus bounded existence checks only. Destructive cleanup is blocked until full bucket listing evidence or an authenticated Admin R2 export is available.

## D1-Referenced R2 Categories

Unique D1-referenced R2 objects: **${context.uniqueR2ReferenceCount}**

${markdownTable(["Category", "References"], categoryRows)}

## Bounded R2 Existence Check

- Checked: ${context.r2Verification.checked?.filter((item) => item.checked).length || 0}
- Missing among checked: ${context.r2Verification.missing?.length || 0}
- Unchecked remaining due to limit: ${context.r2Verification.uncheckedRemaining || 0}
`;
}

function renderR2PrefixReport(context) {
  const prefixRows = Object.entries(context.r2PrefixCounts).sort((a, b) => b[1] - a[1]).map(([prefix, count]) => [prefix, count]);
  return `# R2 Prefix And Bucket Structure Report

Generated: ${context.generatedAt}

This report is built from D1-referenced keys only unless full bucket listing is available.

${markdownTable(["Prefix family", "D1 references"], prefixRows)}
`;
}

function renderRelationshipReport(context) {
  const rows = context.r2Verification.missing?.slice(0, 50).map((item) => [
    item.bucket,
    item.keyRedacted,
    item.references.map((ref) => `${ref.table}.${ref.column}`).join(", "),
    item.errorClass || "missing",
  ]) || [];
  return `# D1 / R2 / Website Relationship Matrix

Generated: ${context.generatedAt}

## Summary

- D1 R2-key references collected: ${context.r2Refs.length}
- Unique R2 objects referenced by D1: ${context.uniqueR2ReferenceCount}
- Protected-account references: ${context.r2Refs.filter((ref) => String(ref.category || "").startsWith("protected_")).length}
- Public media counts: \`${JSON.stringify(context.publicMediaSummary)}\`
- Missing checked objects: ${context.r2Verification.missing?.length || 0}

## Missing Checked Objects

${markdownTable(["Bucket", "Key", "Referenced by", "Evidence"], rows)}

Rows and object keys in raw form are stored only in local evidence.
`;
}

function renderBrokenMediaReport(context) {
  const missing = context.r2Verification.missing || [];
  const publicIssues = [];
  const publicSummary = context.publicMediaSummary || {};
  if (Number(publicSummary.mempics?.missing_derivatives || 0) > 0) publicIssues.push(["Mempics", publicSummary.mempics.missing_derivatives, "public image derivative missing in D1 fields"]);
  if (Number(publicSummary.memvids?.missing_posters || 0) > 0) publicIssues.push(["Memvids", publicSummary.memvids.missing_posters, "public video poster field missing"]);
  if (Number(publicSummary.memtracks?.missing_posters || 0) > 0) publicIssues.push(["Memtracks", publicSummary.memtracks.missing_posters, "public audio poster field missing"]);
  return `# Broken Media And Derivative Report

Generated: ${context.generatedAt}

## D1 Field-Level Public Media Findings

${markdownTable(["Domain", "Count", "Finding"], publicIssues)}

## R2 Existence Findings

Checked D1-referenced R2 objects with missing result: **${missing.length}**.

${markdownTable(
    ["Bucket", "Key", "Category", "References"],
    missing.slice(0, 80).map((item) => [
      item.bucket,
      item.keyRedacted,
      (item.categories || []).join(", ") || "-",
      item.references.map((ref) => `${ref.table}.${ref.column}`).join(", "),
    ])
  )}
`;
}

function renderStorageReport(context) {
  const rows = context.storageAccounting.perProtectedUser.map((entry) => [
    shortId(entry.userId),
    entry.imageCount,
    entry.textAssetCount,
    entry.knownD1Bytes,
    entry.recordedUsageBytes ?? "not recorded",
    entry.deltaBytes ?? "-",
  ]);
  return `# Storage Accounting Reconciliation Report

Generated: ${context.generatedAt}

The report compares recorded \`user_asset_storage_usage\` bytes with current D1-known asset byte fields for the three protected accounts. It does not list full R2 buckets and does not mutate quota rows.

${markdownTable(["User", "Images", "Text/media", "Known D1 bytes", "Recorded bytes", "Delta"], rows)}
`;
}

function renderClassificationReport(context) {
  const rows = Object.entries(context.r2CategoryCounts).sort().map(([category, count]) => [category, count]);
  return `# Legacy Classification Report

Generated: ${context.generatedAt}

Classification is conservative. Legacy alone does not mean delete; unassignable proof is required.

${markdownTable(["Classification", "Reference count"], rows)}

## Current Safety Decision

Execution is blocked in this run because full R2 bucket enumeration is unavailable. D1-referenced protected data is kept. Unknown or deleted-user references are retained as blockers, not deleted.
`;
}

function renderDeleteCandidatesReport(context) {
  const candidates = context.cleanupPlan.r2DeleteCandidates || [];
  const blocked = context.cleanupPlan.blockedCandidates || [];
  const blockedCounts = summarizeBy(blocked, (item) => item.category);
  return `# Delete Candidates Report

Generated: ${context.generatedAt}

## Execution Decision

Cleanup execution eligible: **${context.cleanupPlan.executeEligible ? "yes" : "no"}**

Reason: ${context.cleanupPlan.reason}

## R2 Delete Candidates

${markdownTable(["Bucket", "Key", "Category", "D1 source"], candidates.map((item) => [
    item.bucket,
    item.keyRedacted,
    item.category,
    `${item.table}.${item.column}`,
  ]))}

## Blocked / Retained Candidates

Blocked/retained count: **${blocked.length}**

${markdownTable(["Category", "Count"], Object.entries(blockedCounts).sort().map(([category, count]) => [category, count]))}

### Sample Blocked / Retained Rows

${markdownTable(["Bucket", "Key", "Category", "Reason"], blocked.slice(0, 40).map((item) => [
    item.bucket,
    item.keyRedacted,
    item.category,
    item.reason,
  ]))}
`;
}

function renderKeepRepairReport(context) {
  const keepRows = Object.entries(context.r2CategoryCounts)
    .filter(([category]) => !category.includes("delete_candidate"))
    .sort()
    .map(([category, count]) => [category, count, category.startsWith("protected_") ? "keep protected account data" : "keep or review"]);
  return `# Keep And Repair Candidates Report

Generated: ${context.generatedAt}

${markdownTable(["Category", "Count", "Decision"], keepRows)}

No derivative repair or ownership backfill was executed by this package. Protected-account repair candidates, if any, must go through existing supported app paths and a separate explicit approval.
`;
}

function renderPostCleanupReport(context) {
  return `# Post-Cleanup Verification Report

Generated: ${context.generatedAt}

No cleanup mutation was executed in this run.

## Verification State

- Protected accounts still present in live D1 at inventory time: ${context.users.active.length}
- Exact prior test emails present: ${context.users.priorTestRows.length}
- D1 references to known prior test user IDs: ${context.userReferenceIntegrity.reduce((sum, item) => sum + Number(item.priorTestReferenceCount || 0), 0)}
- R2 deletion performed: 0
- D1 deletion/update performed: 0

Post-cleanup delta verification is not applicable because execution was blocked by incomplete full R2 inventory evidence.
`;
}

function renderProtectedReport(context) {
  const rows = context.users.active.map((row) => [
    shortId(row.id),
    redactEmail(row.email),
    row.role,
    row.status,
    row.display_name || "-",
  ]);
  return `# Protected Accounts Unchanged Report

Generated: ${context.generatedAt}

Protected allowlist source: \`${context.allowlistSource}\`

${markdownTable(["User", "Email", "Role", "Status", "Display"], rows)}

No D1 or R2 mutation was executed by this audit package, so protected accounts were not changed.
`;
}

function renderFinalSummary(context) {
  return `# Tenant Asset Center Live Cleanup Final Summary

Generated: ${context.generatedAt}

## Result

This run produced a live D1 inventory, D1-referenced R2 relationship inventory, bounded R2 existence checks, classifications, and a cleanup dry-run plan.

No cleanup was executed.

## Why Execution Was Blocked

Full R2 bucket enumeration is required before deleting unassignable legacy media. The local environment can list bucket names with Wrangler, but does not expose an R2 object-list/head command and has no S3/API credentials available. Therefore, unknown bucket objects cannot be proven safe or unsafe, and deletion is blocked.

## Counts

- D1 tables inventoried: ${Object.keys(context.schema.tables).length}
- D1 R2 references collected: ${context.r2Refs.length}
- Unique D1-referenced R2 objects: ${context.uniqueR2ReferenceCount}
- R2 objects checked by bounded get: ${context.r2Verification.checked?.filter((item) => item.checked).length || 0}
- Missing checked objects: ${context.r2Verification.missing?.length || 0}
- D1 mutations executed: 0
- R2 deletes executed: 0

## Next Safe Step

Provide full R2 inventory evidence through either:

1. temporary local S3-compatible R2 inventory credentials in environment variables only, or
2. an authenticated Admin R2 Drive export that lists every object in the bound buckets,

then re-run this package and execute only candidates that remain proven unassignable.
`;
}

function renderNecessityReview(context) {
  return `# Tenant Asset Center Necessity Review

Generated: ${context.generatedAt}

## Recommendation

Keep the Tenant Asset Center for now, but consider renaming or narrowing it to **Storage Health / Asset Integrity** after full R2 inventory evidence is available.

## Why It Is Still Useful

- It centralizes cross-domain ownership evidence and blocked reset/backfill state.
- It documents that tenant isolation, ownership backfill, access switch, and legacy reset remain evidence-gated.
- It complements Admin User Storage and R2 Drive: User Storage is selected-user operational management, R2 Drive is object-level management, and Tenant Asset Center is integrity/evidence classification.

## What Should Not Happen Yet

- Do not remove Tenant Asset Center routes/UI until a complete R2 inventory and post-cleanup baseline prove that legacy/manual-review/reset evidence is obsolete.
- Do not turn current backfill/access-switch/reset controls into active mutation shortcuts.
- Do not claim tenant isolation readiness from this audit alone.
`;
}

function renderReports(context) {
  ensureDir(REPORT_DIR);
  const reports = {
    "D1_INVENTORY_REPORT.md": renderD1InventoryReport(context),
    "D1_SCHEMA_INDEX_REPORT.md": renderSchemaIndexReport(context),
    "R2_INVENTORY_REPORT.md": renderR2InventoryReport(context),
    "R2_PREFIX_AND_BUCKET_STRUCTURE_REPORT.md": renderR2PrefixReport(context),
    "D1_R2_WEBSITE_RELATIONSHIP_MATRIX.md": renderRelationshipReport(context),
    "BROKEN_MEDIA_AND_DERIVATIVE_REPORT.md": renderBrokenMediaReport(context),
    "STORAGE_ACCOUNTING_RECONCILIATION_REPORT.md": renderStorageReport(context),
    "LEGACY_CLASSIFICATION_REPORT.md": renderClassificationReport(context),
    "DELETE_CANDIDATES_REPORT.md": renderDeleteCandidatesReport(context),
    "KEEP_AND_REPAIR_CANDIDATES_REPORT.md": renderKeepRepairReport(context),
    "POST_CLEANUP_VERIFICATION_REPORT.md": renderPostCleanupReport(context),
    "PROTECTED_ACCOUNTS_UNCHANGED_REPORT.md": renderProtectedReport(context),
    "FINAL_SUMMARY.md": renderFinalSummary(context),
    "TENANT_ASSET_CENTER_NECESSITY_REVIEW.md": renderNecessityReview(context),
  };
  for (const [name, body] of Object.entries(reports)) {
    writeText(path.join(REPORT_DIR, name), `${body.trim()}\n`);
  }
  return Object.keys(reports).map((name) => path.join(REPORT_DIR, name));
}

function prefixFamily(key) {
  const text = String(key || "");
  const parts = text.split("/").filter(Boolean);
  if (parts[0] === "users" && parts[1]) return "users/{userId}/...";
  if (parts[0] === "avatars") return "avatars/{userId}";
  if (parts[0] === "tenant-asset-cleanups") return "tenant-asset-cleanups/...";
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}/...`;
  return parts[0] || "root";
}

function assertExecutionAllowed(context, options) {
  const blockers = [];
  if (context.users.active.length !== 3) blockers.push("protected_allowlist_not_exactly_three_active_users");
  if (context.users.priorTestRows.length > 0) blockers.push("prior_test_email_rows_still_present");
  if (!context.fullR2ListingAvailable) blockers.push("full_r2_listing_unavailable");
  if (context.r2Verification.uncheckedRemaining > 0) blockers.push("r2_reference_check_limit_left_unchecked_objects");
  if ((context.cleanupPlan.blockedCandidates || []).length > 0) blockers.push("blocked_or_unknown_candidates_present");
  if (!context.cleanupPlan.executeEligible) blockers.push("cleanup_plan_not_execute_eligible");
  if (options.backupR2Candidates && (context.cleanupPlan.r2DeleteCandidates || []).length > 0) blockers.push("r2_backup_not_implemented_without_full_inventory");
  return blockers;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const generatedAt = new Date().toISOString();
  const stamp = utcStamp();
  const evidenceDir = options.evidenceDir || path.join(".local", "operator-evidence", `tenant-asset-live-cleanup-${stamp}`);
  ensureDir(evidenceDir);
  ensureDir(REPORT_DIR);

  const commandsRun = [];
  const releaseLatest = loadReleaseLatest();
  const r2Bindings = loadWranglerR2Bindings();
  const r2BucketList = listR2Buckets();
  commandsRun.push("npx wrangler r2 bucket list --config workers/auth/wrangler.jsonc");
  const r2CredentialStatus = localR2CredentialStatus();
  const fullR2ListingAvailable = Boolean(
    (r2CredentialStatus.R2_ACCESS_KEY_ID || r2CredentialStatus.AWS_ACCESS_KEY_ID)
    && (r2CredentialStatus.R2_SECRET_ACCESS_KEY || r2CredentialStatus.AWS_SECRET_ACCESS_KEY)
    && (r2CredentialStatus.CLOUDFLARE_ACCOUNT_ID || r2CredentialStatus.CF_ACCOUNT_ID || r2CredentialStatus.R2_ACCOUNT_ID)
  );

  const exportPath = path.join(evidenceDir, "remote-d1-export.sql");
  const exportResult = exportD1(exportPath, options);
  commandsRun.push(`npx wrangler d1 export ${DB_NAME} --remote --config workers/auth/wrangler.jsonc --output ${exportPath}`);

  const schema = await loadSchema(options);
  const schemaColumns = identifySchemaColumns(schema);
  const rowCounts = exportResult.status === 0
    ? collectRowCountsFromExport(schema, exportPath)
    : await collectRowCounts(schema, options);
  const users = await collectUsers(options);
  const allowlistResult = buildProtectedAllowlist(users, evidenceDir, options.protectedAllowlistPath);
  const protectedUserIds = new Set((allowlistResult.allowlist.protectedUsers || []).map((row) => row.id));
  const allUserIds = new Set(users.rows.map((row) => row.id));
  const deletedUserIds = new Set(users.deleted.map((row) => row.id));
  const userReferenceIntegrity = await collectUserReferenceIntegrity(schema, users, options);
  const rawR2Refs = await collectR2References(schema, options);
  const r2Refs = rawR2Refs.map((ref) => ({
    ...ref,
    category: ref.error ? "unknown_blocker_keep" : classifyReference(ref, { protectedUserIds, allUserIds, deletedUserIds }),
  }));
  const uniqueR2ReferenceCount = dedupeR2Refs(r2Refs).length;
  const r2Verification = verifyR2References(r2Refs, options);
  const storageAccounting = await collectStorageAccounting(schema, users, options);
  const publicMediaSummary = await collectPublicMediaSummary(schema, options);
  const r2CategoryCounts = summarizeBy(r2Refs, (ref) => ref.category);
  const r2PrefixCounts = summarizeBy(r2Refs, (ref) => prefixFamily(ref.key));
  const gates = {
    protectedAllowlistExactThree: users.active.length === 3,
    priorTestEmailsAbsent: users.priorTestRows.length === 0,
    fullR2ListingAvailable,
    r2ReferenceExistenceCheckComplete: !r2Verification.uncheckedRemaining,
    noD1MutationInDryRun: true,
    noR2MutationInDryRun: true,
  };
  const relationship = { uniqueR2ReferenceCount, r2Verification };
  const cleanupPlan = buildDeletePlan(r2Refs, relationship, gates);

  const context = {
    generatedAt,
    evidenceDir,
    releaseLatest,
    r2Bindings,
    r2BucketList,
    r2CredentialStatus,
    fullR2ListingAvailable,
    schema,
    schemaColumns,
    rowCounts,
    users,
    allowlistSource: allowlistResult.source,
    userReferenceIntegrity,
    r2Refs,
    uniqueR2ReferenceCount,
    r2Verification,
    storageAccounting,
    publicMediaSummary,
    r2CategoryCounts,
    r2PrefixCounts,
    cleanupPlan,
    exportResult: {
      status: exportResult.status,
      ok: exportResult.status === 0,
      stderr: exportResult.stderr?.trim() || "",
    },
    commandsRun,
  };
  const executionBlockers = assertExecutionAllowed(context, options);
  context.executionBlockers = executionBlockers;
  context.cleanupPlan.executeEligible = executionBlockers.length === 0 && (context.cleanupPlan.r2DeleteCandidates || []).length > 0;
  context.cleanupPlan.reason = context.cleanupPlan.executeEligible
    ? "all_gates_passed"
    : `execution_blocked: ${executionBlockers.join(", ") || "no_delete_candidates"}`;

  writeJson(path.join(evidenceDir, "schema.json"), schema);
  writeJson(path.join(evidenceDir, "schema-columns.json"), schemaColumns);
  writeJson(path.join(evidenceDir, "row-counts.json"), rowCounts);
  writeJson(path.join(evidenceDir, "users-profiles-raw.json"), users);
  writeJson(path.join(evidenceDir, "user-reference-integrity.json"), userReferenceIntegrity);
  writeJson(path.join(evidenceDir, "r2-references-raw.json"), r2Refs);
  writeJson(path.join(evidenceDir, "r2-references-redacted.json"), r2Refs.map((ref) => ({
    ...ref,
    key: redactedKey(ref.key),
    row: redactRow(ref.row),
  })));
  writeJson(path.join(evidenceDir, "r2-verification.json"), r2Verification);
  writeJson(path.join(evidenceDir, "storage-accounting.json"), storageAccounting);
  writeJson(path.join(evidenceDir, "public-media-summary.json"), publicMediaSummary);
  writeJson(path.join(evidenceDir, "cleanup-plan.json"), cleanupPlan);
  writeJson(path.join(evidenceDir, "run-summary.json"), {
    generatedAt,
    evidenceDir,
    reportsDir: REPORT_DIR,
    activeProtectedUsers: users.active.length,
    deletedUsers: users.deleted.length,
    priorTestRowsPresent: users.priorTestRows.length,
    d1Tables: Object.keys(schema.tables).length,
    d1R2References: r2Refs.length,
    uniqueR2ReferenceCount,
    r2Checked: r2Verification.checked?.filter((item) => item.checked).length || 0,
    r2MissingChecked: r2Verification.missing?.length || 0,
    executionRequested: options.execute,
    executionBlockers,
    commandsRun,
  });

  const reportFiles = renderReports(context);

  if (options.execute) {
    if (executionBlockers.length || !context.cleanupPlan.executeEligible) {
      throw new Error(`Execution blocked by safety gates: ${executionBlockers.join(", ") || "no eligible delete candidates"}`);
    }
    throw new Error("Execution path intentionally not implemented until a full R2 inventory backend is available.");
  }

  const summary = {
    ok: true,
    mutationMode: "dry_run_only",
    evidenceDir,
    reportFiles,
    activeProtectedUsers: users.active.length,
    priorTestRowsPresent: users.priorTestRows.length,
    d1Tables: Object.keys(schema.tables).length,
    d1R2References: r2Refs.length,
    uniqueR2ReferenceCount,
    r2Checked: r2Verification.checked?.filter((item) => item.checked).length || 0,
    r2MissingChecked: r2Verification.missing?.length || 0,
    executionBlockers,
  };
  if (options.jsonReport) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log(`Tenant asset live audit dry-run complete.`);
    console.log(`Evidence: ${evidenceDir}`);
    console.log(`Reports: ${REPORT_DIR}`);
    console.log(`Execution blockers: ${executionBlockers.join(", ") || "none"}`);
  }
}

main().catch((error) => {
  console.error(`tenant-asset-live-audit-cleanup failed: ${error.message || String(error)}`);
  process.exit(1);
});
