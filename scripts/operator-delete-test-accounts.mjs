#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_EMAILS = ["ziegenbart@bk.ru", "sanctum@kiandex.com"];
const CONFIRMATION_PHRASE = "DELETE BITBI TEST ACCOUNTS";
const DB_NAME = "bitbi-auth-db";
const AUTH_WRANGLER_CONFIG = "workers/auth/wrangler.jsonc";
const DEFAULT_MAX_R2_DELETE = 100000;
const MAX_ROW_EXPORT_PER_QUERY = 5000;

const R2_BUCKETS = Object.freeze({
  USER_IMAGES: { binding: "USER_IMAGES", bucketName: "bitbi-user-images" },
  PRIVATE_MEDIA: { binding: "PRIVATE_MEDIA", bucketName: "bitbi-private-media" },
  AUDIT_ARCHIVE: { binding: "AUDIT_ARCHIVE", bucketName: "bitbi-audit-archive" },
});

const SKIP_TABLES = new Set(["sqlite_sequence", "d1_migrations", "_cf_KV"]);
const JSON_REFERENCE_COLUMN_RE = /(?:metadata|summary|details|evidence|diagnostic|source|reference).*json$|^payload_summary_json$/i;
const EMAIL_COLUMN_RE = /email/i;
const USER_ID_COLUMN_RE = /(?:^|_)user_id$|^admin_user_id$|^target_user_id$|^actor_user_id$|^author_user_id$|^subject_user_id$|^requested_by_admin_id$|^approved_by_admin_id$|^closed_by_admin_id$|^completed_by_admin_id$|^rejected_by_admin_id$|^uploaded_by_user_id$|^updated_by_user_id$|^source_user_id$|^archived_by_user_id$|^restored_by_user_id$|^purged_by_user_id$/i;
const ASSET_REFERENCE_COLUMN_RE = /(^id$|_id$|^item_id$|^media_id$|^asset_id$|^folder_id$|^image_id$|^job_id$|^resource_id$)/i;
const R2_KEY_COLUMN_RE = /(^r2_key$|_r2_key$|^thumb_key$|^medium_key$|^poster_key$|^poster_r2_key$|^output_r2_key$|^file_r2_key$|^source_r2_key$|^visual_object_key$|^storage_key$|^object_key$|^archive_key$|^export_key$)/i;
const SENSITIVE_COLUMN_RE = /token|secret|password|cookie|signature|raw|body|payload(?!_summary)|authorization|session/i;
const HIGH_RISK_BILLING_TABLE_RE = /^(billing_|member_credit_|member_usage_events$|credit_ledger$|usage_events$|entitlements$|organization_subscriptions$)/i;
const TARGET_OWNED_ID_TABLES = new Set([
  "ai_folders",
  "ai_images",
  "ai_text_assets",
  "ai_video_jobs",
  "data_lifecycle_requests",
  "favorites",
  "homepage_hero_video_uploads",
  "memvid_stream_previews",
  "news_pulse_items",
  "profiles",
  "public_media_comments",
  "public_media_likes",
  "users",
]);
const TARGET_R2_REFERENCE_TABLES = new Set([
  "r2_cleanup_queue",
]);

function usage() {
  return `Usage:
  node scripts/operator-delete-test-accounts.mjs [--dry-run]
  node scripts/operator-delete-test-accounts.mjs --execute --confirm "${CONFIRMATION_PHRASE}"

Options:
  --emails <csv>                 Exact target emails. Defaults to the two authorized test accounts.
  --evidence-dir <path>          Local evidence output directory. Defaults under .local/operator-evidence/.
  --execute                      Execute D1/R2 deletion after the dry-run safety gate passes.
  --dry-run                      Plan only. This is the default.
  --confirm <phrase>             Required for --execute. Exact phrase: ${CONFIRMATION_PHRASE}
  --remote                       Use remote Cloudflare D1/R2. Default: true.
  --skip-r2-delete               Execute D1 cleanup but do not delete R2 objects.
  --skip-r2-existence-check      Do not read R2 objects to /dev/null during inventory verification.
  --retry-r2-from-evidence <dir> Retry exact target-prefix R2 deletion from a prior local evidence backup.
  --max-r2-delete <n>            Maximum eligible R2 objects allowed for deletion. Default ${DEFAULT_MAX_R2_DELETE}.
  --json-report                  Print a compact JSON summary to stdout.

The script never fuzzy-matches emails and never deletes by email after user IDs are resolved. Raw evidence is written only to .local/ and must not be committed.`;
}

function parseArgs(argv) {
  const options = {
    emails: [...DEFAULT_EMAILS],
    evidenceDir: null,
    execute: false,
    confirm: "",
    remote: true,
    skipR2Delete: false,
    skipR2ExistenceCheck: false,
    retryR2FromEvidence: null,
    maxR2Delete: DEFAULT_MAX_R2_DELETE,
    jsonReport: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.execute = false;
    else if (arg === "--execute") options.execute = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--skip-r2-delete") options.skipR2Delete = true;
    else if (arg === "--skip-r2-existence-check") options.skipR2ExistenceCheck = true;
    else if (arg === "--json-report") options.jsonReport = true;
    else if (arg === "--retry-r2-from-evidence") {
      options.retryR2FromEvidence = argv[++index];
      if (!options.retryR2FromEvidence) throw new Error("--retry-r2-from-evidence requires an evidence directory.");
    }
    else if (arg === "--emails") {
      const value = argv[++index];
      if (!value) throw new Error("--emails requires a comma-separated value.");
      options.emails = value.split(",").map((email) => email.trim()).filter(Boolean);
    } else if (arg === "--evidence-dir") {
      options.evidenceDir = argv[++index];
      if (!options.evidenceDir) throw new Error("--evidence-dir requires a path.");
    } else if (arg === "--confirm") {
      options.confirm = argv[++index] || "";
    } else if (arg === "--max-r2-delete") {
      const parsed = Number.parseInt(argv[++index] || "", 10);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--max-r2-delete must be a non-negative integer.");
      options.maxR2Delete = parsed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.emails = [...new Set(options.emails.map((email) => email.toLowerCase()))];
  if (!options.emails.length) throw new Error("At least one target email is required.");
  return options;
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

function redactedKey(key) {
  const text = String(key || "");
  if (!text) return "";
  const parts = text.split("/");
  if (parts.length <= 2) return shortId(text);
  return `${parts[0]}/${parts[1]}/.../${shortId(parts.at(-1))}`;
}

function quoteSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdent(value) {
  const text = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    throw new Error(`Unsafe SQL identifier: ${text}`);
  }
  return `"${text}"`;
}

function commandLog(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function run(command, args, { cwd = process.cwd(), allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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
  return [
    "wrangler",
    ...base,
    "--config",
    AUTH_WRANGLER_CONFIG,
  ];
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
  if (!first?.success) throw new Error(`D1 query failed: ${sql.slice(0, 200)}`);
  return {
    rows: first.results || [],
    meta: first.meta || {},
    raw: payload,
  };
}

function executeSqlFile(filePath, options) {
  return run("npx", wranglerArgs([
    "d1",
    "execute",
    DB_NAME,
    ...d1ModeArgs(options),
    "--file",
    filePath,
    "--yes",
    "--json",
  ]));
}

function exportD1(outputPath, options, extra = []) {
  return run("npx", wranglerArgs([
    "d1",
    "export",
    DB_NAME,
    ...d1ModeArgs(options),
    "--output",
    outputPath,
    "--skip-confirmation",
    ...extra,
  ]));
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

function deleteR2Object(bucketName, key) {
  return run("npx", wranglerArgs([
    "r2",
    "object",
    "delete",
    r2ObjectPath(bucketName, key),
    "--remote",
    "--force",
  ]), { allowFailure: true });
}

function redactedRow(row = {}) {
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    if (SENSITIVE_COLUMN_RE.test(key)) {
      output[key] = value === null || value === undefined ? value : `[redacted:${sha256Hex(value).slice(0, 12)}]`;
    } else if (R2_KEY_COLUMN_RE.test(key)) {
      output[key] = redactedKey(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function tableColumns(schema, tableName) {
  return schema.tables[tableName]?.columns || [];
}

function hasColumn(schema, tableName, columnName) {
  return tableColumns(schema, tableName).some((column) => column.name === columnName);
}

function predicateForValues(columnName, values, { lower = false } = {}) {
  if (!values.length) return null;
  const columnSql = lower ? `lower(${quoteIdent(columnName)})` : quoteIdent(columnName);
  return `${columnSql} IN (${values.map(quoteSql).join(", ")})`;
}

function likePredicate(columnName, needles) {
  const values = needles.filter(Boolean);
  if (!values.length) return null;
  return values.map((value) => `${quoteIdent(columnName)} LIKE ${quoteSql(`%${value}%`)}`).join(" OR ");
}

function primaryKeyColumns(schema, tableName) {
  return tableColumns(schema, tableName)
    .filter((column) => Number(column.pk || 0) > 0)
    .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0))
    .map((column) => column.name);
}

function rowDeletePredicate(schema, tableName, row) {
  const pks = primaryKeyColumns(schema, tableName);
  const candidates = pks.length
    ? pks
    : (row.id !== undefined ? ["id"] : []);
  if (candidates.length) {
    return candidates.map((column) => `${quoteIdent(column)} = ${quoteSql(row[column])}`).join(" AND ");
  }
  const fallbackSets = [
    ["user_id"],
    ["follower_user_id", "target_user_id"],
    ["user_id", "media_type", "media_id"],
    ["user_id", "item_type", "item_id"],
    ["request_id", "resource_type", "resource_id"],
    ["run_id", "item_type", "item_id"],
  ];
  for (const set of fallbackSets) {
    if (set.every((column) => row[column] !== undefined)) {
      return set.map((column) => `${quoteIdent(column)} = ${quoteSql(row[column])}`).join(" AND ");
    }
  }
  return null;
}

function rowIdentity(schema, tableName, row) {
  const predicate = rowDeletePredicate(schema, tableName, row);
  if (predicate) return predicate;
  return sha256Hex(JSON.stringify(row));
}

function mergeRows(schema, destination, tableName, rows, reason) {
  if (!rows.length) return;
  if (!destination.has(tableName)) destination.set(tableName, new Map());
  const tableRows = destination.get(tableName);
  for (const row of rows) {
    const key = rowIdentity(schema, tableName, row);
    const existing = tableRows.get(key);
    if (existing) {
      existing.reasons.add(reason);
    } else {
      tableRows.set(key, { row, reasons: new Set([reason]) });
    }
  }
}

function countRows(tableName, predicate, options) {
  const rows = queryD1(
    `SELECT COUNT(*) AS cnt FROM ${quoteIdent(tableName)} WHERE ${predicate}`,
    options
  ).rows;
  return Number(rows[0]?.cnt || 0);
}

function selectRows(tableName, predicate, options, limit = MAX_ROW_EXPORT_PER_QUERY) {
  return queryD1(
    `SELECT * FROM ${quoteIdent(tableName)} WHERE ${predicate} LIMIT ${Number(limit)}`,
    options
  ).rows;
}

function discoverSchema(options) {
  const tableRows = queryD1(
    "SELECT name, type, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
    options
  ).rows;
  const schema = {
    tables: {},
    liveMigrationRows: [],
  };
  for (const table of tableRows) {
    if (SKIP_TABLES.has(table.name) || table.name.startsWith("sqlite_")) continue;
    const columns = queryD1(`PRAGMA table_info(${quoteIdent(table.name)})`, options).rows;
    const foreignKeys = queryD1(`PRAGMA foreign_key_list(${quoteIdent(table.name)})`, options).rows;
    schema.tables[table.name] = {
      name: table.name,
      sql: table.sql || "",
      columns,
      foreignKeys,
    };
  }
  if (schema.tables.d1_migrations) {
    schema.liveMigrationRows = queryD1("SELECT * FROM d1_migrations ORDER BY id", options).rows;
  }
  return schema;
}

function resolveTargetUsers(options) {
  const emails = options.emails.map((email) => email.toLowerCase());
  const rows = queryD1(
    `SELECT id, email, role, status, created_at, updated_at FROM users WHERE lower(email) IN (${emails.map(quoteSql).join(", ")}) ORDER BY lower(email), id`,
    options
  ).rows;
  const byEmail = new Map();
  for (const row of rows) {
    const email = String(row.email || "").toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(row);
  }
  const duplicates = [...byEmail.entries()].filter(([, matches]) => matches.length > 1);
  const found = [];
  for (const email of emails) {
    const matches = byEmail.get(email) || [];
    if (matches.length === 1) found.push(matches[0]);
  }
  return {
    found,
    missingEmails: emails.filter((email) => !(byEmail.get(email) || []).length),
    duplicates: duplicates.map(([email, matches]) => ({ email, count: matches.length, users: matches.map(redactedRow) })),
  };
}

function userPredicateForTable(columns, targetUserIds, targetEmails) {
  const predicates = [];
  for (const column of columns) {
    if (USER_ID_COLUMN_RE.test(column.name)) {
      predicates.push(predicateForValues(column.name, targetUserIds));
    } else if (EMAIL_COLUMN_RE.test(column.name)) {
      predicates.push(predicateForValues(column.name, targetEmails, { lower: true }));
    } else if (JSON_REFERENCE_COLUMN_RE.test(column.name)) {
      predicates.push(likePredicate(column.name, [...targetUserIds, ...targetEmails]));
    }
  }
  return predicates.filter(Boolean).map((entry) => `(${entry})`);
}

function discoverTargetRows(schema, targetUsers, options) {
  const targetRows = new Map();
  const targetUserIds = targetUsers.map((user) => user.id);
  const targetEmails = targetUsers.map((user) => String(user.email || "").toLowerCase());
  const directPredicatesByTable = new Map();

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const predicates = userPredicateForTable(table.columns, targetUserIds, targetEmails);
    if (!predicates.length) continue;
    const predicate = predicates.join(" OR ");
    const count = countRows(tableName, predicate, options);
    if (count > 0) {
      directPredicatesByTable.set(tableName, predicate);
      mergeRows(schema, targetRows, tableName, selectRows(tableName, predicate, options), "direct target user/email reference");
    }
  }

  const targetOwnedIds = new Set(targetUserIds);
  for (const [tableName, rows] of targetRows.entries()) {
    if (!TARGET_OWNED_ID_TABLES.has(tableName)) continue;
    for (const entry of rows.values()) {
      if (entry.row.id) targetOwnedIds.add(String(entry.row.id));
      if (entry.row.user_id) targetOwnedIds.add(String(entry.row.user_id));
    }
  }

  const ids = [...targetOwnedIds];
  if (ids.length) {
    for (const [tableName, table] of Object.entries(schema.tables)) {
      const predicates = [];
      for (const column of table.columns) {
        if (!ASSET_REFERENCE_COLUMN_RE.test(column.name)) continue;
        if (USER_ID_COLUMN_RE.test(column.name)) continue;
        predicates.push(predicateForValues(column.name, ids));
      }
      const predicate = predicates.filter(Boolean).map((entry) => `(${entry})`).join(" OR ");
      if (!predicate) continue;
      const count = countRows(tableName, predicate, options);
      if (count > 0) {
        mergeRows(schema, targetRows, tableName, selectRows(tableName, predicate, options), "target-owned entity reference");
      }
    }
  }

  return { targetRows, directPredicatesByTable, targetOwnedIds: [...targetOwnedIds] };
}

function rowsToSerializable(schema, targetRows) {
  const output = {};
  for (const [tableName, rows] of targetRows.entries()) {
    output[tableName] = [...rows.values()].map((entry) => ({
      reasons: [...entry.reasons].sort(),
      deletePredicateHash: sha256Hex(rowDeletePredicate(schema, tableName, entry.row) || ""),
      row: redactedRow(entry.row),
    }));
  }
  return output;
}

function guessBucketForKey(tableName, columnName, row) {
  if (row.r2_bucket && R2_BUCKETS[String(row.r2_bucket).toUpperCase()]) {
    return String(row.r2_bucket).toUpperCase();
  }
  if (String(columnName).includes("avatar") || String(row.r2_key || "").startsWith("avatars/")) return "PRIVATE_MEDIA";
  if (/data_export|data_lifecycle|platform_budget|audit|archive/i.test(tableName)) return "AUDIT_ARCHIVE";
  return "USER_IMAGES";
}

function collectR2Keys(schema, targetRows, targetUsers) {
  const keys = new Map();
  function add({ binding, bucketName, key, sourceTable, sourceColumn, sourceRow }) {
    const clean = String(key || "").trim();
    if (!clean) return;
    const bucket = R2_BUCKETS[binding];
    if (!bucket) return;
    const id = `${binding}:${clean}`;
    if (!keys.has(id)) {
      keys.set(id, {
        binding,
        bucketName: bucketName || bucket.bucketName,
        key: clean,
        keyHash: sha256Hex(clean),
        redactedKey: redactedKey(clean),
        sources: [],
        referenceCounts: [],
        targetReferenceCount: 0,
        nonTargetReferenceCount: 0,
        existence: { checked: false, exists: null },
        eligibleForDelete: false,
        blockedReason: null,
      });
    }
    keys.get(id).sources.push({
      table: sourceTable,
      column: sourceColumn,
      rowId: sourceRow?.id || sourceRow?.user_id || null,
    });
  }

  for (const [tableName, rows] of targetRows.entries()) {
    for (const entry of rows.values()) {
      const row = entry.row;
      for (const column of tableColumns(schema, tableName)) {
        if (!R2_KEY_COLUMN_RE.test(column.name)) continue;
        const key = row[column.name];
        if (!key) continue;
        const binding = guessBucketForKey(tableName, column.name, row);
        add({ binding, key, sourceTable: tableName, sourceColumn: column.name, sourceRow: row });
      }
      if (tableName === "profiles" && Number(row.has_avatar || 0) === 1) {
        add({
          binding: "PRIVATE_MEDIA",
          key: `avatars/${row.user_id}`,
          sourceTable: "profiles",
          sourceColumn: "avatar_synthetic_key",
          sourceRow: row,
        });
      }
    }
  }

  for (const user of targetUsers) {
    add({
      binding: "PRIVATE_MEDIA",
      key: `avatars/${user.id}`,
      sourceTable: "users",
      sourceColumn: "avatar_synthetic_key",
      sourceRow: user,
    });
  }

  return keys;
}

function keyColumns(schema) {
  const entries = [];
  for (const [tableName, table] of Object.entries(schema.tables)) {
    for (const column of table.columns) {
      if (R2_KEY_COLUMN_RE.test(column.name)) entries.push({ tableName, columnName: column.name });
    }
  }
  return entries;
}

function exactRowCountForKey(rows, columnName, key) {
  let count = 0;
  for (const entry of rows?.values?.() || []) {
    if (String(entry.row[columnName] || "") === key) count += 1;
  }
  return count;
}

function analyzeR2References(schema, targetRows, keys, options) {
  const columns = keyColumns(schema);
  for (const keyInfo of keys.values()) {
    let total = 0;
    let target = 0;
    for (const { tableName, columnName } of columns) {
      const count = countRows(tableName, `${quoteIdent(columnName)} = ${quoteSql(keyInfo.key)}`, options);
      if (count <= 0) continue;
      const targetCount = exactRowCountForKey(targetRows.get(tableName), columnName, keyInfo.key);
      total += count;
      target += targetCount;
      keyInfo.referenceCounts.push({ table: tableName, column: columnName, total: count, target: targetCount });
    }
    keyInfo.targetReferenceCount = target;
    keyInfo.nonTargetReferenceCount = Math.max(0, total - target);
    if (keyInfo.nonTargetReferenceCount > 0) {
      keyInfo.blockedReason = "blocked_shared_non_target_reference";
      keyInfo.eligibleForDelete = false;
    } else {
      keyInfo.eligibleForDelete = true;
    }
  }
}

function discoverTargetR2ReferenceRows(schema, targetRows, keys, options) {
  const columns = keyColumns(schema).filter((entry) => TARGET_R2_REFERENCE_TABLES.has(entry.tableName));
  let added = 0;
  for (const keyInfo of keys.values()) {
    for (const { tableName, columnName } of columns) {
      const predicate = `${quoteIdent(columnName)} = ${quoteSql(keyInfo.key)}`;
      const rows = selectRows(tableName, predicate, options);
      if (rows.length) {
        added += rows.length;
        mergeRows(schema, targetRows, tableName, rows, "target-owned R2 cleanup/reference row");
      }
    }
  }
  return added;
}

function checkR2Existence(keys, options) {
  if (options.skipR2ExistenceCheck) {
    for (const keyInfo of keys.values()) {
      keyInfo.existence = { checked: false, exists: null, reason: "skipped_by_operator_option" };
    }
    return;
  }
  for (const keyInfo of keys.values()) {
    const result = checkR2Object(keyInfo.bucketName, keyInfo.key);
    keyInfo.existence = {
      checked: true,
      exists: result.exists,
      status: result.status,
      errorHash: result.exists ? null : sha256Hex(result.stderr).slice(0, 12),
    };
  }
}

function detectBlockers(schema, targetUsers, targetRows, keys) {
  const blockers = [];
  if (!targetUsers.length) {
    blockers.push({ code: "no_target_users_found", message: "No exact target users were found." });
  }

  for (const user of targetUsers) {
    if (user.role === "admin") {
      blockers.push({
        code: "target_user_is_admin",
        message: `Target user ${shortId(user.id)} has admin role and requires manual review before deletion.`,
      });
    }
  }

  for (const [tableName, rows] of targetRows.entries()) {
    if (!HIGH_RISK_BILLING_TABLE_RE.test(tableName)) continue;
    for (const entry of rows.values()) {
      const row = entry.row;
      const status = String(row.status || row.subscription_status || row.payment_status || row.checkout_status || row.processing_status || "").toLowerCase();
      const providerMode = String(row.provider_mode || row.mode || "").toLowerCase();
      const amount = Number(row.amount_cents || row.expected_amount_cents || row.total_amount_cents || 0);
      const hasProviderId = Boolean(row.provider_event_id || row.stripe_checkout_session_id || row.provider_checkout_session_id || row.stripe_subscription_id || row.provider_subscription_id || row.payment_intent);
      if (
        providerMode === "live" ||
        ["paid", "complete", "completed", "succeeded", "active", "trialing", "past_due"].includes(status) ||
        (amount > 0 && hasProviderId)
      ) {
        blockers.push({
          code: "billing_or_real_money_record_requires_manual_review",
          table: tableName,
          rowId: row.id || null,
          status: status || null,
          providerMode: providerMode || null,
          message: `High-risk billing/provider row in ${tableName} requires manual review before hard deletion.`,
        });
      }
    }
  }

  for (const [tableName, rows] of targetRows.entries()) {
    for (const entry of rows.values()) {
      if (!rowDeletePredicate(schema, tableName, entry.row)) {
        blockers.push({
          code: "no_stable_delete_predicate",
          table: tableName,
          rowHash: sha256Hex(JSON.stringify(entry.row)).slice(0, 16),
          message: `Cannot build a stable exact delete predicate for target row in ${tableName}.`,
        });
      }
    }
  }

  const sharedKeys = [...keys.values()].filter((entry) => entry.nonTargetReferenceCount > 0);
  for (const keyInfo of sharedKeys) {
    blockers.push({
      code: "shared_r2_key_blocked",
      bucket: keyInfo.binding,
      keyHash: keyInfo.keyHash,
      redactedKey: keyInfo.redactedKey,
      message: `R2 key ${keyInfo.redactedKey} has non-target D1 references and will not be deleted.`,
    });
  }

  return blockers;
}

function deletionOrder(schema, tables) {
  const selected = new Set(tables);
  const edges = new Map([...selected].map((table) => [table, new Set()]));
  for (const table of selected) {
    for (const fk of schema.tables[table]?.foreignKeys || []) {
      const parent = fk.table;
      if (selected.has(parent)) edges.get(parent)?.add(table);
    }
  }
  const visited = new Set();
  const output = [];
  function visit(table) {
    if (visited.has(table)) return;
    visited.add(table);
    for (const child of edges.get(table) || []) visit(child);
    output.push(table);
  }
  for (const table of selected) visit(table);
  return output.sort((a, b) => {
    if (a === "users") return 1;
    if (b === "users") return -1;
    if (a === "profiles" && b !== "users") return 1;
    if (b === "profiles" && a !== "users") return -1;
    return 0;
  });
}

function buildDeletePlan(schema, targetRows) {
  const tablePredicates = new Map();
  const predicateBlockers = [];
  const rowCounts = {};
  for (const [tableName, rows] of targetRows.entries()) {
    const predicates = [];
    for (const entry of rows.values()) {
      const predicate = rowDeletePredicate(schema, tableName, entry.row);
      if (predicate) predicates.push(`(${predicate})`);
      else predicateBlockers.push({ table: tableName, row: redactedRow(entry.row) });
    }
    if (predicates.length) {
      const unique = [...new Set(predicates)];
      tablePredicates.set(tableName, unique);
      rowCounts[tableName] = unique.length;
    }
  }
  const order = deletionOrder(schema, [...tablePredicates.keys()]);
  return { tablePredicates, order, predicateBlockers, rowCounts };
}

function renderMarkdownReport({ mode, targetResolution, rowCounts, keys, blockers, evidenceDir, deletePlan, verification }) {
  const r2Eligible = [...keys.values()].filter((entry) => entry.eligibleForDelete);
  const r2Blocked = [...keys.values()].filter((entry) => !entry.eligibleForDelete);
  const lines = [
    `# BITBI test-account deletion ${mode} report`,
    "",
    `Evidence directory: \`${evidenceDir}\``,
    "",
    "## Targets",
    "",
    ...targetResolution.found.map((user) => `- ${user.email}: ${user.id} (${user.role}, ${user.status})`),
  ];
  for (const missing of targetResolution.missingEmails) lines.push(`- ${missing}: not found`);
  lines.push("", "## D1 rows planned by table", "");
  for (const [table, count] of Object.entries(rowCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${table}: ${count}`);
  }
  lines.push("", "## R2 objects", "");
  lines.push(`- Eligible for deletion: ${r2Eligible.length}`);
  lines.push(`- Blocked/retained: ${r2Blocked.length}`);
  for (const entry of r2Blocked) {
    lines.push(`  - ${entry.binding}: ${entry.redactedKey} (${entry.blockedReason || "retained"})`);
  }
  lines.push("", "## Delete order", "");
  for (const table of deletePlan.order) lines.push(`- ${table}`);
  lines.push("", "## Blockers", "");
  if (blockers.length) {
    for (const blocker of blockers) lines.push(`- ${blocker.code}: ${blocker.message || ""}`);
  } else {
    lines.push("- None");
  }
  if (verification) {
    lines.push("", "## Verification", "");
    for (const [key, value] of Object.entries(verification)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function compactSummary({ options, targetResolution, targetRows, keys, blockers, evidenceDir, executed, verification }) {
  const rowCounts = Object.fromEntries([...targetRows.entries()].map(([table, rows]) => [table, rows.size]));
  return {
    mode: options.execute ? "execute" : "dry-run",
    executed,
    evidenceDir,
    targetsFound: targetResolution.found.map((user) => ({ id: user.id, email: user.email, role: user.role, status: user.status })),
    missingEmails: targetResolution.missingEmails,
    rowCounts,
    totalD1Rows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0),
    r2: {
      total: keys.size,
      eligible: [...keys.values()].filter((entry) => entry.eligibleForDelete).length,
      blocked: [...keys.values()].filter((entry) => !entry.eligibleForDelete).length,
    },
    blockerCount: blockers.length,
    blockers: blockers.map((entry) => ({ code: entry.code, table: entry.table || null })),
    verification,
  };
}

function writeExecutionSql(filePath, schema, deletePlan) {
  const statements = [
    "-- Ordered, exact-row, idempotent deletes generated from the live dry-run inventory.",
    "-- Wrangler remote D1 SQL files reject explicit BEGIN/COMMIT transaction statements.",
  ];
  for (const table of deletePlan.order) {
    const predicates = deletePlan.tablePredicates.get(table) || [];
    if (!predicates.length) continue;
    statements.push(`DELETE FROM ${quoteIdent(table)} WHERE ${predicates.join(" OR ")};`);
  }
  writeText(filePath, `${statements.join("\n")}\n`);
}

function verifyAfterDeletion(schema, targetResolution, options, keys, r2DeletionResults) {
  const targetUsers = targetResolution.found;
  const targetUserIds = targetUsers.map((user) => user.id);
  const targetEmails = targetUsers.map((user) => String(user.email || "").toLowerCase());
  const verification = {};
  const remainingUsers = queryD1(
    `SELECT COUNT(*) AS cnt FROM users WHERE id IN (${targetUserIds.map(quoteSql).join(", ")}) OR lower(email) IN (${targetEmails.map(quoteSql).join(", ")})`,
    options
  ).rows;
  verification.targetUsersRemaining = Number(remainingUsers[0]?.cnt || 0);

  let remainingReferenceRows = 0;
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const predicates = userPredicateForTable(table.columns, targetUserIds, targetEmails);
    if (!predicates.length) continue;
    const count = countRows(tableName, predicates.join(" OR "), options);
    remainingReferenceRows += count;
  }
  verification.targetUserReferenceRowsRemaining = remainingReferenceRows;

  let r2StillExists = 0;
  for (const result of r2DeletionResults || []) {
    if (!result.deleted) continue;
    const keyInfo = keys.get(`${result.binding}:${result.key}`);
    if (!keyInfo) continue;
    const check = checkR2Object(keyInfo.bucketName, keyInfo.key);
    if (check.exists) r2StillExists += 1;
  }
  verification.deletedR2ObjectsStillReadable = r2StillExists;
  return verification;
}

function extractTargetPrefixKeysFromBackup(evidenceDir) {
  const targetPath = path.join(evidenceDir, "05-target-users.json");
  const backupPath = path.join(evidenceDir, "02-full-d1-backup.sql");
  if (!fs.existsSync(targetPath)) throw new Error(`Missing target evidence: ${targetPath}`);
  if (!fs.existsSync(backupPath)) throw new Error(`Missing D1 backup: ${backupPath}`);
  const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const users = target.found || [];
  const backup = fs.readFileSync(backupPath, "utf8");
  const keys = new Map();
  for (const user of users) {
    const id = String(user.id || "").trim();
    if (!id) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const userPrefixRe = new RegExp(`users/${escaped}/[^'")\\s,]+`, "g");
    for (const match of backup.matchAll(userPrefixRe)) {
      const key = match[0].replace(/''/g, "'");
      keys.set(`USER_IMAGES:${key}`, {
        binding: "USER_IMAGES",
        bucketName: R2_BUCKETS.USER_IMAGES.bucketName,
        key,
      });
    }
    const avatarKey = `avatars/${id}`;
    keys.set(`PRIVATE_MEDIA:${avatarKey}`, {
      binding: "PRIVATE_MEDIA",
      bucketName: R2_BUCKETS.PRIVATE_MEDIA.bucketName,
      key: avatarKey,
    });
  }
  return keys;
}

function retryR2FromEvidence(options) {
  if (!options.execute || options.confirm !== CONFIRMATION_PHRASE) {
    throw new Error(`--retry-r2-from-evidence requires --execute --confirm "${CONFIRMATION_PHRASE}"`);
  }
  const evidenceDir = path.resolve(options.retryR2FromEvidence);
  const keys = extractTargetPrefixKeysFromBackup(evidenceDir);
  const results = [];
  for (const entry of keys.values()) {
    const before = checkR2Object(entry.bucketName, entry.key);
    const deleted = deleteR2Object(entry.bucketName, entry.key);
    const after = checkR2Object(entry.bucketName, entry.key);
    results.push({
      binding: entry.binding,
      keyHash: sha256Hex(entry.key),
      redactedKey: redactedKey(entry.key),
      existedBefore: before.exists,
      deleteStatus: deleted.status,
      existsAfter: after.exists,
      deleted: !after.exists,
      errorHash: after.exists ? sha256Hex(`${deleted.stdout}\n${deleted.stderr}\n${after.stderr}`).slice(0, 12) : null,
    });
  }
  writeJson(path.join(evidenceDir, "16-r2-retry-results-redacted.json"), results);
  const summary = {
    evidenceDir,
    retried: results.length,
    stillReadable: results.filter((entry) => entry.existsAfter).length,
    deletedOrMissing: results.filter((entry) => !entry.existsAfter).length,
  };
  writeJson(path.join(evidenceDir, "17-r2-retry-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.retryR2FromEvidence) {
    retryR2FromEvidence(options);
    return;
  }
  if (options.execute && options.confirm !== CONFIRMATION_PHRASE) {
    throw new Error(`--execute requires --confirm "${CONFIRMATION_PHRASE}"`);
  }

  const stamp = utcStamp();
  const evidenceDir = path.resolve(options.evidenceDir || path.join(".local", "operator-evidence", `delete-test-accounts-${stamp}`));
  ensureDir(evidenceDir);

  const gitStatus = run("git", ["status", "--short"], { allowFailure: true });
  const gitBranch = run("git", ["branch", "--show-current"], { allowFailure: true });
  writeJson(path.join(evidenceDir, "00-preflight.json"), {
    createdAt: new Date().toISOString(),
    mode: options.execute ? "execute" : "dry-run",
    emails: options.emails,
    branch: gitBranch.stdout.trim(),
    gitStatusShort: gitStatus.stdout,
    wranglerConfig: AUTH_WRANGLER_CONFIG,
    d1Database: DB_NAME,
    r2Bindings: R2_BUCKETS,
    publicMediaBinding: "not configured in workers/auth/wrangler.jsonc",
  });

  queryD1("SELECT 1 AS ok", options);
  const bucketList = run("npx", wranglerArgs(["r2", "bucket", "list"]), { allowFailure: true });
  writeText(path.join(evidenceDir, "01-r2-bucket-list.txt"), `${bucketList.stdout}\n${bucketList.stderr}`.trim() + "\n");

  exportD1(path.join(evidenceDir, "02-full-d1-backup.sql"), options);
  exportD1(path.join(evidenceDir, "03-schema.sql"), options, ["--no-data"]);

  const schema = discoverSchema(options);
  writeJson(path.join(evidenceDir, "04-live-schema.json"), schema);

  const targetResolution = resolveTargetUsers(options);
  writeJson(path.join(evidenceDir, "05-target-users.json"), {
    found: targetResolution.found.map(redactedRow),
    missingEmails: targetResolution.missingEmails,
    duplicates: targetResolution.duplicates,
  });
  if (targetResolution.duplicates.length) {
    throw new Error(`Duplicate exact email rows found: ${targetResolution.duplicates.map((entry) => entry.email).join(", ")}`);
  }

  const { targetRows, targetOwnedIds } = discoverTargetRows(schema, targetResolution.found, options);
  writeJson(path.join(evidenceDir, "06-target-row-inventory-redacted.json"), rowsToSerializable(schema, targetRows));
  writeJson(path.join(evidenceDir, "07-target-owned-ids.json"), [...targetOwnedIds].sort());

  let keys = collectR2Keys(schema, targetRows, targetResolution.found);
  const r2ReferenceRowsAdded = discoverTargetR2ReferenceRows(schema, targetRows, keys, options);
  if (r2ReferenceRowsAdded > 0) {
    keys = collectR2Keys(schema, targetRows, targetResolution.found);
  }
  analyzeR2References(schema, targetRows, keys, options);
  checkR2Existence(keys, options);
  writeJson(path.join(evidenceDir, "08-r2-inventory-redacted.json"), [...keys.values()].map((entry) => ({
    binding: entry.binding,
    bucketName: entry.bucketName,
    keyHash: entry.keyHash,
    redactedKey: entry.redactedKey,
    sources: entry.sources,
    referenceCounts: entry.referenceCounts,
    targetReferenceCount: entry.targetReferenceCount,
    nonTargetReferenceCount: entry.nonTargetReferenceCount,
    existence: entry.existence,
    eligibleForDelete: entry.eligibleForDelete,
    blockedReason: entry.blockedReason,
  })));

  const deletePlan = buildDeletePlan(schema, targetRows);
  const blockers = detectBlockers(schema, targetResolution.found, targetRows, keys);
  const predicateBlockers = deletePlan.predicateBlockers.map((entry) => ({
    code: "no_stable_delete_predicate",
    table: entry.table,
    message: `Cannot build a stable exact delete predicate for ${entry.table}.`,
  }));
  blockers.push(...predicateBlockers);

  const rowCounts = Object.fromEntries([...targetRows.entries()].map(([table, rows]) => [table, rows.size]));
  writeJson(path.join(evidenceDir, "09-dry-run-plan.json"), {
    targets: targetResolution,
    rowCounts,
    deleteOrder: deletePlan.order,
    r2: [...keys.values()].map((entry) => ({
      binding: entry.binding,
      keyHash: entry.keyHash,
      redactedKey: entry.redactedKey,
      eligibleForDelete: entry.eligibleForDelete,
      blockedReason: entry.blockedReason,
    })),
    blockers,
  });
  writeText(path.join(evidenceDir, "10-dry-run-report.md"), renderMarkdownReport({
    mode: "dry-run",
    targetResolution,
    rowCounts,
    keys,
    blockers,
    evidenceDir,
    deletePlan,
  }));

  writeExecutionSql(path.join(evidenceDir, "11-execution-delete.sql"), schema, deletePlan);

  let executed = false;
  let verification = null;
  let r2DeletionResults = [];

  if (options.execute) {
    if (blockers.length) {
      throw new Error(`Deletion blocked by ${blockers.length} blocker(s). See ${path.join(evidenceDir, "09-dry-run-plan.json")}`);
    }
    const eligibleKeys = [...keys.values()].filter((entry) => entry.eligibleForDelete);
    if (eligibleKeys.length > options.maxR2Delete) {
      throw new Error(`Refusing to delete ${eligibleKeys.length} R2 objects; --max-r2-delete is ${options.maxR2Delete}.`);
    }
    const d1Result = executeSqlFile(path.join(evidenceDir, "11-execution-delete.sql"), options);
    writeText(path.join(evidenceDir, "12-d1-execution-output.txt"), `${d1Result.stdout}\n${d1Result.stderr}`.trim() + "\n");

    if (options.skipR2Delete) {
      r2DeletionResults = eligibleKeys.map((entry) => ({
        binding: entry.binding,
        key: entry.key,
        keyHash: entry.keyHash,
        redactedKey: entry.redactedKey,
        deleted: false,
        status: "skipped_by_operator_option",
      }));
    } else {
      for (const entry of eligibleKeys) {
        const result = deleteR2Object(entry.bucketName, entry.key);
        r2DeletionResults.push({
          binding: entry.binding,
          key: entry.key,
          keyHash: entry.keyHash,
          redactedKey: entry.redactedKey,
          deleted: result.status === 0,
          status: result.status,
          errorHash: result.status === 0 ? null : sha256Hex(`${result.stdout}\n${result.stderr}`).slice(0, 12),
        });
      }
    }
    writeJson(path.join(evidenceDir, "13-r2-deletion-results-redacted.json"), r2DeletionResults.map((entry) => ({
      binding: entry.binding,
      keyHash: entry.keyHash,
      redactedKey: entry.redactedKey,
      deleted: entry.deleted,
      status: entry.status,
      errorHash: entry.errorHash || null,
    })));
    verification = verifyAfterDeletion(schema, targetResolution, options, keys, r2DeletionResults);
    writeJson(path.join(evidenceDir, "14-verification.json"), verification);
    writeText(path.join(evidenceDir, "15-execution-report.md"), renderMarkdownReport({
      mode: "execution",
      targetResolution,
      rowCounts,
      keys,
      blockers,
      evidenceDir,
      deletePlan,
      verification,
    }));
    executed = true;
  }

  const summary = compactSummary({ options, targetResolution, targetRows, keys, blockers, evidenceDir, executed, verification });
  writeJson(path.join(evidenceDir, "summary.json"), summary);
  if (options.jsonReport) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${options.execute ? "Execute" : "Dry-run"} complete.`);
    console.log(`Evidence: ${evidenceDir}`);
    console.log(`Targets found: ${summary.targetsFound.length}; missing: ${summary.missingEmails.length}`);
    console.log(`D1 rows inventoried: ${summary.totalD1Rows}`);
    console.log(`R2 objects: ${summary.r2.total} total, ${summary.r2.eligible} eligible, ${summary.r2.blocked} blocked`);
    console.log(`Blockers: ${summary.blockerCount}`);
    if (verification) {
      console.log(`Verification target users remaining: ${verification.targetUsersRemaining}`);
      console.log(`Verification target references remaining: ${verification.targetUserReferenceRowsRemaining}`);
      console.log(`Verification deleted R2 still readable: ${verification.deletedR2ObjectsStillReadable}`);
    }
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
