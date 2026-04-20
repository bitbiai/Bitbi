import { listAiImageObjectKeys } from "../../lib/ai-image-derivatives.js";

export function parseBase64Image(str) {
  const dataUriMatch = str.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return { base64: dataUriMatch[2], mimeType: dataUriMatch[1] };
  }
  if (str.length > 100 && /^[A-Za-z0-9+/\n\r]+=*$/.test(str.slice(0, 200))) {
    return { base64: str, mimeType: "image/png" };
  }
  return null;
}

export async function toArrayBuffer(v) {
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

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "folder";
}

export function slugifyAssetFileStem(name, fallback = "asset") {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;
}

export function hasControlCharacters(value) {
  return /[\x00-\x1f\x7f]/.test(String(value || ""));
}

export function getFileExtensionFromName(fileName) {
  const normalized = String(fileName || "").trim();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const bareName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = bareName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < bareName.length - 1) {
    return bareName.slice(dotIndex + 1).toLowerCase();
  }
  return "";
}

export function inferFileExtension({ fileName, mimeType, sourceModule }) {
  const fromName = getFileExtensionFromName(fileName);
  if (fromName) return fromName;

  const normalizedMime = String(mimeType || "").toLowerCase();
  if (normalizedMime === "video/mp4") return "mp4";
  if (normalizedMime === "audio/mpeg") return "mp3";
  if (normalizedMime.startsWith("audio/")) {
    return normalizedMime.slice("audio/".length).replace(/[^a-z0-9]+/g, "") || "mp3";
  }
  if (normalizedMime.startsWith("video/")) {
    return normalizedMime.slice("video/".length).replace(/[^a-z0-9]+/g, "") || "mp4";
  }
  if (String(sourceModule || "").toLowerCase() === "video") return "mp4";
  if (String(sourceModule || "").toLowerCase() === "music") return "mp3";
  return "txt";
}

export function buildRenamedFileName(name, row) {
  const extension = inferFileExtension({
    fileName: row?.file_name ?? row?.fileName,
    mimeType: row?.mime_type ?? row?.mimeType,
    sourceModule: row?.source_module ?? row?.sourceModule,
  });
  return `${slugifyAssetFileStem(name, row?.source_module || row?.sourceModule || "asset")}.${extension}`;
}

export function isMissingTextAssetTableError(error) {
  return String(error || "").includes("no such table") && String(error || "").includes("ai_text_assets");
}

export function sortByCreatedAtDesc(a, b) {
  return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
}

export function flattenAiImageKeys(rows) {
  return (rows?.results || []).flatMap((row) => listAiImageObjectKeys(row));
}

export function inferAiFileAssetType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.startsWith("audio/")) return "sound";
  if (normalized.startsWith("video/")) return "video";
  return "text";
}

export function toAiFileAssetRecord(row) {
  const record = {
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
  if (row.poster_r2_key) {
    record.poster_url = `/api/ai/text-assets/${row.id}/poster`;
    record.poster_width = row.poster_width ?? null;
    record.poster_height = row.poster_height ?? null;
  }
  return record;
}

export function isHexAssetId(value) {
  return typeof value === "string" && /^[a-f0-9]+$/.test(value);
}

export function normalizeRequestedIds(body, fieldName, noun) {
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

export function buildRequestedValuesList(ids) {
  return ids.map(() => "(?)").join(",");
}

export function buildBatchAbortGuardSql(conditionSql) {
  return `SELECT CASE WHEN ${conditionSql} THEN 1 ELSE json_extract('[]', '$[') END`;
}

export function isBulkStateGuardError(error) {
  return String(error).includes("bad JSON path");
}

export function buildBulkMoveFinalStateGuardSql(userId, imageIds, fileIds, folderId) {
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

export function buildBulkDeleteFinalStateGuardSql(userId, imageIds, fileIds) {
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

export function buildCleanupQueueInsertValuesSql(keys) {
  return `INSERT INTO r2_cleanup_queue (r2_key, status, created_at) VALUES ${keys
    .map(() => "(?, 'pending', ?)")
    .join(", ")}`;
}

export function buildCleanupQueueBindings(keys, createdAt) {
  return keys.flatMap((key) => [key, createdAt]);
}

export function buildAiImageInput(modelConfig, prompt, steps, seed) {
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
