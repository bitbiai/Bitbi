import { nowIso, randomTokenHex } from "./tokens.js";
import { sanitizeAssetMetadata } from "./ai-asset-metadata.js";
import { logDiagnostic, getErrorFields } from "../../../../js/shared/worker-observability.mjs";
import {
  REMOTE_MEDIA_URL_POLICY_CODE,
  attachRemoteMediaPolicyContext,
  buildRemoteMediaUrlRejectedMessage,
} from "../../../../js/shared/remote-media-policy.mjs";

export const AI_TEXT_ASSET_MIME_TYPE = "text/plain; charset=utf-8";
export const AI_TEXT_ASSET_MAX_BYTES = 220_000;
export const AI_VIDEO_ASSET_MAX_BYTES = 80_000_000;
const PREVIEW_MAX_CHARS = 220;
const POSTER_MAX_WIDTH = 320;
const POSTER_MAX_HEIGHT = 320;
const POSTER_QUALITY = 82;
const POSTER_FORMAT = "image/webp";
const POSTER_MAX_BYTES = 2_000_000;
const METADATA_JSON_LIMITS = {
  maxEntries: 16,
  maxKeyLength: 80,
  maxStringLength: 8_000,
};

function cleanInlineText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim();
}

function cleanMultilineText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim();
}

function slugifyFileName(value, fallback = "asset") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function formatJsonBlock(value) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return "None";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildModelLine(model) {
  if (!model?.id && !model?.label) return "Unknown";
  if (model?.label && model?.id) {
    return `${model.label} (${model.id})`;
  }
  return model?.label || model?.id || "Unknown";
}

function buildWarningsBlock(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return "None";
  return warnings.map((warning) => `- ${warning}`).join("\n");
}

function buildCompareDiffBlock(diff) {
  if (!diff) return "None";

  const sections = [];
  const shared = Array.isArray(diff.shared) ? diff.shared : [];
  const onlyA = Array.isArray(diff.onlyA) ? diff.onlyA : [];
  const onlyB = Array.isArray(diff.onlyB) ? diff.onlyB : [];

  sections.push(`Identical: ${diff.identical ? "yes" : "no"}`);
  sections.push(
    `Shared chunks:\n${shared.length ? shared.map((item) => `- ${item}`).join("\n") : "- None"}`
  );
  sections.push(
    `Model A distinctive:\n${onlyA.length ? onlyA.map((item) => `- ${item}`).join("\n") : "- None"}`
  );
  sections.push(
    `Model B distinctive:\n${onlyB.length ? onlyB.map((item) => `- ${item}`).join("\n") : "- None"}`
  );

  return sections.join("\n\n");
}

function truncatePreview(value) {
  const text = cleanInlineText(value).replace(/\s+/g, " ");
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

function normalizeMetadataCommon(sourceModule, payload, savedAt) {
  return {
    source_module: sourceModule,
    saved_at: savedAt,
    preset: payload.preset || null,
    model: payload.model || null,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    elapsed_ms: payload.elapsedMs ?? null,
    received_at: payload.receivedAt || null,
  };
}

function serializeTextPayload(title, payload, savedAt) {
  const sections = [
    `Title: ${title}`,
    "Module: Text",
    `Saved At: ${savedAt}`,
    `Run Received At: ${payload.receivedAt || "Unknown"}`,
    `Preset: ${payload.preset || "Preset default"}`,
    `Model: ${buildModelLine(payload.model)}`,
    `Vendor: ${payload.model?.vendor || "Unknown"}`,
    `Elapsed: ${payload.elapsedMs ?? "Unknown"} ms`,
    `Temperature: ${payload.temperature ?? "Unknown"}`,
    `Max Tokens: ${payload.maxTokens ?? "Unknown"}`,
    "",
    "Warnings:",
    buildWarningsBlock(payload.warnings),
    "",
    "Usage:",
    formatJsonBlock(payload.usage),
    "",
    "System Prompt:",
    payload.system || "None",
    "",
    "User Prompt:",
    payload.prompt,
    "",
    "Output:",
    payload.output,
  ];

  return {
    content: sections.join("\n"),
    previewText: truncatePreview(payload.output || payload.prompt),
    metadata: {
      ...normalizeMetadataCommon("text", payload, savedAt),
      max_tokens: payload.maxTokens ?? null,
      temperature: payload.temperature ?? null,
      usage: payload.usage || null,
    },
  };
}

function serializeEmbeddingsPayload(title, payload, savedAt) {
  const sections = [
    `Title: ${title}`,
    "Module: Embeddings",
    `Saved At: ${savedAt}`,
    `Run Received At: ${payload.receivedAt || "Unknown"}`,
    `Preset: ${payload.preset || "Preset default"}`,
    `Model: ${buildModelLine(payload.model)}`,
    `Vendor: ${payload.model?.vendor || "Unknown"}`,
    `Elapsed: ${payload.elapsedMs ?? "Unknown"} ms`,
    `Count: ${payload.count ?? "Unknown"}`,
    `Dimensions: ${payload.dimensions ?? "Unknown"}`,
    `Shape: ${Array.isArray(payload.shape) ? payload.shape.join(" x ") : "Unknown"}`,
    `Pooling: ${payload.pooling || "None"}`,
    "",
    "Warnings:",
    buildWarningsBlock(payload.warnings),
    "",
    "Input Items:",
    Array.isArray(payload.inputItems) ? payload.inputItems.join("\n") : "",
    "",
    "Vectors:",
    formatJsonBlock(payload.vectors),
  ];

  return {
    content: sections.join("\n"),
    previewText: truncatePreview(
      Array.isArray(payload.inputItems) && payload.inputItems.length > 0
        ? payload.inputItems[0]
        : `Embeddings ${payload.count ?? 0} vectors`
    ),
    metadata: {
      ...normalizeMetadataCommon("embeddings", payload, savedAt),
      count: payload.count ?? null,
      dimensions: payload.dimensions ?? null,
      shape: payload.shape || null,
      pooling: payload.pooling || null,
    },
  };
}

function serializeComparePayload(title, payload, savedAt) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const modelA = results[0] || null;
  const modelB = results[1] || null;

  const sections = [
    `Title: ${title}`,
    "Module: Compare",
    `Saved At: ${savedAt}`,
    `Run Received At: ${payload.receivedAt || "Unknown"}`,
    `Elapsed: ${payload.elapsedMs ?? "Unknown"} ms`,
    `Temperature: ${payload.temperature ?? "Unknown"}`,
    `Max Tokens: ${payload.maxTokens ?? "Unknown"}`,
    "",
    "Warnings:",
    buildWarningsBlock(payload.warnings),
    "",
    "System Prompt:",
    payload.system || "None",
    "",
    "Shared Prompt:",
    payload.prompt,
    "",
    `Model A: ${buildModelLine(modelA?.model)}`,
    `Model A Status: ${modelA?.ok ? "ok" : "error"}`,
    `Model A Usage: ${formatJsonBlock(modelA?.usage || null)}`,
    "",
    "Model A Output:",
    modelA?.text || modelA?.error || "No output",
    "",
    `Model B: ${buildModelLine(modelB?.model)}`,
    `Model B Status: ${modelB?.ok ? "ok" : "error"}`,
    `Model B Usage: ${formatJsonBlock(modelB?.usage || null)}`,
    "",
    "Model B Output:",
    modelB?.text || modelB?.error || "No output",
    "",
    "Difference Aid:",
    buildCompareDiffBlock(payload.diffSummary),
  ];

  return {
    content: sections.join("\n"),
    previewText: truncatePreview(modelA?.text || modelB?.text || payload.prompt),
    metadata: {
      ...normalizeMetadataCommon("compare", payload, savedAt),
      max_tokens: payload.maxTokens ?? null,
      temperature: payload.temperature ?? null,
      result_count: results.length,
      partial_success: results.some((entry) => entry && entry.ok === false),
    },
  };
}

function serializeLiveAgentPayload(title, payload, savedAt) {
  const transcriptLines = Array.isArray(payload.transcript)
    ? payload.transcript.map((entry) => `[${String(entry.role || "unknown").toUpperCase()}] ${entry.content}`)
    : [];

  const sections = [
    `Title: ${title}`,
    "Module: Live Agent",
    `Saved At: ${savedAt}`,
    `Run Received At: ${payload.receivedAt || "Unknown"}`,
    `Model: ${buildModelLine(payload.model)}`,
    `Vendor: ${payload.model?.vendor || "Unknown"}`,
    "",
    "System Prompt:",
    payload.system || "None",
    "",
    "Transcript:",
    transcriptLines.length ? transcriptLines.join("\n\n") : "No transcript",
    "",
    "Final Response:",
    payload.finalResponse || "No final response",
  ];

  return {
    content: sections.join("\n"),
    previewText: truncatePreview(payload.finalResponse || transcriptLines[transcriptLines.length - 1] || "Live agent transcript"),
    metadata: {
      ...normalizeMetadataCommon("live_agent", payload, savedAt),
      transcript_messages: Array.isArray(payload.transcript) ? payload.transcript.length : 0,
    },
  };
}

function buildMusicMetadata(payload, savedAt) {
  return {
    source_module: "music",
    saved_at: savedAt,
    model: payload.model || null,
    prompt: payload.prompt || null,
    mode: payload.mode || null,
    lyrics_mode: payload.lyricsMode || null,
    bpm: payload.bpm ?? null,
    key: payload.key || null,
    lyrics_preview: payload.lyricsPreview || null,
    audio: {
      duration_ms: payload.durationMs ?? null,
      sample_rate: payload.sampleRate ?? null,
      channels: payload.channels ?? null,
      bitrate: payload.bitrate ?? null,
      size_bytes: payload.sizeBytes ?? null,
    },
    trace_id: payload.traceId || null,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    elapsed_ms: payload.elapsedMs ?? null,
    received_at: payload.receivedAt || null,
  };
}

function urlPathLooksLikeMp4(value) {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return false;
  }
}

function resolveFetchedVideoMimeType(contentType, sourceUrl, finalUrl) {
  const normalized = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (normalized === "video/mp4") {
    return "video/mp4";
  }

  if (
    (!normalized || normalized === "application/octet-stream")
    && (urlPathLooksLikeMp4(finalUrl) || urlPathLooksLikeMp4(sourceUrl))
  ) {
    return "video/mp4";
  }

  return null;
}

function buildVideoMetadata(payload, _savedAt, { mimeType, sizeBytes } = {}) {
  const metadata = {
    source_module: "video",
    upstream_url: payload.videoUrl || null,
    mime_type: mimeType || "video/mp4",
    size_bytes: sizeBytes ?? null,
  };

  if (payload.model) metadata.model = payload.model;
  if (payload.prompt || payload.prompt === null) metadata.prompt = payload.prompt;
  if (payload.duration !== undefined && payload.duration !== null) metadata.duration = payload.duration;
  if (payload.aspect_ratio) metadata.aspect_ratio = payload.aspect_ratio;
  if (payload.quality) metadata.quality = payload.quality;
  if (payload.resolution) metadata.resolution = payload.resolution;
  if (payload.seed !== undefined && payload.seed !== null) metadata.seed = payload.seed;
  if (payload.generate_audio !== undefined && payload.generate_audio !== null) {
    metadata.generate_audio = payload.generate_audio;
  }
  if (payload.hasImageInput !== undefined && payload.hasImageInput !== null) {
    metadata.has_image_input = payload.hasImageInput;
  }
  if (payload.hasEndImageInput !== undefined && payload.hasEndImageInput !== null) {
    metadata.has_end_image_input = payload.hasEndImageInput;
  }
  if (payload.workflow) metadata.workflow = payload.workflow;
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    metadata.warnings = payload.warnings;
  }
  if (payload.elapsedMs !== undefined && payload.elapsedMs !== null) {
    metadata.elapsed_ms = payload.elapsedMs;
  }

  return metadata;
}

export function serializeAdminAiTextAsset({ title, sourceModule, payload, savedAt = nowIso() }) {
  const safeTitle = cleanInlineText(title);
  const normalizedPayload = {
    ...payload,
    prompt: cleanMultilineText(payload.prompt),
    system: cleanMultilineText(payload.system),
    output: cleanMultilineText(payload.output),
    finalResponse: cleanMultilineText(payload.finalResponse),
    inputItems: Array.isArray(payload.inputItems) ? payload.inputItems.map(cleanMultilineText) : [],
    transcript: Array.isArray(payload.transcript)
      ? payload.transcript.map((entry) => ({
          role: cleanInlineText(entry.role),
          content: cleanMultilineText(entry.content),
        }))
      : [],
  };

  switch (sourceModule) {
    case "text":
      return serializeTextPayload(safeTitle, normalizedPayload, savedAt);
    case "embeddings":
      return serializeEmbeddingsPayload(safeTitle, normalizedPayload, savedAt);
    case "compare":
      return serializeComparePayload(safeTitle, normalizedPayload, savedAt);
    case "live_agent":
      return serializeLiveAgentPayload(safeTitle, normalizedPayload, savedAt);
    default: {
      const error = new Error(`Unsupported source module "${sourceModule}".`);
      error.status = 400;
      throw error;
    }
  }
}

export const AI_MUSIC_ASSET_MAX_BYTES = 12_000_000;

async function buildMusicAssetFields(safeTitle, payload, now) {
  let bytes;
  let mimeType = payload.mimeType || "audio/mpeg";

  if (payload.audioBase64) {
    bytes = Uint8Array.from(atob(payload.audioBase64), (ch) => ch.charCodeAt(0));
  } else if (payload.audioUrl) {
    const error = attachRemoteMediaPolicyContext(
      new Error(
        buildRemoteMediaUrlRejectedMessage(
          "audioUrl",
          "Submit inline audio bytes via audioBase64 instead."
        )
      ),
      payload.audioUrl,
      {
        field: "audioUrl",
        reason: "remote_audio_save_url_rejected",
      }
    );
    error.status = 400;
    error.code = REMOTE_MEDIA_URL_POLICY_CODE;
    throw error;
  } else {
    const error = new Error("audioBase64 is required.");
    error.status = 400;
    error.code = "validation_error";
    throw error;
  }

  if (bytes.byteLength > AI_MUSIC_ASSET_MAX_BYTES) {
    const error = new Error(`Music asset exceeds the ${AI_MUSIC_ASSET_MAX_BYTES} byte limit.`);
    error.status = 400;
    error.code = "validation_error";
    throw error;
  }
  if (bytes.byteLength === 0) {
    const error = new Error("Audio payload is empty.");
    error.status = 400;
    error.code = "validation_error";
    throw error;
  }

  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("flac") ? "flac" : "mp3";
  const previewText = truncatePreview(payload.prompt || "Music generation");
  const metadata = buildMusicMetadata(payload, now);
  return { bytes, mimeType, ext, previewText, metadata };
}

async function buildVideoAssetFields(safeTitle, payload, now) {
  const error = attachRemoteMediaPolicyContext(
    new Error(
      buildRemoteMediaUrlRejectedMessage(
        "data.videoUrl",
        "Download the provider result in the browser until a trusted Bitbi video-ingest contract exists."
      )
    ),
    payload?.videoUrl,
    {
      field: "data.videoUrl",
      reason: "remote_video_save_url_rejected",
    }
  );
  error.status = 400;
  error.code = REMOTE_MEDIA_URL_POLICY_CODE;
  throw error;
}

export async function saveAdminAiTextAsset(env, { userId, folderId = null, title, sourceModule, payload }) {
  const safeTitle = cleanInlineText(title).slice(0, 120) || "AI Lab Asset";
  const now = nowIso();

  let bytes;
  let mimeType;
  let fileExt;
  let previewText;
  let metadataRaw;

  if (sourceModule === "music") {
    const music = await buildMusicAssetFields(safeTitle, payload, now);
    bytes = music.bytes;
    mimeType = music.mimeType;
    fileExt = music.ext;
    previewText = music.previewText;
    metadataRaw = music.metadata;
  } else if (sourceModule === "video") {
    const video = await buildVideoAssetFields(safeTitle, payload, now);
    bytes = video.bytes;
    mimeType = video.mimeType;
    fileExt = video.ext;
    previewText = video.previewText;
    metadataRaw = video.metadata;
  } else {
    const serialization = serializeAdminAiTextAsset({
      title: safeTitle,
      sourceModule,
      payload,
      savedAt: now,
    });
    const content = serialization.content.endsWith("\n")
      ? serialization.content
      : `${serialization.content}\n`;
    bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > AI_TEXT_ASSET_MAX_BYTES) {
      const error = new Error(`Saved text asset exceeds the ${AI_TEXT_ASSET_MAX_BYTES} byte limit.`);
      error.status = 400;
      error.code = "validation_error";
      throw error;
    }
    mimeType = AI_TEXT_ASSET_MIME_TYPE;
    fileExt = "txt";
    previewText = serialization.previewText;
    metadataRaw = serialization.metadata;
  }

  let resolvedFolderId = null;
  let folderSlug = "unsorted";
  if (folderId) {
    const folder = await env.DB.prepare(
      "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'"
    ).bind(folderId, userId).first();

    if (!folder) {
      const error = new Error("Folder not found.");
      error.status = 404;
      error.code = "not_found";
      throw error;
    }

    resolvedFolderId = folder.id;
    folderSlug = folder.slug;
  }

  const fileStem = slugifyFileName(safeTitle, sourceModule);
  const fileName = `${fileStem}.${fileExt}`;
  const assetId = randomTokenHex(16);
  const timestamp = Date.now();
  const subDir = sourceModule === "music" ? "audio" : sourceModule === "video" ? "video" : "text";
  const r2Key = `users/${userId}/folders/${folderSlug}/${subDir}/${timestamp}-${randomTokenHex(4)}-${fileName}`;
  const metadataJson = JSON.stringify(
    sanitizeAssetMetadata(metadataRaw, {
      field: "metadata",
      ...METADATA_JSON_LIMITS,
      stringifyNested: true,
    })
  );

  try {
    await env.USER_IMAGES.put(r2Key, bytes, {
      httpMetadata: {
        contentType: mimeType,
        contentDisposition: `inline; filename="${fileName}"`,
      },
    });
  } catch {
    const error = new Error(
      sourceModule === "video" ? "Failed to store video asset." : "Failed to store saved asset."
    );
    error.status = 500;
    error.code = "storage_error";
    throw error;
  }

  let insertResult;
  try {
    if (resolvedFolderId) {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active')`
      ).bind(
        assetId,
        userId,
        resolvedFolderId,
        r2Key,
        safeTitle,
        fileName,
        sourceModule,
        mimeType,
        bytes.byteLength,
        previewText,
        metadataJson,
        now,
        resolvedFolderId,
        userId
      ).run();
    } else {
      insertResult = await env.DB.prepare(
        `INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        assetId,
        userId,
        null,
        r2Key,
        safeTitle,
        fileName,
        sourceModule,
        mimeType,
        bytes.byteLength,
        previewText,
        metadataJson,
        now
      ).run();
    }
  } catch (error) {
    try {
      await env.USER_IMAGES.delete(r2Key);
    } catch {
      // Best effort only — the caller already receives the DB error state.
    }
    const next = new Error("Failed to save text asset. The folder may have been deleted.");
    next.status = 409;
    next.code = "validation_error";
    throw next;
  }

  if (!insertResult?.meta?.changes) {
    try {
      await env.USER_IMAGES.delete(r2Key);
    } catch {
      // Best effort only.
    }
    const error = new Error("Folder was deleted. Text asset not saved.");
    error.status = 404;
    error.code = "not_found";
    throw error;
  }

  let posterResult = null;
  if (sourceModule === "video" && payload.posterBase64) {
    posterResult = await processVideoPoster(env, {
      userId,
      assetId,
      posterBase64: payload.posterBase64,
    });
  }

  return {
    id: assetId,
    folder_id: resolvedFolderId,
    title: safeTitle,
    file_name: fileName,
    source_module: sourceModule,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    preview_text: previewText,
    created_at: now,
    poster_r2_key: posterResult?.r2Key || null,
    poster_width: posterResult?.width || null,
    poster_height: posterResult?.height || null,
  };
}

async function processVideoPoster(env, { userId, assetId, posterBase64 }) {
  try {
    const raw = posterBase64.includes(",")
      ? posterBase64.split(",")[1]
      : posterBase64;
    const posterBytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));

    if (posterBytes.byteLength === 0 || posterBytes.byteLength > POSTER_MAX_BYTES) {
      return null;
    }

    if (
      !env.IMAGES ||
      typeof env.IMAGES.input !== "function" ||
      typeof env.IMAGES.info !== "function"
    ) {
      return null;
    }

    let originalInfo;
    try {
      originalInfo = await env.IMAGES.info(posterBytes);
    } catch {
      return null;
    }
    if (!originalInfo?.width || !originalInfo?.height) {
      return null;
    }

    const transformResult = await env.IMAGES.input(posterBytes)
      .transform({
        width: POSTER_MAX_WIDTH,
        height: POSTER_MAX_HEIGHT,
        fit: "scale-down",
      })
      .output({
        format: POSTER_FORMAT,
        quality: POSTER_QUALITY,
      });

    let response;
    if (typeof transformResult.response === "function") {
      response = transformResult.response();
    } else if (typeof transformResult.arrayBuffer === "function") {
      response = transformResult;
    } else if (typeof transformResult.image === "function") {
      const stream = transformResult.image();
      const contentType = typeof transformResult.contentType === "function"
        ? transformResult.contentType()
        : POSTER_FORMAT;
      response = new Response(stream, {
        headers: { "content-type": contentType },
      });
    } else {
      return null;
    }

    const buffer = await response.arrayBuffer();
    if (!buffer || !buffer.byteLength) {
      return null;
    }

    const outputBytes = new Uint8Array(buffer);

    let outputInfo;
    try {
      outputInfo = await env.IMAGES.info(outputBytes);
    } catch {
      outputInfo = null;
    }

    const ratio = Math.min(
      POSTER_MAX_WIDTH / originalInfo.width,
      POSTER_MAX_HEIGHT / originalInfo.height,
      1
    );
    const width = outputInfo?.width || Math.max(1, Math.round(originalInfo.width * ratio));
    const height = outputInfo?.height || Math.max(1, Math.round(originalInfo.height * ratio));

    const r2Key = `users/${userId}/derivatives/v1/${assetId}/poster.webp`;
    await env.USER_IMAGES.put(r2Key, outputBytes, {
      httpMetadata: { contentType: POSTER_FORMAT },
    });

    await env.DB.prepare(
      "UPDATE ai_text_assets SET poster_r2_key = ?, poster_width = ?, poster_height = ? WHERE id = ? AND user_id = ?"
    ).bind(r2Key, width, height, assetId, userId).run();

    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-assets",
      event: "video_poster_saved",
      asset_id: assetId,
      user_id: userId,
      poster_width: width,
      poster_height: height,
    });

    return { r2Key, width, height };
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "ai-text-assets",
      event: "video_poster_save_failed",
      level: "warn",
      asset_id: assetId,
      user_id: userId,
      ...getErrorFields(error),
    });
    return null;
  }
}
