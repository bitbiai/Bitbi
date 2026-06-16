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
const DEFAULT_R2_HEAD_CONCURRENCY = 8;
const MAX_R2_HEAD_CONCURRENCY = 32;
const DEFAULT_R2_HEAD_LIMIT = 10000;
const MAX_R2_HEAD_LIMIT = 100000;
const DEFAULT_R2_LIST_TIMEOUT_MS = 60000;
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
  --skip-r2-full-listing         Skip S3-compatible full R2 bucket enumeration.
  --r2-list-buckets <names>      Comma-separated bucket name override. Default: BITBI buckets.
  --r2-head-metadata <bool>      Collect bounded HEAD metadata for listed objects. Default true.
  --r2-head-concurrency <n>      Concurrent R2 HEAD requests. Default ${DEFAULT_R2_HEAD_CONCURRENCY}, cap ${MAX_R2_HEAD_CONCURRENCY}.
  --r2-head-limit <n>            Max listed objects to HEAD. Default ${DEFAULT_R2_HEAD_LIMIT}, cap ${MAX_R2_HEAD_LIMIT}.
  --r2-list-timeout-ms <n>       Timeout per S3 list/head request. Default ${DEFAULT_R2_LIST_TIMEOUT_MS}.
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
    skipR2FullListing: false,
    r2ListBuckets: null,
    r2HeadMetadata: true,
    r2HeadConcurrency: DEFAULT_R2_HEAD_CONCURRENCY,
    r2HeadLimit: DEFAULT_R2_HEAD_LIMIT,
    r2ListTimeoutMs: DEFAULT_R2_LIST_TIMEOUT_MS,
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
    else if (arg === "--skip-r2-full-listing") options.skipR2FullListing = true;
    else if (arg === "--skip-r2-existence-check") options.skipR2ExistenceCheck = true;
    else if (arg === "--json-report") options.jsonReport = true;
    else if (arg === "--evidence-dir") options.evidenceDir = argv[++index];
    else if (arg === "--protected-allowlist") options.protectedAllowlistPath = argv[++index];
    else if (arg === "--confirm") options.confirm = argv[++index] || "";
    else if (arg === "--backup-r2-candidates") options.backupR2Candidates = parseBoolean(argv[++index], true);
    else if (arg === "--r2-list-buckets") options.r2ListBuckets = parseBucketList(argv[++index]);
    else if (arg === "--r2-head-metadata") {
      const next = argv[index + 1];
      options.r2HeadMetadata = next && !next.startsWith("--") ? parseBoolean(argv[++index], true) : true;
    }
    else if (arg === "--no-r2-head-metadata") options.r2HeadMetadata = false;
    else if (arg === "--r2-head-concurrency") options.r2HeadConcurrency = parseCappedInteger(argv[++index], "--r2-head-concurrency", 1, MAX_R2_HEAD_CONCURRENCY);
    else if (arg === "--r2-head-limit") options.r2HeadLimit = parseCappedInteger(argv[++index], "--r2-head-limit", 0, MAX_R2_HEAD_LIMIT);
    else if (arg === "--r2-list-timeout-ms") options.r2ListTimeoutMs = parseCappedInteger(argv[++index], "--r2-list-timeout-ms", 5000, 300000);
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

function parseBucketList(value) {
  const buckets = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!buckets.length) throw new Error("--r2-list-buckets must include at least one bucket name.");
  for (const bucket of buckets) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error(`Invalid R2 bucket name in --r2-list-buckets: ${bucket}`);
    }
  }
  return Array.from(new Set(buckets));
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer.`);
  return parsed;
}

function parseCappedInteger(value, flag, min, max) {
  const parsed = parseNonNegativeInteger(value, flag);
  if (parsed < min) throw new Error(`${flag} must be at least ${min}.`);
  if (parsed > max) throw new Error(`${flag} is capped at ${max}.`);
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

function resolveR2S3Credentials() {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    present: Boolean(accountId && accessKeyId && secretAccessKey),
  };
}

function sanitizeCredentialText(value, credentials = resolveR2S3Credentials()) {
  let text = String(value || "");
  for (const secret of [credentials.accountId, credentials.accessKeyId, credentials.secretAccessKey].filter(Boolean)) {
    text = text.split(secret).join("[redacted-r2-credential]");
  }
  return text;
}

function classifyR2HttpError(status, bodyText = "") {
  const code = extractXmlTag(bodyText, "Code") || "";
  if (status === 401 || status === 403 || /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(code)) return "r2_auth_or_permission_error";
  if (status === 404 || /NoSuchBucket|NoSuchKey/i.test(code)) return "r2_not_found";
  if (status === 429 || status >= 500) return "r2_transient_or_rate_limited";
  return code ? `r2_${code}` : `r2_http_${status}`;
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(value) {
  return String(value || "")
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function hmac(key, value, encoding = undefined) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sigV4Date(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalQuery(params) {
  return Array.from(params.entries())
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? String(aValue).localeCompare(String(bValue)) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function signR2S3Request({ method, bucketName, key = "", query = {}, credentials, now = new Date() }) {
  const region = "auto";
  const service = "s3";
  const { amzDate, dateStamp } = sigV4Date(now);
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = key ? `/${encodeRfc3986(bucketName)}/${encodePath(key)}` : `/${encodeRfc3986(bucketName)}`;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") params.append(name, String(value));
  }
  const queryString = canonicalQuery(params);
  const payloadHash = "UNSIGNED-PAYLOAD";
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${host}${canonicalUri}${queryString ? `?${queryString}` : ""}`;
  return {
    url,
    headers: {
      "authorization": authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

async function fetchR2S3({ method, bucketName, key = "", query = {}, credentials, timeoutMs }) {
  if (typeof fetch !== "function") throw new Error("Node fetch API is unavailable.");
  const request = signR2S3Request({ method, bucketName, key, query, credentials });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, {
      method,
      headers: request.headers,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function extractXmlTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXmlText(match[1].trim()) : "";
}

function parseListObjectsV2Xml(xml) {
  const text = String(xml || "");
  const contents = [];
  for (const match of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gi)) {
    const block = match[1];
    const key = extractXmlTag(block, "Key");
    if (!key) continue;
    contents.push({
      key,
      lastModified: extractXmlTag(block, "LastModified") || null,
      etag: extractXmlTag(block, "ETag").replace(/^"|"$/g, "") || null,
      size: Number(extractXmlTag(block, "Size") || 0),
      storageClass: extractXmlTag(block, "StorageClass") || null,
    });
  }
  return {
    isTruncated: /^true$/i.test(extractXmlTag(text, "IsTruncated")),
    nextContinuationToken: extractXmlTag(text, "NextContinuationToken") || "",
    contents,
  };
}

function headerValue(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase()) || null;
}

function safeContentMetadataFromHeaders(headers) {
  return {
    contentType: headerValue(headers, "content-type"),
    contentLength: Number(headerValue(headers, "content-length") || 0),
    cacheControl: headerValue(headers, "cache-control"),
    contentDisposition: headerValue(headers, "content-disposition"),
    etag: String(headerValue(headers, "etag") || "").replace(/^"|"$/g, "") || null,
    lastModified: headerValue(headers, "last-modified"),
  };
}

async function listR2BucketObjects(bucketName, options, credentials) {
  const objects = [];
  const errors = [];
  let continuationToken = "";
  let page = 0;
  while (true) {
    page += 1;
    let response;
    try {
      response = await fetchR2S3({
        method: "GET",
        bucketName,
        query: {
          "list-type": "2",
          "max-keys": "1000",
          ...(continuationToken ? { "continuation-token": continuationToken } : {}),
        },
        credentials,
        timeoutMs: options.r2ListTimeoutMs,
      });
    } catch (error) {
      errors.push({
        bucketName,
        operation: "list",
        page,
        errorClass: error?.name === "AbortError" ? "r2_request_timeout" : "r2_network_error",
        message: sanitizeCredentialText(error?.message || String(error), credentials).slice(0, 300),
      });
      break;
    }
    const bodyText = await response.text();
    if (!response.ok) {
      errors.push({
        bucketName,
        operation: "list",
        page,
        status: response.status,
        errorClass: classifyR2HttpError(response.status, bodyText),
        code: extractXmlTag(bodyText, "Code") || null,
        message: sanitizeCredentialText(extractXmlTag(bodyText, "Message") || bodyText, credentials).slice(0, 300),
      });
      break;
    }
    const parsed = parseListObjectsV2Xml(bodyText);
    objects.push(...parsed.contents);
    if (!parsed.isTruncated) {
      return {
        ok: true,
        bucketName,
        listedAt: new Date().toISOString(),
        pages: page,
        truncated: false,
        objectCount: objects.length,
        totalBytes: objects.reduce((sum, object) => sum + Number(object.size || 0), 0),
        objects,
        errors,
      };
    }
    if (!parsed.nextContinuationToken) {
      errors.push({
        bucketName,
        operation: "list",
        page,
        errorClass: "r2_missing_continuation_token",
        message: "ListObjectsV2 returned IsTruncated=true without NextContinuationToken.",
      });
      break;
    }
    continuationToken = parsed.nextContinuationToken;
  }
  return {
    ok: false,
    bucketName,
    listedAt: new Date().toISOString(),
    pages: page,
    truncated: true,
    objectCount: objects.length,
    totalBytes: objects.reduce((sum, object) => sum + Number(object.size || 0), 0),
    objects,
    errors,
  };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function headR2Objects(bucketName, objects, options, credentials) {
  const selected = objects.slice(0, options.r2HeadLimit);
  const results = await mapConcurrent(selected, options.r2HeadConcurrency, async (object) => {
    try {
      const response = await fetchR2S3({
        method: "HEAD",
        bucketName,
        key: object.key,
        credentials,
        timeoutMs: options.r2ListTimeoutMs,
      });
      if (!response.ok) {
        return {
          key: object.key,
          ok: false,
          status: response.status,
          errorClass: classifyR2HttpError(response.status, ""),
        };
      }
      return {
        key: object.key,
        ok: true,
        ...safeContentMetadataFromHeaders(response.headers),
      };
    } catch (error) {
      return {
        key: object.key,
        ok: false,
        errorClass: error?.name === "AbortError" ? "r2_request_timeout" : "r2_network_error",
        message: sanitizeCredentialText(error?.message || String(error), credentials).slice(0, 300),
      };
    }
  });
  return {
    bucketName,
    requested: objects.length,
    attempted: selected.length,
    skippedDueToLimit: Math.max(0, objects.length - selected.length),
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

function defaultR2ListBuckets() {
  return Array.from(new Set(Object.values(R2_BUCKETS).map((entry) => entry.bucketName)));
}

async function collectFullR2Inventory(options, evidenceDir, bucketList) {
  const outputDir = path.join(evidenceDir, "r2-full-inventory");
  ensureDir(outputDir);
  const credentials = resolveR2S3Credentials();
  const credentialStatus = localR2CredentialStatus();
  const summary = {
    generatedAt: new Date().toISOString(),
    skipped: Boolean(options.skipR2FullListing),
    credentialsPresent: credentialStatus,
    endpoint: credentials.accountId ? "https://[redacted-account].r2.cloudflarestorage.com" : null,
    bucketsRequested: options.r2ListBuckets || defaultR2ListBuckets(),
    buckets: [],
    totalObjects: 0,
    totalBytes: 0,
    allRequestedBucketsListed: false,
    headMetadataEnabled: options.r2HeadMetadata,
    headLimit: options.r2HeadLimit,
    headConcurrency: options.r2HeadConcurrency,
  };
  const errors = [];
  if (options.skipR2FullListing) {
    errors.push({ operation: "full_inventory", errorClass: "operator_requested_skip" });
    writeJson(path.join(outputDir, "summary.json"), summary);
    writeJson(path.join(outputDir, "errors.json"), errors);
    return { available: false, complete: false, skipped: true, summary, errors, inventories: {}, headMetadata: {} };
  }
  if (!credentials.present) {
    errors.push({ operation: "full_inventory", errorClass: "missing_r2_s3_credentials" });
    writeJson(path.join(outputDir, "summary.json"), summary);
    writeJson(path.join(outputDir, "errors.json"), errors);
    return { available: false, complete: false, skipped: false, summary, errors, inventories: {}, headMetadata: {} };
  }
  const bucketsRequested = options.r2ListBuckets || defaultR2ListBuckets();
  const inventories = {};
  const headMetadata = {};
  for (const bucketName of bucketsRequested) {
    const inventory = await listR2BucketObjects(bucketName, options, credentials);
    inventories[bucketName] = inventory;
    writeJson(path.join(outputDir, `${bucketName}.json`), inventory);
    summary.buckets.push({
      bucketName,
      ok: inventory.ok,
      objectCount: inventory.objectCount,
      totalBytes: inventory.totalBytes,
      pages: inventory.pages,
      truncated: inventory.truncated,
      errorClass: inventory.errors?.[0]?.errorClass || null,
    });
    summary.totalObjects += inventory.objectCount;
    summary.totalBytes += inventory.totalBytes;
    errors.push(...(inventory.errors || []));
    if (inventory.ok && options.r2HeadMetadata && inventory.objects.length) {
      const metadata = await headR2Objects(bucketName, inventory.objects, options, credentials);
      headMetadata[bucketName] = metadata;
      writeJson(path.join(outputDir, `${bucketName}-head-metadata.json`), metadata);
      summary.buckets[summary.buckets.length - 1].headAttempted = metadata.attempted;
      summary.buckets[summary.buckets.length - 1].headSucceeded = metadata.succeeded;
      summary.buckets[summary.buckets.length - 1].headFailed = metadata.failed;
      summary.buckets[summary.buckets.length - 1].headSkippedDueToLimit = metadata.skippedDueToLimit;
      errors.push(...metadata.results.filter((item) => !item.ok).slice(0, 1000).map((item) => ({
        bucketName,
        operation: "head",
        keyHash: sha256Hex(item.key),
        keyRedacted: redactedKey(item.key),
        errorClass: item.errorClass,
        status: item.status || null,
      })));
    }
  }
  summary.allRequestedBucketsListed = summary.buckets.length > 0 && summary.buckets.every((bucket) => bucket.ok);
  writeJson(path.join(outputDir, "summary.json"), summary);
  writeJson(path.join(outputDir, "errors.json"), errors);
  return {
    available: summary.buckets.some((bucket) => bucket.ok),
    complete: summary.allRequestedBucketsListed,
    skipped: false,
    summary,
    errors,
    inventories,
    headMetadata,
    outputDir,
  };
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
  const indexesByTable = new Map();
  for (const row of sqliteRows.filter((entry) => entry.type === "index")) {
    if (!indexesByTable.has(row.tbl_name)) indexesByTable.set(row.tbl_name, []);
    indexesByTable.get(row.tbl_name).push({ name: row.name, unique: /\bUNIQUE\b/i.test(row.sql || "") ? 1 : 0, origin: "sqlite_master" });
  }
  for (const table of tables) {
    const tableSql = sqliteRows.find((row) => row.type === "table" && row.name === table)?.sql || "";
    schema.tables[table] = {
      columns: parseCreateTableColumns(tableSql),
      indexes: indexesByTable.get(table) || [],
      foreignKeys: parseCreateTableForeignKeyCount(tableSql),
      sql: tableSql,
    };
  }
  return schema;
}

function splitSqlDefinitionList(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      current += character;
      if (character === quote && body[index + 1] === quote) {
        current += body[index + 1];
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseCreateTableColumns(sql) {
  const match = String(sql || "").match(/\(([\s\S]*)\)\s*$/);
  if (!match) return [];
  return splitSqlDefinitionList(match[1])
    .map((definition, cid) => {
      const trimmed = definition.trim();
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY)\b/i.test(trimmed)) return null;
      const nameMatch = trimmed.match(/^"([^"]+)"|^`([^`]+)`|^\[([^\]]+)\]|^([A-Za-z_][A-Za-z0-9_]*)/);
      const name = nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || nameMatch?.[4] || "";
      if (!name) return null;
      const rest = trimmed.slice(nameMatch[0].length).trim();
      const typeMatch = rest.match(/^([A-Za-z0-9_()]+)/);
      return {
        cid,
        name,
        type: typeMatch?.[1] || "",
        notnull: /\bNOT\s+NULL\b/i.test(rest) ? 1 : 0,
        dflt_value: extractDefaultValue(rest),
        pk: /\bPRIMARY\s+KEY\b/i.test(rest) ? 1 : 0,
      };
    })
    .filter(Boolean);
}

function extractDefaultValue(definitionRest) {
  const match = String(definitionRest || "").match(/\bDEFAULT\s+((?:'[^']*')|(?:"[^"]*")|(?:\([^)]*\))|[^\s,]+)/i);
  return match ? match[1] : null;
}

function parseCreateTableForeignKeyCount(sql) {
  const count = (String(sql || "").match(/\bFOREIGN\s+KEY\b/gi) || []).length;
  return Array.from({ length: count }, (_, id) => ({ id }));
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
    reason: "execution_blocked_read_only_full_inventory_task",
    d1MutationsPlanned: [],
    r2BackupPlanned: [],
    r2DeleteCandidates: [
      ...candidates.map((ref) => ({
      bucket: ref.bucket,
      keyHash: sha256Hex(ref.key || ""),
      keyRedacted: redactedKey(ref.key || ""),
      category: ref.category,
      table: ref.table,
      column: ref.column,
      source: "d1_reference_classification",
    })),
      ...((relationship.fullR2Analysis?.unreferencedDeleteCandidates || []).map((item) => ({
        bucket: item.bucketName,
        keyHash: item.keyHash,
        keyRedacted: item.keyRedacted,
        category: item.classification,
        table: "-",
        column: "-",
        source: "full_r2_inventory_unreferenced_object",
        size: item.size,
      }))),
    ],
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
      d1ReferencedMissingFromFullInventory: relationship.fullR2Analysis?.d1ReferenceMissing?.length || 0,
      fullR2UnreferencedObjects: relationship.fullR2Analysis?.unreferencedObjects?.length || 0,
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
  const fullRows = (context.fullR2Inventory?.summary?.buckets || []).map((bucket) => [
    bucket.bucketName,
    bucket.ok ? "listed" : "failed",
    bucket.objectCount,
    bytesLabel(bucket.totalBytes),
    bucket.pages,
    bucket.headAttempted ?? "-",
    bucket.headFailed ?? "-",
    bucket.errorClass || "-",
  ]);
  return `# R2 Inventory Report

Generated: ${context.generatedAt}

## Repo Bindings

${markdownTable(["Binding", "Bucket", "Remote"], bindingRows)}

## Live Buckets Visible To Wrangler

${markdownTable(["Bucket", "Repo status"], liveRows)}

\`bitbi-public-media\` is visible in the Cloudflare account when Wrangler lists buckets, but it is not declared as an Auth Worker R2 binding. It was not added by this audit.

## Full Bucket Listing Status

Full object enumeration through local S3-compatible R2 credentials is **${context.fullR2ListingAvailable ? "available" : "not available"}**.

Credential presence check (values never printed): \`${JSON.stringify(context.r2CredentialStatus)}\`

Requested buckets: \`${(context.fullR2Inventory?.summary?.bucketsRequested || []).join("`, `") || "-"}\`

${markdownTable(["Bucket", "Status", "Objects", "Bytes", "Pages", "HEAD attempted", "HEAD failed", "Error"], fullRows)}

Raw object manifests and HEAD metadata are stored only in \`${context.fullR2Inventory?.outputDir || path.join(context.evidenceDir, "r2-full-inventory")}\`.

Destructive cleanup remains disabled in this package. Full inventory is used for proof and later-candidate classification only.

## D1-Referenced R2 Categories

Unique D1-referenced R2 objects: **${context.uniqueR2ReferenceCount}**

${markdownTable(["Category", "References"], categoryRows)}

## Bounded R2 Existence Check

- Checked: ${context.r2Verification.checked?.filter((item) => item.checked).length || 0}
- Missing among checked: ${context.r2Verification.missing?.length || 0}
- Unchecked remaining due to limit: ${context.r2Verification.uncheckedRemaining || 0}

## Full Inventory Relationship Summary

- Full R2 inventory objects listed: ${context.fullR2Analysis?.inventoryObjectCount || 0}
- D1 references found in full R2 inventory: ${context.fullR2Analysis?.d1ReferenceExisting?.length || 0}
- D1 references missing from full R2 inventory: ${context.fullR2Analysis?.d1ReferenceMissing?.length || 0}
- D1 references not checked because a bucket did not list successfully: ${context.fullR2Analysis?.d1ReferenceUnknown?.length || 0}
- Full R2 objects without a D1 reference: ${context.fullR2Analysis?.unreferencedObjects?.length || 0}
`;
}

function renderR2PrefixReport(context) {
  const fullPrefixRows = Object.entries(context.fullR2Analysis?.unreferencedPrefixCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([prefix, count]) => [prefix, count]);
  const prefixRows = Object.entries(context.r2PrefixCounts).sort((a, b) => b[1] - a[1]).map(([prefix, count]) => [prefix, count]);
  return `# R2 Prefix And Bucket Structure Report

Generated: ${context.generatedAt}

This report summarizes D1-referenced key families and, when full R2 listing is available, unreferenced bucket/prefix families. Raw object keys are local-only evidence.

## D1-Referenced Prefix Families

${markdownTable(["Prefix family", "D1 references"], prefixRows)}

## Full R2 Unreferenced Prefix Families

${markdownTable(["Bucket / prefix family", "Unreferenced objects"], fullPrefixRows)}
`;
}

function renderRelationshipReport(context) {
  const boundedRows = context.r2Verification.missing?.slice(0, 50).map((item) => [
    item.bucket,
    item.keyRedacted,
    item.references.map((ref) => `${ref.table}.${ref.column}`).join(", "),
    item.errorClass || "missing",
  ]) || [];
  const fullMissingRows = (context.fullR2Analysis?.d1ReferenceMissing || []).slice(0, 80).map((item) => [
    item.bucketName,
    item.keyRedacted,
    item.references.map((ref) => `${ref.table}.${ref.column}`).join(", "),
    item.reason,
  ]);
  const unreferencedRows = Object.entries(context.fullR2Analysis?.unreferencedCategoryCounts || {})
    .sort()
    .map(([category, count]) => [category, count]);
  return `# D1 / R2 / Website Relationship Matrix

Generated: ${context.generatedAt}

## Summary

- D1 R2-key references collected: ${context.r2Refs.length}
- Unique R2 objects referenced by D1: ${context.uniqueR2ReferenceCount}
- Protected-account references: ${context.r2Refs.filter((ref) => String(ref.category || "").startsWith("protected_")).length}
- Public media counts: \`${JSON.stringify(context.publicMediaSummary)}\`
- Missing checked objects: ${context.r2Verification.missing?.length || 0}
- D1 references missing in full R2 inventory: ${context.fullR2Analysis?.d1ReferenceMissing?.length || 0}
- R2 objects without D1 references: ${context.fullR2Analysis?.unreferencedObjects?.length || 0}
- R2 later delete candidates from full inventory: ${context.fullR2Analysis?.unreferencedDeleteCandidates?.length || 0}

## Full R2 Inventory Comparison

${markdownTable(["Classification", "Count"], unreferencedRows)}

## D1 References Missing From Full R2 Inventory

${markdownTable(["Bucket", "Key", "Referenced by", "Evidence"], fullMissingRows)}

## Missing Checked Objects

${markdownTable(["Bucket", "Key", "Referenced by", "Evidence"], boundedRows)}

Rows and object keys in raw form are stored only in local evidence.
`;
}

function renderBrokenMediaReport(context) {
  const missing = (context.fullR2Analysis?.d1ReferenceMissing?.length
    ? context.fullR2Analysis.d1ReferenceMissing
    : context.r2Verification.missing) || [];
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

D1-referenced R2 objects with missing result: **${missing.length}**.

${markdownTable(
    ["Bucket", "Key", "Category", "References"],
    missing.slice(0, 80).map((item) => [
      item.bucketName || item.bucket,
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
  const unreferencedRows = Object.entries(context.fullR2Analysis?.unreferencedCategoryCounts || {})
    .sort()
    .map(([category, count]) => [category, count]);
  return `# Legacy Classification Report

Generated: ${context.generatedAt}

Classification is conservative. Legacy alone does not mean delete; unassignable proof is required.

## D1-Referenced Object Classification

${markdownTable(["Classification", "Reference count"], rows)}

## Full R2 Unreferenced Object Classification

${markdownTable(["Classification", "Object count"], unreferencedRows)}

## Current Safety Decision

Execution remains blocked because this task is a read-only full-inventory pass. D1-referenced protected data is kept. Unknown, audit/export, public-bucket, and protected-owner objects are retained as blockers/keeps, not deleted.
`;
}

function renderDeleteCandidatesReport(context) {
  const candidates = context.cleanupPlan.r2DeleteCandidates || [];
  const blocked = context.cleanupPlan.blockedCandidates || [];
  const blockedCounts = summarizeBy(blocked, (item) => item.category);
  const fullInventoryCandidateCounts = summarizeBy(context.fullR2Analysis?.unreferencedDeleteCandidates || [], (item) => item.classification);
  return `# Delete Candidates Report

Generated: ${context.generatedAt}

## Execution Decision

Cleanup execution eligible: **${context.cleanupPlan.executeEligible ? "yes" : "no"}**

Reason: ${context.cleanupPlan.reason}

No deletion was executed. These are candidate classifications for a later explicit cleanup task only.

## Candidate Counts From Full R2 Inventory

${markdownTable(["Category", "Count"], Object.entries(fullInventoryCandidateCounts).sort().map(([category, count]) => [category, count]))}

## R2 Delete Candidates

${markdownTable(["Bucket", "Key", "Category", "Source"], candidates.map((item) => [
    item.bucket,
    item.keyRedacted,
    item.category,
    item.source || `${item.table}.${item.column}`,
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

function renderFullR2RedactedReport(context) {
  const bucketRows = (context.fullR2Inventory?.summary?.buckets || []).map((bucket) => [
    bucket.bucketName,
    bucket.ok ? "listed" : "failed",
    bucket.objectCount,
    bytesLabel(bucket.totalBytes),
    bucket.pages,
    bucket.headAttempted ?? "-",
    bucket.headSucceeded ?? "-",
    bucket.headFailed ?? "-",
    bucket.errorClass || "-",
  ]);
  const categoryRows = Object.entries(context.fullR2Analysis?.unreferencedCategoryCounts || {})
    .sort()
    .map(([category, count]) => [category, count]);
  const candidateRows = (context.fullR2Analysis?.unreferencedDeleteCandidates || []).slice(0, 80).map((item) => [
    item.bucketName,
    item.keyRedacted,
    item.classification,
    bytesLabel(item.size),
    item.prefixFamily,
  ]);
  const blockedRows = (context.fullR2Analysis?.unreferencedBlockedOrKept || []).slice(0, 80).map((item) => [
    item.bucketName,
    item.keyRedacted,
    item.classification,
    item.reason,
  ]);
  return `# Full R2 Object Inventory Redacted Report

Generated: ${context.generatedAt}

Raw full object keys, ETags, and HEAD metadata are stored only in local evidence under \`${context.fullR2Inventory?.outputDir || path.join(context.evidenceDir, "r2-full-inventory")}\`.

## Bucket Listing Summary

${markdownTable(["Bucket", "Status", "Objects", "Bytes", "Pages", "HEAD attempted", "HEAD ok", "HEAD failed", "Error"], bucketRows)}

## D1 / Full R2 Comparison

- D1-referenced objects present in listed R2 inventory: ${context.fullR2Analysis?.d1ReferenceExisting?.length || 0}
- D1-referenced objects missing in listed R2 inventory: ${context.fullR2Analysis?.d1ReferenceMissing?.length || 0}
- D1 references not checked because a bucket did not list successfully: ${context.fullR2Analysis?.d1ReferenceUnknown?.length || 0}
- R2 objects without D1 references: ${context.fullR2Analysis?.unreferencedObjects?.length || 0}

## Unreferenced Object Classifications

${markdownTable(["Classification", "Object count"], categoryRows)}

## Later Delete Candidate Samples

${markdownTable(["Bucket", "Key", "Classification", "Size", "Prefix family"], candidateRows)}

## Kept / Blocked Unreferenced Samples

${markdownTable(["Bucket", "Key", "Classification", "Reason"], blockedRows)}
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
  const bucketSummary = (context.fullR2Inventory?.summary?.buckets || []).map((bucket) => (
    `- ${bucket.bucketName}: ${bucket.ok ? `${bucket.objectCount} objects / ${bytesLabel(bucket.totalBytes)}` : `not listed (${bucket.errorClass || "no error detail"})`}`
  ));
  return `# Tenant Asset Center Live Cleanup Final Summary

Generated: ${context.generatedAt}

## Result

This run produced a live D1 inventory, full S3-compatible R2 object inventory when credentials were available, D1/R2 relationship comparisons, classifications, and a cleanup dry-run plan.

No cleanup was executed.

## Full R2 Listing Status

Full R2 listing available: **${context.fullR2ListingAvailable ? "yes" : "no"}**.

${context.fullR2ListingAvailable
    ? bucketSummary.join("\n")
    : "The Codex command environment did not expose the required R2 S3-compatible credential variables. Values were never printed. The run failed closed and did not perform object deletion or D1 mutation."}

## Why Execution Was Blocked

This package is currently a read-only full-inventory pass. Deletion/apply mode remains intentionally blocked until a separate explicit cleanup task validates backup and apply behavior.

## Counts

- D1 tables inventoried: ${Object.keys(context.schema.tables).length}
- D1 R2 references collected: ${context.r2Refs.length}
- Unique D1-referenced R2 objects: ${context.uniqueR2ReferenceCount}
- Full R2 inventory objects listed: ${context.fullR2Analysis?.inventoryObjectCount || 0}
- Full R2 inventory bytes listed: ${bytesLabel(context.fullR2Inventory?.summary?.totalBytes || 0)}
- D1 references missing from full R2 inventory: ${context.fullR2Analysis?.d1ReferenceMissing?.length || 0}
- R2 objects without D1 references: ${context.fullR2Analysis?.unreferencedObjects?.length || 0}
- Later delete candidates from full inventory: ${context.fullR2Analysis?.unreferencedDeleteCandidates?.length || 0}
- R2 objects checked by bounded get: ${context.r2Verification.checked?.filter((item) => item.checked).length || 0}
- Missing checked objects: ${context.r2Verification.missing?.length || 0}
- D1 mutations executed: 0
- R2 deletes executed: 0

## Next Safe Step

${context.fullR2ListingAvailable
    ? "Review the full-inventory reports and local raw evidence. A later cleanup task may implement backup/apply behavior for candidates that remain proven unassignable, but this run made no D1 or R2 mutations."
    : "Run the same dry-run from a shell/process where `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are visible to Node. Do not paste the values into the repo or reports. This run made no D1 or R2 mutations."}
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
    "FULL_R2_OBJECT_INVENTORY_REDACTED.md": renderFullR2RedactedReport(context),
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

function bytesLabel(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function buildR2InventoryObjectMap(fullInventory) {
  const map = new Map();
  for (const [bucketName, inventory] of Object.entries(fullInventory?.inventories || {})) {
    if (!inventory?.ok) continue;
    for (const object of inventory.objects || []) {
      map.set(`${bucketName}\0${object.key}`, { bucketName, ...object });
    }
  }
  return map;
}

function classifyUnreferencedR2Object({ bucketName, object, protectedUserIds }) {
  const key = String(object.key || "");
  const family = prefixFamily(key);
  const protectedMatch = Array.from(protectedUserIds || []).find((id) => key.includes(id));
  if (protectedMatch) {
    if (bucketName === R2_BUCKETS.PRIVATE_MEDIA.bucketName || key.startsWith(`avatars/${protectedMatch}`)) {
      return { classification: "protected_user_avatar", reason: "object key contains a protected owner id" };
    }
    if (key.includes("/derivatives/") || /\/(thumb|medium|derivative)[._/-]/i.test(key)) {
      return { classification: "protected_user_derivative", reason: "object key contains a protected owner id and derivative signal" };
    }
    if (/poster/i.test(key)) return { classification: "protected_user_poster", reason: "object key contains a protected owner id and poster signal" };
    return { classification: "protected_user_source_asset", reason: "object key contains a protected owner id" };
  }
  if (PRIOR_TEST_USER_IDS.some((id) => key.includes(id))) {
    return { classification: "prior_test_account_residue_delete_candidate", reason: "object key contains an exact prior test user id" };
  }
  if (bucketName === R2_BUCKETS.AUDIT_ARCHIVE.bucketName || /^tenant-asset-cleanups\//.test(key) || /audit|evidence|export|archive/i.test(key)) {
    return { classification: "audit_or_legal_retention_keep", reason: "audit/export/evidence retention signal" };
  }
  if (/news[-_/]?pulse/i.test(key)) return { classification: "news_pulse_asset", reason: "known platform news pulse prefix/signal" };
  if (/homepage|hero[-_/]?video|hero/i.test(key)) {
    return { classification: "protected_homepage_hero_asset_or_derivative", reason: "known homepage hero/platform asset signal" };
  }
  if (/tmp|temp|replay|cache/i.test(key)) {
    const lastModified = Date.parse(object.lastModified || "");
    const ageDays = Number.isFinite(lastModified) ? (Date.now() - lastModified) / (24 * 60 * 60 * 1000) : null;
    if (ageDays != null && ageDays > 30) {
      return { classification: "ai_usage_temp_or_replay_expired", reason: "unreferenced temp/replay/cache object older than 30 days" };
    }
    return { classification: "ai_usage_temp_or_replay_current", reason: "unreferenced temp/replay/cache object within review window or unknown age" };
  }
  if (bucketName === R2_BUCKETS.PUBLIC_MEDIA.bucketName) {
    return { classification: "unknown_blocker_keep", reason: "dashboard-visible public bucket is not bound in Auth Worker and needs route/source review" };
  }
  if (bucketName === R2_BUCKETS.USER_IMAGES.bucketName && /^users\/[^/]+\//.test(key)) {
    if (key.includes("/derivatives/") || /\/(thumb|medium|derivative)[._/-]/i.test(key)) {
      return { classification: "orphaned_unreferenced_derivative", reason: "unreferenced USER_IMAGES derivative outside protected owner ids" };
    }
    return { classification: "orphaned_unreferenced_media", reason: "unreferenced USER_IMAGES object outside protected owner ids" };
  }
  if (bucketName === R2_BUCKETS.PRIVATE_MEDIA.bucketName && /^avatars\/[^/]+/.test(key)) {
    return { classification: "orphaned_unreferenced_media", reason: "unreferenced PRIVATE_MEDIA avatar outside protected owner ids" };
  }
  return { classification: "unknown_blocker_keep", reason: `unreferenced object in ${family} has no provable owner/source signal` };
}

function analyzeFullR2Relationship({ r2Refs, fullR2Inventory, protectedUserIds }) {
  const dedupedRefs = dedupeR2Refs(r2Refs);
  const listedBucketNames = new Set(Object.entries(fullR2Inventory?.inventories || {})
    .filter(([, inventory]) => inventory?.ok)
    .map(([bucketName]) => bucketName));
  const inventoryMap = buildR2InventoryObjectMap(fullR2Inventory);
  const d1ReferenceKeys = new Set();
  const d1ReferenceExisting = [];
  const d1ReferenceMissing = [];
  const d1ReferenceUnknown = [];
  for (const ref of dedupedRefs) {
    const bucketName = r2BucketName(ref.bucket);
    const mapKey = `${bucketName}\0${ref.key}`;
    d1ReferenceKeys.add(mapKey);
    const entry = {
      ...ref,
      bucketName,
      keyHash: sha256Hex(ref.key),
      keyRedacted: redactedKey(ref.key),
    };
    if (!listedBucketNames.has(bucketName)) d1ReferenceUnknown.push({ ...entry, reason: "bucket_not_successfully_listed" });
    else if (inventoryMap.has(mapKey)) d1ReferenceExisting.push(entry);
    else d1ReferenceMissing.push({ ...entry, reason: "d1_reference_not_found_in_full_r2_inventory" });
  }
  const unreferencedObjects = [];
  for (const [bucketName, inventory] of Object.entries(fullR2Inventory?.inventories || {})) {
    if (!inventory?.ok) continue;
    for (const object of inventory.objects || []) {
      const mapKey = `${bucketName}\0${object.key}`;
      if (d1ReferenceKeys.has(mapKey)) continue;
      const classified = classifyUnreferencedR2Object({ bucketName, object, protectedUserIds });
      unreferencedObjects.push({
        bucketName,
        key: object.key,
        keyHash: sha256Hex(object.key),
        keyRedacted: redactedKey(object.key),
        size: Number(object.size || 0),
        lastModified: object.lastModified || null,
        prefixFamily: prefixFamily(object.key),
        ...classified,
      });
    }
  }
  const deleteCategories = new Set([
    "prior_test_account_residue_delete_candidate",
    "orphaned_unreferenced_media",
    "orphaned_unreferenced_derivative",
    "ai_usage_temp_or_replay_expired",
  ]);
  return {
    available: Boolean(fullR2Inventory?.available),
    complete: Boolean(fullR2Inventory?.complete),
    listedBucketNames: Array.from(listedBucketNames).sort(),
    inventoryObjectCount: inventoryMap.size,
    d1ReferenceExisting,
    d1ReferenceMissing,
    d1ReferenceUnknown,
    unreferencedObjects,
    unreferencedDeleteCandidates: unreferencedObjects.filter((item) => deleteCategories.has(item.classification)),
    unreferencedBlockedOrKept: unreferencedObjects.filter((item) => !deleteCategories.has(item.classification)),
    unreferencedCategoryCounts: summarizeBy(unreferencedObjects, (item) => item.classification),
    unreferencedPrefixCounts: summarizeBy(unreferencedObjects, (item) => `${item.bucketName}:${item.prefixFamily}`),
  };
}

function assertExecutionAllowed(context, options) {
  const blockers = [];
  if (context.users.active.length !== 3) blockers.push("protected_allowlist_not_exactly_three_active_users");
  if (context.users.priorTestRows.length > 0) blockers.push("prior_test_email_rows_still_present");
  if (!context.fullR2ListingAvailable) blockers.push("full_r2_listing_unavailable");
  if (!context.fullR2Inventory?.complete) blockers.push("full_r2_listing_not_complete_for_all_requested_buckets");
  if (context.fullR2Analysis?.d1ReferenceMissing?.length > 0) blockers.push("d1_referenced_r2_objects_missing_from_full_inventory");
  if (!context.fullR2ListingAvailable && context.r2Verification.uncheckedRemaining > 0) blockers.push("r2_reference_check_limit_left_unchecked_objects");
  if ((context.cleanupPlan.blockedCandidates || []).length > 0) blockers.push("blocked_or_unknown_candidates_present");
  if (!context.cleanupPlan.executeEligible) blockers.push("cleanup_plan_not_execute_eligible");
  if (options.backupR2Candidates && (context.cleanupPlan.r2DeleteCandidates || []).length > 0) blockers.push("r2_backup_not_implemented_without_full_inventory");
  blockers.push("execution_disabled_for_read_only_full_inventory_task");
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
  const fullR2Inventory = await collectFullR2Inventory(options, evidenceDir, r2BucketList);
  commandsRun.push("S3 ListObjectsV2 full R2 inventory via signed HTTPS requests (credentials redacted)");
  const fullR2ListingAvailable = Boolean(fullR2Inventory.available);
  const fullR2Analysis = analyzeFullR2Relationship({ r2Refs, fullR2Inventory, protectedUserIds });
  const shouldRunBoundedR2Fallback = !fullR2ListingAvailable && options.skipR2FullListing && !options.skipR2ExistenceCheck;
  const r2Verification = fullR2ListingAvailable
    ? {
      skipped: true,
      reason: "superseded_by_full_r2_inventory",
      checked: [],
      missing: [],
      uncheckedRemaining: 0,
    }
    : shouldRunBoundedR2Fallback
      ? verifyR2References(r2Refs, options)
      : {
        skipped: true,
        reason: fullR2Inventory.skipped ? "operator_requested_skip" : "full_r2_inventory_unavailable_or_incomplete",
        checked: [],
        missing: [],
        uncheckedRemaining: uniqueR2ReferenceCount,
      };
  const storageAccounting = await collectStorageAccounting(schema, users, options);
  const publicMediaSummary = await collectPublicMediaSummary(schema, options);
  const r2CategoryCounts = summarizeBy(r2Refs, (ref) => ref.category);
  const r2PrefixCounts = summarizeBy(r2Refs, (ref) => prefixFamily(ref.key));
  const gates = {
    protectedAllowlistExactThree: users.active.length === 3,
    priorTestEmailsAbsent: users.priorTestRows.length === 0,
    fullR2ListingAvailable,
    fullR2ListingComplete: Boolean(fullR2Inventory.complete),
    r2ReferenceExistenceCheckComplete: !r2Verification.uncheckedRemaining,
    noD1MutationInDryRun: true,
    noR2MutationInDryRun: true,
  };
  const relationship = { uniqueR2ReferenceCount, r2Verification, fullR2Analysis };
  const cleanupPlan = buildDeletePlan(r2Refs, relationship, gates);

  const context = {
    generatedAt,
    evidenceDir,
    releaseLatest,
    r2Bindings,
    r2BucketList,
    r2CredentialStatus,
    fullR2ListingAvailable,
    fullR2Inventory,
    fullR2Analysis,
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
  writeJson(path.join(evidenceDir, "full-r2-relationship-analysis.json"), fullR2Analysis);
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
    fullR2ListingAvailable,
    fullR2ListingComplete: Boolean(fullR2Inventory.complete),
    fullR2Buckets: fullR2Inventory.summary?.buckets || [],
    fullR2ObjectCount: fullR2Analysis.inventoryObjectCount || 0,
    fullR2TotalBytes: fullR2Inventory.summary?.totalBytes || 0,
    d1ReferencesMissingFromFullR2Inventory: fullR2Analysis.d1ReferenceMissing?.length || 0,
    unreferencedR2Objects: fullR2Analysis.unreferencedObjects?.length || 0,
    unreferencedR2DeleteCandidates: fullR2Analysis.unreferencedDeleteCandidates?.length || 0,
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
    fullR2ListingAvailable,
    fullR2ListingComplete: Boolean(fullR2Inventory.complete),
    fullR2ObjectCount: fullR2Analysis.inventoryObjectCount || 0,
    fullR2TotalBytes: fullR2Inventory.summary?.totalBytes || 0,
    d1ReferencesMissingFromFullR2Inventory: fullR2Analysis.d1ReferenceMissing?.length || 0,
    unreferencedR2Objects: fullR2Analysis.unreferencedObjects?.length || 0,
    unreferencedR2DeleteCandidates: fullR2Analysis.unreferencedDeleteCandidates?.length || 0,
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
