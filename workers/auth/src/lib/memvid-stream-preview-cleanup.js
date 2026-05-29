import {
  normalizeStreamUid,
  parseStreamProviderMetadata,
} from "./cloudflare-stream-previews.js";
import { nowIso } from "./tokens.js";

const DELETE_RETRY_STATUSES = new Set(["delete_pending", "delete_failed", "not_configured"]);

function clampLimit(value, { fallback = 10, min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function streamAccountId(env = {}) {
  return String(env.CLOUDFLARE_ACCOUNT_ID || env.STREAM_ACCOUNT_ID || "").trim();
}

function streamApiToken(env = {}) {
  return String(env.CLOUDFLARE_STREAM_API_TOKEN || env.STREAM_API_TOKEN || "").trim();
}

function cloudflareApiDetails(body = {}) {
  const parts = [];
  for (const field of ["errors", "messages"]) {
    const rows = Array.isArray(body?.[field]) ? body[field] : [];
    for (const row of rows.slice(0, 3)) {
      const code = String(row?.code || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40);
      const message = String(row?.message || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 180);
      if (code || message) parts.push(`${field}.${code || "message"}: ${message || "no message"}`);
    }
  }
  return parts.join("; ");
}

function safeErrorMessage(value, fallback = "Cloudflare Stream delete failed.") {
  return String(value || fallback)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function mergeDeleteMetadata(raw, patch) {
  const metadata = parseStreamProviderMetadata(raw);
  const providerMetadata = metadata.provider_metadata && typeof metadata.provider_metadata === "object"
    ? metadata.provider_metadata
    : {};
  return JSON.stringify({
    ...metadata,
    provider: "cloudflare_stream",
    provider_metadata: {
      ...providerMetadata,
      ...patch,
    },
  });
}

export async function deleteStreamVideo(env, streamUid, { fetchImpl = fetch } = {}) {
  const uid = normalizeStreamUid(streamUid);
  if (!uid) {
    return {
      ok: false,
      status: "delete_failed",
      error_code: "invalid_stream_uid",
      error_message: "Invalid Cloudflare Stream UID.",
    };
  }
  const accountId = streamAccountId(env);
  const apiToken = streamApiToken(env);
  if (!accountId || !apiToken) {
    return {
      ok: false,
      status: "not_configured",
      error_code: "cloudflare_stream_not_configured",
      error_message: "Cloudflare Stream account/token is not configured for provider cleanup.",
    };
  }
  let res;
  try {
    res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(uid)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    return {
      ok: false,
      status: "delete_pending",
      error_code: "cloudflare_stream_delete_request_failed",
      error_message: safeErrorMessage(error?.message, "Cloudflare Stream delete request failed before Cloudflare responded."),
    };
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body?.success !== false) {
    return { ok: true, status: "deleted", already_deleted: false };
  }
  const details = cloudflareApiDetails(body);
  const notFound = res.status === 404 || /not\s*found/i.test(details);
  if (notFound) {
    return { ok: true, status: "deleted", already_deleted: true };
  }
  return {
    ok: false,
    status: "delete_pending",
    error_code: "cloudflare_stream_delete_failed",
    error_message: safeErrorMessage(details || `Cloudflare Stream delete failed with HTTP ${res.status}.`),
    http_status: res.status,
  };
}

async function updatePreviewDeleteState(env, row, patch) {
  await env.DB.prepare(
    `UPDATE memvid_stream_previews
     SET status = ?,
         updated_at = ?,
         provider_metadata_json = ?
     WHERE id = ?`
  ).bind(
    patch.status || row.status,
    patch.updated_at || nowIso(),
    mergeDeleteMetadata(row.provider_metadata_json, patch.provider_metadata || {}),
    row.id
  ).run();
}

async function listActivePreviewsForAsset(env, asset) {
  const rows = await env.DB.prepare(
    `SELECT id,
            asset_id,
            user_id,
            stream_uid,
            status,
            provider_metadata_json
     FROM memvid_stream_previews
     WHERE asset_id = ?
       AND user_id = ?
       AND status IN ('queued', 'uploading', 'processing', 'ready', 'failed')`
  ).bind(asset.id, asset.user_id).all();
  return rows.results || [];
}

export async function disableAndDeleteMemvidStreamPreviewsForUnpublishedAsset(env, asset, options = {}) {
  if (!asset?.id || !asset?.user_id) {
    return {
      disabled_count: 0,
      delete_attempt_count: 0,
      delete_succeeded_count: 0,
      delete_pending_count: 0,
      skipped: true,
      skipped_reason: "asset_not_resolved",
    };
  }
  const rows = await listActivePreviewsForAsset(env, asset);
  const now = nowIso();
  let deleteAttempts = 0;
  let deleteSucceeded = 0;
  let deletePending = 0;
  let disabled = 0;
  for (const row of rows) {
    disabled += 1;
    await updatePreviewDeleteState(env, row, {
      status: "disabled",
      updated_at: now,
      provider_metadata: {
        unpublished_at: options.unpublishedAt || now,
        delete_requested_at: now,
        delete_status: row.stream_uid ? "delete_pending" : "no_stream_uid",
        delete_attempt_count: Number(parseStreamProviderMetadata(row.provider_metadata_json)?.provider_metadata?.delete_attempt_count || 0),
        delete_source: options.source || "unpublish",
      },
    });
    if (!row.stream_uid) continue;
    deleteAttempts += 1;
    const result = await deleteStreamVideo(env, row.stream_uid, options);
    if (result.ok) deleteSucceeded += 1;
    else deletePending += 1;
    const latest = {
      ...row,
      status: "disabled",
      provider_metadata_json: mergeDeleteMetadata(row.provider_metadata_json, {}),
    };
    await updatePreviewDeleteState(env, latest, {
      status: "disabled",
      updated_at: nowIso(),
      provider_metadata: {
        unpublished_at: options.unpublishedAt || now,
        delete_requested_at: now,
        delete_status: result.ok ? "deleted" : result.status,
        delete_attempt_count: Number(parseStreamProviderMetadata(row.provider_metadata_json)?.provider_metadata?.delete_attempt_count || 0) + 1,
        last_delete_error_code: result.ok ? null : result.error_code,
        last_delete_error_message: result.ok ? null : result.error_message,
        deleted_at: result.ok ? nowIso() : null,
        delete_already_missing: result.already_deleted === true,
      },
    });
  }
  return {
    disabled_count: disabled,
    delete_attempt_count: deleteAttempts,
    delete_succeeded_count: deleteSucceeded,
    delete_pending_count: deletePending,
  };
}

async function listPendingDeletes(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT id,
            asset_id,
            user_id,
            stream_uid,
            status,
            provider_metadata_json
     FROM memvid_stream_previews
     WHERE status IN ('disabled', 'superseded')
       AND stream_uid IS NOT NULL
     ORDER BY updated_at ASC, created_at ASC
     LIMIT ?`
  ).bind(clampLimit(limit, { fallback: 10, max: 100 }) * 4).all();
  return (rows.results || []).filter((row) => {
    const providerMetadata = parseStreamProviderMetadata(row.provider_metadata_json)?.provider_metadata || {};
    return DELETE_RETRY_STATUSES.has(String(providerMetadata.delete_status || "").toLowerCase());
  }).slice(0, clampLimit(limit, { fallback: 10, max: 100 }));
}

export async function retryPendingMemvidStreamPreviewProviderDeletes(env, { limit = 10 } = {}) {
  const rows = await listPendingDeletes(env, limit);
  let deleteAttempts = 0;
  let deleteSucceeded = 0;
  let deletePending = 0;
  for (const row of rows) {
    deleteAttempts += 1;
    const previous = parseStreamProviderMetadata(row.provider_metadata_json)?.provider_metadata || {};
    const result = await deleteStreamVideo(env, row.stream_uid);
    if (result.ok) deleteSucceeded += 1;
    else deletePending += 1;
    await updatePreviewDeleteState(env, row, {
      status: row.status,
      updated_at: nowIso(),
      provider_metadata: {
        delete_status: result.ok ? "deleted" : result.status,
        delete_attempt_count: Number(previous.delete_attempt_count || 0) + 1,
        last_delete_error_code: result.ok ? null : result.error_code,
        last_delete_error_message: result.ok ? null : result.error_message,
        deleted_at: result.ok ? nowIso() : previous.deleted_at || null,
        delete_already_missing: result.already_deleted === true || previous.delete_already_missing === true,
      },
    });
  }
  return {
    scanned_count: rows.length,
    delete_attempt_count: deleteAttempts,
    delete_succeeded_count: deleteSucceeded,
    delete_pending_count: deletePending,
  };
}
